"use client";
import { shannonTransport } from "./transport";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  BaseError,
  type EIP1193Provider,
  type Address,
  type Abi,
  type Hex,
} from "viem";
import { somniaTestnet } from "viem/chains";
import { RPC, CHAIN_ID, EXPLORER } from "./config";
export type Provider = EIP1193Provider & {
  on?: (event: string, handler: (value: unknown) => void) => void;
  removeListener?: (event: string, handler: (value: unknown) => void) => void;
};
export type WalletOption = { id: string; name: string; provider: Provider };
export const publicClient = createPublicClient({
  chain: somniaTestnet,
  transport: shannonTransport(),
  pollingInterval: 1500,
});
export function explain(error: unknown) {
  if (
    error instanceof BaseError &&
    /HTTP request failed|fetch failed|timed out/i.test(error.shortMessage)
  )
    return "Shannon RPC is unavailable. Wait for the network to recover before retrying. Check the transaction history first if a transaction was already submitted.";
  if (error instanceof BaseError)
    return error.shortMessage + (error.details ? ` ${error.details}` : "");
  return error instanceof Error
    ? error.message
    : "Transaction failed. Please retry.";
}
export async function connect(provider: Provider) {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xc488" }],
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: "0xc488",
          chainName: "Somnia Shannon Testnet",
          nativeCurrency: {
            name: "Somnia Test Token",
            symbol: "STT",
            decimals: 18,
          },
          rpcUrls: [
            RPC,
            "https://api.infra.testnet.somnia.network",
            "https://50312.rpc.thirdweb.com",
          ],
          blockExplorerUrls: [EXPLORER],
        },
      ],
    });
  }
  if (Number(await provider.request({ method: "eth_chainId" })) !== CHAIN_ID)
    throw new Error("Switch your wallet to Somnia Shannon (50312).");
  const addresses = await provider.request({ method: "eth_requestAccounts" });
  if (!addresses[0]) throw new Error("No wallet account selected.");
  return addresses[0];
}
export async function signer(provider: Provider, account: Address) {
  const [chain, addresses] = await Promise.all([
    provider.request({ method: "eth_chainId" }),
    provider.request({ method: "eth_accounts" }),
  ]);
  if (Number(chain) !== CHAIN_ID)
    throw new Error("Switch to Somnia Shannon before signing.");
  if (addresses[0]?.toLowerCase() !== account.toLowerCase())
    throw new Error(
      "Your wallet account changed. Reconnect before continuing.",
    );
  if ((await publicClient.getChainId()) !== CHAIN_ID)
    throw new Error("RPC network mismatch.");
  const block = await publicClient.getBlock();
  if (Math.abs(Date.now() / 1000 - Number(block.timestamp)) > 90)
    throw new Error(
      "Shannon is returning stale blocks. Signing is paused until the network catches up.",
    );
  return createWalletClient({
    account,
    chain: somniaTestnet,
    transport: custom(provider, { retryCount: 0 }),
  });
}
export async function write(
  provider: Provider,
  account: Address,
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
): Promise<Hex> {
  const wallet = await signer(provider, account);
  await publicClient.simulateContract({
    address,
    abi,
    functionName,
    args,
    account,
  });
  const gas = await publicClient.estimateContractGas({
    address,
    abi,
    functionName,
    args,
    account,
  });
  // Shannon storage allocation can cost more than an optimistic estimate.
  return wallet.writeContract({
    address,
    abi,
    functionName,
    args,
    account,
    gas: (gas * 150n) / 100n + 100_000n,
    gasPrice: await publicClient.getGasPrice(),
  });
}
