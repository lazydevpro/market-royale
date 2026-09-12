import { isHex, zeroAddress, type Hex } from "viem";
import {
  address,
  head,
  readMarket,
  scopedClient,
} from "../../../../lib/testnet/server";
import { liquidityAbi, outcomeAbi } from "../../../../lib/testnet/config";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams;
    const id = q.get("id");
    if (!id || !isHex(id) || id.length !== 66)
      throw new Error("Invalid market ID.");
    const account = address(q.get("account"));
    if (!account) throw new Error("Wallet required.");
    const client = scopedClient();
    const block = await head(client),
      blockNumber = block.number,
      m = await readMarket(id as Hex, undefined, blockNumber, client);
    const balances = await Promise.all(
      [m.yesId, m.noId].map((id) =>
        client.readContract({
          address: m.outcomeToken,
          abi: outcomeAbi,
          functionName: "balanceOf",
          args: [account, BigInt(id)],
          blockNumber,
        }),
      ),
    );
    const orders = [];
    let truncated = false;
    if (!m.recycled)
      for (const isBid of [true, false]) {
        const result = await client.readContract({
          address: m.pool,
          abi: liquidityAbi,
          functionName: "getAllOpenOrdersOffChain",
          args: [isBid, 100n, 0n],
          account: zeroAddress,
          blockNumber,
        });
        orders.push(
          ...result[0].filter(
            (o) => o.owner.toLowerCase() === account.toLowerCase(),
          ),
        );
        truncated ||= result[1];
      }
    return Response.json(
      JSON.parse(
        JSON.stringify(
          {
            market: m,
            yes: String(balances[0]),
            no: String(balances[1]),
            orders,
            truncated,
            timestamp: Number(block.timestamp),
          },
          (_, v) => (typeof v === "bigint" ? v.toString() : v),
        ),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("Liquidity read:", e instanceof Error ? e.message : e);
    return Response.json(
      { error: "Unable to read this market’s wallet inventory and orders." },
      { status: 503 },
    );
  }
}
