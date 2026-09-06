# Shannon testnet verification

Completed 2026-09-04T11:50:48.519Z. Status: **complete**.

Arena: [0x50010a633babac530f72cd542174533ee48ad5cb](https://shannon-explorer.somnia.network/address/0x50010a633babac530f72cd542174533ee48ad5cb).

A real two-wallet, five-minute BTC match completed on chain 50312. The external DreamDEX oracle resolved UP. No oracle override or simulated fill was used.

| Check | Result |
| --- | --- |
| Confirmed public-network transactions | 30 |
| Actual entrants | 2 |
| Each entry | 2 tUSDC prize contribution + 10 tUSDC bankroll |
| Player A trade | 2 UP shares for 1.1 tUSDC |
| Player B trade | 2 DOWN shares for 1.1 tUSDC |
| Oracle payout vector | [10000000, 0] — UP wins |
| Settled bankrolls | A: 10.9 tUSDC; B: 8.9 tUSDC |
| Prize | A claimed 4 tUSDC; B received 0 |
| Withdrawals | Both bankrolls withdrawn |
| Maker cleanup | Resting orders cancelled; remaining winning inventory redeemed |
| Collateral accounting | Final wallet balances sum to the original 100 tUSDC |
| Native gas spent across test wallets | 0.875646438 STT |

## Selected receipts

- [Deploy MarketRoyale](https://shannon-explorer.somnia.network/tx/0xfb8bb76c24b9887c694a3dde9f1af10287a7998525d7232e51c246bf8ae7adad)
- [Player 1 joins with 12 tUSDC](https://shannon-explorer.somnia.network/tx/0xa67117c60d5ce08054ecadf2e173b98aca2706860471ef1d442d671edb313cd1)
- [Player 2 joins with 12 tUSDC](https://shannon-explorer.somnia.network/tx/0x9d831415da3ee960212ab814094b6ee1ea6437d2c6abcd67b3a4059d1b88147f)
- [Player 1 buys UP](https://shannon-explorer.somnia.network/tx/0x06ffc507153c14398272e370d57f689bb8964d1f7c95db01ccd8b606df3ed594)
- [Player 2 buys DOWN](https://shannon-explorer.somnia.network/tx/0xab911255fa56a6af6d5e9867f8d696229abf6aa0ca6ad5543686e460cd2563e5)
- [Settle tournament from real oracle](https://shannon-explorer.somnia.network/tx/0xae952184d2f43fd5234ed42f091e13f8316063cd9ab425324786dd689bd1202c)
- [Player 1 claims prize](https://shannon-explorer.somnia.network/tx/0xc1381dac5d267bdfc57c49f20e2261bfce07210208daef8e2864937f9933bbce)

## Validation scope

The production build and TypeScript check passed. The local contract lifecycle test additionally exercises multi-round cuts, action limits, authorization, donation-proof scoring, void refunds, repeated-claim rejection, and timeout recovery. The public-network run above was a two-player, one-round match; 64-player load and browser-extension signing were not exercised by this run.

The browser was checked against live on-chain data at desktop and mobile widths, including match navigation, holdings, history, final ranks, and missing-wallet guidance. Connect your own EVM wallet in a regular browser to play. The Codex in-app preview has no wallet extension.

Full machine-readable evidence: [shannon-e2e.json](./shannon-e2e.json). Test-wallet keys remain in the ignored local `.testnet` directory and are never part of the app bundle.
