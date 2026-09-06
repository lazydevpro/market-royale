import { address, snapshot } from "../../../../lib/testnet/server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams;
    const id = Number(q.get("id") ?? 0),
      before = Number(q.get("before") ?? 0);
    if (
      !Number.isSafeInteger(id) ||
      id < 0 ||
      !Number.isSafeInteger(before) ||
      before < 0
    )
      throw new Error("Invalid match number.");
    return Response.json(
      await snapshot(
        address(q.get("registry")),
        address(q.get("account")),
        id,
        before,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("Testnet state read:", e instanceof Error ? e.message : e);
    return Response.json(
      {
        error:
          e instanceof Error &&
          e.message.startsWith("Shannon is returning stale blocks")
            ? e.message
            : "Unable to verify this testnet match or wallet. Check the registry address and RPC, then retry.",
      },
      { status: 503 },
    );
  }
}
