import { markets } from "../../../../lib/testnet/server";
export const dynamic = "force-dynamic";

async function cachedMarkets() {
  if (process.env.NODE_ENV === "development") {
    try {
      const response = await fetch("http://127.0.0.1:8787/markets", {
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) return response.json();
    } catch {}
    return markets();
  }
  const { getCloudflareContext } = await import("@opennextjs/cloudflare");
  const { env } = getCloudflareContext();
  const response = await (
    env as typeof env & { EVENT_OPERATIONS: Fetcher }
  ).EVENT_OPERATIONS.fetch("https://operations/markets");
  if (!response.ok) throw new Error("Market feed unavailable");
  return response.json();
}

export async function GET() {
  try {
    return Response.json(await cachedMarkets(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("Testnet market read:", e instanceof Error ? e.message : e);
    return Response.json(
      {
        error:
          "Unable to read live DreamDEX markets. Check the Shannon RPC connection and retry.",
      },
      { status: 503 },
    );
  }
}
