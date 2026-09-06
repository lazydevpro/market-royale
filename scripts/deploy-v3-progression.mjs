// Deploys the V3 arena and its Shannon-only progression sidecar. Every signed
// transaction is journaled before broadcast so an RPC error can be recovered.
import fs from "node:fs";
import assert from "node:assert/strict";
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
const saved = read(".testnet/wallets.json");
const host = privateKeyToAccount(saved[0].privateKey);
const players = saved.slice(1, 3).map((entry) => entry.address);
const arenaArtifact = read("lib/testnet/MarketRoyale.json");
const progressionArtifact = read("lib/testnet/MarketRoyaleProgression.json");
const TOKEN = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E";
const MODULE = "0x3ecC694Cef705358864a646142ac17A90E29e388";
const CREATOR = "0x94D963B6670AB96E78C8d0C46ca35D196d606EFE";
const VENUE =
  "0x679795a0195a1b76cdebb7c51d74e058aee92919b8c3389af86ef24535e8a28c";
const SPONSOR = "0x24a43ad7e9318cf515867477bf9c489989dcc701";
const tokenAbi = parseAbi([
  "function faucet(uint256)",
  "function approve(address,uint256) returns(bool)",
  "function balanceOf(address) view returns(uint256)",
]);
const reportPath = file("deployments/shannon-v3.json");
const pendingPath = file(".testnet/v3-deploy-pending.json");
const report = fs.existsSync(reportPath)
  ? read("deployments/shannon-v3.json")
  : {
      chainId: 50312,
      version: 3,
      host: host.address,
      sponsor: SPONSOR,
      transactions: [],
      completedSteps: [],
    };
const save = () =>
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
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
  account: host,
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
  return block;
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
  return receipt;
}

async function signAndSend({ label, field, to, data, gas }) {
  if (report.completedSteps.includes(label)) return;
  await fresh();
  const raw = await wallet.signTransaction({
    account: host,
    chain: somniaTestnet,
    to,
    data,
    nonce: await pub.getTransactionCount({
      address: host.address,
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
  return confirm(pending);
}

async function deploy(label, field, artifact, args) {
  if (report[field]) return;
  const data = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args,
  });
  const estimate = await pub.estimateGas({ account: host, data });
  await signAndSend({
    label,
    field,
    data,
    gas: (estimate * 150n) / 100n + 100_000n,
  });
}

async function send(label, address, abi, functionName, args) {
  if (report.completedSteps.includes(label)) return;
  const params = {
    account: host,
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
await deploy("Deploy V3 arena", "arena", arenaArtifact, [
  TOKEN,
  MODULE,
  CREATOR,
  VENUE,
]);
const firstSeasonEnds = BigInt(Math.floor(Date.now() / 1000) + 90 * 86_400);
await deploy(
  "Deploy progression",
  "progression",
  progressionArtifact,
  [report.arena, TOKEN, host.address, firstSeasonEnds],
);

const RESERVE = 192_000_000n;
if ((await pub.readContract({ address: TOKEN, abi: tokenAbi, functionName: "balanceOf", args: [host.address] })) < RESERVE)
  await send("Mint sponsor reserve", TOKEN, tokenAbi, "faucet", [250_000_000n]);
await send("Approve sponsor reserve", TOKEN, tokenAbi, "approve", [
  report.progression,
  RESERVE,
]);
await send(
  "Fund sponsor reserve",
  report.progression,
  progressionArtifact.abi,
  "fund",
  [RESERVE],
);
await send(
  "Verify launch players",
  report.progression,
  progressionArtifact.abi,
  "setProtectionVerified",
  [players, true],
);

let env = fs.existsSync(file(".env.local"))
  ? fs.readFileSync(file(".env.local"), "utf8")
  : "";
env = env
  .split("\n")
  .filter(
    (line) =>
      !line.startsWith("NEXT_PUBLIC_ROYALE_ADDRESS=") &&
      !line.startsWith("NEXT_PUBLIC_PROGRESSION_ADDRESS=") &&
      !line.startsWith("LOCAL_TEST_WALLETS="),
  )
  .join("\n")
  .replace(/\n+$/, "");
fs.writeFileSync(
  file(".env.local"),
  `${env}\nNEXT_PUBLIC_ROYALE_ADDRESS=${report.arena}\nNEXT_PUBLIC_PROGRESSION_ADDRESS=${report.progression}\nLOCAL_TEST_WALLETS=1\n`,
);
const keeperConfig = read("workers/wrangler.jsonc");
keeperConfig.vars.ROYALE_ADDRESS = report.arena;
keeperConfig.vars.LIQUIDITY_SPONSOR = SPONSOR;
fs.writeFileSync(
  file("workers/wrangler.jsonc"),
  JSON.stringify(keeperConfig, null, 2) + "\n",
);
report.status = "ready";
report.reserve = String(
  await pub.readContract({
    address: TOKEN,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [report.progression],
  }),
);
save();
console.log(
  JSON.stringify({
    arena: report.arena,
    progression: report.progression,
    sponsor: report.sponsor,
    reserve: report.reserve,
  }),
);
