// Real Shannon transactions only. Run after funding the local dedicated test wallets.
// No private keys are logged or sent anywhere except locally signed transactions.
import fs from "node:fs";
import assert from "node:assert/strict";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  encodeDeployData,
  decodeEventLog,
  zeroAddress,
  zeroHash,
  parseEther,
  formatEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaTestnet } from "viem/chains";
import { orderBookEventsAbi } from "../node_modules/@somnia-chain/markets-sdk/dist/eventsAbi.js";
import { binaryPoolWriteAbi } from "../node_modules/@somnia-chain/markets-sdk/dist/tradeAbi.js";
import { binaryModuleWriteAbi } from "../node_modules/@somnia-chain/markets-sdk/dist/moduleAbi.js";
import { binaryPoolReadAbi } from "../node_modules/@somnia-chain/markets-sdk/dist/readsAbi.js";
const RPC = "https://dream-rpc.somnia.network",
  TOKEN = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E",
  MODULE = "0x3ecC694Cef705358864a646142ac17A90E29e388";
const saved = JSON.parse(
  fs.readFileSync(new URL("../.testnet/wallets.json", import.meta.url), "utf8"),
);
const accounts = saved.map((w) => privateKeyToAccount(w.privateKey));
const pub = createPublicClient({
  chain: somniaTestnet,
  transport: http(RPC, { timeout: 20000, retryCount: 2 }),
  pollingInterval: 1500,
});
const wallets = accounts.map((account) =>
  createWalletClient({ account, chain: somniaTestnet, transport: http(RPC) }),
);
const arenaArtifact = JSON.parse(
  fs.readFileSync(
    new URL("../lib/testnet/legacy/MarketRoyale-v1.json", import.meta.url),
    "utf8",
  ),
);
const vaultArtifact = JSON.parse(
  fs.readFileSync(
    new URL("../lib/testnet/TraderVault.json", import.meta.url),
    "utf8",
  ),
);
const tokenAbi = parseAbi([
  "function faucet(uint256)",
  "function balanceOf(address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
  "function transfer(address,uint256) returns(bool)",
]);
const outcomeAbi = parseAbi([
  "function setOperator(address,bool) returns(bool)",
  "function balanceOf(address,uint256) view returns(uint256)",
]);
const reportFile = new URL("../deployments/shannon-e2e.json", import.meta.url);
const report = fs.existsSync(reportFile)
  ? JSON.parse(fs.readFileSync(reportFile, "utf8"))
  : {
      network: "Somnia Shannon",
      chainId: 50312,
      transactions: [],
      status: "in-progress",
    };
const save = () =>
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function confirm(hash, label) {
  console.log(label, hash);
  report.transactions.push({ label, hash, status: "pending" });
  save();
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 120000 });
  const row = report.transactions.find((t) => t.hash === hash);
  row.status = r.status;
  row.block = String(r.blockNumber);
  row.gasUsed = String(r.gasUsed);
  save();
  assert.equal(r.status, "success", label + " reverted");
  return r;
}
async function tx(
  who,
  address,
  abi,
  functionName,
  args = [],
  label = functionName,
) {
  assert.equal(await pub.getChainId(), 50312, "Shannon only");
  const params = { account: accounts[who], address, abi, functionName, args };
  const { request } = await pub.simulateContract(params);
  const estimate = await pub.estimateContractGas(params);
  const hash = await wallets[who].writeContract({
    ...request,
    gas: (estimate * 150n) / 100n + 100000n,
    gasPrice: await pub.getGasPrice(),
  });
  return confirm(hash, label);
}
const read = (address, abi, functionName, args = []) =>
  pub.readContract({ address, abi, functionName, args });
async function fundNative(who) {
  const balance = await pub.getBalance({ address: accounts[who].address });
  if (balance >= parseEther("1")) return;
  const params = {
    account: accounts[0],
    to: accounts[who].address,
    value: parseEther("2"),
  };
  const gas = await pub.estimateGas(params);
  await confirm(
    await wallets[0].sendTransaction({
      ...params,
      gas: (gas * 150n) / 100n + 100000n,
      gasPrice: await pub.getGasPrice(),
    }),
    `Fund player ${who} STT`,
  );
}
try {
  assert.equal(await pub.getChainId(), 50312);
  console.log(
    "Deployer STT:",
    formatEther(await pub.getBalance({ address: accounts[0].address })),
  );
  if (!report.registry) {
    const data = encodeDeployData({
      abi: arenaArtifact.abi,
      bytecode: arenaArtifact.bytecode,
      args: [TOKEN, MODULE],
    });
    const gas = await pub.estimateGas({ account: accounts[0], data });
    console.log("Estimated deployment gas", String(gas));
    const r = await confirm(
      await wallets[0].deployContract({
        abi: arenaArtifact.abi,
        bytecode: arenaArtifact.bytecode,
        args: [TOKEN, MODULE],
        gas: (gas * 150n) / 100n + 100000n,
        gasPrice: await pub.getGasPrice(),
      }),
      "Deploy MarketRoyale",
    );
    report.registry = r.contractAddress;
    save();
    fs.writeFileSync(
      new URL("../deployments/shannon.json", import.meta.url),
      JSON.stringify(
        {
          chainId: 50312,
          address: r.contractAddress,
          transactionHash: r.transactionHash,
          block: String(r.blockNumber),
          collateral: TOKEN,
          module: MODULE,
          compiler: arenaArtifact.compiler,
        },
        null,
        2,
      ) + "\n",
    );
    const env = new URL("../.env.local", import.meta.url);
    let content = fs.existsSync(env) ? fs.readFileSync(env, "utf8") : "";
    content = content.replace(/^NEXT_PUBLIC_ROYALE_ADDRESS=.*\n?/m, "");
    fs.writeFileSync(
      env,
      content + `NEXT_PUBLIC_ROYALE_ADDRESS=${r.contractAddress}\n`,
    );
  }
  const arena = report.registry;
  if (report.status === "complete") {
    console.log("Already complete:", arena, "match", report.tournamentId);
    process.exit(0);
  }
  await fundNative(1);
  await fundNative(2);
  if (
    (await read(TOKEN, tokenAbi, "balanceOf", [accounts[0].address])) <
    50_000_000n
  )
    await tx(0, TOKEN, tokenAbi, "faucet", [100_000_000n], "Faucet 100 tUSDC");
  for (const i of [1, 2])
    if (
      (await read(TOKEN, tokenAbi, "balanceOf", [accounts[i].address])) <
      12_000_000n
    )
      await tx(
        0,
        TOKEN,
        tokenAbi,
        "transfer",
        [accounts[i].address, 15_000_000n],
        `Fund player ${i} tUSDC`,
      );
  if (!report.market) {
    for (;;) {
      const r = await fetch("http://127.0.0.1:3000/api/testnet/markets");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      const m = d.markets.find(
        (m) =>
          m.asset === "BTC" &&
          m.interval === 300 &&
          m.expiry > d.timestamp + 210 &&
          m.status === 1,
      );
      if (m) {
        report.market = m;
        save();
        break;
      }
      console.log("Waiting for a fresh 5-minute BTC window…");
      await sleep(15000);
    }
  }
  const m = report.market;
  const maker = (kind, price) =>
    tx(
      0,
      m.pool,
      binaryPoolWriteAbi,
      "placeBinaryOrder",
      [
        kind,
        price,
        20_000_000n,
        BigInt(m.expiry) * 1_000_000_000n,
        3,
        0,
        zeroAddress,
        0n,
        0n,
      ],
      kind === 1 ? "Post real UP liquidity" : "Post real DOWN liquidity",
    );
  if (!report.minted) {
    await tx(
      0,
      TOKEN,
      tokenAbi,
      "approve",
      [m.pool, 20_000_000n],
      "Approve mint",
    );
    await tx(
      0,
      m.pool,
      binaryPoolWriteAbi,
      "mintSet",
      [accounts[0].address, accounts[0].address, 20_000_000n],
      "Mint 20 real outcome pairs",
    );
    report.minted = true;
    save();
  }
  if (!report.makerOrders) {
    await tx(
      0,
      m.outcomeToken,
      outcomeAbi,
      "setOperator",
      [m.pool, true],
      "Approve maker outcome escrow",
    );
    report.makerOrders = [];
    save();
    for (const [kind, price] of [
      [1, 550000n],
      [3, 450000n],
    ]) {
      const receipt = await maker(kind, price);
      for (const l of receipt.logs) {
        try {
          const e = decodeEventLog({
            abi: orderBookEventsAbi,
            data: l.data,
            topics: l.topics,
          });
          if (e.eventName === "OrderRested")
            report.makerOrders.push(String(e.args.orderId));
        } catch {}
      }
      save();
    }
    await tx(
      0,
      m.outcomeToken,
      outcomeAbi,
      "setOperator",
      [m.pool, false],
      "Revoke maker outcome operator",
    );
  }
  if (!report.tournamentId) {
    const now = Number((await pub.getBlock()).timestamp);
    assert(
      m.expiry > now + 165,
      "Market is too close to expiry. Reset the journal market after cleaning maker orders.",
    );
    const receipt = await tx(
      0,
      arena,
      arenaArtifact.abi,
      "create",
      [m.id, BigInt(now + 40), 2, 1],
      "Create two-player royale",
    );
    for (const l of receipt.logs) {
      try {
        const e = decodeEventLog({
          abi: arenaArtifact.abi,
          data: l.data,
          topics: l.topics,
        });
        if (e.eventName === "Created") report.tournamentId = Number(e.args.id);
      } catch {}
    }
    save();
  }
  const id = BigInt(report.tournamentId);
  for (const i of [1, 2]) {
    const players = await read(arena, arenaArtifact.abi, "getPlayers", [id]);
    if (
      players.some(
        (p) => p.wallet.toLowerCase() === accounts[i].address.toLowerCase(),
      )
    )
      continue;
    await tx(
      i,
      TOKEN,
      tokenAbi,
      "approve",
      [arena, 12_000_000n],
      `Player ${i} approves entry`,
    );
    await tx(
      i,
      arena,
      arenaArtifact.abi,
      "join",
      [id],
      `Player ${i} joins with 12 tUSDC`,
    );
  }
  let t = await read(arena, arenaArtifact.abi, "getTournament", [id]);
  while (
    t.phase === 0 &&
    BigInt(Math.floor(Date.now() / 1000)) <= t.joinDeadline
  ) {
    console.log("Waiting for enrollment close…");
    await sleep(10000);
    t = await read(arena, arenaArtifact.abi, "getTournament", [id]);
  }
  if (t.phase === 0)
    await tx(0, arena, arenaArtifact.abi, "start", [id], "Start real royale");
  const players = await read(arena, arenaArtifact.abi, "getPlayers", [id]);
  report.players = players.map((p) => ({ wallet: p.wallet, vault: p.vault }));
  save();
  for (const [i, kind, price] of [
    [1, 0, 550000n],
    [2, 2, 450000n],
  ]) {
    const p = players.find(
      (p) => p.wallet.toLowerCase() === accounts[i].address.toLowerCase(),
    );
    if ((await read(p.vault, vaultArtifact.abi, "actions")) === 0) {
      const r = await tx(
        i,
        p.vault,
        vaultArtifact.abi,
        "trade",
        [kind, price, 2_000_000n],
        `Player ${i} buys ${kind === 0 ? "UP" : "DOWN"}`,
      );
      const fills = [];
      for (const l of r.logs) {
        try {
          const e = decodeEventLog({
            abi: vaultArtifact.abi,
            data: l.data,
            topics: l.topics,
          });
          if (e.eventName === "Trade")
            fills.push({
              shares: String(e.args.shares),
              cashDelta: String(e.args.cashDelta),
              cashAfter: String(e.args.cashAfter),
            });
        } catch {}
      }
      assert(fills.length > 0, "No actual fill");
      report[`player${i}Fill`] = fills[0];
      save();
    }
  }
  // Return unfilled maker inventory promptly; tournament shares remain until the real oracle settles.
  if (!report.makerCancelled) {
    for (const order of report.makerOrders)
      await tx(
        0,
        m.pool,
        binaryPoolWriteAbi,
        "cancelOrder",
        [BigInt(order)],
        "Cancel remaining maker inventory",
      );
    report.makerCancelled = true;
    save();
  }
  const statusAbi = parseAbi([
    "function isResolved() view returns(bool)",
    "function isVoided() view returns(bool)",
    "function payoutNumerators() view returns(uint256[])",
  ]);
  const stopAt = m.expiry + 1800;
  while (
    !(await read(m.market, statusAbi, "isResolved")) &&
    !(await read(m.market, statusAbi, "isVoided"))
  ) {
    const now = Math.floor(Date.now() / 1000);
    if (now > stopAt)
      throw new Error(
        "Oracle still pending 30 minutes after expiry; funds remain recoverable on-chain. Resume this script later.",
      );
    console.log(
      `Waiting for actual oracle settlement (${Math.max(0, m.expiry - now)}s until expiry)…`,
    );
    if (now > m.expiry + 10) {
      try {
        await pub.simulateContract({
          account: accounts[0],
          address: MODULE,
          abi: binaryModuleWriteAbi,
          functionName: "pokeOracle",
          args: [BigInt(m.questionId)],
        });
        await tx(
          0,
          MODULE,
          binaryModuleWriteAbi,
          "pokeOracle",
          [BigInt(m.questionId)],
          "Sync actual oracle answer",
        );
      } catch (e) {
        console.log("Oracle has not answered yet.");
      }
    }
    await sleep(15000);
  }
  t = await read(arena, arenaArtifact.abi, "getTournament", [id]);
  if (t.phase === 1)
    await tx(
      0,
      arena,
      arenaArtifact.abi,
      "settleBatch",
      [id],
      "Settle tournament from real oracle",
    );
  const final = await read(arena, arenaArtifact.abi, "getPlayers", [id]);
  assert(final.some((p) => p.rank === 1) && final.some((p) => p.rank === 2));
  report.final = final.map((p) => ({
    wallet: p.wallet,
    vault: p.vault,
    rank: p.rank,
    prize: String(p.prize),
  }));
  report.payoutNumerators = (
    await read(m.market, statusAbi, "payoutNumerators")
  ).map(String);
  save();
  for (const i of [1, 2]) {
    const p = final.find(
      (p) => p.wallet.toLowerCase() === accounts[i].address.toLowerCase(),
    );
    if (!(await read(p.vault, vaultArtifact.abi, "withdrawn")))
      await tx(
        i,
        p.vault,
        vaultArtifact.abi,
        "withdraw",
        [],
        `Player ${i} withdraws settled bankroll`,
      );
    if (!p.prizeClaimed)
      await tx(
        i,
        arena,
        arenaArtifact.abi,
        "claimPrize",
        [id],
        `Player ${i} claims prize`,
      );
  }
  const payouts = await read(m.market, statusAbi, "payoutNumerators");
  await tx(
    0,
    m.outcomeToken,
    outcomeAbi,
    "setOperator",
    [MODULE, true],
    "Approve remaining maker redemption",
  );
  for (const i of [0, 1])
    if (payouts[i] > 0n) {
      const amount = await read(m.outcomeToken, outcomeAbi, "balanceOf", [
        accounts[0].address,
        BigInt(i === 0 ? m.yesId : m.noId),
      ]);
      if (amount > 0n)
        await tx(
          0,
          MODULE,
          binaryModuleWriteAbi,
          "redeem",
          [0, zeroHash, m.id, i, amount],
          "Redeem remaining maker inventory",
        );
    }
  await tx(
    0,
    m.outcomeToken,
    outcomeAbi,
    "setOperator",
    [MODULE, false],
    "Revoke maker redemption operator",
  );
  assert.equal(
    await read(TOKEN, tokenAbi, "balanceOf", [arena]),
    0n,
    "Prize pool must be fully paid",
  );
  report.finalBalances = await Promise.all(
    accounts.map(async (a) => ({
      wallet: a.address,
      tUSDC: String(await read(TOKEN, tokenAbi, "balanceOf", [a.address])),
      STT: formatEther(await pub.getBalance({ address: a.address })),
    })),
  );
  report.status = "complete";
  report.completedAt = new Date().toISOString();
  save();
  console.log("REAL TESTNET END-TO-END COMPLETE", arena, "royale", String(id));
} catch (e) {
  report.lastError = e.shortMessage ?? e.message;
  save();
  console.error(report.lastError);
  process.exitCode = 1;
}
