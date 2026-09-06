# V2 verification — 5 September 2026

## Passed locally

- Solidity lifecycle tests, including a full 64-player event, settlement batches, prize conservation, refunds and every payout.
- Low/zero turnout, host-declared minimum, full/duplicate entry, pre-start leave/rejoin, fixed roster after deadline, missing liquidity, missed start, no-trade cancellation without an oracle, voids and 15-minute timeout recovery.
- Donation-resistant accounting, unauthorized trading, empty IOC fills, three-action limits, multi-round elimination, permissionless recovery pinned to the entrant, and duplicate payout protection.
- Treasury maker lifecycle: seed authorization and cap, rollback when maker orders do not rest, approval reset, expired inventory recovery and no double recovery.
- TypeScript tests and the Next.js/OpenNext Cloudflare production build.
- Production disables local-wallet signing. Development signing is loopback-only, same-origin, Shannon-only, zero-native-value and restricted to approved contract calls.

The maximum-capacity local EVM test observed approximately 2,103,845 gas for start and 1,275,881 for the largest settlement batch. These figures do not predict Shannon storage-allocation gas.

## Passed on public Shannon

- V2 arena `0x7c0dd0d2aea196118dbca546bdc2c6ecf541dd1e` and liquidity sponsor `0x24a43ad7e9318cf515867477bf9c489989dcc701` are deployed on chain 50312.
- Events #1–#5 exercised automatic cancellation and recovery after low turnout, missed starts, and the RPC incident. Every funded entrant was paid; the keeper now manages none of those events and has no pending transaction.
- Match #6 completed with two local wallets on the real BTC DreamDEX market `0x0000000000000000000000000000000000000000000000000000000000013fc6`.
- Both 12 tUSDC entries, both isolated vault deployments and both real order-book trades confirmed.
- Keeper start: `0x74a86593b2ddc0a3e06964203e72ef345f40e6f20f0e6e70d31ec9e08d94afec`.
- Player trades: `0x9e32bbf78e32b6c46460dddcad9db8d38e4b999e566766020f0e247e570893eb` and `0xaae020b76834ae5690138ed31cdb89420a577c4293f5a006fc4491376ad9ef5f`.
- Oracle settlement: `0xb816bfb08ca3ea6bd112923955267f07a4d889fcb232ea860c88259e7f9b127b`.
- Automatic payout and vault withdrawal: `0xd50a8e31495fe5a01d36a8f44131b99729868dd6f2effe464eebff243622b44d`.
- The winner received the complete 4 tUSDC entry prize pool. Both `prizeClaimed` flags and both vault `withdrawn` flags were verified before the runner recorded `status: "complete"`.

The complete receipt journal and final player state are in `v2-playable-e2e.json`. Recovery evidence is in `v2-edge-cases.json`; event #4 intended to test no-trade settlement but could not start because DreamDEX was not publishing a compatible five-minute market. It therefore verified missed-start recovery. No-trade settlement passed locally.

## Reliability findings and fixes

On 4 September, both official Shannon RPC endpoints returned HTTP 502 while Thirdweb returned stale blocks and `node not ready`. Details are in `SHANNON-RPC-DIAGNOSTIC.md`. On 5 September the official endpoints returned current blocks and the run completed.

Somnia's official RPCs now have priority; Thirdweb is the last fallback. The resumable runner recovers misleading broadcast errors by checking the deterministic signed transaction hash. The event form disables durations that DreamDEX is not currently publishing, preventing users from funding a lobby that cannot obtain a compatible market.

## Remaining launch boundary

The product is verified end to end on public Shannon. The contracts have not received an independent security audit. Public Cloudflare deployment and mainnet deployment have not been performed.
