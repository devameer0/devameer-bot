// Lightweight price-tick recorder for watched and traded coins.
// In-memory first, flushed to SQLite/Postgres in batches. Caps keep the free plan small.
const store = require('./db');

const MAX_MEM = 400;
const MAX_DB_PER_MINT = 300;
const MAX_COINS = 120;
const FLUSH_MS = 15000;

function downsample(ticks, max) {
  if (!ticks || ticks.length <= max) return ticks || [];
  const out = [], step = (ticks.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(ticks[Math.round(i * step)]);
  return out;
}

function statsOf(s) {
  if (!s || !s.firstPrice) return null;
  return {
    mint: s.mint, symbol: s.symbol || '', name: s.name || '', image: s.image || null,
    firstSeenAt: s.firstSeenAt, lastAt: s.lastAt,
    firstPrice: s.firstPrice, peakPrice: s.peakPrice, troughPrice: s.troughPrice, lastPrice: s.lastPrice,
    pumpPct: s.firstPrice ? s.peakPrice / s.firstPrice - 1 : 0,
    dumpPct: s.firstPrice ? s.troughPrice / s.firstPrice - 1 : 0,
    traded: !!s.traded,
  };
}

class TickStore {
  constructor() {
    this.mem = new Map();
    this.traded = new Set();
    this._flushing = false;
  }

  async init(market, engine) {
    this.market = market;
    this.engine = engine;
    const db = store.get();
    for (const t of engine.trades || []) this.markTraded(t.mint);
    market.on('sample', (t) => this.record(t, market.pinned.has(t.mint) || this.traded.has(t.mint)));
    market.on('tick', () => {
      for (const t of market.tokens.values()) {
        if (market.pinned.has(t.mint) || this.traded.has(t.mint) || t.price) this.record(t, market.pinned.has(t.mint) || this.traded.has(t.mint));
      }
    });
    this._timer = setInterval(() => this.flush().catch(() => {}), FLUSH_MS);
    // load compact stats so history survives a soft restart with disk
    try {
      const rows = await db.listCoinStats();
      for (const r of rows) {
        if (!this.mem.has(r.mint)) this.mem.set(r.mint, { ticks: [], dirty: [], ...r, firstSeenAt: r.firstSeenAt, firstPrice: r.firstPrice, peakPrice: r.peakPrice, troughPrice: r.troughPrice, lastPrice: r.lastPrice, lastAt: r.lastAt, symbol: r.symbol, name: r.name, image: r.image, traded: r.traded });
        if (r.traded) this.traded.add(r.mint);
      }
    } catch { /* schema may be mid-init */ }
    return this;
  }

  markTraded(mint) { if (mint) this.traded.add(mint); }

  record(t, important) {
    if (!t || !t.mint || !t.price || !Number.isFinite(t.price)) return;
    let s = this.mem.get(t.mint);
    if (!s) {
      if (this.mem.size >= MAX_COINS && !important) return;
      s = { mint: t.mint, ticks: [], dirty: [], firstSeenAt: t.firstSeenAt || Date.now(), firstPrice: t.firstPrice || t.price, peakPrice: t.price, troughPrice: t.price, lastPrice: t.price, lastAt: Date.now(), symbol: t.symbol, name: t.name, image: t.image, traded: this.traded.has(t.mint) };
      this.mem.set(t.mint, s);
    }
    if (t.symbol) s.symbol = t.symbol;
    if (t.name) s.name = t.name;
    if (t.image) s.image = t.image;
    if (this.traded.has(t.mint)) s.traded = true;
    if (t.price > s.peakPrice) s.peakPrice = t.price;
    if (t.price < s.troughPrice) s.troughPrice = t.price;
    s.lastPrice = t.price; s.lastAt = Date.now();
    const last = s.ticks[s.ticks.length - 1];
    const dt = last ? s.lastAt - last.t : Infinity;
    const chg = last ? Math.abs(t.price / last.price - 1) : 1;
    const minDt = important ? 2500 : 8000;
    const minChg = important ? 0.002 : 0.005;
    if (last && dt < minDt && chg < minChg) return;
    const tick = { t: s.lastAt, price: t.price, mcapSol: t.mcapSol != null ? t.mcapSol : t.price * 1e9 };
    s.ticks.push(tick); s.dirty.push(tick);
    if (s.ticks.length > MAX_MEM) s.ticks.splice(0, s.ticks.length - MAX_MEM);
  }

  async flush() {
    if (this._flushing) return;
    const db = store.get();
    if (!db || !db.saveTicks) return;
    const batch = [];
    const stats = [];
    for (const s of this.mem.values()) {
      if (s.dirty.length) { batch.push(...s.dirty.splice(0, s.dirty.length).map((x) => ({ mint: s.mint, ...x }))); }
      stats.push(statsOf(s));
    }
    if (!batch.length && !stats.length) return;
    this._flushing = true;
    try {
      if (batch.length) await db.saveTicks(batch);
      if (stats.length) await db.saveCoinStats(stats.filter(Boolean));
      for (const mint of this.mem.keys()) await db.capTicks(mint, MAX_DB_PER_MINT);
    } catch { /* keep memory; try again next flush */ }
    finally { this._flushing = false; }
  }

  async ticksFor(mint, opts = {}) {
    const s = this.mem.get(mint);
    let ticks = s && s.ticks.length ? s.ticks.slice() : [];
    if (ticks.length < 8) {
      try {
        const db = store.get();
        if (db && db.listTicks) {
          const fromDb = await db.listTicks(mint, opts.from || 0, opts.to || Date.now() + 1000, MAX_DB_PER_MINT);
          const seen = new Set(ticks.map((x) => x.t));
          for (const x of fromDb) if (!seen.has(x.t)) ticks.push(x);
          ticks.sort((a, b) => a.t - b.t);
        }
      } catch {}
    }
    if (opts.from) ticks = ticks.filter((x) => x.t >= opts.from);
    if (opts.to) ticks = ticks.filter((x) => x.t <= opts.to);
    return downsample(ticks, opts.max || 120);
  }

  history(limit = 40) {
    const rows = [...this.mem.values()].map(statsOf).filter(Boolean)
      .filter((r) => r.traded || Math.abs(r.pumpPct) >= 0.03 || Math.abs(r.dumpPct) >= 0.03);
    rows.sort((a, b) => (b.traded - a.traded) || (Math.abs(b.pumpPct) - Math.abs(a.pumpPct)));
    return rows.slice(0, limit);
  }

  async forTrade(t, max = 80) {
    if (!t || !t.mint) return { ticks: [], pumpPct: null, dumpPct: null, holdPumpPct: null, holdDumpPct: null };
    const pad = 3 * 60000;
    const from = (t.openedAt || Date.now()) - pad;
    const to = (t.closedAt || Date.now()) + pad;
    const ticks = await this.ticksFor(t.mint, { from, to, max });
    const s = this.mem.get(t.mint);
    const hold = ticks.filter((x) => x.t >= (t.openedAt || 0) && x.t <= (t.closedAt || Date.now()));
    const prices = hold.length ? hold.map((x) => x.price) : [];
    const entry = t.curvePriceAtEntry || t.entryPrice || (hold[0] && hold[0].price);
    const peak = prices.length ? Math.max(...prices) : null;
    const trough = prices.length ? Math.min(...prices) : null;
    return {
      ticks,
      pumpPct: s ? s.peakPrice / s.firstPrice - 1 : null,
      dumpPct: s ? s.troughPrice / s.firstPrice - 1 : null,
      holdPumpPct: entry && peak ? peak / entry - 1 : null,
      holdDumpPct: entry && trough ? trough / entry - 1 : null,
    };
  }
}

const ticks = new TickStore();
module.exports = ticks;
