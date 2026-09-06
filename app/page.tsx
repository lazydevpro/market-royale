"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Crown,
  Award,
  BadgeCheck,
  Clock3,
  ExternalLink,
  Flame,
  Gamepad2,
  Medal,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  Trophy,
  Users,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import {
  formatEther,
  isAddress,
  parseUnits,
  encodeDeployData,
  decodeEventLog,
  type Address,
  type Abi,
  type Hex,
} from "viem";
import {
  CHAIN_ID,
  COLLATERAL,
  MODULE,
  CREATOR,
  VENUE,
  CANCEL_TIMEOUT,
  START_GRACE,
  CANCEL_REASONS,
  EXPLORER,
  PROGRESSION,
  TEST_BOTS,
  tokenAbi,
  moduleAbi,
  outcomeAbi,
  short,
  cashFormat,
  type LiveMarket,
  type Snapshot,
} from "../lib/testnet/config";
import {
  connect,
  signer,
  write,
  publicClient,
  explain,
  type Provider,
  type WalletOption,
} from "../lib/testnet/wallet";
import arenaArtifact from "../lib/testnet/MarketRoyale.json";
import vaultArtifact from "../lib/testnet/TraderVault.json";
import progressionArtifact from "../lib/testnet/MarketRoyaleProgression.json";
import "./testnet.css";
import Liquidity from "./liquidity";
import { discoverLocalWallets } from "../lib/testnet/local-provider";
import PlayerAvatar from "./player-avatar";
import TradingChart, { type TradingChartData } from "./trading-chart";
const arenaAbi = arenaArtifact.abi as Abi,
  vaultAbi = vaultArtifact.abi as Abi,
  progressionAbi = progressionArtifact.abi as Abi;
const PHASES = ["ENROLLING", "TRADING", "NEXT ROUND", "FINISHED", "CANCELLED"];
type Page = "arena" | "game" | "profile" | "wallet" | "history" | "rules";
const LEAGUES = ["Bronze", "Silver", "Gold", "Diamond", "Champion"];
const BADGES = [
  {
    name: "Royale Debut",
    copy: "Complete a ranked royale",
    asset: "/art/vendor/fluent-emoji/crossed-swords-3d.png",
  },
  {
    name: "Cut Survivor",
    copy: "Finish in the top half",
    asset: "/art/vendor/fluent-emoji/shield-3d.png",
  },
  {
    name: "Triple Survivor",
    copy: "Survive three elimination cuts",
    asset: "/art/vendor/fluent-emoji/sparkles-3d.png",
  },
  {
    name: "Podium Finish",
    copy: "Place in the top three",
    asset: "/art/vendor/fluent-emoji/trophy-3d.png",
  },
  {
    name: "Royale Champion",
    copy: "Win a completed royale",
    asset: "/art/vendor/fluent-emoji/coin-3d.png",
  },
  {
    name: "Ten-Royale Veteran",
    copy: "Complete ten ranked royales",
    asset: "/art/vendor/fluent-emoji/stopwatch-3d.png",
  },
  {
    name: "Profitable Finish",
    copy: "Finish above the event's starting vault",
    asset: "/art/vendor/fluent-emoji/gem-stone-3d.png",
  },
  {
    name: "Season Invitational Pass",
    copy: "Reach season level three",
    asset: "/art/vendor/fluent-emoji/sparkles-3d.png",
  },
];
type ProgressionSnapshot = {
  configured: boolean;
  address?: Address;
  version?: string;
  season?: string;
  seasonEnds?: string;
  reserve?: string;
  profile: null | {
    rating: string;
    careerXp: string;
    completed: string;
    wins: string;
    podiums: string;
    topHalfFinishes: string;
    survivals: string;
    protectedGames: string;
    seasonXp: string;
    level: string;
    league: string;
    verified: boolean;
  };
  badges: string[];
  preview: null | {
    canRecord: boolean;
    rank: string;
    playerCount: string;
    actions: string;
    finalCash: string;
    delta: number;
    xp: string;
    protectionAvailable: boolean;
    protectionAmount: string;
  };
};
type Activity = {
  hash: Hex;
  label: string;
  status: "pending" | "confirmed" | "reverted";
  account: Address;
  time: number;
};
type GasGrant = {
  ok: boolean;
  hash?: Hex;
  amount?: string;
  nextEligibleAt?: number;
  error?: string;
};
function Orb({ orange = false }: { orange?: boolean }) {
  return (
    <img
      className="tn-orb"
      src={`/figma/${orange ? "orange-orb" : "purple-orb"}.svg`}
      alt=""
    />
  );
}
function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat">
      <span className="eyebrow">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function TxLink({ hash }: { hash: string }) {
  return (
    <a href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noreferrer">
      View transaction <ExternalLink size={13} />
    </a>
  );
}
const seconds = (n: number) => {
  n = Math.max(0, Math.floor(n));
  return `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${(n % 60).toString().padStart(2, "0")}`;
};
const localTime = (timestamp: number) =>
  new Date(timestamp * 1000).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
const cents = (value: string | bigint) =>
  (Number(value) / 10_000).toFixed(4).replace(/\.?0+$/, "");
const ONE_SHARE = 1_000_000n;
function quoteIoc(
  market: LiveMarket | null | undefined,
  side: "UP" | "DOWN",
  direction: "buy" | "sell",
  limit: bigint,
  quantity: bigint,
) {
  let remaining = quantity > 0n ? quantity : 0n;
  let filled = 0n;
  let value = 0n;
  const levels = !market
    ? []
    : side === "UP"
      ? direction === "buy"
        ? market.asks
        : market.bids
      : direction === "buy"
        ? market.bids
        : market.asks;
  for (const level of levels) {
    if (remaining === 0n) break;
    const levelPrice =
      side === "UP" ? BigInt(level.price) : ONE_SHARE - BigInt(level.price);
    const crosses =
      direction === "buy" ? levelPrice <= limit : levelPrice >= limit;
    if (!crosses) break;
    const available = BigInt(level.quantity);
    const take = available < remaining ? available : remaining;
    if (take === 0n) continue;
    value += (take * levelPrice) / ONE_SHARE;
    filled += take;
    remaining -= take;
  }
  return {
    filled,
    value,
    remainder: quantity > filled ? quantity - filled : 0n,
    averagePrice: filled > 0n ? (value * ONE_SHARE) / filled : 0n,
  };
}
const eq = (a?: string | null, b?: string | null) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase());
const playerName = (address: string, viewer?: string | null) => {
  if (eq(address, viewer)) return "YOU";
  const bot = TEST_BOTS.findIndex((candidate) => eq(candidate, address));
  return bot >= 0 ? `TRAINING BOT ${bot + 1}` : short(address);
};
const isTrainingBot = (address: string) =>
  TEST_BOTS.some((candidate) => eq(candidate, address));
async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { cache: "no-store", signal });
  const data = (await r.json()) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? "Testnet is unavailable.");
  return data;
}

export default function Home() {
  const [page, setPage] = useState<Page>("arena"),
    [ready, setReady] = useState(false);
  const [wallets, setWallets] = useState<WalletOption[]>([]),
    [walletId, setWalletId] = useState(""),
    [account, setAccount] = useState<Address | null>(null),
    [chain, setChain] = useState<number | null>(null);
  const [registry, setRegistry] = useState<Address | null>(null),
    [registryDraft, setRegistryDraft] = useState(""),
    [selected, setSelected] = useState(0),
    [before, setBefore] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [live, setLive] = useState<LiveMarket[]>([]),
    [progression, setProgression] = useState<ProgressionSnapshot | null>(null),
    [progressionLoading, setProgressionLoading] = useState(false),
    [progressionError, setProgressionError] = useState(""),
    [marketError, setMarketError] = useState(""),
    [stateError, setStateError] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState("");
  const [tick, setTick] = useState(0),
    [now, setNow] = useState(Math.floor(Date.now() / 1000)),
    [syncedAt, setSyncedAt] = useState(0),
    [marketAt, setMarketAt] = useState(0);
  const [scheduled, setScheduled] = useState(true),
    [minimum, setMinimum] = useState("2"),
    [duration, setDuration] = useState("900"),
    [startDelay, setStartDelay] = useState("180"),
    [assetPreference, setAssetPreference] = useState("BTC"),
    [showFinishCelebration, setShowFinishCelebration] = useState(false);
  const [ops, setOps] = useState<{
    enabled: boolean;
    host?: string;
    registry?: string;
    lastRun?: number;
    error?: string;
    issues?: Record<string, { error: string; retryAt: number }>;
    pending?: { label: string };
    log?: { hash: Hex; label: string; status: string }[];
    botBackfill?: boolean;
    bots?: string[];
    assetPreferences?: Record<string, string>;
  } | null>(null);
  const [marketId, setMarketId] = useState(""),
    [capacity, setCapacity] = useState("8"),
    [rounds, setRounds] = useState("1"),
    [entryFee, setEntryFee] = useState("2"),
    [startingBankroll, setStartingBankroll] = useState("10"),
    [joinWindow, setJoinWindow] = useState("60");
  const [chart, setChart] = useState<TradingChartData | null>(null),
    [chartLoading, setChartLoading] = useState(false),
    [chartError, setChartError] = useState(""),
    [chartTick, setChartTick] = useState(0);
  const [side, setSide] = useState<"UP" | "DOWN">("UP"),
    [direction, setDirection] = useState<"buy" | "sell">("buy"),
    [quantity, setQuantity] = useState("2"),
    [price, setPrice] = useState(""),
    [accepted, setAccepted] = useState(false);
  const [activity, setActivity] = useState<Activity[]>([]),
    [loading, setLoading] = useState(false);
  const busy = useRef(false),
    battleMeRef = useRef<HTMLDivElement>(null),
    finishDialogRef = useRef<HTMLElement>(null),
    selectedWallet = wallets.find((w) => w.id === walletId),
    provider = selectedWallet?.provider;
  const refresh = () => setTick((t) => t + 1);
  const go = (p: Page) => {
    const url = new URL(location.href);
    url.hash = p;
    history.replaceState(null, "", url);
    setPage(p);
    window.scrollTo({ top: 0 });
  };
  const openMatch = (id: number) => {
    setSelected(id);
    setAccepted(false);
    const url = new URL(location.href);
    url.searchParams.set("match", String(id));
    url.hash = "game";
    history.replaceState(null, "", url);
    setPage("game");
    window.scrollTo({ top: 0 });
  };
  const saveRegistry = (address: Address) => {
    setRegistry(address);
    setRegistryDraft(address);
    setSnapshot(null);
    setBefore(0);
    localStorage.setItem("market-royale-registry-v1", address);
    const url = new URL(location.href);
    url.searchParams.set("registry", address);
    history.replaceState(null, "", url);
  };
  useEffect(() => {
    const url = new URL(location.href);
    const saved =
      url.searchParams.get("registry") ??
      process.env.NEXT_PUBLIC_ROYALE_ADDRESS ??
      localStorage.getItem("market-royale-registry-v1");
    if (saved && isAddress(saved)) {
      setRegistry(saved);
      setRegistryDraft(saved);
    }
    const id = Number(url.searchParams.get("match"));
    if (Number.isSafeInteger(id) && id > 0) setSelected(id);
    try {
      const savedActivity = JSON.parse(
        localStorage.getItem("market-royale-transactions-v1") ?? "[]",
      );
      if (Array.isArray(savedActivity))
        setActivity(
          savedActivity
            .filter(
              (a) =>
                /^0x[0-9a-fA-F]{64}$/.test(a.hash) &&
                ["pending", "confirmed", "reverted"].includes(a.status),
            )
            .slice(0, 30),
        );
    } catch {}
    const sync = () => {
      const p = location.hash.slice(1);
      setPage(
        ["arena", "game", "profile", "wallet", "history", "rules"].includes(p)
          ? (p as Page)
          : "arena",
      );
    };
    sync();
    window.addEventListener("hashchange", sync);
    const announce = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          info: { uuid: string; name: string };
          provider: Provider;
        }>
      ).detail;
      if (!detail?.provider) return;
      setWallets((prev) =>
        prev.some((w) => w.id === detail.info.uuid)
          ? prev
          : [
              ...prev,
              {
                id: detail.info.uuid,
                name: detail.info.name,
                provider: detail.provider,
              },
            ],
      );
    };
    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const injected = (window as Window & { ethereum?: Provider }).ethereum;
    if (injected)
      setWallets((prev) =>
        prev.length
          ? prev
          : [{ id: "injected", name: "Browser wallet", provider: injected }],
      );
    void discoverLocalWallets()
      .then((local) =>
        setWallets((prev) => [
          ...prev.filter((w) => !local.some((l) => l.id === w.id)),
          ...local,
        ]),
      )
      .catch(() => {});
    setReady(true);
    const timer = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000,
    );
    return () => {
      clearInterval(timer);
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("eip6963:announceProvider", announce);
    };
  }, []);
  useEffect(() => {
    if (!walletId && wallets[0]) setWalletId(wallets[0].id);
  }, [wallets, walletId]);
  useEffect(() => {
    if (!provider) return;
    let alive = true;
    const changed = (value: unknown) => {
      const addresses = value as Address[];
      setAccount(addresses[0] ?? null);
      setSnapshot(null);
    };
    const chainChanged = (value: unknown) => {
      setChain(Number(value));
      setSnapshot(null);
    };
    provider
      .request({ method: "eth_accounts" })
      .then((addresses) => {
        if (alive) setAccount(addresses[0] ?? null);
      })
      .catch(() => {});
    provider
      .request({ method: "eth_chainId" })
      .then((id) => {
        if (alive) setChain(Number(id));
      })
      .catch(() => {});
    provider.on?.("accountsChanged", changed);
    provider.on?.("chainChanged", chainChanged);
    return () => {
      alive = false;
      provider.removeListener?.("accountsChanged", changed);
      provider.removeListener?.("chainChanged", chainChanged);
    };
  }, [provider]);
  useEffect(() => {
    if (ready)
      localStorage.setItem(
        "market-royale-transactions-v1",
        JSON.stringify(activity),
      );
  }, [activity, ready]);
  useEffect(() => {
    if (!ready) return;
    const abort = new AbortController();
    let running = false;
    const load = async () => {
      if (running) return;
      running = true;
      try {
        const data = await json<{ markets: LiveMarket[]; timestamp: number }>(
          "/api/testnet/markets",
          abort.signal,
        );
        if (!abort.signal.aborted) {
          setLive(data.markets);
          setMarketAt(Date.now());
          setMarketError("");
        }
      } catch (e) {
        if (!abort.signal.aborted) setMarketError(explain(e));
      } finally {
        running = false;
      }
    };
    void load();
    const timer = setInterval(load, 20000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [ready, tick]);
  useEffect(() => {
    if (!ready) return;
    const abort = new AbortController();
    let running = false;
    const load = async () => {
      if (running) return;
      running = true;
      setLoading(true);
      try {
        const q = new URLSearchParams();
        if (registry) q.set("registry", registry);
        if (account) q.set("account", account);
        q.set("id", String(selected));
        q.set("before", String(before));
        const data = await json<Snapshot>(
          `/api/testnet/state?${q}`,
          abort.signal,
        );
        if (!abort.signal.aborted) {
          setSnapshot(data);
          setSyncedAt(Date.now());
          setStateError("");
        }
      } catch (e) {
        if (!abort.signal.aborted) {
          setStateError(explain(e));
        }
      } finally {
        running = false;
        if (!abort.signal.aborted) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(load, 10000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [ready, registry, account, selected, before, tick]);
  useEffect(() => {
    const abort = new AbortController();
    const load = () =>
      json<NonNullable<typeof ops>>("/api/testnet/operations", abort.signal)
        .then(setOps)
        .catch(() => {});
    void load();
    const timer = setInterval(load, 15000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const abort = new AbortController();
    let running = false;
    const load = async () => {
      if (running) return;
      running = true;
      setProgressionLoading(true);
      try {
        const query = new URLSearchParams();
        if (account) query.set("account", account);
        if (selected) query.set("match", String(selected));
        const data = await json<ProgressionSnapshot>(
          `/api/testnet/progression?${query}`,
          abort.signal,
        );
        if (!abort.signal.aborted) {
          setProgression(data);
          setProgressionError("");
        }
      } catch (e) {
        if (!abort.signal.aborted) setProgressionError(explain(e));
      } finally {
        running = false;
        if (!abort.signal.aborted) setProgressionLoading(false);
      }
    };
    void load();
    const timer = setInterval(load, 20000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [ready, account, selected, tick]);
  const t = snapshot?.selected,
    m = snapshot?.market;
  const hostEntryRaw = BigInt(entryFee) * 1_000_000n;
  const hostBankrollRaw = BigInt(startingBankroll) * 1_000_000n;
  const hostSeatRaw = hostEntryRaw + hostBankrollRaw;
  const selectedSeatRaw = t
    ? BigInt(t.entryFee) + BigInt(t.bankroll)
    : 12_000_000n;
  useEffect(() => {
    if (page !== "game" || !m) {
      setChart(null);
      setChartError("");
      return;
    }
    const abort = new AbortController();
    let running = false;
    const load = async () => {
      if (running) return;
      running = true;
      setChartLoading(true);
      try {
        const query = new URLSearchParams({
          pool: m.pool,
          asset: m.asset,
          from: String(m.start),
          to: String(
            Math.max(
              m.start,
              Math.min(Math.floor(Date.now() / 1000), m.expiry),
            ),
          ),
        });
        if (registry && selected > 0) {
          query.set("registry", registry);
          query.set("match", String(selected));
        }
        const data = await json<TradingChartData>(
          `/api/testnet/chart?${query}`,
          abort.signal,
        );
        if (!abort.signal.aborted) {
          setChart(data);
          setChartError("");
        }
      } catch (e) {
        if (!abort.signal.aborted) setChartError(explain(e));
      } finally {
        running = false;
        if (!abort.signal.aborted) setChartLoading(false);
      }
    };
    setChart(null);
    void load();
    const timer = setInterval(load, 8_000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [
    page,
    m?.pool,
    m?.asset,
    m?.start,
    m?.expiry,
    registry,
    selected,
    chartTick,
  ]);
  const me = snapshot?.players.find((p) => eq(p.wallet, account));
  useEffect(() => {
    if (
      page !== "game" ||
      t?.phase !== 3 ||
      !me?.rank ||
      !registry ||
      !account
    )
      return;
    const key = `market-royale-finish:${registry}:${t.id}:${account}`;
    if (!sessionStorage.getItem(key)) setShowFinishCelebration(true);
  }, [page, t?.id, t?.phase, me?.rank, registry, account]);
  useEffect(() => {
    if (!showFinishCelebration) return;
    finishDialogRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowFinishCelebration(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [showFinishCelebration]);
  const fresh = Boolean(
    snapshot &&
    (!account ? snapshot.account === null : eq(snapshot.account, account)) &&
    !stateError &&
    Date.now() - syncedAt < 30000,
  );
  const connected = Boolean(account && provider && chain === CHAIN_ID);
  const allowed =
    connected &&
    fresh &&
    !pending &&
    [2, 3, 4, 5].includes(snapshot?.version ?? 0);
  const usableMarkets = live.filter(
    (m) =>
      m.status === 1 &&
      !m.recycled &&
      m.expiry > now + Number(joinWindow) + 135,
  );
  const quickMarkets = usableMarkets
    .filter((market) => market.asset === assetPreference)
    .sort((a, b) => a.expiry - b.expiry);
  const quickAvailableAssets = ["BTC", "ETH"].filter((asset) =>
    usableMarkets.some((market) => market.asset === asset),
  );
  const availableAssets = ["BTC", "ETH"].filter((asset) =>
    live.some((market) => market.status === 1 && market.asset === asset),
  );
  // Prefer DreamDEX's shortest documented cadence. Keep 5 minutes discoverable
  // when the venue actually publishes that interval on Shannon.
  const availableDurations = [900, 3600, 300].filter((seconds) =>
    live.some(
      (market) =>
        market.status === 1 &&
        market.asset === assetPreference &&
        market.interval === seconds,
    ),
  );
  useEffect(() => {
    const validAssets = scheduled ? availableAssets : quickAvailableAssets;
    if (
      validAssets.length &&
      !validAssets.includes(assetPreference)
    )
      setAssetPreference(validAssets[0]);
  }, [
    scheduled,
    assetPreference,
    availableAssets.join(","),
    quickAvailableAssets.join(","),
  ]);
  useEffect(() => {
    if (
      availableDurations.length &&
      !availableDurations.includes(Number(duration))
    )
      setDuration(String(availableDurations[0]));
  }, [duration, availableDurations.join(",")]);
  useEffect(() => {
    if (!quickMarkets.some((m) => m.id === marketId))
      setMarketId(quickMarkets[0]?.id ?? "");
  }, [marketId, quickMarkets.map((m) => m.id).join(",")]);
  const quickMarket = quickMarkets.find((market) => market.id === marketId);
  const quickRoundLimit = Math.max(
    1,
    Math.min(
      Number(rounds),
      Math.ceil(Math.log2(Math.max(2, Number(capacity)))),
    ),
  );
  const quickFinalClose = quickMarket
    ? quickMarket.expiry + (quickRoundLimit - 1) * quickMarket.interval
    : 0;
  const quickSettlementBuffer =
    60 + Math.ceil(Math.max(2, Number(capacity)) / 4) * 15;
  const quickEstimatedCompletion = quickFinalClose
    ? quickFinalClose + quickSettlementBuffer
    : 0;
  const quote = m
    ? side === "UP"
      ? direction === "buy"
        ? m.asks[0]
        : m.bids[0]
      : direction === "buy"
        ? m.bids[0]
        : m.asks[0]
    : undefined;
  const quotePrice = quote
    ? side === "UP"
      ? BigInt(quote.price)
      : 1_000_000n - BigInt(quote.price)
    : null;
  const marketableQuote = quotePrice;
  useEffect(() => {
    setPrice(marketableQuote !== null ? cents(marketableQuote) : "");
  }, [side, direction, m?.id]);
  let orderPrice = 0n,
    orderQty = 0n,
    orderError = "";
  try {
    orderPrice = parseUnits(price || "0", 4);
    orderQty = parseUnits(quantity || "0", 6);
    const yesPrice = side === "UP" ? orderPrice : 1_000_000n - orderPrice;
    if (orderPrice <= 0n || orderPrice >= 1_000_000n)
      orderError = "Enter a limit between 0 and 100 cents.";
    else if (!m || BigInt(m.tick) <= 0n || BigInt(m.lot) <= 0n)
      orderError = "Order book parameters unavailable.";
    else if (yesPrice % BigInt(m.tick) !== 0n)
      orderError = `Price must follow the ${Number(m.tick) / 10000}¢ tick.`;
    else if (orderQty < BigInt(m.min) || orderQty % BigInt(m.lot) !== 0n)
      orderError = `Minimum ${cashFormat(m.min)} shares; steps of ${cashFormat(m.lot)}.`;
    else if (
      direction === "sell" &&
      orderQty >
        BigInt(side === "UP" ? (me?.yesShares ?? 0) : (me?.noShares ?? 0))
    )
      orderError = "You do not hold enough shares.";
    else if (
      direction === "buy" &&
      (orderQty * orderPrice + ONE_SHARE - 1n) / ONE_SHARE >
        BigInt(me?.cash ?? 0)
    )
      orderError = "Order exceeds your available bankroll.";
    else if (
      quotePrice !== null &&
      ((direction === "buy" && orderPrice < quotePrice) ||
        (direction === "sell" && orderPrice > quotePrice))
    )
      orderError = `Limit does not reach the live ${direction === "buy" ? "ask" : "bid"}; this IOC order would not fill.`;
  } catch {
    orderError = "Enter valid share and price amounts.";
  }
  const positionBasis = (() => {
    if (!account || chart?.activityTruncated) return null;
    let shares = 0n;
    let basis = 0n;
    for (const fill of [...(chart?.activity ?? [])]
      .filter((item) => eq(item.wallet, account) && item.side === side)
      .sort((a, b) => a.time - b.time || a.logIndex - b.logIndex)) {
      const filled = BigInt(fill.shares);
      const delta = BigInt(fill.cashDelta);
      if (fill.direction === "BUY") {
        shares += filled;
        basis += delta < 0n ? -delta : delta;
      } else if (shares > 0n) {
        const sold = filled > shares ? shares : filled;
        const removed = (basis * sold) / shares;
        shares -= sold;
        basis -= removed;
      }
    }
    const onchainShares = BigInt(
      side === "UP" ? (me?.yesShares ?? 0) : (me?.noShares ?? 0),
    );
    return shares === onchainShares ? { shares, basis } : null;
  })();
  const iocQuote = quoteIoc(m, side, direction, orderPrice, orderQty);
  const quoteCredit = direction === "sell" ? iocQuote.value : 0n;
  const closeBasis =
    direction === "sell" && positionBasis && positionBasis.shares > 0n
      ? (positionBasis.basis *
          (iocQuote.filled > positionBasis.shares
            ? positionBasis.shares
            : iocQuote.filled)) /
        positionBasis.shares
      : null;
  const estimatedClosePnl =
    closeBasis === null ? null : quoteCredit - closeBasis;
  const canTrade =
    allowed &&
    t?.phase === 1 &&
    me?.active &&
    !me.settled &&
    m?.status === 1 &&
    !m.recycled &&
    !m.bookError &&
    now < m.expiry &&
    Boolean(quote) &&
    !orderError;
  const run = async (label: string, action: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(label);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(explain(e));
    } finally {
      busy.current = false;
      setPending("");
      refresh();
    }
  };
  const wait = async (hash: Hex, label: string) => {
    setActivity((a) =>
      [
        {
          hash,
          label,
          status: "pending" as const,
          account: account!,
          time: Date.now(),
        },
        ...a,
      ].slice(0, 30),
    );
    setPending(`${label} · waiting for confirmation`);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 120000,
      onReplaced: (r) =>
        setActivity((a) =>
          a.map((x) =>
            x.hash === r.replacedTransaction.hash
              ? { ...x, hash: r.transaction.hash }
              : x,
          ),
        ),
    });
    setActivity((a) =>
      a.map((x) =>
        x.hash === hash || x.hash === receipt.transactionHash
          ? {
              ...x,
              status: receipt.status === "success" ? "confirmed" : "reverted",
            }
          : x,
      ),
    );
    if (receipt.status !== "success")
      throw new Error("Transaction reverted. No game action was applied.");
    setNotice(`${label} confirmed.`);
    return receipt;
  };
  const tx = async (
    label: string,
    address: Address,
    abi: Abi,
    fn: string,
    args: readonly unknown[] = [],
  ) => {
    if (!provider || !account) throw new Error("Connect a wallet first.");
    const hash = await write(provider, account, address, abi, fn, args);
    return wait(hash, label);
  };
  const requestGas = () =>
    run("Request 1 STT", async () => {
      if (!account) throw new Error("Connect a wallet first.");
      const recipient = account;
      const response = await fetch("/api/testnet/gas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: recipient }),
      });
      const data = (await response.json()) as GasGrant;
      if (!response.ok)
        throw new Error(
          data.nextEligibleAt
            ? `${data.error ?? "Daily STT grant already claimed"} Next request: ${new Date(data.nextEligibleAt).toLocaleString()}.`
            : (data.error ?? "The gas faucet is temporarily unavailable."),
        );
      if (data.hash)
        setActivity((items) =>
          [
            {
              hash: data.hash!,
              label: "Sponsored 1 STT",
              status: "confirmed" as const,
              account: recipient,
              time: Date.now(),
            },
            ...items,
          ].slice(0, 30),
        );
      setNotice(
        `${data.amount ?? "1"} STT received. You can now request tUSDC and play.`,
      );
    });
  const join = () =>
    run("Join royale", async () => {
      if (!t || !registry) throw new Error("Select a royale.");
      await tx("Join royale", registry, arenaAbi, "join", [BigInt(t.id)]);
      await fetch("/api/testnet/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: t.id }),
      }).catch(() => undefined);
      setAccepted(false);
    });
  const deploy = () =>
    run("Deploy arena", async () => {
      if (!provider || !account)
        throw new Error("Connect a Shannon wallet first.");
      const wallet = await signer(provider, account);
      const data = encodeDeployData({
        abi: arenaAbi,
        bytecode: arenaArtifact.bytecode as Hex,
        args: [COLLATERAL, MODULE, CREATOR, VENUE],
      });
      const estimate = await publicClient.estimateGas({ account, data });
      const hash = await wallet.deployContract({
        abi: arenaAbi,
        bytecode: arenaArtifact.bytecode as Hex,
        args: [COLLATERAL, MODULE, CREATOR, VENUE],
        gas: (estimate * 150n) / 100n + 100_000n,
        gasPrice: await publicClient.getGasPrice(),
      });
      const receipt = await wait(hash, "Deploy arena");
      if (!receipt.contractAddress)
        throw new Error("No deployment address in receipt.");
      saveRegistry(receipt.contractAddress);
      setNotice(
        "Arena deployed on Shannon. Share this page URL so friends join the same arena.",
      );
    });
  const create = () =>
    run("Create royale", async () => {
      if (!registry || (!scheduled && !marketId))
        throw new Error("Select a live market.");
      if ((snapshot?.version ?? 0) < 5)
        throw new Error(
          "Custom tournament terms require the current V5 arena.",
        );
      if (hostEntryRaw > hostBankrollRaw)
        throw new Error("Entry contribution cannot exceed the starting vault.");
      if (BigInt(snapshot?.balance ?? 0) < hostSeatRaw)
        throw new Error(
          `The host needs ${cashFormat(hostSeatRaw)} tUSDC to fund their seat.`,
        );
      if (BigInt(snapshot?.allowance ?? 0) < hostSeatRaw)
        await tx("Approve host entry", COLLATERAL, tokenAbi, "approve", [
          registry,
          hostSeatRaw,
        ]);
      const block = await publicClient.getBlock();
      const scheduledStart =
        ((block.timestamp + BigInt(startDelay) + BigInt(duration) - 1n) /
          BigInt(duration)) *
          BigInt(duration) +
        15n;
      const receipt = scheduled
        ? await tx(
            "Schedule and join royale",
            registry,
            arenaAbi,
            "scheduleAndJoin",
            [
              scheduledStart,
              Number(capacity),
              Number(rounds),
              Number(minimum),
              BigInt(duration),
              hostEntryRaw,
              hostBankrollRaw,
            ],
          )
        : await tx(
            "Create and join royale",
            registry,
            arenaAbi,
            "createAndJoin",
            [
              marketId,
              block.timestamp + BigInt(joinWindow),
              Number(capacity),
              Number(rounds),
              hostEntryRaw,
              hostBankrollRaw,
            ],
          );
      let createdId = 0;
      for (const log of receipt.logs) {
        try {
          const event = decodeEventLog({
            abi: arenaAbi,
            data: log.data,
            topics: log.topics,
          });
          if (event.eventName === "Created")
            createdId = Number((event.args as unknown as { id: bigint }).id);
        } catch {}
      }
      if (createdId) {
        await fetch("/api/testnet/operations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            matchId: createdId,
            asset: scheduled ? assetPreference : undefined,
          }),
        }).catch(() => undefined);
        openMatch(createdId);
      }
    });
  const trade = () =>
    run(`${direction === "buy" ? "Buy" : "Sell"} ${side}`, async () => {
      if (!me || !canTrade)
        throw new Error(orderError || "Trading is not currently available.");
      const kind =
        side === "UP"
          ? direction === "buy"
            ? 0
            : 1
          : direction === "buy"
            ? 2
            : 3;
      const receipt = await tx(
        `${direction === "buy" ? "Buy" : "Sell"} ${side}`,
        me.vault,
        vaultAbi,
        "trade",
        [kind, side === "UP" ? orderPrice : 1_000_000n - orderPrice, orderQty],
      );
      const fill = receipt.logs.flatMap((log) => {
        try {
          const e = decodeEventLog({
            abi: vaultAbi,
            data: log.data,
            topics: log.topics,
          });
          return e.eventName === "Trade"
            ? [e.args as unknown as { shares: bigint; cashDelta: bigint }]
            : [];
        } catch {
          return [];
        }
      })[0];
      const realizedBasis =
        direction === "sell" &&
        fill &&
        positionBasis &&
        positionBasis.shares > 0n
          ? (positionBasis.basis * fill.shares) / positionBasis.shares
          : null;
      const realizedPnl =
        realizedBasis === null || !fill ? null : fill.cashDelta - realizedBasis;
      setNotice(
        fill
          ? `${cashFormat(fill.shares)} ${side} shares ${direction === "buy" ? "bought" : "sold"} · ${cashFormat(fill.cashDelta < 0n ? -fill.cashDelta : fill.cashDelta)} tUSDC ${fill.cashDelta < 0n ? "spent" : "received"}.${realizedPnl === null ? "" : ` Realized ${realizedPnl >= 0n ? "+" : "−"}${cashFormat(realizedPnl >= 0n ? realizedPnl : -realizedPnl)} tUSDC versus average cost.`} Unfilled remainder cancelled.`
          : "Transaction confirmed. Refreshing on-chain holdings.",
      );
    });
  const prepareClose = (outcome: "UP" | "DOWN") => {
    if (!m || !me) return;
    const holding = BigInt(outcome === "UP" ? me.yesShares : me.noShares);
    const level = outcome === "UP" ? m.bids[0] : m.asks[0];
    if (holding <= 0n || !level) return;
    const closePrice =
      outcome === "UP" ? BigInt(level.price) : ONE_SHARE - BigInt(level.price);
    setSide(outcome);
    setDirection("sell");
    setQuantity(cashFormat(holding));
    setPrice(cents(closePrice));
  };
  const sorted = [...(snapshot?.players ?? [])].sort((a, b) =>
    a.rank && b.rank
      ? a.rank - b.rank
      : a.active !== b.active
        ? a.active
          ? -1
          : 1
        : Number(BigInt(b.cash) - BigInt(a.cash)),
  );
  const roundOracle = (chart?.underlying ?? []).filter(
    (candle) =>
      candle.time >= (m?.start ?? 0) &&
      candle.time <= Math.min(now, m?.expiry ?? now),
  );
  const oracleOpen = roundOracle[0]?.open;
  const oracleNow = roundOracle.at(-1)?.close;
  const projectedOutcome =
    oracleOpen !== undefined && oracleNow !== undefined
      ? oracleNow >= oracleOpen
        ? "UP"
        : "DOWN"
      : null;
  const liveRace = (snapshot?.players ?? [])
    .filter((player) => player.active)
    .map((player, entrantIndex) => ({
      ...player,
      entrantIndex,
      projectedScore:
        BigInt(player.cash) +
        (projectedOutcome === "UP"
          ? BigInt(player.yesShares)
          : projectedOutcome === "DOWN"
            ? BigInt(player.noShares)
            : 0n),
    }))
    .sort((a, b) =>
      a.projectedScore === b.projectedScore
        ? a.entrantIndex - b.entrantIndex
        : a.projectedScore > b.projectedScore
          ? -1
          : 1,
    );
  const liveRankIndex = liveRace.findIndex((player) =>
    eq(player.wallet, account),
  );
  const projectionReady = projectedOutcome !== null;
  const liveRank =
    projectionReady && liveRankIndex >= 0 ? liveRankIndex + 1 : 0;
  const finalRound = Boolean(
    t && (t.round === t.maxRounds || liveRace.length <= 2),
  );
  const surviveCount = finalRound ? 1 : Math.ceil(liveRace.length / 2);
  const paidPlaces = (snapshot?.players.length ?? 0) >= 3 ? 3 : 1;
  const boardSafeCount = finalRound
    ? Math.min(paidPlaces, liveRace.length)
    : surviveCount;
  const raceBoundary =
    liveRank > 0 && liveRank <= surviveCount
      ? liveRace[surviveCount]
      : liveRace[surviveCount - 1];
  const livePlayer = liveRankIndex >= 0 ? liveRace[liveRankIndex] : null;
  const boundaryMargin =
    projectionReady && livePlayer && raceBoundary
      ? livePlayer.projectedScore - raceBoundary.projectedScore
      : null;
  const raceBoundaryRank =
    liveRank > 0 && liveRank <= surviveCount ? surviveCount + 1 : surviveCount;
  const projectedVault = projectionReady
    ? (livePlayer?.projectedScore ?? null)
    : null;
  const projectedTradingPnl =
    projectedVault === null
      ? null
      : projectedVault - BigInt(t?.bankroll ?? 10_000_000);
  const positionLabel = !me
    ? "SPECTATING"
    : BigInt(me.yesShares) === 0n && BigInt(me.noShares) === 0n
      ? "FLAT"
      : BigInt(me.yesShares) > BigInt(me.noShares)
        ? "LONG UP"
        : BigInt(me.noShares) > BigInt(me.yesShares)
          ? "LONG DOWN"
          : "SPLIT";
  const projectedPrize = (() => {
    if (!t || !liveRank) return 0n;
    const pool = BigInt(t.prizePool);
    const placesPaid = (snapshot?.players.length ?? 0) >= 3;
    const second = placesPaid ? (pool * 30n) / 128n : 0n;
    const third = placesPaid ? (pool * 18n) / 128n : 0n;
    if (liveRank === 1) return pool - second - third;
    if (liveRank === 2) return second;
    if (liveRank === 3) return third;
    return 0n;
  })();
  const projectedTotalReturn =
    projectedVault === null ? null : projectedVault + projectedPrize;
  const projectedNetResult =
    projectedTotalReturn === null || !t
      ? null
      : projectedTotalReturn - BigInt(t.bankroll) - BigInt(t.entryFee);
  const finalTradingPnl =
    t && me ? BigInt(me.cash) - BigInt(t.bankroll) : null;
  const finalNetResult =
    t && me
      ? BigInt(me.cash) +
        BigInt(me.prize) -
        BigInt(t.bankroll) -
        BigInt(t.entryFee)
      : null;
  const closeFinishCelebration = () => {
    if (registry && t && account)
      sessionStorage.setItem(
        `market-royale-finish:${registry}:${t.id}:${account}`,
        "seen",
      );
    setShowFinishCelebration(false);
  };
  const chooseRegistry = () =>
    run("Verify arena", async () => {
      if (!isAddress(registryDraft))
        throw new Error("Enter a valid contract address.");
      await json(`/api/testnet/state?registry=${registryDraft}`);
      saveRegistry(registryDraft);
      setSelected(0);
      setNotice("Arena bytecode and testnet contracts verified.");
    });
  const share = () =>
    run("Copy invitation", async () => {
      const url = new URL(location.href);
      if (registry) url.searchParams.set("registry", registry);
      if (t) url.searchParams.set("match", String(t.id));
      await navigator.clipboard.writeText(url.toString());
      setNotice(
        "Invitation copied. Open it in another wallet or browser. For another device, use a reachable app host instead of localhost.",
      );
    });
  const statusText = t ? PHASES[t.phase] : "";
  const playerProgress = progression?.profile;
  const seasonLevel = Number(playerProgress?.level ?? 1);
  const seasonXp = Number(playerProgress?.seasonXp ?? 0);
  const levelFloor = [0, 0, 500, 1000, 2500, 5000][seasonLevel] ?? 0;
  const levelCeiling = [0, 500, 1000, 2500, 5000, 5000][seasonLevel] ?? 5000;
  const levelProgress =
    seasonLevel >= 5
      ? 100
      : ((seasonXp - levelFloor) / (levelCeiling - levelFloor)) * 100;
  const activeRoyales =
    snapshot?.tournaments.filter((royale) => royale.phase < 3) ?? [];
  const nextJoinableRoyale = [...activeRoyales]
    .filter((royale) => {
      if (
        royale.phase !== 0 ||
        royale.id === t?.id ||
        now >= royale.joinDeadline
      )
        return false;
      const entered = Number(
        BigInt(royale.prizePool) / BigInt(royale.entryFee),
      );
      return entered < royale.capacity;
    })
    .sort((a, b) => a.joinDeadline - b.joinDeadline)[0];
  const joinNextRoyale = () => {
    if (nextJoinableRoyale) {
      openMatch(nextJoinableRoyale.id);
      return;
    }
    go("arena");
    window.setTimeout(
      () =>
        document
          .getElementById("active-royales")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      0,
    );
  };
  const featuredRoyale =
    activeRoyales.find((royale) => eq(royale.host, ops?.host)) ??
    activeRoyales[0];
  const featuredEntrants = featuredRoyale
    ? Number(BigInt(featuredRoyale.prizePool) / BigInt(featuredRoyale.entryFee))
    : 0;
  const currentLeague = Number(playerProgress?.league ?? 0);
  const survivalRate = Number(playerProgress?.completed ?? 0)
    ? Math.round(
        (Number(playerProgress?.topHalfFinishes ?? 0) /
          Number(playerProgress?.completed ?? 1)) *
          100,
      )
    : 0;
  const configureFormat = (
    nextCapacity: number,
    nextMinimum: number,
    nextRounds: number,
  ) => {
    setCapacity(String(nextCapacity));
    setMinimum(String(nextMinimum));
    setRounds(String(nextRounds));
    document
      .getElementById("host-royale")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const operatorCurrent = Boolean(
    ops?.enabled &&
    eq(ops.registry, registry) &&
    ops.lastRun &&
    Date.now() - ops.lastRun <= 90000 &&
    !ops.error,
  );
  const operatorText = ops
    ? ops.enabled && eq(ops.registry, registry)
      ? ops.error
        ? "Operator needs attention"
        : !ops.lastRun || Date.now() - ops.lastRun > 90000
          ? "Operator offline · manual recovery ready"
          : ops.pending
            ? ops.pending.label
            : "Operator online · auto starts and payouts"
      : ops.error
        ? "Operator needs attention"
        : "Manual event controls"
    : "Checking event operator";
  const renderNavigationPanel = (className: string, showAccount = false) => (
    <aside className={className} aria-label="Player navigation">
      <nav aria-label="Main navigation">
        {(
          [
            ["arena", "Arena"],
            ["profile", "Progress"],
            ["history", "History"],
            ["rules", "How it works"],
          ] as [Page, string][]
        ).map(([p, label]) => (
          <a
            key={p}
            href={`#${p}`}
            className={page === p ? "active" : ""}
            onClick={(event) => {
              event.preventDefault();
              go(p);
            }}
          >
            {p === "arena" ? (
              <Gamepad2 size={18} aria-hidden="true" />
            ) : p === "profile" ? (
              <Trophy size={18} aria-hidden="true" />
            ) : p === "history" ? (
              <Clock3 size={18} aria-hidden="true" />
            ) : (
              <ShieldCheck size={18} aria-hidden="true" />
            )}
            {label}
          </a>
        ))}
      </nav>
      <div className="mr-sidebar-promo">
        <span>TRADE. SURVIVE.</span>
        <strong>CLIMB HIGHER!</strong>
        <small>Host-selected entry · equal starting vaults</small>
        <img
          src="/art/characters/royale-runner-nova@1x.webp"
          srcSet="/art/characters/royale-runner-nova@1x.webp 1x, /art/characters/royale-runner-nova@2x.webp 2x"
          width="512"
          height="512"
          alt=""
          aria-hidden="true"
        />
      </div>
      <a
        className="brand"
        href="#arena"
        onClick={(e) => {
          e.preventDefault();
          go("arena");
        }}
      >
        <Crown size={15} aria-hidden="true" /> MARKET ROYALE
      </a>
      {showAccount && (
        <div className="header-account">
          {wallets.length > 1 && (
            <select
              aria-label="Active wallet"
              disabled={!!pending}
              value={walletId}
              onChange={(e) => {
                setAccount(null);
                setSnapshot(null);
                setWalletId(e.target.value);
              }}
            >
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          <span className="network">
            SHANNON <span>●</span>
          </span>
          <button className="button compact blue" onClick={() => go("wallet")}>
            {account ? (
              <PlayerAvatar
                seed={account}
                size="xs"
                league={currentLeague}
                label={`Avatar for ${short(account)}`}
                active={connected}
              />
            ) : (
              <Wallet size={16} />
            )}
            {account ? short(account) : "Connect wallet"}
          </button>
        </div>
      )}
    </aside>
  );
  const renderBrandMasthead = () => (
    <div className="mr-lobby-title">
      <p>
        TRADE REAL MARKETS
        <br />
        <strong>SURVIVE THE CUT</strong>
      </p>
      <img
        className="mr-title-decor mr-title-left-shine"
        src="/figma/purple-shine.svg"
        width="56"
        height="56"
        alt=""
        aria-hidden="true"
      />
      <img
        className="mr-title-decor mr-title-left-token"
        src="/figma/small-orange-orb.svg"
        width="56"
        height="56"
        alt=""
        aria-hidden="true"
      />
      <img
        className="mr-title-decor mr-title-left-spark"
        src="/figma/small-shine.svg"
        width="56"
        height="56"
        alt=""
        aria-hidden="true"
      />
      <img
        className="mr-title-decor mr-title-gem"
        src="/art/vendor/fluent-emoji/gem-stone-3d.png"
        width="256"
        height="256"
        alt=""
        aria-hidden="true"
      />
      <div className="mr-title-lockup">
        <img
          className="mr-wordmark-image"
          src="/art/brand/market-royale-wordmark-v2@1x.webp"
          srcSet="/art/brand/market-royale-wordmark-v2@1x.webp 1x, /art/brand/market-royale-wordmark-v2@2x.webp 2x"
          width="512"
          height="288"
          alt="Market Royale"
        />
      </div>
      <img
        className="mr-title-decor mr-title-coin"
        src="/art/vendor/fluent-emoji/coin-3d.png"
        width="256"
        height="256"
        alt=""
        aria-hidden="true"
      />
      <img
        className="mr-title-decor mr-title-sparkles"
        src="/art/vendor/fluent-emoji/sparkles-3d.png"
        width="256"
        height="256"
        alt=""
        aria-hidden="true"
      />
      <img
        className="mr-title-decor mr-title-orb mr-title-orb-left"
        src="/figma/purple-orb.svg"
        width="56"
        height="56"
        alt=""
        aria-hidden="true"
      />
      <img
        className="mr-title-decor mr-title-orb mr-title-orb-right"
        src="/figma/orange-orb.svg"
        width="56"
        height="56"
        alt=""
        aria-hidden="true"
      />
    </div>
  );
  if (!ready)
    return (
      <div className="initial-loader">
        <strong>MARKET ROYALE</strong>
        <div className="loading-track" />
        <p>Connecting to Shannon testnet…</p>
      </div>
    );
  return (
    <div className="app">
      <div className="sky-decoration" aria-hidden="true">
        <img
          className="sky-blob sky-blob-left"
          src="/figma/bg-green.svg"
          alt=""
        />
        <img
          className="sky-blob sky-blob-right"
          src="/figma/bg-blue.svg"
          alt=""
        />
      </div>
      <div
        className={`site-shell ${page === "arena" ? "arena-shell" : "inner-shell"} ${page}-shell`}
      >
        <div
          className={`demo-strip tn-network-strip ${page === "arena" ? "arena-hidden" : ""}`}
        >
          <span className="tn-network-state">
            <span className="status-dot" /> REAL TESTNET{" "}
            <span className="demo-detail">
              · Chain 50312 · tUSDC · Live DreamDEX markets
            </span>
          </span>
          <span
            className={`tn-operator-state ${operatorCurrent ? "is-online" : ""}`}
            title={ops?.error || operatorText}
          >
            <ShieldCheck size={13} />
            {operatorText}
          </span>
          <button disabled={Boolean(pending)} onClick={refresh}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
        {page !== "arena" && page !== "game" && renderBrandMasthead()}
        {page !== "arena" && renderNavigationPanel("mr-arena-sidebar")}
        <div
          className="tn-notification-stack"
          aria-label="Status notifications"
          aria-live="polite"
        >
          {snapshot?.version === 1 && (
            <div className="tn-alert">
              You are viewing the previous arena. New events use V2 safeguards.{" "}
              <button
                className="button blue compact"
                onClick={() => {
                  const a = process.env.NEXT_PUBLIC_ROYALE_ADDRESS;
                  if (a && isAddress(a)) {
                    saveRegistry(a);
                    setSelected(0);
                    go("arena");
                  }
                }}
              >
                OPEN CURRENT ARENA
              </button>
            </div>
          )}
          {(error || stateError) && (
            <div className="tn-alert" role="alert">
              <div>{error || stateError}</div>
              <button
                className="icon-button"
                onClick={() => {
                  setError("");
                  refresh();
                }}
                aria-label="Retry"
              >
                <RefreshCw size={18} />
              </button>
            </div>
          )}
          {t && ops?.issues?.[t.id] && (
            <div className="tn-alert">
              Event operator: {ops.issues[t.id].error} Retrying automatically;
              manual controls remain available.
            </div>
          )}
          {pending && (
            <div className="tn-progress" role="status">
              <span className="tn-spinner" />
              {pending}. Check your wallet if a signature is requested.
            </div>
          )}
          {notice && (
            <div className="tn-success" role="status">
              <Check size={18} />
              {notice}
              <button
                className="icon-button"
                aria-label="Dismiss"
                onClick={() => setNotice("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {account && chain !== CHAIN_ID && (
            <div className="tn-alert">
              Wallet is on another network.
              <button
                className="button blue compact"
                disabled={!!pending}
                onClick={() =>
                  run("Switch to Shannon", async () => {
                    const a = await connect(provider!);
                    setAccount(a);
                    setChain(CHAIN_ID);
                  })
                }
              >
                Switch to Shannon
              </button>
            </div>
          )}
        </div>
        <main className={`mr-page mr-page-${page}`}>
          {page === "arena" && (
            <>
              <section className="mr-lobby" id="arena">
                {renderBrandMasthead()}

                <div className="mr-lobby-grid">
                  {renderNavigationPanel("mr-arena-sidebar")}
                  <section className="mr-featured-event">
                    <div className="mr-featured-sky" aria-hidden="true">
                      <span className="mr-cloud mr-cloud-one" />
                      <span className="mr-cloud mr-cloud-two" />
                      <span className="mr-spark mr-spark-one">✦</span>
                      <span className="mr-spark mr-spark-two">◆</span>
                    </div>
                    <div className="mr-featured-copy">
                      <div className="mr-featured-labels">
                        <span
                          className={`pill ${featuredRoyale?.phase === 1 ? "pink" : "light"}`}
                        >
                          {featuredRoyale
                            ? featuredRoyale.phase === 0
                              ? "● ENROLLING"
                              : "● LIVE NOW"
                            : "NEXT EVENT"}
                        </span>
                        {featuredRoyale &&
                          eq(featuredRoyale.host, ops?.host) && (
                            <span className="pill light">OFFICIAL EVENT</span>
                          )}
                      </div>
                      <span className="mr-kicker">
                        {featuredRoyale
                          ? "FEATURED ROYALE"
                          : "THE ARENA IS READY"}
                      </span>
                      <h1>
                        {featuredRoyale
                          ? `ROYALE #${featuredRoyale.id}`
                          : "HOST THE FIRST ROYALE"}
                      </h1>
                      <h2>
                        {featuredRoyale
                          ? `${featuredRoyale.duration / 60} MINUTES · ${featuredRoyale.maxRounds} ROUND${featuredRoyale.maxRounds === 1 ? "" : "S"}`
                          : "REAL PLAYERS · FULL REFUNDS IF IT CANNOT START"}
                      </h2>
                    </div>
                    <img
                      className="mr-featured-mascot"
                      src="/art/characters/crown-host-inviting@1x.webp"
                      srcSet="/art/characters/crown-host-inviting@1x.webp 1x, /art/characters/crown-host-inviting@2x.webp 2x"
                      width="512"
                      height="512"
                      alt=""
                      aria-hidden="true"
                    />
                    <div className="mr-featured-details">
                      <div className="mr-prize">
                        <img
                          className="mr-detail-object"
                          src="/art/vendor/fluent-emoji/coin-3d.png"
                          width="256"
                          height="256"
                          alt=""
                          aria-hidden="true"
                        />
                        <span>Prize pool</span>
                        <strong>
                          {featuredRoyale
                            ? `${cashFormat(featuredRoyale.prizePool)} tUSDC`
                            : "Grows with entries"}
                        </strong>
                      </div>
                      <div className="mr-event-time">
                        <img
                          className="mr-detail-object"
                          src="/art/vendor/fluent-emoji/stopwatch-3d.png"
                          width="256"
                          height="256"
                          alt=""
                          aria-hidden="true"
                        />
                        <span>
                          {featuredRoyale?.phase === 0
                            ? "Entry closes in"
                            : "Status"}
                        </span>
                        <strong>
                          {featuredRoyale
                            ? featuredRoyale.phase === 0
                              ? seconds(featuredRoyale.joinDeadline - now)
                              : `ROUND ${featuredRoyale.round}`
                            : "OPEN TO HOST"}
                        </strong>
                      </div>
                      <div className="mr-entrant-row">
                        <div
                          className="mr-avatar-stack"
                          aria-label={`${featuredEntrants} confirmed entrants`}
                        >
                          {featuredRoyale && selected === featuredRoyale.id
                            ? snapshot?.players
                                .slice(0, 6)
                                .map((player) => (
                                  <PlayerAvatar
                                    key={player.wallet}
                                    seed={player.wallet}
                                    size="sm"
                                    label={short(player.wallet)}
                                    active={player.active}
                                  />
                                ))
                            : null}
                          {Array.from({
                            length: Math.max(
                              0,
                              Math.min(6, featuredEntrants) -
                                (selected === featuredRoyale?.id
                                  ? (snapshot?.players.length ?? 0)
                                  : 0),
                            ),
                          }).map((_, index) => (
                            <span
                              key={`entrant-${index}`}
                              className="mr-avatar-empty mr-avatar-confirmed"
                              role="img"
                              aria-label="Confirmed entrant"
                              title="Open the event to load this entrant's wallet identity"
                            >
                              <Users size={15} aria-hidden="true" />
                            </span>
                          ))}
                          {featuredEntrants === 0 && (
                            <span className="mr-avatar-empty">?</span>
                          )}
                        </div>
                        <strong>
                          {featuredRoyale
                            ? `${featuredEntrants}/${featuredRoyale.capacity} PLAYERS`
                            : "BE THE HOST"}
                        </strong>
                      </div>
                    </div>
                    <button
                      className="mr-join-button"
                      onClick={() =>
                        featuredRoyale
                          ? openMatch(featuredRoyale.id)
                          : document
                              .getElementById("host-royale")
                              ?.scrollIntoView({ behavior: "smooth" })
                      }
                    >
                      {featuredRoyale
                        ? featuredRoyale.phase === 0
                          ? "JOIN ROYALE"
                          : "VIEW LIVE RACE"
                        : "HOST A ROYALE"}
                      <ArrowRight size={24} aria-hidden="true" />
                    </button>
                  </section>

                  <div className="mr-format-stack">
                    <button
                      className="mr-format-card mr-duel-card"
                      onClick={() => configureFormat(2, 2, 1)}
                    >
                      <span className="mr-format-icon">
                        <img
                          src="/art/vendor/fluent-emoji/crossed-swords-3d.png"
                          width="256"
                          height="256"
                          alt=""
                        />
                      </span>
                      <span className="mr-format-copy">
                        <em>QUICK MATCH</em>
                        <strong>1V1 DUEL</strong>
                        <small>Head-to-head trading with one winner.</small>
                        <b>
                          <Clock3 size={13} /> 1 ROUND
                        </b>
                      </span>
                      <span className="mr-mode-avatars" aria-hidden="true">
                        <PlayerAvatar
                          seed={account ?? "duel-player"}
                          size="sm"
                          label=""
                        />
                        <PlayerAvatar seed="duel-rival" size="sm" label="" />
                      </span>
                      <ArrowRight size={22} />
                    </button>
                    <button
                      className="mr-format-card mr-open-card"
                      onClick={() => configureFormat(32, 2, 4)}
                    >
                      <span className="mr-format-icon">
                        <img
                          src="/art/vendor/fluent-emoji/shield-3d.png"
                          width="256"
                          height="256"
                          alt=""
                        />
                      </span>
                      <span className="mr-format-copy">
                        <em>LARGE LOBBY</em>
                        <strong>OPEN ROYALE</strong>
                        <small>
                          Survive successive cuts in a bigger field.
                        </small>
                        <b>
                          <Users size={13} /> UP TO 32 · 4 CUTS
                        </b>
                      </span>
                      <span
                        className="mr-mode-avatars mr-mode-avatar-crowd"
                        aria-hidden="true"
                      >
                        <PlayerAvatar
                          seed="royale-player-one"
                          size="sm"
                          label=""
                        />
                        <PlayerAvatar
                          seed={account ?? "royale-player-two"}
                          size="sm"
                          label=""
                        />
                        <PlayerAvatar
                          seed="royale-player-three"
                          size="sm"
                          label=""
                        />
                      </span>
                      <ArrowRight size={22} />
                    </button>
                  </div>

                  <aside className="mr-player-card">
                    <div className="mr-player-identity">
                      <PlayerAvatar
                        seed={account}
                        size="lg"
                        league={currentLeague}
                        label={
                          account
                            ? `Avatar for ${short(account)}`
                            : "Guest player"
                        }
                        active={connected}
                      />
                      <div>
                        <span>YOUR PLAYER</span>
                        <strong>
                          {account ? short(account) : "CONNECT TO PLAY"}
                        </strong>
                        <div className="mr-player-rank-row">
                          <small>
                            <Trophy size={12} />{" "}
                            {playerProgress
                              ? (LEAGUES[currentLeague] ?? "Bronze")
                              : "Unranked"}
                          </small>
                          <small>
                            <Sparkles size={12} />{" "}
                            {playerProgress ? seasonXp : 0} XP
                          </small>
                        </div>
                      </div>
                    </div>
                    <dl>
                      <div>
                        <dt>tUSDC</dt>
                        <dd>
                          {account && snapshot
                            ? cashFormat(snapshot.balance)
                            : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>Gas</dt>
                        <dd>
                          {account && snapshot
                            ? Number(formatEther(BigInt(snapshot.gas))).toFixed(
                                3,
                              )
                            : "—"}
                        </dd>
                      </div>
                    </dl>
                    <div className="mr-player-progress">
                      <div>
                        <strong>{playerProgress?.completed ?? "—"}</strong>
                        <span>ROYALES</span>
                      </div>
                      <div>
                        <strong>
                          {progression
                            ? progression.badges.filter(
                                (balance) => Number(balance) > 0,
                              ).length
                            : "—"}
                        </strong>
                        <span>BADGES</span>
                      </div>
                    </div>
                    {wallets.length > 1 && (
                      <label className="mr-player-wallet-select">
                        <span>ACTIVE WALLET</span>
                        <select
                          aria-label="Active player wallet"
                          disabled={!!pending}
                          value={walletId}
                          onChange={(event) => {
                            setAccount(null);
                            setSnapshot(null);
                            setWalletId(event.target.value);
                          }}
                        >
                          {wallets.map((wallet) => (
                            <option key={wallet.id} value={wallet.id}>
                              {wallet.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <button
                      className="button blue full"
                      onClick={() => go("wallet")}
                    >
                      {account ? "WALLET & SETUP" : "CONNECT WALLET"}
                      <ArrowRight size={17} />
                    </button>
                  </aside>

                  <section className="mr-daily-record">
                    <span className="eyebrow">TODAY&apos;S PLAYER RECORD</span>
                    <div>
                      <article>
                        <img
                          className="mr-record-icon"
                          src="/art/vendor/fluent-emoji/trophy-3d.png"
                          width="256"
                          height="256"
                          alt=""
                        />
                        <strong>{playerProgress?.wins ?? "—"}</strong>
                        <span>WINS</span>
                      </article>
                      <article>
                        <img
                          className="mr-record-icon"
                          src="/art/vendor/fluent-emoji/shield-3d.png"
                          width="256"
                          height="256"
                          alt=""
                        />
                        <strong>
                          {playerProgress ? `${survivalRate}%` : "—"}
                        </strong>
                        <span>SURVIVAL</span>
                      </article>
                      <article>
                        <img
                          className="mr-record-icon"
                          src="/art/vendor/fluent-emoji/gem-stone-3d.png"
                          width="256"
                          height="256"
                          alt=""
                        />
                        <strong>{playerProgress?.rating ?? "—"}</strong>
                        <span>RATING</span>
                      </article>
                      <article>
                        <img
                          className="mr-record-icon"
                          src="/art/vendor/fluent-emoji/stopwatch-3d.png"
                          width="256"
                          height="256"
                          alt=""
                        />
                        <strong>{playerProgress ? seasonXp : "—"}</strong>
                        <span>SEASON XP</span>
                      </article>
                    </div>
                  </section>
                </div>

                <div className="mr-arena-actions" id="active-royales">
                  <div>
                    <span className="eyebrow">ON-CHAIN EVENTS</span>
                    <h2>ALL ACTIVE ROYALES</h2>
                  </div>
                  {registry && (
                    <button className="text-link" onClick={share}>
                      Copy arena invite <ExternalLink size={14} />
                    </button>
                  )}
                </div>
              </section>
              {!registry ? (
                <section className="panel tn-empty">
                  <ShieldCheck size={34} />
                  <h3>Set up your on-chain arena</h3>
                  <p>
                    A shared tournament contract holds entries, enforces the
                    game, and pays prizes. Deploy it once from your testnet
                    wallet.
                  </p>
                  <button className="button blue" onClick={() => go("wallet")}>
                    SET UP ARENA <ArrowRight size={17} />
                  </button>
                </section>
              ) : (
                <>
                  <div className="tn-matches">
                    {snapshot?.tournaments
                      .filter((t) => t.phase < 3)
                      .map((t) => (
                        <button
                          key={t.id}
                          className="panel tn-match"
                          onClick={() => openMatch(t.id)}
                        >
                          <span className="pill blue">{PHASES[t.phase]}</span>
                          <h3>
                            ROYALE #{t.id}{" "}
                            {eq(t.host, ops?.host) && (
                              <span className="pill green">OFFICIAL</span>
                            )}
                          </h3>
                          <p>
                            {t.minPlayers} minimum · {t.capacity}-player
                            capacity · {t.maxRounds} round
                            {t.maxRounds === 1 ? "" : "s"}
                          </p>
                          <div>
                            <Stat
                              label="ENTERED"
                              value={`${Number(BigInt(t.prizePool) / BigInt(t.entryFee))} / ${t.capacity}`}
                            />
                            <Stat
                              label="PRIZE POOL"
                              value={`${cashFormat(t.prizePool)} tUSDC`}
                            />
                          </div>
                          <strong>
                            {t.phase === 0
                              ? `Entry ${now < t.joinDeadline ? "closes in " + seconds(t.joinDeadline - now) : "closed"}`
                              : `Round ${t.round}`}{" "}
                            <ArrowRight size={17} />
                          </strong>
                        </button>
                      ))}
                  </div>
                  {snapshot &&
                    !snapshot.tournaments.some((t) => t.phase < 3) && (
                      <section className="panel tn-empty mr-royale-empty">
                        <img
                          src="/art/vendor/fluent-emoji/sparkles-3d.png"
                          width="256"
                          height="256"
                          alt=""
                          aria-hidden="true"
                        />
                        <div>
                          <h3>No active royales right now</h3>
                          <p>
                            Host the next event and invite another funded
                            testnet wallet.
                          </p>
                        </div>
                        <button
                          className="button blue compact"
                          onClick={() =>
                            document
                              .getElementById("host-royale")
                              ?.scrollIntoView({ behavior: "smooth" })
                          }
                        >
                          HOST AN EVENT <ArrowRight size={15} />
                        </button>
                      </section>
                    )}
                  {snapshot?.hasOlder && (
                    <button
                      className="text-link"
                      onClick={() => setBefore(snapshot.nextBefore!)}
                    >
                      Load older royales
                    </button>
                  )}
                  {before > 0 && (
                    <button className="text-link" onClick={() => setBefore(0)}>
                      Back to latest
                    </button>
                  )}
                  <section className="panel tn-create" id="host-royale">
                    <div>
                      <span className="eyebrow">HOST A ROYALE</span>
                      <h2>CHOOSE YOUR BATTLEGROUND</h2>
                      <p>
                        Hosting also enters you as player one. Choose equal
                        entry and bankroll terms for every player before the
                        lobby opens.
                      </p>
                      <p className="small mr-host-note">
                        {scheduled
                          ? "Scheduled events follow your selected DreamDEX asset and align with its next published window. The confirmed lobby shows the exact start time. "
                          : "Quick matches enter the selected asset's current active market. Its countdown updates every second and live market data refreshes every 20 seconds. "}
                        {ops?.botBackfill
                          ? "Training bots backfill and operate every local test match."
                          : "Official-host events receive automatic operation."}
                      </p>
                    </div>
                    <div className="tn-tabs">
                      <button
                        className={scheduled ? "selected" : ""}
                        onClick={() => setScheduled(true)}
                      >
                        Scheduled event
                      </button>
                      <button
                        className={!scheduled ? "selected" : ""}
                        onClick={() => setScheduled(false)}
                      >
                        Quick match
                      </button>
                    </div>
                    {scheduled && (
                      <div className="tn-form-grid">
                        <label>
                          MINIMUM NOTICE
                          <select
                            value={startDelay}
                            onChange={(e) => setStartDelay(e.target.value)}
                          >
                            <option value="180">
                              Next window · at least 3 minutes
                            </option>
                            <option value="300">5 minutes</option>
                            <option value="600">10 minutes</option>
                            <option value="3600">1 hour</option>
                            <option value="86400">Tomorrow</option>
                          </select>
                        </label>
                        <label>
                          MINIMUM PLAYERS
                          <select
                            value={minimum}
                            onChange={(e) => setMinimum(e.target.value)}
                          >
                            {[2, 4, 8, 16, 32, 64]
                              .filter((n) => n <= Number(capacity))
                              .map((n) => (
                                <option key={n}>{n}</option>
                              ))}
                          </select>
                        </label>
                        <label>
                          MARKET ASSET
                          <select
                            value={assetPreference}
                            onChange={(e) => setAssetPreference(e.target.value)}
                          >
                            {["BTC", "ETH"].map((asset) => (
                              <option
                                key={asset}
                                value={asset}
                                disabled={!availableAssets.includes(asset)}
                              >
                                {asset}
                                {availableAssets.includes(asset)
                                  ? ""
                                  : " · unavailable now"}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          MARKET WINDOW
                          <select
                            value={duration}
                            onChange={(e) => setDuration(e.target.value)}
                          >
                            {[
                              [900, "15 minutes"],
                              [3600, "60 minutes"],
                              ...(availableDurations.includes(300)
                                ? ([[300, "5 minutes"]] as const)
                                : []),
                            ].map(([seconds, label]) => {
                              const available = availableDurations.includes(
                                Number(seconds),
                              );
                              return (
                                <option
                                  key={seconds}
                                  value={seconds}
                                  disabled={!available}
                                >
                                  {label}
                                  {available ? "" : " · unavailable now"}
                                </option>
                              );
                            })}
                          </select>
                        </label>
                      </div>
                    )}
                    <div className="tn-form-grid">
                      {!scheduled && (
                        <label>
                          MARKET ASSET
                          <select
                            value={assetPreference}
                            onChange={(e) => setAssetPreference(e.target.value)}
                          >
                            {["BTC", "ETH"].map((asset) => (
                              <option
                                key={asset}
                                value={asset}
                                disabled={!quickAvailableAssets.includes(asset)}
                              >
                                {asset}
                                {quickAvailableAssets.includes(asset)
                                  ? ""
                                  : " · no eligible market"}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label>
                        ENTRY CONTRIBUTION
                        <select
                          value={entryFee}
                          onChange={(e) => setEntryFee(e.target.value)}
                        >
                          {[1, 2, 5, 10, 25, 50].map((n) => (
                            <option
                              key={n}
                              value={n}
                              disabled={n > Number(startingBankroll)}
                            >
                              {n} tUSDC
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        STARTING VAULT
                        <select
                          value={startingBankroll}
                          onChange={(e) => {
                            setStartingBankroll(e.target.value);
                            if (Number(entryFee) > Number(e.target.value))
                              setEntryFee(e.target.value);
                          }}
                        >
                          {[5, 10, 25, 50, 100, 250].map((n) => (
                            <option key={n} value={n}>
                              {n} tUSDC
                            </option>
                          ))}
                        </select>
                      </label>
                      <label hidden={scheduled}>
                        LIVE MARKET
                        <select
                          value={marketId}
                          onChange={(e) => setMarketId(e.target.value)}
                        >
                          {!quickMarkets.length && (
                            <option value="">
                              No eligible {assetPreference} market right now
                            </option>
                          )}
                          {quickMarkets.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.asset} · {Number((m.interval / 60).toFixed(2))}{" "}
                              min · expires{" "}
                              {new Date(m.expiry * 1000).toLocaleTimeString()} ·{" "}
                              {m.asks.length && m.bids.length
                                ? "quotes available"
                                : "needs liquidity"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        CAPACITY
                        <select
                          value={capacity}
                          onChange={(e) => {
                            setCapacity(e.target.value);
                            setMinimum(
                              String(
                                Math.min(
                                  Number(minimum),
                                  Number(e.target.value),
                                ),
                              ),
                            );
                            setRounds(e.target.value === "2" ? "1" : "4");
                          }}
                        >
                          {[2, 4, 8, 16, 32, 64].map((n) => (
                            <option key={n}>{n}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        MAX ROUNDS
                        <select
                          value={rounds}
                          onChange={(e) => setRounds(e.target.value)}
                        >
                          {[1, 2, 3, 4].map((n) => (
                            <option key={n}>{n}</option>
                          ))}
                        </select>
                      </label>
                      <label hidden={scheduled}>
                        ENROLLMENT
                        <select
                          value={joinWindow}
                          onChange={(e) => setJoinWindow(e.target.value)}
                        >
                          <option value="60">60 seconds</option>
                          <option value="120">2 minutes</option>
                          <option value="300">5 minutes</option>
                        </select>
                      </label>
                    </div>
                    {!scheduled && (
                      <div className="tn-quick-summary">
                        <div className="tn-quick-summary-head">
                          <span className="tn-quick-summary-icon">
                            <Clock3 size={21} aria-hidden="true" />
                          </span>
                          <div>
                            <strong>QUICK MATCH USES THE LIVE MARKET</strong>
                            <p>
                              Joining does not restart its clock. Your first
                              round ends when the selected DreamDEX market
                              closes.
                            </p>
                          </div>
                        </div>
                        {marketError ? (
                          <div
                            className="tn-quick-state"
                            role="status"
                            aria-live="polite"
                          >
                            <p>Could not refresh live DreamDEX timing.</p>
                            <button
                              type="button"
                              className="text-link"
                              onClick={refresh}
                            >
                              Retry market feed
                            </button>
                          </div>
                        ) : !marketAt ? (
                          <div
                            className="tn-quick-state"
                            role="status"
                            aria-live="polite"
                          >
                            <span className="tn-spinner" aria-hidden="true" />
                            <p>Reading live DreamDEX markets…</p>
                          </div>
                        ) : !quickMarket ? (
                          <div
                            className="tn-quick-state"
                            role="status"
                            aria-live="polite"
                          >
                            <p>
                              No {assetPreference} market has enough time left
                              for the selected enrollment window.
                            </p>
                            {quickAvailableAssets.some(
                              (asset) => asset !== assetPreference,
                            ) && (
                              <button
                                type="button"
                                className="text-link"
                                onClick={() =>
                                  setAssetPreference(
                                    quickAvailableAssets.find(
                                      (asset) => asset !== assetPreference,
                                    )!,
                                  )
                                }
                              >
                                Use available asset
                              </button>
                            )}
                          </div>
                        ) : (
                          <>
                            <div className="tn-quick-timeline">
                              <div>
                                <span>ENTRY CLOSES</span>
                                <strong>{seconds(Number(joinWindow))}</strong>
                                <small>after creation</small>
                              </div>
                              <div>
                                <span>ROUND 1 CLOSES</span>
                                <strong>
                                  {seconds(quickMarket.expiry - now)}
                                </strong>
                                <small>{localTime(quickMarket.expiry)}</small>
                              </div>
                              <div>
                                <span>EST. FINAL RESULT</span>
                                <strong>
                                  {seconds(quickEstimatedCompletion - now)}
                                </strong>
                                <small>
                                  ~{localTime(quickEstimatedCompletion)} · up to{" "}
                                  {quickRoundLimit} round
                                  {quickRoundLimit === 1 ? "" : "s"}
                                </small>
                              </div>
                            </div>
                            <p className="tn-quick-footnote">
                              {quickMarket.asset} · {quickMarket.interval / 60}
                              -minute market · feed updated{" "}
                              {Math.max(
                                0,
                                Math.floor((Date.now() - marketAt) / 1000),
                              )}
                              s ago. Settlement time includes an oracle and
                              batch-processing estimate; recovery unlocks after
                              a 15-minute oracle delay.
                            </p>
                          </>
                        )}
                      </div>
                    )}
                    <button
                      className="button green"
                      disabled={
                        !allowed ||
                        (snapshot?.version ?? 0) < 5 ||
                        hostEntryRaw > hostBankrollRaw ||
                        BigInt(snapshot?.balance ?? 0) < hostSeatRaw ||
                        (scheduled &&
                          (!availableDurations.includes(Number(duration)) ||
                            !!marketError ||
                            Date.now() - marketAt > 40000)) ||
                        (!scheduled &&
                          (!marketId ||
                            !!marketError ||
                            Date.now() - marketAt > 40000))
                      }
                      onClick={create}
                    >
                      {scheduled ? "HOST & JOIN EVENT" : "CREATE & JOIN ROYALE"}{" "}
                      <Zap size={18} />
                    </button>
                    <p className="small muted">
                      Your seat locks {entryFee} tUSDC into the prize pool and{" "}
                      {startingBankroll} tUSDC into your isolated vault. Total:{" "}
                      {cashFormat(hostSeatRaw)} tUSDC.
                    </p>
                    {scheduled && (
                      <p className="small muted">
                        The royale starts on a newly opened{" "}
                        {Number(duration) / 60}-minute DreamDEX window. If that
                        window is unavailable, the event remains recoverable and
                        player funds can be refunded.
                      </p>
                    )}
                    {!account && (
                      <p className="small">
                        Connect your wallet to create a royale.
                      </p>
                    )}
                  </section>
                </>
              )}
              <section className="panel tn-live-markets">
                <div className="split">
                  <h2>LIVE DREAMDEX MARKETS</h2>
                  <span className="small muted">
                    {marketAt
                      ? `Updated ${Math.max(0, Math.floor((Date.now() - marketAt) / 1000))}s ago`
                      : "Reading chain…"}
                  </span>
                </div>
                {marketError ? (
                  <p className="error">{marketError}</p>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>MARKET</th>
                          <th>WINDOW</th>
                          <th>UP ASK</th>
                          <th>DOWN ASK</th>
                          <th>EXPIRES</th>
                        </tr>
                      </thead>
                      <tbody>
                        {live
                          .filter((m) => m.expiry > now)
                          .map((m) => (
                            <tr key={m.id}>
                              <td>
                                <span className="tn-market-identity">
                                  <img
                                    src={
                                      m.asset === "BTC"
                                        ? "/art/vendor/fluent-emoji/coin-3d.png"
                                        : "/art/vendor/fluent-emoji/gem-stone-3d.png"
                                    }
                                    width="256"
                                    height="256"
                                    alt=""
                                    aria-hidden="true"
                                  />
                                  <span>
                                    <strong>{m.asset}</strong>
                                    <small>{m.question}</small>
                                  </span>
                                </span>
                              </td>
                              <td>
                                {Number((m.interval / 60).toFixed(2))} min
                              </td>
                              <td>
                                {m.asks[0]
                                  ? `${cents(m.asks[0].price)}¢`
                                  : "No liquidity"}
                              </td>
                              <td>
                                {m.bids[0]
                                  ? `${(1e6 - Number(m.bids[0].price)) / 10000}¢`
                                  : "No liquidity"}
                              </td>
                              <td>
                                <a
                                  href={`${EXPLORER}/address/${m.market}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {seconds(m.expiry - now)} ↗
                                </a>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                    {Boolean(marketAt) && !live.some((m) => m.expiry > now) && (
                      <p>
                        No unexpired markets were returned by the testnet. Retry
                        when a new window opens.
                      </p>
                    )}
                  </div>
                )}
              </section>
            </>
          )}
          {page === "game" && (
            <>
              {showFinishCelebration && t?.phase === 3 && me && (
                <div className="mr-finish-overlay">
                  <button
                    className="mr-finish-dismiss-layer"
                    aria-label="Close result card"
                    onClick={closeFinishCelebration}
                  />
                  <section
                    className={`mr-finish-card rank-${Math.min(me.rank, 4)}`}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="mr-finish-title"
                    tabIndex={-1}
                    ref={finishDialogRef}
                  >
                    <button
                      className="mr-finish-close"
                      aria-label="Close result card"
                      onClick={closeFinishCelebration}
                    >
                      <X size={20} />
                    </button>
                    <div className="mr-finish-confetti" aria-hidden="true">
                      {Array.from({ length: 10 }).map((_, index) => (
                        <i key={index} />
                      ))}
                    </div>
                    <header className="mr-finish-hero">
                      <span className="eyebrow">
                        ROYALE #{t.id} · VERIFIED RESULT
                      </span>
                      <img
                        src={
                          me.rank === 1
                            ? "/art/vendor/fluent-emoji/trophy-3d.png"
                            : me.rank <= 3
                              ? "/art/vendor/fluent-emoji/coin-3d.png"
                              : "/art/vendor/fluent-emoji/crossed-swords-3d.png"
                        }
                        alt=""
                        aria-hidden="true"
                      />
                      <div>
                        <strong className="mr-finish-rank">#{me.rank}</strong>
                        <h2 id="mr-finish-title">
                          {me.rank === 1
                            ? "ROYALE CHAMPION!"
                            : me.rank <= 3
                              ? "PODIUM FINISH!"
                              : "ROYALE COMPLETE!"}
                        </h2>
                        <p>
                          {me.rank === 1
                            ? "You out-traded the field and claimed the crown."
                            : `You finished ahead of ${Math.max(0, snapshot!.players.length - me.rank)} players.`}
                        </p>
                      </div>
                    </header>
                    <div className="mr-finish-podium" aria-label="Top three finishers">
                      {sorted.slice(0, 3).map((player) => (
                        <article
                          key={player.wallet}
                          className={eq(player.wallet, account) ? "you" : ""}
                        >
                          <b>#{player.rank}</b>
                          <PlayerAvatar
                            seed={player.wallet}
                            size="sm"
                            label={playerName(player.wallet, account)}
                            active
                          />
                          <span>{playerName(player.wallet, account)}</span>
                          <small>{cashFormat(player.cash)} tUSDC</small>
                        </article>
                      ))}
                    </div>
                    <div className="mr-finish-stats">
                      <article>
                        <span>TRADING P&amp;L</span>
                        <strong
                          className={
                            finalTradingPnl !== null && finalTradingPnl >= 0n
                              ? "positive"
                              : "negative"
                          }
                        >
                          {finalTradingPnl !== null && finalTradingPnl >= 0n
                            ? "+"
                            : "−"}
                          {cashFormat(
                            finalTradingPnl !== null && finalTradingPnl >= 0n
                              ? finalTradingPnl
                              : -(finalTradingPnl ?? 0n),
                          )}
                        </strong>
                      </article>
                      <article>
                        <span>PRIZE</span>
                        <strong>{cashFormat(me.prize)} tUSDC</strong>
                      </article>
                      <article>
                        <span>NET AFTER ENTRY</span>
                        <strong
                          className={
                            finalNetResult !== null && finalNetResult >= 0n
                              ? "positive"
                              : "negative"
                          }
                        >
                          {finalNetResult !== null && finalNetResult >= 0n
                            ? "+"
                            : "−"}
                          {cashFormat(
                            finalNetResult !== null && finalNetResult >= 0n
                              ? finalNetResult
                              : -(finalNetResult ?? 0n),
                          )}
                        </strong>
                      </article>
                      <article>
                        <span>PROGRESSION</span>
                        <strong>
                          {progression?.preview
                            ? `${Number(progression.preview.delta) >= 0 ? "+" : ""}${progression.preview.delta} RP · +${progression.preview.xp} XP`
                            : "RECORDING…"}
                        </strong>
                      </article>
                    </div>
                    <div className="mr-finish-rewards">
                      <span className="eyebrow">ACHIEVEMENT CABINET</span>
                      <div>
                        {BADGES.map((badge, index) =>
                          Number(progression?.badges[index] ?? 0) > 0 ? (
                            <span key={badge.name} title={badge.name}>
                              <img src={badge.asset} alt="" aria-hidden="true" />
                              {badge.name}
                            </span>
                          ) : null,
                        )}
                        {!progression?.badges.some(
                          (balance) => Number(balance) > 0,
                        ) && (
                          <small>
                            The operator is recording your XP and eligible badges
                            on Shannon.
                          </small>
                        )}
                      </div>
                    </div>
                    <footer className="mr-finish-actions">
                      <span
                        className={`pill ${progression?.preview?.canRecord ? "purple" : "green"}`}
                      >
                        {progression?.preview?.canRecord
                          ? "ON-CHAIN RECORD PENDING"
                          : "RECORDED ON SHANNON"}
                      </span>
                      <button className="button blue" onClick={share}>
                        SHARE RESULT <ExternalLink size={16} />
                      </button>
                      <button
                        className="button green"
                        onClick={() => {
                          closeFinishCelebration();
                          go("profile");
                        }}
                      >
                        VIEW PROGRESSION <ArrowRight size={16} />
                      </button>
                    </footer>
                  </section>
                </div>
              )}
              {!t ? (
                <section className="panel tn-empty mr-game-empty">
                  <img
                    className="tn-empty-art"
                    src="/art/vendor/fluent-emoji/crossed-swords-3d.png"
                    width="256"
                    height="256"
                    alt=""
                    aria-hidden="true"
                  />
                  <h2>
                    {loading ? "Loading on-chain match…" : "Choose a royale"}
                  </h2>
                  <p>
                    {selected
                      ? "The selected match has not been verified. Check your arena address or retry."
                      : "Join or create a match from the arena."}
                  </p>
                  <button className="button blue" onClick={() => go("arena")}>
                    VIEW ARENA
                  </button>
                </section>
              ) : (
                <>
                  <div className="page-heading split mr-game-heading">
                    <div>
                      <button
                        className="mr-game-back"
                        onClick={() => go("arena")}
                      >
                        <ArrowLeft size={15} /> ARENA
                      </button>
                      <span className="eyebrow">
                        ROYALE #{t.id} · ROUND {t.round}/{t.maxRounds} ·{" "}
                        {statusText}
                      </span>
                      <h1>
                        {m?.asset ?? "EVENT"} ·{" "}
                        {(m?.interval ?? t.duration) / 60} MIN
                      </h1>
                      <p>{m?.question}</p>
                    </div>
                    <div className="mr-game-heading-actions">
                      {t.phase === 1 && (
                        <span className="mr-game-clock">
                          <Clock3 size={16} />
                          <small>MARKET CLOSE</small>
                          <strong>{seconds(t.expiry - now)}</strong>
                        </span>
                      )}
                      {t.phase === 1 && (
                        <button
                          className="button green compact mr-next-royale"
                          onClick={joinNextRoyale}
                          title={
                            nextJoinableRoyale
                              ? `Open enrolling Royale #${nextJoinableRoyale.id}`
                              : "View upcoming and enrolling royales"
                          }
                        >
                          {nextJoinableRoyale
                            ? `JOIN NEXT · #${nextJoinableRoyale.id}`
                            : "JOIN NEXT ROYALE"}
                          <ArrowRight size={15} />
                        </button>
                      )}
                      <button className="button blue compact" onClick={share}>
                        {t.phase === 0
                          ? "INVITE PLAYERS"
                          : t.phase >= 3
                            ? "SHARE RESULTS"
                            : "SHARE MATCH"}{" "}
                        {t.phase === 0 ? (
                          <Users size={16} />
                        ) : (
                          <ExternalLink size={15} />
                        )}
                      </button>
                    </div>
                  </div>
                  {t.phase === 1 ? (
                    <div className="mr-game-statusbar panel">
                      <span>
                        <small>BANKROLL</small>
                        <strong>{me ? cashFormat(me.cash) : "—"} tUSDC</strong>
                      </span>
                      <span>
                        <small>DREAMDEX POSITION</small>
                        <strong>{positionLabel}</strong>
                        <em>
                          {me
                            ? `${cashFormat(me.yesShares)} UP · ${cashFormat(me.noShares)} DOWN`
                            : "Connect a player wallet"}
                        </em>
                      </span>
                      <span>
                        <small>PROJECTED VAULT</small>
                        <strong>
                          {projectedVault === null
                            ? "—"
                            : `${cashFormat(projectedVault)} tUSDC`}
                        </strong>
                        <em>
                          {projectedOutcome
                            ? `IF ${projectedOutcome} SETTLES NOW`
                            : "Waiting for oracle"}
                        </em>
                      </span>
                      <span>
                        <small>FILLED TRADES</small>
                        <strong>{me ? me.actions : "—"}</strong>
                        <em>UNLIMITED UNTIL CLOSE</em>
                      </span>
                      <span>
                        <small>LIVE RANK</small>
                        <strong>
                          {liveRank ? `#${liveRank} / ${liveRace.length}` : "—"}
                        </strong>
                      </span>
                      <span>
                        <small>PROJECTED REWARD</small>
                        <strong>
                          {liveRank
                            ? `${cashFormat(projectedPrize)} tUSDC`
                            : "—"}
                        </strong>
                        <em>
                          {liveRank
                            ? `RANK #${liveRank} · POOL ${cashFormat(t.prizePool)}`
                            : "Spectator mode"}
                        </em>
                      </span>
                    </div>
                  ) : (
                    <div className="tn-match-stats panel">
                      <Stat
                        label="ACTUAL ENTRANTS"
                        value={`${snapshot!.players.length} / ${t.capacity}`}
                      />
                      <Stat
                        label="FUNDED PRIZES"
                        value={`${cashFormat(t.prizePool)} tUSDC`}
                      />
                      <Stat
                        label="ROUND"
                        value={`${t.round} / ${t.maxRounds}`}
                      />
                      <Stat
                        label={t.phase === 0 ? "ENTRY CLOSES" : "STATUS"}
                        value={
                          t.phase === 0
                            ? seconds(t.joinDeadline - now)
                            : statusText
                        }
                      />
                    </div>
                  )}
                  {t.phase === 0 && (
                    <div className="detail-grid tn-spacing">
                      <section className="panel">
                        <span className="eyebrow">THE LOBBY</span>
                        <h2>
                          {me
                            ? "YOU’RE IN. GET READY."
                            : "YOUR SEAT IS WAITING."}
                        </h2>
                        <p>
                          Starts{" "}
                          {new Date(t.joinDeadline * 1000).toLocaleString()}{" "}
                          with at least {t.minPlayers} funded players. Everyone
                          trades the same live market from isolated vaults.
                        </p>
                        <dl>
                          <div>
                            <dt>Prize contribution</dt>
                            <dd>{cashFormat(t.entryFee)} tUSDC</dd>
                          </div>
                          <div>
                            <dt>Your trading bankroll</dt>
                            <dd>{cashFormat(t.bankroll)} tUSDC</dd>
                          </div>
                          <div>
                            <dt>Total transferred on entry</dt>
                            <dd>
                              {cashFormat(selectedSeatRaw)} tUSDC + STT gas
                            </dd>
                          </div>
                        </dl>
                        <p className="small muted">
                          Minimum {t.minPlayers} players. If turnout is too low
                          or the event cannot start within two minutes, entry
                          and bankroll are refundable. Network gas is not
                          refundable.
                        </p>
                        {now < t.joinDeadline - 600 && (
                          <p>
                            Funded entry opens{" "}
                            {new Date(
                              (t.joinDeadline - 600) * 1000,
                            ).toLocaleString()}
                            . No deposit is needed while you wait.
                          </p>
                        )}
                        {me && now < t.joinDeadline && (
                          <button
                            className="button blue full"
                            disabled={!allowed}
                            onClick={() =>
                              run("Leave and refund", async () => {
                                await tx(
                                  "Leave and refund",
                                  registry!,
                                  arenaAbi,
                                  "leave",
                                  [BigInt(t.id)],
                                );
                              })
                            }
                          >
                            LEAVE · RETURN {cashFormat(selectedSeatRaw)} tUSDC
                          </button>
                        )}
                        {!me &&
                          now >= t.joinDeadline - 600 &&
                          now < t.joinDeadline && (
                            <>
                              <label className="checkbox">
                                <input
                                  type="checkbox"
                                  checked={accepted}
                                  onChange={(e) =>
                                    setAccepted(e.target.checked)
                                  }
                                />
                                <span>
                                  I understand the {cashFormat(t.entryFee)}{" "}
                                  tUSDC entry funds the prizes and my{" "}
                                  {cashFormat(t.bankroll)} tUSDC vault can gain
                                  or lose test tokens.
                                </span>
                              </label>
                              {BigInt(snapshot?.allowance ?? 0) <
                              selectedSeatRaw ? (
                                <button
                                  className="button blue full"
                                  disabled={
                                    !allowed ||
                                    !accepted ||
                                    BigInt(snapshot?.balance ?? 0) <
                                      selectedSeatRaw
                                  }
                                  onClick={() =>
                                    run(
                                      `Approve ${cashFormat(selectedSeatRaw)} tUSDC`,
                                      async () => {
                                        await tx(
                                          `Approve ${cashFormat(selectedSeatRaw)} tUSDC`,
                                          COLLATERAL,
                                          tokenAbi,
                                          "approve",
                                          [registry!, selectedSeatRaw],
                                        );
                                      },
                                    )
                                  }
                                >
                                  1. APPROVE {cashFormat(selectedSeatRaw)} tUSDC
                                </button>
                              ) : (
                                <button
                                  className="button green full"
                                  disabled={
                                    !allowed ||
                                    !accepted ||
                                    BigInt(snapshot?.balance ?? 0) <
                                      selectedSeatRaw ||
                                    snapshot!.players.length >= t.capacity
                                  }
                                  onClick={join}
                                >
                                  2. JOIN ROYALE
                                </button>
                              )}
                              {!account ? (
                                <button
                                  className="text-link"
                                  onClick={() => go("wallet")}
                                >
                                  Connect your wallet first
                                </button>
                              ) : (
                                BigInt(snapshot?.balance ?? 0) <
                                  selectedSeatRaw && (
                                  <button
                                    className="text-link"
                                    onClick={() => go("wallet")}
                                  >
                                    Get testnet funds in Wallet
                                  </button>
                                )
                              )}
                            </>
                          )}
                        {now >= t.joinDeadline &&
                          snapshot!.players.length >= t.minPlayers &&
                          now <= t.joinDeadline + START_GRACE &&
                          (t.scheduled || now < t.expiry - 120) && (
                            <div className="inset">
                              <p>
                                The event operator starts official events
                                automatically. You can also start a liquid
                                market below.
                              </p>
                              {(t.scheduled
                                ? live.filter(
                                    (n) =>
                                      n.interval === t.duration &&
                                      (!ops?.assetPreferences?.[String(t.id)] ||
                                        n.asset ===
                                          ops.assetPreferences[String(t.id)]) &&
                                      n.start >= t.joinDeadline - 60 &&
                                      n.expiry > now + 120 &&
                                      n.status === 1,
                                  )
                                : [m].filter(Boolean)
                              ).map(
                                (n) =>
                                  n && (
                                    <button
                                      key={n.id}
                                      className="button green full"
                                      disabled={!allowed}
                                      onClick={() =>
                                        run("Start royale", async () => {
                                          await tx(
                                            "Start royale",
                                            registry!,
                                            arenaAbi,
                                            t.scheduled
                                              ? "startScheduled"
                                              : "start",
                                            t.scheduled
                                              ? [BigInt(t.id), n.id]
                                              : [BigInt(t.id)],
                                          );
                                        })
                                      }
                                    >
                                      START {n.asset} · {n.interval / 60} MIN
                                    </button>
                                  ),
                              )}
                            </div>
                          )}
                      </section>
                      <section className="panel">
                        <h2>JOINED PLAYERS</h2>
                        {snapshot!.players.length ? (
                          snapshot!.players.map((p) => (
                            <div className="tn-player" key={p.wallet}>
                              <PlayerAvatar
                                seed={p.wallet}
                                size="sm"
                                label={playerName(p.wallet, account)}
                                active={p.active}
                              />
                              <strong className="mr-standing-player">
                                <PlayerAvatar
                                  seed={p.wallet}
                                  size="xs"
                                  label={playerName(p.wallet, account)}
                                  active={p.active}
                                />
                                {playerName(p.wallet, account)}
                              </strong>
                              <span
                                className={`pill ${isTrainingBot(p.wallet) ? "purple" : "green"}`}
                              >
                                {isTrainingBot(p.wallet)
                                  ? "BOT · FUNDED"
                                  : "FUNDED"}
                              </span>
                            </div>
                          ))
                        ) : (
                          <div className="empty">
                            <Users size={36} />
                            <p>
                              No players yet. Share the match link with a
                              friend.
                            </p>
                          </div>
                        )}
                      </section>
                    </div>
                  )}
                  {t.phase === 1 ? (
                    <div className="mr-trading-workspace">
                      <aside
                        className="panel mr-battle-sidebar"
                        aria-label="Live royale standings"
                      >
                        <header>
                          <img
                            src="/art/vendor/fluent-emoji/trophy-3d.png"
                            alt=""
                          />
                          <div>
                            <span className="eyebrow">LIVE ROYALE</span>
                            <h2>BATTLE BOARD</h2>
                          </div>
                          <span className="pill green">
                            {liveRace.length} LEFT
                          </span>
                        </header>

                        <div className="mr-battle-score">
                          <span>YOUR POSITION</span>
                          <div>
                            <strong>{liveRank ? `#${liveRank}` : "—"}</strong>
                            <small>/ {liveRace.length}</small>
                            <b
                              className={
                                !projectionReady
                                  ? undefined
                                  : liveRank &&
                                      (liveRank <= surviveCount ||
                                        (finalRound && projectedPrize > 0n))
                                    ? "safe"
                                    : "danger"
                              }
                            >
                              {!me?.active
                                ? "OUT"
                                : !projectionReady
                                  ? "CALCULATING"
                                  : finalRound
                                    ? liveRank === 1
                                      ? "CHAMPION"
                                      : projectedPrize > 0n
                                        ? "PAYOUT"
                                        : "NO PRIZE"
                                    : liveRank && liveRank <= surviveCount
                                      ? "SAFE"
                                      : "DANGER"}
                            </b>
                          </div>
                          <p>
                            {boundaryMargin === null
                              ? "Waiting for the live race"
                              : `${boundaryMargin >= 0n ? "+" : "−"}${cashFormat(
                                  boundaryMargin >= 0n
                                    ? boundaryMargin
                                    : -boundaryMargin,
                                )} tUSDC from #${raceBoundaryRank}`}
                          </p>
                        </div>

                        <div className="mr-battle-rule">
                          <ShieldCheck size={16} />
                          <span>
                            <small>
                              {finalRound ? "PAYOUT ZONE" : "SURVIVAL CUT"}
                            </small>
                            <strong>
                              {finalRound
                                ? paidPlaces === 1
                                  ? "#1 WINS THE POT"
                                  : "TOP 3 PAID · #1 WINS"
                                : `TOP ${surviveCount} ADVANCE`}
                            </strong>
                          </span>
                        </div>

                        <div className="mr-battle-readouts">
                          <article>
                            <span>DREAMDEX POSITION</span>
                            <strong>{positionLabel}</strong>
                            <small>
                              {me
                                ? `${cashFormat(me.yesShares)} UP · ${cashFormat(me.noShares)} DOWN`
                                : "No player position"}
                            </small>
                            <b>
                              {projectedVault === null
                                ? "Oracle value —"
                                : `${cashFormat(projectedVault)} vault · ${projectedTradingPnl! >= 0n ? "+" : "−"}${cashFormat(
                                    projectedTradingPnl! >= 0n
                                      ? projectedTradingPnl!
                                      : -projectedTradingPnl!,
                                  )} P&L`}
                            </b>
                          </article>
                          <article>
                            <span>ROYALE REWARD</span>
                            <strong>
                              {liveRank
                                ? `#${liveRank} ${projectedPrize > 0n ? "PAYS" : "NO PRIZE"}`
                                : me
                                  ? "CALCULATING"
                                  : "SPECTATING"}
                            </strong>
                            <small>
                              {liveRank
                                ? `${cashFormat(projectedPrize)} tUSDC projected prize`
                                : me
                                  ? "Waiting for oracle direction"
                                  : "Join to compete"}
                            </small>
                            <b>
                              {projectedNetResult === null
                                ? "Net result —"
                                : `${projectedNetResult >= 0n ? "+" : "−"}${cashFormat(
                                    projectedNetResult >= 0n
                                      ? projectedNetResult
                                      : -projectedNetResult,
                                  )} net after entry`}
                            </b>
                          </article>
                        </div>

                        <div className="mr-battle-list-heading">
                          <span>PROJECTED STANDINGS</span>
                          <small>
                            {projectedOutcome
                              ? `${projectedOutcome} WINS NOW`
                              : "ORACLE LOADING"}
                          </small>
                        </div>
                        <div className="mr-battle-list" role="list">
                          {liveRace.map((player, index) => {
                            const isYou = eq(player.wallet, account);
                            return (
                              <div key={player.wallet}>
                                {projectionReady &&
                                  index === boardSafeCount && (
                                    <div className="mr-elimination-line">
                                      <span>
                                        {finalRound
                                          ? "PRIZE LINE"
                                          : "ELIMINATION LINE"}
                                      </span>
                                    </div>
                                  )}
                                <div
                                  ref={isYou ? battleMeRef : undefined}
                                  className={`mr-battle-row ${isYou ? "you" : ""} ${projectionReady ? (index < boardSafeCount ? "surviving" : "eliminated") : ""}`}
                                  role="listitem"
                                  title={player.wallet}
                                >
                                  <strong className="mr-battle-rank">
                                    {projectionReady ? `#${index + 1}` : "—"}
                                  </strong>
                                  <PlayerAvatar
                                    seed={player.wallet}
                                    size="xs"
                                    label={playerName(player.wallet, account)}
                                    active={player.active}
                                  />
                                  <span>
                                    <b>{playerName(player.wallet, account)}</b>
                                    <small>
                                      {cashFormat(player.projectedScore)} tUSDC
                                      {!projectionReady ? " cash" : ""}
                                    </small>
                                  </span>
                                  {!projectionReady ? null : index === 0 ? (
                                    <Crown
                                      size={15}
                                      className="mr-leader-crown"
                                    />
                                  ) : index < boardSafeCount ? (
                                    <ShieldCheck
                                      size={14}
                                      className="mr-safe-shield"
                                    />
                                  ) : (
                                    <Flame
                                      size={14}
                                      className="mr-danger-flame"
                                    />
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <button
                          className="mr-jump-player"
                          onClick={() =>
                            battleMeRef.current?.scrollIntoView({
                              behavior: "smooth",
                              block: "center",
                            })
                          }
                        >
                          JUMP TO YOU · #{liveRank || "—"}
                        </button>
                      </aside>

                      <section className="panel mr-market-panel">
                        <div className="mr-market-grid">
                          <TradingChart
                            asset={m?.asset ?? "EVENT"}
                            start={m?.start ?? 0}
                            expiry={m?.expiry ?? t.expiry}
                            now={now}
                            data={chart}
                            loading={chartLoading}
                            error={chartError}
                            onRetry={() => setChartTick((value) => value + 1)}
                            viewer={account}
                            rivalWallets={[
                              ...new Set(
                                [
                                  ...liveRace.slice(0, 3),
                                  ...liveRace.slice(
                                    Math.max(0, liveRankIndex - 2),
                                    liveRankIndex < 0 ? 0 : liveRankIndex + 3,
                                  ),
                                  ...liveRace.slice(
                                    Math.max(0, surviveCount - 2),
                                    surviveCount + 1,
                                  ),
                                ].map((player) => player.wallet),
                              ),
                            ]}
                          />
                          <section
                            className="mr-depth"
                            aria-label="Live order book"
                          >
                            <header>
                              <div>
                                <span className="eyebrow">LIVE DEPTH</span>
                                <strong>UP ORDER BOOK</strong>
                              </div>
                              <span className="pill green">LIVE</span>
                            </header>
                            <div className="mr-depth-labels">
                              <span>BID · SELL</span>
                              <span>ASK · BUY</span>
                            </div>
                            <div className="mr-depth-rows">
                              {Array.from(
                                {
                                  length: Math.max(
                                    1,
                                    Math.min(
                                      6,
                                      Math.max(
                                        m?.bids.length ?? 0,
                                        m?.asks.length ?? 0,
                                      ),
                                    ),
                                  ),
                                },
                                (_, index) => (
                                  <div key={index}>
                                    {m?.bids[index] ? (
                                      <button
                                        className="mr-depth-bid"
                                        onClick={() => {
                                          setSide("UP");
                                          setDirection("sell");
                                          setPrice(
                                            String(
                                              Number(m.bids[index].price) /
                                                10000,
                                            ),
                                          );
                                        }}
                                      >
                                        <strong>
                                          {cents(m.bids[index].price)}¢
                                        </strong>
                                        <small>
                                          {cashFormat(m.bids[index].quantity)}
                                        </small>
                                      </button>
                                    ) : (
                                      <span>—</span>
                                    )}
                                    {m?.asks[index] ? (
                                      <button
                                        className="mr-depth-ask"
                                        onClick={() => {
                                          setSide("UP");
                                          setDirection("buy");
                                          setPrice(
                                            String(
                                              Number(m.asks[index].price) /
                                                10000,
                                            ),
                                          );
                                        }}
                                      >
                                        <strong>
                                          {cents(m.asks[index].price)}¢
                                        </strong>
                                        <small>
                                          {cashFormat(m.asks[index].quantity)}
                                        </small>
                                      </button>
                                    ) : (
                                      <span>—</span>
                                    )}
                                  </div>
                                ),
                              )}
                            </div>
                            <p>
                              Click a level to load its price. Prices are the
                              market&apos;s implied UP probability.
                            </p>
                          </section>
                        </div>
                      </section>

                      <aside className="panel mr-trade-ticket">
                        <header>
                          <div>
                            <span className="eyebrow">ORDER TICKET</span>
                            <h2>MAKE YOUR MOVE</h2>
                          </div>
                          <span className="mr-action-balance">
                            {me ? me.actions : 0} filled trades
                          </span>
                        </header>

                        <div
                          className="mr-outcome-buttons"
                          aria-label="Choose outcome"
                        >
                          {(["UP", "DOWN"] as const).map((outcome) => {
                            const level =
                              outcome === "UP"
                                ? direction === "buy"
                                  ? m?.asks[0]
                                  : m?.bids[0]
                                : direction === "buy"
                                  ? m?.bids[0]
                                  : m?.asks[0];
                            const outcomePrice = level
                              ? cents(
                                  outcome === "UP"
                                    ? level.price
                                    : 1_000_000n - BigInt(level.price),
                                )
                              : null;
                            return (
                              <button
                                key={outcome}
                                className={`${outcome.toLowerCase()} ${side === outcome ? "selected" : ""}`}
                                onClick={() => setSide(outcome)}
                              >
                                <span>
                                  {outcome === "UP" ? "↗" : "↘"} {outcome}
                                </span>
                                <strong>
                                  {outcomePrice === null
                                    ? "—"
                                    : `${outcomePrice}¢`}
                                </strong>
                                <small>
                                  {direction === "buy"
                                    ? "BEST ASK"
                                    : "BEST BID"}
                                </small>
                              </button>
                            );
                          })}
                        </div>

                        <div
                          className="mr-direction-tabs"
                          aria-label="Order direction"
                        >
                          {(["buy", "sell"] as const).map((value) => (
                            <button
                              key={value}
                              className={direction === value ? "selected" : ""}
                              onClick={() => setDirection(value)}
                            >
                              {value === "buy" ? "BUY SHARES" : "SELL / CLOSE"}
                            </button>
                          ))}
                        </div>

                        {me &&
                          (BigInt(me.yesShares) > 0n ||
                            BigInt(me.noShares) > 0n) && (
                            <div className="mr-size-presets">
                              {BigInt(me.yesShares) > 0n && (
                                <button onClick={() => prepareClose("UP")}>
                                  CLOSE ALL UP · {cashFormat(me.yesShares)}
                                </button>
                              )}
                              {BigInt(me.noShares) > 0n && (
                                <button onClick={() => prepareClose("DOWN")}>
                                  CLOSE ALL DOWN · {cashFormat(me.noShares)}
                                </button>
                              )}
                            </div>
                          )}

                        <div className="mr-ticket-fields">
                          <label>
                            <span>SHARES</span>
                            <input
                              inputMode="decimal"
                              value={quantity}
                              onChange={(event) =>
                                setQuantity(event.target.value)
                              }
                              aria-describedby="shares-help"
                            />
                          </label>
                          <label>
                            <span>LIMIT PRICE</span>
                            <div>
                              <input
                                inputMode="decimal"
                                value={price}
                                onChange={(event) =>
                                  setPrice(event.target.value)
                                }
                                aria-label={`Limit price in cents per ${side} share`}
                              />
                              <b>¢</b>
                            </div>
                          </label>
                        </div>
                        <div className="mr-size-presets" id="shares-help">
                          {["1", "2", "5"].map((value) => (
                            <button
                              key={value}
                              className={quantity === value ? "selected" : ""}
                              onClick={() => setQuantity(value)}
                            >
                              {value} SHARE{value === "1" ? "" : "S"}
                            </button>
                          ))}
                          <button
                            disabled={marketableQuote === null}
                            onClick={() =>
                              setPrice(
                                marketableQuote !== null
                                  ? cents(marketableQuote)
                                  : "",
                              )
                            }
                          >
                            USE MARKETABLE PRICE
                          </button>
                        </div>

                        <dl className="mr-order-preview">
                          <div>
                            <dt>
                              {direction === "buy"
                                ? "EST. COST"
                                : "EST. CREDIT"}
                            </dt>
                            <dd>
                              {cashFormat(
                                direction === "buy"
                                  ? iocQuote.value
                                  : quoteCredit,
                              )}{" "}
                              tUSDC
                            </dd>
                          </div>
                          <div>
                            <dt>
                              {direction === "buy"
                                ? "IF CORRECT"
                                : "EST. CLOSE P&L"}
                            </dt>
                            <dd
                              className={
                                direction === "sell" &&
                                estimatedClosePnl !== null
                                  ? estimatedClosePnl >= 0n
                                    ? "positive"
                                    : "negative"
                                  : undefined
                              }
                            >
                              {direction === "buy"
                                ? `${cashFormat(
                                    iocQuote.filled > iocQuote.value
                                      ? iocQuote.filled - iocQuote.value
                                      : 0n,
                                  )} tUSDC`
                                : estimatedClosePnl === null
                                  ? "Cost basis loading"
                                  : `${estimatedClosePnl >= 0n ? "+" : "−"}${cashFormat(
                                      estimatedClosePnl >= 0n
                                        ? estimatedClosePnl
                                        : -estimatedClosePnl,
                                    )} tUSDC`}
                            </dd>
                          </div>
                        </dl>

                        <p className="mr-ticket-fill">
                          Estimated IOC fill: {cashFormat(iocQuote.filled)} /{" "}
                          {cashFormat(orderQty)} shares
                          {iocQuote.filled > 0n
                            ? ` at ${cents(iocQuote.averagePrice)}¢ average`
                            : ""}
                          {iocQuote.remainder > 0n
                            ? ` · ${cashFormat(iocQuote.remainder)} cancels`
                            : " · full fill shown"}
                        </p>

                        {now < t.expiry ? (
                          <button
                            className={`button full mr-submit-trade ${
                              direction === "sell"
                                ? estimatedClosePnl === null
                                  ? "blue"
                                  : estimatedClosePnl >= 0n
                                    ? "green"
                                    : "danger"
                                : side === "UP"
                                  ? "green"
                                  : "purple"
                            }`}
                            disabled={!canTrade}
                            onClick={trade}
                          >
                            {direction === "buy" ? (
                              <>
                                BUY {side} AT {price || "—"}¢
                              </>
                            ) : estimatedClosePnl === null ? (
                              <>
                                SELL {side} AT {price || "—"}¢
                              </>
                            ) : (
                              <>
                                {estimatedClosePnl >= 0n
                                  ? `SELL ${side} · LOCK +${cashFormat(estimatedClosePnl)} tUSDC`
                                  : `SELL ${side} · REALIZE −${cashFormat(-estimatedClosePnl)} tUSDC`}
                              </>
                            )}
                            <ArrowRight size={17} />
                          </button>
                        ) : m?.resolved || m?.voided || t.roundTrades === 0 ? (
                          <button
                            className="button green full mr-submit-trade"
                            disabled={!allowed}
                            onClick={() =>
                              run("Settle round", async () => {
                                await tx(
                                  "Settle round",
                                  registry!,
                                  arenaAbi,
                                  "settleBatch",
                                  [BigInt(t.id)],
                                );
                              })
                            }
                          >
                            SETTLE ROUND <ArrowRight size={17} />
                          </button>
                        ) : (
                          <button
                            className="button blue full mr-submit-trade"
                            disabled={!allowed}
                            onClick={() =>
                              run("Request oracle sync", async () => {
                                await tx(
                                  "Request oracle sync",
                                  MODULE,
                                  moduleAbi,
                                  "pokeOracle",
                                  [BigInt(m!.questionId)],
                                );
                              })
                            }
                          >
                            SYNC ORACLE <RefreshCw size={16} />
                          </button>
                        )}
                        <p
                          className={`mr-ticket-status ${orderError ? "has-error" : ""}`}
                          role="status"
                        >
                          {!me
                            ? "Spectator mode · connect the entrant wallet to trade."
                            : !me.active
                              ? "Your trading round is complete."
                              : now >= t.expiry
                                ? "Trading closed · waiting for oracle settlement."
                                : orderError ||
                                  (direction === "sell"
                                    ? estimatedClosePnl === null
                                      ? "Selling closes exposure at the live bid. P&L appears after confirmed cost basis loads."
                                      : `${estimatedClosePnl >= 0n ? "Locks a gain" : "Realizes a loss"} versus your average paid cost. Live rank can still move because it previews $1 settlement for the current oracle leader.`
                                    : "Unlimited filled trades until market close · unfilled IOC orders cancel.")}
                        </p>
                      </aside>
                    </div>
                  ) : (
                    t.phase !== 0 && (
                      <div className={`game-grid tn-spacing phase-${t.phase}`}>
                        <aside className="panel">
                          <span className="eyebrow">
                            {t.phase >= 3
                              ? "FINAL VAULT STATE"
                              : "YOUR TRADING VAULT"}
                          </span>
                          <h2>
                            {me
                              ? `${cashFormat(me.cash)} tUSDC`
                              : t.phase === 3
                                ? "RESULTS VERIFIED"
                                : t.phase === 4
                                  ? "FUNDS UNLOCKED"
                                  : "SPECTATING"}
                          </h2>
                          <p>
                            {t.phase === 3 && me
                              ? "Outcome shares were redeemed into this final tUSDC balance."
                              : me?.active
                                ? "Still in the race."
                                : me
                                  ? "Your trading round is complete."
                                  : t.phase === 3
                                    ? "This result is final and recorded on Shannon."
                                    : t.phase === 4
                                      ? "This royale was cancelled and entrant funds are recoverable."
                                      : "Connect an entrant wallet to trade. Everyone can watch."}
                          </p>
                          {me && (
                            <>
                              <dl>
                                {t.phase === 3 ? (
                                  <>
                                    <div>
                                      <dt>Outcome shares</dt>
                                      <dd>Redeemed</dd>
                                    </div>
                                    <div>
                                      <dt>Settlement</dt>
                                      <dd>Included in final balance</dd>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div>
                                      <dt>UP shares held</dt>
                                      <dd>{cashFormat(me.yesShares)}</dd>
                                    </div>
                                    <div>
                                      <dt>DOWN shares held</dt>
                                      <dd>{cashFormat(me.noShares)}</dd>
                                    </div>
                                  </>
                                )}
                                <div>
                                  <dt>Filled trades</dt>
                                  <dd>{me.actions}</dd>
                                </div>
                                <div>
                                  <dt>Final rank</dt>
                                  <dd>
                                    {me.rank
                                      ? `#${me.rank}`
                                      : "Pending settlement"}
                                  </dd>
                                </div>
                              </dl>
                              <a
                                className="text-link"
                                href={`${EXPLORER}/address/${me.vault}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                View vault <ExternalLink size={14} />
                              </a>
                            </>
                          )}
                          {m && (
                            <div className="inset">
                              <span className="eyebrow">ORACLE</span>
                              <p>
                                {m.voided
                                  ? "Voided · both outcomes redeem according to the on-chain payout vector."
                                  : m.resolved
                                    ? `Resolved · ${BigInt(m.payouts[0] ?? 0) > BigInt(m.payouts[1] ?? 0) ? "UP" : "DOWN"} wins.`
                                    : now >= m.expiry
                                      ? "Waiting for the DreamDEX oracle. No result is assumed."
                                      : "Market is open. Result comes from DreamDEX at expiry."}
                              </p>
                            </div>
                          )}
                        </aside>
                        <section className="panel live-race">
                          <div className="split">
                            <div>
                              <span className="eyebrow">ON-CHAIN FIELD</span>
                              <h2>
                                {t.phase === 3 ? "FINAL STANDINGS" : "THE RACE"}
                              </h2>
                            </div>
                            <span className="pill purple">
                              {t.phase === 3
                                ? "FINAL"
                                : t.phase === 4
                                  ? "CANCELLED"
                                  : t.phase === 2
                                    ? `${t.activeCount} SURVIVORS`
                                    : `${t.activeCount} ACTIVE`}
                            </span>
                          </div>
                          <p className="small muted">
                            {t.phase === 3
                              ? "Final ranks use each settled vault balance. The result and prize allocation are recorded on Shannon."
                              : t.phase === 4
                                ? "The event ended without a winner. Entrant bankrolls and entry refunds remain recoverable."
                                : "During trading, cash is shown separately from open shares. Cuts use redeemed bankroll after oracle settlement. Exact ties favor earlier entry."}
                          </p>
                          <div className="tn-standings">
                            <div className="tn-standing header-row">
                              <span>PLAYER</span>
                              <span>
                                {t.phase === 3 ? "FINAL CASH" : "CASH"}
                              </span>
                              <span>
                                {t.phase === 3 ? "SETTLEMENT" : "UP / DOWN"}
                              </span>
                              <span>RESULT</span>
                            </div>
                            {sorted.map((p) => (
                              <div
                                key={p.wallet}
                                className={`tn-standing ${eq(p.wallet, account) ? "you" : ""}`}
                              >
                                <strong>{playerName(p.wallet, account)}</strong>
                                <span>{cashFormat(p.cash)}</span>
                                <span>
                                  {t.phase === 3
                                    ? "REDEEMED"
                                    : `${cashFormat(p.yesShares)} / ${cashFormat(p.noShares)}`}
                                </span>
                                <span>
                                  {p.rank
                                    ? `#${p.rank}`
                                    : p.active
                                      ? "Racing"
                                      : "—"}
                                </span>
                              </div>
                            ))}
                          </div>
                          {t.phase === 3 && (
                            <div className="tn-winner">
                              <img
                                src="/art/vendor/fluent-emoji/trophy-3d.png"
                                width="256"
                                height="256"
                                alt=""
                                aria-hidden="true"
                              />
                              <h2>
                                {playerName(sorted[0]?.wallet ?? "", account)}{" "}
                                WINS
                              </h2>
                              <p>
                                {cashFormat(sorted[0]?.prize)} tUSDC prize ·
                                settled on Shannon
                              </p>
                            </div>
                          )}
                          {t.phase === 1 && now >= t.expiry && (
                            <div className="inset">
                              <h3>
                                {m?.resolved || m?.voided || t.roundTrades === 0
                                  ? "SETTLE THIS ROUND"
                                  : "AWAITING ORACLE"}
                              </h3>
                              <p>
                                {t.settleCursor} / {snapshot!.players.length}{" "}
                                entrant records processed. Any connected wallet
                                can advance settlement in batches of four.
                              </p>
                              {m?.resolved ||
                              m?.voided ||
                              t.roundTrades === 0 ? (
                                <button
                                  className="button green full"
                                  disabled={!allowed}
                                  onClick={() =>
                                    run("Settle round", async () => {
                                      await tx(
                                        "Settle round",
                                        registry!,
                                        arenaAbi,
                                        "settleBatch",
                                        [BigInt(t.id)],
                                      );
                                    })
                                  }
                                >
                                  SETTLE NEXT BATCH
                                </button>
                              ) : (
                                <button
                                  className="button blue full"
                                  disabled={!allowed}
                                  onClick={() =>
                                    run("Request oracle sync", async () => {
                                      await tx(
                                        "Request oracle sync",
                                        MODULE,
                                        moduleAbi,
                                        "pokeOracle",
                                        [BigInt(m!.questionId)],
                                      );
                                    })
                                  }
                                >
                                  REQUEST ORACLE SYNC
                                </button>
                              )}
                            </div>
                          )}
                          {t.phase === 2 && (
                            <div className="inset">
                              <h3>THE NEXT CUT AWAITS</h3>
                              <p>
                                Any player can open the next eligible window
                                from the same DreamDEX creator and duration. It
                                starts when that transaction confirms.
                              </p>
                              {live
                                .filter(
                                  (n) =>
                                    eq(n.creator, t.creator) &&
                                    n.venue === t.venue &&
                                    n.start >= t.expiry &&
                                    n.interval === t.duration &&
                                    n.expiry > now + 120,
                                )
                                .map((n) => (
                                  <button
                                    key={n.id}
                                    className="button green full"
                                    disabled={
                                      !allowed ||
                                      !!marketError ||
                                      Date.now() - marketAt > 40000
                                    }
                                    onClick={() =>
                                      run("Start next round", async () => {
                                        await tx(
                                          "Start next round",
                                          registry!,
                                          arenaAbi,
                                          "nextRound",
                                          [BigInt(t.id), n.id],
                                        );
                                      })
                                    }
                                  >
                                    START {n.asset} · {n.interval / 60} MIN
                                  </button>
                                ))}
                              {!live.some(
                                (n) =>
                                  n.start >= t.expiry &&
                                  n.interval === t.duration &&
                                  n.expiry > now + 120,
                              ) && (
                                <p>
                                  Waiting for the next live market window. This
                                  page refreshes automatically.
                                </p>
                              )}
                            </div>
                          )}
                        </section>
                        {t.phase === 1 ? (
                          <aside className="panel position-panel">
                            <span className="eyebrow">TRADE EVENT SHARES</span>
                            <h2>MAKE YOUR MOVE</h2>
                            <div className="tn-tabs">
                              {(["UP", "DOWN"] as const).map((s) => (
                                <button
                                  className={side === s ? "selected" : ""}
                                  key={s}
                                  onClick={() => setSide(s)}
                                >
                                  {s === "UP" ? "↗" : "↘"} {s}
                                </button>
                              ))}
                            </div>
                            <div className="tn-tabs small">
                              {(["buy", "sell"] as const).map((d) => (
                                <button
                                  className={direction === d ? "selected" : ""}
                                  key={d}
                                  onClick={() => setDirection(d)}
                                >
                                  {d === "buy" ? "Buy" : "Sell"}
                                </button>
                              ))}
                            </div>
                            <label className="tn-field">
                              SHARES
                              <input
                                inputMode="decimal"
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                              />
                            </label>
                            <label className="tn-field">
                              LIMIT PRICE (¢ PER {side} SHARE)
                              <input
                                inputMode="decimal"
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                              />
                            </label>
                            <button
                              className="text-link"
                              disabled={marketableQuote === null}
                              onClick={() =>
                                setPrice(
                                  marketableQuote !== null
                                    ? cents(marketableQuote)
                                    : "",
                                )
                              }
                            >
                              Use marketable{" "}
                              {direction === "buy" ? "buy" : "sell"}:{" "}
                              {marketableQuote !== null
                                ? `${cents(marketableQuote)}¢`
                                : "no liquidity"}
                            </button>
                            <dl>
                              <div>
                                <dt>
                                  {direction === "buy"
                                    ? "Max notional"
                                    : "Min notional"}
                                </dt>
                                <dd>
                                  {cashFormat(
                                    (orderQty * orderPrice) / 1_000_000n,
                                  )}{" "}
                                  tUSDC
                                </dd>
                              </div>
                              <div>
                                <dt>Execution</dt>
                                <dd>Immediate or cancel</dd>
                              </div>
                            </dl>
                            <p className="small muted">
                              Fees are charged by DreamDEX. Partial fills are
                              possible. Unfilled shares cancel immediately; an
                              empty fill uses no action.
                            </p>
                            <button
                              className={`button full ${side === "UP" ? "green" : "purple"}`}
                              disabled={!canTrade}
                              onClick={trade}
                            >
                              {direction === "buy" ? "BUY" : "SELL"} {side}{" "}
                              <ArrowRight size={17} />
                            </button>
                            <p className="small muted">
                              {!me
                                ? "Spectator mode"
                                : !me.active
                                  ? "You are no longer trading this match."
                                  : t.phase !== 1
                                    ? "Trading opens when the next round starts."
                                    : now >= t.expiry
                                      ? "Trading closed. Waiting for settlement."
                                      : !quote
                                        ? "No executable liquidity on this side."
                                        : orderError}
                            </p>
                            {m && (
                              <div className="tn-book">
                                <h3>LIVE ORDER BOOK · UP PRICE</h3>
                                <div>
                                  <span>BID</span>
                                  <span>ASK</span>
                                </div>
                                {Array.from(
                                  {
                                    length: Math.min(
                                      5,
                                      Math.max(m.bids.length, m.asks.length),
                                    ),
                                  },
                                  (_, i) => (
                                    <div key={i}>
                                      <span className="positive">
                                        {m.bids[i]
                                          ? `${cents(m.bids[i].price)}¢ · ${cashFormat(m.bids[i].quantity)}`
                                          : "—"}
                                      </span>
                                      <span className="negative">
                                        {m.asks[i]
                                          ? `${cents(m.asks[i].price)}¢ · ${cashFormat(m.asks[i].quantity)}`
                                          : "—"}
                                      </span>
                                    </div>
                                  ),
                                )}
                                {m.bookError && (
                                  <p className="error">{m.bookError}</p>
                                )}
                                {!m.bids.length && !m.asks.length && (
                                  <p>No open orders for this market.</p>
                                )}
                              </div>
                            )}
                          </aside>
                        ) : (
                          <aside className="panel tn-phase-summary">
                            <img
                              src={
                                t.phase === 3
                                  ? "/art/vendor/fluent-emoji/trophy-3d.png"
                                  : t.phase === 4
                                    ? "/art/vendor/fluent-emoji/shield-3d.png"
                                    : "/art/vendor/fluent-emoji/stopwatch-3d.png"
                              }
                              width="256"
                              height="256"
                              alt=""
                              aria-hidden="true"
                            />
                            <span className="eyebrow">
                              {t.phase === 3
                                ? "MATCH COMPLETE"
                                : t.phase === 4
                                  ? "MATCH CANCELLED"
                                  : "BETWEEN ROUNDS"}
                            </span>
                            <h2>
                              {t.phase === 3
                                ? "RESULTS ARE FINAL"
                                : t.phase === 4
                                  ? "FUNDS ARE SAFE"
                                  : "NEXT MARKET PENDING"}
                            </h2>
                            <p>
                              {t.phase === 3
                                ? "The standings and prize allocation below come directly from the settled tournament contract."
                                : t.phase === 4
                                  ? `Each entrant can recover their vault and claim the ${cashFormat(t.entryFee)} tUSDC entry refund.`
                                  : "The operator is looking for the next verified DreamDEX window with sufficient liquidity."}
                            </p>
                            <dl>
                              <div>
                                <dt>
                                  {t.phase === 3
                                    ? "Champion"
                                    : t.phase === 4
                                      ? "Entry refund"
                                      : "Players remaining"}
                                </dt>
                                <dd>
                                  {t.phase === 3
                                    ? playerName(
                                        sorted[0]?.wallet ?? "",
                                        account,
                                      )
                                    : t.phase === 4
                                      ? `${cashFormat(t.entryFee)} tUSDC`
                                      : t.activeCount}
                                </dd>
                              </div>
                              <div>
                                <dt>
                                  {t.phase === 3
                                    ? "Winning prize"
                                    : t.phase === 4
                                      ? "Bankroll"
                                      : "Required window"}
                                </dt>
                                <dd>
                                  {t.phase === 3
                                    ? `${cashFormat(sorted[0]?.prize)} tUSDC`
                                    : t.phase === 4
                                      ? "Withdrawable"
                                      : `${t.duration / 60} min`}
                                </dd>
                              </div>
                            </dl>
                            {t.phase >= 3 && (
                              <div className="tn-phase-proof">
                                <ShieldCheck size={17} /> VERIFIED ON SHANNON
                              </div>
                            )}
                          </aside>
                        )}
                      </div>
                    )
                  )}
                  {t.phase === 4 && (
                    <section className="panel tn-spacing">
                      <h3>
                        {CANCEL_REASONS[t.cancelReason] || "Event cancelled"}
                      </h3>
                      <p>
                        Entry contributions are refunded. Unspent bankroll and
                        any unsettled shares return to their original wallets.
                      </p>
                    </section>
                  )}
                  {me && (!me.active || t.phase === 4) && (
                    <section className="panel tn-claims">
                      <div>
                        <span className="eyebrow">YOUR FUNDS</span>
                        <h2>
                          {t.phase === 4
                            ? "REFUND & RECOVERY"
                            : "CLAIM YOUR FINISH"}
                        </h2>
                        <p>
                          {me.withdrawn && me.prizeClaimed
                            ? "Your bankroll and prize or refund have been paid to your wallet."
                            : "The event operator pays official events automatically. You can recover your funds here at any time once eligible."}
                        </p>
                        {!(me.withdrawn && me.prizeClaimed) && (
                          <button
                            className="button green"
                            disabled={!allowed}
                            onClick={() =>
                              run("Recover all funds", async () => {
                                await tx(
                                  "Recover all funds",
                                  registry!,
                                  arenaAbi,
                                  "payPlayer",
                                  [BigInt(t.id), account!],
                                );
                              })
                            }
                          >
                            RECOVER AVAILABLE FUNDS
                          </button>
                        )}
                      </div>
                      <button
                        className="button blue"
                        disabled={!allowed || me.withdrawn}
                        onClick={() =>
                          run("Withdraw bankroll", async () => {
                            await tx(
                              "Withdraw bankroll",
                              me.vault,
                              vaultAbi,
                              "withdraw",
                            );
                          })
                        }
                      >
                        {me.withdrawn
                          ? "BANKROLL WITHDRAWN"
                          : `WITHDRAW ${cashFormat(me.cash)} tUSDC${BigInt(me.yesShares) + BigInt(me.noShares) > 0n ? " + SHARES" : ""}`}
                      </button>
                      {(t.phase === 3 || t.phase === 4) && (
                        <button
                          className="button green"
                          disabled={!allowed || me.prizeClaimed}
                          onClick={() =>
                            run("Claim prize or refund", async () => {
                              await tx(
                                "Claim prize or refund",
                                registry!,
                                arenaAbi,
                                "claimPrize",
                                [BigInt(t.id)],
                              );
                            })
                          }
                        >
                          {me.prizeClaimed
                            ? "CLAIMED"
                            : `CLAIM ${t.phase === 4 ? cashFormat(t.entryFee) : cashFormat(me.prize)} tUSDC ${t.phase === 4 ? "ENTRY REFUND" : "PRIZE"}`}
                        </button>
                      )}
                      {t.phase === 4 &&
                        me.withdrawn &&
                        m &&
                        (m.resolved || m.voided) &&
                        BigInt(me.yesShares) + BigInt(me.noShares) > 0n && (
                          <div className="tn-recovery">
                            <p>
                              Your unsettled shares were returned to your
                              wallet. Redeem winning or voided shares through
                              DreamDEX below.
                            </p>
                            {(["UP", "DOWN"] as const)
                              .filter(
                                (s, i) =>
                                  BigInt(m.payouts[i] ?? 0) > 0n &&
                                  BigInt(i === 0 ? me.yesShares : me.noShares) >
                                    0n,
                              )
                              .map((s, i) => (
                                <button
                                  className="button blue"
                                  disabled={!allowed}
                                  key={s}
                                  onClick={() =>
                                    run(`Redeem recovered ${s}`, async () => {
                                      const index = s === "UP" ? 0 : 1;
                                      const id = BigInt(
                                        index === 0 ? m.yesId : m.noId,
                                      );
                                      const amount =
                                        await publicClient.readContract({
                                          address: m.outcomeToken,
                                          abi: outcomeAbi,
                                          functionName: "balanceOf",
                                          args: [account!, id],
                                        });
                                      if (amount === 0n)
                                        throw new Error(
                                          "No remaining shares of this outcome in your wallet.",
                                        );
                                      await tx(
                                        "Approve redemption",
                                        m.outcomeToken,
                                        outcomeAbi,
                                        "setOperator",
                                        [MODULE, true],
                                      );
                                      await tx(
                                        `Redeem ${s}`,
                                        MODULE,
                                        moduleAbi,
                                        "redeem",
                                        [
                                          0,
                                          `0x${"0".repeat(64)}`,
                                          m.id,
                                          index,
                                          amount,
                                        ],
                                      );
                                      await tx(
                                        "Revoke redemption operator",
                                        m.outcomeToken,
                                        outcomeAbi,
                                        "setOperator",
                                        [MODULE, false],
                                      );
                                    })
                                  }
                                >
                                  REDEEM {s}
                                </button>
                              ))}
                          </div>
                        )}
                    </section>
                  )}
                  {t.phase === 3 && me && progression?.configured && (
                    <section className="panel tn-reward-claim">
                      <div>
                        <span className="eyebrow">ON-CHAIN PROGRESSION</span>
                        <h2>FINISH REWARDS</h2>
                        <p>
                          The event operator records rank #{me.rank}, rating,
                          season XP, league stats, and eligible badges
                          automatically. Use the recovery action if confirmation
                          is delayed.
                        </p>
                        {progression.preview && (
                          <div className="tn-reward-preview">
                            <strong>
                              {Number(progression.preview.delta) >= 0
                                ? "+"
                                : ""}
                              {progression.preview.delta} rating
                            </strong>
                            <strong>+{progression.preview.xp} season XP</strong>
                          </div>
                        )}
                      </div>
                      <div className="tn-reward-actions">
                        <button
                          className="button blue"
                          onClick={() => setShowFinishCelebration(true)}
                        >
                          <Trophy size={17} /> VIEW RESULT CARD
                        </button>
                        <button
                          className="button purple"
                          disabled={
                            !allowed ||
                            !PROGRESSION ||
                            !progression.preview?.canRecord
                          }
                          onClick={() =>
                            run("Mint achievements", async () => {
                              await tx(
                                "Mint achievements",
                                PROGRESSION!,
                                progressionAbi,
                                "recordResult",
                                [BigInt(t.id), account!],
                              );
                            })
                          }
                        >
                          <Award size={17} />
                          {progression.preview?.canRecord
                            ? "RECORD NOW"
                            : "RESULT RECORDED"}
                        </button>
                        {progression.preview?.protectionAvailable && (
                          <button
                            className="button green"
                            disabled={!allowed || !PROGRESSION}
                            onClick={() =>
                              run("Claim loss protection", async () => {
                                await tx(
                                  "Claim loss protection",
                                  PROGRESSION!,
                                  progressionAbi,
                                  "claimProtection",
                                  [BigInt(t.id)],
                                );
                              })
                            }
                          >
                            <ShieldCheck size={17} /> CLAIM 1 tUSDC PROTECTION
                          </button>
                        )}
                        {!playerProgress?.verified && (
                          <p className="small muted">
                            Sponsor protection is limited to approved early
                            players. Badges, rating, and XP remain open to every
                            ranked player.
                          </p>
                        )}
                      </div>
                    </section>
                  )}
                  {t.phase < 3 &&
                    eq(account, t.host) &&
                    ((t.phase === 0 &&
                      ((now >= t.joinDeadline &&
                        snapshot!.players.length < t.minPlayers) ||
                        now > t.joinDeadline + START_GRACE ||
                        (!t.scheduled && now >= t.expiry - 120))) ||
                      now >
                        (t.phase === 1 ? t.expiry : t.updatedAt) +
                          (snapshot?.version === 1
                            ? 86400
                            : CANCEL_TIMEOUT)) && (
                      <section className="panel tn-spacing">
                        <h3>CANCELLATION AVAILABLE</h3>
                        <p>
                          This match could not proceed within its time limit.
                          Cancel to unlock entry refunds and player vaults.
                        </p>
                        <button
                          className="button blue"
                          disabled={!allowed}
                          onClick={() =>
                            run("Cancel stalled royale", async () => {
                              await tx(
                                "Cancel stalled royale",
                                registry!,
                                arenaAbi,
                                "cancel",
                                [BigInt(t.id)],
                              );
                            })
                          }
                        >
                          CANCEL & UNLOCK REFUNDS
                        </button>
                      </section>
                    )}
                </>
              )}
            </>
          )}
          {page === "wallet" && (
            <>
              <div className="page-heading">
                <span className="eyebrow">SOMNIA SHANNON · 50312</span>
                <h1>WALLET & ARENA</h1>
                <p>Use STT for network fees and tUSDC to enter and trade.</p>
              </div>
              <div className="detail-grid">
                <section className="panel">
                  <h2>01 · CONNECT & FUND</h2>
                  {wallets.length > 1 && (
                    <label className="tn-field">
                      BROWSER WALLET
                      <select
                        value={walletId}
                        onChange={(e) => {
                          setAccount(null);
                          setWalletId(e.target.value);
                        }}
                      >
                        {wallets.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button
                    className="button blue full"
                    disabled={!provider || !!pending}
                    onClick={() =>
                      run("Connect wallet", async () => {
                        const a = await connect(provider!);
                        setAccount(a);
                        setChain(CHAIN_ID);
                        setNotice("Wallet connected to Somnia Shannon.");
                      })
                    }
                  >
                    <Wallet size={18} />
                    {connected ? "RECONNECT WALLET" : "CONNECT TO SHANNON"}
                  </button>
                  {!provider && (
                    <p>
                      No browser wallet was detected here. Open this app in a
                      browser with an EVM wallet extension, such as MetaMask or
                      Rabby.
                    </p>
                  )}
                  <dl>
                    <div>
                      <dt>Account</dt>
                      <dd>
                        {account ? (
                          <a
                            href={`${EXPLORER}/address/${account}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {short(account)} ↗
                          </a>
                        ) : (
                          "Not connected"
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Available tUSDC</dt>
                      <dd>
                        {snapshot && account
                          ? cashFormat(snapshot.balance)
                          : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>STT gas balance</dt>
                      <dd>
                        {snapshot && account
                          ? Number(formatEther(BigInt(snapshot.gas))).toFixed(6)
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                  <div className="inset">
                    <h3>STARTER FUNDS</h3>
                    <p>
                      Receive 1 STT for gas once every 24 hours, then mint test
                      tUSDC without leaving Market Royale.
                    </p>
                    <button
                      className="button purple full"
                      disabled={!connected || !!pending}
                      onClick={requestGas}
                    >
                      REQUEST 1 STT <Zap size={16} />
                    </button>
                    <button
                      className="button green full"
                      disabled={
                        !connected ||
                        !!pending ||
                        !fresh ||
                        BigInt(snapshot?.gas ?? 0) === 0n
                      }
                      onClick={() =>
                        run("Request test tUSDC", async () => {
                          await tx(
                            "Request 100 test tUSDC",
                            COLLATERAL,
                            tokenAbi,
                            "faucet",
                            [100_000_000n],
                          );
                        })
                      }
                    >
                      REQUEST 100 tUSDC
                    </button>
                  </div>
                  <p className="small muted">
                    The STT grant is sponsored once per wallet every 24 hours.
                    The tUSDC request calls the deployed test token faucet. If
                    either service is unavailable, use the{" "}
                    <a
                      href="https://testnet.somnia.network/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Somnia testnet faucet ↗
                    </a>
                    . You need the event's displayed entry plus vault amount and
                    STT before joining.
                  </p>
                </section>
                <section className="panel">
                  <h2>02 · SHARED TOURNAMENT ARENA</h2>
                  <p>
                    {registry
                      ? "This app is connected to the arena below. All friends must use this same address."
                      : "Deploy the tournament contract once, or connect an existing deployment."}
                  </p>
                  <label className="tn-field">
                    ARENA CONTRACT ADDRESS
                    <input
                      placeholder="0x…"
                      value={registryDraft}
                      onChange={(e) => setRegistryDraft(e.target.value)}
                    />
                  </label>
                  <button
                    className="button blue full"
                    disabled={!!pending || !registryDraft}
                    onClick={chooseRegistry}
                  >
                    VERIFY & USE ARENA
                  </button>
                  {registry && (
                    <p className="small">
                      <a
                        href={`${EXPLORER}/address/${registry}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {short(registry)} on Shannon explorer ↗
                      </a>{" "}
                      ·{" "}
                      {snapshot?.registry && !stateError
                        ? "Bytecode verified"
                        : "Verification pending"}
                    </p>
                  )}
                  {!walletId.startsWith("local-") && (
                    <div className="inset">
                      <h3>CREATE A NEW ARENA</h3>
                      <p>
                        Deploys the compiled Market Royale contract on chain
                        50312. No admin key is retained. The deployment holds no
                        funds until players enter.
                      </p>
                      <button
                        className="button green full"
                        disabled={!allowed || BigInt(snapshot?.gas ?? 0) === 0n}
                        onClick={deploy}
                      >
                        DEPLOY TO SHANNON <Zap size={18} />
                      </button>
                    </div>
                  )}
                  {registry && (
                    <button className="text-link" onClick={share}>
                      Copy shared arena URL <ExternalLink size={14} />
                    </button>
                  )}
                </section>
              </div>
              {walletId.startsWith("local-") ? (
                <section className="panel tn-spacing">
                  <h2>OFFICIAL EVENT LIQUIDITY</h2>
                  <p>
                    The event operator funds a separate treasury and adds real
                    maker orders when needed. Local player wallets use the
                    shared arena above. Manual market making remains available
                    with an extension wallet.
                  </p>
                </section>
              ) : (
                <Liquidity
                  account={account}
                  live={live}
                  allowed={allowed}
                  pending={pending}
                  run={run}
                  tx={tx}
                />
              )}
              <section className="panel tn-spacing">
                <h2>WALLET TRANSACTIONS</h2>
                <p className="small muted">
                  Receipts submitted from this browser. Game state and balances
                  always come from the chain.
                </p>
                {activity.filter((a) => !account || eq(a.account, account))
                  .length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>ACTION</th>
                          <th>STATUS</th>
                          <th>RECEIPT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activity
                          .filter((a) => !account || eq(a.account, account))
                          .map((a) => (
                            <tr key={a.hash}>
                              <td>
                                {a.label}
                                <small>
                                  {new Date(a.time).toLocaleString()}
                                </small>
                              </td>
                              <td>
                                {a.status}
                                {a.status === "pending" && (
                                  <button
                                    className="text-link"
                                    disabled={!!pending}
                                    onClick={() =>
                                      run("Check receipt", async () => {
                                        const r =
                                          await publicClient.getTransactionReceipt(
                                            { hash: a.hash },
                                          );
                                        setActivity((all) =>
                                          all.map((x) =>
                                            x.hash === a.hash
                                              ? {
                                                  ...x,
                                                  status:
                                                    r.status === "success"
                                                      ? "confirmed"
                                                      : "reverted",
                                                }
                                              : x,
                                          ),
                                        );
                                      })
                                    }
                                  >
                                    Check receipt
                                  </button>
                                )}
                              </td>
                              <td>
                                <TxLink hash={a.hash} />
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty">
                    <img
                      className="tn-empty-art"
                      src="/art/vendor/fluent-emoji/coin-3d.png"
                      width="256"
                      height="256"
                      alt=""
                      aria-hidden="true"
                    />
                    <p>Your confirmed testnet actions will appear here.</p>
                  </div>
                )}
              </section>
            </>
          )}
          {page === "profile" && (
            <>
              <div className="page-heading">
                <span className="eyebrow">
                  SEASON {progression?.season ?? "—"}
                </span>
                <h1>PLAYER PROGRESSION</h1>
                <p>
                  Ranked finishes build your league record. Achievement badges
                  are permanent and cannot be transferred or farmed as tokens.
                </p>
              </div>
              {!account ? (
                <section className="panel tn-empty">
                  <img
                    className="tn-empty-art"
                    src="/art/vendor/fluent-emoji/trophy-3d.png"
                    width="256"
                    height="256"
                    alt=""
                    aria-hidden="true"
                  />
                  <h2>Connect your player wallet</h2>
                  <p>
                    Your rating, season progress, badges, and protection history
                    are read directly from Shannon.
                  </p>
                  <button className="button blue" onClick={() => go("wallet")}>
                    CONNECT WALLET <ArrowRight size={17} />
                  </button>
                </section>
              ) : progressionLoading && !playerProgress ? (
                <section
                  className="panel tn-progression-skeleton"
                  role="status"
                >
                  <span className="tn-spinner" /> Loading on-chain progression…
                </section>
              ) : progressionError ? (
                <section className="panel tn-empty" role="alert">
                  <RefreshCw size={34} />
                  <h2>Progression is temporarily unavailable</h2>
                  <p>{progressionError}</p>
                  <button className="button blue" onClick={refresh}>
                    RETRY
                  </button>
                </section>
              ) : !progression?.configured || !playerProgress ? (
                <section className="panel tn-empty">
                  <img
                    className="tn-empty-art"
                    src="/art/vendor/fluent-emoji/gem-stone-3d.png"
                    width="256"
                    height="256"
                    alt=""
                    aria-hidden="true"
                  />
                  <h2>Progression contract is not configured</h2>
                  <p>
                    The arena remains playable while rewards are unavailable.
                  </p>
                </section>
              ) : (
                <>
                  <div className="tn-progress-hero">
                    <section className="panel purple-gradient tn-league-card">
                      <span className="eyebrow">CURRENT LEAGUE</span>
                      <div className="mr-league-avatar">
                        <PlayerAvatar
                          seed={account}
                          size="lg"
                          league={Number(playerProgress.league)}
                          label={`Avatar for ${short(account)}`}
                          active={connected}
                        />
                      </div>
                      <h2>
                        {LEAGUES[Number(playerProgress.league)] ?? "Bronze"}
                      </h2>
                      <strong>{playerProgress.rating} RATING</strong>
                      <p>
                        Rating moves with every ranked finish, including
                        consistent top-half placements.
                      </p>
                    </section>
                    <section className="panel tn-season-card">
                      <div className="split">
                        <div>
                          <span className="eyebrow">SEASON LEVEL</span>
                          <h2>LEVEL {seasonLevel}</h2>
                        </div>
                        <span className="pill blue">{seasonXp} XP</span>
                      </div>
                      <progress
                        value={Math.max(0, Math.min(100, levelProgress))}
                        max={100}
                        aria-label={`Season level ${seasonLevel} progress`}
                      />
                      <p>
                        {seasonLevel >= 3
                          ? "Season Invitational access unlocked."
                          : `${Math.max(0, levelCeiling - seasonXp)} XP until the next level. Level 3 mints an Invitational Pass.`}
                      </p>
                      <span className="small muted">
                        Season ends{" "}
                        {new Date(
                          Number(progression.seasonEnds) * 1000,
                        ).toLocaleDateString()}
                      </span>
                    </section>
                  </div>
                  <section className="panel tn-career">
                    <div className="split">
                      <div>
                        <span className="eyebrow">CAREER RECORD</span>
                        <h2>CONSISTENCY COUNTS</h2>
                      </div>
                      <button
                        className="text-link"
                        onClick={() => go("history")}
                      >
                        Mint a finished result <ArrowRight size={15} />
                      </button>
                    </div>
                    <div className="tn-career-grid">
                      <Stat label="ROYALES" value={playerProgress.completed} />
                      <Stat label="WINS" value={playerProgress.wins} />
                      <Stat label="PODIUMS" value={playerProgress.podiums} />
                      <Stat
                        label="TOP-HALF FINISHES"
                        value={playerProgress.topHalfFinishes}
                      />
                      <Stat
                        label="CUTS SURVIVED"
                        value={playerProgress.survivals}
                      />
                      <Stat label="CAREER XP" value={playerProgress.careerXp} />
                    </div>
                  </section>
                  <section className="panel tn-badges-section">
                    <div>
                      <span className="eyebrow">SOULBOUND ACHIEVEMENTS</span>
                      <h2>YOUR BADGE CASE</h2>
                      <p>
                        Minted from verified arena results. Badges cannot be
                        sold, transferred, or approved to another wallet.
                      </p>
                    </div>
                    <div className="tn-badge-grid">
                      {BADGES.map((badge, index) => {
                        const earned =
                          Number(progression.badges[index] ?? 0) > 0;
                        return (
                          <article
                            className={`tn-badge ${earned ? "earned" : "locked"}`}
                            key={badge.name}
                          >
                            <span>
                              <img
                                src={badge.asset}
                                width="256"
                                height="256"
                                alt=""
                                aria-hidden="true"
                              />
                            </span>
                            <h3>{badge.name}</h3>
                            <p>{badge.copy}</p>
                            <strong>{earned ? "MINTED" : "LOCKED"}</strong>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                  <section className="panel tn-protection-card">
                    <div>
                      <span className="eyebrow">EARLY-PLAYER PROTECTION</span>
                      <h2>
                        {playerProgress.verified
                          ? `${Math.max(0, 3 - Number(playerProgress.protectedGames))} PROTECTED LOSSES LEFT`
                          : "SPONSOR APPROVAL REQUIRED"}
                      </h2>
                      <p>
                        Approved players can recover 1 tUSDC after a completed,
                        ranked loss with at least one real filled trade. Winner
                        prizes are never reduced.
                      </p>
                    </div>
                    <dl>
                      <div>
                        <dt>Your status</dt>
                        <dd>
                          {playerProgress.verified
                            ? "Approved"
                            : "Not approved"}
                        </dd>
                      </div>
                      <div>
                        <dt>Claims used</dt>
                        <dd>{playerProgress.protectedGames} / 3</dd>
                      </div>
                      <div>
                        <dt>Sponsor reserve</dt>
                        <dd>{cashFormat(progression.reserve)} tUSDC</dd>
                      </div>
                    </dl>
                  </section>
                </>
              )}
            </>
          )}
          {page === "history" && ops?.log?.length ? (
            <section className="panel tn-spacing tn-operator-receipts">
              <h2>EVENT OPERATOR RECEIPTS</h2>
              {ops.log.slice(0, 20).map((item) => (
                <div className="tn-player" key={item.hash}>
                  <span>
                    {item.label} · {item.status}
                  </span>
                  <TxLink hash={item.hash} />
                </div>
              ))}
            </section>
          ) : null}
          {page === "history" && (
            <>
              <div className="page-heading">
                <span className="eyebrow">SETTLED ON SHANNON</span>
                <h1>MATCH HISTORY</h1>
                <p>
                  Completed royales in this shared arena. Open a match to see
                  its players, ranks, and claims.
                </p>
              </div>
              <section className="panel">
                {snapshot?.tournaments.some((t) => t.phase >= 3) ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>ROYALE</th>
                          <th>RESULT</th>
                          <th>PRIZE POOL</th>
                          <th>ROUNDS</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {snapshot.tournaments
                          .filter((t) => t.phase >= 3)
                          .map((t) => (
                            <tr key={t.id}>
                              <td>#{t.id}</td>
                              <td>{PHASES[t.phase]}</td>
                              <td>{cashFormat(t.prizePool)} tUSDC</td>
                              <td>{t.round}</td>
                              <td>
                                <button
                                  className="text-link"
                                  onClick={() => openMatch(t.id)}
                                >
                                  View results <ArrowRight size={15} />
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty">
                    <img
                      className="tn-empty-art"
                      src="/art/vendor/fluent-emoji/stopwatch-3d.png"
                      width="256"
                      height="256"
                      alt=""
                      aria-hidden="true"
                    />
                    <h2>No finished royales on this page</h2>
                    <p>
                      Results appear after actual oracle settlement and on-chain
                      cuts.
                    </p>
                  </div>
                )}
                {snapshot?.hasOlder && (
                  <button
                    className="button blue"
                    onClick={() => setBefore(snapshot.nextBefore!)}
                  >
                    LOAD OLDER MATCHES
                  </button>
                )}
                {before > 0 && (
                  <button className="text-link" onClick={() => setBefore(0)}>
                    Back to latest
                  </button>
                )}
              </section>
            </>
          )}
          {page === "rules" && (
            <>
              <div className="page-heading">
                <span className="eyebrow">TRADE. SURVIVE. WIN.</span>
                <h1>HOW THE TESTNET ROYALE WORKS</h1>
              </div>
              <div className="detail-grid">
                <section className="panel">
                  <div className="rules-list">
                    {[
                      [
                        "Fund your seat",
                        "The host selects the entry contribution and equal starting vault. Every entrant accepts the same terms; STT pays gas.",
                        "/art/vendor/fluent-emoji/coin-3d.png",
                      ],
                      [
                        "Trade the same market",
                        "Buy or sell UP and DOWN event shares on DreamDEX as often as useful until market close. Orders execute immediately against real liquidity; the remainder cancels. Holding cash is also a valid strategy, but a round with zero fills across the whole field is cancelled.",
                        "/art/vendor/fluent-emoji/crossed-swords-3d.png",
                      ],
                      [
                        "Survive actual settlement",
                        "The oracle determines the payout. After all vaults settle, the bottom half is cut. Cash plus redeemed outcomes determine rank. Ties favor earlier on-chain entry.",
                        "/art/vendor/fluent-emoji/shield-3d.png",
                      ],
                      [
                        "Play through to the crown",
                        "The bankroll carries between rounds. The host selects up to four rounds. With two remaining, or on the final scheduled round, the highest bankroll wins.",
                        "/art/vendor/fluent-emoji/trophy-3d.png",
                      ],
                    ].map(([title, copy, asset], i) => (
                      <div className="rule" key={title}>
                        <span className="tn-rule-art">
                          <img
                            src={asset}
                            width="256"
                            height="256"
                            alt=""
                            aria-hidden="true"
                          />
                          <strong>0{i + 1}</strong>
                        </span>
                        <div>
                          <h3>{title}</h3>
                          <p>{copy}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="panel">
                  <h2>EVERY TOKEN ACCOUNTED FOR</h2>
                  <dl>
                    <div>
                      <dt>2-player duel</dt>
                      <dd>Winner takes 100% of the funded pot</dd>
                    </div>
                    <div>
                      <dt>3+ entrants · 1st</dt>
                      <dd>62.5%*</dd>
                    </div>
                    <div>
                      <dt>2nd</dt>
                      <dd>23.4375%</dd>
                    </div>
                    <div>
                      <dt>3rd</dt>
                      <dd>14.0625%</dd>
                    </div>
                  </dl>
                  <p className="small muted">
                    *First place receives any rounding remainder. Payouts scale
                    with the actual funded entry pool selected for that event.
                    The arena takes no entry-pool cut.
                  </p>
                  <h3>Starting & advancing</h3>
                  <p>
                    After enrollment, anyone can start. Anyone can submit
                    settlement batches after resolution. Between rounds, anyone
                    can select a fresh market from the same verified DreamDEX
                    creator, venue, and window length. BTC and ETH windows are
                    both eligible; all survivors trade the selected market.
                  </p>
                  <h3>Delays & refunds</h3>
                  <p>
                    Fewer than the host&apos;s declared minimum entrants or a
                    missed start unlock cancellation. A stalled oracle or next
                    round can be cancelled after 15 minutes. Players reclaim
                    entries and withdraw cash plus any unsettled shares, which
                    retain their DreamDEX redemption rights.
                  </p>
                  <h3>Real testnet only</h3>
                  <p>
                    No simulated players, balances, prices, fills, or results.
                    No mainnet option. Testnet tokens have no monetary value.
                    Liquidity and oracle availability depend on the live
                    DreamDEX testnet.
                  </p>
                  <a
                    className="text-link"
                    href="https://github.com/IronicDeGawd/ec-dreamdex-hackathon-template"
                    target="_blank"
                    rel="noreferrer"
                  >
                    DreamDEX integration reference <ExternalLink size={14} />
                  </a>
                </section>
              </div>
            </>
          )}
        </main>
        <footer>
          <span>
            MARKET ROYALE <span className="muted">· Shannon testnet</span>
          </span>
          <div>
            <span className="small muted">
              {snapshot
                ? `Block ${Number(snapshot.block).toLocaleString()} · ${Math.max(0, Math.floor((Date.now() - syncedAt) / 1000))}s ago`
                : "Connecting to chain…"}
            </span>
            <button onClick={() => go("rules")}>How it works</button>
            <a
              href={`${EXPLORER}/address/${COLLATERAL}`}
              target="_blank"
              rel="noreferrer"
            >
              tUSDC contract ↗
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
