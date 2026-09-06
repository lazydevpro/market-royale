import fs from "node:fs";
import solc from "solc";
export function compile(extraSources = {}) {
  const sources = {
    "MarketRoyale.sol": {
      content: fs.readFileSync(
        new URL("../contracts/MarketRoyale.sol", import.meta.url),
        "utf8",
      ),
    },
    "LiquiditySponsor.sol": {content: fs.readFileSync(new URL("../contracts/LiquiditySponsor.sol", import.meta.url), "utf8")},
    "MarketRoyaleProgression.sol": {content: fs.readFileSync(new URL("../contracts/MarketRoyaleProgression.sol", import.meta.url), "utf8")},
    ...extraSources,
  };
  const input = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: "shanghai",
      outputSelection: {
        "*": {
          "*": [
            "abi",
            "evm.bytecode.object",
            "evm.deployedBytecode.object",
            "evm.deployedBytecode.immutableReferences",
          ],
        },
      },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter((e) => e.severity === "error");
  if (errors.length)
    throw new Error(errors.map((e) => e.formattedMessage).join("\n"));
  return output.contracts;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const result=compile();
  const contracts = {...result["MarketRoyale.sol"],...result["LiquiditySponsor.sol"],...result["MarketRoyaleProgression.sol"]};
  for (const name of ["MarketRoyale", "TraderVault", "VaultFactory", "LiquiditySponsor", "MarketRoyaleProgression"]) {
    const c = contracts[name],
      bytes = c.evm.deployedBytecode.object.length / 2;
    if (bytes > 24576) throw new Error(`${name} exceeds EIP-170 (${bytes})`);
    fs.writeFileSync(
      new URL(`../lib/testnet/${name}.json`, import.meta.url),
      JSON.stringify(
        {
          abi: c.abi,
          bytecode: `0x${c.evm.bytecode.object}`,
          deployedBytecode: `0x${c.evm.deployedBytecode.object}`,
          immutableReferences: c.evm.deployedBytecode.immutableReferences,
          compiler: solc.version(),
        },
        null,
        2,
      ) + "\n",
    );
    console.log(`${name}: ${bytes} deployed bytes`);
  }
}
