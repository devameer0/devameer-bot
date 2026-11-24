// Strategy engine: 4 agents, rug filters, exits, risk limits, goal + withdraw.
const crypto = require('crypto');
const cfg = require('./config');
const store = require('./db');
const ticks = require('./ticks');
const flow = require('./flow');

const AGENTS = {
  scout:    { name: 'Scout',    color: '#EF4444', tp: 0.40, sl: 0.20, maxHoldMs: 10 * 60000, desc: 'social hype: live-streamed or X-linked tokens with real 1h volume and rising price' },
  sniper:   { name: 'Sniper',   color: '#3B82F6', tp: 0.60, sl: 0.25, maxHoldMs: 3 * 60000,  desc: 'fresh launches (<60s old) that pass rug filters and show first organic buys' },
  curve:    { name: 'Curve',    color: '#22C55E', tp: 0.30, sl: 0.15, maxHoldMs: 8 * 60000,  desc: 'tokens 30-75% through the bonding curve with +8% momentum over 60s' },
  graduate: { name: 'Graduate', color: '#A855F7', tp: 0.25, sl: 0.12, maxHoldMs: 10 * 60000, desc: 'tokens 85-97% through the curve, still climbing, close to graduating' },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dayKey = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
const $ = (t) => '$' + (t.symbol || '?').replace(/^\$/, '').toUpperCase();

class Engine {
  constructor(market, trader) {
    this.market = market; this.trader = trader;
    this.trades = [];           // all trades (open + closed)
    this.logs = []; this.logSeq = 0;
    this.events = []; this.evSeq = 0;
    this.running = false; this.goalHold = false; this.busy = new Set();
    this.lastBuyAt = 0; this.rugCreators = new Set(); this.tried = new Set();
    this.withdrawals = [];
  }

  async init() {
    const db = store.get();
    const resetAt = (await db.get('paperResetAt')) || 0;
    this.trades = (await db.listTrades()).filter(t => !t.paper || t.openedAt > resetAt);
    this.withdrawals = (await db.get('withdrawals')) || [];
    this.rugCreators = new Set((await db.get('rugCreators')) || []);
    const s = (await db.get('settings')) || {};
    this.settings = this.clampSettings({
      tradeSize: cfg.TRADE_SIZE_SOL, slippage: cfg.SLIPPAGE_PCT, priorityFee: cfg.PRIORITY_FEE_SOL,
      goal: cfg.GOAL_MULTIPLE, agents: { scout: true, sniper: true, curve: true, graduate: true }, ...s,
    });
    this.stack = await db.get(this.modeKey('stack'));
    this.goalDone = (await db.get(this.modeKey('goalDone'))) || false;
    for (const t of this.trades) this.tried.add(t.mint);
    // re-pin open positions after restart
    for (const p of this.open()) { this.market.ensure(p.mint, { symbol: p.symbol, curveKey: p.curveKey, creator: p.creator, image: p.image }); this.market.pinned.add(p.mint); }
    this.market.on('tick', () => this.onTick().catch(e => this.log('engine error: ' + e.message, 'err')));
    this.market.on('migrate', (t) => { if (this.open().some(p => p.mint === t.mint)) this.log(`${$(t)} graduated -> tracking on pump-amm`, 'info'); });
    this.market.on('newToken', (t) => this.onNewToken(t));
    this.log(`online · paused · ${this.mode.toLowerCase()} mode`, 'info');
    setInterval(() => this.trackRugs(), 15000);
    setInterval(() => this.refreshGradPrices(), 10000);
  }

  modeKey(k) { return `${this.trader.live ? 'live' : 'paper'}:${k}`; }
  get mode() { return this.trader.live ? 'LIVE' : 'PAPER'; }

  clampSettings(s) {
    return {
      tradeSize: clamp(+s.tradeSize || cfg.TRADE_SIZE_SOL, 0.001, cfg.MAX_SOL_PER_TRADE),
      slippage: clamp(+s.slippage || cfg.SLIPPAGE_PCT, 1, cfg.MAX_SLIPPAGE_PCT),
      priorityFee: clamp(+s.priorityFee || cfg.PRIORITY_FEE_SOL, 0, cfg.MAX_PRIORITY_FEE_SOL),
      goal: clamp(+s.goal || cfg.GOAL_MULTIPLE, 1.1, 100),
      agents: { scout: true, sniper: true, curve: true, graduate: true, ...(s.agents || {}) },
    };
  }
  async saveSettings(s) { this.settings = this.clampSettings({ ...this.settings, ...s, agents: { ...this.settings.agents, ...(s.agents || {}) } }); await store.get().set('settings', this.settings); }

  log(text, kind = 'info', extra = {}) {
    const l = { id: ++this.logSeq, at: Date.now(), text, kind, ...extra };
    this.logs.push(l); if (this.logs.length > 300) this.logs.shift();
    console.log(`[${this.mode}] ${text}`);
    return l;
  }
  event(type, data) { const e = { id: ++this.evSeq, at: Date.now(), type, ...data }; this.events.push(e); if (this.events.length > 100) this.events.shift(); return e; }

  myTrades() { const live = this.trader.live; return this.trades.filter(t => !!t.paper === !live); }
  open() { return this.myTrades().filter(t => t.status === 'open'); }
  closed() { return this.myTrades().filter(t => t.status === 'closed'); }

  realizedToday() { const d = dayKey(); return this.closed().filter(t => dayKey(t.closedAt) === d).reduce((s, t) => s + t.pnlSol, 0); }
  dailyLossHit() { return this.realizedToday() <= -cfg.DAILY_LOSS_LIMIT_SOL; }

  posValue(p) {
    const t = this.market.tokens.get(p.mint);
    if (!t || !t.price) return null;
    return this.trader.quoteSell(t, p.tokens) - this.settings.priorityFee;
  }

  summary() {
    const closed = this.closed(), open = this.open();
    const realized = closed.reduce((s, t) => s + t.pnlSol, 0);
    let unreal = 0; for (const p of open) { const v = this.posValue(p); const cur = v != null ? v : p.lastValue; if (cur != null) unreal += cur - p.costSol; }
    const wins = closed.filter(t => t.pnlSol > 0).length;
    const stack = this.stack || (this.trader.live ? null : cfg.PAPER_STACK_SOL);
    const withdrawn = this.withdrawals.filter(w => !!w.paper === !this.trader.live).reduce((s, w) => s + w.sol, 0);
    const pnl = realized + unreal;
    const mult = stack ? (stack + pnl) / stack : 1;
    const byAgent = {}; for (const k of Object.keys(AGENTS)) byAgent[k] = 0;
    for (const t of closed) byAgent[t.agent] = (byAgent[t.agent] || 0) + t.pnlSol;
    return { realized, unreal, pnl, wins, count: closed.length, winRate: closed.length ? wins / closed.length : 0, stack, mult, byAgent, withdrawn, open: open.length, today: this.realizedToday() };
  }

  // ------------------------------------------------------------------ control
  async start() {
    if (this.running) return;
    if (!this.stack) {
      if (this.trader.live) { const b = await this.trader.balanceSol(); if (!b || b < 0.01) throw new Error('wallet balance too low to start (need > 0.01 SOL)'); this.stack = b; }
      else this.stack = cfg.PAPER_STACK_SOL;
      await store.get().set(this.modeKey('stack'), this.stack);
    }
    this.running = true;
    try { await store.get().set(this.modeKey('running'), true); } catch {}
    this.log(`up, scanning pump.fun + X`, 'info');
    flow.emit({ node: 'risk', type: 'status', ok: true, message: 'scanning started' });
    const usd = this.stack * (this.market.solUsd || 0);
    this.event('banner', { title: `${cfg.BOT_NAME} started`, body: `4 agents · pump.fun · stack ${usd ? '$' + Math.round(usd).toLocaleString() : this.stack.toFixed(3) + ' SOL'}${this.trader.live ? '' : ' (paper)'}` });
  }

  async stop(sellAll) {
    this.running = false;
    try { await store.get().set(this.modeKey('running'), false); } catch {}
    this.log(sellAll ? 'stopping. selling all open positions' : 'paused. open positions still managed by exits', 'info');
    flow.emit({ node: 'risk', type: 'status', message: sellAll ? 'stopped — selling open positions' : 'paused — exits still active' });
    if (sellAll) for (const p of this.open()) await this.exit(p, 'manual stop');
  }

  async resumeIfNeeded() {
    try {
      const want = await store.get().get(this.modeKey('running'));
      if (want && !this.running) await this.start();
    } catch (e) { this.log('resume skipped: ' + e.message, 'err'); }
  }

  async keepGoing() {
    this.goalHold = false; this.goalDone = true; await store.get().set(this.modeKey('goalDone'), true);
    this.log('keeping going. new buys back on', 'info');
  }

  async resetPaper() {
    if (this.trader.live) throw new Error('reset only allowed in paper mode');
    for (const t of this.trades) if (t.paper && t.status === 'open') { t.status = 'closed'; t.closedAt = Date.now(); t.pnlSol = 0; t.exitReason = 'reset'; }
    this.trades = this.trades.filter(t => !t.paper);
    const db = store.get();
    // rewrite: mark paper trades deleted by flagging
    await db.set('paper:stack', null); await db.set('paper:goalDone', false); await db.set('paperResetAt', Date.now());
    this.withdrawals = this.withdrawals.filter(w => !w.paper); await db.set('withdrawals', this.withdrawals);
    this.stack = null; this.goalDone = false; this.goalHold = false; this.running = false;
    try { await store.get().set(this.modeKey('running'), false); } catch {}
    this.log('paper stats reset', 'info');
  }

  async withdraw(sol) {
    const s = this.summary();
    if (this.trader.live) {
      const bal = await this.trader.balanceSol();
      const max = Math.max(0, (bal || 0) - cfg.WITHDRAW_RESERVE_SOL);
      if (!(sol > 0) || sol > max) throw new Error(`amount must be between 0 and ${max.toFixed(4)} SOL (keeps ${cfg.WITHDRAW_RESERVE_SOL} SOL for fees)`);
    } else if (!(sol > 0)) throw new Error('amount must be > 0');
    const r = await this.trader.withdraw(sol);
    const w = { id: crypto.randomUUID(), at: Date.now(), sol, paper: r.paper, sig: r.sig, to: cfg.WITHDRAW_ADDRESS || null };
    this.withdrawals.push(w); await store.get().set('withdrawals', this.withdrawals);
    const usd = sol * this.market.solUsd;
    this.log(`sent ${usd ? '$' + usd.toFixed(2) : sol.toFixed(4) + ' SOL'} to your Phantom${r.paper ? ' (paper, no real transfer)' : ''}`, 'withdraw', { sig: r.sig });
    this.event('banner', { title: `Withdrawn: +${usd ? '$' + usd.toFixed(2) : sol.toFixed(4) + ' SOL'}`, body: `sent to Phantom · ${sol.toFixed(4)} SOL${r.paper ? ' · paper' : ''}` });
    this.event('withdrawn', { sol });
    flow.emit({ node: 'withdraw', type: 'withdraw', ok: true, message: `withdraw ${sol.toFixed(4)} SOL${r.paper ? ' (paper)' : ''}`, data: { sol, paper: r.paper } });
    flow.emit({ node: 'db', type: 'write', from: 'withdraw', ok: true, message: 'saved withdrawal record' });
    return w;
  }

  // ------------------------------------------------------------------ market reactions
  onNewToken(t) {
    if (t.mayhem) return; // mayhem-mode tokens have a non-standard curve + AI trader; ignore
    if (!this.running || !this.settings.agents.sniper) return;
    // filters that are knowable at creation
    if (t.devPct > cfg.MAX_DEV_PCT) { if (Math.random() < 0.25) this.log(`skipped ${$(t)} - dev holds ${Math.round(t.devPct)}%`, 'skip'); this.tried.add(t.mint); flow.emit({ node: 'rugs', type: 'reject', ok: false, mint: t.mint, symbol: t.symbol, agent: 'sniper', from: 'feed', message: `rejected ${$(t)} — dev holds ${Math.round(t.devPct)}%`, data: { reason: 'dev holdings', devPct: t.devPct } }); }
    else if (this.rugCreators.has(t.creator)) { this.log(`skipped ${$(t)} - same dev as a rug`, 'skip'); this.tried.add(t.mint); flow.emit({ node: 'rugs', type: 'reject', ok: false, mint: t.mint, symbol: t.symbol, agent: 'sniper', from: 'feed', message: `rejected ${$(t)} — same dev as a rug`, data: { reason: 'prior rug' } }); }
  }

  trackRugs() {
    for (const t of this.market.tokens.values()) {
      if (!t.creator || this.rugCreators.has(t.creator) || !t.firstPrice || !t.peak || !t.price) continue;
      if (t.peak > t.firstPrice * 1.5 && t.price < t.peak * 0.2) {
        this.rugCreators.add(t.creator);
        flow.emit({ node: 'rugs', type: 'alert', mint: t.mint, symbol: t.symbol, message: `${$(t)} dumped after a pump — prior-rug creator marked` });
        if (this.rugCreators.size % 5 === 1) store.get().set('rugCreators', [...this.rugCreators].slice(-2000));
      }
    }
  }

  async refreshGradPrices() {
    for (const p of this.open()) {
      const t = this.market.tokens.get(p.mint);
      if (t && t.complete) { const px = await this.market.jupPriceSol(p.mint); if (px) { t.gradPrice = px; t.price = px; } }
    }
  }

  candidates() {
    const now = Date.now(); const out = [];
    const s = this.settings.agents;
    for (const t of this.market.tokens.values()) {
      if (this.tried.has(t.mint) || t.complete || t.mayhem || !t.price || t.samples.length < 2) continue;
      const age = now - (t.createdAt || t.firstSeenAt);
      const m30 = this.market.momentum(t, 30000), m60 = this.market.momentum(t, 60000);
      const prog = t.progress ?? null;
      const last = t.samples[t.samples.length - 1], prev = t.samples[t.samples.length - 2];
      const ticking = last.price >= prev.price;
      if (s.sniper && t.source === 'new' && age < 60000 && t.samples.length >= 2) {
        const solIn = t.vSol - t.samples[0].vSol; // SOL added after creation
        if (solIn >= 0.5 && ticking) out.push({ t, agent: 'sniper', why: `sniping ${$(t)} at launch (+${Math.round(age / 1000)}s)` });
      }
      if (prog === null) continue;
      if (s.graduate && prog >= 85 && prog <= 97 && m30 !== null && m30 > 0.02 && ticking) out.push({ t, agent: 'graduate', why: `${$(t)} about to graduate -> in` });
      else if (s.curve && prog >= 30 && prog <= 75 && m60 !== null && m60 > 0.08 && ticking && age > 120000) out.push({ t, agent: 'curve', why: `${$(t)} on the curve -> riding it` });
      else if (s.scout && (t.isLive || t.twitter) && t.vol1hUsd >= 5000 && prog >= 10 && prog <= 80 && m30 !== null && m30 > 0.03 && ticking) out.push({ t, agent: 'scout', why: `${t.isLive ? 'live stream' : 'X'} hype on ${$(t)} -> buying` });
    }
    const pri = { graduate: 0, sniper: 1, curve: 2, scout: 3 };
    return out.sort((a, b) => pri[a.agent] - pri[b.agent]);
  }

  async rugCheck(t, agent) {
    if ((t.realSol ?? t.vSol - 30) < cfg.MIN_LIQ_SOL && agent !== 'sniper') return `liquidity ${(t.realSol || 0).toFixed(1)} SOL`;
    if (this.rugCreators.has(t.creator)) return 'same dev as a rug';
    if (agent === 'sniper') {
      // bundle heuristic: supply bought by non-dev wallets within the first poll window after launch
      const first = t.samples[0]; const soldNow = (1073000000 - t.vTok);
      const nonDev = soldNow - (t.devTokens || 0);
      if (Date.now() - t.createdAt < 15000 && nonDev / 1e9 * 100 > cfg.MAX_BUNDLE_PCT) return `${Math.round(nonDev / 1e7)}% bundled`;
      if (t.devPct > cfg.MAX_DEV_PCT) return `dev holds ${Math.round(t.devPct)}%`;
      void first;
    }
    if (t.creator) {
      const pct = await this.market.devHoldingPct(t.mint, t.creator);
      if (pct !== null && pct > cfg.MAX_DEV_PCT) return `dev holds ${Math.round(pct)}%`;
    }
    return null;
  }

  async onTick() {
    // exits first
    const openN = this.open().length;
    if (openN) flow.emit({ node: 'monitor', type: 'tick', from: 'rpc', message: `monitoring ${openN} open position${openN === 1 ? '' : 's'}`, data: { open: openN } });
    for (const p of this.open()) await this.checkExit(p);
    if (!this.running) return;
    const s = this.summary();
    if (!this.goalDone && !this.goalHold && s.stack && s.mult >= this.settings.goal) {
      this.goalHold = true;
      this.log(`goal ${this.settings.goal}x done. keep going?`, 'goal');
      this.event('banner', { title: `Goal reached: ${this.settings.goal}x`, body: `${s.mult.toFixed(2)}x · ${s.count} trades · ${Math.round(s.winRate * 100)}% win` });
      this.event('confetti', {});
      flow.emit({ node: 'risk', type: 'reject', ok: false, message: `goal ${this.settings.goal}x reached — new buys on hold` });
    }
    if (this._lossLogged && this._lossLogged !== dayKey()) this._lossLogged = null;
    let skipBuys = null;
    if (this.goalHold) skipBuys = 'goal hold';
    else if (this.dailyLossHit()) {
      if (!this._lossLogged) {
        this.log(`daily loss limit ${cfg.DAILY_LOSS_LIMIT_SOL} SOL hit. no new buys today — still scanning`, 'err');
        this._lossLogged = dayKey();
        flow.emit({ node: 'risk', type: 'reject', ok: false, message: 'skipped: daily cap — still scanning', data: { reason: 'daily cap' }, status: { dailyLossHit: true } });
        flow.emit({ node: 'errors', type: 'error', from: 'risk', ok: false, message: 'skipped: daily cap — no new buys, scanner stays on' });
      }
      skipBuys = 'daily cap';
    } else if (this.open().length + this.busy.size >= cfg.MAX_OPEN_POSITIONS) {
      skipBuys = 'max open positions';
    }
    // Keep evaluating live candidates even when buys are capped so the flow
    // canvas shows real coins and reasons instead of going idle.
    if (!skipBuys && Date.now() - this.lastBuyAt < 5000) return;
    const cand = this.candidates();
    if (skipBuys && !cand.length) {
      if (!this._skipPulse || Date.now() - this._skipPulse > 15000) {
        this._skipPulse = Date.now();
        const msg = skipBuys === 'daily cap' ? 'skipped: daily cap — scanning, no candidates yet' : `scanning · skipped: ${skipBuys}`;
        flow.emit({ node: 'risk', type: 'status', ok: true, message: msg, data: { reason: skipBuys }, status: skipBuys === 'daily cap' ? { dailyLossHit: true } : skipBuys === 'goal hold' ? { goalHold: true } : undefined });
      }
      return;
    }
    for (const c of cand) {
      flow.emit({ node: c.agent, type: 'candidate', mint: c.t.mint, symbol: c.t.symbol, agent: c.agent, from: 'rpc', message: c.why });
      const bad = await this.rugCheck(c.t, c.agent);
      if (bad) {
        this.tried.add(c.t.mint);
        this.log(`skipped ${$(c.t)} - ${bad}`, 'skip');
        flow.emit({ node: 'rugs', type: 'reject', ok: false, mint: c.t.mint, symbol: c.t.symbol, agent: c.agent, from: c.agent, message: `rejected ${$(c.t)} — ${bad}`, data: { reason: bad } });
        flow.emit({ node: 'errors', type: 'reject', from: 'rugs', ok: false, mint: c.t.mint, symbol: c.t.symbol, agent: c.agent, message: `skipped ${$(c.t)} — ${bad}` });
        continue;
      }
      flow.emit({ node: 'rugs', type: 'pass', ok: true, mint: c.t.mint, symbol: c.t.symbol, agent: c.agent, from: c.agent, message: `passed rug filters · ${$(c.t)}` });
      if (skipBuys) {
        const label = skipBuys === 'daily cap' ? 'skipped: daily cap' : `skipped: ${skipBuys}`;
        flow.emit({
          node: 'risk', type: 'reject', ok: false, mint: c.t.mint, symbol: c.t.symbol, agent: c.agent, from: 'rugs',
          message: `${label} · ${$(c.t)}`,
          data: { reason: skipBuys, dailyLossLimitSol: skipBuys === 'daily cap' ? cfg.DAILY_LOSS_LIMIT_SOL : undefined, maxOpen: cfg.MAX_OPEN_POSITIONS },
          status: skipBuys === 'daily cap' ? { dailyLossHit: true } : skipBuys === 'goal hold' ? { goalHold: true } : undefined,
        });
        break;
      }
      flow.emit({ node: 'risk', type: 'pass', ok: true, mint: c.t.mint, symbol: c.t.symbol, agent: c.agent, from: c.agent, message: `risk cleared for ${$(c.t)}` });
      await this.enter(c);
      break; // one entry per tick
    }
  }

  async enter({ t, agent, why }) {
    const size = this.settings.tradeSize;
    if (this.trader.live) { const b = await this.trader.balanceSol(); if (b === null || b < size + 0.01) { this.log(`skipped ${$(t)} - wallet balance too low`, 'err'); flow.emit({ node: 'risk', type: 'reject', ok: false, mint: t.mint, symbol: t.symbol, agent, message: `skipped ${$(t)} — wallet balance too low` }); flow.emit({ node: 'errors', type: 'error', from: 'risk', ok: false, message: 'wallet balance too low for buy' }); return; } }
    this.busy.add(t.mint); this.lastBuyAt = Date.now();
    try {
      this.log(why, agent);
      flow.emit({ node: 'buy', type: 'buy', mint: t.mint, symbol: t.symbol, agent, from: 'risk', message: `buying ${$(t)} · ${size} SOL`, data: { sizeSol: size, paper: !this.trader.live } });
      const priceAtEntry = t.price;
      const r = await this.trader.buy(t, size, this.settings);
      await this.market.imageFor(t);
      const p = {
        id: crypto.randomUUID(), mint: t.mint, symbol: t.symbol, name: t.name || '', image: t.image || null, curveKey: t.curveKey, creator: t.creator,
        agent, status: 'open', paper: r.paper, openedAt: Date.now(), sizeSol: size, costSol: r.costSol, tokens: r.tokens,
        entryPrice: r.costSol / r.tokens, curvePriceAtEntry: priceAtEntry, entryMcapSol: (priceAtEntry || 0) * 1e9, buySig: r.sig, peakValue: r.costSol,
      };
      this.trades.push(p); this.market.pinned.add(t.mint); this.market.subscribeTrades([t.mint]); ticks.markTraded(t.mint); ticks.record(t, true);
      await store.get().saveTrade(p);
      await this.persistSnapshot();
      flow.emit({ node: 'buy', type: 'buy', ok: true, mint: t.mint, symbol: t.symbol, agent, from: 'risk', message: `bought ${$(t)} · ${r.costSol.toFixed(4)} SOL`, data: { costSol: r.costSol, tokens: r.tokens, paper: r.paper } });
      flow.emit({ node: 'db', type: 'write', ok: true, mint: t.mint, symbol: t.symbol, agent, from: 'buy', message: `saved open trade ${$(t)}` });
      flow.emit({ node: 'monitor', type: 'open', mint: t.mint, symbol: t.symbol, agent, from: 'buy', message: `now tracking ${$(t)}` });
    } catch (e) { this.log(`buy ${$(t)} failed: ${e.message}`, 'err'); flow.emit({ node: 'buy', type: 'error', ok: false, mint: t.mint, symbol: t.symbol, agent, message: `buy ${$(t)} failed: ${e.message}` }); flow.emit({ node: 'errors', type: 'error', from: 'buy', ok: false, mint: t.mint, symbol: t.symbol, agent, message: `buy ${$(t)} failed: ${e.message}` }); }
    finally { this.busy.delete(t.mint); }
  }

  async checkExit(p) {
    if (this.busy.has(p.id)) return;
    const v = this.posValue(p); if (v === null) return;
    const ret = v / p.costSol - 1; const a = AGENTS[p.agent];
    p.lastValue = v; p.peakValue = Math.max(p.peakValue || 0, v);
    let reason = null;
    if (ret >= a.tp) reason = `take profit +${Math.round(ret * 100)}%`;
    else if (ret <= -a.sl) reason = `stop loss ${Math.round(ret * 100)}%`;
    else if (Date.now() - p.openedAt > a.maxHoldMs) reason = `max hold ${Math.round(a.maxHoldMs / 60000)}m`;
    if (reason) {
      flow.emit({ node: 'exits', type: 'exit', mint: p.mint, symbol: p.symbol, agent: p.agent, from: 'monitor', message: `${$(p)} · ${reason}`, data: { reason, ret } });
      await this.exit(p, reason);
    }
  }

  async persistSnapshot() {
    try {
      const db = store.get();
      if (!db || !db.saveSnapshot) return;
      const s = this.summary();
      await db.saveSnapshot({ realized: s.realized, unreal: s.unreal, withdrawn: s.withdrawn, open: this.open().length, closed: this.closed().length, stack: this.stack, mode: this.mode });
    } catch { /* snapshot is best-effort */ }
  }

  async exit(p, reason) {
    if (this.busy.has(p.id) || p.status !== 'open') return;
    this.busy.add(p.id);
    const t = this.market.tokens.get(p.mint) || { mint: p.mint, symbol: p.symbol, vSol: 0, vTok: 0, price: 0 };
    try {
      const r = await this.trader.sell(t, p, this.settings);
      p.status = 'closed'; p.closedAt = Date.now(); p.proceedsSol = r.proceedsSol; p.sellSig = r.sig; p.exitReason = reason;
      p.exitPrice = t.price || (p.tokens ? r.proceedsSol / p.tokens : null); p.exitMcapSol = (t.mcapSol != null ? t.mcapSol : (p.exitPrice || 0) * 1e9);
      p.pnlSol = r.proceedsSol - p.costSol; p.pnlPct = p.pnlSol / p.costSol; p.solUsdAtClose = this.market.solUsd;
      this.market.pinned.delete(p.mint);
      await store.get().saveTrade(p);
      await this.persistSnapshot();
      const usd = p.pnlSol * (this.market.solUsd || 0);
      const amt = this.market.solUsd ? `${usd >= 0 ? '+' : '-'}$${Math.abs(usd).toFixed(2)}` : `${p.pnlSol.toFixed(4)} SOL`;
      this.log(`closed ${$(p)} ${p.pnlSol >= 0 ? '+' : ''}${Math.round(p.pnlPct * 100)}% (${amt}) · ${reason}`, p.pnlSol >= 0 ? 'win' : 'loss', { sig: r.sig });
      this.event('trade', { tradeId: p.id, symbol: p.symbol, image: p.image, pnlSol: p.pnlSol, usd, win: p.pnlSol > 0 });
      flow.emit({ node: 'sell', type: 'sell', ok: true, mint: p.mint, symbol: p.symbol, agent: p.agent, from: 'exits', message: `sold ${$(p)} ${p.pnlSol >= 0 ? '+' : ''}${Math.round(p.pnlPct * 100)}% · ${reason}`, data: { pnlSol: p.pnlSol, pnlPct: p.pnlPct, reason, paper: p.paper } });
      flow.emit({ node: 'db', type: 'write', ok: true, mint: p.mint, symbol: p.symbol, from: 'sell', message: `saved closed trade ${$(p)}` });
      flow.emit({ node: 'share', type: 'ready', mint: p.mint, symbol: p.symbol, from: 'sell', message: `share / replay ready for ${$(p)}` });
    } catch (e) { this.log(`sell ${$(p)} failed: ${e.message} (will retry)`, 'err'); flow.emit({ node: 'sell', type: 'error', ok: false, mint: p.mint, symbol: p.symbol, agent: p.agent, message: `sell ${$(p)} failed: ${e.message}` }); flow.emit({ node: 'errors', type: 'error', from: 'sell', ok: false, mint: p.mint, symbol: p.symbol, message: `sell ${$(p)} failed: ${e.message}` }); }
    finally { this.busy.delete(p.id); }
  }
}

module.exports = { Engine, AGENTS };
