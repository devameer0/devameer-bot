// Live market data: PumpPortal websocket (new tokens / migrations), on-chain bonding-curve reads,
// pump.fun frontend lists (live streams / active tokens), SOL/USD price.
const WebSocket = require('ws');
const { Connection, PublicKey } = require('@solana/web3.js');
const EventEmitter = require('events');
const cfg = require('./config');
// fetch with a hard timeout so a slow/rate-limited RPC can never stall the loop
const rpcFetch = (url, opts) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), 12000); return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t)); };
const mkConn = () => new Connection(cfg.SOLANA_RPC_URL, { commitment: 'confirmed', disableRetryOnRateLimit: true, fetch: rpcFetch });


const UA = { 'User-Agent': 'Mozilla/5.0 (devameer-bot)', accept: 'application/json' };
const INITIAL_REAL_TOKENS = 793_100_000; // pump.fun curve: tokens sellable before graduation (per 1B supply)

async function fetchJson(url, opts = {}, timeoutMs = 10000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url.split('?')[0]}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

function decodeCurve(b64) {
  const b = Buffer.from(b64, 'base64');
  if (b.length < 49) return null;
  const u = (o) => Number(b.readBigUInt64LE(o));
  return {
    vTok: u(8) / 1e6, vSol: u(16) / 1e9, realTok: u(24) / 1e6, realSol: u(32) / 1e9,
    supply: u(40) / 1e6, complete: b[48] === 1,
  };
}

class Market extends EventEmitter {
  constructor() {
    super();
    this.conn = mkConn();
    this.tokens = new Map();      // mint -> token record
    this.solUsd = 0; this.solUsdAt = 0;
    this.stats = { wsConnected: false, newTokens: 0, lastNewTokenAt: 0, curvePolls: 0, lastPollAt: 0, rpcErrors: 0, apiLists: 0, lastApiAt: 0, migrations: 0 };
    this.pinned = new Set();      // mints we must keep polling (open positions)
  }

  start() {
    this.connectWs();
    this.refreshSol(); setInterval(() => this.refreshSol(), 30000);
    this.pollLists(); setInterval(() => this.pollLists(), 30000);
    setInterval(() => this.pollCurves(), cfg.POLL_MS);
    setInterval(() => this.prune(), 60000);
  }

  connectWs() {
    const url = 'wss://pumpportal.fun/api/data' + (cfg.PUMPPORTAL_API_KEY ? `?api-key=${encodeURIComponent(cfg.PUMPPORTAL_API_KEY)}` : '');
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.on('open', () => {
      this.stats.wsConnected = true;
      ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
      ws.send(JSON.stringify({ method: 'subscribeMigration' }));
      this.emit('status', 'ws-open');
    });
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.txType === 'create' && m.mint && (!m.pool || m.pool === 'pump')) this.onCreate(m);
      else if (m.txType === 'migrate' || (m.mint && m.pool && !m.txType && m.signature)) {
        this.stats.migrations++;
        const t = this.tokens.get(m.mint); if (t) { t.complete = true; this.emit('migrate', t); }
      } else if ((m.txType === 'buy' || m.txType === 'sell') && m.mint) {
        const t = this.tokens.get(m.mint);
        if (t && m.vSolInBondingCurve) this.addSample(t, { vSol: m.vSolInBondingCurve, vTok: m.vTokensInBondingCurve });
      }
    });
    ws.on('close', () => { this.stats.wsConnected = false; setTimeout(() => this.connectWs(), 5000); });
    ws.on('error', () => { try { ws.close(); } catch {} });
  }

  subscribeTrades(mints) { // metered, only if API key present
    if (!cfg.PUMPPORTAL_API_KEY || !this.ws || this.ws.readyState !== 1 || !mints.length) return;
    this.ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: mints }));
  }

  onCreate(m) {
    this.stats.newTokens++; this.stats.lastNewTokenAt = Date.now();
    const t = this.ensure(m.mint, {
      symbol: (m.symbol || '?').trim().slice(0, 14), name: m.name || '', creator: m.traderPublicKey,
      curveKey: m.bondingCurveKey, createdAt: Date.now(), uri: m.uri, mayhem: !!m.is_mayhem_mode,
      devTokens: m.initialBuy || 0, devPct: (m.initialBuy || 0) / 1e9 * 100, source: 'new', pool: m.pool || 'pump',
    });
    this.addSample(t, { vSol: m.vSolInBondingCurve, vTok: m.vTokensInBondingCurve });
    this.emit('newToken', t);
  }

  ensure(mint, info) {
    let t = this.tokens.get(mint);
    if (!t) { t = { mint, samples: [], peak: 0, firstSeenAt: Date.now(), ...info }; this.tokens.set(mint, t); }
    else Object.assign(t, Object.fromEntries(Object.entries(info).filter(([, v]) => v !== undefined && v !== null)));
    return t;
  }

  addSample(t, s) {
    if (!s.vSol || !s.vTok) return;
    const price = s.vSol / s.vTok; // SOL per token
    const sample = { at: Date.now(), vSol: s.vSol, vTok: s.vTok, price };
    if (s.realTok !== undefined) { sample.realTok = s.realTok; sample.realSol = s.realSol; t.realTok = s.realTok; t.realSol = s.realSol; t.progress = Math.max(0, Math.min(100, (1 - s.realTok / (INITIAL_REAL_TOKENS * (s.supply ? s.supply / 1e9 : 1))) * 100)); }
    if (s.complete !== undefined) t.complete = s.complete;
    t.samples.push(sample); if (t.samples.length > 120) t.samples.shift();
    t.vSol = s.vSol; t.vTok = s.vTok; t.price = price; t.mcapSol = price * 1e9;
    if (price > t.peak) t.peak = price;
    if (t.firstPrice === undefined) t.firstPrice = price;
    this.emit('sample', t);
  }

  // price change over the last `ms` milliseconds (fraction), null if insufficient data
  momentum(t, ms) {
    const s = t.samples; if (s.length < 2) return null;
    const now = s[s.length - 1]; const cutoff = now.at - ms;
    let base = null; for (const x of s) { if (x.at <= cutoff) base = x; else break; }
    if (!base) base = s[0];
    if (now.at - base.at < ms * 0.5) return null;
    return now.price / base.price - 1;
  }

  async refreshSol() {
    try {
      const j = await fetchJson('https://lite-api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112');
      const p = j['So11111111111111111111111111111111111111112']?.usdPrice; if (p) { this.solUsd = p; this.solUsdAt = Date.now(); return; }
    } catch {}
    try { const j = await fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'); if (j.solana?.usd) { this.solUsd = j.solana.usd; this.solUsdAt = Date.now(); } } catch {}
  }

  async jupPriceSol(mint) { // for graduated tokens
    try { const j = await fetchJson(`https://lite-api.jup.ag/price/v3?ids=${mint}`); const p = j[mint]?.usdPrice; return p && this.solUsd ? p / this.solUsd : null; } catch { return null; }
  }

  async pollLists() {
    const lists = [
      ['live', 'https://frontend-api-v3.pump.fun/coins/currently-live?limit=50&offset=0&includeNsfw=false'],
      ['active', 'https://frontend-api-v3.pump.fun/coins?offset=0&limit=50&sort=last_trade_timestamp&order=DESC&includeNsfw=false&complete=false'],
    ];
    for (const [src, url] of lists) {
      try {
        const arr = await fetchJson(url); if (!Array.isArray(arr)) continue;
        this.stats.apiLists++; this.stats.lastApiAt = Date.now();
        for (const c of arr) {
          if (!c.mint || c.complete || !c.bonding_curve || c.program && c.program !== 'pump') continue;
          const t = this.ensure(c.mint, {
            symbol: (c.symbol || '?').trim().slice(0, 14), name: c.name, creator: c.creator, curveKey: c.bonding_curve,
            createdAt: c.created_timestamp || undefined, image: c.image_uri || undefined, twitter: c.twitter || undefined,
            isLive: !!c.is_currently_live, vol1hUsd: c.volume_1h_usd || 0, replies: c.reply_count || 0,
            apiSeenAt: Date.now(), pool: 'pump',
          });
          if (!t.source) t.source = src; else if (src === 'live') t.source = 'live';
        }
      } catch { /* list endpoint down: keep going with ws data */ }
    }
  }

  watchList() {
    const now = Date.now();
    const arr = [...this.tokens.values()].filter(t => t.curveKey && !t.complete && (this.pinned.has(t.mint) || now - (t.apiSeenAt || t.firstSeenAt) < 20 * 60000));
    arr.sort((a, b) => (this.pinned.has(b.mint) - this.pinned.has(a.mint)) || ((b.apiSeenAt || b.firstSeenAt) - (a.apiSeenAt || a.firstSeenAt)));
    return arr.slice(0, cfg.WATCH_MAX);
  }

  async pollCurves() {
    if (this._polling && Date.now() - this._pollStart < 30000) return; this._polling = true; this._pollStart = Date.now();
    try {
      const list = this.watchList();
      for (let i = 0; i < list.length; i += 100) {
        const chunk = list.slice(i, i + 100);
        let res;
        try { res = await this.conn.getMultipleAccountsInfo(chunk.map(t => new PublicKey(t.curveKey))); }
        catch (e) { this.stats.rpcErrors++; continue; }
        res.forEach((acc, k) => {
          if (!acc) return; const c = decodeCurve(acc.data.toString('base64')); if (!c) return;
          const t = chunk[k];
          const wasComplete = t.complete;
          this.addSample(t, c);
          if (c.complete && !wasComplete) this.emit('migrate', t);
        });
      }
      this.stats.curvePolls++; this.stats.lastPollAt = Date.now();
      this.emit('tick');
    } finally { this._polling = false; }
  }

  prune() {
    const now = Date.now();
    for (const [m, t] of this.tokens) if (!this.pinned.has(m) && now - (t.apiSeenAt || t.firstSeenAt) > 45 * 60000) this.tokens.delete(m);
  }

  async devHoldingPct(mint, owner) {
    try {
      const r = await this.conn.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) });
      let amt = 0; for (const a of r.value) amt += a.account.data.parsed.info.tokenAmount.uiAmount || 0;
      return amt / 1e9 * 100;
    } catch { return null; }
  }

  async imageFor(t) {
    if (t.image || !t.uri) return t.image;
    try { const j = await fetchJson(t.uri, {}, 4000); if (j.image) t.image = j.image; if (j.twitter) t.twitter = j.twitter; } catch {}
    return t.image;
  }
}

module.exports = { Market, fetchJson, decodeCurve };
