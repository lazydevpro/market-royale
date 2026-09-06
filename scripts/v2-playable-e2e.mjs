// Real public Shannon only. Run alongside `npm run local`. Resumes its receipt journal.
import fs from "node:fs";
import assert from "node:assert/strict";
import {
  createPublicClient,
  createWalletClient,
  http,
  fallback,
  encodeFunctionData,
  decodeEventLog,
  parseAbi,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaTestnet } from "viem/chains";
const root = new URL("../", import.meta.url),
  file = (p) => new URL(p, root),
  read = (p) => JSON.parse(fs.readFileSync(file(p), "utf8"));
const deployment = read("deployments/shannon-v2.json"),
  arena = read("lib/testnet/MarketRoyale.json"),
  vault = read("lib/testnet/TraderVault.json");
const accounts = read(".testnet/wallets.json").map((w) =>
  privateKeyToAccount(w.privateKey),
);
const transport = () =>
  fallback(
    [
      http("https://dream-rpc.somnia.network", {
        timeout: 10000,
        retryCount: 0,
      }),
      http("https://api.infra.testnet.somnia.network", {
        timeout: 10000,
        retryCount: 0,
      }),
      http("https://50312.rpc.thirdweb.com", { timeout: 10000, retryCount: 0 }),
    ],
    { retryCount: 0 },
  );
const pub = createPublicClient({
  chain: somniaTestnet,
  transport: transport(),
  pollingInterval: 1500,
});
const token = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E",
  tokenAbi = parseAbi([
    "function faucet(uint256)",
    "function approve(address,uint256) returns(bool)",
    "function balanceOf(address) view returns(uint256)",
  ]);
const reportPath = file("deployments/v2-playable-e2e.json");
const report = fs.existsSync(reportPath)
  ? read("deployments/v2-playable-e2e.json")
  : {
      version: 2,
      chainId: 50312,
      registry: deployment.arena,
      status: "in-progress",
      transactions: [],
      completedSteps: [],
    };
const pendingPath = file(".testnet/v2-runner-pending.json");
const save = () =>
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function fresh() {
  assert.equal(await pub.getChainId(), 50312);
  const b = await pub.getBlock();
  if (Math.abs(Date.now() / 1000 - Number(b.timestamp)) > 90)
    throw Error("Shannon returns stale blocks");
  return b;
}
async function waitNetwork() {
  for (let tries = 0; tries < 10; tries++) {
    try {
      const block = await fresh();
      report.status = "in-progress";
      delete report.error;
      save();
      return block;
    } catch (e) {
      report.status = "paused-network";
      report.error = e.shortMessage ?? e.message;
      save();
      console.log(
        "Network unavailable; no transaction sent. Attempt",
        tries + 1,
      );
      if (tries < 9) await pause(30000);
    }
  }
  throw Error(
    "Network unavailable for five minutes; resume this runner later.",
  );
}
async function confirm(p) {
  let receipt;
  try {
    receipt = await pub.getTransactionReceipt({ hash: p.hash });
  } catch (e) {
    if (e.name !== "TransactionReceiptNotFoundError") throw e;
    // Shannon can accept a raw transaction and still return a JSON-RPC error.
    // The signed hash is deterministic, so always recover by that hash.
    try {
      await pub.sendRawTransaction({ serializedTransaction: p.raw });
    } catch {}
    receipt = await pub.waitForTransactionReceipt({
      hash: p.hash,
      timeout: 120000,
    });
  }
  assert.equal(receipt.status, "success", p.label + " reverted");
  const row = report.transactions.find((t) => t.hash === p.hash);
  if (row) {
    row.status = receipt.status;
    row.block = String(receipt.blockNumber);
  }
  if (!report.completedSteps.includes(p.label))
    report.completedSteps.push(p.label);
  save();
  fs.rmSync(pendingPath, { force: true });
  console.log(p.label, p.hash);
  return receipt;
}
async function send(who, address, abi, fn, args, label) {
  if (report.completedSteps.includes(label)) return;
  await fresh();
  const account = accounts[who],
    wallet = createWalletClient({
      account,
      chain: somniaTestnet,
      transport: transport(),
    });
  const params = { account, address, abi, functionName: fn, args };
  await pub.simulateContract(params);
  const estimate = await pub.estimateContractGas(params);
  const raw = await wallet.signTransaction({
    account,
    chain: somniaTestnet,
    to: address,
    data: encodeFunctionData({ abi, functionName: fn, args }),
    nonce: await pub.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    }),
    gas: (estimate * 150n) / 100n + 100000n,
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
  return confirm(pending);
}
const get = (fn, args = []) =>
  pub.readContract({
    address: deployment.arena,
    abi: arena.abi,
    functionName: fn,
    args,
  });
try {
  await waitNetwork();
  if (fs.existsSync(pendingPath))
    await confirm(JSON.parse(fs.readFileSync(pendingPath, "utf8")));
  if (report.status === "complete") {
    console.log("Already complete", report.match);
    process.exit(0);
  }
  await fetch("http://127.0.0.1:8787/wake", { method: "POST" });
  // A crashed create transaction can be recovered from its recorded receipt.
  const scheduled = report.transactions.find(
    (t) => t.label === "Schedule playable event",
  );
  if (!report.match && scheduled?.status === "success") {
    const r = await pub.getTransactionReceipt({ hash: scheduled.hash });
    for (const l of r.logs) {
      try {
        const e = decodeEventLog({
          abi: arena.abi,
          data: l.data,
          topics: l.topics,
        });
        if (e.eventName === "Created") report.match = Number(e.args.id);
      } catch {}
    }
  }
  if (!report.match) {
    const b = await fresh();
    const response = await fetch("http://127.0.0.1:3000/api/testnet/markets");
    const listing = await response.json();
    if (!response.ok) throw Error(listing.error ?? "Unable to list live markets");
    const available = listing.markets
      .filter(
        (m) =>
          m.status === 1 &&
          [300, 900, 3600].includes(m.interval) &&
          m.expiry > Number(b.timestamp) + 330,
      )
      .sort((a, b) => a.interval - b.interval || a.expiry - b.expiry);
    if (!available.length)
      throw Error("DreamDex has no compatible live market with enough time remaining");
    const duration = available[0].interval;
    const start = b.timestamp + 180n;
    const r = await send(
      0,
      deployment.arena,
      arena.abi,
      "schedule",
      [start, 8, 1, 2, BigInt(duration)],
      "Schedule playable event",
    );
    for (const l of r.logs) {
      try {
        const e = decodeEventLog({
          abi: arena.abi,
          data: l.data,
          topics: l.topics,
        });
        if (e.eventName === "Created") report.match = Number(e.args.id);
      } catch {}
    }
    report.start = String(start);
    report.duration = duration;
    report.marketCandidate = available[0].id;
    save();
  }
  const id = BigInt(report.match);
  for (const i of [1, 2]) {
    const ps = await get("getPlayers", [id]);
    if (
      ps.some(
        (p) => p.wallet.toLowerCase() === accounts[i].address.toLowerCase(),
      )
    )
      continue;
    await send(i, token, tokenAbi, "faucet", [50_000_000n], `Fund player ${i}`);
    await send(
      i,
      token,
      tokenAbi,
      "approve",
      [deployment.arena, 12_000_000n],
      `Approve player ${i}`,
    );
    await send(
      i,
      deployment.arena,
      arena.abi,
      "join",
      [id],
      `Enter player ${i}`,
    );
  }
  report.status = "waiting-for-operator";
  save();
  for (let attempts = 0; attempts < 100; attempts++) {
    await waitNetwork();
    const t = await get("getTournament", [id]);
    if (t.phase === 4)
      throw Error(
        `Event cancelled with reason ${t.cancelReason}; refunds remain automated. Create a new journal for another attempt.`,
      );
    if (t.phase === 1) {
      const response = await fetch(
        `http://127.0.0.1:3000/api/testnet/state?registry=${deployment.arena}&id=${id}`,
      );
      const snap = await response.json();
      if (!response.ok) throw Error(snap.error);
      const m = snap.market;
      for (const i of [1, 2]) {
        const p = snap.players.find(
          (p) => p.wallet.toLowerCase() === accounts[i].address.toLowerCase(),
        );
        if (p.actions > 0) continue;
        const book = i === 1 ? m.asks : m.bids;
        if (!book.length) continue;
        const tick = BigInt(m.tick);
        const limit = i === 1 ? (990000n / tick) * tick : tick;
        await send(
          i,
          p.vault,
          vault.abi,
          "trade",
          [i === 1 ? 0 : 2, limit, 2_000_000n],
          `Trade player ${i}`,
        );
      }
    }
    if (t.phase === 3) {
      const ps = await get("getPlayers", [id]);
      const withdrawn = await Promise.all(
        ps.map((p) =>
          pub.readContract({
            address: p.vault,
            abi: vault.abi,
            functionName: "withdrawn",
          }),
        ),
      );
      if (ps.every((p) => p.prizeClaimed) && withdrawn.every(Boolean)) {
        assert.equal(
          ps.reduce((s, p) => s + p.prize, 0n),
          4_000_000n,
        );
        assert.ok(
          report.completedSteps.includes("Trade player 1") &&
            report.completedSteps.includes("Trade player 2"),
        );
        report.status = "complete";
        delete report.error;
        report.players = JSON.parse(
          JSON.stringify(ps, (_, v) => (typeof v === "bigint" ? String(v) : v)),
        );
        report.operator = await (
          await fetch("http://127.0.0.1:8787/status")
        ).json();
        report.finishedAt = new Date().toISOString();
        save();
        console.log(
          "Complete: real trades, oracle settlement and automatic payouts",
          report.match,
        );
        process.exit(0);
      }
    }
    console.log(
      "Waiting",
      JSON.stringify({
        match: report.match,
        phase: t.phase,
        round: t.round,
        trades: t.roundTrades,
      }),
    );
    await pause(15000);
  }
  throw Error(
    "Operator did not complete within the test window; inspect its status and resume.",
  );
} catch (e) {
  report.error = e.shortMessage ?? e.message;
  if (report.status !== "paused-network") report.status = "needs-attention";
  save();
  console.error(report.error);
  process.exitCode = 2;
}
