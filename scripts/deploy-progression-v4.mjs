// Replaces only the Shannon progression sidecar. Transactions are journaled
// before broadcast so the script can safely resume after an RPC interruption.
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  encodeFunctionData,
  fallback,
  http,
  keccak256,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaTestnet } from "viem/chains";

const root = new URL("../", import.meta.url);
const file = (name) => new URL(name, root);
const read = (name) => JSON.parse(fs.readFileSync(file(name), "utf8"));
const envValue = (name) => {
  const line = fs
    .readFileSync(file(".env.local"), "utf8")
    .split("\n")
    .find((row) => row.startsWith(`${name}=`));
  assert.ok(line, `${name} missing from .env.local`);
  return line.slice(name.length + 1).trim();
};

const localWallets = read(".testnet/wallets.json");
const bots = read(".testnet/bots.json");
const deployer = privateKeyToAccount(localWallets[0].privateKey);
const artifact = read("lib/testnet/MarketRoyaleProgression.json");
const arena = envValue("NEXT_PUBLIC_ROYALE_ADDRESS");
const configuredProgression = envValue("NEXT_PUBLIC_PROGRESSION_ADDRESS");
const TOKEN = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E";
const RESERVE = 192_000_000n;
const eligiblePlayers = [
  ...new Set([...localWallets, ...bots].map((wallet) => wallet.address)),
];
const tokenAbi = parseAbi([
  "function faucet(uint256)",
  "function approve(address,uint256) returns(bool)",
  "function balanceOf(address) view returns(uint256)",
]);
const reportPath = file("deployments/shannon-progression-v4.json");
const pendingPath = file(".testnet/progression-v4-pending.json");
const existingReport = fs.existsSync(reportPath)
  ? read("deployments/shannon-progression-v4.json")
  : null;
const predecessor = existingReport?.predecessor ?? configuredProgression;
const report = existingReport
  ? existingReport
  : {
      chainId: 50312,
      version: 4,
      arena,
      predecessor,
      deployer: deployer.address,
      transactions: [],
      completedSteps: [],
    };
const save = () =>
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

const transport = () =>
  fallback(
    [
      http("https://dream-rpc.somnia.network", {
        timeout: 12_000,
        retryCount: 0,
      }),
      http("https://api.infra.testnet.somnia.network", {
        timeout: 12_000,
        retryCount: 0,
      }),
      http("https://50312.rpc.thirdweb.com", {
        timeout: 12_000,
        retryCount: 0,
      }),
    ],
    { retryCount: 0 },
  );
const pub = createPublicClient({
  chain: somniaTestnet,
  transport: transport(),
  pollingInterval: 1_500,
});
const wallet = createWalletClient({
  account: deployer,
  chain: somniaTestnet,
  transport: transport(),
});

async function fresh() {
  assert.equal(await pub.getChainId(), 50312, "Shannon only");
  const block = await pub.getBlock();
  assert.ok(
    Math.abs(Date.now() / 1000 - Number(block.timestamp)) < 90,
    "Shannon returned a stale head",
  );
}

async function confirm(pending) {
  let receipt;
  try {
    receipt = await pub.getTransactionReceipt({ hash: pending.hash });
  } catch (error) {
    if (error.name !== "TransactionReceiptNotFoundError") throw error;
    try {
      await pub.sendRawTransaction({ serializedTransaction: pending.raw });
    } catch {}
    receipt = await pub.waitForTransactionReceipt({
      hash: pending.hash,
      timeout: 180_000,
    });
  }
  assert.equal(receipt.status, "success", `${pending.label} reverted`);
  const row = report.transactions.find((item) => item.hash === pending.hash);
  if (row)
    Object.assign(row, {
      status: receipt.status,
      block: String(receipt.blockNumber),
      gasUsed: String(receipt.gasUsed),
    });
  if (pending.field) report[pending.field] = receipt.contractAddress;
  if (!report.completedSteps.includes(pending.label))
    report.completedSteps.push(pending.label);
  save();
  fs.rmSync(pendingPath, { force: true });
  console.log(pending.label, pending.hash);
}

async function signAndSend({ label, field, to, data, gas }) {
  if (report.completedSteps.includes(label)) return;
  await fresh();
  const raw = await wallet.signTransaction({
    account: deployer,
    chain: somniaTestnet,
    to,
    data,
    nonce: await pub.getTransactionCount({
      address: deployer.address,
      blockTag: "pending",
    }),
    gas,
    gasPrice: await pub.getGasPrice(),
    type: "legacy",
  });
  const pending = { hash: keccak256(raw), raw, label, field };
  fs.writeFileSync(pendingPath, JSON.stringify(pending), { mode: 0o600 });
  report.transactions.push({ hash: pending.hash, label, status: "pending" });
  save();
  try {
    await pub.sendRawTransaction({ serializedTransaction: raw });
  } catch {}
  await confirm(pending);
}

async function send(label, address, abi, functionName, args) {
  if (report.completedSteps.includes(label)) return;
  const params = {
    account: deployer,
    address,
    abi,
    functionName,
    args,
  };
  await pub.simulateContract(params);
  const estimate = await pub.estimateContractGas(params);
  await signAndSend({
    label,
    to: address,
    data: encodeFunctionData({ abi, functionName, args }),
    gas: (estimate * 150n) / 100n + 100_000n,
  });
}

await fresh();
if (fs.existsSync(pendingPath))
  await confirm(JSON.parse(fs.readFileSync(pendingPath, "utf8")));

const [oldVersion, firstSeasonEnds] = await Promise.all([
  pub.readContract({
    address: predecessor,
    abi: artifact.abi,
    functionName: "VERSION",
  }),
  pub.readContract({
    address: predecessor,
    abi: artifact.abi,
    functionName: "seasonEnds",
  }),
]);
assert.equal(oldVersion, 3n, "Expected the active V3 sidecar");
assert.ok(
  firstSeasonEnds >= BigInt(Math.floor(Date.now() / 1000) + 30 * 86_400),
  "The current season is too close to expiry for a continuity deployment",
);

if (!report.progression) {
  const data = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: [arena, TOKEN, deployer.address, firstSeasonEnds],
  });
  const estimate = await pub.estimateGas({ account: deployer, data });
  await signAndSend({
    label: "Deploy progression V4",
    field: "progression",
    data,
    gas: (estimate * 150n) / 100n + 100_000n,
  });
}

if (!report.completedSteps.includes("Fund V4 reserve")) {
  const deployerBalance = await pub.readContract({
      address: TOKEN,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [deployer.address],
    });
  if (deployerBalance < RESERVE)
    await send("Mint V4 reserve", TOKEN, tokenAbi, "faucet", [250_000_000n]);
}
await send("Approve V4 reserve", TOKEN, tokenAbi, "approve", [
  report.progression,
  RESERVE,
]);
await send("Fund V4 reserve", report.progression, artifact.abi, "fund", [
  RESERVE,
]);
await send(
  "Verify test players",
  report.progression,
  artifact.abi,
  "setProtectionVerified",
  [eligiblePlayers, true],
);

const [version, seasonEnds, reserve] = await Promise.all([
  pub.readContract({
    address: report.progression,
    abi: artifact.abi,
    functionName: "VERSION",
  }),
  pub.readContract({
    address: report.progression,
    abi: artifact.abi,
    functionName: "seasonEnds",
  }),
  pub.readContract({
    address: report.progression,
    abi: artifact.abi,
    functionName: "sponsorReserve",
  }),
]);
assert.equal(version, 4n);
assert.equal(seasonEnds, firstSeasonEnds);
assert.equal(reserve, RESERVE);

let env = fs.readFileSync(file(".env.local"), "utf8");
env = env.replace(
  /^NEXT_PUBLIC_PROGRESSION_ADDRESS=.*$/m,
  `NEXT_PUBLIC_PROGRESSION_ADDRESS=${report.progression}`,
);
fs.writeFileSync(file(".env.local"), env);
const keeperPath = file("workers/wrangler.jsonc");
const keeperConfig = fs
  .readFileSync(keeperPath, "utf8")
  .replace(
    /("PROGRESSION_ADDRESS"\s*:\s*)"[^"]+"/,
    `$1"${report.progression}"`,
  );
fs.writeFileSync(keeperPath, keeperConfig);
Object.assign(report, {
  status: "ready",
  firstSeasonEnds: String(firstSeasonEnds),
  reserve: String(reserve),
  eligiblePlayers,
});
save();
console.log(
  JSON.stringify({
    arena,
    predecessor,
    progression: report.progression,
    version: String(version),
    reserve: String(reserve),
    firstSeasonEnds: String(firstSeasonEnds),
  }),
);
