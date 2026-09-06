# Market Royale visual redesign plan

Reference: `ChatGPT Image Sep 5, 2026, 07_39_05 PM.png`

## Design direction

**Direction:** Playful arcade lobby with a trustworthy trading cockpit.

**Density:** Spacious and expressive in discovery, progression, and results. Compact and precise during live trading.

**Surface:** Layered toy-like event panels, asymmetric hero compositions, and calm white trading panels with strong numeric alignment.

**Type mood:** Chunky, friendly, confident, and easy to scan. Use a rounded display face for titles and the existing Inter family for controls and data. Use tabular numerals for prices, timers, balances, and ranks.

**Motion:** Buoyant lobby entrances and reward moments; crisp, quiet updates in the trading view.

Do:

- Make the live event the unmistakable primary action.
- Give every royale format, league, badge, and state its own silhouette.
- Use characters and 3D objects to explain state: waiting, live, cut, won, protected, or locked.
- Keep real balances, transaction states, and order-book controls visually calmer than promotional surfaces.
- Preserve the existing cyan, blue, purple, green, orange, navy, and white brand palette, with one dominant hue per surface.

Avoid:

- Copying the reference mascot, logo lettering, friends panel, or decorative composition.
- Giving every card the same radius, shadow, gradient, or visual weight.
- Running WebGL scenes continuously behind trading controls.
- Adding fake players, social presence, prices, modes, or rewards that do not exist on Shannon.
- Letting art obscure gas, entry contribution, bankroll, order limits, settlement, or protection conditions.

## Visual system

### Shape and depth

- Use a three-level radius system: 14px for controls, 22px for data panels, and 30–36px for featured event and celebration surfaces.
- Build depth from a white keyline, a colored lower edge, soft ambient shadow, and small internal highlights. Reserve the thickest treatment for the featured event and primary CTA.
- Keep trading inputs on flatter 12–16px surfaces with visible focus rings and limited decoration.
- Use clouds, diamonds, coins, crowns, market arrows, and confetti as cropped edge elements rather than evenly scattered decoration.

### Typography

- Display candidate: **Fredoka** in heavy weights for section titles, mode names, league labels, and reward counts.
- UI and body: keep **Inter** for forms, wallet state, explanations, and compact labels.
- The MARKET ROYALE wordmark should be an original rendered asset, with a flat accessible text fallback in the document.
- Limit each screen to five text sizes and three active weights. All numbers use `font-variant-numeric: tabular-nums`.

### Color roles

- Cyan/blue: live events, navigation, network truth, and informational state.
- Purple: progression, leagues, gems, and special events.
- Green: the single primary action and positive completion.
- Orange/yellow: prizes, bankroll, countdown emphasis, and earned value.
- Pink: live status and limited promotional tags.
- Red: errors and losing/PnL semantics only, always paired with text or an icon.

## Asset system

Create `public/art/` with four layers:

1. `characters/`: eight starter avatars, one crown mascot, four emotional poses, and small circular portraits.
2. `objects/`: BTC/ETH market coins, tUSDC stack, gem, crown, swords, shield, trophy, timer, vault, chart arrows, and protection ring.
3. `badges/`: eight existing soulbound achievements, five league medallions, and five season-level emblems.
4. `environment/`: cloud banks, sparkles, confetti, rays, soft blobs, podium, and badge-shelf pieces.

Every raster asset should have:

- a transparent 2048px source PNG;
- 1x and 2x WebP/AVIF production exports;
- consistent front-left key light, cyan fill, violet rim, soft vinyl material, and the same camera angle;
- a safe crop, dominant color, alt-text rule, and named owner in `public/art/assets-manifest.json`;
- license/source details in `public/art/ATTRIBUTION.md`.

Use external libraries for generic primitives and generate the Market Royale identity assets ourselves:

- [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji) provides a large friendly emoji set under MIT and is useful for generic expressions and small status objects.
- [Kenney](https://kenney.nl/assets/) provides CC0 UI, 2D, and 3D game assets; use it for neutral controls, effects, and prototype pieces.
- [Icons8 3D illustrations](https://icons8.com/l/3d/) are usable with attribution on the free tier; a paid license removes attribution and unlocks higher-quality formats.
- [Spline Community](https://spline.design/terms) uses a standard commercial license for remixable community content. Use Spline for editable hero compositions, then export optimized stills or short clips.
- [LottieFiles](https://help.lottiefiles.com/animation-licensing-basics-) can supply small reward and status animations. Record the license for every chosen animation and keep animation files out of the critical trading path.

The preferred production approach is still imagery for most 3D art. Use Lottie or lightweight CSS for sparkles, badge minting, countdown emphasis, and celebration. This gives the reference's depth without a heavy runtime renderer.

### Figma Community intake

Use Figma Community as a source for editable primitives and inspiration, especially for `3D crypto icons`, `cryptocurrency 3D`, `web3 3D illustration`, `game avatar`, `PFP creator`, and `character builder`. Do not make a third-party pack the core identity of Market Royale.

Create a `00 — Asset Intake` page in the product Figma file. Every candidate asset gets a small record with:

- the Community resource URL, creator, and original pack name;
- whether the resource was free or paid when acquired;
- the applicable license and required attribution;
- the components we intend to use and how they will be changed;
- an `approved`, `prototype only`, or `rejected` status.

Free Figma Community resources use CC BY 4.0, so commercial adaptation is allowed with attribution. Paid resources may be used inside a larger original product, but the original pack cannot be redistributed or remain the primary value of the output. Mirror approved records in `public/art/ATTRIBUTION.md` before exporting anything into the application.

Shortlist no more than three packs for each category, then compare them against one art-direction test: front-left key light, cyan fill, violet rim, soft vinyl material, rounded proportions, and a consistent three-quarter camera. If a pack cannot be normalized to that recipe, use it only for layout exploration.

Initial Figma Community intake candidates:

- Crypto objects: **3d Editable Cryptocurrencies** by Aneesh Ravi, **Coinsupply — 3D Cryptocurrency Coins Illustrations** by yav1N, and **3D Crypto Icons Set — Free 32 Crypto Coins** by Angelina.
- Avatar references: **Cute & Cozy 3d Avatars** by Unipaws, **3D Web3 Avatars** by Koncepted, and **Free 3D Avatarz | ThreeDee** by ThreeDee.

These are candidates for source inspection, proportion studies, and temporary comps. Approve an individual resource only after inspecting its actual layers, export quality, creator record, and license inside Figma.

### Player PFP system

Launch with an original modular character family called **Royale Runners**. Every wallet receives a recognizable PFP immediately, and players unlock cosmetic choices through league and season progression.

The avatar contains fixed, interchangeable layers:

1. one of eight base characters;
2. body and suit palette;
3. eyes and expression;
4. headwear;
5. handheld or shoulder accessory;
6. league frame and season background.

Use the normalized wallet address as the deterministic seed for the default combination. The same wallet must produce the same avatar on every device. Let the player replace individual layers with unlocked cosmetics without changing their identity. Do not require an NFT or a profile upload.

Render the original character art as aligned transparent SVG or WebP layers. Compose the layers in a fixed square component so one PFP works at 32px in standings, 64px in event cards, 128px in profiles, and 512px on result/share cards. Export a fallback static image for social cards and low-capability clients.

Store the chosen `base`, `palette`, `expression`, `headwear`, `accessory`, `frame`, and `background` IDs in a signed player profile. Cloudflare D1 is sufficient for durable profile settings; verify cosmetic ownership against the progression contract before accepting a selection. Cache the resolved profile at the edge. Local development can retain the deterministic wallet default when the profile service is unavailable.

League frames communicate Bronze, Silver, Gold, Diamond, and Champion. Temporary overlays communicate real game state: a crown for the latest win, shield for active loss protection, and a live dot only when presence is confirmed. Keep achievements as separate badges so the PFP does not become unreadable.

Use DiceBear only as an early fallback or loading placeholder. Choose a CC0 style and self-host the generator so wallet identifiers are not sent to a third-party API. The production identity should use the original Royale Runners definition, which can also be authored as a custom DiceBear-compatible style in Figma and exported as a versioned JSON definition.

Later releases may support an NFT avatar after adding chain-aware metadata validation, an image proxy, broken-content fallbacks, and moderation. User-uploaded PFPs require storage, resizing, content review, reporting, and abuse controls, so they should follow the curated and wallet-generated systems.

## Screen plan

### 1. Global shell

Desktop uses a 208px left rail, a flexible center stage, and an optional 292px right rail. The center remains usable when the right rail disappears. At tablet width, move the right rail below the featured event. On mobile, use a compact top wallet strip and a five-item bottom navigation.

The shell contains:

- an original 3D MARKET ROYALE wordmark;
- wallet identity, STT, tUSDC, current league, and notification state;
- Home, Live Royale, Progress, Rewards, and History navigation;
- a small network-truth strip showing Shannon, data freshness, and keeper status.

### 2. Arena / home

Replace the current linear dashboard with an asymmetric event lobby:

- **Featured live royale:** dominant 7-column card with real asset, market duration, actual entrant count/capacity, prize pool, start/expiry timer, portraits, liquidity status, and one Join/View CTA.
- **Format rail:** two unequal cards for a 2-player Duel and an Open Royale. These map to real arena capacity/minimum presets rather than separate contracts.
- **Host event:** a visually quieter card that expands into the existing real scheduling form.
- **Daily record:** wins, survival rate, rating movement, protected losses remaining, and season XP.
- **Upcoming events:** compact cards below the fold; cancelled and finished events move to History.

Empty turnout should still look intentional: show the host mascot preparing the arena, the minimum needed, time remaining, invite link, and the full-refund rule.

### 3. Live game

Use a hybrid battle/trading layout:

- A top battlefield bar shows round, market, timer, active players, cut line, and the player's avatar/vault.
- A slim visual race track shows ranked avatars moving with confirmed vault value. Changes animate only after a fresh block.
- The central trading surface keeps the real order book, UP/DOWN choice, price, quantity, remaining actions, holdings, cash, and transaction confirmation.
- Use a calm neutral panel for the order form. PnL green/red remains semantic and never becomes decorative.
- Desktop shows standings beside the market; mobile switches between **Trade**, **Race**, and **Position** tabs.
- Pending, rejected, stale-RPC, empty-book, partial-fill, market-expired, and oracle-waiting states each receive a specific small illustration and direct recovery copy.

### 4. Results and minting

Make completion the emotional payoff:

- Champion state uses a large original crown character and podium composition.
- Every player sees rank, bankroll result, prize, rating movement, season XP, and survived cuts before the badge animation.
- Minting reveals each newly earned soulbound badge one at a time, then shows the Shannon transaction link.
- A protected loss uses the shield/protection-ring character, explicitly separates the 1 tUSDC sponsor payment from the player's trading result, and shows remaining uses.
- Users who earned nothing new still receive a clear next progression target.

### 5. Progression

Turn the existing page into a trophy room:

- Oversized 3D league medallion with rating and next threshold.
- A horizontal season road with five checkpoints and an Invitational Pass reveal at level three.
- Badge shelf with earned badges rendered in full color; locked badges use a desaturated silhouette and exact requirement.
- Career record and recent rating movement remain structured data panels.
- On mobile, the league medallion leads, followed by season road, earned badges, then record details.

### 6. Wallet, history, and rules

These screens stay quieter for trust:

- Wallet uses an illustrated vault header but keeps balances, approvals, faucet, addresses, and transaction state in restrained panels.
- History becomes a timeline with small event thumbnails, rank, payout, badge, and explorer link.
- Rules uses illustrated steps for entry, trade, cut, settlement, prizes, and protection, while preserving exact contract language.

## Motion plan

- Shell entrance: 450ms, staggered by 50ms.
- Featured event hover: 160ms lift with light/parallax movement limited to 4px.
- Live tag and timer: subtle pulse; no flashing.
- Ranking updates: 140ms positional interpolation after block confirmation.
- Badge mint: 700–900ms scale, rotate, highlight sweep, and short confetti burst.
- Champion result: one 1.2s celebration, then settle into a static state.
- Respect `prefers-reduced-motion`; show the final frame immediately.

## Implementation sequence

### Phase 0 — art direction proof

- Produce one desktop arena frame, one mobile arena frame, and one live-game frame.
- Generate the wordmark, crown mascot, BTC/ETH/tUSDC objects, three avatars, and one badge.
- Test them against the current brand colors and real match #2 data.
- Lock the render recipe before creating the complete asset set.

**Gate:** the three frames must look like the same product, and the game screen must remain readable without the art.

### Phase 1 — tokens and reusable primitives

- Add three-tier color, radius, shadow, depth, and motion tokens.
- Build `GamePanel`, `ToyButton`, `StatusPill`, `Avatar`, `PrizeStack`, `EventTimer`, `LeagueMedallion`, and `BadgeTile`.
- Add image wrappers with explicit dimensions, loading placeholders, and automatic WebP/AVIF selection.
- Add the deterministic avatar resolver, layered `PlayerAvatar`, league frames, and signed profile schema.

**Gate:** Storybook-like component states or a local component gallery covers hover, focus, loading, disabled, error, and reduced motion.

### Phase 2 — shell and arena

- Build the three-column responsive shell.
- Replace the arena hero and event listing with the featured-event hierarchy.
- Add real format presets and host-event expansion.
- Wire every label to current API/contract data; keep mock data out.
- Use wallet-seeded PFPs in entrant lists and standings, with real presence and league state only.

**Gate:** join, leave, invite, schedule, low-turnout, cancelled, and finished paths still work against Shannon.

### Phase 3 — live game

- Add the battlefield bar, race visualization, responsive view tabs, and illustrated states.
- Restyle the order book and order form without changing signing or contract behavior.
- Animate rank only when the new block and vault values are confirmed.

**Gate:** both local wallets can complete another real event, including partial/empty order handling and settlement recovery.

### Phase 4 — results, progression, and badges

- Build result celebration, sequential badge reveal, league medallion, season road, and trophy shelf.
- Integrate the existing progression preview, `recordResult`, and `claimProtection` flows.
- Add exact locked-badge requirements and explorer links.

**Gate:** winner, loser, protected loser, no-new-badge, already-minted, and empty-reserve states are visually distinct and contract-accurate.

### Phase 5 — secondary screens and polish

- Redesign Wallet, History, and Rules.
- Add loading cross-fades, sound-ready interaction hooks, responsive assets, and reduced-motion behavior.
- Remove temporary and inconsistent art.

**Gate:** no console errors, no horizontal overflow, keyboard navigation works, and every action retains a visible focus state.

### Phase 6 — performance and release validation

- Keep initial arena art below 1.2 MB compressed; each major still below 300 KB where practical.
- Lazy-load below-fold character and badge art.
- Prevent layout shift with fixed aspect ratios and placeholders.
- Test at 375, 768, 1280, and 1600 widths.
- Run TypeScript, contract tests, Next production build, Cloudflare build, and a new two-wallet Shannon event.

**Gate:** the visual layer can fail or load slowly without hiding balances, contract state, transaction controls, or recovery paths.

## Anti-generic review

The current product already has a strong palette, but it relies heavily on similar white cards, repeated radii, and comparable panel weight. The redesign should create hierarchy through unequal composition, distinctive silhouettes, and art tied to actual game state. The reference is maximalist; copying every color and decorative object would flatten hierarchy again. Each screen therefore gets one dominant visual moment and calmer supporting surfaces.

## First implementation slice

Start with the arena rather than generating the entire asset library. Build and approve this minimum set:

1. Original MARKET ROYALE wordmark.
2. Crown mascot in neutral, inviting, winning, and protected-loss poses.
3. BTC, ETH, tUSDC, gem, timer, duel swords, open-royale shield, and prize stack.
4. Three starter avatars.
5. Featured-event card, two format cards, daily record row, and mobile shell.

For this slice, implement one Royale Runner base with three expressions and three headwear options, plus the deterministic wallet resolver. This proves the PFP pipeline before producing all eight character bases.

Once this slice works with live Shannon data at desktop and mobile sizes, reuse the approved render recipe for the remaining avatars, leagues, badges, and result scenes.
