import { isAddress } from "viem";

export const dynamic = "force-dynamic";

type OperationsEnv = {
  EVENT_OPERATIONS: Fetcher;
  FAUCET_API_TOKEN: string;
};

export async function POST(request: Request) {
  let body: { address?: string };
  try {
    body = (await request.json()) as { address?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body.address || !isAddress(body.address))
    return Response.json(
      { error: "Connect a valid wallet before requesting STT." },
      { status: 400 },
    );
  try {
    let response: Response;
    if (process.env.NODE_ENV === "development") {
      if (!process.env.FAUCET_API_TOKEN)
        throw new Error("The local faucet relay is not configured.");
      response = await fetch("http://127.0.0.1:8787/faucet", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-market-royale-faucet-token": process.env.FAUCET_API_TOKEN,
        },
        body: JSON.stringify({ address: body.address }),
        cache: "no-store",
        signal: AbortSignal.timeout(130_000),
      });
    } else {
      const { getCloudflareContext } = await import("@opennextjs/cloudflare");
      const { env } = getCloudflareContext();
      const operations = env as typeof env & OperationsEnv;
      if (!operations.FAUCET_API_TOKEN)
        throw new Error("The gas faucet relay is not configured.");
      response = await operations.EVENT_OPERATIONS.fetch(
        new Request("https://operations/faucet", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-market-royale-faucet-token": operations.FAUCET_API_TOKEN,
          },
          body: JSON.stringify({ address: body.address }),
        }),
      );
    }
    const data = (await response.json()) as Record<string, unknown>;
    return Response.json(data, {
      status: response.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The gas faucet is temporarily unavailable.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
