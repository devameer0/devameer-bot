// Devameer Bot UI. All numbers come from /api/state (real fills / live curve prices). No mock data.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// Original mascot: a white jellybean with oval eyes, orange blush and a teal sprout.
let beanN = 0;
const BEANSRC = `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><defs>
<radialGradient id="bg1" cx="38%" cy="30%" r="75%"><stop offset="0" stop-color="#fff"/><stop offset=".62" stop-color="#F1F1F3"/><stop offset="1" stop-color="#B9BAC2"/></radialGradient>
<radialGradient id="bg2" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<path d="M104 26c18 2 24 14 22 24" stroke="#0F766E" stroke-width="5" fill="none" stroke-linecap="round"/>
<path d="M124 46c10-16 30-18 38-12-6 14-24 22-38 12z" fill="#2DD4BF"/>
<path d="M100 44c46-2 82 30 82 78 0 44-34 70-82 70S18 170 18 128c0-50 36-82 82-84z" fill="url(#bg1)"/>
<ellipse cx="78" cy="78" rx="34" ry="20" fill="url(#bg2)" transform="rotate(-20 78 78)"/>
<ellipse cx="108" cy="104" rx="9" ry="16" fill="#0A0A0A" transform="rotate(14 108 104)"/>
<ellipse cx="146" cy="98" rx="9" ry="16" fill="#0A0A0A" transform="rotate(14 146 98)"/>
<ellipse cx="111" cy="97" rx="3" ry="4.5" fill="#fff"/><ellipse cx="149" cy="91" rx="3" ry="4.5" fill="#fff"/>
<ellipse cx="96" cy="134" rx="10" ry="5" fill="#FDBA74" opacity=".7"/><ellipse cx="164" cy="126" rx="9" ry="5" fill="#FDBA74" opacity=".7"/>
<path d="M124 132q8 7 16 0" stroke="#0A0A0A" stroke-width="3.5" fill="none" stroke-linecap="round"/></svg>`;
const bean = () => { const n = ++beanN; return BEANSRC.replace(/bg1/g, 'bg1_' + n).replace(/bg2/g, 'bg2_' + n); };
$$('[data-bean]').forEach(e => e.innerHTML = bean());

let S = null, logSeq = 0, evSeq = 0, firstLoad = true, shownProfit = 0, knownClosed = new Set();
let range = 'all', customFrom = '', customTo = '', sharePayload = null, shareTheme = null;
const SHARE_IC = '<svg viewBox="0 0 24 24"><path d="M4 12v8h16v-8"/><path d="M12 4v12"/><path d="M8 8l4-4 4 4"/></svg>';

const fmtUsd = (v, sign = true) => { const a = Math.abs(v); const s = a >= 1000 ? a.toLocaleString(undefined, { maximumFractionDigits: 0 }) : a >= 100 ? a.toFixed(0) : a.toFixed(2); return (sign ? (v < 0 ? '-' : '+') : '') + '$' + s; };
const fmtSol = (v, sign = true) => (sign ? (v < 0 ? '-' : '+') : '') + Math.abs(v).toFixed(4) + ' SOL';
const usd = (sol) => sol * (S?.solUsd || 0);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tick = (s) => '$' + esc(String(s || '?').replace(/^\$/, '').toUpperCase());
const solscan = (sig) => sig ? `https://solscan.io/tx/${sig}` : null;

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { showLogin(); throw new Error('login required'); }
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

function showLogin() { $('#login').classList.remove('hidden'); $('#app').classList.add('hidden'); }
$('#loginForm').onsubmit = async (e) => {
  e.preventDefault(); $('#loginErr').textContent = '';
  try { await api('/api/login', { password: $('#pw').value }); $('#login').classList.add('hidden'); firstLoad = true; poll(); }
  catch (er) { $('#loginErr').textContent = er.message; }
};

// ---- tabs
$$('.nav [data-go]').forEach(b => b.onclick = () => {
  $$('.nav [data-go]').forEach(x => x.classList.toggle('on', x === b));
  $$('.tab').forEach(t => t.classList.toggle('hidden', t.dataset.tab !== b.dataset.go));
  $('#floatTerm').classList.toggle('hidden', b.dataset.go !== 'home');
  window.scrollTo(0, 0);
});

// ---- rolling profit counter
function rollTo(target) {
  const start = shownProfit, t0 = performance.now(), dur = 900;
  const step = (t) => { const k = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - k, 3); shownProfit = start + (target - start) * e; paintProfit(shownProfit); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function paintProfit(v) { const el = $('#profitUsd'); el.textContent = S?.solUsd ? fmtUsd(v) : fmtSol(v / (S?.solUsd || 1)); el.classList.toggle('neg', v < -0.004); }

function icon(t, color) {
  const letter = esc(String(t.symbol || '?').replace(/^\$/, '').charAt(0).toUpperCase());
  return `<div class="ic" style="--c:${color}">${t.image ? `<img src="${esc(t.image)}" loading="lazy" onerror="this.remove()">` : ''}${t.image ? '' : letter}</div>`;
}

function card(t, newest) {
  const a = S.agents[t.agent] || { color: '#999' };
  const share = `<button type="button" class="sh" data-share="${esc(t.id)}" title="Share PnL">${SHARE_IC}</button>`;
  if (t.status === 'open') {
    const cur = t.lastValue ?? t.costSol; const pct = (cur / t.costSol - 1) * 100; const pnl = cur - t.costSol;
    return `<div class="tc open" style="--c:${a.color}" title="${esc(a.name)} · open"><div class="h">${icon(t, a.color)}<span>${tick(t.symbol)}</span></div>
      <div class="v"><span class="pct ${pct >= 0 ? 'up' : 'dn'}">${pct >= 0 ? '↑' : '↓'}${Math.abs(pct).toFixed(0)}%</span><span class="usd">${S.solUsd ? fmtUsd(usd(pnl)) : fmtSol(pnl)}</span></div><span class="x">open</span>${share}</div>`;
  }
  const pct = (t.pnlPct || 0) * 100; const win = t.pnlSol >= 0;
  return `<div class="tc ${win ? '' : 'loss'} ${newest ? 'newest' : ''}" data-id="${t.id}" style="--c:${a.color}" title="${esc(a.name)} · ${esc(t.exitReason || '')}">
    <div class="h">${icon(t, a.color)}<span>${tick(t.symbol)}</span></div>
    <div class="v"><span class="pct ${win ? 'up' : 'dn'}">${win ? '↑' : '↓'}${Math.abs(pct).toFixed(0)}%</span><span class="usd ${win ? '' : 'dn'}">${S.solUsd ? fmtUsd(usd(t.pnlSol)) : fmtSol(t.pnlSol)}</span></div>${share}</div>`;
}

const DOT = { scout: '#EF4444', sniper: '#3B82F6', curve: '#22C55E', graduate: '#A855F7', skip: '#D1D5DB', err: '#EF4444', win: '#22C55E', loss: '#EF4444', goal: '#F97316', withdraw: '#22C55E', info: '#9CA3AF' };
function logLine(l) {
  const el = document.createElement('div');
  const dark = l.kind === 'goal' || l.kind === 'withdraw';
  el.className = 'ln' + (dark ? ' dark' : ''); el.style.setProperty('--dot', DOT[l.kind] || '#D1D5DB');
  const time = new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  el.innerHTML = `<span class="t">${time}</span>${esc(l.text)}${l.sig ? `<a href="${solscan(l.sig)}" target="_blank" rel="noopener">tx↗</a>` : ''}`;
  return el;
}
function appendLogs(logs) {
  for (const l of logs) {
    for (const box of [$('#log'), $('#fullLog')]) {
      box.appendChild(logLine(l));
      if (l.kind === 'goal' && S?.goalHold) { const b = document.createElement('button'); b.className = 'kg'; b.textContent = 'keep going'; b.onclick = keepGoing; box.appendChild(b); }
      while (box === $('#log') && box.children.length > 6) box.firstChild.remove();
      while (box.children.length > 300) box.firstChild.remove();
    }
  }
}
async function keepGoing() { try { await api('/api/keep-going', {}); $$('.kg').forEach(b => b.remove()); } catch (e) { alert(e.message); } }

// ---- toasts
let islandTimer;
function island(t) {
  const el = $('#island');
  el.querySelector('.isl-ic').innerHTML = t.image ? `<img src="${esc(t.image)}">` : esc(String(t.symbol || '?').charAt(0));
  el.querySelector('.isl-t').innerHTML = tick(t.symbol);
  const v = el.querySelector('.isl-v'); v.textContent = S.solUsd ? fmtUsd(t.usd) : fmtSol(t.pnlSol); v.classList.toggle('dn', !t.win);
  el.classList.add('show'); clearTimeout(islandTimer); islandTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
function banner(title, body) {
  const el = document.createElement('div'); el.className = 'bn';
  el.innerHTML = `<div class="av">${bean()}</div><div><b>${esc(title)}</b><div class="sm">${esc(body)}</div></div><span class="now">now</span>`;
  $('#banners').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, 4200);
}
function confetti() {
  const c = $('#confetti'), x = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
  const cols = ['#F97316', '#22C55E', '#3B82F6', '#A855F7', '#FACC15', '#EF4444'];
  const P = Array.from({ length: 180 }, () => ({ x: Math.random() * c.width, y: -20 - Math.random() * c.height * .5, vx: (Math.random() - .5) * 3, vy: 2 + Math.random() * 4, r: Math.random() * 6.28, vr: (Math.random() - .5) * .3, w: 5 + Math.random() * 6, h: 8 + Math.random() * 8, c: cols[(Math.random() * cols.length) | 0] }));
  const t0 = performance.now();
  (function f(t) { x.clearRect(0, 0, c.width, c.height); for (const p of P) { p.x += p.vx; p.y += p.vy; p.vy += .04; p.r += p.vr; x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); x.restore(); } if (t - t0 < 4500) requestAnimationFrame(f); else x.clearRect(0, 0, c.width, c.height); })(t0);
}

// ---- render
function render() {
  const s = S.summary;
  $('#app').classList.remove('hidden');
  $('#botName').textContent = S.bot.name; $('#badge').textContent = S.bot.badge;
  $$('.tn').forEach(e => e.textContent = S.bot.name);
  const mt = $('#modeTag'); mt.textContent = S.mode; mt.classList.toggle('live', S.mode === 'LIVE');
  const lb = $('#liveBtn'); lb.classList.toggle('off', !S.running); lb.querySelector('span').textContent = S.running ? (S.goalHold ? 'HOLD' : 'LIVE') : 'PAUSED';

  const rs = rangeStats();
  const isAll = range === 'all';
  $('#lbl').textContent = isAll ? 'PROFIT' : rs.b.label + ' PNL';
  rollTo(usd(rs.pnl) || (S.solUsd ? 0 : rs.pnl));
  $('#profitSol').textContent = fmtSol(rs.pnl) + (rs.unreal ? ` · ${fmtSol(rs.unreal)} open` : '');
  $('#mult').textContent = isAll ? s.mult.toFixed(2) + 'x' : ((rs.pnlPct < 0 ? '-' : '+') + Math.abs(rs.pnlPct * 100).toFixed(1) + '%');
  $('#tradesLine').textContent = `${rs.count} trades · ${Math.round(rs.winRate * 100)}% win`;
  const g = S.settings.goal; $('#goalLbl').textContent = isAll ? `goal ${g}x${s.mult >= g ? ' ✓' : ''}` : rs.b.label;
  const prog = isAll ? (s.stack ? Math.max(0, Math.min(1, (s.mult - 1) / (g - 1))) : 0) : Math.max(0, Math.min(1, 0.5 + rs.pnlPct));
  $('#goalBar').style.width = (prog * 100).toFixed(1) + '%'; $('#goalBar').classList.toggle('done', isAll && s.mult >= g);
  paintSpark(rs.curve, (rs.pnl || 0) >= 0 ? '#22C55E' : '#EF4444');
  const bw = $('#bestWorst');
  bw.innerHTML = rs.count
    ? `Best <b class="up">${tick(rs.best.symbol)} ${fmtSol(rs.best.pnlSol)}</b><br>Worst <b class="dn">${tick(rs.worst.symbol)} ${fmtSol(rs.worst.pnlSol)}</b>`
    : '<span class="muted">No closed trades in this range yet.</span>';

  // agents
  const tot = Object.values(s.byAgent).reduce((a, v) => a + Math.abs(v), 0);
  $('#seg').innerHTML = Object.entries(S.agents).map(([k, a]) => `<div style="background:${a.color};flex:${tot ? Math.abs(s.byAgent[k]) / tot : 1}"></div>`).join('');
  $('#agentsLine').textContent = `${S.bot.name} runs ${Object.values(S.settings.agents).filter(Boolean).length} agents`;
  $('#agents').innerHTML = Object.entries(S.agents).map(([k, a]) => { const v = s.byAgent[k] || 0; return `<div class="agent" title="${esc(a.desc)}"><div class="an"><i style="background:${a.color};${S.settings.agents[k] ? '' : 'opacity:.3'}"></i><span>${a.name}</span></div><b class="${v < 0 ? 'dn' : ''}">${S.solUsd ? fmtUsd(usd(v)) : fmtSol(v)}</b></div>`; }).join('');

  // trades
  $('#totalLine').textContent = `${s.count} total`;
  $('#openWrap').classList.toggle('hidden', !S.open.length);
  $('#openGrid').innerHTML = S.open.map(t => card(t)).join('');
  const grid = $('#grid'); const newest = S.closed[0]?.id;
  grid.innerHTML = S.closed.slice(0, 30).map(t => card(t, t.id === newest)).join('');
  for (const t of S.closed) { if (!knownClosed.has(t.id)) { if (!firstLoad) grid.querySelector(`[data-id="${t.id}"]`)?.classList.add('pop'); knownClosed.add(t.id); } }
  $('#empty').classList.toggle('hidden', S.closed.length > 0 || S.open.length > 0);
  const f = S.feed;
  $('#emptyText').innerHTML = (S.running ? 'Agents are scanning. They only buy when a live token passes every rule.' : 'Tap <b>PAUSED</b> to start. Agents only buy when a live pump.fun token passes every rule.') +
    `<br><span class="muted">feed: ${f.wsConnected ? 'PumpPortal connected' : 'connecting...'} · ${f.newTokens} launches seen · watching ${f.watching} curves${S.solUsd ? ` · SOL $${S.solUsd.toFixed(2)}` : ''}</span>`;

  // trades tab
  const all = [...S.open, ...S.closed];
  $('#tradeList').innerHTML = all.length ? all.map(t => { const a = S.agents[t.agent]; const pnl = t.status === 'open' ? (t.lastValue ?? t.costSol) - t.costSol : t.pnlSol;
    return `<div class="row2">${icon(t, a.color)}<div class="grow"><b>${tick(t.symbol)}</b> <span class="muted sm">${a.name} · ${t.status === 'open' ? 'open' : esc(t.exitReason || '')}${t.paper ? ' · paper' : ''}</span><div class="sm muted">${new Date(t.openedAt).toLocaleString()} · cost ${t.costSol.toFixed(4)} SOL ${t.buySig ? `<a href="${solscan(t.buySig)}" target="_blank">buy tx</a>` : ''}${t.sellSig ? `<a href="${solscan(t.sellSig)}" target="_blank">sell tx</a>` : ''}<a href="https://pump.fun/coin/${esc(t.mint)}" target="_blank">pump.fun</a></div></div>
    <div style="text-align:right"><b class="${pnl >= 0 ? 'up' : 'dn'}">${fmtSol(pnl)}</b><div class="sm muted">${S.solUsd ? fmtUsd(usd(pnl)) : ''}</div><div class="btns" style="justify-content:flex-end">${t.status === 'open' && S.authed ? `<button class="pill sm" data-sell="${t.id}" style="padding:4px 10px;margin-top:4px">Sell</button>` : ''}<button class="pill sm" data-share="${t.id}" style="padding:4px 10px;margin-top:4px">Share</button></div></div></div>`; }).join('') : '<div class="card muted">No trades yet.</div>';
  $$('[data-sell]').forEach(b => b.onclick = async () => { if (!confirm('Sell this position now?')) return; try { await api('/api/sell/' + b.dataset.sell, {}); } catch (e) { alert(e.message); } });

  // me tab
  const kv = (k, v) => `<div class="kv"><span class="muted">${k}</span><span>${v}</span></div>`;
  $('#statusCard').innerHTML = `<div class="card-h">Status</div>` +
    kv('Mode', S.mode === 'LIVE' ? '<b class="up">LIVE (real SOL)</b>' : '<b>PAPER</b> (live data, simulated fills)') +
    kv('Bot', S.running ? (S.goalHold ? 'holding at goal' : 'running') : 'paused') +
    kv('Wallet', S.wallet ? `<span style="word-break:break-all">${esc(S.wallet)}</span>` : 'no key set') +
    kv('Wallet balance', S.wallet ? (S.walletSol == null ? 'unavailable' : Number(S.walletSol).toFixed(4) + ' SOL') : '—') +
    kv('Withdraw to', S.withdrawTo ? esc(S.withdrawTo) : 'WITHDRAW_ADDRESS not set') +
    kv('Stack', s.stack ? fmtSol(s.stack, false) : 'set on start') +
    kv('Today realized', fmtSol(s.today) + (S.dailyLossHit ? ' · <b class="dn">limit hit</b>' : '')) +
    kv('Feed', `${f.wsConnected ? 'connected' : 'down'} · ${f.newTokens} launches · ${f.curvePolls} curve polls · ${f.rpcErrors} rpc errors`) +
    kv('DB', S.db) +
    (S.mode !== 'LIVE' ? `<div class="sm muted" style="margin-top:8px">Real trading needs DRY_RUN=false and WALLET_PRIVATE_KEY set on the server. ${S.dryRun ? 'DRY_RUN is on.' : ''} ${S.hasKey ? '' : 'No key loaded.'}</div>` : '');
  const L = S.limits;
  $('#limitsCard').innerHTML = `<div class="card-h">Safety limits (server caps)</div>` + kv('Max per trade', L.maxSolPerTrade + ' SOL') + kv('Max open positions', L.maxOpen) + kv('Daily loss limit', L.dailyLossLimit + ' SOL') + kv('Max slippage', L.maxSlippage + '%') + kv('Max priority fee', L.maxPriorityFee + ' SOL') + kv('Rug filters', `dev ≤ ${L.maxDevPct}% · bundle ≤ ${L.maxBundlePct}% · liq ≥ ${L.minLiqSol} SOL · no repeat rug devs`);
  $('#rulesCard').innerHTML = `<div class="card-h">Agent rules</div>` + Object.values(S.agents).map(a => `<div class="rule"><i style="background:${a.color}"></i><b>${a.name}</b>: ${esc(a.desc)}. Exit at +${Math.round(a.tp * 100)}% / -${Math.round(a.sl * 100)}% / ${a.maxHoldMin}m.</div>`).join('');
  if (firstLoad || !document.activeElement || !document.activeElement.closest('[data-tab="me"]')) {
    $('#sSize').value = S.settings.tradeSize; $('#sSlip').value = S.settings.slippage; $('#sFee').value = S.settings.priorityFee; $('#sGoal').value = S.settings.goal;
    $('#agentToggles').innerHTML = Object.entries(S.agents).map(([k, a]) => `<label><input type="checkbox" data-ag="${k}" ${S.settings.agents[k] ? 'checked' : ''}> ${a.name}</label>`).join('');
  }
  $('#resetBtn').classList.toggle('hidden', S.mode === 'LIVE');
}

async function poll() {
  try {
    const st = await api(`/api/state?since=${logSeq}&ev=${evSeq}`);
    const prevSeq = logSeq; S = st;
    if (firstLoad) { $('#log').innerHTML = ''; $('#fullLog').innerHTML = ''; }
    appendLogs(st.logs); logSeq = st.seq.log;
    if (!firstLoad) for (const e of st.events) {
      if (e.type === 'banner') banner(e.title, e.body);
      if (e.type === 'confetti') confetti();
      if (e.type === 'trade') island(e);
      if (e.type === 'withdrawn') { const b = $('#wdBtn'); b.textContent = 'Sent ✓'; b.classList.add('sent'); setTimeout(() => { b.textContent = 'WITHDRAW'; b.classList.remove('sent'); }, 6000); }
    }
    evSeq = st.seq.ev; void prevSeq;
    render(); firstLoad = false;
  } catch (e) { /* retry */ }
  clearTimeout(poll.t); poll.t = setTimeout(poll, 1500);
}

// ---- controls
const guard = (fn) => async () => { try { await fn(); poll(); } catch (e) { if (e.message !== 'login required') alert(e.message); } };
$('#liveBtn').onclick = guard(async () => {
  if (!S.authed) return showLogin();
  if (S.running) { const sell = S.open.length && confirm('Pause the bot. Also SELL all open positions now?\nOK = stop & sell, Cancel = just pause new buys'); await api('/api/stop', { sellAll: !!sell }); }
  else { if (S.mode === 'LIVE' && !confirm('Start LIVE trading with real SOL from the bot wallet?')) return; await api('/api/start', {}); }
});
$('#startBtn').onclick = guard(async () => { if (S.mode === 'LIVE' && !confirm('Start LIVE trading with real SOL?')) return; await api('/api/start', {}); });
$('#stopBtn').onclick = guard(() => api('/api/stop', { sellAll: false }));
$('#stopSellBtn').onclick = guard(async () => { if (confirm('Stop and sell every open position now?')) await api('/api/stop', { sellAll: true }); });
$('#saveBtn').onclick = guard(async () => { const agents = {}; $$('[data-ag]').forEach(c => agents[c.dataset.ag] = c.checked); const r = await api('/api/settings', { tradeSize: +$('#sSize').value, slippage: +$('#sSlip').value, priorityFee: +$('#sFee').value, goal: +$('#sGoal').value, agents }); firstLoad = true; alert('Saved. Trade size ' + r.result.tradeSize + ' SOL'); });
$('#resetBtn').onclick = guard(async () => { if (confirm('Reset all paper trades and stats?')) { await api('/api/reset-paper', {}); location.reload(); } });
$('#logoutBtn').onclick = guard(async () => { await api('/api/logout', {}); location.reload(); });

$('#wdBtn').onclick = () => {
  if (!S) return; if (!S.authed) return showLogin();
  const s = S.summary; const def = Math.max(0, s.realized - s.withdrawn);
  $('#wdAmt').value = def > 0 ? def.toFixed(4) : '';
  $('#dlgTo').textContent = S.withdrawTo ? 'To ' + S.withdrawTo : 'WITHDRAW_ADDRESS is not set on the server';
  $('#dlgNote').textContent = S.mode === 'LIVE' ? 'This sends real SOL on-chain from the bot wallet. It cannot be undone.' : 'PAPER mode: nothing is sent on-chain. This only records a simulated withdrawal.';
  $('#dlgErr').textContent = ''; $('#dlg').classList.remove('hidden');
};
$('#dlgCancel').onclick = () => $('#dlg').classList.add('hidden');
$('#dlgOk').onclick = async () => {
  $('#dlgErr').textContent = '';
  try { await api('/api/withdraw', { sol: +$('#wdAmt').value }); $('#dlg').classList.add('hidden'); poll(); }
  catch (e) { $('#dlgErr').textContent = e.message; }
};

initTheme();
initShare();
poll();

// ---- theme
function currentTheme() { return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
function setTheme(t) {
  const theme = t === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('devameer-theme', theme); } catch { /* ignore */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#F9FAFB' : '#09090B');
}
function initTheme() {
  setTheme(currentTheme());
  $$('[data-theme-toggle]').forEach((b) => { b.onclick = () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'); });
}

// ---- account timeframe
function rangeBounds() {
  const now = Date.now();
  if (range === '24h') return { from: now - 864e5, to: now, label: '24H' };
  if (range === '7d') return { from: now - 7 * 864e5, to: now, label: '7D' };
  if (range === '30d') return { from: now - 30 * 864e5, to: now, label: '30D' };
  if (range === 'custom' && customFrom && customTo) {
    const from = new Date(customFrom + 'T00:00:00').getTime();
    const to = new Date(customTo + 'T23:59:59.999').getTime();
    if (Number.isFinite(from) && Number.isFinite(to) && to >= from) return { from, to, label: 'CUSTOM' };
  }
  return { from: 0, to: now, label: 'ALL TIME' };
}
function rangeStats() {
  const b = rangeBounds();
  const closed = (S.closed || []).filter((t) => t.closedAt >= b.from && t.closedAt <= b.to);
  const includeOpen = b.to >= Date.now() - 2000;
  const open = includeOpen ? (S.open || []) : [];
  let realized = 0; for (const t of closed) realized += t.pnlSol || 0;
  let unreal = 0; for (const p of open) unreal += (p.lastValue ?? p.costSol) - p.costSol;
  const pnl = realized + unreal;
  const wins = closed.filter((t) => t.pnlSol > 0).length;
  const ranked = closed.slice().sort((a, c) => (c.pnlSol || 0) - (a.pnlSol || 0));
  let startPnl = 0;
  for (const t of S.closed || []) if (t.closedAt < b.from) startPnl += t.pnlSol || 0;
  const startEq = (S.summary?.stack || 0) + startPnl;
  const pnlPct = startEq ? pnl / startEq : 0;
  const chrono = closed.slice().sort((a, c) => a.closedAt - c.closedAt);
  const curve = [{ t: chrono[0] ? chrono[0].closedAt - 60000 : b.from, pnl: 0 }];
  let run = 0;
  for (const t of chrono) { run += t.pnlSol || 0; curve.push({ t: t.closedAt, pnl: run }); }
  if (includeOpen && unreal) curve.push({ t: Date.now(), pnl: run + unreal });
  if (curve.length === 1) curve.push({ t: b.to, pnl: 0 });
  return { b, closed, open, pnl, unreal, wins, count: closed.length, winRate: closed.length ? wins / closed.length : 0, best: ranked[0] || null, worst: ranked.length ? ranked[ranked.length - 1] : null, curve, pnlPct };
}
function paintSpark(points, color) {
  const svg = $('#spark'); if (!svg) return;
  if (!points || points.length < 2) { svg.innerHTML = ''; return; }
  const w = 120, h = 44, pad = 2;
  const ys = points.map((p) => p.pnl);
  const min = Math.min(0, ...ys), max = Math.max(0, ...ys), span = max - min || 1;
  const n = Math.max(points.length - 1, 1);
  const coords = points.map((p, i) => {
    const x = pad + (i / n) * (w - pad * 2);
    const y = pad + (h - pad * 2) - ((p.pnl - min) / span) * (h - pad * 2);
    return [x, y];
  });
  const d = coords.map((c, i) => (i ? 'L' : 'M') + c[0].toFixed(1) + ',' + c[1].toFixed(1)).join(' ');
  const last = coords[coords.length - 1];
  const zy = pad + (h - pad * 2) - ((0 - min) / span) * (h - pad * 2);
  svg.innerHTML = `<line x1="0" x2="${w}" y1="${zy.toFixed(1)}" y2="${zy.toFixed(1)}" stroke="currentColor" opacity=".2" stroke-dasharray="2 2"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="2.4" fill="${color}"/>`;
}

$$('#rangeChips [data-range]').forEach((b) => b.onclick = () => {
  range = b.dataset.range;
  $$('#rangeChips [data-range]').forEach((x) => x.classList.toggle('on', x === b));
  if (range === 'custom' && (!customFrom || !customTo)) {
    const to = new Date(), from = new Date(Date.now() - 7 * 864e5);
    customFrom = from.toISOString().slice(0, 10);
    customTo = to.toISOString().slice(0, 10);
    $('#rangeFrom').value = customFrom; $('#rangeTo').value = customTo;
  }
  $('#customRange').classList.toggle('hidden', range !== 'custom');
  if (S) render();
});
$('#rangeApply').onclick = () => {
  customFrom = $('#rangeFrom').value; customTo = $('#rangeTo').value;
  if (!customFrom || !customTo) return;
  range = 'custom';
  $$('#rangeChips [data-range]').forEach((x) => x.classList.toggle('on', x.dataset.range === 'custom'));
  $('#customRange').classList.remove('hidden');
  if (S) render();
};

// ---- share cards
function shareMsg(t) { $('#shareMsg').textContent = t || ''; }
function findTrade(id) { return [...(S.open || []), ...(S.closed || [])].find((t) => t.id === id); }
function tradeShareData(t) {
  const open = t.status === 'open';
  const proceeds = open ? (t.lastValue != null ? t.lastValue : t.costSol) : t.proceedsSol;
  const pnlSol = open ? proceeds - t.costSol : t.pnlSol;
  const pnlPct = t.costSol ? pnlSol / t.costSol : 0;
  const a = S.agents[t.agent] || {};
  const solUsd = t.solUsdAtClose || S.solUsd || 0;
  return {
    kind: 'trade', id: t.id, symbol: t.symbol, name: t.name || '', image: t.image || null,
    agent: t.agent, agentName: a.name || t.agent, agentColor: a.color || '#71717A',
    status: t.status, paper: t.paper !== false && (t.paper || S.mode !== 'LIVE'),
    openedAt: t.openedAt, closedAt: t.closedAt || null, holdMs: (t.closedAt || Date.now()) - t.openedAt,
    costSol: t.costSol, proceedsSol: proceeds, pnlSol, pnlPct, pnlUsd: pnlSol * solUsd,
    entryPrice: t.entryPrice, exitPrice: t.exitPrice, entryMcapSol: t.entryMcapSol, exitMcapSol: t.exitMcapSol,
    solUsd, exitReason: t.exitReason || (open ? 'open position' : ''),
    botName: S.bot?.name || 'Devameer Bot', badge: S.bot?.badge || 'DEVAMEER TERMINAL',
  };
}
function accountShareData() {
  const rs = rangeStats();
  return {
    kind: 'account', range, label: rs.b.label, from: rs.b.from, to: rs.b.to,
    pnlSol: rs.pnl, pnlUsd: usd(rs.pnl), pnlPct: rs.pnlPct, unrealSol: rs.unreal,
    trades: rs.count, wins: rs.wins, winRate: rs.winRate,
    best: rs.best && { symbol: rs.best.symbol, name: rs.best.name || '', pnlSol: rs.best.pnlSol, pnlPct: rs.best.pnlPct },
    worst: rs.worst && { symbol: rs.worst.symbol, name: rs.worst.name || '', pnlSol: rs.worst.pnlSol, pnlPct: rs.worst.pnlPct },
    curve: rs.curve, solUsd: S.solUsd || 0, paper: S.mode !== 'LIVE',
    botName: S.bot?.name || 'Devameer Bot', badge: S.bot?.badge || 'DEVAMEER TERMINAL',
  };
}
function shareLink(d) {
  if (d.kind === 'account') {
    const qs = new URLSearchParams({ range: d.range === 'custom' ? 'custom' : (d.range || 'all') });
    if (d.range === 'custom') { qs.set('from', new Date(d.from).toISOString()); qs.set('to', new Date(d.to).toISOString()); }
    if (shareTheme === 'light') qs.set('theme', 'light');
    return location.origin + '/share/account?' + qs;
  }
  return location.origin + '/share/trade/' + d.id + (shareTheme === 'light' ? '?theme=light' : '');
}
async function inlineImage(d) {
  if (!d.image) return d;
  try {
    const r = await fetch('/share/img?u=' + encodeURIComponent(d.image));
    if (!r.ok) return d;
    const blob = await r.blob();
    const imageData = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
    return { ...d, imageData, image: undefined };
  } catch { return d; }
}
async function paintShare() {
  if (!sharePayload) return;
  const d = await inlineImage(sharePayload);
  const svg = d.kind === 'account' ? ShareCard.accountSvg(d, shareTheme) : ShareCard.tradeSvg(d, shareTheme);
  $('#shareCardWrap').innerHTML = svg;
  $('#shareTheme').textContent = shareTheme === 'light' ? 'Dark card' : 'Light card';
  $('#shareTitle').textContent = d.kind === 'account' ? (d.label || 'Account') + ' PnL' : tick(d.symbol) + ' PnL';
}
async function openShare(d) {
  sharePayload = d;
  shareTheme = shareTheme || currentTheme();
  shareMsg('');
  $('#shareDlg').classList.remove('hidden');
  await paintShare();
}
async function sharePngBlob() {
  const svg = $('#shareCardWrap').innerHTML.trim();
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const img = new Image(); img.src = url; await img.decode();
  const c = document.createElement('canvas'); c.width = ShareCard.W; c.height = ShareCard.H;
  c.getContext('2d').drawImage(img, 0, 0);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}
function initShare() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-share]');
    if (!b || !S) return;
    const t = findTrade(b.dataset.share);
    if (!t) return;
    openShare(tradeShareData(t));
  });
  $('#shareAcctBtn').onclick = () => { if (!S) return; openShare(accountShareData()); };
  $('#shareClose').onclick = () => $('#shareDlg').classList.add('hidden');
  $('#shareDlg').addEventListener('click', (e) => { if (e.target === $('#shareDlg')) $('#shareDlg').classList.add('hidden'); });
  $('#shareTheme').onclick = async () => { shareTheme = shareTheme === 'light' ? 'dark' : 'light'; await paintShare(); };
  $('#shareDl').onclick = async () => {
    try {
      const b = await sharePngBlob();
      const name = (sharePayload?.kind === 'account' ? 'devameer-account-pnl' : 'devameer-' + (sharePayload?.symbol || 'trade') + '-pnl') + '.png';
      if (navigator.share && navigator.canShare) {
        const file = new File([b], name, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { shareMsg(e.message); }
  };
  $('#shareCopy').onclick = async () => {
    try {
      const b = await sharePngBlob();
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
        shareMsg('Copied image');
      } else {
        const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'devameer-pnl.png'; a.click();
        shareMsg('Saved PNG (clipboard not available on this browser)');
      }
    } catch (e) { shareMsg(e.message); }
  };
  $('#shareX').onclick = () => {
    if (!sharePayload) return;
    const url = shareLink(sharePayload);
    const text = ShareCard.tweetText(sharePayload, url);
    window.open('https://x.com/intent/post?text=' + encodeURIComponent(text), '_blank', 'noopener');
  };
  $('#shareLink').onclick = async () => {
    if (!sharePayload) return;
    const url = shareLink(sharePayload);
    try { await navigator.clipboard.writeText(url); shareMsg('Copied link'); } catch { shareMsg(url); }
  };
}
