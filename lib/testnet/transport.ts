import { fallback, http } from "viem";
import { RPC } from "./config";
// Shannon-only providers: Thirdweb plus both official SDK endpoints. Every write also checks chain ID.
export const shannonTransport = () =>
  fallback(
    [
      http(RPC, { timeout: 12000, retryCount: 0 }),
      http("https://api.infra.testnet.somnia.network", {
        timeout: 12000,
        retryCount: 0,
      }),
      http("https://50312.rpc.thirdweb.com", { timeout: 12000, retryCount: 0 }),
    ],
    { retryCount: 1, retryDelay: 1000 },
  );
