// All config comes from env. Safety caps are hard limits: runtime settings can never exceed them.
const num = (k, d) => { const v = parseFloat(process.env[k]); return Number.isFinite(v) ? v : d; };
const bool = (k, d) => { const v = process.env[k]; if (v === undefined || v === '') return d; return /^(1|true|yes|on)$/i.test(v); };

const cfg = {
  PORT: num('PORT', 3000),
  BOT_NAME: process.env.BOT_NAME || 'Devameer Bot',
  BADGE: process.env.BADGE || 'DEVAMEER TERMINAL',
  DRY_RUN: bool('DRY_RUN', true),                 // paper mode unless explicitly DRY_RUN=false
  HAS_KEY: !!process.env.WALLET_PRIVATE_KEY,
  SOLANA_RPC_URL: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  WITHDRAW_ADDRESS: process.env.WITHDRAW_ADDRESS || '',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
  SESSION_SECRET: process.env.SESSION_SECRET || '',
  PUBLIC_READONLY: bool('PUBLIC_READONLY', false),
  PUMPPORTAL_API_KEY: process.env.PUMPPORTAL_API_KEY || '',
  DATABASE_URL: process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.SUPABASE_DATABASE_URL || '',
  DATABASE_SCHEMA: (process.env.DATABASE_SCHEMA || ((process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.SUPABASE_DATABASE_URL || '').includes('supabase.co') || (process.env.DATABASE_URL || '').includes('pooler.supabase.com') ? 'devameer_bot' : 'public')).replace(/[^a-zA-Z0-9_]/g, '') || 'public',
  DATA_DIR: process.env.DATA_DIR || './data',
  KEEP_AWAKE: bool('KEEP_AWAKE', false),
  PUBLIC_URL: process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || '',
  FLOW_READ_TOKEN: process.env.FLOW_READ_TOKEN || '',
  FLOW_CORS_ORIGIN: process.env.FLOW_CORS_ORIGIN || '',

  // ---- hard safety caps ----
  MAX_SOL_PER_TRADE: num('MAX_SOL_PER_TRADE', 0.05),
  MAX_OPEN_POSITIONS: Math.max(1, Math.floor(num('MAX_OPEN_POSITIONS', 3))),
  DAILY_LOSS_LIMIT_SOL: num('DAILY_LOSS_LIMIT_SOL', 0.25),
  MAX_SLIPPAGE_PCT: num('MAX_SLIPPAGE_PCT', 15),
  MAX_PRIORITY_FEE_SOL: num('MAX_PRIORITY_FEE_SOL', 0.002),
  WITHDRAW_RESERVE_SOL: num('WITHDRAW_RESERVE_SOL', 0.005),

  // ---- defaults for runtime-tunable settings (clamped to caps) ----
  TRADE_SIZE_SOL: num('TRADE_SIZE_SOL', 0.02),
  SLIPPAGE_PCT: num('SLIPPAGE_PCT', 10),
  PRIORITY_FEE_SOL: num('PRIORITY_FEE_SOL', 0.0005),
  GOAL_MULTIPLE: num('GOAL_MULTIPLE', 5),
  PAPER_STACK_SOL: num('PAPER_STACK_SOL', 0.5),

  // ---- market plumbing ----
  POLL_MS: num('POLL_MS', 3000),
  WATCH_MAX: num('WATCH_MAX', 200),
  PUMP_FEE: num('PUMP_FEE', 0.0125), // approx total pump.fun curve fee used for paper fills

  // ---- rug filters ----
  MAX_DEV_PCT: num('MAX_DEV_PCT', 20),
  MAX_BUNDLE_PCT: num('MAX_BUNDLE_PCT', 30),
  MIN_LIQ_SOL: num('MIN_LIQ_SOL', 2),
};
cfg.LIVE_CAPABLE = !cfg.DRY_RUN && cfg.HAS_KEY;
module.exports = cfg;
