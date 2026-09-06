import { markets } from "../../../../lib/testnet/server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return Response.json(await markets(), {
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
