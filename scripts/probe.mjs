import { createPublicClient, http } from "viem";
import { somniaTestnet } from "viem/chains";
import { marketCreatorEventsAbi } from "../node_modules/@somnia-chain/markets-sdk/dist/eventsAbi.js";
import { binaryModuleReadAbi } from "../node_modules/@somnia-chain/markets-sdk/dist/moduleAbi.js";
import fs from "node:fs";
const c = createPublicClient({
  chain: somniaTestnet,
  transport: http("https://dream-rpc.somnia.network"),
});
const head = await c.getBlockNumber();
const block = await c.getBlock({ blockNumber: head });
console.log({
  chain: await c.getChainId(),
  head: String(head),
  time: new Date(Number(block.timestamp) * 1000).toISOString(),
});
const found = [];
for (let i = 0; i < 40; i += 4) {
  const sets = await Promise.all(
    Array.from({ length: 4 }, (_, j) => {
      const to = head - BigInt((i + j) * 1000);
      return c.getLogs({
        event: marketCreatorEventsAbi[0],
        fromBlock: to - 999n,
        toBlock: to,
      });
    }),
  );
  for (const logs of sets)
    found.push(...logs.map((x) => ({ ...x.args, creator: x.address })));
}
const live = found.filter(
  (m) =>
    Number(m.expiry) > Number(block.timestamp) &&
    m.collateral.toLowerCase() ===
      "0x70a86d8842fb63c4ad2b7cdddf530ebf1bb25d8e".toLowerCase(),
);
console.log(
  JSON.stringify(
    { found: found.length, live },
    (_, v) => (typeof v === "bigint" ? String(v) : v),
    null,
    2,
  ),
);
fs.writeFileSync(
  "/private/tmp/market-royale-live.json",
  JSON.stringify(live, (_, v) => (typeof v === "bigint" ? String(v) : v)),
);
if (live[0])
  console.log(
    "record",
    await c.readContract({
      address: "0x3ecC694Cef705358864a646142ac17A90E29e388",
      abi: binaryModuleReadAbi,
      functionName: "markets",
      args: [live[0].marketId],
    }),
  );
