import { isAddress, type Address } from "viem";
import {
  marketChart,
  tournamentTradeActivity,
} from "../../../../lib/testnet/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const pool = params.get("pool") ?? "";
    const asset = (params.get("asset") ?? "").toUpperCase();
    const from = Number(params.get("from"));
    const to = Number(params.get("to"));
    const registry = params.get("registry") ?? "";
    const match = Number(params.get("match") ?? 0);
    if (!isAddress(pool))
      return Response.json(
        { error: "Invalid DreamDEX pool." },
        { status: 400 },
      );
    if (!/^[A-Z0-9]{2,12}$/.test(asset))
      return Response.json({ error: "Invalid market asset." }, { status: 400 });
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from <= 0 ||
      to < from ||
      to - from > 86_400
    )
      return Response.json({ error: "Invalid chart window." }, { status: 400 });
    if (
      (registry || match) &&
      (!isAddress(registry) || !Number.isSafeInteger(match) || match <= 0)
    )
      return Response.json(
        { error: "Invalid royale activity query." },
        { status: 400 },
      );
    const [chart, activity] = await Promise.all([
      marketChart(pool, asset, from, to),
      registry && match
        ? tournamentTradeActivity(registry as Address, match).catch(() => null)
        : Promise.resolve(null),
    ]);
    return Response.json(
      {
        ...chart,
        activity: activity?.activity ?? [],
        activityTruncated: activity?.truncated ?? false,
        activityError:
          registry && match && !activity
            ? "Confirmed player fills are temporarily unavailable."
            : null,
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    console.error(
      "DreamDEX chart read:",
      error instanceof Error ? error.message : error,
    );
    return Response.json(
      {
        error:
          "Unable to load DreamDEX chart history. Live trading data will continue refreshing.",
      },
      { status: 503 },
    );
  }
}
