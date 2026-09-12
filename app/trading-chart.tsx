"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import PlayerAvatar from "./player-avatar";
import { EXPLORER } from "../lib/testnet/config";

export type OracleCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  ema: number;
  updates: number;
};

export type ProbabilityCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
};

export type TradingChartData = {
  asset: string;
  from: number;
  to: number;
  underlying: OracleCandle[];
  probability: ProbabilityCandle[];
  underlyingError?: string | null;
  probabilityError?: string | null;
  activity: TradeActivity[];
  activityTruncated?: boolean;
  activityError?: string | null;
};

export type TradeActivity = {
  wallet: string;
  vault: string;
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
  hash: string;
};

type Props = {
  asset: string;
  start: number;
  expiry: number;
  now: number;
  data: TradingChartData | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  viewer?: string | null;
  rivalWallets?: string[];
};

const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1_000 ? 2 : 4,
  }).format(value);

const clock = (value: number) =>
  new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value * 1_000);

export default function TradingChart({
  asset,
  start,
  expiry,
  now,
  data,
  loading,
  error,
  onRetry,
  viewer,
  rivalWallets = [],
}: Props) {
  const [requestedMode, setRequestedMode] = useState<"asset" | "probability">(
    "asset",
  );
  const [activityFilter, setActivityFilter] = useState<
    "mine" | "rivals" | "field"
  >(viewer ? "rivals" : "field");
  const [pinnedCluster, setPinnedCluster] = useState("");
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 760, height: 286 });
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () =>
      setCanvasSize({
        width: Math.max(320, Math.round(canvas.clientWidth)),
        height: Math.max(190, Math.round(canvas.clientHeight)),
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  const hasAsset = Boolean(data?.underlying.length);
  const hasProbability = Boolean(data?.probability.length);
  const mode =
    requestedMode === "asset" && !hasAsset && hasProbability
      ? "probability"
      : requestedMode === "probability" && !hasProbability && hasAsset
        ? "asset"
        : requestedMode;
  const WIDTH = canvasSize.width;
  const HEIGHT = canvasSize.height;
  const PAD = {
    top: 22,
    right: mode === "asset" ? 88 : 54,
    bottom: 30,
    left: 12,
  };
  const source =
    mode === "asset" ? (data?.underlying ?? []) : (data?.probability ?? []);
  const chartStart =
    mode === "asset" && source[0]?.time && source[0].time < start
      ? source[0].time
      : start;
  const fullDuration = Math.max(60, expiry - start);
  const minimumLiveWindow = Math.min(
    fullDuration,
    Math.max(180, Math.round(fullDuration * 0.12)),
  );
  const visibleEnd =
    now >= expiry
      ? expiry
      : Math.min(
          expiry,
          Math.max(
            now,
            source.at(-1)?.time ?? start,
            start + minimumLiveWindow,
          ),
        );
  const series = source
    .filter((candle) => candle.time >= chartStart && candle.time <= visibleEnd)
    .map((candle) => ({
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
  const first = series[0];
  const last = series.at(-1);
  const roundSeries = series.filter((point) => point.time >= start);
  const roundFirst = roundSeries[0];
  const roundOpen = roundFirst?.open ?? first?.open;
  const roundRange = roundSeries.length ? roundSeries : series;
  const rangeValues = series.flatMap((point) => [point.low, point.high]);
  let min = Math.min(...rangeValues);
  let max = Math.max(...rangeValues);
  if (mode === "probability" && Number.isFinite(min) && Number.isFinite(max)) {
    const center = (min + max) / 2;
    const halfRange = Math.max((max - min) * 0.7, 0.05);
    min = Math.max(0, center - halfRange);
    max = Math.min(1, center + halfRange);
  }
  if (mode === "asset" && Number.isFinite(min) && Number.isFinite(max)) {
    const padding = Math.max((max - min) * 0.16, max * 0.00015);
    min -= padding;
    max += padding;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    min = 0;
    max = 1;
  }
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const x = (time: number) =>
    PAD.left +
    ((Math.min(visibleEnd, Math.max(chartStart, time)) - chartStart) /
      Math.max(1, visibleEnd - chartStart)) *
      plotWidth;
  const y = (value: number) =>
    PAD.top +
    ((max - value) / Math.max(Number.EPSILON, max - min)) * plotHeight;
  const line = series
    .map(
      (point, index) =>
        `${index ? "L" : "M"} ${x(point.time).toFixed(2)} ${y(point.close).toFixed(2)}`,
    )
    .join(" ");
  const area = last
    ? `${line} L ${x(last.time).toFixed(2)} ${HEIGHT - PAD.bottom} L ${x(first.time).toFixed(2)} ${HEIGHT - PAD.bottom} Z`
    : "";
  const change =
    roundOpen && last
      ? ((last.close - roundOpen) / roundOpen) * 100
      : 0;
  const probabilityMove =
    roundOpen !== undefined && last ? (last.close - roundOpen) * 100 : 0;
  const winning = last
    ? mode === "asset"
      ? last.close >= (roundOpen ?? last.close)
      : last.close >= 0.5
    : false;
  const currentX = x(Math.min(now, visibleEnd));
  const empty = !series.length;
  const sourceError =
    mode === "asset" ? data?.underlyingError : data?.probabilityError;
  const viewerKey = viewer?.toLowerCase() ?? "";
  const rivalKeys = new Set(rivalWallets.map((wallet) => wallet.toLowerCase()));
  const delayedActivity = (data?.activity ?? []).filter(
    (trade) =>
      trade.time >= start &&
      trade.time <= visibleEnd &&
      (trade.wallet.toLowerCase() === viewerKey || now - trade.time >= 8),
  );
  const filteredActivity = delayedActivity.filter((trade) => {
    const wallet = trade.wallet.toLowerCase();
    if (activityFilter === "mine") return wallet === viewerKey;
    if (activityFilter === "rivals")
      return wallet === viewerKey || rivalKeys.has(wallet);
    return true;
  });
  const clusterWindow = Math.max(
    1,
    Math.ceil(
      Math.max(1, visibleEnd - start) /
        (activityFilter === "field"
          ? 18
          : activityFilter === "rivals"
            ? 26
            : 42),
    ),
  );
  const groupedActivity: { key: string; trades: TradeActivity[] }[] = [];
  const latestGroup = new Map<TradeActivity["direction"], number>();
  for (const trade of [...filteredActivity].sort((a, b) => a.time - b.time)) {
    const groupIndex = latestGroup.get(trade.direction);
    const group =
      groupIndex === undefined ? undefined : groupedActivity[groupIndex];
    if (group && trade.time - group.trades[0].time <= clusterWindow) {
      group.trades.push(trade);
    } else {
      latestGroup.set(trade.direction, groupedActivity.length);
      groupedActivity.push({
        key: `${trade.direction}:${trade.hash}:${trade.logIndex}`,
        trades: [trade],
      });
    }
  }
  const activityClusters = groupedActivity.map(({ key, trades }) => {
    const time = Math.round(
      trades.reduce((sum, trade) => sum + trade.time, 0) / trades.length,
    );
    const probability =
      trades.reduce((sum, trade) => sum + trade.upPrice, 0) /
      trades.length /
      1_000_000;
    const nearest = series.reduce(
      (best, point) =>
        Math.abs(point.time - time) < Math.abs(best.time - time) ? point : best,
      series[0],
    );
    return {
      key,
      trades,
      time,
      value: mode === "probability" ? probability : nearest?.close,
    };
  });
  const playerLabel = (wallet: string) =>
    wallet.toLowerCase() === viewerKey
      ? "YOU"
      : `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
  const tokenAmount = (value: string) =>
    (Number(value) / 1_000_000).toLocaleString(undefined, {
      maximumFractionDigits: 3,
    });

  return (
    <section className="mr-trading-chart" aria-label="Live market chart">
      <header className="mr-chart-header">
        <div>
          <span className="eyebrow">
            {mode === "asset" ? "DREAMDEX ORACLE" : "MARKET PROBABILITY"}
          </span>
          <div className="mr-chart-quote">
            <strong>
              {last
                ? mode === "asset"
                  ? money(last.close)
                  : `${(last.close * 100).toFixed(1)}¢`
                : "—"}
            </strong>
            {last && first && (
              <span className={winning ? "is-up" : "is-down"}>
                {winning ? (
                  <TrendingUp size={15} />
                ) : (
                  <TrendingDown size={15} />
                )}
                {mode === "asset" ? (
                  <>
                    {change >= 0 ? "+" : ""}
                    {change.toFixed(2)}%
                  </>
                ) : (
                  <>
                    {probabilityMove >= 0 ? "+" : ""}
                    {probabilityMove.toFixed(1)} pts
                  </>
                )}
              </span>
            )}
            {last && (
              <span className="mr-chart-live">
                <i /> LIVE · {Math.max(0, now - last.time)}s
              </span>
            )}
          </div>
        </div>
        <div className="mr-chart-controls">
          <div className="mr-chart-tabs" aria-label="Chart series">
            <button
              className={mode === "asset" ? "selected" : ""}
              onClick={() => setRequestedMode("asset")}
              disabled={!hasAsset && Boolean(data)}
            >
              {asset}/USD
            </button>
            <button
              className={mode === "probability" ? "selected" : ""}
              onClick={() => setRequestedMode("probability")}
              disabled={!hasProbability && Boolean(data)}
            >
              UP CHANCE
            </button>
          </div>
          <div
            className="mr-activity-filters"
            aria-label="Player trade markers"
          >
            {viewer && (
              <button
                className={activityFilter === "mine" ? "selected" : ""}
                onClick={() => setActivityFilter("mine")}
              >
                MY FILLS
              </button>
            )}
            <button
              className={activityFilter === "rivals" ? "selected" : ""}
              onClick={() => setActivityFilter("rivals")}
            >
              RIVALS
            </button>
            <button
              className={activityFilter === "field" ? "selected" : ""}
              onClick={() => setActivityFilter("field")}
            >
              FIELD
            </button>
          </div>
        </div>
      </header>

      <div className="mr-chart-canvas" ref={canvasRef}>
        {loading && !data ? (
          <div className="mr-chart-skeleton" role="status">
            <Activity size={22} /> Loading real market history…
          </div>
        ) : error && !data ? (
          <div className="mr-chart-empty" role="alert">
            <strong>Chart feed paused</strong>
            <span>{error}</span>
            <button onClick={onRetry}>
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        ) : empty ? (
          <div className="mr-chart-empty">
            <strong>No chart points yet</strong>
            <span>
              {sourceError ??
                "The first live bucket appears after market activity."}
            </span>
            <button onClick={onRetry}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        ) : (
          <>
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              role="img"
              aria-label={`${mode === "asset" ? asset + " price" : "UP probability"} from ${clock(chartStart)} to ${clock(visibleEnd)}`}
              preserveAspectRatio="xMidYMid meet"
            >
              <title>
                {mode === "asset"
                  ? `${asset} oracle price with pre-round context`
                  : "UP contract probability during this round"}
              </title>
              <defs>
                <linearGradient id="mr-chart-area" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={winning ? "#176ee8" : "#7641df"}
                    stopOpacity="0.28"
                  />
                  <stop
                    offset="100%"
                    stopColor={winning ? "#176ee8" : "#7641df"}
                    stopOpacity="0.01"
                  />
                </linearGradient>
              </defs>
              {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                const value = max - (max - min) * ratio;
                const py = PAD.top + plotHeight * ratio;
                return (
                  <g key={ratio}>
                    <line
                      className="mr-chart-gridline"
                      x1={PAD.left}
                      x2={WIDTH - PAD.right}
                      y1={py}
                      y2={py}
                    />
                    <text
                      className="mr-chart-axis"
                      x={WIDTH - PAD.right + 10}
                      y={py + 4}
                    >
                      {mode === "asset"
                        ? money(value)
                        : `${Math.round(value * 100)}¢`}
                    </text>
                  </g>
                );
              })}
              {mode === "asset" && roundOpen !== undefined && (
                <g>
                  <line
                    className="mr-chart-open-line"
                    x1={PAD.left}
                    x2={WIDTH - PAD.right}
                    y1={y(roundOpen)}
                    y2={y(roundOpen)}
                  />
                  <text
                    className="mr-chart-open-label"
                    x={PAD.left + 8}
                    y={y(roundOpen) - 7}
                  >
                    ROUND OPEN {money(roundOpen)}
                  </text>
                </g>
              )}
              {chartStart < start && start <= visibleEnd && (
                <g>
                  <line
                    className="mr-chart-start-line"
                    x1={x(start)}
                    x2={x(start)}
                    y1={PAD.top}
                    y2={HEIGHT - PAD.bottom}
                  />
                  <text
                    className="mr-chart-start-label"
                    x={x(start) + 7}
                    y={PAD.top + 12}
                  >
                    ROUND START
                  </text>
                </g>
              )}
              {mode === "probability" && min < 0.5 && max > 0.5 && (
                <g>
                  <line
                    className="mr-chart-even-line"
                    x1={PAD.left}
                    x2={WIDTH - PAD.right}
                    y1={y(0.5)}
                    y2={y(0.5)}
                  />
                  <text
                    className="mr-chart-even-label"
                    x={PAD.left + 8}
                    y={y(0.5) - 7}
                  >
                    EVEN 50¢
                  </text>
                </g>
              )}
              <line
                className="mr-chart-now-line"
                x1={currentX}
                x2={currentX}
                y1={PAD.top}
                y2={HEIGHT - PAD.bottom}
              />
              {area && <path className="mr-chart-area" d={area} />}
              {series.map((point) => (
                <line
                  key={point.time}
                  className="mr-chart-wick"
                  x1={x(point.time)}
                  x2={x(point.time)}
                  y1={y(point.high)}
                  y2={y(point.low)}
                />
              ))}
              <path
                className="mr-chart-line"
                data-direction={winning ? "up" : "down"}
                d={line}
              />
              {last && (
                <circle
                  className="mr-chart-last"
                  data-direction={winning ? "up" : "down"}
                  cx={x(last.time)}
                  cy={y(last.close)}
                  r="5"
                />
              )}
              <text className="mr-chart-time" x={PAD.left} y={HEIGHT - 7}>
                {chartStart < start ? "CONTEXT " : ""}
                {clock(chartStart)}
              </text>
              <text
                className="mr-chart-time"
                x={WIDTH - PAD.right}
                y={HEIGHT - 7}
                textAnchor="end"
              >
                {now >= expiry ? "CLOSE " : "LIVE "}
                {clock(visibleEnd)}
              </text>
            </svg>
            <div className="mr-chart-activity-layer" aria-live="off">
              {activityClusters.map((cluster) => {
                if (cluster.value === undefined) return null;
                const isBuy = cluster.trades[0].direction === "BUY";
                const selected = pinnedCluster === cluster.key;
                const sides = [
                  ...new Set(cluster.trades.map((trade) => trade.side)),
                ];
                const sideLabel =
                  sides.length === 1 ? sides[0] : "mixed UP and DOWN";
                const wallets = [
                  ...new Map(
                    cluster.trades.map((trade) => [
                      trade.wallet.toLowerCase(),
                      trade.wallet,
                    ]),
                  ).values(),
                ];
                return (
                  <div
                    key={cluster.key}
                    className={`mr-trade-marker ${isBuy ? "is-buy" : "is-sell"} ${selected ? "is-pinned" : ""}`}
                    style={{
                      left: `${(x(cluster.time) / WIDTH) * 100}%`,
                      top: `${(y(cluster.value) / HEIGHT) * 100}%`,
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`${cluster.trades.length} confirmed ${cluster.trades[0].direction.toLowerCase()} ${sideLabel} fill${cluster.trades.length === 1 ? "" : "s"}`}
                    onClick={() =>
                      setPinnedCluster(selected ? "" : cluster.key)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setPinnedCluster(selected ? "" : cluster.key);
                      }
                    }}
                  >
                    <span className="mr-trade-marker-bubble">
                      <span className="mr-trade-marker-avatars">
                        {wallets.slice(0, 3).map((wallet) => (
                          <PlayerAvatar
                            key={wallet}
                            seed={wallet}
                            size="xs"
                            label={playerLabel(wallet)}
                            active
                          />
                        ))}
                      </span>
                      <b aria-hidden="true">
                        {cluster.trades[0].direction === "BUY" ? "B" : "S"}
                      </b>
                      {cluster.trades.length > 1 && (
                        <em>{cluster.trades.length}</em>
                      )}
                    </span>
                    <span className="mr-trade-tooltip" role="tooltip">
                      <strong>
                        CONFIRMED {cluster.trades[0].direction} ACTIVITY
                      </strong>
                      {cluster.trades
                        .slice(-4)
                        .reverse()
                        .map((trade) => (
                          <span
                            className="mr-trade-tooltip-row"
                            key={`${trade.hash}:${trade.logIndex}`}
                          >
                            <PlayerAvatar
                              seed={trade.wallet}
                              size="xs"
                              label={playerLabel(trade.wallet)}
                              active
                            />
                            <span>
                              <b>{playerLabel(trade.wallet)}</b>
                              <small>
                                {trade.direction} {tokenAmount(trade.shares)}{" "}
                                {trade.side} ·{" "}
                                {(trade.price / 10_000).toFixed(1)}¢
                              </small>
                              <small>
                                Vault {tokenAmount(trade.cashAfter)} tUSDC ·{" "}
                                {clock(trade.time)}
                              </small>
                            </span>
                            <a
                              href={`${EXPLORER}/tx/${trade.hash}`}
                              target="_blank"
                              rel="noreferrer"
                              aria-label="View confirmed fill transaction"
                              onClick={(event) => event.stopPropagation()}
                            >
                              ↗
                            </a>
                          </span>
                        ))}
                      {cluster.trades.length > 4 && (
                        <small>
                          +{cluster.trades.length - 4} more fills in this
                          cluster
                        </small>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            {(data?.activityError || data?.activityTruncated) && (
              <span className="mr-chart-activity-note">
                {data.activityError ?? "Showing the latest 600 confirmed fills"}
              </span>
            )}
          </>
        )}
      </div>

      <div className="mr-chart-footer">
        <span>
          <small>ROUND OPEN</small>
          <strong>
            {roundOpen !== undefined
              ? mode === "asset"
                ? money(roundOpen)
                : `${(roundOpen * 100).toFixed(1)}¢`
              : "—"}
          </strong>
        </span>
        <span>
          <small>ROUND HIGH / LOW</small>
          <strong>
            {roundRange.length
              ? mode === "asset"
                ? `${money(Math.max(...roundRange.map((p) => p.high)))} / ${money(Math.min(...roundRange.map((p) => p.low)))}`
                : `${(Math.max(...roundRange.map((p) => p.high)) * 100).toFixed(1)}¢ / ${(Math.min(...roundRange.map((p) => p.low)) * 100).toFixed(1)}¢`
              : "—"}
          </strong>
        </span>
        <span>
          <small>SIGNAL</small>
          <strong className={winning ? "is-up" : "is-down"}>
            {first ? (winning ? "UP is ahead" : "DOWN is ahead") : "Waiting"}
          </strong>
        </span>
      </div>
    </section>
  );
}
