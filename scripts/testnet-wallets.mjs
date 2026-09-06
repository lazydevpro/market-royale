import fs from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
const file = new URL("../.testnet/wallets.json", import.meta.url);
if (!fs.existsSync(file)) {
  const wallets = Array.from({ length: 3 }, () => {
    const privateKey = generatePrivateKey();
    return { address: privateKeyToAccount(privateKey).address, privateKey };
  });
  fs.writeFileSync(file, JSON.stringify(wallets, null, 2) + "\n", {
    mode: 0o600,
  });
}
const wallets = JSON.parse(fs.readFileSync(file, "utf8"));
console.log(
  "Shannon-only test wallets. Private keys stay in the ignored .testnet directory.",
);
console.log(
  "Fund this deployer/liquidity wallet with STT and tUSDC:",
  wallets[0].address,
);
console.log("Player A:", wallets[1].address);
console.log("Player B:", wallets[2].address);
