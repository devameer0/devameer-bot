# Devameer Bot · DEVAMEER TERMINAL

A pump.fun trading terminal with 4 agents (Scout, Sniper, Curve, Graduate). The UI is mobile-first.

It starts **PAUSED** and in **PAPER** mode (`DRY_RUN=true`). Paper mode uses live pump.fun data and simulates fills against the real bonding-curve reserves. Real trades only happen when all three of these are true: `DRY_RUN=false`, `WALLET_PRIVATE_KEY` is set, and you press Start.

## Data sources
- PumpPortal websocket `subscribeNewToken` and `subscribeMigration` (free). `subscribeTokenTrade` is used only if `PUMPPORTAL_API_KEY` is set, because it's metered.
- On-chain bonding-curve accounts are read with `getMultipleAccounts` every `POLL_MS`. These give price, progress and graduation.
- The pump.fun frontend lists (live streams and recently traded) supply Scout, Curve and Graduate candidates.
- SOL/USD comes from the Jupiter price API, with CoinGecko as a fallback. Graduated tokens are priced through Jupiter.
- Execution uses the PumpPortal Local Transaction API (`/api/trade-local`, `pool: auto`). It signs locally and sends through `SOLANA_RPC_URL`. Fills are read back from the confirmed tx.

## Env vars
| name | default | notes |
|---|---|---|
| ADMIN_PASSWORD | (none) | required to log in. Every page and API is gated. |
| SESSION_SECRET | derived | optional cookie signing secret |
| DRY_RUN | true | set `false` for real trading |
| WALLET_PRIVATE_KEY | (none) | base58 or JSON byte array. Use a **burner** wallet. It's never logged or returned. |
| WITHDRAW_ADDRESS | (none) | your Phantom address |
| SOLANA_RPC_URL | public mainnet | a private RPC (Helius/QuickNode/Triton) is strongly recommended for live |
| PUMPPORTAL_API_KEY | (none) | optional, enables metered per-token trade stream |
| DATABASE_URL | (none) | Postgres. Without it, SQLite goes in `DATA_DIR` |
| DATA_DIR | ./data | point at a persistent disk |
| PUBLIC_READONLY | false | allow viewing without login |
| KEEP_AWAKE | false | self-ping (free hosting) |
| MAX_SOL_PER_TRADE | 0.05 | hard cap |
| MAX_OPEN_POSITIONS | 3 | hard cap |
| DAILY_LOSS_LIMIT_SOL | 0.25 | no new buys after this much realized loss (UTC day) |
| MAX_SLIPPAGE_PCT | 15 | hard cap (default used: SLIPPAGE_PCT=10) |
| MAX_PRIORITY_FEE_SOL | 0.002 | hard cap (default used: PRIORITY_FEE_SOL=0.0005) |
| TRADE_SIZE_SOL | 0.02 | per trade, clamped to MAX_SOL_PER_TRADE |
| GOAL_MULTIPLE | 5 | at goal: confetti, new buys pause until "keep going" |
| PAPER_STACK_SOL | 0.5 | starting stack for paper mode |
| MAX_DEV_PCT / MAX_BUNDLE_PCT / MIN_LIQ_SOL | 20 / 30 / 2 | rug filters |

## Run
```
npm install
ADMIN_PASSWORD=... npm start
```

## Theme
The dashboard defaults to **dark mode**. A sun/moon button in the header (and on the login screen) switches to light mode. The choice is stored in `localStorage` as `devameer-theme`.

## Share cards
Every open or closed trade has a **Share** button, and the home screen has an account **Share** button next to the 24H / 7D / 30D / All / Custom timeframe chips. Each card can be downloaded as a PNG, copied to the clipboard, or opened as a prefilled **Post on X** compose window (`x.com/intent/post` — nothing is posted automatically).

Public, read-only links (no wallet, key, admin, or withdraw data):
- `/share/trade/:id` and `/share/trade/:id.png` — one coin's PnL
- `/share/account?range=24h|7d|30d|all` (or `range=custom&from=&to=`) and `/share/account.png` — account PnL for that window

Add `?theme=light` for the light card. Open Graph / Twitter `og:image` points at the PNG so a pasted link can show the card preview. The badge on the card is **PAPER** whenever the trade (or the account, in paper mode) is simulated; it only says **LIVE** for real fills.

On Render's free plan there is no persistent disk, so history resets when the service restarts unless `DATABASE_URL` is set.

Share cards have **Hide profit** (keeps the % only) and **Hide invested** (hides SOL in/out and size) toggles. The choice is stored in `localStorage` as `devameer-share-hide` and is passed on public links as `?hide=profit,invested`, including the Open Graph PNG, so the public page never shows hidden amounts. Cards can be downloaded in dark or light.

The bot records a compact price-tick history for watched and traded coins (capped in SQLite). Open a trade or a row in **Coin history** to see the pump/dump chart with entry and exit markers. A mini chart can be included on the per-coin share card (`?chart=0` to hide it).
