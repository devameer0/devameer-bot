// Live pipeline event bus, graph, and admin Flow API (SSE + history).
const cfg = require('./config');
const store = require('./db');

const RING_MAX = 2000;
const DB_CAP = 5000;
const SECRET_KEY = /pass(word|phrase)?|secret|private.?key|api.?key|session|cookie|authorization|bearer|mnemonic|seed|recovery|database_url|connection.?string|wallet.?private|admin.?password/i;

const NODES = [
  { id: 'feed',     kind: 'Feed',      name: 'PumpPortal',        sub: 'New tokens / trades', color: '#3B82F6', x: 90,   y: 190, icon: 'feed' },
  { id: 'jupiter',  kind: 'Price',     name: 'Jupiter',           sub: 'SOL/USD + grads',     color: '#A855F7', x: 90,   y: 370, icon: 'jupiter' },
  { id: 'rpc',      kind: 'RPC',       name: 'Solana Curve',      sub: 'On-chain reads',      color: '#06B6D4', x: 90,   y: 550, icon: 'rpc' },
  { id: 'rugs',     kind: 'Filter',    name: 'Rug Checks',        sub: 'Dev / bundle / liq',  color: '#F97316', x: 340,  y: 190, icon: 'rugs' },
  { id: 'sniper',   kind: 'Agent',     name: 'Sniper',            sub: 'Fresh launches',      color: '#3B82F6', x: 590,  y: 70,  icon: 'sniper' },
  { id: 'scout',    kind: 'Agent',     name: 'Scout',             sub: 'Live + X hype',       color: '#EF4444', x: 590,  y: 190, icon: 'scout' },
  { id: 'curve',    kind: 'Agent',     name: 'Curve',             sub: '30–75% on curve',     color: '#22C55E', x: 590,  y: 310, icon: 'curve' },
  { id: 'graduate', kind: 'Agent',     name: 'Graduate',          sub: '85–97% on curve',     color: '#A855F7', x: 590,  y: 430, icon: 'graduate' },
  { id: 'risk',     kind: 'Risk',      name: 'Limits',            sub: 'Size / loss / caps',  color: '#EAB308', x: 840,  y: 250, icon: 'risk' },
  { id: 'buy',      kind: 'Action',    name: 'Buy',               sub: 'Paper or live',       color: '#22C55E', x: 1090, y: 190, icon: 'buy' },
  { id: 'monitor',  kind: 'Watch',     name: 'Positions',         sub: 'Open PnL / curve',    color: '#22D3EE', x: 1090, y: 430, icon: 'monitor' },
  { id: 'exits',    kind: 'Condition', name: 'Exits',             sub: 'TP / SL / time',      color: '#F59E0B', x: 1340, y: 430, icon: 'exits' },
  { id: 'sell',     kind: 'Action',    name: 'Sell',              sub: 'Close position',      color: '#EC4899', x: 1590, y: 430, icon: 'sell' },
  { id: 'db',       kind: 'Data',      name: 'Database',          sub: 'Postgres write',      color: '#818CF8', x: 1340, y: 190, icon: 'db' },
  { id: 'share',    kind: 'Share',     name: 'Replay',            sub: 'Cards + MP4',         color: '#E879F9', x: 1840, y: 430, icon: 'share' },
  { id: 'withdraw', kind: 'Action',    name: 'Withdraw',          sub: 'To Phantom',          color: '#14B8A6', x: 1090, y: 640, icon: 'withdraw' },
  { id: 'errors',   kind: 'Alert',     name: 'Errors / Alerts',   sub: 'Fails + rejects',     color: '#F43F5E', x: 840,  y: 640, icon: 'errors' },
];

const EDGES = [
  { id: 'feed-rugs',       from: 'feed',     to: 'rugs' },
  { id: 'feed-monitor',    from: 'feed',     to: 'monitor' },
  { id: 'jupiter-monitor', from: 'jupiter',  to: 'monitor' },
  { id: 'jupiter-buy',     from: 'jupiter',  to: 'buy' },
  { id: 'rpc-rugs',        from: 'rpc',      to: 'rugs' },
  { id: 'rpc-monitor',     from: 'rpc',      to: 'monitor' },
  { id: 'rugs-sniper',     from: 'rugs',     to: 'sniper',   label: 'Pass' },
  { id: 'rugs-scout',      from: 'rugs',     to: 'scout',    label: 'Pass' },
  { id: 'rugs-curve',      from: 'rugs',     to: 'curve',    label: 'Pass' },
  { id: 'rugs-graduate',   from: 'rugs',     to: 'graduate', label: 'Pass' },
  { id: 'rugs-errors',     from: 'rugs',     to: 'errors',   label: 'Reject' },
  { id: 'sniper-risk',     from: 'sniper',   to: 'risk' },
  { id: 'scout-risk',      from: 'scout',    to: 'risk' },
  { id: 'curve-risk',      from: 'curve',    to: 'risk' },
  { id: 'graduate-risk',   from: 'graduate', to: 'risk' },
  { id: 'risk-buy',        from: 'risk',     to: 'buy',      label: 'Pass' },
  { id: 'risk-errors',     from: 'risk',     to: 'errors',   label: 'Reject' },
  { id: 'buy-db',          from: 'buy',      to: 'db' },
  { id: 'buy-monitor',     from: 'buy',      to: 'monitor' },
  { id: 'buy-errors',      from: 'buy',      to: 'errors' },
  { id: 'monitor-exits',   from: 'monitor',  to: 'exits' },
  { id: 'exits-sell',      from: 'exits',    to: 'sell',     label: 'TP / SL / Time' },
  { id: 'sell-db',         from: 'sell',     to: 'db' },
  { id: 'sell-share',      from: 'sell',     to: 'share' },
  { id: 'sell-errors',     from: 'sell',     to: 'errors' },
  { id: 'withdraw-db',     from: 'withdraw', to: 'db' },
  { id: 'rpc-errors',      from: 'rpc',      to: 'errors' },
];

const WORLD = { w: 1980, h: 780, pad: 80 };

const ring = [];
const pending = [];
const clients = new Set();
const stats = Object.fromEntries(NODES.map((n) => [n.id, { events: 0, passes: 0, rejects: 0, errors: 0, lastAt: 0, lastMessage: '' }]));
const lastDup = new Map();
let seq = 0;
let ctx = {};
let flushTimer = null;
let lastCapAt = 0;

function sanitize(value, depth) {
  if (value == null || depth > 5) return value;
  if (typeof value === 'string') return value.length > 1200 ? value.slice(0, 1200) + '…' : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 40).map((x) => sanitize(x, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = sanitize(v, depth + 1);
  }
  return out;
}

function bump(ev) {
  const s = stats[ev.node] || (stats[ev.node] = { events: 0, passes: 0, rejects: 0, errors: 0, lastAt: 0, lastMessage: '' });
  s.events++; s.lastAt = ev.at; s.lastMessage = ev.message || '';
  if (ev.type === 'pass' || ev.ok === true) s.passes++;
  if (ev.type === 'reject' || ev.ok === false) s.rejects++;
  if (ev.type === 'error' || ev.node === 'errors' && ev.ok === false) s.errors++;
}

function persist(ev) {
  pending.push(ev);
  if (pending.length >= 25) flush();
  else if (!flushTimer) flushTimer = setTimeout(flush, 2000);
}

async function flush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  const rows = pending.splice(0, pending.length);
  if (!rows.length) return;
  try {
    const db = store.get();
    if (db && db.saveFlowEvents) await db.saveFlowEvents(rows);
    if (db && db.capFlowEvents && Date.now() - lastCapAt > 60000) {
      lastCapAt = Date.now();
      await db.capFlowEvents(DB_CAP);
    }
  } catch (e) { console.warn('flow persist failed:', e.message); }
}

function emit(raw) {
  if (!raw || !raw.node) return null;
  const now = Date.now();
  const message = String(raw.message || '').slice(0, 280);
  const noisy = raw.type === 'tick' || raw.type === 'lists' || raw.type === 'price' || raw.type === 'status';
  const dupKey = raw.node + ':' + (raw.type || '') + ':' + message;
  const minGap = noisy ? 2500 : (raw.type === 'reject' && (raw.node === 'risk' || raw.node === 'rugs') ? 8000 : 0);
  if (minGap) {
    const prev = lastDup.get(dupKey) || 0;
    if (now - prev < minGap && raw.ok !== false) return null;
    lastDup.set(dupKey, now);
  }
  const ev = sanitize({
    id: ++seq,
    at: now,
    node: String(raw.node).slice(0, 32),
    type: String(raw.type || 'event').slice(0, 32),
    mint: raw.mint ? String(raw.mint).slice(0, 64) : undefined,
    symbol: raw.symbol ? String(raw.symbol).replace(/^\$/, '').slice(0, 14) : undefined,
    agent: raw.agent ? String(raw.agent).slice(0, 16) : undefined,
    ok: raw.ok,
    message,
    from: raw.from ? String(raw.from).slice(0, 32) : undefined,
    data: raw.data && typeof raw.data === 'object' ? sanitize(raw.data, 0) : undefined,
  }, 0);
  ring.push(ev);
  if (ring.length > RING_MAX) ring.shift();
  bump(ev);
  persist(ev);
  const line = 'data: ' + JSON.stringify(ev) + '\n\n';
  for (const res of clients) {
    try { res.write(line); } catch { clients.delete(res); }
  }
  return ev;
}

function history({ since, node, symbol, type, agent, errors, q, limit } = {}) {
  const lim = Math.min(Math.max(+(limit) || 400, 1), 2000);
  const needle = q ? String(q).toLowerCase() : '';
  const coin = symbol ? String(symbol).replace(/^\$/, '').toLowerCase() : '';
  let list = ring;
  if (since) list = list.filter((e) => e.id > +since);
  return list.filter((e) => {
    if (node && e.node !== node) return false;
    if (type && e.type !== type) return false;
    if (agent && e.agent !== agent) return false;
    if (errors && !(e.type === 'error' || e.ok === false || e.node === 'errors')) return false;
    if (coin && String(e.symbol || '').toLowerCase() !== coin && String(e.mint || '').toLowerCase() !== coin) return false;
    if (needle) {
      const blob = ((e.message || '') + ' ' + (e.symbol || '') + ' ' + (e.node || '') + ' ' + (e.type || '') + ' ' + (e.agent || '')).toLowerCase();
      if (!blob.includes(needle)) return false;
    }
    return true;
  }).slice(-lim);
}

function nodeConfig(id) {
  const { engine, market, trader } = ctx;
  if (!engine || !market) return {};
  const s = engine.settings || {};
  const a = engine.constructor === Object ? null : require('./engine').AGENTS;
  const agents = a || {};
  switch (id) {
    case 'feed':
      return { source: 'wss://pumpportal.fun/api/data', subscribed: ['newToken', 'migration', 'tokenTrade (open positions)'], connected: !!market.stats.wsConnected, newTokens: market.stats.newTokens, migrations: market.stats.migrations, listPulls: market.stats.apiLists, lastNewTokenAt: market.stats.lastNewTokenAt || 0 };
    case 'jupiter':
      return { solUsd: market.solUsd || 0, lastAt: market.solUsdAt || 0, sources: ['lite-api.jup.ag', 'api.coingecko.com'] };
    case 'rpc':
      return { pollMs: cfg.POLL_MS, watchMax: cfg.WATCH_MAX, watching: market.watchList().length, tracked: market.tokens.size, curvePolls: market.stats.curvePolls, rpcErrors: market.stats.rpcErrors, lastPollAt: market.stats.lastPollAt || 0 };
    case 'rugs':
      return { maxDevPct: cfg.MAX_DEV_PCT, maxBundlePct: cfg.MAX_BUNDLE_PCT, minLiqSol: cfg.MIN_LIQ_SOL, priorRugCreators: engine.rugCreators.size };
    case 'sniper':
    case 'scout':
    case 'curve':
    case 'graduate': {
      const ag = agents[id] || {};
      return { enabled: !!(s.agents && s.agents[id]), takeProfit: ag.tp, stopLoss: ag.sl, maxHoldMin: ag.maxHoldMs ? ag.maxHoldMs / 60000 : null, desc: ag.desc || '' };
    }
    case 'risk':
      return { maxOpen: cfg.MAX_OPEN_POSITIONS, dailyLossLimitSol: cfg.DAILY_LOSS_LIMIT_SOL, tradeSizeSol: s.tradeSize, maxSolPerTrade: cfg.MAX_SOL_PER_TRADE, buyCooldownMs: 5000, goal: s.goal, goalHold: !!engine.goalHold, dailyLossHit: !!engine.dailyLossHit(), open: engine.open().length, running: !!engine.running };
    case 'buy':
      return { paper: !trader.live, dryRun: !!cfg.DRY_RUN, tradeSizeSol: s.tradeSize, slippagePct: s.slippage, priorityFeeSol: s.priorityFee };
    case 'monitor':
      return { open: engine.open().length, pinned: market.pinned.size, pollMs: cfg.POLL_MS };
    case 'exits':
      return { agents: Object.fromEntries(Object.entries(agents).map(([k, v]) => [k, { tp: v.tp, sl: v.sl, maxHoldMin: v.maxHoldMs / 60000 }])) };
    case 'sell':
      return { paper: !trader.live, dryRun: !!cfg.DRY_RUN };
    case 'db':
      return { kind: store.get()?.kind || 'unknown', schema: store.get()?.schema || null, eventCap: DB_CAP, ring: RING_MAX };
    case 'share':
      return { publicRoutes: ['/share/trade/:id', '/share/trade/:id.png', '/share/trade/:id.mp4', '/share/account'], note: 'Public links never include wallet, keys, or admin data' };
    case 'withdraw':
      return { destinationConfigured: !!cfg.WITHDRAW_ADDRESS, reserveSol: cfg.WITHDRAW_RESERVE_SOL, paper: !trader.live };
    case 'errors':
      return { rpcErrors: market.stats.rpcErrors, notes: 'Buy/sell failures, rug rejects, and risk holds land here' };
    default:
      return {};
  }
}

function status() {
  const { engine, trader } = ctx;
  return {
    mode: engine ? engine.mode : (cfg.DRY_RUN ? 'PAPER' : 'LIVE'),
    running: !!(engine && engine.running),
    dryRun: !!cfg.DRY_RUN,
    paper: engine ? !engine.trader.live : !!cfg.DRY_RUN,
    db: store.get()?.kind || null,
    dbSchema: store.get()?.schema || null,
    seq,
  };
}

async function attach({ market, engine, trader, ticks }) {
  ctx = { market, engine, trader, ticks };
  try {
    const db = store.get();
    if (db && db.maxFlowEventId) seq = Math.max(seq, await db.maxFlowEventId());
    if (db && db.listFlowEvents) {
      const rows = await db.listFlowEvents({ limit: RING_MAX });
      for (const ev of rows) {
        ring.push(ev);
        if (ev.id > seq) seq = ev.id;
        bump(ev);
      }
    }
  } catch (e) { console.warn('flow history load failed:', e.message); }

  market.on('status', (s) => {
    emit({ node: 'feed', type: 'status', message: s === 'ws-open' ? 'PumpPortal websocket connected' : String(s), ok: s === 'ws-open' });
  });
  market.on('newToken', (t) => {
    emit({ node: 'feed', type: 'token', mint: t.mint, symbol: t.symbol, message: `new token $${String(t.symbol || '?').replace(/^\$/, '')}`, data: { source: t.source, devPct: t.devPct, vSol: t.vSol } });
  });
  market.on('migrate', (t) => {
    emit({ node: 'feed', type: 'migrate', mint: t.mint, symbol: t.symbol, from: 'rpc', message: `$${(t.symbol || '?')} migrated / graduated` });
  });

  const _refreshSol = market.refreshSol.bind(market);
  market.refreshSol = async function refreshSolWrapped() {
    await _refreshSol();
    if (market.solUsd) emit({ node: 'jupiter', type: 'price', ok: true, message: `SOL/USD ${market.solUsd.toFixed(2)}`, data: { solUsd: market.solUsd } });
  };

  const _jup = market.jupPriceSol.bind(market);
  market.jupPriceSol = async function jupWrapped(mint) {
    const p = await _jup(mint);
    const t = market.tokens.get(mint);
    if (p) emit({ node: 'jupiter', type: 'price', mint, symbol: t && t.symbol, from: 'monitor', ok: true, message: `graduated price for $${(t && t.symbol) || 'token'}`, data: { priceSol: p } });
    return p;
  };

  const _pollLists = market.pollLists.bind(market);
  market.pollLists = async function pollListsWrapped() {
    await _pollLists();
    emit({ node: 'feed', type: 'lists', message: `pump.fun lists refresh · ${market.tokens.size} tracked`, data: { listPulls: market.stats.apiLists, tracked: market.tokens.size } });
  };

  const _pollCurves = market.pollCurves.bind(market);
  market.pollCurves = async function pollCurvesWrapped() {
    const err0 = market.stats.rpcErrors;
    await _pollCurves();
    const erred = market.stats.rpcErrors > err0;
    emit({ node: 'rpc', type: 'tick', ok: !erred, message: erred ? 'curve poll RPC error' : `curve poll · watching ${market.watchList().length}`, data: { watching: market.watchList().length, tracked: market.tokens.size, polls: market.stats.curvePolls, rpcErrors: market.stats.rpcErrors } });
    if (erred) emit({ node: 'errors', type: 'error', from: 'rpc', ok: false, message: 'Solana RPC error during curve poll' });
  };

  const origClose = market.connectWs.bind(market);
  // hook ws close/open via existing status + wrap connect after start. status already covers open.
  const prev = market.connectWs.bind(market);
  market.connectWs = function connectWsWrapped() {
    prev();
    const ws = market.ws;
    if (!ws) return;
    ws.on('close', () => emit({ node: 'feed', type: 'status', ok: false, message: 'PumpPortal websocket closed, reconnecting' }));
  };
  void origClose;

  emit({ node: 'feed', type: 'status', message: 'pipeline inspector online', ok: true, data: { dryRun: !!cfg.DRY_RUN } });
}

function mount(app, { requireAdmin, requireFlowRead }) {
  const gate = requireFlowRead || requireAdmin;
  app.get('/api/flow', gate, (req, res) => {
    res.json({
      nodes: NODES,
      edges: EDGES,
      world: WORLD,
      status: status(),
      stats,
      configs: Object.fromEntries(NODES.map((n) => [n.id, nodeConfig(n.id)])),
    });
  });
  app.get('/api/flow/events', gate, (req, res) => {
    const events = history({
      since: req.query.since, node: req.query.node, symbol: req.query.symbol || req.query.coin,
      type: req.query.type, agent: req.query.agent, errors: req.query.errors === '1' || req.query.errors === 'true',
      q: req.query.q, limit: req.query.limit,
    });
    res.json({ events, stats, seq, status: status() });
  });
  app.get('/api/flow/stream', gate, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    res.write('data: ' + JSON.stringify({ type: 'hello', status: status(), seq }) + '\n\n');
    clients.add(res);
    const ping = setInterval(() => { try { res.write(':ping\n\n'); } catch {} }, 15000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
  });
}

module.exports = { emit, attach, mount, history, status, stats, NODES, EDGES, WORLD, nodeConfig, RING_MAX, DB_CAP };
