# Market Royale demo script

Target length: **2 minutes 45 seconds**. Record at 1080p in a clean browser
profile. Keep the wallet funded and open a fresh event before recording so no
time is spent waiting for enrollment or oracle settlement.

## 0:00–0:18 — Hook

**Show:** Arena home and the main Host a Royale card.

**Say:** “Prediction markets are normally solitary. Market Royale turns live
DreamDEX Event Contracts into a multiplayer survival game: everyone starts
with the same bankroll, trades the same market, and the bottom half gets cut.”

## 0:18–0:35 — Product overview

**Show:** Scroll just enough to expose the event options, then return to the
arena cards.

**Say:** “A host chooses BTC or ETH, entry size, starting vault, capacity, and
round count. The host is player one. Every wallet funds an isolated vault and
the entire entry pool becomes prizes.”

## 0:35–1:10 — Host and join

**Show:** Create a quick two-player event. Copy its invite, switch to Player A,
open the invite, approve tUSDC, and join. Point out that the bot does not join a
full duel.

**Say:** “This is Shannon testnet and every action is a real transaction. The
second player enters on equal terms. If quorum, liquidity, or timing fails, the
contract exposes a bounded cancellation and recovery path.”

## 1:10–1:55 — Trade the round

**Show:** The game cockpit. Point to the live chart, UP/DOWN book, bankroll,
rank, cutoff, and compact royale list. Buy UP, then preview and execute a sell.

**Say:** “The vault sends immediate-or-cancel orders to the real DreamDEX
order book. Before signing, the ticket walks visible depth and previews filled
quantity and average price. A sell also shows exact realized profit or loss.
Chart markers reveal where players entered without covering the price action.”

## 1:55–2:20 — Settle and win

**Show:** Use a previously completed event if the recorded market has not
expired. Open its result card, winner celebration, payout status, progression,
and badge view.

**Say:** “After the DreamDEX oracle finalizes, outcome shares redeem to tUSDC.
The arena ranks final bankrolls, eliminates the bottom half, and pays the
winner or top three. Results automatically update rating, season XP, career
stats, and soulbound achievements.”

## 2:20–2:38 — Technical proof

**Show:** Shannon explorer tabs for the arena and one completed transaction,
then the README architecture diagram.

**Say:** “Each player has a dedicated TraderVault. A Cloudflare Durable Object
checks liquidity and advances settlement in bounded batches, but it cannot
trade from player vaults or redirect payouts. The repository includes public
deployment journals and a 64-player contract test.”

## 2:38–2:45 — Close

**Show:** Return to the arena.

**Say:** “Market Royale gives DreamDEX a repeatable consumer game built on real
Event Contract liquidity. Trade, survive, and climb higher.”

## Recording checklist

- Use the public Cloudflare URL, not localhost.
- Hide local-wallet controls, private browser profiles, terminal windows, and
  secret files.
- Show at least one wallet confirmation and one Shannon explorer receipt.
- Use the shortest interval currently published by the trusted DreamDEX venue;
  the default is 15 minutes. Do not present a local timer as oracle settlement.
- Cut all RPC waits and market-expiry waits.
- Verify audio, text readability, and final duration before upload.
