/* Devameer Bot Pipeline — live n8n-style canvas + activity log */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const NODE_SIZE = 48;
  const R = 12;

  const state = {
    nodes: [],
    edges: [],
    world: { w: 1980, h: 780, pad: 80 },
    stats: {},
    configs: {},
    status: { mode: 'PAPER', running: false, dryRun: true },
    events: [],
    selected: null,
    panelTab: 'settings',
    coinFilter: '',
    log: { q: '', type: '', agent: '', coin: '', errors: false, paused: false, pausedBuf: [] },
    cam: { x: 0, y: 0, k: 1 },
    pulses: new Map(),
    particles: [],
    flash: new Map(),
    raf: 0,
    open: false,
    sse: null,
    dragging: false,
    last: null,
    pointers: new Map(),
    pinch: null,
    dirty: true,
  };

  const colors = () => Object.fromEntries(state.nodes.map((n) => [n.id, n.color]));

  function theme() {
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    return light
      ? { bg: '#F3F4F6', grid: 'rgba(15,15,20,.08)', label: '#0A0A0A', sub: '#6B7280', node: '#121214', edge: 0.85, badge: '#fff' }
      : { bg: '#0B0B0D', grid: 'rgba(255,255,255,.055)', label: '#FAFAFA', sub: '#A1A1AA', node: '#121214', edge: 1, badge: '#18181B' };
  }

  function nodeById(id) { return state.nodes.find((n) => n.id === id); }

  function edgePath(e) {
    const a = nodeById(e.from), b = nodeById(e.to);
    if (!a || !b) return null;
    const x1 = a.x + NODE_SIZE / 2, y1 = a.y;
    const x2 = b.x - NODE_SIZE / 2, y2 = b.y;
    const dx = Math.max(48, Math.abs(x2 - x1) * 0.45);
    return { x1, y1, x2, y2, c1x: x1 + dx, c1y: y1, c2x: x2 - dx, c2y: y2, a, b, e };
  }
  function bez(p, t) {
    const u = 1 - t, u2 = u * u, u3 = u2 * u, t2 = t * t, t3 = t2 * t;
    return {
      x: u3 * p.x1 + 3 * u2 * t * p.c1x + 3 * u * t2 * p.c2x + t3 * p.x2,
      y: u3 * p.y1 + 3 * u2 * t * p.c1y + 3 * u * t2 * p.c2y + t3 * p.y2,
    };
  }

  function icon(ctx, kind, color) {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const stroke = (fn) => { ctx.beginPath(); fn(); ctx.stroke(); };
    const fillp = (fn) => { ctx.beginPath(); fn(); ctx.fill(); };
    ctx.save(); ctx.translate(-11, -11);
    switch (kind) {
      case 'feed':
        fillp(() => ctx.arc(11, 16, 1.6, 0, 7));
        stroke(() => ctx.arc(11, 16, 5, -Math.PI * 0.85, -Math.PI * 0.15));
        stroke(() => ctx.arc(11, 16, 8.5, -Math.PI * 0.85, -Math.PI * 0.15));
        break;
      case 'jupiter':
        stroke(() => ctx.arc(11, 11, 8, 0, 7));
        stroke(() => { ctx.moveTo(3, 11); ctx.lineTo(19, 11); ctx.moveTo(11, 3); ctx.lineTo(11, 19); });
        stroke(() => ctx.ellipse(11, 11, 4, 8, 0, 0, 7));
        break;
      case 'rpc':
        stroke(() => { ctx.moveTo(4, 7); ctx.lineTo(11, 3); ctx.lineTo(18, 7); ctx.lineTo(18, 15); ctx.lineTo(11, 19); ctx.lineTo(4, 15); ctx.closePath(); });
        fillp(() => ctx.arc(11, 11, 2, 0, 7));
        break;
      case 'rugs':
        stroke(() => { ctx.moveTo(11, 3); ctx.lineTo(18, 6); ctx.lineTo(18, 12); ctx.bezierCurveTo(18, 16, 14, 19, 11, 20); ctx.bezierCurveTo(8, 19, 4, 16, 4, 12); ctx.lineTo(4, 6); ctx.closePath(); });
        stroke(() => { ctx.moveTo(8, 11); ctx.lineTo(10.2, 13.2); ctx.lineTo(14.5, 8.5); });
        break;
      case 'sniper':
        stroke(() => ctx.arc(11, 11, 5, 0, 7));
        stroke(() => { ctx.moveTo(11, 2); ctx.lineTo(11, 6); ctx.moveTo(11, 16); ctx.lineTo(11, 20); ctx.moveTo(2, 11); ctx.lineTo(6, 11); ctx.moveTo(16, 11); ctx.lineTo(20, 11); });
        fillp(() => ctx.arc(11, 11, 1.4, 0, 7));
        break;
      case 'scout':
        stroke(() => ctx.arc(11, 11, 3.2, 0, 7));
        stroke(() => { ctx.moveTo(11, 4); ctx.bezierCurveTo(16, 4, 19, 8, 19, 11); ctx.bezierCurveTo(19, 14, 16, 18, 11, 18); ctx.bezierCurveTo(6, 18, 3, 14, 3, 11); ctx.bezierCurveTo(3, 8, 6, 4, 11, 4); });
        break;
      case 'curve':
        stroke(() => { ctx.moveTo(3, 17); ctx.bezierCurveTo(7, 17, 9, 6, 13, 6); ctx.bezierCurveTo(16, 6, 18, 14, 20, 4); });
        break;
      case 'graduate':
        stroke(() => { ctx.moveTo(3, 9); ctx.lineTo(11, 5); ctx.lineTo(19, 9); ctx.lineTo(11, 13); ctx.closePath(); });
        stroke(() => { ctx.moveTo(19, 9); ctx.lineTo(19, 15); ctx.moveTo(7, 11); ctx.lineTo(7, 15); ctx.bezierCurveTo(7, 17.5, 15, 17.5, 15, 15); ctx.lineTo(15, 11); });
        break;
      case 'risk':
        stroke(() => { ctx.moveTo(11, 3); ctx.lineTo(19, 19); ctx.lineTo(3, 19); ctx.closePath(); });
        stroke(() => { ctx.moveTo(11, 9); ctx.lineTo(11, 14); });
        fillp(() => ctx.arc(11, 16.5, 0.8, 0, 7));
        break;
      case 'buy':
        stroke(() => { ctx.moveTo(11, 4); ctx.lineTo(11, 14); ctx.moveTo(7, 8); ctx.lineTo(11, 4); ctx.lineTo(15, 8); });
        stroke(() => { ctx.moveTo(4, 16); ctx.lineTo(18, 16); ctx.moveTo(6, 19); ctx.lineTo(16, 19); });
        break;
      case 'monitor':
        stroke(() => { ctx.moveTo(3, 16); ctx.lineTo(7, 11); ctx.lineTo(11, 13); ctx.lineTo(15, 7); ctx.lineTo(19, 9); });
        break;
      case 'exits':
        stroke(() => { ctx.moveTo(4, 7); ctx.lineTo(18, 7); ctx.lineTo(11, 18); ctx.closePath(); });
        break;
      case 'sell':
        stroke(() => { ctx.moveTo(11, 4); ctx.lineTo(11, 14); ctx.moveTo(7, 10); ctx.lineTo(11, 14); ctx.lineTo(15, 10); });
        stroke(() => { ctx.moveTo(4, 17); ctx.lineTo(18, 17); });
        break;
      case 'db':
        stroke(() => ctx.ellipse(11, 6, 7, 3, 0, 0, 7));
        stroke(() => { ctx.moveTo(4, 6); ctx.lineTo(4, 16); ctx.bezierCurveTo(4, 19, 18, 19, 18, 16); ctx.lineTo(18, 6); });
        break;
      case 'share':
        stroke(() => { ctx.moveTo(8, 11); ctx.lineTo(14, 7); ctx.moveTo(8, 11); ctx.lineTo(14, 15); });
        fillp(() => { ctx.arc(6, 11, 2.2, 0, 7); ctx.moveTo(16, 7); ctx.arc(16, 7, 2.2, 0, 7); ctx.moveTo(16, 15); ctx.arc(16, 15, 2.2, 0, 7); });
        break;
      case 'withdraw':
        stroke(() => { ctx.roundRect(4, 8, 14, 10, 2); });
        stroke(() => { ctx.moveTo(11, 3); ctx.lineTo(11, 8); ctx.moveTo(8, 6); ctx.lineTo(11, 3); ctx.lineTo(14, 6); });
        break;
      default:
        stroke(() => { ctx.moveTo(11, 4); ctx.lineTo(11, 12); });
        fillp(() => ctx.arc(11, 16, 1.2, 0, 7));
    }
    ctx.restore();
  }

  function applyCam(ctx, th) {
    const canvas = $('#flowCanvas');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // screen-space dot grid
    const step = 22;
    const dpr = canvas._dpr || 1;
    ctx.fillStyle = th.grid;
    const w = canvas.width, h = canvas.height;
    for (let x = (state.cam.x * dpr) % (step * dpr); x < w; x += step * dpr) {
      for (let y = (state.cam.y * dpr) % (step * dpr); y < h; y += step * dpr) {
        ctx.beginPath(); ctx.arc(x, y, 1.05 * dpr, 0, 7); ctx.fill();
      }
    }
    ctx.setTransform(dpr * state.cam.k, 0, 0, dpr * state.cam.k, dpr * state.cam.x, dpr * state.cam.y);
  }

  function drawEdge(ctx, p, th, lit) {
    const grad = ctx.createLinearGradient(p.x1, p.y1, p.x2, p.y2);
    grad.addColorStop(0, p.a.color);
    grad.addColorStop(1, p.b.color);
    ctx.beginPath();
    ctx.moveTo(p.x1, p.y1);
    ctx.bezierCurveTo(p.c1x, p.c1y, p.c2x, p.c2y, p.x2, p.y2);
    ctx.strokeStyle = grad;
    ctx.lineWidth = lit ? 3.2 : 2;
    ctx.globalAlpha = (lit ? 1 : 0.55) * th.edge;
    ctx.shadowColor = p.a.color;
    ctx.shadowBlur = lit ? 14 : 6;
    ctx.stroke();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    if (p.e.label) {
      const mid = bez(p, 0.5);
      ctx.font = '600 9px Inter,system-ui,sans-serif';
      const tw = ctx.measureText(p.e.label).width;
      ctx.fillStyle = th.badge;
      const rx = mid.x - tw / 2 - 5, ry = mid.y - 12;
      ctx.beginPath(); ctx.roundRect(rx, ry, tw + 10, 14, 7); ctx.fill();
      ctx.strokeStyle = p.e.label === 'Reject' ? '#F43F5E' : p.a.color;
      ctx.lineWidth = 1; ctx.globalAlpha = 0.7; ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = p.e.label === 'Reject' ? '#F43F5E' : th.label;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.e.label, mid.x, mid.y - 5);
    }
  }

  function drawNode(ctx, n, now, th) {
    const pulse = state.pulses.get(n.id);
    const amt = pulse ? Math.max(0, 1 - (now - pulse.at) / 900) : 0;
    const err = state.flash.get(n.id);
    const errAmt = err ? Math.max(0, 1 - (now - err) / 1200) : 0;
    const selected = state.selected === n.id;
    const outline = errAmt > 0 ? '#F43F5E' : n.color;
    const glow = 8 + amt * 18 + errAmt * 16;
    ctx.save();
    ctx.translate(n.x, n.y);
    if (amt) ctx.scale(1 + 0.05 * amt, 1 + 0.05 * amt);
    ctx.shadowColor = outline;
    ctx.shadowBlur = glow;
    ctx.fillStyle = th.node;
    ctx.strokeStyle = outline;
    ctx.lineWidth = selected ? 4 : 3;
    ctx.beginPath();
    ctx.roundRect(-NODE_SIZE / 2, -NODE_SIZE / 2, NODE_SIZE, NODE_SIZE, R);
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    icon(ctx, n.icon, '#fff');
    // counters
    const st = state.stats[n.id] || {};
    if (st.events) {
      const label = String(st.events);
      ctx.font = '700 8px Inter,system-ui,sans-serif';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = outline;
      ctx.beginPath(); ctx.roundRect(NODE_SIZE / 2 - tw - 10, -NODE_SIZE / 2 - 6, tw + 8, 12, 6); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, NODE_SIZE / 2 - tw / 2 - 6, -NODE_SIZE / 2);
    }
    ctx.restore();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = '700 11px Inter,system-ui,sans-serif';
    ctx.fillStyle = th.label;
    ctx.fillText(`${n.kind}: ${n.name}`, n.x, n.y + NODE_SIZE / 2 + 8);
    ctx.font = '500 9px Inter,system-ui,sans-serif';
    ctx.fillStyle = th.sub;
    ctx.fillText(n.sub, n.x, n.y + NODE_SIZE / 2 + 22);
    if (st.rejects || st.errors) {
      ctx.fillStyle = '#F43F5E';
      ctx.fillText((st.passes ? st.passes + ' pass · ' : '') + ((st.rejects || 0) + ' rej') + (st.errors ? ' · ' + st.errors + ' err' : ''), n.x, n.y + NODE_SIZE / 2 + 34);
    } else if (st.passes) {
      ctx.fillStyle = '#22C55E';
      ctx.fillText(st.passes + ' pass', n.x, n.y + NODE_SIZE / 2 + 34);
    }
  }

  function draw() {
    const canvas = $('#flowCanvas');
    if (!canvas || !state.open) return;
    const ctx = canvas.getContext('2d');
    const th = theme();
    const now = performance.now();
    applyCam(ctx, th);
    const lit = new Set();
    for (const p of state.particles) {
      if (p.edge) lit.add(p.edge);
    }
    for (const e of state.edges) {
      const p = edgePath(e);
      if (p) drawEdge(ctx, p, th, lit.has(e.id));
    }
    for (const part of state.particles) {
      const e = state.edges.find((x) => x.id === part.edge);
      const p = e && edgePath(e);
      if (!p) continue;
      const pt = bez(p, part.t);
      ctx.beginPath();
      ctx.fillStyle = part.color;
      ctx.shadowColor = part.color;
      ctx.shadowBlur = 12;
      ctx.arc(pt.x, pt.y, 3.4, 0, 7);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    for (const n of state.nodes) drawNode(ctx, n, now, th);
  }

  function tick(ts) {
    if (!state.open) { state.raf = 0; return; }
    if (!tick._last) tick._last = ts;
    const dt = Math.min(40, ts - tick._last) / 1000;
    tick._last = ts;
    let live = false;
    const next = [];
    for (const p of state.particles) {
      p.t += dt * 1.35;
      if (p.t < 1) { next.push(p); live = true; }
    }
    state.particles = next;
    const now = performance.now();
    for (const [k, v] of state.pulses) {
      if (now - v.at < 900) live = true;
      else state.pulses.delete(k);
    }
    for (const [k, v] of state.flash) {
      if (now - v < 1200) live = true;
      else state.flash.delete(k);
    }
    if (live || state.dirty) { draw(); state.dirty = false; }
    state.raf = requestAnimationFrame(tick);
  }

  function resize() {
    const wrap = $('#flowCanvasWrap');
    const canvas = $('#flowCanvas');
    if (!wrap || !canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = wrap.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(r.width * dpr));
    canvas.height = Math.max(1, Math.floor(r.height * dpr));
    canvas._dpr = dpr;
    state.dirty = true;
    draw();
  }

  function fit() {
    const wrap = $('#flowCanvasWrap');
    if (!wrap || !state.nodes.length) return;
    const r = wrap.getBoundingClientRect();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of state.nodes) {
      minX = Math.min(minX, n.x - 60); maxX = Math.max(maxX, n.x + 60);
      minY = Math.min(minY, n.y - 50); maxY = Math.max(maxY, n.y + 80);
    }
    const w = maxX - minX, h = maxY - minY;
    const k = Math.max(0.25, Math.min(1.4, Math.min((r.width - 40) / w, (r.height - 40) / h)));
    state.cam.k = k;
    state.cam.x = (r.width - w * k) / 2 - minX * k;
    state.cam.y = (r.height - h * k) / 2 - minY * k;
    state.dirty = true; draw();
  }

  function screenToWorld(sx, sy) {
    const wrap = $('#flowCanvasWrap').getBoundingClientRect();
    return { x: (sx - wrap.left - state.cam.x) / state.cam.k, y: (sy - wrap.top - state.cam.y) / state.cam.k };
  }
  function hitNode(sx, sy) {
    const w = screenToWorld(sx, sy);
    return state.nodes.find((n) => Math.abs(w.x - n.x) <= 28 && w.y >= n.y - 28 && w.y <= n.y + 58) || null;
  }

  function spawnParticle(from, to, color) {
    const e = state.edges.find((x) => x.from === from && x.to === to)
      || state.edges.find((x) => x.to === to && (!from || x.from === from));
    if (!e) return;
    state.particles.push({ edge: e.id, t: 0, color: color || nodeById(to)?.color || '#fff' });
    if (state.particles.length > 80) state.particles.shift();
  }

  function onEvent(ev) {
    if (!ev || ev.type === 'hello') {
      if (ev && ev.status) setStatus(ev.status);
      return;
    }
    state.events.push(ev);
    if (state.events.length > 2500) state.events.splice(0, state.events.length - 2000);
    const st = state.stats[ev.node] || (state.stats[ev.node] = { events: 0, passes: 0, rejects: 0, errors: 0, lastAt: 0, lastMessage: '' });
    st.events++; st.lastAt = ev.at; st.lastMessage = ev.message || '';
    if (ev.type === 'pass' || ev.ok === true) st.passes++;
    if (ev.type === 'reject' || ev.ok === false) st.rejects++;
    if (ev.type === 'error' || ev.node === 'errors') st.errors++;
    state.pulses.set(ev.node, { at: performance.now() });
    if (ev.type === 'error' || ev.ok === false) state.flash.set(ev.node, performance.now());
    if (ev.from) spawnParticle(ev.from, ev.node, ev.ok === false ? '#F43F5E' : (nodeById(ev.from)?.color));
    if (state.log.paused) state.log.pausedBuf.push(ev);
    else appendLog(ev);
    if (state.selected === ev.node) renderPanel();
    state.dirty = true;
  }

  function fmtTime(at) {
    try {
      return new Date(at).toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Africa/Lagos' });
    } catch { return new Date(at).toISOString().slice(11, 19); }
  }
  function matchLog(ev) {
    const L = state.log;
    if (L.type && ev.type !== L.type) return false;
    if (L.agent && ev.agent !== L.agent && ev.node !== L.agent) return false;
    if (L.errors && !(ev.type === 'error' || ev.ok === false || ev.node === 'errors')) return false;
    if (L.coin) {
      const c = L.coin.replace(/^\$/, '').toLowerCase();
      if (String(ev.symbol || '').toLowerCase() !== c && String(ev.mint || '').toLowerCase() !== c) return false;
    }
    if (L.q) {
      const blob = `${ev.message || ''} ${ev.symbol || ''} ${ev.node || ''} ${ev.type || ''} ${ev.agent || ''}`.toLowerCase();
      if (!blob.includes(L.q.toLowerCase())) return false;
    }
    return true;
  }
  function appendLog(ev, batch) {
    if (!matchLog(ev)) return;
    const box = $('#flowLines');
    if (!box) return;
    const row = document.createElement('div');
    const col = (colors()[ev.node] || '#A1A1AA');
    row.className = 'ev' + (ev.type === 'error' || ev.ok === false ? ' err' : ev.ok === true ? ' ok' : '');
    row.innerHTML = `<span class="t">${fmtTime(ev.at)}</span><span class="n" style="--nc:${col}">${esc(ev.node)}</span><span class="m">${esc(ev.message || ev.type)}</span>`;
    row.onclick = () => selectNode(ev.node);
    box.appendChild(row);
    if (!batch) {
      while (box.children.length > 500) box.removeChild(box.firstChild);
      box.scrollTop = box.scrollHeight;
    }
  }
  function rebuildLog() {
    const box = $('#flowLines');
    if (!box) return;
    box.innerHTML = '';
    const list = state.events.filter(matchLog).slice(-400);
    for (const ev of list) appendLog(ev, true);
    box.scrollTop = box.scrollHeight;
  }
  function esc(s) { return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function setStatus(s) {
    state.status = { ...state.status, ...s };
    const mode = $('#flowMode');
    if (mode) {
      mode.textContent = state.status.mode || (state.status.dryRun ? 'PAPER' : 'LIVE');
      mode.className = 'flow-pill ' + ((state.status.mode || 'PAPER') === 'LIVE' ? 'live' : 'paper');
    }
    const run = $('#flowRun');
    if (run) {
      run.classList.toggle('off', !state.status.running);
      run.querySelector('span').textContent = state.status.running ? 'RUNNING' : 'PAUSED';
    }
  }

  function pretty(v) {
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  }
  function ago(at) {
    if (!at) return '—';
    const s = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    return Math.round(s / 3600) + 'h ago';
  }

  function renderPanel() {
    const n = nodeById(state.selected);
    const panel = $('#flowPanel');
    if (!n || !panel) return;
    panel.classList.remove('hidden');
    const st = state.stats[n.id] || {};
    const cfg = state.configs[n.id] || {};
    $('#flowPIcon').style.background = n.color;
    $('#flowPIcon').style.setProperty('--nc', n.color);
    $('#flowPName').textContent = `${n.kind}: ${n.name}`;
    $('#flowPSub').textContent = n.sub;
    const kv = Object.entries(cfg).map(([k, v]) => `<span>${esc(k)}</span><b>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</b>`).join('');
    const extras = `<span>events</span><b>${st.events || 0}</b><span>passes</span><b>${st.passes || 0}</b><span>rejects</span><b>${st.rejects || 0}</b><span>errors</span><b>${st.errors || 0}</b><span>last activity</span><b>${esc(ago(st.lastAt))}</b>`;
    $('#flowPConfig').innerHTML = extras + kv;
    const coin = ($('#flowPCoin')?.value || state.coinFilter || '').replace(/^\$/, '').toLowerCase();
    const evs = state.events.filter((e) => e.node === n.id && (!coin || String(e.symbol || '').toLowerCase() === coin || String(e.mint || '').toLowerCase() === coin)).slice(-12).reverse();
    $('#flowPJson').textContent = evs.length ? pretty(evs) : 'No events yet for this node.';
    $('#flowPConfigWrap').classList.toggle('hidden', state.panelTab !== 'settings');
    $('#flowPEventsWrap').classList.toggle('hidden', state.panelTab !== 'params');
  }

  function selectNode(id) {
    state.selected = id;
    state.dirty = true;
    renderPanel();
    $$('.flow-ptabs button').forEach((b, i) => b.classList.toggle('on', (i === 0 ? 'settings' : 'params') === state.panelTab));
    draw();
  }

  function closePanel() {
    state.selected = null;
    $('#flowPanel')?.classList.add('hidden');
    state.dirty = true; draw();
  }

  function bindCanvas() {
    const wrap = $('#flowCanvasWrap');
    if (!wrap || wrap._bound) return;
    wrap._bound = true;
    wrap.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      wrap.setPointerCapture(e.pointerId);
      state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (state.pointers.size === 2) {
        const [a, b] = [...state.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        state.pinch = { d, k: state.cam.k };
        state.dragging = false;
      } else {
        const n = hitNode(e.clientX, e.clientY);
        if (n) { selectNode(n.id); state.dragging = false; state.last = null; }
        else { state.dragging = true; state.last = { x: e.clientX, y: e.clientY }; wrap.classList.add('drag'); }
      }
    });
    wrap.addEventListener('pointermove', (e) => {
      if (state.pointers.has(e.pointerId)) state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (state.pinch && state.pointers.size === 2) {
        const [a, b] = [...state.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, state.pinch.k * (d / (state.pinch.d || d)));
        return;
      }
      if (!state.dragging || !state.last) return;
      state.cam.x += e.clientX - state.last.x;
      state.cam.y += e.clientY - state.last.y;
      state.last = { x: e.clientX, y: e.clientY };
      state.dirty = true; draw();
    });
    const up = (e) => {
      state.pointers.delete(e.pointerId);
      if (state.pointers.size < 2) state.pinch = null;
      state.dragging = false; state.last = null; wrap.classList.remove('drag');
    };
    wrap.addEventListener('pointerup', up);
    wrap.addEventListener('pointercancel', up);
    wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      zoomAt(e.clientX, e.clientY, state.cam.k * factor);
    }, { passive: false });
    wrap.addEventListener('dblclick', (e) => {
      if (hitNode(e.clientX, e.clientY)) return;
      fit();
    });
  }
  function zoomAt(cx, cy, k) {
    const wrap = $('#flowCanvasWrap').getBoundingClientRect();
    const nx = Math.max(0.2, Math.min(2.4, k));
    const px = cx - wrap.left, py = cy - wrap.top;
    const wx = (px - state.cam.x) / state.cam.k;
    const wy = (py - state.cam.y) / state.cam.k;
    state.cam.k = nx;
    state.cam.x = px - wx * nx;
    state.cam.y = py - wy * nx;
    state.dirty = true; draw();
  }

  async function loadGraph() {
    const r = await fetch('/api/flow', { credentials: 'same-origin' });
    if (r.status === 401) {
      $('#flowLines').innerHTML = '<div class="ev"><span class="m">Login required to view the live pipeline.</span></div>';
      return false;
    }
    if (!r.ok) throw new Error('flow graph failed');
    const d = await r.json();
    state.nodes = d.nodes; state.edges = d.edges; state.world = d.world || state.world;
    state.stats = d.stats || {}; state.configs = d.configs || {};
    setStatus(d.status || {});
    buildLegend();
    return true;
  }
  async function loadHistory() {
    const r = await fetch('/api/flow/events?limit=500', { credentials: 'same-origin' });
    if (!r.ok) return;
    const d = await r.json();
    state.events = d.events || [];
    if (d.stats) state.stats = d.stats;
    if (d.status) setStatus(d.status);
    rebuildLog();
    for (const ev of state.events.slice(-8)) {
      state.pulses.set(ev.node, { at: performance.now() });
      if (ev.from) spawnParticle(ev.from, ev.node, nodeById(ev.from)?.color);
    }
  }
  function connectSSE() {
    if (state.sse) { try { state.sse.close(); } catch {} }
    const es = new EventSource('/api/flow/stream');
    state.sse = es;
    es.onmessage = (m) => {
      try { onEvent(JSON.parse(m.data)); } catch {}
    };
    es.onerror = () => { /* browser will retry */ };
  }

  function buildLegend() {
    const box = $('#flowLegend');
    if (!box) return;
    box.innerHTML = '<h4>PIPELINE NODES</h4>' + state.nodes.map((n) =>
      `<button type="button" data-nid="${n.id}"><i style="background:${n.color}"></i>${esc(n.kind)}: ${esc(n.name)}</button>`
    ).join('');
    $$('#flowLegend button').forEach((b) => b.onclick = () => {
      selectNode(b.dataset.nid);
      const n = nodeById(b.dataset.nid);
      if (!n) return;
      const wrap = $('#flowCanvasWrap').getBoundingClientRect();
      state.cam.x = wrap.width / 2 - n.x * state.cam.k;
      state.cam.y = wrap.height / 2 - n.y * state.cam.k;
      state.dirty = true; draw();
    });
  }

  function exportLog(kind) {
    const rows = state.events.filter(matchLog);
    let blob, name;
    if (kind === 'csv') {
      const cols = ['id', 'at', 'iso', 'node', 'type', 'symbol', 'mint', 'agent', 'ok', 'message'];
      const lines = [cols.join(',')].concat(rows.map((e) => cols.map((c) => {
        let v = c === 'iso' ? new Date(e.at).toISOString() : e[c];
        if (v == null) return '';
        v = String(v);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(',')));
      blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      name = 'devameer-pipeline.csv';
    } else {
      blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
      name = 'devameer-pipeline.json';
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function bindChrome() {
    if (bindChrome._done) return;
    bindChrome._done = true;
    $('#flowBack')?.addEventListener('click', () => {
      const opts = window.DEVAMEER_FLOW_OPTS || {};
      if (opts.standalone && opts.dashboardUrl) { location.href = opts.dashboardUrl; return; }
      const home = document.querySelector('.nav [data-go="home"]');
      home && home.click();
    });
    $('#flowFit')?.addEventListener('click', fit);
    $('#flowZoomIn')?.addEventListener('click', () => {
      const r = $('#flowCanvasWrap').getBoundingClientRect();
      zoomAt(r.left + r.width / 2, r.top + r.height / 2, state.cam.k * 1.15);
    });
    $('#flowZoomOut')?.addEventListener('click', () => {
      const r = $('#flowCanvasWrap').getBoundingClientRect();
      zoomAt(r.left + r.width / 2, r.top + r.height / 2, state.cam.k * 0.87);
    });
    $('#flowPanelX')?.addEventListener('click', closePanel);
    $$('.flow-ptabs button').forEach((b) => b.onclick = () => {
      state.panelTab = b.dataset.ptab;
      $$('.flow-ptabs button').forEach((x) => x.classList.toggle('on', x === b));
      renderPanel();
    });
    $('#flowPCoin')?.addEventListener('input', (e) => { state.coinFilter = e.target.value; renderPanel(); });
    $('#flowReveal')?.addEventListener('click', () => {
      if (state.selected) {
        state.log.q = '';
        $('#flowQ').value = '';
        // filter log to this node via type? use search of node id
        state.log.q = '';
        // temporarily filter by injecting a node filter
        const prev = matchLog;
        const node = state.selected;
        const box = $('#flowLines');
        box.innerHTML = '';
        for (const ev of state.events.filter((e) => e.node === node).slice(-400)) {
          const row = document.createElement('div');
          row.className = 'ev';
          row.innerHTML = `<span class="t">${fmtTime(ev.at)}</span><span class="n">${esc(ev.node)}</span><span class="m">${esc(ev.message || ev.type)}</span>`;
          box.appendChild(row);
        }
        box.scrollTop = box.scrollHeight;
        $('#flowLog')?.classList.add('open', 'expanded');
      }
    });
    $('#flowPause')?.addEventListener('click', () => {
      state.log.paused = !state.log.paused;
      $('#flowPause').classList.toggle('on', !state.log.paused);
      $('#flowPause').textContent = state.log.paused ? 'Resume' : 'Pause';
      if (!state.log.paused) {
        for (const ev of state.log.pausedBuf) appendLog(ev, true);
        state.log.pausedBuf = [];
        $('#flowLines').scrollTop = $('#flowLines').scrollHeight;
      }
    });
    $('#flowQ')?.addEventListener('input', (e) => { state.log.q = e.target.value; rebuildLog(); });
    $('#flowType')?.addEventListener('change', (e) => { state.log.type = e.target.value; rebuildLog(); });
    $('#flowAgent')?.addEventListener('change', (e) => { state.log.agent = e.target.value; rebuildLog(); });
    $('#flowCoin')?.addEventListener('input', (e) => { state.log.coin = e.target.value; rebuildLog(); });
    $('#flowErrs')?.addEventListener('change', (e) => { state.log.errors = e.target.checked; rebuildLog(); });
    $('#flowCsv')?.addEventListener('click', () => exportLog('csv'));
    $('#flowJson')?.addEventListener('click', () => exportLog('json'));
    $('#flowLegendBtn')?.addEventListener('click', () => { $('#flowLegend').classList.toggle('open'); $('#flowLegendBtn').classList.toggle('on'); });
    ['#flowSearchBtn','#flowSearchBtn2'].forEach((id) => $(id)?.addEventListener('click', () => { $('#flowQ')?.focus(); $('#flowLog')?.classList.add('open', 'expanded'); }));
    $('#flowTermBtn')?.addEventListener('click', () => { $('#flowLog')?.classList.toggle('open'); });
    $('#flowRun')?.addEventListener('click', async () => {
      if ((window.DEVAMEER_FLOW_OPTS || {}).standalone) return; // read-only on the standalone site
      try {
        await fetch(state.status.running ? '/api/stop' : '/api/start', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' });
      } catch {}
    });
    window.addEventListener('resize', () => { if (state.open) resize(); });
    new MutationObserver(() => { if (state.open) { state.dirty = true; draw(); } })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  async function open() {
    state.open = true;
    bindChrome();
    bindCanvas();
    resize();
    const ok = await loadGraph();
    if (ok) {
      await loadHistory();
      fit();
      connectSSE();
    }
    if (!state.raf) state.raf = requestAnimationFrame(tick);
  }
  function close() {
    state.open = false;
    if (state.sse) { try { state.sse.close(); } catch {} state.sse = null; }
    if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
    $('#flowLegend')?.classList.remove('open');
  }

  window.DevameerFlow = { open, close, resize, fit, setStatus };
})();
