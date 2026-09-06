"use client";
import type { WalletOption, Provider } from "./wallet";
export async function discoverLocalWallets(): Promise<WalletOption[]> {
  const response = await fetch("/api/local-wallet", { cache: "no-store" });
  if (!response.ok) return [];
  const data = (await response.json()) as {
    enabled: boolean;
    wallets: { id: string; name: string }[];
  };
  if (!data.enabled) return [];
  return data.wallets.map(
    (wallet: { id: string; name: string }, i: number) => ({
      id: wallet.id,
      name: wallet.name,
      provider: {
        request: async (args: { method: string; params?: unknown }) => {
          const r = await fetch("/api/local-wallet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wallet: i, ...args }),
          });
          const d = (await r.json()) as { error?: string; result: unknown };
          if (!r.ok) throw new Error(d.error ?? "Local wallet request failed.");
          return d.result;
        },
      } as Provider,
    }),
  );
}
