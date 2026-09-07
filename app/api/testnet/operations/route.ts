export const dynamic = "force-dynamic";
const deployedKeeper =
  process.env.EVENT_OPERATIONS_URL ??
  "https://market-royale-keeper.lazydevpro.workers.dev";

async function developmentKeeper(path: string, init?: RequestInit) {
  try {
    const local = await fetch(`http://127.0.0.1:8787${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (local.ok) return local;
  } catch {}
  return fetch(`${deployedKeeper}${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
}

export async function GET() {
  try {
    let response: Response;
    if (process.env.NODE_ENV === "development")
      response = await developmentKeeper("/status");
    else {
      const { getCloudflareContext } = await import("@opennextjs/cloudflare");
      const { env } = getCloudflareContext();
      response = await (
        env as typeof env & { EVENT_OPERATIONS: Fetcher }
      ).EVENT_OPERATIONS.fetch("https://operations/status");
    }
    if (!response.ok) throw new Error("Keeper unavailable");
    return Response.json(await response.json(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        enabled: false,
        error:
          "Event operator is offline. You can still start, settle, cancel and recover funds directly from the app.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  let body: { matchId?: number; asset?: string } = {};
  try {
    body = (await request.json()) as { matchId?: number };
  } catch {}
  if (!Number.isSafeInteger(body.matchId) || Number(body.matchId) <= 0)
    return Response.json({ error: "A valid match id is required." }, { status: 400 });
  try {
    let response: Response;
    const wakeRequest = new Request("https://operations/wake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchId: body.matchId, asset: body.asset }),
    });
    if (process.env.NODE_ENV === "development")
      response = await developmentKeeper("/wake", {
        method: "POST",
        headers: wakeRequest.headers,
        body: JSON.stringify({ matchId: body.matchId, asset: body.asset }),
      });
    else {
      const { getCloudflareContext } = await import("@opennextjs/cloudflare");
      const { env } = getCloudflareContext();
      response = await (
        env as typeof env & { EVENT_OPERATIONS: Fetcher }
      ).EVENT_OPERATIONS.fetch(wakeRequest);
    }
    return Response.json(await response.json(), {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Event operator is offline." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
