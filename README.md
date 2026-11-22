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

On Render's free plan there is no persistent disk for SQLite, so set `DATABASE_URL` (see Persistent history below) or history resets on restart.

Share cards have **Hide profit** (keeps the % only) and **Hide invested** (hides SOL in/out and size) toggles. The choice is stored in `localStorage` as `devameer-share-hide` and is passed on public links as `?hide=profit,invested`, including the Open Graph PNG, so the public page never shows hidden amounts. Cards can be downloaded in dark or light.

The bot records a compact price-tick history for watched and traded coins (capped in SQLite). Open a trade or a row in **Coin history** to see the pump/dump chart with entry and exit markers. A mini chart can be included on the per-coin share card (`?chart=0` to hide it).


## Replay videos
Every trade (and the account share card) has a **Replay video** button. It plays an 8–15 second 30fps clip of the price (or account) curve drawing from buy to exit, with IN/OUT markers, a live PnL % counter, a peak-pump callout, Devameer Bot / @devameer0 branding, and an honest PAPER/LIVE badge. Choose **1:1 (1080×1080)** or **9:16 (1080×1920)**. Hide profit / hide invested and dark/light are respected. Download saves an **MP4** (WebCodecs in the browser, or a server-side `ffmpeg-static` render / transcode). A public endpoint `/share/trade/:id.mp4` (and `/share/account.mp4`) renders the default-background clip; only one render runs at a time to stay light on the free plan.

## Custom card backgrounds
In the share sheet and replay dialog you can upload a **photo (≤5 MB)** or **video (≤25 MB, ≤30s)** as the card/replay background, with dim and blur sliders and cover/contain fit. Video backgrounds loop under the replay and are included in the downloaded MP4; stills are used for the PNG card. Uploads stay in this browser (IndexedDB) — **public share links keep the default background** so nothing is stored on the server.

## Persistent history
On Render's free plan the local SQLite file is wiped on every restart. Set `DATABASE_URL` (or `SUPABASE_DB_URL`) to a Postgres database (Supabase) so trades, open positions, price ticks, coin history, and account snapshots survive deploys. Optional `DATABASE_SCHEMA` (default `devameer_bot` when the URL is a Supabase host). Without `DATABASE_URL`, the bot still uses SQLite in `DATA_DIR` for local previews.


## Flow (live pipeline)
Admins get a **Flow** tab that draws the real bot pipeline in an n8n-style canvas (dark/light). Nodes follow the code path: PumpPortal feed, Jupiter price, Solana RPC / curve reads, rug filters (pass/reject), the four agents, risk checks, buy, position monitor, exits, sell, database, share/replay, withdraw, and errors/alerts.

Every meaningful activity is emitted on an internal event bus (no secrets — keys, passwords, and connection strings are stripped), streamed to the browser over SSE (`/api/flow/stream`), and kept in a ring buffer plus a capped `flow_events` table (last 5,000). The canvas pulses nodes and sends a particle along the edge; a terminal-style activity log under the graph can be filtered, paused, searched, and exported as CSV/JSON. Click a node for its current read-only config and the latest events as JSON.


## Standalone Flow site
The live pipeline also has its own website (Render service `devameer-flow`, typically https://devameer-flow.onrender.com), branded **Devameer Bot Pipeline**. It is a small Node proxy in `/flow-site` with its own login screen (same admin password as the terminal). After login it streams the graph, SSE events, and a stripped `/api/state` from the bot using a server-side `FLOW_READ_TOKEN`. The token never reaches the browser and cannot start, stop, trade, withdraw, or change settings. CORS on the bot is locked to the flow site origin. The in-dashboard Flow tab is unchanged.

On Render's free plan both sites may sleep when idle. The flow site can set `KEEP_AWAKE=true` (and `PUBLIC_URL`) to ping itself every 10 minutes, which helps but does not guarantee 24/7 uptime.
