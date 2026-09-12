import { shannonTransport } from "./transport";
import {
  createPublicClient,
  http,
  isAddress,
  type Address,
  type Hex,
  type Abi,
  parseAbiItem,
  zeroHash,
} from "viem";
import { somniaTestnet } from "viem/chains";
import {
  SomniaMarkets,
  SOMNIA_TESTNET_ADDRESSES,
  SOMNIA_TESTNET_PRICE_FEED,
} from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import {
  COLLATERAL,
  MODULE,
  CREATOR,
  VENUE,
  RPC,
  CHAIN_ID,
  moduleAbi,
  marketAbi,
  poolAbi,
  tokenAbi,
  type LiveMarket,
  type Tournament,
  type Player,
  type Snapshot,
} from "./config";
import arenaArtifact from "./MarketRoyale.json";
import vaultArtifact from "./TraderVault.json";
import legacyArtifact from "./legacy/MarketRoyale-v1.json";
import legacyV4Artifact from "./legacy/MarketRoyale-v4.json";
import legacyV4FactoryArtifact from "./legacy/VaultFactory-v4.json";
import factoryArtifact from "./VaultFactory.json";
const LEGACY_V3_ARENA: Address = "0x893a0e96b4ea20410f10856e2da2d0aee88a7439";
export const client = createPublicClient({
  chain: somniaTestnet,
  transport: shannonTransport(),
  batch: { multicall: false },
});
export const scopedClient = () =>
  createPublicClient({
    chain: somniaTestnet,
    transport: shannonTransport(true),
    batch: { multicall: false },
  });
type ShannonClient = ReturnType<typeof scopedClient>;
const dreamdexData = new SomniaMarkets({
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  chain: somniaShannon,
  wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
  addresses: SOMNIA_TESTNET_ADDRESSES,
  priceFeed: SOMNIA_TESTNET_PRICE_FEED,
});
const arenaAbi = arenaArtifact.abi as Abi;
const vaultAbi = vaultArtifact.abi as Abi;
const tradeEvent = parseAbiItem(
  "event Trade(uint8 kind,uint256 shares,int256 cashDelta,uint256 cashAfter)",
);
const serial = <T>(v: unknown): T =>
  JSON.parse(
    JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)),
  );
let marketCache:
  | {
      at: number;
      head: bigint;
      events: Map<
        string,
        { id: Hex; asset: string; question: string; expiry: number }
      >;
    }
  | undefined;

export type TradeActivity = {
  wallet: Address;
  vault: Address;
  kind: number;
  side: "UP" | "DOWN";
  direction: "BUY" | "SELL";
  shares: string;
  cashDelta: string;
  cashAfter: string;
  price: number;
  upPrice: number;
  time: number;
  block: string;
  logIndex: number;
  hash: Hex;
};

type TradeActivityCache = {
  fromBlock: bigint;
  lastBlock: bigint;
  events: TradeActivity[];
};

const tradeActivityCache = new Map<string, TradeActivityCache>();

async function discover(head: bigint) {
  if (marketCache && Date.now() - marketCache.at < 20_000) return;
  const now = Math.floor(Date.now() / 1000);
  const indexed = await dreamdexData.client.listLiveBinaryMarkets({
    creator: CREATOR,
    venueId: VENUE,
    limit: 24,
    nowSec: now,
  });
  const events = new Map<
    string,
    { id: Hex; asset: string; question: string; expiry: number }
  >();
  for (const market of indexed) {
    const start = Number(market.tradingStart),
      expiry = Number(market.expiry);
    if (
      market.collateral.toLowerCase() !== COLLATERAL.toLowerCase() ||
      market.creator?.toLowerCase() !== CREATOR.toLowerCase() ||
      market.venueId?.toLowerCase() !== VENUE.toLowerCase() ||
      start > now ||
      expiry <= now
    )
      continue;
    events.set(market.marketId, {
      id: market.marketId,
      asset: market.asset,
      question: market.question,
      expiry,
    });
  }
  marketCache = { events, head, at: Date.now() };
}
export async function head(rpcClient: ShannonClient = client) {
  const chain = await rpcClient.getChainId();
  if (chain !== CHAIN_ID)
    throw new Error("RPC is not Somnia Shannon. Writes are disabled.");
  const block = await rpcClient.getBlock();
  if (block.number === null) throw new Error("Latest block is unavailable.");
  if (Math.abs(Date.now() / 1000 - Number(block.timestamp)) > 90)
    throw new Error(
      "Shannon is returning stale blocks. Transactions are paused until the network catches up.",
    );
  return block;
}
export async function readMarket(
  id: Hex,
  metadata?: { asset: string; question: string },
  blockNumber?: bigint,
  rpcClient: ShannonClient = client,
): Promise<LiveMarket> {
  const m = await rpcClient.readContract({
    address: MODULE,
    abi: moduleAbi,
    functionName: "markets",
    args: [id],
    blockNumber,
  });
  if (
    m[3].toLowerCase() !== COLLATERAL.toLowerCase() ||
    m[7].toLowerCase() !== CREATOR.toLowerCase() ||
    m[5] !== VENUE
  )
    throw new Error("Market is outside the supported testnet venue.");
  const [status, outcomeToken, resolved, voided, payouts, poolExpiry] =
    await Promise.all([
      rpcClient.readContract({
        address: m[8],
        abi: marketAbi,
        functionName: "status",
        blockNumber,
      }),
      rpcClient.readContract({
        address: m[8],
        abi: marketAbi,
        functionName: "outcomeToken",
        blockNumber,
      }),
      rpcClient.readContract({
        address: m[8],
        abi: marketAbi,
        functionName: "isResolved",
        blockNumber,
      }),
      rpcClient.readContract({
        address: m[8],
        abi: marketAbi,
        functionName: "isVoided",
        blockNumber,
      }),
      rpcClient.readContract({
        address: m[8],
        abi: marketAbi,
        functionName: "payoutNumerators",
        blockNumber,
      }),
      rpcClient.readContract({
        address: m[9],
        abi: poolAbi,
        functionName: "marketExpiryNs",
        blockNumber,
      }),
    ]);
  const meta = metadata ?? marketCache?.events.get(id);
  const recycled = poolExpiry !== m[13] * 1_000_000_000n;
  let bids: LiveMarket["bids"] = [],
    asks: LiveMarket["asks"] = [],
    tick = "0",
    min = "0",
    lot = "0",
    bookError: string | undefined;
  if (!recycled && status === 1) {
    try {
      const [b, a, p] = await Promise.all([
        rpcClient.readContract({
          address: m[9],
          abi: poolAbi,
          functionName: "getBookLevels",
          args: [true, 10n],
          blockNumber,
        }),
        rpcClient.readContract({
          address: m[9],
          abi: poolAbi,
          functionName: "getBookLevels",
          args: [false, 10n],
          blockNumber,
        }),
        rpcClient.readContract({
          address: m[9],
          abi: poolAbi,
          functionName: "getOrderBookParameters",
          blockNumber,
        }),
      ]);
      bids = serial(b);
      asks = serial(a);
      tick = String(p.tickSize);
      lot = String(p.lotSize);
      min = String(p.minQuantity);
    } catch {
      bookError =
        "Order book unavailable. Trading is disabled until it recovers.";
    }
  }
  return {
    id,
    market: m[8],
    pool: m[9],
    creator: m[7],
    venue: m[5],
    asset: meta?.asset ?? "Event",
    question: meta?.question ?? "DreamDEX binary market",
    questionId: String(m[0]),
    start: Number(m[12]),
    expiry: Number(m[13]),
    interval: Number(m[13] - m[12]),
    yesId: String(m[10]),
    noId: String(m[11]),
    status,
    outcomeToken,
    resolved,
    voided,
    payouts: payouts.map(String),
    recycled,
    bids,
    asks,
    tick,
    lot,
    min,
    bookError,
  };
}
export async function markets() {
  const rpcClient = scopedClient();
  const block = await head(rpcClient);
  await discover(block.number);
  const live: LiveMarket[] = [];
  const entries = [...marketCache!.events.values()].filter(
    (e) => e.expiry > Number(block.timestamp),
  );
  // Read the module first; expired events need no book/status RPCs.
  for (let i = 0; i < entries.length; i += 6) {
    const batch = await Promise.all(
      entries.slice(i, i + 6).map(async (e) => {
        const rec = await rpcClient.readContract({
          address: MODULE,
          abi: moduleAbi,
          functionName: "markets",
          args: [e.id],
          blockNumber: block.number,
        });
        if (rec[13] <= block.timestamp) return null;
        return readMarket(e.id, e, block.number, rpcClient);
      }),
    );
    live.push(...batch.filter((m): m is LiveMarket => m !== null));
  }
  return {
    chainId: CHAIN_ID,
    block: String(block.number),
    timestamp: Number(block.timestamp),
    markets: live.sort((a, b) => a.expiry - b.expiry),
  };
}
export async function marketChart(
  pool: Address,
  asset: string,
  from: number,
  to: number,
) {
  const [probability, underlying] = await Promise.allSettled([
    dreamdexData.client.getCandles(pool, 60, { from, to, limit: 240 }),
    dreamdexData.client.fetchPriceCandles(asset, "M1", {
      from,
      to,
      limit: 240,
    }),
  ]);
  if (probability.status === "rejected" && underlying.status === "rejected")
    throw new Error("DreamDEX chart feeds are unavailable.");
  return {
    pool,
    asset,
    from,
    to,
    probability:
      probability.status === "fulfilled"
        ? probability.value.map((candle) => ({
            time: Number(candle.bucketStart),
            open: Number(candle.openPrice) / 1_000_000,
            high: Number(candle.high) / 1_000_000,
            low: Number(candle.low) / 1_000_000,
            close: Number(candle.closePrice) / 1_000_000,
            volume: Number(candle.baseVolume) / 1_000_000,
            trades: candle.tradeCount,
          }))
        : [],
    underlying:
      underlying.status === "fulfilled"
        ? underlying.value.map((candle) => ({
            time: candle.bucketStart,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            ema: candle.emaClose,
            updates: candle.count,
          }))
        : [],
    probabilityError:
      probability.status === "rejected"
        ? "Probability history is temporarily unavailable."
        : null,
    underlyingError:
      underlying.status === "rejected"
        ? `${asset} oracle history is temporarily unavailable.`
        : null,
  };
}

async function blockNearTimestamp(
  target: number,
  latest: Awaited<ReturnType<typeof client.getBlock>>,
  rpcClient: ShannonClient,
) {
  if (latest.number === null) throw new Error("Latest block is unavailable.");
  const latestNumber = latest.number;
  if (target >= Number(latest.timestamp)) return latestNumber;
  const sampleDistance = latestNumber > 2_000n ? 2_000n : latestNumber;
  const sample = await rpcClient.getBlock({
    blockNumber: latestNumber - sampleDistance,
  });
  const sampleSeconds = Math.max(
    1,
    Number(latest.timestamp - sample.timestamp),
  );
  const blocksPerSecond = Number(sampleDistance) / sampleSeconds;
  let guess =
    latestNumber -
    BigInt(Math.ceil((Number(latest.timestamp) - target) * blocksPerSecond));
  if (guess < 0n) guess = 0n;

  // Refine the estimate against the actual block timestamp. Shannon currently
  // advances several blocks each second, so a timestamp estimate avoids a
  // chain-wide log scan while remaining valid if its block cadence changes.
  for (let attempt = 0; attempt < 3; attempt++) {
    const block = await rpcClient.getBlock({ blockNumber: guess });
    const secondsAway = target - Number(block.timestamp);
    if (Math.abs(secondsAway) <= 2) break;
    const correction = BigInt(Math.round(secondsAway * blocksPerSecond));
    guess = correction < 0n && -correction > guess ? 0n : guess + correction;
    if (guess > latestNumber) guess = latestNumber;
  }
  return guess > 30n ? guess - 30n : 0n;
}

export async function tournamentTradeActivity(registry: Address, id: number) {
  const rpcClient = scopedClient();
  const [block, version] = await Promise.all([
    head(rpcClient),
    verifyRegistry(registry, rpcClient),
  ]);
  const selectedAbi = (
    version === 1
      ? legacyArtifact.abi
      : version === 4
        ? legacyV4Artifact.abi
        : arenaArtifact.abi
  ) as Abi;
  const [rawTournament, rawPlayers] = await Promise.all([
    rpcClient.readContract({
      address: registry,
      abi: selectedAbi,
      functionName: "getTournament",
      args: [BigInt(id)],
      blockNumber: block.number,
    }),
    rpcClient.readContract({
      address: registry,
      abi: selectedAbi,
      functionName: "getPlayers",
      args: [BigInt(id)],
      blockNumber: block.number,
    }),
  ]);
  const tournament = serial<Record<string, unknown>>(rawTournament);
  const players = serial<Player[]>(rawPlayers);
  const round = Number(tournament.round ?? 0);
  const phase = Number(tournament.phase ?? 0);
  const marketId = String(tournament.marketId ?? zeroHash);
  if (phase !== 1 || !round || marketId === zeroHash || !players.length)
    return { activity: [] as TradeActivity[], truncated: false };

  const cacheKey = `${registry.toLowerCase()}:${id}:${round}:${marketId}`;
  let cached = tradeActivityCache.get(cacheKey);
  if (!cached) {
    const fromBlock = await blockNearTimestamp(
      Number(tournament.updatedAt),
      block,
      rpcClient,
    );
    cached = { fromBlock, lastBlock: fromBlock - 1n, events: [] };
    tradeActivityCache.set(cacheKey, cached);
    if (tradeActivityCache.size > 32)
      tradeActivityCache.delete(tradeActivityCache.keys().next().value!);
  }
  const activityState = cached;

  const vaultToWallet = new Map(
    players.map(
      (player) => [player.vault.toLowerCase(), player.wallet] as const,
    ),
  );
  const vaults = players.map((player) => player.vault);
  const firstUnread = activityState.lastBlock + 1n;
  if (firstUnread <= block.number) {
    const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
    for (
      let fromBlock = firstUnread;
      fromBlock <= block.number;
      fromBlock += 1_000n
    )
      ranges.push({
        fromBlock,
        toBlock:
          fromBlock + 999n > block.number ? block.number : fromBlock + 999n,
      });
    const logs = [];
    for (let offset = 0; offset < ranges.length; offset += 6) {
      const pages = await Promise.all(
        ranges.slice(offset, offset + 6).map((range) =>
          rpcClient.getLogs({
            ...range,
            address: vaults,
            event: tradeEvent,
            strict: true,
          }),
        ),
      );
      logs.push(...pages.flat());
    }
    const uniqueBlocks = [...new Set(logs.map((log) => log.blockNumber))];
    const timestamps = new Map<bigint, number>();
    for (let offset = 0; offset < uniqueBlocks.length; offset += 8) {
      const blocks = await Promise.all(
        uniqueBlocks
          .slice(offset, offset + 8)
          .map((blockNumber) => rpcClient.getBlock({ blockNumber })),
      );
      for (const item of blocks)
        timestamps.set(item.number, Number(item.timestamp));
    }
    for (const log of logs) {
      const wallet = vaultToWallet.get(log.address.toLowerCase());
      if (!wallet || !log.transactionHash) continue;
      const kind = Number(log.args.kind);
      const shares = log.args.shares;
      const cashDelta = log.args.cashDelta;
      const absoluteDelta = cashDelta < 0n ? -cashDelta : cashDelta;
      const rawPrice =
        shares > 0n ? Number((absoluteDelta * 1_000_000n) / shares) : 0;
      const price = Math.max(0, Math.min(1_000_000, rawPrice));
      activityState.events.push({
        wallet,
        vault: log.address,
        kind,
        side: kind < 2 ? "UP" : "DOWN",
        direction: kind === 0 || kind === 2 ? "BUY" : "SELL",
        shares: String(shares),
        cashDelta: String(cashDelta),
        cashAfter: String(log.args.cashAfter),
        price,
        upPrice: kind < 2 ? price : 1_000_000 - price,
        time: timestamps.get(log.blockNumber) ?? Number(block.timestamp),
        block: String(log.blockNumber),
        logIndex: log.logIndex ?? 0,
        hash: log.transactionHash,
      });
    }
    activityState.events.sort(
      (a, b) =>
        a.time - b.time ||
        Number(BigInt(a.block) - BigInt(b.block)) ||
        a.logIndex - b.logIndex,
    );
    activityState.lastBlock = block.number;
  }

  const limit = 600;
  return {
    activity: activityState.events.slice(-limit),
    truncated: activityState.events.length > limit,
  };
}
const checked = new Map<string, number>();
const LEGACY_V2_ARENA = "0x7c0dd0d2aea196118dbca546bdc2c6ecf541dd1e";
export async function checkCode(
  address: Address,
  artifact: {
    immutableReferences: Record<string, { start: number; length: number }[]>;
    deployedBytecode: string;
  },
  rpcClient: ShannonClient = client,
) {
  const code = await rpcClient.getCode({ address });
  if (!code) throw new Error("No deployed contract.");
  let normalized = code.slice(2).toLowerCase();
  for (const refs of Object.values(artifact.immutableReferences))
    for (const ref of refs) {
      const start = ref.start * 2,
        length = ref.length * 2;
      normalized =
        normalized.slice(0, start) +
        "0".repeat(length) +
        normalized.slice(start + length);
    }
  if (normalized !== artifact.deployedBytecode.slice(2).toLowerCase())
    throw new Error("Unrecognized contract bytecode.");
}
export async function verifyRegistry(
  registry: Address,
  rpcClient: ShannonClient = client,
) {
  const known = checked.get(registry.toLowerCase());
  if (known) return known;
  const [version, token, module] = await Promise.all(
    ["VERSION", "collateral", "module"].map((functionName) =>
      rpcClient.readContract({
        address: registry,
        abi: arenaAbi,
        functionName,
      }),
    ),
  );
  if (
    ![1n, 2n, 3n, 4n, 5n].includes(version as bigint) ||
    (version === 2n &&
      registry.toLowerCase() !== LEGACY_V2_ARENA.toLowerCase()) ||
    (version === 3n &&
      registry.toLowerCase() !== LEGACY_V3_ARENA.toLowerCase()) ||
    String(token).toLowerCase() !== COLLATERAL.toLowerCase() ||
    String(module).toLowerCase() !== MODULE.toLowerCase()
  )
    throw new Error("Unsupported testnet arena.");
  // The current arena runtime uses factory vaults with lifetime action counts.
  // The official V2 address remains readable for historical tournaments.
  if (version === 1n) await checkCode(registry, legacyArtifact, rpcClient);
  if (version === 4n) await checkCode(registry, legacyV4Artifact, rpcClient);
  if (version === 5n) await checkCode(registry, arenaArtifact, rpcClient);
  if (version === 2n || version === 3n || version === 4n || version === 5n) {
    const [creator, venue, factory] = await Promise.all(
      ["trustedCreator", "trustedVenue", "vaultFactory"].map((functionName) =>
        rpcClient.readContract({
          address: registry,
          abi: arenaAbi,
          functionName,
        }),
      ),
    );
    if (
      String(creator).toLowerCase() !== CREATOR.toLowerCase() ||
      venue !== VENUE
    )
      throw new Error("Unexpected market permissions.");
    if (version === 4n)
      await checkCode(factory as Address, legacyV4FactoryArtifact, rpcClient);
    if (version === 5n)
      await checkCode(factory as Address, factoryArtifact, rpcClient);
    const parent = await rpcClient.readContract({
      address: factory as Address,
      abi: factoryArtifact.abi as Abi,
      functionName: "arena",
    });
    if (String(parent).toLowerCase() !== registry.toLowerCase())
      throw new Error("Unexpected vault factory.");
  }
  checked.set(registry.toLowerCase(), Number(version));
  return Number(version);
}
export async function snapshot(
  registry: Address | null,
  account: Address | null,
  id: number,
  before: number,
): Promise<Snapshot> {
  const rpcClient = scopedClient();
  const block = await head(rpcClient),
    blockNumber = block.number;
  const [balance, gas, allowance] = account
    ? await Promise.all([
        rpcClient.readContract({
          address: COLLATERAL,
          abi: tokenAbi,
          functionName: "balanceOf",
          args: [account],
          blockNumber,
        }),
        rpcClient.getBalance({ address: account, blockNumber }),
        registry
          ? rpcClient.readContract({
              address: COLLATERAL,
              abi: tokenAbi,
              functionName: "allowance",
              args: [account, registry],
              blockNumber,
            })
          : Promise.resolve(0n),
      ])
    : [0n, 0n, 0n];
  const version = registry ? await verifyRegistry(registry, rpcClient) : 2;
  const arenaAbi = (
    version === 1
      ? legacyArtifact.abi
      : version === 4
        ? legacyV4Artifact.abi
        : arenaArtifact.abi
  ) as Abi;
  const base = {
    account,
    version,
    chainId: CHAIN_ID,
    block: String(blockNumber),
    timestamp: Number(block.timestamp),
    registry,
    balance: String(balance),
    gas: String(gas),
    allowance: String(allowance),
  };
  if (!registry)
    return {
      ...base,
      tournaments: [],
      selected: null,
      players: [],
      market: null,
      hasOlder: false,
      nextBefore: null,
    };
  await verifyRegistry(registry, rpcClient);
  const count = Number(
    await rpcClient.readContract({
      address: registry,
      abi: arenaAbi,
      functionName: "tournamentCount",
      blockNumber,
    }),
  );
  const last = before > 0 ? Math.min(before - 1, count) : count;
  const first = Math.max(1, last - 19);
  async function tournament(n: number) {
    const raw = serial<Record<string, unknown>>(
      await rpcClient.readContract({
        address: registry!,
        abi: arenaAbi,
        functionName: "getTournament",
        args: [BigInt(n)],
        blockNumber,
      }),
    );
    return {
      ...raw,
      minPlayers: Number(raw.minPlayers ?? 2),
      roundTrades: Number(raw.roundTrades ?? 0),
      cancelReason: Number(raw.cancelReason ?? 0),
      scheduled: Boolean(raw.scheduled),
      entryFee: String(raw.entryFee ?? 2_000_000),
      bankroll: String(raw.bankroll ?? 10_000_000),
      id: n,
      joinDeadline: Number(raw.joinDeadline),
      expiry: Number(raw.expiry),
      updatedAt: Number(raw.updatedAt),
      duration: Number(raw.duration),
    } as Tournament;
  }
  const tournaments = await Promise.all(
    Array.from({ length: Math.max(0, last - first + 1) }, (_, i) =>
      tournament(last - i),
    ),
  );
  const selected =
    id > 0 && id <= count
      ? (tournaments.find((t) => t.id === id) ?? (await tournament(id)))
      : null;
  let players: Player[] = [];
  let market: LiveMarket | null = null;
  if (selected) {
    const raw = serial<Player[]>(
      await rpcClient.readContract({
        address: registry,
        abi: arenaAbi,
        functionName: "getPlayers",
        args: [BigInt(id)],
        blockNumber,
      }),
    );
    const readPlayers = async () => {
      for (let i = 0; i < raw.length; i += 4) {
        players.push(
          ...(await Promise.all(
            raw.slice(i, i + 4).map(async (p) => {
              const keys = [
                "cash",
                "yesShares",
                "noShares",
                "actions",
                "settled",
                "withdrawn",
              ] as const;
              const vals = await Promise.all(
                keys.map((functionName) =>
                  rpcClient.readContract({
                    address: p.vault,
                    abi: vaultAbi,
                    functionName,
                    blockNumber,
                  }),
                ),
              );
              return {
                ...p,
                ...serial(Object.fromEntries(keys.map((k, j) => [k, vals[j]]))),
              } as Player;
            }),
          )),
        );
      }
    };
    const results = await Promise.all([
      selected.marketId === zeroHash
        ? Promise.resolve(null)
        : readMarket(selected.marketId, undefined, blockNumber, rpcClient),
      readPlayers(),
    ]);
    market = results[0];
  }
  return {
    ...base,
    tournaments,
    selected,
    players,
    market,
    hasOlder: first > 1,
    nextBefore: first > 1 ? first : null,
  };
}
export function address(value: string | null) {
  if (!value) return null;
  if (!isAddress(value)) throw new Error("Invalid wallet or contract address.");
  return value as Address;
}
