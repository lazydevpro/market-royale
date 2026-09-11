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

const root = new URL("../", import.meta.url);
const file = (path) => new URL(path, root);
const read = (path) => JSON.parse(fs.readFileSync(file(path), "utf8"));
const deployment = read("deployments/shannon-v5.json");
const progressionDeployment = read("deployments/shannon-progression-v4.json");
const arena = read("lib/testnet/MarketRoyale.json");
const vault = read("lib/testnet/TraderVault.json");
const progression = read("lib/testnet/MarketRoyaleProgression.json");
const accounts = read(".testnet/wallets.json")
  .slice(0, 2)
  .map((wallet) => privateKeyToAccount(wallet.privateKey));

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
      http("https://50312.rpc.thirdweb.com", {
        timeout: 10000,
        retryCount: 0,
      }),
    ],
    { retryCount: 0 },
  );
const pub = createPublicClient({
  chain: somniaTestnet,
  transport: transport(),
  pollingInterval: 1500,
});
const token = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E";
const tokenAbi = parseAbi([
  "function faucet(uint256)",
  "function approve(address,uint256) returns(bool)",
  "function balanceOf(address) view returns(uint256)",
]);
const seat = 12_000_000n;
const reportName = "deployments/v5-quick-match-e2e.json";
const reportPath = file(reportName);
const report = fs.existsSync(reportPath)
  ? read(reportName)
  : {
      version: 5,
      chainId: 50312,
      registry: deployment.arena,
      status: "in-progress",
      transactions: [],
      completedSteps: [],
    };
const pendingPath = file(".testnet/v5-quick-runner-pending.json");
const save = () =>
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fresh() {
  assert.equal(await pub.getChainId(), 50312);
  const block = await pub.getBlock();
  if (Math.abs(Date.now() / 1000 - Number(block.timestamp)) > 90)
    throw Error("Shannon returns stale blocks");
  return block;
}

async function waitNetwork() {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const block = await fresh();
      report.status = "in-progress";
      delete report.error;
      save();
      return block;
    } catch (error) {
      report.status = "paused-network";
      report.error = error.shortMessage ?? error.message;
      save();
      console.log("Network unavailable; no transaction sent. Attempt", attempt + 1);
      if (attempt < 9) await pause(30000);
    }
  }
  throw Error("Network unavailable for five minutes; resume this runner later.");
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
      timeout: 120000,
    });
  }
  const row = report.transactions.find((transaction) => transaction.hash === pending.hash);
  if (row) {
    row.status = receipt.status;
    row.block = String(receipt.blockNumber);
  }
  if (
    receipt.status === "success" &&
    !report.completedSteps.includes(pending.label)
  )
    report.completedSteps.push(pending.label);
  save();
  fs.rmSync(pendingPath, { force: true });
  assert.equal(receipt.status, "success", `${pending.label} reverted`);
  console.log(pending.label, pending.hash);
  return receipt;
}

async function send(who, address, abi, functionName, args, label) {
  if (report.completedSteps.includes(label)) return undefined;
  await fresh();
  const account = accounts[who];
  const wallet = createWalletClient({
    account,
    chain: somniaTestnet,
    transport: transport(),
  });
  const parameters = { account, address, abi, functionName, args };
  await pub.simulateContract(parameters);
  const estimate = await pub.estimateContractGas(parameters);
  const raw = await wallet.signTransaction({
    account,
    chain: somniaTestnet,
    to: address,
    data: encodeFunctionData({ abi, functionName, args }),
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

const get = (functionName, args = []) =>
  pub.readContract({
    address: deployment.arena,
    abi: arena.abi,
    functionName,
    args,
  });

async function collectProof() {
  const created = report.transactions.find(
    (transaction) =>
      transaction.label === "Create and join V5 quick match" &&
      transaction.status === "success",
  );
  if (!created?.block || !report.match) return;
  const fromBlock = BigInt(created.block);
  const latestBlock = await pub.getBlockNumber();
  const readLogs = async (address, abi) => {
    const logs = [];
    for (let cursor = fromBlock; cursor <= latestBlock; cursor += 500n) {
      const toBlock =
        cursor + 499n < latestBlock ? cursor + 499n : latestBlock;
      logs.push(
        ...(await pub.getContractEvents({ address, abi, fromBlock: cursor, toBlock })),
      );
    }
    return logs;
  };
  const encodeLog = (log) =>
    JSON.parse(
      JSON.stringify(
        {
          event: log.eventName,
          transactionHash: log.transactionHash,
          block: log.blockNumber,
          args: log.args,
        },
        (_, value) => (typeof value === "bigint" ? String(value) : value),
      ),
    );
  const arenaLogs = await readLogs(deployment.arena, arena.abi);
  report.arenaEvents = arenaLogs
    .filter((log) => log.args?.id === BigInt(report.match))
    .map(encodeLog);
  const progressionLogs = await readLogs(
    progressionDeployment.progression,
    progression.abi,
  );
  report.progressionEvents = progressionLogs
    .filter(
      (log) =>
        log.args?.royale === BigInt(report.match) ||
        accounts.some(
          (account) =>
            log.args?.player?.toLowerCase?.() === account.address.toLowerCase(),
        ),
    )
    .map(encodeLog);
  save();
}

async function ensureSeat(who, prefix) {
  const balance = await pub.readContract({
    address: token,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [accounts[who].address],
  });
  if (balance < seat)
    await send(who, token, tokenAbi, "faucet", [50_000_000n], `Fund ${prefix}`);
  await send(
    who,
    token,
    tokenAbi,
    "approve",
    [deployment.arena, seat],
    `Approve ${prefix}`,
  );
}

try {
  await waitNetwork();
  if (fs.existsSync(pendingPath))
    await confirm(JSON.parse(fs.readFileSync(pendingPath, "utf8")));
  if (report.status === "complete") {
    await collectProof();
    console.log("Already complete", report.match);
    process.exit(0);
  }

  const created = report.transactions.find(
    (transaction) =>
      transaction.label === "Create and join V5 quick match" &&
      transaction.status === "success",
  );
  if (!report.match && created?.status === "success") {
    const receipt = await pub.getTransactionReceipt({ hash: created.hash });
    for (const log of receipt.logs) {
      try {
        const event = decodeEventLog({
          abi: arena.abi,
          data: log.data,
          topics: log.topics,
        });
        if (event.eventName === "Created") report.match = Number(event.args.id);
      } catch {}
    }
  }

  if (!report.match) {
    const block = await fresh();
    const response = await fetch("http://127.0.0.1:3000/api/testnet/markets");
    const listing = await response.json();
    if (!response.ok) throw Error(listing.error ?? "Unable to list live markets");
    // A two-minute lobby leaves enough time for Shannon inclusion variance and
    // still starts well inside the selected live market.
    const joinDeadline = block.timestamp + 120n;
    const available = listing.markets
      .filter(
        (market) =>
          market.status === 1 &&
          [900, 3600].includes(market.interval) &&
          market.expiry > Number(joinDeadline) + 240 &&
          market.bids.length > 0 &&
          market.asks.length > 0,
      )
      .sort((left, right) =>
        left.interval - right.interval || left.expiry - right.expiry,
      );
    if (!available.length)
      throw Error("DreamDEX has no live market with enough time for a quick match");
    const market = available[0];
    await ensureSeat(0, "host seat");
    const receipt = await send(
      0,
      deployment.arena,
      arena.abi,
      "createAndJoin",
      [market.id, joinDeadline, 2, 1, 2_000_000n, 10_000_000n],
      "Create and join V5 quick match",
    );
    for (const log of receipt.logs) {
      try {
        const event = decodeEventLog({
          abi: arena.abi,
          data: log.data,
          topics: log.topics,
        });
        if (event.eventName === "Created") report.match = Number(event.args.id);
      } catch {}
    }
    report.market = {
      id: market.id,
      asset: market.asset,
      interval: market.interval,
      start: market.start,
      expiry: market.expiry,
    };
    report.joinDeadline = String(joinDeadline);
    save();
  }

  const id = BigInt(report.match);
  let players = await get("getPlayers", [id]);
  if (
    !players.some(
      (player) =>
        player.wallet.toLowerCase() === accounts[1].address.toLowerCase(),
    )
  ) {
    await ensureSeat(1, "challenger seat");
    await send(
      1,
      deployment.arena,
      arena.abi,
      "join",
      [id],
      "Enter challenger",
    );
  }

  await fetch("http://127.0.0.1:8787/wake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ matchId: report.match, asset: report.market?.asset }),
  });
  report.status = "waiting-for-operator";
  save();

  for (let attempt = 0; attempt < 100; attempt++) {
    await waitNetwork();
    const tournament = await get("getTournament", [id]);
    if (tournament.phase === 4)
      throw Error(
        `Event cancelled with reason ${tournament.cancelReason}; refunds remain automated.`,
      );
    if (tournament.phase === 1) {
      const response = await fetch(
        `http://127.0.0.1:3000/api/testnet/state?registry=${deployment.arena}&id=${id}`,
      );
      const snapshot = await response.json();
      if (!response.ok) throw Error(snapshot.error);
      for (const who of [0, 1]) {
        const player = snapshot.players.find(
          (candidate) =>
            candidate.wallet.toLowerCase() === accounts[who].address.toLowerCase(),
        );
        if (player.actions > 0) continue;
        const book = who === 0 ? snapshot.market.asks : snapshot.market.bids;
        if (!book.length) continue;
        const tick = BigInt(snapshot.market.tick);
        const limit = who === 0 ? (990000n / tick) * tick : tick;
        await send(
          who,
          player.vault,
          vault.abi,
          "trade",
          [who === 0 ? 0 : 2, limit, 2_000_000n],
          who === 0 ? "Host buys UP" : "Challenger buys DOWN",
        );
      }
    }
    if (tournament.phase === 3) {
      players = await get("getPlayers", [id]);
      const withdrawn = await Promise.all(
        players.map((player) =>
          pub.readContract({
            address: player.vault,
            abi: vault.abi,
            functionName: "withdrawn",
          }),
        ),
      );
      if (players.every((player) => player.prizeClaimed) && withdrawn.every(Boolean)) {
        assert.equal(
          players.reduce((total, player) => total + player.prize, 0n),
          4_000_000n,
        );
        assert.ok(
          report.completedSteps.includes("Host buys UP") &&
            report.completedSteps.includes("Challenger buys DOWN"),
        );
        report.status = "complete";
        delete report.error;
        report.players = JSON.parse(
          JSON.stringify(players, (_, value) =>
            typeof value === "bigint" ? String(value) : value,
          ),
        );
        const operator = await (
          await fetch("http://127.0.0.1:8787/status")
        ).json();
        report.operator = {
          ...operator,
          log: operator.log?.filter((entry) =>
            entry.label.includes(`royale ${report.match}`),
          ),
        };
        report.finishedAt = new Date().toISOString();
        await collectProof();
        save();
        console.log(
          "Complete: V5 quick match, real fills, oracle settlement and payouts",
          report.match,
        );
        process.exit(0);
      }
    }
    console.log(
      "Waiting",
      JSON.stringify({
        match: report.match,
        phase: tournament.phase,
        round: tournament.round,
        trades: tournament.roundTrades,
      }),
    );
    await pause(15000);
  }
  throw Error("Operator did not complete within the test window; resume the runner.");
} catch (error) {
  report.error = error.shortMessage ?? error.message;
  if (report.status !== "paused-network") report.status = "needs-attention";
  save();
  console.error(report.error);
  process.exitCode = 2;
}
