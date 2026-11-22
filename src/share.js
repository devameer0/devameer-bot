// Public PNL share routes. Never expose wallet, keys, admin, withdraw, or tx signatures.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const card = require('../public/share-card.js');
const cfg = require('./config');
const { AGENTS } = require('./engine');

const FONT_DIR = path.join(__dirname, '..', 'fonts');
const FONTS = ['Inter-400.ttf', 'Inter-600.ttf', 'Inter-800.ttf', 'Inter-900.ttf']
  .map((f) => path.join(FONT_DIR, f))
  .filter((f) => fs.existsSync(f));

const IMG_HOSTS = [
  /(^|\.)pump\.fun$/i, /(^|\.)nftstorage\.link$/i, /(^|\.)ipfs\.io$/i,
  /(^|\.)arweave\.net$/i, /(^|\.)cf-ipfs\.com$/i, /(^|\.)pinata\.cloud$/i,
  /(^|\.)cloudinary\.com$/i, /(^|\.)googleusercontent\.com$/i,
  /(^|\.)supabase\.co$/i, /(^|\.)r2\.dev$/i, /^i\.imgur\.com$/i,
  /(^|\.)four\.meme$/i, /(^|\.)dexscreener\.com$/i, /(^|\.)imgix\.net$/i,
];

function publicBase(req) {
  if (cfg.PUBLIC_URL) return cfg.PUBLIC_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  return proto + '://' + req.get('host');
}

function allowedImg(u) {
  let url;
  try { url = new URL(u); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const h = url.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h === '0.0.0.0') return false;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h) || h.includes(':')) return false;
  return IMG_HOSTS.some((re) => re.test(h));
}

const imgCache = new Map();
async function fetchImage(url) {
  if (!url || !allowedImg(url)) return null;
  const hit = imgCache.get(url);
  if (hit && hit.at > Date.now() - 10 * 60000) return hit.data;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 5000);
  try {
    const r = await fetch(url, { signal: ac.signal, redirect: 'follow', headers: { 'User-Agent': 'devameer-bot-share/1' } });
    if (!r.ok) return null;
    const len = +r.headers.get('content-length') || 0;
    if (len > 2_000_000) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 2_000_000) return null;
    const mime = (r.headers.get('content-type') || '').split(';')[0].trim();
    const ok = /^image\/(png|jpe?g|webp|gif|svg\+xml)$/i.test(mime) || !mime;
    if (!ok) return null;
    const data = `data:${mime || 'image/png'};base64,${buf.toString('base64')}`;
    imgCache.set(url, { at: Date.now(), data });
    if (imgCache.size > 200) imgCache.delete(imgCache.keys().next().value);
    return data;
  } catch { return null; }
  finally { clearTimeout(t); }
}

function rangeBounds(q = {}) {
  const now = Date.now();
  const range = String(q.range || 'all').toLowerCase();
  if (range === '24h') return { range: '24h', label: '24H', from: now - 864e5, to: now };
  if (range === '7d') return { range: '7d', label: '7D', from: now - 7 * 864e5, to: now };
  if (range === '30d') return { range: '30d', label: '30D', from: now - 30 * 864e5, to: now };
  if (range === 'custom') {
    const from = Date.parse(q.from) || +q.from || 0;
    const to = Date.parse(q.to) || +q.to || now;
    if (!from || !to || to < from) throw new Error('invalid custom range');
    const end = to < 1e12 ? to + 864e5 - 1 : to;
    return { range: 'custom', label: 'CUSTOM', from, to: end };
  }
  return { range: 'all', label: 'ALL TIME', from: 0, to: now };
}

function holdMs(t, now = Date.now()) {
  if (!t.openedAt) return null;
  return (t.closedAt || now) - t.openedAt;
}

function publicTrade(engine, id) {
  const t = engine.myTrades().find((x) => x.id === id);
  if (!t) return null;
  const open = t.status === 'open';
  const proceeds = open ? (t.lastValue != null ? t.lastValue : t.costSol) : t.proceedsSol;
  const pnlSol = open ? proceeds - t.costSol : t.pnlSol;
  const pnlPct = t.costSol ? pnlSol / t.costSol : 0;
  const a = AGENTS[t.agent] || {};
  const tok = engine.market.tokens.get(t.mint);
  const entryMcap = t.entryMcapSol != null ? t.entryMcapSol : ((t.curvePriceAtEntry || t.entryPrice) ? (t.curvePriceAtEntry || t.entryPrice) * 1e9 : null);
  const exitPrice = t.exitPrice != null ? t.exitPrice : (open && tok && tok.price ? tok.price : (t.tokens ? proceeds / t.tokens : null));
  const exitMcap = t.exitMcapSol != null ? t.exitMcapSol : (open && tok && tok.mcapSol != null ? tok.mcapSol : (exitPrice ? exitPrice * 1e9 : null));
  const solUsd = t.solUsdAtClose || engine.market.solUsd || 0;
  return {
    kind: 'trade',
    id: t.id, mint: t.mint, symbol: t.symbol, name: t.name || '', image: t.image || null,
    agent: t.agent, agentName: a.name || t.agent, agentColor: a.color || '#71717A',
    status: t.status, paper: !!t.paper,
    openedAt: t.openedAt, closedAt: t.closedAt || null, holdMs: holdMs(t),
    costSol: t.costSol, proceedsSol: proceeds, pnlSol, pnlPct, pnlUsd: pnlSol * solUsd,
    entryPrice: t.entryPrice || null, exitPrice, entryMcapSol: entryMcap, exitMcapSol: exitMcap,
    solUsd, exitReason: t.exitReason || (open ? 'open position' : ''),
    botName: cfg.BOT_NAME, badge: cfg.BADGE,
  };
}

function publicAccount(engine, q = {}) {
  const b = rangeBounds(q);
  const closedAll = engine.closed();
  const closed = closedAll.filter((t) => t.closedAt >= b.from && t.closedAt <= b.to);
  const includeOpen = b.to >= Date.now() - 2000;
  const open = includeOpen ? engine.open() : [];
  let realized = 0; for (const t of closed) realized += t.pnlSol;
  let unreal = 0;
  for (const p of open) { const v = engine.posValue(p); const cur = v != null ? v : p.lastValue; if (cur != null) unreal += cur - p.costSol; }
  const pnlSol = realized + unreal;
  const wins = closed.filter((t) => t.pnlSol > 0).length;
  const ranked = closed.map((t) => ({ symbol: t.symbol, name: t.name || '', image: t.image || null, pnlSol: t.pnlSol, pnlPct: t.pnlPct })).sort((a, c) => c.pnlSol - a.pnlSol);
  const best = ranked[0] || null;
  const worst = ranked.length ? ranked[ranked.length - 1] : null;
  // equity before this window
  let startPnl = 0;
  for (const t of closedAll) if (t.closedAt < b.from) startPnl += t.pnlSol;
  const stack = engine.stack || cfg.PAPER_STACK_SOL;
  const startEq = stack + startPnl;
  const pnlPct = startEq ? pnlSol / startEq : 0;
  const curve = [{ t: b.from || (closed[0] ? closed[0].closedAt - 60000 : Date.now() - 60000), pnl: 0 }];
  let run = 0;
  for (const t of closed.slice().sort((a, c) => a.closedAt - c.closedAt)) {
    run += t.pnlSol;
    curve.push({ t: t.closedAt, pnl: run });
  }
  if (includeOpen && unreal) curve.push({ t: Date.now(), pnl: run + unreal });
  if (curve.length === 1) curve.push({ t: b.to, pnl: 0 });
  const solUsd = engine.market.solUsd || 0;
  return {
    kind: 'account',
    range: b.range, label: b.label, from: b.from, to: b.to,
    pnlSol, pnlUsd: pnlSol * solUsd, pnlPct, unrealSol: unreal,
    trades: closed.length, wins, winRate: closed.length ? wins / closed.length : 0,
    best, worst, curve, stack, solUsd,
    paper: engine.mode !== 'LIVE',
    botName: cfg.BOT_NAME, badge: cfg.BADGE,
    openCount: open.length,
  };
}

let Resvg;
function renderPng(svg) {
  if (!Resvg) Resvg = require('@resvg/resvg-js').Resvg;
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: card.W },
    font: { fontFiles: FONTS, loadSystemFonts: true, defaultFontFamily: 'Inter' },
    background: 'transparent',
  });
  return r.render().asPng();
}

async function withImage(data) {
  if (!data || !data.image) return data;
  const imageData = await fetchImage(data.image);
  return { ...data, imageData: imageData || undefined, image: imageData ? undefined : data.image };
}

function themeOf(q) { return q && q.theme === 'light' ? 'light' : 'dark'; }

function flagsOf(q = {}) {
  const hide = card.parseHide(q.hide);
  const showChart = !(q.chart === '0' || q.chart === 'false');
  return { ...hide, showChart };
}

function applyPrivacy(d, flags) {
  if (!d) return d;
  const out = { ...d, hideProfit: flags.hideProfit, hideInvested: flags.hideInvested, showChart: flags.showChart !== false };
  if (flags.hideProfit) {
    delete out.pnlSol; delete out.pnlUsd; delete out.unrealSol;
    if (out.best) { out.best = { ...out.best }; delete out.best.pnlSol; }
    if (out.worst) { out.worst = { ...out.worst }; delete out.worst.pnlSol; }
    if (Array.isArray(out.curve)) {
      const last = out.curve[out.curve.length - 1];
      const scale = (last && last.pnl) ? last.pnl / (out.pnlPct || 1) : (out.stack || 0);
      out.curve = out.curve.map((p) => ({ t: p.t, pct: p.pct != null ? p.pct : (scale ? p.pnl / scale : 0) }));
    }
  }
  if (flags.hideInvested) {
    delete out.costSol; delete out.proceedsSol; delete out.stack; delete out.tokens; delete out.sizeSol;
  }
  return out;
}

function shareQs(q, extra = {}) {
  const f = flagsOf(q);
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(extra)) if (v != null && v !== '') p.set(k, String(v));
  if (themeOf(q) === 'light') p.set('theme', 'light');
  const hide = card.hideParam(f);
  if (hide) p.set('hide', hide);
  if (f.showChart === false) p.set('chart', '0');
  return p;
}

function shareDesc(d) {
  if (d.kind === 'account') {
    const pct = d.pnlPct != null ? (d.pnlPct < 0 ? '−' : '+') + Math.abs(d.pnlPct * 100).toFixed(1) + '%' : '';
    const amt = d.hideProfit ? pct : `${d.pnlSol != null ? card.fmtSol(d.pnlSol) : ''}${d.solUsd && d.pnlUsd != null ? ' (' + card.fmtUsd(d.pnlUsd) + ')' : ''}`;
    return `${amt} · ${d.trades || 0} trades · ${d.trades ? Math.round(d.winRate * 100) + '% win' : 'no trades yet'}${d.paper ? ' · PAPER' : ''}`.replace(/^ · /, '');
  }
  const amt = d.hideProfit ? card.fmtPct(d.pnlPct) : `${card.fmtSol(d.pnlSol)}${d.solUsd && d.pnlUsd != null ? ' (' + card.fmtUsd(d.pnlUsd) + ')' : ''} · ${card.fmtPct(d.pnlPct)}`;
  return `${amt} · ${d.agentName || ''}${d.paper ? ' · PAPER' : ''}`;
}


function ogHtml({ title, description, image, url, theme, svg }) {
  const t = theme === 'light' ? 'light' : 'dark';
  const bg = t === 'light' ? '#F4F4F5' : '#09090B';
  const fg = t === 'light' ? '#0A0A0A' : '#FAFAFA';
  const mut = t === 'light' ? '#52525B' : '#A1A1AA';
  const btn = '#F97316';
  return `<!doctype html>
<html lang="en" data-theme="${t}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${card.esc(title)}</title>
<meta name="description" content="${card.esc(description)}">
<meta name="theme-color" content="${bg}">
<meta property="og:type" content="website">
<meta property="og:title" content="${card.esc(title)}">
<meta property="og:description" content="${card.esc(description)}">
<meta property="og:image" content="${card.esc(image)}">
<meta property="og:image:width" content="${card.W}">
<meta property="og:image:height" content="${card.H}">
<meta property="og:url" content="${card.esc(url)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${card.esc(title)}">
<meta name="twitter:description" content="${card.esc(description)}">
<meta name="twitter:image" content="${card.esc(image)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800;900&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;background:${bg};color:${fg};font-family:Inter,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;padding:24px 16px 48px}
  .card{width:min(1200px,100%);border-radius:28px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.35);line-height:0}
  .card svg{width:100%;height:auto;display:block}
  .actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px;justify-content:center}
  .pill{border:0;border-radius:999px;padding:11px 18px;font:700 14px Inter,system-ui;cursor:pointer;background:#27272A;color:#fff}
  .pill.x{background:${btn}}
  .muted{color:${mut};margin-top:14px;font-size:13px}
  a.home{color:${mut};margin-top:22px;font-size:13px;font-weight:600}
</style>
</head>
<body>
  <div class="card" id="card">${svg}</div>
  <div class="actions">
    <button class="pill" id="dl">Download PNG</button>
    <button class="pill" id="copy">Copy image</button>
    <button class="pill x" id="post">Post on X</button>
    <button class="pill" id="link">Copy link</button>
    <button class="pill" id="theme">Theme</button>
  </div>
  <div class="muted" id="msg"></div>
  <a class="home" href="/">Open Devameer Bot</a>
  <script src="/share-card.js"></script>
  <script>
    const PAGE = ${JSON.stringify({ url, theme: t })};
    const svgEl = document.getElementById('card');
    const msg = (t) => document.getElementById('msg').textContent = t || '';
    async function pngBlob() {
      const svg = svgEl.innerHTML.trim();
      const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      const img = new Image(); img.src = url; await img.decode();
      const c = document.createElement('canvas'); c.width = ShareCard.W; c.height = ShareCard.H;
      c.getContext('2d').drawImage(img, 0, 0); 
      return new Promise((res) => c.toBlob(res, 'image/png'));
    }
    document.getElementById('dl').onclick = async () => {
      try { const b = await pngBlob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'devameer-pnl.png'; a.click(); }
      catch (e) { msg(e.message); }
    };
    document.getElementById('copy').onclick = async () => {
      try {
        const b = await pngBlob();
        if (navigator.clipboard && window.ClipboardItem) { await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); msg('Copied image'); }
        else { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'devameer-pnl.png'; a.click(); msg('Saved PNG (clipboard not available)'); }
      } catch (e) { msg(e.message); }
    };
    document.getElementById('post').onclick = () => {
      const u = 'https://x.com/intent/post?text=' + encodeURIComponent(document.querySelector('meta[name="twitter:description"]').content + '\\n' + PAGE.url);
      window.open(u, '_blank', 'noopener');
    };
    document.getElementById('link').onclick = async () => {
      try { await navigator.clipboard.writeText(PAGE.url); msg('Copied link'); } catch { msg(PAGE.url); }
    };
    document.getElementById('theme').onclick = () => {
      const next = (document.documentElement.getAttribute('data-theme') === 'light') ? 'dark' : 'light';
      const u = new URL(location.href); u.searchParams.set('theme', next); location.href = u.toString();
    };
  </script>
</body></html>`;
}

async function decorateTrade(d, ticks) {
  if (!d || !ticks || !d.id) return d;
  try {
    const t = { mint: d.mint, openedAt: d.openedAt, closedAt: d.closedAt, entryPrice: d.entryPrice, curvePriceAtEntry: d.entryPrice };
    // publicTrade doesn't include mint? we need mint for ticks
    const extra = await ticks.forTrade({ ...t, mint: d.mint }, 80);
    return { ...d, ticks: extra.ticks, pumpPct: extra.pumpPct, dumpPct: extra.dumpPct, holdPumpPct: extra.holdPumpPct, holdDumpPct: extra.holdDumpPct };
  } catch { return d; }
}

function mount(app, { engine, ticks }) {
  app.get('/api/share/trade/:id', async (req, res) => {
    let d = publicTrade(engine, req.params.id);
    if (!d) return res.status(404).json({ error: 'trade not found' });
    d = await decorateTrade(d, ticks);
    res.json(applyPrivacy(d, flagsOf(req.query)));
  });
  app.get('/api/share/account', (req, res) => {
    try { res.json(applyPrivacy(publicAccount(engine, req.query), flagsOf(req.query))); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.get('/share/img', async (req, res) => {
    const u = req.query.u;
    if (!allowedImg(u)) return res.status(400).end();
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 5000);
    try {
      const r = await fetch(u, { signal: ac.signal, redirect: 'follow', headers: { 'User-Agent': 'devameer-bot-share/1' } });
      if (!r.ok) return res.status(404).end();
      const mime = (r.headers.get('content-type') || 'image/png').split(';')[0].trim();
      if (!/^image\//i.test(mime)) return res.status(400).end();
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 2_000_000) return res.status(400).end();
      res.set({ 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*' });
      res.end(buf);
    } catch { res.status(502).end(); }
    finally { clearTimeout(t); }
  });

  app.get('/share/trade/:id.png', async (req, res) => {
    let d = publicTrade(engine, req.params.id);
    if (!d) return res.status(404).json({ error: 'trade not found' });
    try {
      const f = flagsOf(req.query);
      d = applyPrivacy(await decorateTrade(d, ticks), f);
      const png = renderPng(card.tradeSvg(await withImage(d), themeOf(req.query)));
      res.set({ 'Content-Type': 'image/png', 'Cache-Control': d.status === 'closed' ? 'public, max-age=120' : 'public, max-age=15' });
      res.end(png);
    } catch (e) { res.status(500).json({ error: 'render failed' }); }
  });
  app.get('/share/account.png', async (req, res) => {
    try {
      const d = applyPrivacy(publicAccount(engine, req.query), flagsOf(req.query));
      const png = renderPng(card.accountSvg(await withImage(d), themeOf(req.query)));
      res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=30' });
      res.end(png);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.get('/share/trade/:id', async (req, res) => {
    let d = publicTrade(engine, req.params.id);
    if (!d) return res.status(404).type('txt').send('Trade not found');
    const f = flagsOf(req.query);
    d = applyPrivacy(await decorateTrade(d, ticks), f);
    const theme = themeOf(req.query);
    const base = publicBase(req);
    const qs = shareQs(req.query);
    const qstr = qs.toString();
    const url = `${base}/share/trade/${d.id}${qstr ? '?' + qstr : ''}`;
    const image = `${base}/share/trade/${d.id}.png${qstr ? '?' + qstr + '&' : '?'}v=${crypto.createHash('sha1').update(String(d.closedAt || d.holdMs) + (qstr || '')).digest('hex').slice(0, 8)}`;
    const title = `${card.tick(d.symbol)} ${card.fmtPct(d.pnlPct)} · ${cfg.BOT_NAME}`;
    const description = shareDesc(d);
    const svg = card.tradeSvg(await withImage(d), theme);
    res.type('html').send(ogHtml({ title, description, image, url, theme, svg }));
  });
  app.get('/share/account', async (req, res) => {
    try {
      const d = applyPrivacy(publicAccount(engine, req.query), flagsOf(req.query));
      const theme = themeOf(req.query);
      const base = publicBase(req);
      const extra = { range: d.range };
      if (d.range === 'custom') { extra.from = String(d.from); extra.to = String(d.to); }
      const qs = shareQs(req.query, extra);
      const url = `${base}/share/account?${qs}`;
      const image = `${base}/share/account.png?${qs}&v=${Date.now()}`;
      const title = `${cfg.BOT_NAME} ${d.label} ${d.hideProfit ? 'return ' + (d.pnlPct != null ? ((d.pnlPct < 0 ? '−' : '+') + Math.abs(d.pnlPct * 100).toFixed(1) + '%') : '') : 'PnL'}`;
      const description = shareDesc(d);
      const svg = card.accountSvg(await withImage(d), theme);
      res.type('html').send(ogHtml({ title, description, image, url, theme, svg }));
    } catch (e) { res.status(400).type('txt').send(e.message); }
  });
}

module.exports = { mount, publicTrade, publicAccount, rangeBounds };
