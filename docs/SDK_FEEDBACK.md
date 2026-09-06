# DreamDEX Event Contracts SDK and documentation feedback

Market Royale integrates `@somnia-chain/markets-sdk` 0.28.1 for market
discovery and reads, then uses the live contracts through Viem for tournament
vault execution and settlement. The following changes would reduce integration
risk for consumer applications.

## What worked well

- The SDK exposes enough market metadata to discover rolling BTC and ETH
  Event Contracts and show their live books in a custom interface.
- The Shannon chain export makes client construction straightforward.
- Event Contract identifiers and pool metadata are usable from both the web
  application and the automated operator.

## Suggested improvements

### Publish canonical tick and lot helpers

Order price and quantity are fixed-point integers, and each pool may enforce a
different tick, lot, and minimum quantity. Exported helpers such as
`priceToTicks`, `quantityToLots`, and `normalizeIocOrder` would prevent
frontends and agents from duplicating rounding logic.

### Document partial-fill accounting end to end

A consumer order ticket needs to distinguish requested quantity, filled
quantity, average execution price, unfilled remainder, proceeds, and realized
P&L. One complete immediate-or-cancel buy and sell example, including emitted
events, would make correct wallet and vault accounting easier to verify.

### Provide one lifecycle recipe

A single guide should connect discovery, on-chain status checks, book loading,
order submission, finalization, void handling, payout-vector reads, redemption,
and recycled pools. This is especially valuable for applications that must
recover after missing an indexer or RPC update.

### Clarify scheduled market availability

Consumer applications need to know whether a requested asset and interval has
a future market before they accept deposits or display a start time. A
documented “next compatible market” query with explicit absence reasons would
help schedulers survive gaps without guessing.

### Add testnet operations guidance

Document faucet limits, typical RPC failure behavior, and recommended retry and
idempotency patterns. Transaction journals are essential for automated agents
because an uncertain broadcast must not become a duplicate order or payout.
