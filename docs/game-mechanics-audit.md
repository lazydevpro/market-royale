# Market Royale game mechanics audit

Audited 2026-09-06 against the V5 arena source, V4 progression sidecar, local keeper, UI calculations, and local-EVM lifecycle tests.

## Verdict

The current system is mechanically consistent for a playable Shannon testnet beta. Vault accounting, settlement, cuts, prizes, refunds, and automatic recovery conserve the assets they control. The UI now separates trading P&L, projected settlement value, prize value, total return, and net result after entry.

It is not ready for real-value mainnet play without an external security review and a decision on counterparty collusion. A player can potentially fund favorable public DreamDEX orders from another wallet and trade their tournament vault against them. The arena sees a valid public fill but cannot identify the economic owner behind aggregated liquidity.

## Authoritative money flow

For each entrant:

- Initial outlay = selected entry contribution + selected starting bankroll + gas.
- The entry contribution moves to the arena prize pool.
- The bankroll moves to a dedicated `TraderVault` controlled by the arena rules.
- A buy reduces tracked vault cash by the collateral actually pulled and adds the outcome shares actually received.
- A sell removes the shares actually filled and increases tracked cash by the collateral actually received.
- At settlement, winning shares redeem into vault cash and losing shares redeem for zero.
- Final trading P&L = settled vault cash - starting bankroll.
- Net player result = settled vault cash + prize - starting bankroll - entry contribution. Gas is outside this calculation.

The arena takes no entry-pool cut. Two-player events pay the full pool to first. Events with at least three original entrants allocate 62.5% to first, 23.4375% to second, and 14.0625% to third, with integer rounding remainder assigned to first. Market Royale currently passes a zero DreamDEX builder fee.

## Ranking and elimination

- Rank is based on settled vault cash, never the number of buys, trade count, wallet balance, or unredeemed mark-to-market value.
- Every entrant starts with the same host-selected bankroll, so outside wallet wealth cannot be deposited into the vault after entry.
- After a non-final round, the top half advances and survivor count rounds upward.
- At two remaining players or the selected final round, all remaining players receive final ranks.
- Exact settled-cash ties favor earlier on-chain entry. Because the host joins first in `createAndJoin` and `scheduleAndJoin`, the host wins a completely tied field.
- Holding cash is a valid strategy. A round cancels for no trading only when the entire field records zero fills; an individual player is not required to trade to remain eligible for prizes.
- A voided market has no winner or progression rank. Entry contributions are refunded after both outcome balances settle according to the real payout vector.

## Profit and loss presentation

- Realized close P&L uses confirmed sell proceeds minus weighted-average cost removed for the shares actually filled.
- The pre-signing IOC estimate walks visible book levels that cross the selected limit. It shows estimated fill size, average price, collateral debit or credit, unfilled cancellation, and close P&L.
- A sell can realize a gain while reducing the conditional live rank. Selling a currently winning outcome below its possible 1 tUSDC settlement value locks profit but gives up remaining upside. This is expected.
- Live rank is a scenario preview using the current oracle direction as if it settled immediately. It is hidden while the oracle direction is unavailable and is never the final on-chain rank.

## Failure and recovery behavior

- Below-minimum turnout, missed start, field-wide zero fills, voids, oracle timeout, and next-round timeout all lead to defined cancellation paths.
- Cancellation returns the entry contribution and unlocks the vault. Earlier trading losses and gas are not reversed.
- On an oracle timeout, tracked cash and unsettled DreamDEX outcome tokens return to the entrant, preserving later redemption rights.
- Settlement is batched four players at a time; payout is batched up to eight. Anyone may trigger these operations, but transfers are pinned to original entrant addresses.
- The keeper journals signed transactions before broadcast, retries uncertain submissions, checks two-sided liquidity, backfills test matches with labeled funded bots, and retains manual contract recovery paths.

## Progression and sponsor protection

- Rating changes from -30 to +30 by final placement percentile and is capped from 500 to 2,500.
- XP rewards completion, survived cuts, podiums, wins, and finishing above the starting bankroll.
- Every completed ranked finish is recorded permissionlessly and idempotently by the keeper, including a valid cash-only strategy. Sponsor loss protection separately requires at least one lifetime filled vault trade.
- Badges are one-per-wallet soulbound achievements.
- Verified players may claim 1 tUSDC on up to three eligible no-prize finishes from a separate reserve. This is three eligible claims, not necessarily the chronologically first three completed games.

## Remaining launch decisions

1. **Counterparty collusion:** choose an allowlisted maker set, a trusted competition market, or an oracle-derived score before real-value deployment.
2. **Passive cash strategy:** decide whether holding cash is valid portfolio management or whether every active player must record a minimum fill each round.
3. **Tie policy:** earlier entry is deterministic but advantages the auto-joined host. Consider tied-prize splitting or a verifiable neutral tie-break for real-value events.
4. **DreamDEX economics:** current value to DreamDEX is order flow. Add an explicit builder or revenue share only after defining who receives it and how it affects the advertised prize pool.
5. **Season rollover:** progression V4 retains the V3 delayed-rollover fix, assigning the next season from the second after the prior season ended so results completed during keeper downtime remain recordable.

## Verification evidence

- `npm run typecheck`: passed.
- `npm run build`: passed on Next.js 16.3.4.
- `npm test`: passed the current Solidity lifecycle suite.
- The suite compiles current Solidity and covers isolated accounting, unauthorized access, unlimited filled trades, donation-resistant scores, multi-round cuts, deterministic ties, no-winner voids, prize conservation, variable terms, no-turnout and no-trade refunds, oracle recovery, permissionless payout destinations, sponsor protection, liquidity sponsorship, and a 64-player settlement/payout cycle.
