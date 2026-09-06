"use client";
import { useEffect, useState } from "react";
import {
  type Address,
  type Abi,
  parseUnits,
  zeroAddress,
  zeroHash,
} from "viem";
import {
  MODULE,
  COLLATERAL,
  liquidityAbi,
  tokenAbi,
  outcomeAbi,
  moduleAbi,
  cashFormat,
  type LiveMarket,
} from "../lib/testnet/config";
import { publicClient, explain } from "../lib/testnet/wallet";
type Inventory = {
  market: LiveMarket;
  yes: string;
  no: string;
  orders: {
    orderId: string;
    isBid: boolean;
    price: string;
    quantityRemaining: string;
  }[];
  truncated: boolean;
  timestamp: number;
};
type Props = {
  account: Address | null;
  live: LiveMarket[];
  allowed: boolean;
  pending: string;
  run: (label: string, action: () => Promise<void>) => Promise<void>;
  tx: (
    label: string,
    address: Address,
    abi: Abi,
    fn: string,
    args?: readonly unknown[],
  ) => Promise<unknown>;
};
export default function Liquidity({
  account,
  live,
  allowed,
  pending,
  run,
  tx,
}: Props) {
  const [id, setId] = useState(""),
    [saved, setSaved] = useState<string[]>([]),
    [amount, setAmount] = useState("20"),
    [side, setSide] = useState<"UP" | "DOWN">("UP"),
    [price, setPrice] = useState("55");
  const [inventory, setInventory] = useState<Inventory | null>(null),
    [error, setError] = useState(""),
    [updated, setUpdated] = useState(0),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("market-royale-liquidity-v1") ?? "[]",
      );
      if (Array.isArray(saved))
        setSaved(
          saved.filter(
            (s) => typeof s === "string" && /^0x[0-9a-fA-F]{64}$/.test(s),
          ),
        );
    } catch {}
  }, []);
  useEffect(() => {
    if (!id && live[0]) setId(live[0].id);
  }, [id, live]);
  useEffect(() => {
    if (!account || !id) {
      setInventory(null);
      return;
    }
    const abort = new AbortController();
    let busy = false;
    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        const r = await fetch(
          `/api/testnet/liquidity?id=${id}&account=${account}`,
          { signal: abort.signal, cache: "no-store" },
        );
        const d = (await r.json()) as Inventory & { error: string };
        if (!r.ok) throw new Error(d.error);
        if (!abort.signal.aborted) {
          setInventory(d);
          setError("");
          setUpdated(Date.now());
        }
      } catch (e) {
        if (!abort.signal.aborted) {
          setError(explain(e));
          setInventory(null);
        }
      } finally {
        busy = false;
      }
    };
    void load();
    const timer = setInterval(load, 15000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [id, account, refresh, pending]);
  const market = inventory?.market;
  const open =
    market?.status === 1 &&
    !market.recycled &&
    market.expiry * 1000 > Date.now() + 15000;
  const fresh = !!inventory && Date.now() - updated < 30000 && !error;
  const enabled = allowed && fresh;
  const remember = () => {
    const next = [id, ...saved.filter((s) => s !== id)].slice(0, 20);
    setSaved(next);
    localStorage.setItem("market-royale-liquidity-v1", JSON.stringify(next));
  };
  const action = (label: string, fn: () => Promise<void>) =>
    run(label, async () => {
      await fn();
      remember();
      setRefresh((r) => r + 1);
    });
  const qty = () => {
    const n = parseUnits(amount, 6);
    if (n <= 0n) throw new Error("Enter a positive share quantity.");
    return n;
  };
  const options = [
    ...live.map((m) => m.id),
    ...saved.filter((id) => !live.some((m) => m.id === id)),
  ];
  return (
    <section className="panel tn-spacing">
      <span className="eyebrow">OPTIONAL · REAL ORDER-BOOK LIQUIDITY</span>
      <h2>03 · FUND THE MARKET</h2>
      <p>
        When the testnet book is empty, a separate funded wallet can mint
        outcome pairs and offer shares. These are actual DreamDEX orders,
        available to all traders. Each side settles against the real oracle.
      </p>
      <div className="tn-form-grid">
        <label>
          MARKET
          <select
            value={id}
            onChange={(e) => {
              setInventory(null);
              setId(e.target.value);
            }}
          >
            {!options.length && <option>No markets available</option>}
            {options.map((id) => {
              const m = live.find((m) => m.id === id);
              return (
                <option key={id} value={id}>
                  {m
                    ? `${m.asset} · ${m.interval / 60} min · ${new Date(m.expiry * 1000).toLocaleTimeString()}`
                    : `Saved market …${id.slice(-6)}`}
                </option>
              );
            })}
          </select>
        </label>
        <label>
          PAIRS / SHARES
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label>
          SELL SIDE
          <select
            value={side}
            onChange={(e) => setSide(e.target.value as "UP" | "DOWN")}
          >
            <option>UP</option>
            <option>DOWN</option>
          </select>
        </label>
        <label>
          ASK PRICE (¢)
          <input
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      {inventory && (
        <p>
          <strong>Your wallet inventory:</strong> {cashFormat(inventory.yes)} UP
          · {cashFormat(inventory.no)} DOWN. Locked maker inventory is shown in
          orders below.
        </p>
      )}
      <div className="tn-lp-actions">
        <button
          className="button blue"
          disabled={!enabled || !open}
          onClick={() =>
            action("Mint outcome pairs", async () => {
              const amount = qty();
              await tx("Approve pair mint", COLLATERAL, tokenAbi, "approve", [
                market!.pool,
                amount,
              ]);
              await tx(
                "Mint outcome pairs",
                market!.pool,
                liquidityAbi,
                "mintSet",
                [account!, account!, amount],
              );
            })
          }
        >
          MINT OUTCOME PAIRS
        </button>
        <button
          className="button green"
          disabled={!enabled || !open}
          onClick={() =>
            action(`Offer ${side} liquidity`, async () => {
              const q = qty(),
                ask = parseUnits(price, 4),
                yesPrice = side === "UP" ? ask : 1_000_000n - ask;
              if (
                ask <= 0n ||
                ask >= 1_000_000n ||
                yesPrice % BigInt(market!.tick) !== 0n ||
                q < BigInt(market!.min) ||
                q % BigInt(market!.lot) !== 0n
              )
                throw new Error(
                  "Use a valid price tick and quantity lot for this market.",
                );
              if (q > BigInt(side === "UP" ? inventory!.yes : inventory!.no))
                throw new Error("Mint enough pairs before offering shares.");
              await tx(
                "Approve outcome escrow",
                market!.outcomeToken,
                outcomeAbi,
                "setOperator",
                [market!.pool, true],
              );
              await tx(
                `Post ${side} maker order`,
                market!.pool,
                liquidityAbi,
                "placeBinaryOrder",
                [
                  side === "UP" ? 1 : 3,
                  yesPrice,
                  q,
                  BigInt(market!.expiry) * 1_000_000_000n,
                  3,
                  0,
                  zeroAddress,
                  0n,
                  0n,
                ],
              );
              await tx(
                "Revoke outcome escrow operator",
                market!.outcomeToken,
                outcomeAbi,
                "setOperator",
                [market!.pool, false],
              );
            })
          }
        >
          POST {side} ASK
        </button>
      </div>
      <p className="small muted">
        Minting 20 pairs spends 20 tUSDC and gives 20 UP + 20 DOWN shares. A 55¢
        UP ask and a 55¢ DOWN ask create a 45¢ / 55¢ UP-price spread. Post-only
        orders revert if they would immediately cross. Maker funds are
        independent of tournament vaults.
      </p>
      {inventory && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>YOUR RESTING ORDERS</th>
                <th>UP PRICE</th>
                <th>SHARES LEFT</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {inventory.orders.map((o) => (
                <tr key={o.orderId}>
                  <td>
                    {o.isBid ? "Bid" : "Ask"} · #{o.orderId}
                  </td>
                  <td>{Number(o.price) / 10000}¢</td>
                  <td>{cashFormat(o.quantityRemaining)}</td>
                  <td>
                    <button
                      className="text-link"
                      disabled={!enabled}
                      onClick={() =>
                        action("Cancel maker order", async () => {
                          await tx(
                            "Cancel maker order",
                            market!.pool,
                            liquidityAbi,
                            "cancelOrder",
                            [BigInt(o.orderId)],
                          );
                        })
                      }
                    >
                      Cancel & unlock
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!inventory.orders.length && (
            <p>No resting orders for this wallet in the scanned book.</p>
          )}
          {inventory.truncated && (
            <p>
              Showing the first 100 orders on each side. Additional orders may
              exist.
            </p>
          )}
        </div>
      )}
      {market && (market.resolved || market.voided) && inventory && (
        <div className="tn-lp-actions">
          {(["UP", "DOWN"] as const).map((s, i) =>
            BigInt(market.payouts[i] ?? 0) > 0n &&
            BigInt(i === 0 ? inventory.yes : inventory.no) > 0n ? (
              <button
                className="button green"
                key={s}
                disabled={!enabled}
                onClick={() =>
                  action(`Redeem ${s} inventory`, async () => {
                    const amount = await publicClient.readContract({
                      address: market.outcomeToken,
                      abi: outcomeAbi,
                      functionName: "balanceOf",
                      args: [
                        account!,
                        BigInt(i === 0 ? market.yesId : market.noId),
                      ],
                    });
                    await tx(
                      "Approve inventory redemption",
                      market.outcomeToken,
                      outcomeAbi,
                      "setOperator",
                      [MODULE, true],
                    );
                    await tx(
                      `Redeem ${s} inventory`,
                      MODULE,
                      moduleAbi,
                      "redeem",
                      [0, zeroHash, market.id, i, amount],
                    );
                    await tx(
                      "Revoke redemption operator",
                      market.outcomeToken,
                      outcomeAbi,
                      "setOperator",
                      [MODULE, false],
                    );
                  })
                }
              >
                REDEEM {s} INVENTORY
              </button>
            ) : null,
          )}
        </div>
      )}
      {market && (
        <button
          className="text-link"
          disabled={!allowed}
          onClick={() =>
            action("Revoke outcome permissions", async () => {
              await tx(
                "Revoke pool operator",
                market.outcomeToken,
                outcomeAbi,
                "setOperator",
                [market.pool, false],
              );
              await tx(
                "Revoke module operator",
                market.outcomeToken,
                outcomeAbi,
                "setOperator",
                [MODULE, false],
              );
            })
          }
        >
          Revoke wallet outcome permissions
        </button>
      )}
    </section>
  );
}
