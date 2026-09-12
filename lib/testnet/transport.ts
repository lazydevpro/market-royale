import { fallback, http } from "viem";
import { RPC } from "./config";
// Shannon-only providers: Thirdweb plus both official SDK endpoints. Every write also checks chain ID.
let batchScope = 0;
const rpc = (url: string, batched: boolean, scope: number) =>
  http(batched ? `${url}${url.includes("?") ? "&" : "?"}mr=${scope}` : url, {
    batch: batched ? { batchSize: 100, wait: 5 } : undefined,
    timeout: 12000,
    retryCount: 0,
  });
export const shannonTransport = (batched = true) => {
  const scope = batched ? ++batchScope : 0;
  return fallback(
    [
      rpc(RPC, batched, scope),
      rpc("https://api.infra.testnet.somnia.network", batched, scope),
      rpc("https://50312.rpc.thirdweb.com", batched, scope),
    ],
    { retryCount: 1, retryDelay: 1000 },
  );
};
