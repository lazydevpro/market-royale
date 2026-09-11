# DoraHacks submission copy

Prepared for the **Somnia × DreamDEX Event Contracts Hackathon**.

## Required links

Use these links in the DoraHacks submission:

- **Working prototype:** [market-royale-web.lazydevpro.workers.dev](https://market-royale-web.lazydevpro.workers.dev)
- **Source code:** [github.com/lazydevpro/market-royale](https://github.com/lazydevpro/market-royale)
- **2–3 minute demo video:** `ADD_YOUTUBE_OR_LOOM_URL`

## Project name

Market Royale

## Tagline

Trade real DreamDEX markets with an equal starting vault, survive each cut,
and win the on-chain prize pool.

## Description

Prediction markets are usually solitary: a trader takes a position, waits for
settlement, and leaves. Market Royale turns DreamDEX Event Contracts into a
multiplayer survival game that gives users a reason to return, compete, and
trade throughout each market window.

Every entrant deposits the same host-selected entry contribution and receives
the same isolated starting bankroll. Players buy and sell real UP/DOWN shares
on live BTC or ETH DreamDEX order books. When the oracle settles a round, each
vault redeems its outcome shares, the arena ranks players by final bankroll,
and the bottom half is eliminated. Survivors advance to a fresh Event Contract
until one winner remains or the host's round limit is reached. Exact ties favor
earlier entry, and the entire funded entry pool is paid as prizes or returned
through contract-defined cancellation paths.

Market Royale is deployed and playable on Somnia Shannon testnet. The product
includes a no-scroll trading cockpit, live chart and trade markers, compact
royale leaderboard, fill and P&L previews, permissionless recovery controls,
rating, season XP, and eight soulbound achievement badges. Hosts can configure
BTC or ETH, entry size, starting bankroll, capacity, enrollment time, and round
count.

Under the hood, every player gets a dedicated TraderVault that can trade only
for its owner through the arena and can return funds only to that owner. A
Cloudflare Durable Object keeper checks liquidity, advances event state,
settles and pays players in bounded batches, and records progression. Four
clearly labeled testnet bots enter underfilled local test events and execute
real buys and sells so the full loop remains testable. A dedicated sponsor
treasury supplies public maker liquidity without using player deposits.

Market Royale gives DreamDEX a consumer format designed to attract new users,
generate repeated Event Contract order flow, and grow from quick duels into
scheduled community tournaments.

## Core technology

- Somnia Shannon testnet, chain 50312
- DreamDEX Event Contracts and `@somnia-chain/markets-sdk`
- Solidity tournament, vault, progression, and liquidity contracts
- Next.js 16, React 19, TypeScript, Viem
- Cloudflare Workers, Durable Objects, cron, and OpenNext

## Deployed contracts

- Market Royale V5: `0x4a17dc5e798e68060e6e8cadbf795531557880cd`
- Progression V4: `0xaecf844569aba92494947bc4edf8e268c31b5c54`
- Liquidity sponsor: `0x24a43ad7e9318cf515867477bf9c489989dcc701`

All three are linked through the Shannon explorer in the repository README.

## Suggested DoraHacks tags

`DeFi` · `Event Contracts` · `Prediction Markets` · `DreamDEX` · `Consumer`

## Presentation

- [Market Royale hackathon deck](../submission/Market-Royale-Hackathon-Deck.pptx)
- The deck includes speaker notes, public Shannon proof, game mechanics,
  architecture, failure safeguards, and DreamDEX ecosystem impact.

## Team

- **LazyDevPro** — solo builder · [GitHub](https://github.com/lazydevpro)

## Final submission checklist

- [x] Working prototype on Shannon testnet
- [x] Meaningful DreamDEX Event Contract and SDK integration
- [x] Public contract addresses and transaction journals
- [x] Reproducible install and verification commands
- [x] 2–3 minute demo script
- [x] Hackathon presentation deck
- [x] Optional SDK and documentation feedback report
- [x] Public Cloudflare URL added above and tested
- [x] Public GitHub URL added above
- [ ] Demo video uploaded and linked above
- [x] Builder identity and contact link added
