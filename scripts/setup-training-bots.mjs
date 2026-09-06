import fs from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  fallback,
  formatEther,
  formatUnits,
  http,
  keccak256,
  maxUint256,
  parseAbi,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaTestnet } from "viem/chains";

const COLLATERAL = "0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E";
const tokenAbi = parseAbi([
  "function balanceOf(address) view returns(uint256)",
  "function allowance(address,address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
  "function faucet(uint256)",
]);
const transport = () =>
  fallback(
    [
      http("https://dream-rpc.somnia.network", {
        timeout: 12_000,
        retryCount: 0,
      }),
      http("https://api.infra.testnet.somnia.network", {
        timeout: 12_000,
        retryCount: 0,
      }),
      http("https://50312.rpc.thirdweb.com", {
        timeout: 12_000,
        retryCount: 0,
      }),
    ],
    { retryCount: 1, retryDelay: 1_000 },
  );

const botsPath = ".testnet/bots.json";
const walletsPath = ".testnet/wallets.json";
const reportPath = "deployments/shannon-training-bots.json";
const env = fs.readFileSync(".env.local", "utf8");
const registry = env.match(/^NEXT_PUBLIC_ROYALE_ADDRESS=(0x[0-9a-fA-F]{40})$/m)?.[1];
if (!registry) throw new Error("NEXT_PUBLIC_ROYALE_ADDRESS is not configured.");
const bots = JSON.parse(fs.readFileSync(botsPath, "utf8"));
const wallets = JSON.parse(fs.readFileSync(walletsPath, "utf8"));
if (bots.length !== 4 || !wallets[0]?.privateKey)
  throw new Error("Expected four bot wallets and the local event host.");

const host = privateKeyToAccount(wallets[0].privateKey);
const publicClient = createPublicClient({
  chain: somniaTestnet,
  transport: transport(),
  pollingInterval: 1_000,
});
const report = fs.existsSync(reportPath)
  ? JSON.parse(fs.readFileSync(reportPath, "utf8"))
  : { chainId: 50312, registry, bots: [], transactions: {} };
report.registry = registry;
const save = () =>
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");

async function send(name, signer, transaction) {
  let item = report.transactions[name];
  if (item?.status === "success") return item.hash;
  if (item?.status === "reverted") {
    delete report.transactions[name];
    item = undefined;
    save();
  }
  let raw = item?.raw;
  let hash = item?.hash;
  if (!raw) {
    const gasPrice = await publicClient.getGasPrice();
    const estimate = await publicClient.estimateGas({
      account: signer,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value,
    });
    const gas = (estimate * 150n) / 100n + 100_000n;
    const nonce = await publicClient.getTransactionCount({
      address: signer.address,
      blockTag: "pending",
    });
    const wallet = createWalletClient({
      account: signer,
      chain: somniaTestnet,
      transport: transport(),
    });
    raw = await wallet.signTransaction({
      account: signer,
      chain: somniaTestnet,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value,
      gas,
      gasPrice,
      nonce,
      type: "legacy",
    });
    hash = keccak256(raw);
    item = report.transactions[name] = {
      hash,
      raw,
      from: signer.address,
      to: transaction.to,
      status: "signed",
    };
    save();
  }
  try {
    await publicClient.sendRawTransaction({ serializedTransaction: raw });
  } catch (error) {
    const message = String(error?.shortMessage ?? error);
    if (!message.includes("already known"))
      console.log(`${name}: RPC broadcast response was ${message}`);
  }
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    timeout: 120_000,
  });
  item.status = receipt.status;
  item.blockNumber = String(receipt.blockNumber);
  item.gasUsed = String(receipt.gasUsed);
  save();
  if (receipt.status !== "success") throw new Error(`${name} reverted.`);
  console.log(`${name}: ${hash}`);
  return hash;
}

if ((await publicClient.getChainId()) !== 50312)
  throw new Error("RPC is not Somnia Shannon.");
const latest = await publicClient.getBlock();
if (Number(latest.timestamp) < Math.floor(Date.now() / 1000) - 90)
  throw new Error("Shannon RPC is returning stale blocks.");
if (
  (await publicClient.getBalance({ address: host.address })) < parseEther("5")
)
  throw new Error(
    "The local event host needs at least 5 STT to seed four bots.",
  );

for (let index = 0; index < bots.length; index++) {
  const bot = privateKeyToAccount(bots[index].privateKey);
  let gasBalance = await publicClient.getBalance({ address: bot.address });
  if (gasBalance < parseEther("1"))
    await send(`bot-${index + 1}-gas-v5`, host, {
      to: bot.address,
      value: parseEther("1") - gasBalance,
    });
  let tokenBalance = await publicClient.readContract({
    address: COLLATERAL,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [bot.address],
  });
  if (tokenBalance < 300_000_000n)
    await send(`bot-${index + 1}-tusdc-300`, bot, {
      to: COLLATERAL,
      data: encodeFunctionData({
        abi: tokenAbi,
        functionName: "faucet",
        args: [300_000_000n],
      }),
    });
  const allowance = await publicClient.readContract({
    address: COLLATERAL,
    abi: tokenAbi,
    functionName: "allowance",
    args: [bot.address, registry],
  });
  if (allowance < 300_000_000n)
    await send(`bot-${index + 1}-approve-${registry.toLowerCase()}`, bot, {
      to: COLLATERAL,
      data: encodeFunctionData({
        abi: tokenAbi,
        functionName: "approve",
        args: [registry, maxUint256],
      }),
    });
  gasBalance = await publicClient.getBalance({ address: bot.address });
  tokenBalance = await publicClient.readContract({
    address: COLLATERAL,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [bot.address],
  });
  report.bots[index] = {
    name: bots[index].name,
    address: bot.address,
    stt: formatEther(gasBalance),
    tUSDC: formatUnits(tokenBalance, 6),
    approvedArena: registry,
  };
  save();
}

console.log(report.bots);
