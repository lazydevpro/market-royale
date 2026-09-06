import { shannonTransport } from "../../../lib/testnet/transport";
// Opt-in development-only signer. Never enabled by a production build.
import { readFile } from "node:fs/promises";
import {
  createWalletClient,
  http,
  decodeFunctionData,
  isHex,
  type Abi,
  type Address,
  type Hex,
  zeroHash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaTestnet } from "viem/chains";
import {
  client,
  head,
  readMarket,
  verifyRegistry,
} from "../../../lib/testnet/server";
import {
  RPC,
  COLLATERAL,
  MODULE,
  OUTCOME_TOKEN,
  moduleAbi,
  outcomeAbi,
  CHAIN_ID,
  tokenAbi,
  PROGRESSION,
} from "../../../lib/testnet/config";
import arena from "../../../lib/testnet/MarketRoyale.json";
import vault from "../../../lib/testnet/TraderVault.json";
import progression from "../../../lib/testnet/MarketRoyaleProgression.json";
export const dynamic = "force-dynamic";
const labels = ["Event host", "Player A", "Player B"];
function enabled(req: Request) {
  const url = new URL(req.url);
  return (
    process.env.NODE_ENV === "development" &&
    process.env.LOCAL_TEST_WALLETS === "1" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    ["127.0.0.1", "localhost", "[::1]"].includes(
      new URL(`http://${req.headers.get("host") ?? "invalid"}`).hostname,
    ) &&
    new URL(`http://${req.headers.get("host") ?? "invalid"}`).port === url.port
  );
}
async function wallets() {
  const raw = JSON.parse(
    await readFile(`${process.cwd()}/.testnet/wallets.json`, "utf8"),
  ) as { privateKey: Hex }[];
  return raw.slice(0, 3).map((w) => privateKeyToAccount(w.privateKey));
}
export async function GET(req: Request) {
  if (!enabled(req)) return Response.json({ enabled: false, wallets: [] });
  const accounts = await wallets();
  return Response.json(
    {
      enabled: true,
      wallets: accounts.map((a, i) => ({
        id: `local-${i}`,
        name: `Local · ${labels[i]}`,
        address: a.address,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
const queue = new Map<number, Promise<unknown>>();
export async function POST(req: Request) {
  if (
    !enabled(req) ||
    req.headers.get("origin") !== `http://${req.headers.get("host")}` ||
    req.headers.get("content-type") !== "application/json"
  )
    return Response.json(
      { error: "Local wallet access denied." },
      { status: 403 },
    );
  try {
    const text = await req.text();
    if (text.length > 20000) throw new Error("Request too large.");
    const body = JSON.parse(text);
    const i = Number(body.wallet);
    if (!Number.isInteger(i) || i < 0 || i > 2)
      throw new Error("Unknown local wallet.");
    const accounts = await wallets(),
      account = accounts[i];
    if (["eth_accounts", "eth_requestAccounts"].includes(body.method))
      return Response.json({ result: [account.address] });
    if (body.method === "eth_chainId")
      return Response.json({ result: "0xc488" });
    if (body.method === "wallet_switchEthereumChain") {
      if (Number(body.params?.[0]?.chainId) !== CHAIN_ID)
        throw new Error("Shannon only.");
      return Response.json({ result: null });
    }
    if (body.method !== "eth_sendTransaction")
      throw new Error("This operation is not enabled for local test wallets.");
    const request = body.params?.[0];
    if (
      !request ||
      String(request.from).toLowerCase() !== account.address.toLowerCase() ||
      !isHex(request.data) ||
      request.data.length > 10000 ||
      BigInt(request.value ?? 0) !== 0n ||
      (request.chainId && Number(request.chainId) !== CHAIN_ID)
    )
      throw new Error("Invalid testnet transaction.");
    await head();
    const registry = process.env.NEXT_PUBLIC_ROYALE_ADDRESS as Address;
    const registryVersion = registry ? await verifyRegistry(registry) : 0;
    if (
      !registry ||
      ![2, 3, 4, 5].includes(registryVersion) ||
      (await client.getChainId()) !== CHAIN_ID
    )
      throw new Error("A supported Shannon arena is required.");
    let abi: Abi;
    let allowed: string[];
    if (String(request.to).toLowerCase() === registry.toLowerCase()) {
      abi = arena.abi as Abi;
      allowed = [
        "schedule",
        "scheduleAndJoin",
        "create",
        "createAndJoin",
        "join",
        "leave",
        "start",
        "startScheduled",
        "nextRound",
        "settleBatch",
        "cancel",
        "claimPrize",
        "payPlayer",
        "payoutBatch",
      ];
    } else if (
      PROGRESSION &&
      String(request.to).toLowerCase() === PROGRESSION.toLowerCase()
    ) {
      abi = progression.abi as Abi;
      allowed = ["recordResult", "claimProtection"];
    } else if (String(request.to).toLowerCase() === COLLATERAL.toLowerCase()) {
      abi = tokenAbi;
      allowed = ["approve", "faucet"];
    } else if (String(request.to).toLowerCase() === MODULE.toLowerCase()) {
      abi = moduleAbi;
      allowed = ["redeem", "pokeOracle"];
    } else if (
      String(request.to).toLowerCase() === OUTCOME_TOKEN.toLowerCase()
    ) {
      abi = outcomeAbi;
      allowed = ["setOperator"];
    } else {
      abi = vault.abi as Abi;
      allowed = ["trade", "withdraw"];
      const [owner, parent, id] = await Promise.all(
        ["owner", "arena", "tournament"].map((functionName) =>
          client.readContract({ address: request.to, abi, functionName }),
        ),
      );
      if (
        String(owner).toLowerCase() !== account.address.toLowerCase() ||
        String(parent).toLowerCase() !== registry.toLowerCase()
      )
        throw new Error("Not your tournament vault.");
      const players = (await client.readContract({
        address: registry,
        abi: arena.abi as Abi,
        functionName: "getPlayers",
        args: [id],
      })) as { wallet: Address; vault: Address }[];
      if (
        !players.some(
          (p) =>
            p.vault.toLowerCase() === String(request.to).toLowerCase() &&
            p.wallet.toLowerCase() === account.address.toLowerCase(),
        )
      )
        throw new Error("Vault is not registered.");
    }
    const decoded = decodeFunctionData({ abi, data: request.data });
    if (!allowed.includes(decoded.functionName))
      throw new Error("Transaction is outside the local test allowlist.");
    const args = Array.from(decoded.args ?? []) as unknown[];
    if (
      PROGRESSION &&
      request.to.toLowerCase() === PROGRESSION.toLowerCase() &&
      decoded.functionName === "recordResult" &&
      String(args[1]).toLowerCase() !== account.address.toLowerCase()
    )
      throw new Error("Local wallets may only record their own result.");
    if (request.to.toLowerCase() === COLLATERAL.toLowerCase()) {
      if (
        decoded.functionName === "approve" &&
        (String(args[0]).toLowerCase() !== registry.toLowerCase() ||
          BigInt(args[1] as bigint) > 300_000_000n)
      )
        throw new Error("Arena approvals are limited to 300 tUSDC.");
      if (
        decoded.functionName === "faucet" &&
        BigInt(args[0] as bigint) > 100_000_000n
      )
        throw new Error("Faucet limit is 100 tUSDC per request.");
    }
    if (
      request.to.toLowerCase() === OUTCOME_TOKEN.toLowerCase() &&
      String(args[0]).toLowerCase() !== MODULE.toLowerCase()
    )
      throw new Error("Only the DreamDEX redemption operator is allowed.");
    if (
      request.to.toLowerCase() === MODULE.toLowerCase() &&
      decoded.functionName === "redeem"
    ) {
      if (BigInt(args[0] as bigint) !== 0n || args[1] !== zeroHash)
        throw new Error("Direct redemption only.");
      const market = await readMarket(args[2] as Hex);
      if (
        !(market.resolved || market.voided) ||
        market.outcomeToken.toLowerCase() !== OUTCOME_TOKEN.toLowerCase()
      )
        throw new Error("Verified settled market required.");
    }
    // Serialize nonce selection for each local signer. Never accept caller-supplied nonces or gas limits.
    const previous = queue.get(i) ?? Promise.resolve();
    const job = previous
      .catch(() => {})
      .then(async () => {
        const params = {
          account,
          address: request.to as Address,
          abi,
          functionName: decoded.functionName,
          args,
        };
        await client.simulateContract(params);
        const estimate = await client.estimateContractGas(params);
        const gas = (estimate * 150n) / 100n + 100000n;
        if (gas > 500_000_000n)
          throw new Error("Test transaction gas limit exceeded.");
        const wallet = createWalletClient({
          account,
          chain: somniaTestnet,
          transport: shannonTransport(),
        });
        const hash = await wallet.writeContract({
          ...params,
          gas,
          gasPrice: await client.getGasPrice(),
        });
        return hash;
      });
    queue.set(i, job);
    const hash = await job;
    return Response.json({ result: hash });
  } catch (e) {
    const message =
      e instanceof Error
        ? "shortMessage" in e
          ? String(e.shortMessage)
          : e.message
        : "Local transaction failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
