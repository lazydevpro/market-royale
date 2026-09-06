# Security policy

Market Royale is an unaudited Somnia Shannon testnet project. Do not use its
contracts, workers, or local signing tools with real-value assets or mainnet
keys.

## Reporting a vulnerability

Open a private GitHub security advisory after the repository is published. Do
not include private keys, seed phrases, access tokens, or exploitable details
in a public issue. Until the repository has a public security-advisory URL,
contact the maintainer through the DoraHacks project page.

Include the affected contract or component, reproduction steps, expected and
actual behavior, impact, and any transaction hashes that contain no secrets.

## Security boundaries

- Player funds are held in per-player TraderVault contracts. Arena actions are
  limited to the vault owner, and withdrawals always return to that owner.
- The keeper advances public state and recovery transactions. It cannot choose
  a different payout recipient or place arbitrary trades from player vaults.
- Local player signing is disabled in production. In development it accepts
  loopback, same-origin requests only and allowlists the Shannon chain,
  contracts, methods, and zero native value.
- Keeper, faucet, and bot signers must be separate testnet keys stored as
  Cloudflare secrets or ignored local files.
- The sponsored gas faucet has per-wallet cooldowns, a daily grant ceiling,
  and a dedicated treasury. It never uses player deposits or prize funds.

## Before a mainnet deployment

Commission independent Solidity and infrastructure audits, remove training
bots and test faucets, add production identity and Sybil controls, rehearse
oracle and RPC failure recovery, publish an incident plan, and deploy fresh
contracts from a hardware-backed multisig process.
