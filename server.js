const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const cfg = require('./src/config');
const store = require('./src/db');
const { Market } = require('./src/market');
const { Trader } = require('./src/trader');
const { Engine, AGENTS } = require('./src/engine');
const share = require('./src/share');
const ticks = require('./src/ticks');
const replay = require('./src/replay');

const SECRET = cfg.SESSION_SECRET || crypto.createHash('sha256').update('devameer-bot:' + (cfg.ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex'))).digest('hex');
const sign = (v) => v + '.' + crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const verify = (s) => { if (!s) return false; const i = s.lastIndexOf('.'); const v = s.slice(0, i); return sign(v) === s && +v.split(':')[1] > Date.now(); };
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

(async () => {
  await store.init();
  const market = new Market();
  const trader = new Trader(market);
  await trader.init();
  const engine = new Engine(market, trader);
  await engine.init();
  await ticks.init(market, engine);
  market.start();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20kb' }));
  app.use(cookieParser());

  const authed = (req) => verify(req.cookies.sid);
  const requireAdmin = (req, res, next) => authed(req) ? next() : res.status(401).json({ error: 'login required' });
  const requireRead = (req, res, next) => (cfg.PUBLIC_READONLY || authed(req)) ? next() : res.status(401).json({ error: 'login required' });

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  const attempts = new Map();
  app.post('/api/login', (req, res) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
    const a = attempts.get(ip) || { n: 0, at: Date.now() };
    if (Date.now() - a.at > 15 * 60000) { a.n = 0; a.at = Date.now(); }
    if (a.n >= 10) return res.status(429).json({ error: 'too many attempts, wait 15 min' });
    if (!cfg.ADMIN_PASSWORD) return res.status(503).json({ error: 'ADMIN_PASSWORD is not set on the server' });
    if (!safeEq(req.body?.password || '', cfg.ADMIN_PASSWORD)) { a.n++; attempts.set(ip, a); return res.status(401).json({ error: 'wrong password' }); }
    attempts.delete(ip);
    res.cookie('sid', sign(`admin:${Date.now() + 30 * 864e5}`), { httpOnly: true, sameSite: 'strict', secure: req.secure || req.headers['x-forwarded-proto'] === 'https', maxAge: 30 * 864e5 });
    res.json({ ok: true });
  });
  app.post('/api/logout', (req, res) => { res.clearCookie('sid'); res.json({ ok: true }); });

  let balCache = { at: 0, v: null };
  const walletSol = async () => {
    if (!trader.kp) return null;
    if (Date.now() - balCache.at < 20000) return balCache.v;
    const v = await trader.balanceSol();
    balCache = { at: Date.now(), v };
    return v;
  };

  app.get('/api/state', requireRead, async (req, res) => {
    const since = +req.query.since || 0, evSince = +req.query.ev || 0;
    const s = engine.summary();
    const pub = (t) => ({ id: t.id, mint: t.mint, symbol: t.symbol, name: t.name || '', image: t.image, agent: t.agent, status: t.status, paper: t.paper, openedAt: t.openedAt, closedAt: t.closedAt, costSol: t.costSol, proceedsSol: t.proceedsSol, pnlSol: t.pnlSol, pnlPct: t.pnlPct, exitReason: t.exitReason, buySig: t.buySig, sellSig: t.sellSig, lastValue: t.lastValue, entryPrice: t.entryPrice, exitPrice: t.exitPrice, entryMcapSol: t.entryMcapSol, exitMcapSol: t.exitMcapSol, solUsdAtClose: t.solUsdAtClose, tokens: t.tokens });
    res.json({
      bot: { name: cfg.BOT_NAME, badge: cfg.BADGE },
      mode: engine.mode, running: engine.running, goalHold: engine.goalHold, authed: authed(req),
      liveCapable: cfg.LIVE_CAPABLE, hasKey: !!trader.kp, dryRun: cfg.DRY_RUN, wallet: trader.pubkey, walletSol: await walletSol(), withdrawTo: cfg.WITHDRAW_ADDRESS || null,
      solUsd: market.solUsd, summary: s, settings: engine.settings,
      agents: Object.fromEntries(Object.entries(AGENTS).map(([k, a]) => [k, { name: a.name, color: a.color, desc: a.desc, tp: a.tp, sl: a.sl, maxHoldMin: a.maxHoldMs / 60000 }])),
      limits: { maxSolPerTrade: cfg.MAX_SOL_PER_TRADE, maxOpen: cfg.MAX_OPEN_POSITIONS, dailyLossLimit: cfg.DAILY_LOSS_LIMIT_SOL, maxSlippage: cfg.MAX_SLIPPAGE_PCT, maxPriorityFee: cfg.MAX_PRIORITY_FEE_SOL, maxDevPct: cfg.MAX_DEV_PCT, maxBundlePct: cfg.MAX_BUNDLE_PCT, minLiqSol: cfg.MIN_LIQ_SOL },
      dailyLossHit: engine.dailyLossHit(),
      feed: { ...market.stats, watching: market.watchList().length, tracked: market.tokens.size },
      open: engine.open().map(pub), closed: engine.closed().slice(-200).reverse().map(pub),
      logs: engine.logs.filter(l => l.id > since).slice(-80), events: engine.events.filter(e => e.id > evSince),
      seq: { log: engine.logSeq, ev: engine.evSeq }, db: store.get().kind, dbSchema: store.get().schema || null,
      coinHistory: ticks.history(40),
    });
  });

  const act = (fn) => async (req, res) => { try { res.json({ ok: true, result: await fn(req) }); } catch (e) { res.status(400).json({ error: e.message }); } };
  app.post('/api/start', requireAdmin, act(() => engine.start()));
  app.post('/api/stop', requireAdmin, act((req) => engine.stop(!!req.body?.sellAll)));
  app.post('/api/keep-going', requireAdmin, act(() => engine.keepGoing()));
  app.post('/api/withdraw', requireAdmin, act((req) => engine.withdraw(+req.body?.sol)));
  app.post('/api/settings', requireAdmin, act(async (req) => { await engine.saveSettings(req.body || {}); return engine.settings; }));
  app.post('/api/reset-paper', requireAdmin, act(() => engine.resetPaper()));
  app.post('/api/sell/:id', requireAdmin, act(async (req) => { const p = engine.open().find(x => x.id === req.params.id); if (!p) throw new Error('no such open position'); await engine.exit(p, 'manual sell'); }));

  app.get('/api/coins/history', requireRead, (req, res) => res.json({ coins: ticks.history(80) }));
  app.get('/api/coin/:mint/ticks', requireRead, async (req, res) => {
    const mint = String(req.params.mint || '');
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) && !/^[a-f0-9]{32,64}$/i.test(mint)) return res.status(400).json({ error: 'bad mint' });
    const from = +req.query.from || 0, to = +req.query.to || Date.now();
    const data = await ticks.ticksFor(mint, { from, to, max: 240 });
    const hist = ticks.history(80).find((c) => c.mint === mint) || null;
    res.json({ mint, ticks: data, stats: hist });
  });

  // Register replay MP4 routes before /share/trade/:id so :id.mp4 is not swallowed.
  replay.mount(app, { engine, ticks, share, requireAdmin, requireRead });
  share.mount(app, { engine, ticks });

  app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
  app.listen(cfg.PORT, () => console.log(`${cfg.BOT_NAME} on :${cfg.PORT} · mode ${engine.mode} · db ${store.get().kind} · dryRun=${cfg.DRY_RUN} · key=${trader.kp ? 'loaded' : 'none'}`));

  if (cfg.KEEP_AWAKE && cfg.PUBLIC_URL) setInterval(() => fetch(cfg.PUBLIC_URL + '/healthz').catch(() => {}), 10 * 60000);
})().catch((e) => { console.error('fatal', e); process.exit(1); });
