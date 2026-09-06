// Records the real V3 match for both players, mints their soulbound results,
// and has the losing wallet claim its sponsor-backed 1 tUSDC protection.
import fs from "node:fs";
import assert from "node:assert/strict";
import {
  createPublicClient,
  createWalletClient,
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
const deployment = read("deployments/shannon-v3.json");
const matchRun = read("deployments/v3-playable-e2e.json");
const arena = read("lib/testnet/MarketRoyale.json");
const progression = read("lib/testnet/MarketRoyaleProgression.json");
const accounts = read(".testnet/wallets.json").map((entry) =>
  privateKeyToAccount(entry.privateKey),
);
const token = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E";
const tokenAbi = parseAbi(["function balanceOf(address) view returns(uint256)"]);
const transport = () =>
  fallback(
    [
      http("https://dream-rpc.somnia.network", { timeout: 12_000, retryCount: 0 }),
      http("https://api.infra.testnet.somnia.network", { timeout: 12_000, retryCount: 0 }),
      http("https://50312.rpc.thirdweb.com", { timeout: 12_000, retryCount: 0 }),
    ],
    { retryCount: 0 },
  );
const pub = createPublicClient({
  chain: somniaTestnet,
  transport: transport(),
  pollingInterval: 1_500,
});
const reportPath = file("deployments/v3-progression-e2e.json");
const pendingPath = file(".testnet/v3-progression-pending.json");
const report = fs.existsSync(reportPath)
  ? read("deployments/v3-progression-e2e.json")
  : {
      chainId: 50312,
      arena: deployment.arena,
      progression: deployment.progression,
      match: matchRun.match,
      status: "in-progress",
      transactions: [],
      completedSteps: [],
    };
const save = () =>
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");

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
  if (!report.completedSteps.includes(pending.label))
    report.completedSteps.push(pending.label);
  save();
  fs.rmSync(pendingPath, { force: true });
  console.log(pending.label, pending.hash);
}

async function send(accountIndex, functionName, args, label) {
  if (report.completedSteps.includes(label)) return;
  const account = accounts[accountIndex];
  const params = {
    account,
    address: deployment.progression,
    abi: progression.abi,
    functionName,
    args,
  };
  await pub.simulateContract(params);
  const estimate = await pub.estimateContractGas(params);
  const wallet = createWalletClient({
    account,
    chain: somniaTestnet,
    transport: transport(),
  });
  const raw = await wallet.signTransaction({
    account,
    chain: somniaTestnet,
    to: deployment.progression,
    data: encodeFunctionData({ abi: progression.abi, functionName, args }),
    nonce: await pub.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    }),
    gas: (estimate * 150n) / 100n + 100_000n,
    gasPrice: await pub.getGasPrice(),
    type: "legacy",
  });
  const pending = { hash: keccak256(raw), raw, label };
  fs.writeFileSync(pendingPath, JSON.stringify(pending), { mode: 0o600 });
  report.transactions.push({ hash: pending.hash, label, status: "pending" });
  save();
  try {
    await pub.sendRawTransaction({ serializedTransaction: raw });
  } catch {}
  await confirm(pending);
}

assert.equal(await pub.getChainId(), 50312);
if (fs.existsSync(pendingPath))
  await confirm(JSON.parse(fs.readFileSync(pendingPath, "utf8")));
const match = BigInt(report.match);
const tournament = await pub.readContract({
  address: deployment.arena,
  abi: arena.abi,
  functionName: "getTournament",
  args: [match],
});
assert.equal(tournament.phase, 3, "Playable V3 match must finish first");
const players = await pub.readContract({
  address: deployment.arena,
  abi: arena.abi,
  functionName: "getPlayers",
  args: [match],
});
const participants = players.filter((player) =>
  accounts.slice(1, 3).some(
    (account) => account.address.toLowerCase() === player.wallet.toLowerCase(),
  ),
);
assert.equal(participants.length, 2);
for (const player of participants) {
  const already = await pub.readContract({
    address: deployment.progression,
    abi: progression.abi,
    functionName: "resultRecorded",
    args: [match, player.wallet],
  });
  if (!already)
    await send(0, "recordResult", [match, player.wallet], `Mint rank ${player.rank}`);
}
const loser = participants.find((player) => player.prize === 0n);
const winner = participants.find((player) => player.rank === 1);
assert.ok(loser && winner);
const loserIndex = accounts.findIndex(
  (account) => account.address.toLowerCase() === loser.wallet.toLowerCase(),
);
const claimed = await pub.readContract({
  address: deployment.progression,
  abi: progression.abi,
  functionName: "rebateClaimed",
  args: [match, loser.wallet],
});
if (!claimed)
  await send(loserIndex, "claimProtection", [match], "Claim protected loss");

const [winnerProfile, loserProfile, winnerBadge, loserBadge, claimedNow, reserve] =
  await Promise.all([
    pub.readContract({ address: deployment.progression, abi: progression.abi, functionName: "profileOf", args: [winner.wallet] }),
    pub.readContract({ address: deployment.progression, abi: progression.abi, functionName: "profileOf", args: [loser.wallet] }),
    pub.readContract({ address: deployment.progression, abi: progression.abi, functionName: "balanceOf", args: [winner.wallet, 5n] }),
    pub.readContract({ address: deployment.progression, abi: progression.abi, functionName: "balanceOf", args: [loser.wallet, 1n] }),
    pub.readContract({ address: deployment.progression, abi: progression.abi, functionName: "rebateClaimed", args: [match, loser.wallet] }),
    pub.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [deployment.progression] }),
  ]);
assert.equal(winnerProfile.completed, 1);
assert.equal(winnerProfile.wins, 1);
assert.equal(loserProfile.completed, 1);
assert.equal(loserProfile.protectedGames, 1);
assert.equal(winnerBadge, 1n);
assert.equal(loserBadge, 1n);
assert.equal(claimedNow, true);
assert.equal(reserve, 191_000_000n);
report.status = "complete";
report.winner = winner.wallet;
report.loser = loser.wallet;
report.reserve = String(reserve);
report.finishedAt = new Date().toISOString();
save();
console.log(
  JSON.stringify({
    match: report.match,
    winner: report.winner,
    loser: report.loser,
    reserve: report.reserve,
    badgesMinted: true,
    protectionPaid: "1000000",
  }),
);
