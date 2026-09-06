# Market Royale operations and verification

This document contains the detailed local operator, training bot, funding,
failure-recovery, and public-network verification notes. Start with the
[project README](../README.md) for the product and judging overview.

Real wallet entries, isolated trading vaults, DreamDEX order-book fills, oracle settlement, elimination and prizes. The active app uses public Shannon contracts. It does not fabricate players, balances, liquidity or results.

## Run everything locally

```sh
npm ci
npm run local
```

Open [the local arena](http://127.0.0.1:3000/?registry=0x4a17dc5e798e68060e6e8cadbf795531557880cd#arena). This starts Next.js on 3000 and the Cloudflare Durable Object event operator on 8787. A local watchdog re-arms alarms after development reloads. The supervisor restarts failed processes without shutting down their companion. Stop both with Ctrl+C. Do not run another keeper with the same signing key against a separate local storage directory.

Existing local configuration:

- `.env.local`: `NEXT_PUBLIC_ROYALE_ADDRESS` selects the V5 arena, `NEXT_PUBLIC_PROGRESSION_ADDRESS` selects its progression sidecar, and `LOCAL_TEST_WALLETS=1` enables the development wallet selector.
- `.testnet/wallets.json`: dedicated local test keys, mode 0600, ignored by git. Wallets 0–2 are host, Player A and Player B; wallet 3 is the keeper treasury.
- `.testnet/gas-faucet.json`: the separate sponsored-gas treasury, mode 0600 and ignored by git. Its public Shannon address is `0x751586985D47f49D0745991758ac2426E2f2d0a7`.
- `.testnet/bots.json`: four dedicated training bot signers, mode 0600 and ignored by git. They never enter the browser bundle.
- `workers/.dev.vars`: the keeper and gas-faucet signer secrets, also ignored. The operator cannot trade from player vaults or redirect their payouts.

Only the opt-in development server reads local player keys. The browser receives public addresses and transaction hashes; keys never enter the frontend bundle. The signing endpoint requires loopback hosts, same-origin POSTs, Shannon chain ID, zero native value, and an allowlist of current arena, own vault and limited faucet/approval actions. Production builds disable that endpoint regardless of `LOCAL_TEST_WALLETS`.

A browser extension wallet works through EIP-6963/injected provider discovery. Local wallets are for this private development environment. The Wallet screen requests a sponsored 1 STT gas grant and then mints tUSDC without sending the player to another site.

## Deployed contracts

All addresses are on **Somnia Shannon, chain 50312**.

| Contract                           | Address                                      |
| ---------------------------------- | -------------------------------------------- |
| V5 arena                           | `0x4a17dc5e798e68060e6e8cadbf795531557880cd` |
| Player progression and badges (V4) | `0xaecf844569aba92494947bc4edf8e268c31b5c54` |
| Treasury liquidity sponsor         | `0x24a43ad7e9318cf515867477bf9c489989dcc701` |
| tUSDC (6 decimals)                 | `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E` |
| DreamDEX binary module             | `0x3ecC694Cef705358864a646142ac17A90E29e388` |
| Trusted rolling creator            | `0x94D963B6670AB96E78C8d0C46ca35D196d606EFE` |

Arena deployment receipts are in `deployments/shannon-v5.json`; the active progression upgrade is recorded separately in `deployments/shannon-progression-v4.json`. Runtime verification compares complete compiled bytecode, normalizing only declared immutable slots, and checks collateral, module, creator, venue and vault factory bindings. Earlier arenas remain readable, with new events directed to V5.

Reads prioritize Somnia's documented Shannon endpoints and use Thirdweb as the last fallback. Both wallet and operator reject wrong-chain or stale-block responses. There is no mainnet fallback.

## Play and host

1. Select a local player wallet or connect an extension wallet. The event card shows the host-selected prize contribution and isolated starting vault, plus the STT needed for gas.
2. As the event host, choose an entry contribution from 1–50 tUSDC and an equal starting vault from 5–250 tUSDC, along with minimum players, capacity, maximum rounds and market duration. The entry cannot exceed the vault. Scheduled starts align to fresh market windows; the confirmed lobby displays the exact time.
3. Share the match URL. Deposits open ten minutes before the start. Players can leave before entry closes and receive both the entry and full vault deposit back. Gas is not refunded.
4. Official-host events are operated automatically. When local training-bot mode is enabled, the keeper also operates every test match it discovers. It finds an eligible market, checks two-sided depth and starts after entry closes. Manual start, settlement and recovery controls remain available.
5. Trade UP/DOWN shares against real public orders as often as useful until the market closes. Immediate-or-cancel orders can partially fill, and the order ticket walks visible depth to estimate the filled quantity, average price, proceeds and close P&L before signing. Confirmed sells report exact realized P&L from the vault event. Holding cash is a valid strategy; only a round with zero fills across the entire field cancels. Empty orders revert without incrementing the filled-trade counter. Unsolicited token donations do not improve scores.
6. At expiry, real oracle payouts determine vault cash. Settlement processes four entrant records per transaction. The bottom half is eliminated, rounding survivors upward. Exact cash ties favor earlier entry. No-trade rounds cancel instead of awarding an unearned winner.
7. Survivors move to a fresh market from the same creator, venue and duration. At two remaining players or the final round, the event finishes. A duel pays the full entry pot to first; with 3+ entrants the top three receive 80/128, 30/128 and 18/128, with rounding remainder to first.
8. The keeper pays eliminated players and finished/cancelled events in batches of up to eight. Anyone may trigger eligible recovery; funds always go to the original player. The UI retains manual recovery controls.

The arena takes no cut from entry contributions: the complete funded entry pool is assigned to prizes or returned on cancellation. DreamDEX receives the real order flow; Market Royale currently passes a zero builder fee, so there is no separate entry-pool revenue share configured for DreamDEX.

## Training bot backfill

Four clearly labeled Shannon wallets keep local test matches playable. During the final five minutes of entry, the operator backfills toward four total entrants, including the host and any human players. A duel therefore receives only the one bot it needs. Each active bot stages up to six real immediate-or-cancel DreamDEX buys and sells per round, alternating exposure and closing positions against the live book. The keeper journals each signed join and trade before broadcast, so uncertain RPC responses reuse the same transaction. The local automatic-action ceiling is 10 STT per UTC day across keeper and bot transactions.

The keeper replenishes a bot through the 24-hour STT faucet when a required transaction cannot be afforded and tops its wallet back above the 300 tUSDC maximum seat threshold through the test-token faucet. Run `npm run setup:bots` to verify or restore initial funding. Public addresses and funding receipts are recorded in `deployments/shannon-training-bots.json`; private keys remain in `.testnet/bots.json` and `BOT_PRIVATE_KEYS`. This is transparent test backfill rather than simulated player activity. A format requiring more than the host plus four bots still needs additional human entrants.

## Player progression

The keeper records every ranked finish permissionlessly after the arena proves the wallet's final rank. This updates rating, XP, career statistics, and eligible soulbound badges without requiring a player transaction. A filled trade remains mandatory for sponsor-funded loss protection.

- Rating starts at 1,000 and moves by placement percentile, capped between 500 and 2,500. Bronze, Silver, Gold, Diamond and Champion begin at 1,000, 1,100, 1,250, 1,450 and 1,700.
- Season XP rewards completion, survived cuts, podiums, wins and profitable vault finishes. Season level three mints an Invitational Pass without creating a farmable token.
- Eight ERC-1155-compatible badges cover debut, top-half finish, three survived cuts, podium, champion, ten events, profitable finish and the season pass. They are soulbound: approvals and transfers always revert.
- A separate 192 tUSDC launch reserve funds up to 1 tUSDC for each of a verified player's first three claimed eligible losses. A completed ranked event, a filled trade, no prize and an unused match claim are all required. Winner payouts never fund rebates.
- Tournament timestamps bind XP to the season in which the result occurred, preventing delayed claims from moving old results into a new season.

## Turnout and failure safeguards

| Scenario                                 | Behavior                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Zero players                             | Cancel after entry closes; there are no player deposits.                                                                                         |
| Below the declared minimum               | Training bots first backfill toward four total players. If the minimum is still unmet, cancel and recover every entrant's funds.                 |
| Fewer than capacity, but minimum reached | Start with the actual funded roster. No filler players.                                                                                          |
| Player leaves before close               | Return that event's entry and full starting vault, then reopen the slot. Rejoining gets a new entry position.                                    |
| Full or duplicate entry                  | Contract rejects the transaction.                                                                                                                |
| Missing/thin liquidity                   | Start is blocked. Official treasury may add real public maker orders from its own funds.                                                         |
| Missed start                             | Cancel after the two-minute grace period.                                                                                                        |
| Nobody trades                            | Cancel at market expiry without waiting for an oracle; return deposits.                                                                          |
| Voided market                            | Settle by the real payout vector and refund entry contributions.                                                                                 |
| Oracle or next round stalls              | Cancellation unlocks after 15 minutes. Return entries, remaining cash and any unsettled outcome tokens. Trading losses and gas are not refunded. |
| RPC fails or returns stale blocks        | Disable signing; retry reads. Existing positions remain on-chain.                                                                                |
| Keeper restarts after broadcasting       | Durable signed-transaction journal reuses the exact transaction hash and nonce.                                                                  |
| Keeper gas budget exhausted              | Pause automatic actions; manual contract controls remain available.                                                                              |
| Repeat sponsored-gas claim               | Reject until 24 hours after that wallet's previous successful submission.                                                                        |
| Faucet abuse or empty treasury           | Stop after 50 grants per UTC day or when the dedicated treasury cannot cover 1 STT plus fees. No player or prize funds are used.                 |

The local test keeper manages discovered events while bot backfill is enabled. Its daily gas cap is 10 STT across keeper and bot transactions. Treasury depth scales with the event's starting vault and funded player count; test-token faucet calls fund it separately. Public users can consume those orders, so liquidity is checked again at start and fills remain subject to the live book. Expired inventory is finalized and redeemed to the keeper treasury. Player entries never fund maker inventory.

Minimum-wallet counts do not prove distinct humans. The gas faucet's per-wallet cooldown and daily treasury cap limit loss but do not provide identity verification or full Sybil resistance. There is no free RSVP database: the event page is visible before funded entry opens.

## Verification

```sh
npm run typecheck
npm run test:contracts
npm run build:cloudflare
```

Contract tests use a local EVM and protocol mocks. They cover entry/exit, duplicate/full rosters, quorum, empty books, IOC accounting, unauthorized trading, donation-resistant scoring, cuts, voids, timeouts, no-trade refunds, permissionless payout destinations, duplicate recovery, treasury maker lifecycle, and a full **64-player** settlement/payout cycle. Local EVM gas figures do not predict Shannon storage-allocation gas.

Public-network journals are separate:

- `deployments/shannon-e2e.json`: completed historical V1 two-wallet match, actual fills, oracle result and all payouts.
- `deployments/shannon-v5.json`: current arena and its original progression deployment receipts.
- `deployments/shannon-progression-v3.json`: rollover-safe V3 progression deployment, reserve funding, and test-player verification receipts.
- `deployments/shannon-progression-v4.json`: active automatic-recording progression deployment and protected-loss reserve receipts.
- `deployments/v3-playable-e2e-cancelled.json`: a real V3 missed-start cancellation and automatic refund exercise.
- `deployments/v3-playable-e2e.json`: the current V3 two-wallet trade, settlement and payout journal.
- `deployments/v3-progression-e2e.json`: rank mints and the losing wallet's real 1 tUSDC protection claim.
- `deployments/v2-edge-cases.json`: confirmed zero-player, one-player and missed-start recovery on public Shannon. The intended no-trade event could not start because no compatible five-minute market was live; no-trade behavior is covered locally.
- `deployments/v2-playable-e2e.json`: completed V2 match #6 with two real trades, oracle settlement, prize payment and both vault withdrawals.

```sh
node scripts/v3-playable-e2e.mjs
node scripts/v3-progression-e2e.mjs
```

The runner checks fresh Shannon blocks, schedules an event, funds and enters the two local players, submits real trades, and waits for the **keeper** to start, settle and pay. Its signed pending transaction is persisted locally before broadcasting. It waits up to five minutes for network recovery and records a pause if unavailable; rerun to resume. Never run this simultaneously with browser transactions from the same local wallets.

The archived `scripts/testnet-e2e.mjs` and `tests/game.reference.mjs` concern V1 and the original reference simulation respectively; they do not prove current V5 behavior or run in the current test gate.

## Cloudflare

Cloudflare hosts both the Next.js app through OpenNext and the event operator through Workers/Durable Objects. No separate database, VM or container is required. Current work is local; public deployment has not been performed.

```sh
npm run build:cloudflare
npm run preview:cloudflare
```

Production preview is on port 3001 and connects to the local keeper service binding. Local player signing is disabled there.

For a later authorized public testnet deployment, set `KEEPER_PRIVATE_KEY`, `GAS_FAUCET_PRIVATE_KEY` and `BOT_PRIVATE_KEYS` as secrets on `workers/wrangler.jsonc`. Generate one random `FAUCET_API_TOKEN` and set the same secret on both the keeper worker and the root web worker. Verify the public addresses and budgets in the worker config, deploy the keeper, then deploy the built root `wrangler.jsonc`. Keep `EVENT_OPERATIONS` bound to `market-royale-keeper`. Cron wakes the durable operator every minute; alarms normally run every 15 seconds. Never upload `.testnet`, `.env.local`, or `.dev.vars` as assets.

`127.0.0.1` invitations only work on this computer. Use the eventual public Cloudflare URL before inviting outside players. This is a testnet product under verification, not an audited mainnet release.
