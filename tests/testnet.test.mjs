import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ganache from "ganache";
import { createPublicClient, createWalletClient, custom, toHex } from "viem";
import { somniaTestnet } from "viem/chains";
import { compile } from "../scripts/compile-contracts.mjs";
const compiled = compile({
  "Mocks.sol": {
    content: fs.readFileSync(
      new URL("../contracts/Mocks.sol", import.meta.url),
      "utf8",
    ),
  },
});
const artifact = (name) =>
  compiled[
    name.startsWith("Mock")
      ? "Mocks.sol"
      : name === "LiquiditySponsor"
        ? "LiquiditySponsor.sol"
        : name === "MarketRoyaleProgression"
          ? "MarketRoyaleProgression.sol"
          : "MarketRoyale.sol"
  ][name];

test("real transaction lifecycle: isolated bankrolls, constrained trades, cuts, payouts, refunds and timeout recovery", async () => {
  const provider = ganache.provider({
    chain: { chainId: 50312, hardfork: "shanghai" },
    wallet: { totalAccounts: 66 },
    logging: { quiet: true },
  });
  const pub = createPublicClient({
    chain: somniaTestnet,
    transport: custom(provider),
  });
  const accounts = await provider.request({
    method: "eth_accounts",
    params: [],
  });
  const wallets = accounts.map((account) =>
    createWalletClient({
      account,
      chain: somniaTestnet,
      transport: custom(provider),
    }),
  );
  const read = (name, address, fn, args = []) =>
    pub.readContract({
      address,
      abi: artifact(name).abi,
      functionName: fn,
      args,
    });
  const send = async (name, address, fn, args = [], who = 0) => {
    const { request } = await pub.simulateContract({
      address,
      abi: artifact(name).abi,
      functionName: fn,
      args,
      account: accounts[who],
    });
    const hash = await wallets[who].writeContract({
      ...request,
      gas: 12_000_000n,
    });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
    return receipt;
  };
  const deploy = async (name, args = []) => {
    const c = artifact(name);
    const hash = await wallets[0].deployContract({
      abi: c.abi,
      bytecode: `0x${c.evm.bytecode.object}`,
      args,
      gas: 20_000_000n,
    });
    const r = await pub.waitForTransactionReceipt({ hash });
    assert.equal(r.status, "success");
    return r.contractAddress;
  };
  const now = async () =>
    Number((await pub.getBlock({ blockTag: "latest" })).timestamp);
  const advance = async (seconds) => {
    await provider.request({ method: "evm_increaseTime", params: [seconds] });
    await provider.request({ method: "evm_mine", params: [] });
  };
  try {
    const token = await deploy("MockToken"),
      outcome = await deploy("MockOutcome"),
      module = await deploy("MockModule", [token, outcome]);
    const arena = await deploy("MarketRoyale", [
      token,
      module,
      module,
      toHex(0, { size: 32 }),
    ]);
    await send("MockToken", token, "faucet", [1_000_000_000n]);
    await send("MockToken", token, "transfer", [module, 500_000_000n]);
    const market = async (id, duration = 600) => {
      const start = await now(),
        expiry = start + duration,
        yes = BigInt(id) * 256n,
        m = await deploy("MockMarket", [outcome]),
        pool = await deploy("MockPool", [token, outcome, BigInt(expiry), yes]);
      await send("MockToken", token, "transfer", [pool, 10_000_000n]);
      await send("MockModule", module, "add", [
        toHex(id, { size: 32 }),
        m,
        pool,
        yes,
        BigInt(start),
        BigInt(expiry),
      ]);
      return { id: toHex(id, { size: 32 }), m, pool, yes, start, expiry };
    };
    let m = await market(1);
    const deadline = BigInt((await now()) + 40);
    await send("MarketRoyale", arena, "create", [
      m.id,
      deadline,
      4,
      2,
      2_000_000n,
      10_000_000n,
    ]);
    for (let i = 1; i <= 4; i++) {
      await send("MockToken", token, "faucet", [100_000_000n], i);
      await send("MockToken", token, "approve", [arena, 12_000_000n], i);
      await send("MarketRoyale", arena, "join", [1n], i);
    }
    let ps = await read("MarketRoyale", arena, "getPlayers", [1n]);
    assert.equal(ps.length, 4);
    assert.equal(
      await read("MockToken", token, "balanceOf", [arena]),
      8_000_000n,
    );
    await assert.rejects(send("MarketRoyale", arena, "join", [1n], 1));
    await assert.rejects(
      send("TraderVault", ps[0].vault, "trade", [0, 500000n, 1000000n], 1),
    );
    await advance(45);
    await send("MarketRoyale", arena, "start", [1n]);
    await assert.rejects(
      send("TraderVault", ps[0].vault, "trade", [0, 500000n, 1000000n], 2),
    );
    await send("MockToken", token, "transfer", [ps[0].vault, 100_000_000n]);
    await send("MockOutcome", outcome, "mint", [
      ps[0].vault,
      m.yes,
      100_000_000n,
    ]);
    assert.equal(
      await read("TraderVault", ps[0].vault, "cash"),
      10_000_000n,
      "donations do not affect rank",
    );
    await assert.rejects(
      send("TraderVault", ps[0].vault, "trade", [1, 500000n, 1000000n], 1),
      "donated shares cannot be sold",
    );
    await send("MockPool", m.pool, "setLiquidity", [false]);
    await assert.rejects(
      send("TraderVault", ps[0].vault, "trade", [0, 500000n, 2000000n], 1),
    );
    assert.equal(
      await read("TraderVault", ps[0].vault, "actions"),
      0,
      "empty IOC does not consume an action",
    );
    await send("MockPool", m.pool, "setLiquidity", [true]);
    await send("TraderVault", ps[0].vault, "trade", [0, 500000n, 6000000n], 1);
    await send("TraderVault", ps[1].vault, "trade", [0, 500000n, 2000000n], 2);
    await send("TraderVault", ps[2].vault, "trade", [2, 500000n, 4000000n], 3);
    await send("TraderVault", ps[3].vault, "trade", [2, 500000n, 6000000n], 4);
    await send("TraderVault", ps[0].vault, "trade", [1, 500000n, 1000000n], 1);
    await send("TraderVault", ps[0].vault, "trade", [0, 500000n, 1000000n], 1);
    await send("TraderVault", ps[0].vault, "trade", [1, 500000n, 1000000n], 1);
    await send("TraderVault", ps[0].vault, "trade", [0, 500000n, 1000000n], 1);
    assert.equal(
      await read("TraderVault", ps[0].vault, "actions"),
      5,
      "filled trading is unlimited until market close",
    );
    assert.equal(
      await read("MockToken", token, "allowance", [ps[0].vault, m.pool]),
      0n,
      "approvals reset",
    );
    await assert.rejects(send("TraderVault", ps[0].vault, "withdraw", [], 1));
    await advance(600);
    await assert.rejects(
      send("MarketRoyale", arena, "settleBatch", [1n]),
      "oracle pending",
    );
    await send("MockMarket", m.m, "resolve", [0]);
    await send("MockModule", module, "finalizeMarket", [m.id]); // external keeper already finalized
    await send("MarketRoyale", arena, "settleBatch", [1n]);
    ps = await read("MarketRoyale", arena, "getPlayers", [1n]);
    assert.deepEqual(
      ps.map((p) => p.active),
      [true, true, false, false],
    );
    assert.equal(await read("TraderVault", ps[0].vault, "cash"), 13_000_000n);
    assert.equal(
      await read("TraderVault", ps[2].vault, "cash"),
      8_000_000n,
      "losing side is valued at zero",
    );
    await send("TraderVault", ps[2].vault, "withdraw", [], 3);
    await assert.rejects(send("TraderVault", ps[2].vault, "withdraw", [], 3));
    const second = await market(2);
    await send("MarketRoyale", arena, "nextRound", [1n, second.id]);
    await send("TraderVault", ps[1].vault, "trade", [0, 500000n, 6000000n], 2);
    await advance(605);
    await send("MockMarket", second.m, "resolve", [0]);
    await send("MarketRoyale", arena, "settleBatch", [1n]);
    ps = await read("MarketRoyale", arena, "getPlayers", [1n]);
    assert.deepEqual(
      ps.map((p) => p.rank),
      [2, 1, 3, 4],
    );
    assert.deepEqual(
      ps.map((p) => p.prize),
      [1_875_000n, 5_000_000n, 1_125_000n, 0n],
    );
    for (let i = 1; i <= 4; i++)
      await send("MarketRoyale", arena, "claimPrize", [1n], i);
    assert.equal(
      await read("MockToken", token, "balanceOf", [arena]),
      0n,
      "entire prize pool conserved",
    );
    await assert.rejects(send("MarketRoyale", arena, "claimPrize", [1n], 2));
    for (const i of [1, 2, 4])
      await send("TraderVault", ps[i - 1].vault, "withdraw", [], i);
    // Permissionless result recording mints soulbound achievements and updates
    // rating/season progression. Sponsor protection is separate from prizes.
    const firstSeasonEnds = BigInt((await now()) + 90 * 24 * 60 * 60);
    const progression = await deploy("MarketRoyaleProgression", [
      arena,
      token,
      accounts[0],
      firstSeasonEnds,
    ]);
    await send("MockToken", token, "approve", [progression, 20_000_000n]);
    await send("MarketRoyaleProgression", progression, "fund", [20_000_000n]);
    await send(
      "MarketRoyaleProgression",
      progression,
      "setProtectionVerified",
      [[accounts[4]], true],
    );
    const preview = await read(
      "MarketRoyaleProgression",
      progression,
      "preview",
      [1n, accounts[4]],
    );
    assert.equal(preview[0], true);
    assert.equal(preview[1], 4);
    assert.equal(preview[7], true);
    assert.equal(preview[8], 1_000_000n);
    for (let i = 1; i <= 4; i++)
      await send(
        "MarketRoyaleProgression",
        progression,
        "recordResult",
        [1n, accounts[i]],
        65,
      );
    await assert.rejects(
      send(
        "MarketRoyaleProgression",
        progression,
        "recordResult",
        [1n, accounts[2]],
        65,
      ),
      "a result cannot increase rating or XP twice",
    );
    const championProfile = await read(
      "MarketRoyaleProgression",
      progression,
      "profileOf",
      [accounts[2]],
    );
    assert.equal(championProfile.completed, 1);
    assert.equal(championProfile.wins, 1);
    assert.equal(championProfile.rating, 1030);
    assert.equal(
      await read("MarketRoyaleProgression", progression, "balanceOf", [
        accounts[2],
        5n,
      ]),
      1n,
      "champion badge minted",
    );
    assert.equal(
      await read("MarketRoyaleProgression", progression, "balanceOf", [
        accounts[2],
        7n,
      ]),
      1n,
      "profitable-finish badge minted",
    );
    await assert.rejects(
      send(
        "MarketRoyaleProgression",
        progression,
        "safeTransferFrom",
        [accounts[2], accounts[3], 5n, 1n, "0x"],
        2,
      ),
      "achievement badges are soulbound",
    );
    await assert.rejects(
      send("MarketRoyaleProgression", progression, "claimProtection", [1n], 1),
      "unverified wallets cannot use sponsor protection",
    );
    const protectedBefore = await read("MockToken", token, "balanceOf", [
      accounts[4],
    ]);
    await send(
      "MarketRoyaleProgression",
      progression,
      "claimProtection",
      [1n],
      4,
    );
    assert.equal(
      await read("MockToken", token, "balanceOf", [accounts[4]]),
      protectedBefore + 1_000_000n,
      "verified losing player receives sponsor-funded protection",
    );
    await assert.rejects(
      send("MarketRoyaleProgression", progression, "claimProtection", [1n], 4),
      "protection is paid once per match",
    );
    // Too few participants: entry and the full trading bankroll return.
    m = await market(3);
    await send("MarketRoyale", arena, "create", [
      m.id,
      BigInt((await now()) + 40),
      2,
      1,
      2_000_000n,
      10_000_000n,
    ]);
    await send("MockToken", token, "approve", [arena, 12_000_000n], 1);
    await send("MarketRoyale", arena, "join", [2n], 1);
    const lone = (await read("MarketRoyale", arena, "getPlayers", [2n]))[0];
    await advance(45);
    await send("MarketRoyale", arena, "cancel", [2n]);
    await send("TraderVault", lone.vault, "withdraw", [], 1);
    await send("MarketRoyale", arena, "claimPrize", [2n], 1);
    // Oracle outage: cash plus original outcome tokens can be recovered after fifteen minutes.
    m = await market(4);
    await send("MarketRoyale", arena, "create", [
      m.id,
      BigInt((await now()) + 40),
      2,
      1,
      2_000_000n,
      10_000_000n,
    ]);
    for (const i of [1, 2]) {
      await send("MockToken", token, "approve", [arena, 12_000_000n], i);
      await send("MarketRoyale", arena, "join", [3n], i);
    }
    await advance(45);
    await send("MarketRoyale", arena, "start", [3n]);
    ps = await read("MarketRoyale", arena, "getPlayers", [3n]);
    await send("TraderVault", ps[0].vault, "trade", [0, 500000n, 2000000n], 1);
    await advance(1505);
    await send("MarketRoyale", arena, "cancel", [3n]);
    await send("TraderVault", ps[0].vault, "withdraw", [], 1);
    assert.equal(
      await read("MockOutcome", outcome, "balanceOf", [accounts[1], m.yes]),
      2_000_000n,
    );
    await send("MarketRoyale", arena, "claimPrize", [3n], 1);
    // A void refunds both sides by the payout vector, preserving fair tied scores.
    m = await market(5);
    await send("MarketRoyale", arena, "create", [
      m.id,
      BigInt((await now()) + 40),
      2,
      1,
      2_000_000n,
      10_000_000n,
    ]);
    for (const i of [1, 2]) {
      await send("MockToken", token, "approve", [arena, 12_000_000n], i);
      await send("MarketRoyale", arena, "join", [4n], i);
    }
    await advance(45);
    await send("MarketRoyale", arena, "start", [4n]);
    ps = await read("MarketRoyale", arena, "getPlayers", [4n]);
    await send("TraderVault", ps[0].vault, "trade", [0, 500000n, 2000000n], 1);
    await send("TraderVault", ps[1].vault, "trade", [2, 500000n, 2000000n], 2);
    await advance(600);
    await send("MockMarket", m.m, "makeVoid");
    await send("MarketRoyale", arena, "settleBatch", [4n]);
    assert.equal(await read("TraderVault", ps[0].vault, "cash"), 10_000_000n);
    assert.equal(await read("TraderVault", ps[1].vault, "cash"), 10_000_000n);
    const voidPlayers = await read("MarketRoyale", arena, "getPlayers", [4n]);
    assert.equal(
      (await read("MarketRoyale", arena, "getTournament", [4n])).phase,
      4,
      "voided event refunds entries",
    );
    assert.ok(
      voidPlayers.every((player) => player.rank === 0),
      "a void has no winner or progression rank",
    );
    // Resolved ties are deterministic: earlier on-chain entry wins the tie.
    m = await market(11);
    await send("MarketRoyale", arena, "create", [
      m.id,
      BigInt((await now()) + 40),
      2,
      1,
      2_000_000n,
      10_000_000n,
    ]);
    const tiedId = await read("MarketRoyale", arena, "tournamentCount");
    for (const i of [1, 2]) {
      await send("MockToken", token, "approve", [arena, 12_000_000n], i);
      await send("MarketRoyale", arena, "join", [tiedId], i);
    }
    await advance(45);
    await send("MarketRoyale", arena, "start", [tiedId]);
    const tiedPlayers = await read("MarketRoyale", arena, "getPlayers", [
      tiedId,
    ]);
    for (const i of [1, 2])
      await send(
        "TraderVault",
        tiedPlayers[i - 1].vault,
        "trade",
        [0, 500000n, 2_000_000n],
        i,
      );
    await advance(600);
    await send("MockMarket", m.m, "resolve", [0]);
    await send("MarketRoyale", arena, "settleBatch", [tiedId]);
    assert.deepEqual(
      (await read("MarketRoyale", arena, "getPlayers", [tiedId])).map(
        (player) => player.rank,
      ),
      [1, 2],
      "an exact final-cash tie favors the earlier entrant",
    );
    await send("MarketRoyale", arena, "payoutBatch", [tiedId, 0n, 2n]);
    // Player-hosted events atomically reserve and fund the creator's first seat.
    m = await market(10);
    await send("MockToken", token, "approve", [arena, 12_000_000n]);
    await send("MarketRoyale", arena, "createAndJoin", [
      m.id,
      BigInt((await now()) + 40),
      4,
      1,
      2_000_000n,
      10_000_000n,
    ]);
    let hostedId = await read("MarketRoyale", arena, "tournamentCount");
    let hosted = await read("MarketRoyale", arena, "getPlayers", [hostedId]);
    assert.equal(hosted.length, 1);
    assert.equal(hosted[0].wallet.toLowerCase(), accounts[0]);
    assert.equal(
      (await read("MarketRoyale", arena, "getTournament", [hostedId]))
        .prizePool,
      2_000_000n,
    );
    await send("MarketRoyale", arena, "cancel", [hostedId]);
    await send("MarketRoyale", arena, "payoutBatch", [hostedId, 0n, 8n]);
    await send("MockToken", token, "approve", [arena, 125_000_000n]);
    await send("MarketRoyale", arena, "scheduleAndJoin", [
      BigInt((await now()) + 900),
      4,
      1,
      2,
      300n,
      25_000_000n,
      100_000_000n,
    ]);
    hostedId = await read("MarketRoyale", arena, "tournamentCount");
    hosted = await read("MarketRoyale", arena, "getPlayers", [hostedId]);
    assert.equal(hosted.length, 1, "host may fund before public entry opens");
    assert.equal(hosted[0].wallet.toLowerCase(), accounts[0]);
    const premiumTerms = await read("MarketRoyale", arena, "getTournament", [
      hostedId,
    ]);
    assert.equal(premiumTerms.entryFee, 25_000_000n);
    assert.equal(premiumTerms.bankroll, 100_000_000n);
    await send("MarketRoyale", arena, "cancel", [hostedId]);
    await send("MarketRoyale", arena, "payoutBatch", [hostedId, 0n, 8n]);
    // V2 scheduled events: no turnout, early exit, quorum, liquidity and no-trade recovery.
    const scheduled = async (minimum = 2, capacity = 4, delay = 65) => {
      await send("MarketRoyale", arena, "schedule", [
        BigInt((await now()) + delay),
        capacity,
        1,
        minimum,
        300n,
        2_000_000n,
        10_000_000n,
      ]);
      return await read("MarketRoyale", arena, "tournamentCount");
    };
    const enter = async (id, i) => {
      await send("MockToken", token, "faucet", [20_000_000n], i);
      await send("MockToken", token, "approve", [arena, 12_000_000n], i);
      await send("MarketRoyale", arena, "join", [id], i);
    };
    let id = await scheduled();
    await advance(66);
    await send("MarketRoyale", arena, "cancel", [id], 8);
    assert.equal(
      (await read("MarketRoyale", arena, "getTournament", [id])).cancelReason,
      1,
    );
    id = await scheduled(2, 2);
    await enter(id, 1);
    await enter(id, 2);
    await assert.rejects(enter(id, 3), "full event refuses a third entrant");
    const oldVault = (await read("MarketRoyale", arena, "getPlayers", [id]))[0]
      .vault;
    const beforeLeave = await read("MockToken", token, "balanceOf", [
      accounts[1],
    ]);
    await send("MarketRoyale", arena, "leave", [id], 1);
    assert.equal(
      await read("MockToken", token, "balanceOf", [accounts[1]]),
      beforeLeave + 12_000_000n,
    );
    assert.equal(await read("TraderVault", oldVault, "withdrawn"), true);
    await enter(id, 1);
    assert.deepEqual(
      (await read("MarketRoyale", arena, "getPlayers", [id])).map((p) =>
        p.wallet.toLowerCase(),
      ),
      [accounts[2], accounts[1]],
    );
    await assert.rejects(
      send("MarketRoyale", arena, "startScheduled", [
        id,
        toHex(0, { size: 32 }),
      ]),
      "cannot start early",
    );
    await advance(66);
    await assert.rejects(
      send("MarketRoyale", arena, "leave", [id], 1),
      "entry deadline fixes roster",
    );
    m = await market(6, 300);
    await send("MockPool", m.pool, "setLiquidity", [false]);
    await assert.rejects(
      send("MarketRoyale", arena, "startScheduled", [id, m.id]),
      "empty order book blocks start",
    );
    await send("MockPool", m.pool, "setLiquidity", [true]);
    await send("MarketRoyale", arena, "startScheduled", [id, m.id], 8);
    await advance(301);
    await send("MarketRoyale", arena, "settleBatch", [id], 8);
    assert.equal(
      (await read("MarketRoyale", arena, "getTournament", [id])).cancelReason,
      3,
      "no trades refunds without waiting for an oracle",
    );
    const outsiderBalance = await read("MockToken", token, "balanceOf", [
      accounts[8],
    ]);
    await send("MarketRoyale", arena, "payoutBatch", [id, 0n, 8n], 8);
    ps = await read("MarketRoyale", arena, "getPlayers", [id]);
    assert.ok(ps.every((p) => p.prizeClaimed));
    for (const p of ps)
      assert.equal(await read("TraderVault", p.vault, "withdrawn"), true);
    assert.equal(
      await read("MockToken", token, "balanceOf", [accounts[8]]),
      outsiderBalance,
      "permissionless payout cannot redirect funds",
    );
    await send("MarketRoyale", arena, "payoutBatch", [id, 0n, 8n], 8);
    await assert.rejects(
      send("MarketRoyale", arena, "payoutBatch", [id, 0n, 9n], 8),
      "bounded payout batch",
    );
    id = await scheduled(4, 8);
    await enter(id, 1);
    await enter(id, 2);
    await advance(66);
    m = await market(7, 300);
    await assert.rejects(
      send("MarketRoyale", arena, "startScheduled", [id, m.id]),
      "host minimum is enforced even with two entrants",
    );
    await send("MarketRoyale", arena, "cancel", [id], 8);
    await send("MarketRoyale", arena, "payoutBatch", [id, 0n, 8n], 8);
    id = await scheduled(2, 4, 900);
    await assert.rejects(
      enter(id, 1),
      "cannot lock deposits more than ten minutes before start",
    );
    await advance(301);
    await enter(id, 1);
    await advance(600);
    await send("MarketRoyale", arena, "cancel", [id], 8);
    await send("MarketRoyale", arena, "payoutBatch", [id, 0n, 8n], 8);
    id = await scheduled();
    await enter(id, 1);
    await enter(id, 2);
    await advance(190);
    await send("MarketRoyale", arena, "cancel", [id], 8);
    assert.equal(
      (await read("MarketRoyale", arena, "getTournament", [id])).cancelReason,
      2,
      "missed start unlocks refunds",
    );
    await send("MarketRoyale", arena, "payoutBatch", [id, 0n, 8n], 8);
    // Maximum advertised capacity: bounded settlement and payout batches conserve all entries.
    id = await scheduled(2, 64, 600);
    for (let i = 1; i <= 64; i++) await enter(id, i);
    await advance(601);
    m = await market(8, 300);
    const startReceipt = await send("MarketRoyale", arena, "startScheduled", [
      id,
      m.id,
    ]);
    ps = await read("MarketRoyale", arena, "getPlayers", [id]);
    await send("TraderVault", ps[0].vault, "trade", [0, 500000n, 1000000n], 1);
    await advance(301);
    await send("MockMarket", m.m, "resolve", [0]);
    let maxSettleGas = 0n;
    for (let cursor = 0; cursor < 64; cursor += 4) {
      const receipt = await send("MarketRoyale", arena, "settleBatch", [id]);
      if (receipt.gasUsed > maxSettleGas) maxSettleGas = receipt.gasUsed;
    }
    ps = await read("MarketRoyale", arena, "getPlayers", [id]);
    assert.equal(
      (await read("MarketRoyale", arena, "getTournament", [id])).phase,
      3,
    );
    assert.equal(
      ps.reduce((sum, p) => sum + p.prize, 0n),
      128_000_000n,
    );
    assert.equal(
      new Set(ps.map((p) => p.rank)).size,
      64,
      "all 64 ranks are assigned",
    );
    for (let cursor = 0; cursor < 64; cursor += 8)
      await send(
        "MarketRoyale",
        arena,
        "payoutBatch",
        [id, BigInt(cursor), 8n],
        65,
      );
    ps = await read("MarketRoyale", arena, "getPlayers", [id]);
    assert.ok(ps.every((p) => p.prizeClaimed));
    for (const p of ps)
      assert.equal(await read("TraderVault", p.vault, "withdrawn"), true);
    console.log("64-player local EVM gas", {
      start: String(startReceipt.gasUsed),
      largestSettlementBatch: String(maxSettleGas),
    });
    // Treasury maker inventory is separate from player deposits and returns only to its treasury.
    const sponsor = await deploy("LiquiditySponsor", [
      token,
      module,
      accounts[0],
      module,
      toHex(0, { size: 32 }),
    ]);
    m = await market(9, 300);
    await send("MockToken", token, "approve", [sponsor, 20_000_000n]);
    await assert.rejects(
      send(
        "LiquiditySponsor",
        sponsor,
        "seed",
        [m.id, 20_000_000n, 450000n, 550000n],
        1,
      ),
      "only treasury may seed",
    );
    await assert.rejects(
      send("LiquiditySponsor", sponsor, "seed", [
        m.id,
        129_000_000n,
        450000n,
        550000n,
      ]),
      "inventory is capped",
    );
    await send("MockPool", m.pool, "setLiquidity", [false]);
    const treasuryBefore = await read("MockToken", token, "balanceOf", [
      accounts[0],
    ]);
    await assert.rejects(
      send("LiquiditySponsor", sponsor, "seed", [
        m.id,
        20_000_000n,
        450000n,
        550000n,
      ]),
      "failed maker order atomically restores treasury funds",
    );
    assert.equal(
      await read("MockToken", token, "balanceOf", [accounts[0]]),
      treasuryBefore,
    );
    await send("MockPool", m.pool, "setLiquidity", [true]);
    await send("LiquiditySponsor", sponsor, "seed", [
      m.id,
      20_000_000n,
      450000n,
      550000n,
    ]);
    assert.equal(
      await read("MockToken", token, "allowance", [sponsor, m.pool]),
      0n,
    );
    assert.equal(
      await read("MockOutcome", outcome, "operators", [sponsor, m.pool]),
      false,
    );
    await assert.rejects(
      send("LiquiditySponsor", sponsor, "seed", [
        m.id,
        20_000_000n,
        450000n,
        550000n,
      ]),
      "market cannot be seeded twice",
    );
    await assert.rejects(
      send("LiquiditySponsor", sponsor, "recover", [0n], 65),
      "live inventory cannot be recovered early",
    );
    await advance(301);
    await send("MockMarket", m.m, "resolve", [0]);
    await send("MockModule", module, "finalizeMarket", [m.id]);
    await send("LiquiditySponsor", sponsor, "recover", [0n], 65);
    assert.equal(
      await read("MockToken", token, "balanceOf", [accounts[0]]),
      treasuryBefore,
    );
    assert.equal(
      (await read("LiquiditySponsor", sponsor, "getSeed", [0n])).closed,
      true,
    );
    await assert.rejects(
      send("LiquiditySponsor", sponsor, "recover", [0n], 65),
      "inventory is recovered only once",
    );
    const passivePlayer = ps[10];
    assert.equal(
      await read("TraderVault", passivePlayer.vault, "lifetimeActions"),
      0n,
      "the passive entrant made no trade",
    );
    const passivePreview = await read(
      "MarketRoyaleProgression",
      progression,
      "preview",
      [id, passivePlayer.wallet],
    );
    assert.equal(passivePreview[0], true);
    assert.equal(passivePreview[3], 0n);
    assert.equal(
      passivePreview[7],
      false,
      "a no-trade finish records stats but cannot claim loss protection",
    );
    await send(
      "MarketRoyaleProgression",
      progression,
      "recordResult",
      [id, passivePlayer.wallet],
      65,
    );
    assert.equal(
      (
        await read(
          "MarketRoyaleProgression",
          progression,
          "profileOf",
          [passivePlayer.wallet],
        )
      ).completed,
      1,
      "every ranked finish can be recorded even when the player held cash",
    );
    // Keeper downtime must not create timestamps that belong to no season.
    const secondsUntilDelayedRollover =
      Number(firstSeasonEnds) - (await now()) + 3 * 24 * 60 * 60;
    await advance(secondsUntilDelayedRollover);
    const delayedRolloverAt = await now();
    await send("MarketRoyaleProgression", progression, "startNextSeason", [
      BigInt(delayedRolloverAt + 30 * 24 * 60 * 60),
    ]);
    assert.equal(
      await read("MarketRoyaleProgression", progression, "VERSION"),
      4n,
    );
    assert.equal(
      await read("MarketRoyaleProgression", progression, "seasonFor", [
        firstSeasonEnds,
      ]),
      1,
      "the prior season owns its final second",
    );
    assert.equal(
      await read("MarketRoyaleProgression", progression, "seasonFor", [
        firstSeasonEnds + 1n,
      ]),
      2,
      "the new season begins immediately after the prior season",
    );
    assert.equal(
      await read("MarketRoyaleProgression", progression, "seasonFor", [
        BigInt(delayedRolloverAt - 1),
      ]),
      2,
      "a delayed rollover leaves no unassigned timestamps",
    );
  } finally {
    await provider.disconnect();
  }
});
