/* Devameer Bot Pipeline — dark, full-screen, live motion driven by real SSE events. */
(() => {
  const NODE = 52;
  const R = 13;
  const PARTICLE_CAP_DESK = 320;
  const PARTICLE_CAP_MOB = 160;
  const CHIP_CAP = 48;
  const IDLE_RESUME_MS = 10000;

  const state = {
    nodes: [],
    edges: [],
    stats: {},
    status: { mode: 'PAPER', running: false, dryRun: true },
    cam: { x: 0, y: 0, k: 1, tx: 0, ty: 0, tk: 1, auto: true, userAt: 0 },
    fit: { x: 0, y: 0, k: 1 },
    heat: new Map(),
    pulse: new Map(),
    particles: [],
    chips: [],
    chipBySymbol: new Map(),
    shown: {},
    pnl: {},
    lastEv: {},
    focus: { x: 0, y: 0, w: 1, at: 0 },
    activity: [],
    hover: null,
    sse: null,
    raf: 0,
    open: false,
    dragging: false,
    lastPtr: null,
    pointers: new Map(),
    pinch: null,
    live: false,
    t0: performance.now(),
    holdLive: false,
    queued: [],
    freezeWorld: false,
    rec: null,
    onCaptureFrame: null,
  };

  const clock = {
    useSim: false,
    sim: 0,
    now() { return this.useSim ? this.sim : performance.now(); },
  };

  const isMob = () => Math.min(window.innerWidth, window.innerHeight) < 720 || 'ontouchstart' in window;
  const cap = () => isMob() ? PARTICLE_CAP_MOB : PARTICLE_CAP_DESK;
  const $ = (s, r = document) => r.querySelector(s);
  const nodeById = (id) => state.nodes.find((n) => n.id === id);

  function relabel(n) {
    if (n.id === 'exits') { n.kind = 'Exits'; n.name = 'PnL'; n.sub = 'Take profit / SL'; }
    return n;
  }

  function edgePath(e) {
    const a = nodeById(e.from), b = nodeById(e.to);
    if (!a || !b) return null;
    const x1 = a.x + NODE / 2, y1 = a.y;
    const x2 = b.x - NODE / 2, y2 = b.y;
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

  function icon(ctx, kind) {
    ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 1.7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
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
        stroke(() => { ctx.moveTo(4, 16); ctx.lineTo(18, 16); });
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

  function findEdge(from, to) {
    return state.edges.find((e) => e.from === from && e.to === to)
      || (to ? state.edges.find((e) => e.to === to && (!from || e.from === from)) : null);
  }

  function addHeat(edgeId, amt) {
    if (!edgeId) return;
    state.heat.set(edgeId, Math.min(1, (state.heat.get(edgeId) || 0) + amt));
  }

  function spawnParticles(edgeId, n, color, speedMul) {
    const e = state.edges.find((x) => x.id === edgeId);
    if (!e) return;
    const max = cap();
    for (let i = 0; i < n; i++) {
      if (state.particles.length >= max) state.particles.shift();
      state.particles.push({
        edge: edgeId,
        t: Math.random() * 0.08,
        speed: (0.42 + Math.random() * 0.55) * (speedMul || 1),
        r: 1.6 + Math.random() * 2.2,
        color: color || nodeById(e.from)?.color || '#fff',
        alpha: 0.85 + Math.random() * 0.15,
      });
    }
  }

  function spawnChip(symbol, from, to, fate) {
    const e = findEdge(from, to);
    if (!e) return null;
    if (state.chips.length >= CHIP_CAP) state.chips.shift();
    const chip = {
      symbol: String(symbol || '?').replace(/^\$/, '').slice(0, 10),
      edge: e.id,
      t: 0,
      speed: 0.55 + Math.random() * 0.25,
      fate: fate || 'run', // run | reject | pass
      color: nodeById(from)?.color || '#3B82F6',
      x: 0, y: 0, vy: 0, falling: false, alpha: 1,
      at: clock.now(),
    };
    state.chips.push(chip);
    if (symbol) state.chipBySymbol.set(String(symbol).replace(/^\$/, '').toUpperCase(), chip);
    return chip;
  }

  function powerOf(ev) {
    if (ev.type === 'buy' || ev.type === 'sell' || ev.type === 'exit') return ev.ok === false ? 1.1 : 1.6;
    if (ev.type === 'ready' || (ev.data && ev.data.pnlPct > 0) || ev.type === 'pass') return 1.25;
    if (ev.type === 'error' || ev.ok === false || ev.type === 'reject') return 1.15;
    return 0.85;
  }

  function onEvent(ev, opts) {
    if (ev && ev.status) setStatus(ev.status);
    if (!ev || ev.type === 'hello') {
      return;
    }
    const nowTs = (opts && opts.now != null) ? opts.now : clock.now();
    const silent = !!(opts && opts.silent);
    const n = ev.node;
    const st = state.stats[n] || (state.stats[n] = { events: 0, passes: 0, rejects: 0, errors: 0, lastAt: 0, lastMessage: '' });
    st.events++; st.lastAt = ev.at || Date.now(); st.lastMessage = ev.message || ev.type || '';
    if (ev.type === 'pass' || ev.ok === true) st.passes++;
    if (ev.type === 'reject' || ev.ok === false) st.rejects++;
    if (ev.type === 'error') st.errors++;
    state.lastEv[n] = ev;
    const pow = powerOf(ev);
    const reason = ev.data && ev.data.reason;
    if (reason === 'daily cap') setStatus({ dailyLossHit: true });
    else if (reason === 'goal hold') setStatus({ goalHold: true });
    if (silent) {
      return;
    }
    state.pulse.set(n, { at: nowTs, pow, err: ev.ok === false || ev.type === 'error' || ev.type === 'reject' });

    const from = ev.from;
    const edge = findEdge(from, n);
    if (edge) {
      addHeat(edge.id, ev.type === 'token' || ev.type === 'tick' ? 0.35 : 0.7);
      const burst = ev.type === 'token' ? 5 : ev.type === 'buy' || ev.type === 'sell' || ev.type === 'exit' ? 14 : ev.type === 'tick' ? 3 : 8;
      spawnParticles(edge.id, burst, ev.ok === false ? '#F43F5E' : (from && nodeById(from)?.color) || nodeById(n)?.color, ev.type === 'buy' || ev.type === 'sell' ? 1.35 : 1);
    } else if (n) {
      // heat incoming edges to this node
      for (const e of state.edges) if (e.to === n) {
        addHeat(e.id, 0.25);
        spawnParticles(e.id, 2, nodeById(e.from)?.color, 1);
      }
    }

    const sym = ev.symbol ? String(ev.symbol).replace(/^\$/, '') : '';
    if (ev.type === 'token' && n === 'feed' && sym) {
      spawnChip(sym, 'feed', 'rugs', 'run');
    } else if (sym && (ev.type === 'reject' || ev.ok === false) && (n === 'rugs' || n === 'errors' || ev.from === 'rugs')) {
      const c = state.chipBySymbol.get(sym.toUpperCase());
      if (c) { c.fate = 'reject'; c.color = '#F43F5E'; }
      else spawnChip(sym, ev.from || 'feed', n === 'errors' ? 'errors' : 'rugs', 'reject');
    } else if (sym && (ev.type === 'pass' || ev.type === 'candidate') && (n === 'rugs' || ev.agent || ['sniper', 'scout', 'curve', 'graduate'].includes(n))) {
      const agent = ev.agent || (['sniper', 'scout', 'curve', 'graduate'].includes(n) ? n : null);
      const c = state.chipBySymbol.get(sym.toUpperCase());
      if (c) { c.fate = 'pass'; c.next = agent || 'risk'; }
      else if (agent) spawnChip(sym, 'rugs', agent, 'pass');
    } else if (sym && ev.type === 'buy') {
      const c = state.chipBySymbol.get(sym.toUpperCase());
      if (c) c.next = 'buy';
    } else if (sym && (ev.type === 'exit' || ev.type === 'sell')) {
      const c = state.chipBySymbol.get(sym.toUpperCase());
      if (c) c.next = ev.type === 'exit' ? 'exits' : 'sell';
      const pct = ev.data && typeof ev.data.pnlPct === 'number' ? ev.data.pnlPct : null;
      if (pct != null) {
        state.pnl.exits = pct;
        state.pnl.sell = pct;
      }
      if (pct != null && pct > 0) {
        state.pulse.set('exits', { at: nowTs, pow: 2, err: false, win: true });
        const ex = findEdge('exits', 'sell') || findEdge('monitor', 'exits');
        if (ex) { addHeat(ex.id, 1); spawnParticles(ex.id, 18, '#22C55E', 1.4); }
      }
    }

    const nd = nodeById(n);
    if (nd) {
      state.activity.push({ x: nd.x, y: nd.y, at: nowTs, w: pow });
      if (state.activity.length > 20) state.activity.shift();
      state.focus.at = nowTs;
    }
  }

  function setStatus(s) {
    state.status = { ...state.status, ...s };
    const pill = $('#modePill');
    if (pill) {
      const mode = state.status.mode || (state.status.dryRun ? 'PAPER' : 'LIVE');
      pill.textContent = mode;
      pill.className = 'mode-pill ' + (mode === 'LIVE' ? 'live' : 'paper');
    }
    const cap = $('#capPill');
    if (cap) {
      const hit = !!state.status.dailyLossHit;
      const hold = !!state.status.goalHold;
      cap.classList.toggle('hidden', !hit && !hold);
      if (hit) cap.textContent = 'DAILY CAP';
      else if (hold) cap.textContent = 'GOAL HOLD';
    }
  }
  function setLive(on) {
    state.live = on;
    $('#liveDot')?.classList.toggle('off', !on);
  }

  function viewSize() {
    const wrap = $('#wrap');
    if (!wrap) return { w: 1, h: 1 };
    const r = wrap.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }
  function computeFit(viewW, viewH) {
    if (!state.nodes.length) return state.fit;
    const implicit = viewW == null || viewH == null;
    if (implicit) { const v = viewSize(); viewW = v.w; viewH = v.h; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of state.nodes) {
      minX = Math.min(minX, n.x - 110); maxX = Math.max(maxX, n.x + 130);
      minY = Math.min(minY, n.y - 90); maxY = Math.max(maxY, n.y + 110);
    }
    const w = Math.max(200, maxX - minX), h = Math.max(200, maxY - minY);
    const k = Math.max(0.22, Math.min(1.35, Math.min((viewW - 48) / w, (viewH - 48) / h)));
    const fit = { k, x: (viewW - w * k) / 2 - minX * k, y: (viewH - h * k) / 2 - minY * k };
    if (implicit) state.fit = fit;
    return fit;
  }
  function goFit(immediate) {
    computeFit();
    state.cam.tx = state.fit.x; state.cam.ty = state.fit.y; state.cam.tk = state.fit.k;
    if (immediate) { state.cam.x = state.fit.x; state.cam.y = state.fit.y; state.cam.k = state.fit.k; }
    state.cam.auto = true;
  }

  function nodeBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of state.nodes) {
      minX = Math.min(minX, n.x - 110); maxX = Math.max(maxX, n.x + 130);
      minY = Math.min(minY, n.y - 90); maxY = Math.max(maxY, n.y + 110);
    }
    return { minX, minY, maxX, maxY };
  }

  function clampCam(tx, ty, k, viewW, viewH, fit) {
    if (viewW == null) { const v = viewSize(); viewW = v.w; viewH = v.h; }
    const { minX, minY, maxX, maxY } = nodeBounds();
    const pad = 20;
    const minTx = viewW - pad - maxX * k;
    const maxTx = pad - minX * k;
    const minTy = viewH - pad - maxY * k;
    const maxTy = pad - minY * k;
    const fb = fit || state.fit;
    if (minTx <= maxTx) tx = Math.min(maxTx, Math.max(minTx, tx));
    else tx = fb.x;
    if (minTy <= maxTy) ty = Math.min(maxTy, Math.max(minTy, ty));
    else ty = fb.y;
    return { tx, ty };
  }

  function updateCamera(dt, now, cam, viewW, viewH, fit) {
    cam = cam || state.cam;
    if (viewW == null) { const v = viewSize(); viewW = v.w; viewH = v.h; }
    if (!fit) fit = (cam === state.cam) ? (computeFit(), state.fit) : computeFit(viewW, viewH);
    if (now - (cam.userAt || 0) > IDLE_RESUME_MS) cam.auto = true;
    if (cam.auto) {
      const recent = state.activity.filter((a) => now - a.at < 3500 && a.w >= 1.1);
      if (recent.length && now - state.focus.at < 8000) {
        let sx = 0, sy = 0, sw = 0;
        for (const a of recent) { sx += a.x * a.w; sy += a.y * a.w; sw += a.w; }
        const cx = sx / sw, cy = sy / sw;
        const k = fit.k * 1.05;
        const blend = 0.22;
        let tx = fit.x * (1 - blend) + (viewW / 2 - cx * k) * blend;
        let ty = fit.y * (1 - blend) + (viewH / 2 - cy * k) * blend;
        const c = clampCam(tx, ty, k, viewW, viewH, fit);
        cam.tk = k;
        cam.tx = c.tx;
        cam.ty = c.ty;
      } else {
        cam.tx = fit.x; cam.ty = fit.y; cam.tk = fit.k;
      }
    }
    const ease = 1 - Math.exp(-dt * 2.4);
    cam.x += (cam.tx - cam.x) * ease;
    cam.y += (cam.ty - cam.y) * ease;
    cam.k += (cam.tk - cam.k) * ease;
  }

  function markUser() {
    state.cam.auto = false;
    state.cam.userAt = performance.now();
    state.cam.tx = state.cam.x; state.cam.ty = state.cam.y; state.cam.tk = state.cam.k;
  }

  function screenToWorld(sx, sy) {
    const wrap = $('#wrap').getBoundingClientRect();
    return { x: (sx - wrap.left - state.cam.x) / state.cam.k, y: (sy - wrap.top - state.cam.y) / state.cam.k };
  }
  function hitNode(sx, sy) {
    const w = screenToWorld(sx, sy);
    return state.nodes.find((n) => Math.abs(w.x - n.x) <= 30 && w.y >= n.y - 30 && w.y <= n.y + 62) || null;
  }

  function stepShown(dt) {
    for (const n of state.nodes) {
      const st = state.stats[n.id] || { events: 0, passes: 0, rejects: 0 };
      const sh = state.shown[n.id] || (state.shown[n.id] = { e: 0, p: 0, r: 0, pnl: 0 });
      sh.e += (st.events - sh.e) * Math.min(1, dt * 7);
      sh.p += (st.passes - sh.p) * Math.min(1, dt * 7);
      sh.r += ((st.rejects || 0) - sh.r) * Math.min(1, dt * 7);
      if (n.id === 'exits' && state.pnl.exits != null) sh.pnl += (state.pnl.exits - sh.pnl) * Math.min(1, dt * 6);
    }
  }

  function draw(now, dt, target) {
    const canvas = (target && target.canvas) || $('#cv');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = (target && target.dpr) || canvas._dpr || 1;
    const cam = (target && target.cam) || state.cam;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0B0B0D';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // screen-space dot grid
    const step = 22 * dpr;
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    const ox = (cam.x * dpr) % step, oy = (cam.y * dpr) % step;
    for (let x = ox; x < canvas.width; x += step) {
      for (let y = oy; y < canvas.height; y += step) {
        ctx.beginPath(); ctx.arc(x, y, 1.05 * dpr, 0, 7); ctx.fill();
      }
    }

    ctx.setTransform(dpr * cam.k, 0, 0, dpr * cam.k, dpr * cam.x, dpr * cam.y);

    // edges
    for (const e of state.edges) {
      const p = edgePath(e);
      if (!p) continue;
      const heat = state.heat.get(e.id) || 0;
      const grad = ctx.createLinearGradient(p.x1, p.y1, p.x2, p.y2);
      grad.addColorStop(0, p.a.color);
      grad.addColorStop(1, p.b.color);
      ctx.beginPath();
      ctx.moveTo(p.x1, p.y1);
      ctx.bezierCurveTo(p.c1x, p.c1y, p.c2x, p.c2y, p.x2, p.y2);
      ctx.strokeStyle = grad;
      ctx.globalAlpha = 0.18 + heat * 0.75;
      ctx.lineWidth = 1.4 + heat * 2.6;
      ctx.shadowColor = p.a.color;
      ctx.shadowBlur = heat > 0.08 ? 8 + heat * 14 : 0;
      ctx.stroke();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }

    // particles
    ctx.globalCompositeOperation = 'lighter';
    for (const part of state.particles) {
      const e = state.edges.find((x) => x.id === part.edge);
      const p = e && edgePath(e);
      if (!p) continue;
      for (let k = 0; k < 3; k++) {
        const tt = part.t - k * 0.035;
        if (tt < 0 || tt > 1) continue;
        const pt = bez(p, tt);
        ctx.beginPath();
        ctx.fillStyle = part.color;
        ctx.globalAlpha = part.alpha * (1 - k * 0.38);
        ctx.arc(pt.x, pt.y, part.r * (1 - k * 0.25), 0, 7);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // chips
    for (const c of state.chips) {
      ctx.save();
      ctx.globalAlpha = c.alpha;
      ctx.font = '700 10px Inter,system-ui,sans-serif';
      const label = '$' + c.symbol;
      const tw = ctx.measureText(label).width;
      const w = tw + 12, h = 16;
      ctx.translate(c.x, c.y);
      ctx.fillStyle = '#121214';
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = c.color;
      ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 8); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#FAFAFA';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, 0, 0.5);
      ctx.restore();
    }

    // nodes
    const breath = 0.5 + 0.5 * Math.sin(now / 900);
    for (const n of state.nodes) {
      const pul = state.pulse.get(n.id);
      const age = pul ? (now - pul.at) / (pul.win ? 1400 : 900) : 1;
      const amt = pul && age < 1 ? (1 - age) * (pul.pow || 1) : 0;
      const feedIdle = n.id === 'feed' ? 0.35 + 0.35 * breath : 0;
      const glow = 7 + Math.max(amt, feedIdle) * 22;
      const outline = pul && pul.err && amt > 0.15 ? '#F43F5E' : (pul && pul.win && amt > 0.15 ? '#22C55E' : n.color);
      ctx.save();
      ctx.translate(n.x, n.y);
      if (amt) ctx.scale(1 + 0.06 * Math.min(amt, 1.8), 1 + 0.06 * Math.min(amt, 1.8));
      ctx.shadowColor = outline;
      ctx.shadowBlur = glow;
      ctx.fillStyle = '#121214';
      ctx.strokeStyle = outline;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(-NODE / 2, -NODE / 2, NODE, NODE, R);
      ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      icon(ctx, n.icon);

      // rolling counters inside the node
      const st = state.stats[n.id] || { events: 0, passes: 0, rejects: 0 };
      const sh = state.shown[n.id] || (state.shown[n.id] = { e: 0, p: 0, r: 0, pnl: 0 });
      const evN = Math.round(sh.e);
      ctx.font = '700 8px Inter,system-ui,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      if (n.id === 'exits' && state.pnl.exits != null) {
        ctx.fillStyle = sh.pnl >= 0 ? '#86EFAC' : '#FCA5A5';
        ctx.fillText((sh.pnl >= 0 ? '+' : '') + Math.round(sh.pnl * 100) + '%', 0, NODE / 2 - 9);
      } else if (evN) {
        ctx.fillText(String(evN), 0, NODE / 2 - 9);
      }
      ctx.restore();

      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.font = '700 11px Inter,system-ui,sans-serif';
      ctx.fillStyle = '#FAFAFA';
      ctx.fillText(`${n.kind}: ${n.name}`, n.x, n.y + NODE / 2 + 8);
      ctx.font = '500 9px Inter,system-ui,sans-serif';
      ctx.fillStyle = '#A1A1AA';
      ctx.fillText(n.sub, n.x, n.y + NODE / 2 + 22);
      if (st.passes || st.rejects) {
        ctx.fillStyle = st.rejects ? '#F43F5E' : '#22C55E';
        const bits = [];
        if (st.passes) bits.push(Math.round(sh.p) + ' pass');
        if (st.rejects) bits.push(Math.round(sh.r) + ' rej');
        ctx.fillText(bits.join(' · '), n.x, n.y + NODE / 2 + 34);
      }
    }

    if (target && target.watermark) {
      const cssW = canvas.width / dpr, cssH = canvas.height / dpr;
      drawWatermark(ctx, cssW, cssH, dpr);
    }
  }

  function drawWatermark(ctx, cssW, cssH, dpr) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const scale = Math.max(0.85, Math.min(cssW, cssH) / 1080);
    const x = 28 * scale, y = 28 * scale;
    ctx.save();
    ctx.font = '700 ' + Math.round(22 * scale) + 'px Inter,system-ui,sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 8 * scale;
    ctx.fillStyle = '#FAFAFA';
    const title = 'Devameer Bot Pipeline';
    ctx.fillText(title, x, y);
    const tw = ctx.measureText(title).width;
    let px = x + tw + 14 * scale;
    const pulse = 0.5 + 0.5 * Math.sin((nowOf() / 1200) * Math.PI * 2);
    ctx.beginPath();
    ctx.fillStyle = 'rgba(34,197,94,' + (0.55 + 0.45 * pulse) + ')';
    ctx.shadowColor = '#22C55E';
    ctx.shadowBlur = 10 * scale;
    ctx.arc(px + 5 * scale, y, 5 * scale, 0, 7);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.font = '800 ' + Math.round(11 * scale) + 'px Inter,system-ui,sans-serif';
    ctx.fillStyle = '#86EFAC';
    ctx.fillText('LIVE', px + 14 * scale, y);
    const liveW = ctx.measureText('LIVE').width;
    px += 14 * scale + liveW + 12 * scale;
    const mode = state.status.mode || (state.status.dryRun ? 'PAPER' : 'LIVE');
    const paper = mode !== 'LIVE';
    const label = paper ? 'PAPER' : 'LIVE';
    ctx.font = '800 ' + Math.round(10 * scale) + 'px Inter,system-ui,sans-serif';
    const pw = ctx.measureText(label).width + 16 * scale;
    const ph = 18 * scale;
    ctx.fillStyle = paper ? '#27272A' : '#14532D';
    ctx.beginPath();
    ctx.roundRect(px, y - ph / 2, pw, ph, ph / 2);
    ctx.fill();
    ctx.fillStyle = paper ? '#FCD34D' : '#86EFAC';
    ctx.textAlign = 'center';
    ctx.fillText(label, px + pw / 2, y);
    ctx.restore();
  }
  function nowOf() { return clock.now(); }

  function stepChips(dt) {
    const next = [];
    for (const c of state.chips) {
      if (c.falling) {
        c.vy += 420 * dt;
        c.y += c.vy * dt;
        c.alpha -= dt * 1.4;
        if (c.alpha > 0) next.push(c);
        continue;
      }
      const e = state.edges.find((x) => x.id === c.edge);
      const p = e && edgePath(e);
      if (!p) continue;
      c.t += c.speed * dt;
      if (c.t >= 1) {
        if (c.fate === 'reject') {
          c.falling = true; c.vy = 30; c.t = 1;
          const pt = bez(p, 1);
          c.x = pt.x; c.y = pt.y;
          next.push(c);
          continue;
        }
        const dest = e.to;
        let nxt = c.next;
        c.next = null;
        let ne = null;
        if (nxt) ne = findEdge(dest, nxt);
        if (!ne && dest === 'rugs' && c.fate === 'pass' && nxt) ne = findEdge('rugs', nxt);
        if (!ne && dest === 'risk') ne = findEdge('risk', 'buy');
        if (!ne && dest === 'buy') ne = findEdge('buy', 'monitor') || findEdge('buy', 'db');
        if (!ne && dest === 'monitor') ne = findEdge('monitor', 'exits');
        if (!ne && dest === 'exits') ne = findEdge('exits', 'sell');
        if (ne) {
          c.edge = ne.id; c.t = 0; c.color = nodeById(ne.from)?.color || c.color;
          next.push(c);
        } else if (clock.now() - c.at < 9000 && c.fate === 'run' && dest === 'rugs') {
          // wait briefly at rugs for a pass/reject
          c.t = 1;
          const pt = bez(p, 1);
          c.x = pt.x; c.y = pt.y;
          c.wait = (c.wait || 0) + dt;
          if (c.wait < 0.85) next.push(c);
          else { c.alpha -= dt * 2; if (c.alpha > 0) next.push(c); }
        } else {
          c.alpha -= dt * 2.2;
          const pt = bez(p, 1);
          c.x = pt.x; c.y = pt.y;
          if (c.alpha > 0) next.push(c);
        }
      } else {
        const pt = bez(p, c.t);
        c.x = pt.x; c.y = pt.y;
        next.push(c);
      }
    }
    state.chips = next;
  }

  function stepPhysics(dt, now) {
    for (const [id, h] of [...state.heat]) {
      const nh = h * Math.exp(-dt * 1.35);
      if (nh < 0.01) state.heat.delete(id); else state.heat.set(id, nh);
    }
    // No ambient / demo particles — motion comes only from real SSE events.
    const keep = [];
    for (const p of state.particles) {
      p.t += p.speed * dt;
      if (p.t < 1) keep.push(p);
    }
    state.particles = keep;
    stepChips(dt);
  }

  function stepWorld(dt, now) {
    const sub = Math.max(1, Math.ceil(dt / 0.05));
    const sdt = dt / sub;
    for (let i = 0; i < sub; i++) {
      const t = now - (sub - 1 - i) * sdt * 1000;
      stepPhysics(sdt, t);
    }
    stepShown(dt);
  }

  function tick(ts) {
    if (!state.open) { state.raf = 0; return; }
    if (!tick._last) tick._last = ts;
    const dt = Math.min(0.05, (ts - tick._last) / 1000);
    tick._last = ts;
    const now = clock.useSim ? clock.sim : ts;
    if (!state.freezeWorld) {
      stepWorld(dt, now);
      updateCamera(dt, now);
    }
    draw(now, dt);
    if (typeof state.onCaptureFrame === 'function') {
      try { state.onCaptureFrame(now, dt); } catch (e) { console.warn(e); }
    }
    state.raf = requestAnimationFrame(tick);
  }

  function resize() {
    const wrap = $('#wrap'), canvas = $('#cv');
    if (!wrap || !canvas) return;
    const dpr = Math.min(isMob() ? 1.5 : 2, window.devicePixelRatio || 1);
    const r = wrap.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(r.width * dpr));
    canvas.height = Math.max(1, Math.floor(r.height * dpr));
    canvas._dpr = dpr;
    computeFit();
    if (state.cam.auto) { state.cam.tx = state.fit.x; state.cam.ty = state.fit.y; state.cam.tk = state.fit.k; }
  }

  function showTip(n, sx, sy) {
    const tip = $('#tip');
    if (!tip || !n) { hideTip(); return; }
    const st = state.stats[n.id] || { events: 0, passes: 0, rejects: 0, lastAt: 0, lastMessage: '' };
    const last = state.lastEv[n.id];
    const ago = st.lastAt ? relTime(st.lastAt) : '—';
    let extra = '';
    if (n.id === 'exits' && state.pnl.exits != null) extra = `<div>last PnL <b>${(state.pnl.exits >= 0 ? '+' : '') + Math.round(state.pnl.exits * 100)}%</b></div>`;
    tip.innerHTML = `<b>${n.kind}: ${n.name}</b><div><span>${st.events || 0} events</span> · <span>${st.passes || 0} pass</span> · <span>${st.rejects || 0} rej</span></div><div>last ${ago}${last && last.message ? ' — ' + esc(last.message) : ''}</div>${extra}`;
    tip.classList.remove('hidden');
    const pad = 16;
    const tw = 220;
    let x = sx + 12, y = sy + 12;
    if (x + tw > window.innerWidth - pad) x = sx - tw - 8;
    if (y + 90 > window.innerHeight - pad) y = sy - 90;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    tip.style.transform = 'none';
  }
  function hideTip() { $('#tip')?.classList.add('hidden'); state.hover = null; }
  function relTime(at) {
    const s = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    return Math.round(s / 3600) + 'h ago';
  }
  function esc(s) { return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function bind() {
    const wrap = $('#wrap');
    if (!wrap || wrap._bound) return;
    wrap._bound = true;
    wrap.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      wrap.setPointerCapture(e.pointerId);
      state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (state.pointers.size === 2) {
        const [a, b] = [...state.pointers.values()];
        state.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: state.cam.k };
        state.dragging = false;
        markUser();
      } else {
        state.dragging = true;
        state.lastPtr = { x: e.clientX, y: e.clientY };
        wrap.classList.add('drag');
      }
    });
    wrap.addEventListener('pointermove', (e) => {
      if (state.pointers.has(e.pointerId)) state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (state.pinch && state.pointers.size === 2) {
        const [a, b] = [...state.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, state.pinch.k * (d / (state.pinch.d || d)));
        markUser();
        return;
      }
      if (state.dragging && state.lastPtr) {
        state.cam.x += e.clientX - state.lastPtr.x;
        state.cam.y += e.clientY - state.lastPtr.y;
        state.lastPtr = { x: e.clientX, y: e.clientY };
        markUser();
        return;
      }
      const n = hitNode(e.clientX, e.clientY);
      if (n) { state.hover = n.id; showTip(n, e.clientX, e.clientY); }
      else hideTip();
    });
    const up = (e) => {
      state.pointers.delete(e.pointerId);
      if (state.pointers.size < 2) state.pinch = null;
      state.dragging = false; state.lastPtr = null; wrap.classList.remove('drag');
    };
    wrap.addEventListener('pointerup', up);
    wrap.addEventListener('pointercancel', up);
    wrap.addEventListener('pointerleave', () => hideTip());
    wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, state.cam.k * (e.deltaY > 0 ? 0.92 : 1.08));
      markUser();
    }, { passive: false });
    let lastTap = 0;
    wrap.addEventListener('dblclick', (e) => { e.preventDefault(); goFit(false); state.cam.userAt = 0; state.cam.auto = true; });
    wrap.addEventListener('pointerup', (e) => {
      const t = performance.now();
      if (t - lastTap < 320) { goFit(false); state.cam.userAt = 0; state.cam.auto = true; }
      lastTap = t;
    });
    window.addEventListener('resize', () => { if (state.open) resize(); });
  }
  function zoomAt(cx, cy, k) {
    const wrap = $('#wrap').getBoundingClientRect();
    const nx = Math.max(0.2, Math.min(2.4, k));
    const px = cx - wrap.left, py = cy - wrap.top;
    const wx = (px - state.cam.x) / state.cam.k;
    const wy = (py - state.cam.y) / state.cam.k;
    state.cam.k = nx; state.cam.x = px - wx * nx; state.cam.y = py - wy * nx;
    state.cam.tx = state.cam.x; state.cam.ty = state.cam.y; state.cam.tk = nx;
  }

  async function load() {
    const r = await fetch('/api/flow', { credentials: 'same-origin' });
    if (r.status === 401) return false;
    if (!r.ok) throw new Error('flow graph failed');
    const d = await r.json();
    state.nodes = (d.nodes || []).map((n) => relabel({ ...n }));
    state.edges = d.edges || [];
    state.stats = d.stats || {};
    setStatus(d.status || {});
    return true;
  }
  async function history() {
    const r = await fetch('/api/flow/events?limit=250', { credentials: 'same-origin' });
    if (!r.ok) return;
    const d = await r.json();
    if (d.stats) state.stats = d.stats;
    if (d.status) setStatus(d.status);
    const evs = d.events || [];
    // replay recent events as pulses/heat without flooding chips
    for (const ev of evs.slice(-40)) {
      const n = ev.node;
      if (!n) continue;
      const st = state.stats[n] || (state.stats[n] = { events: 0, passes: 0, rejects: 0, lastAt: 0, lastMessage: '' });
      st.lastAt = ev.at; st.lastMessage = ev.message || ev.type;
      state.lastEv[n] = ev;
      if (ev.data && ev.data.pnlPct != null && (n === 'sell' || n === 'exits')) state.pnl.exits = ev.data.pnlPct;
    }
    // replay the latest real events as pulses (no synthetic motion)
    for (const ev of evs.slice(-12)) {
      const edge = findEdge(ev.from, ev.node);
      if (edge) { addHeat(edge.id, 0.4); spawnParticles(edge.id, 4, nodeById(ev.from)?.color, 1); }
      if (ev.node) state.pulse.set(ev.node, { at: clock.now(), pow: 0.6 });
    }
  }
  function connectSSE() {
    if (state.sse) { try { state.sse.close(); } catch {} }
    const es = new EventSource('/api/flow/stream');
    state.sse = es;
    setLive(true);
    es.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data);
        if (state.holdLive) state.queued.push(ev);
        else onEvent(ev);
      } catch {}
    };
    es.onerror = () => setLive(false);
    es.onopen = () => setLive(true);
  }

  async function open() {
    state.open = true;
    document.documentElement.setAttribute('data-theme', 'dark');
    bind();
    resize();
    const ok = await load();
    if (ok) {
      await history();
      goFit(true);
      connectSSE();
    }
    if (!state.raf) { tick._last = 0; state.raf = requestAnimationFrame(tick); }
  }
  function close() {
    state.open = false;
    if (state.sse) { try { state.sse.close(); } catch {} state.sse = null; }
    if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
    setLive(false);
  }

  function aspectSize(aspect) {
    if (aspect === '9:16' || aspect === 'portrait') return { W: 1080, H: 1920 };
    if (aspect === '1:1' || aspect === 'square') return { W: 1080, H: 1080 };
    return { W: 1920, H: 1080 };
  }

  function ensureRecCanvas(W, H) {
    let c = state.rec && state.rec.canvas;
    if (!c) {
      c = document.createElement('canvas');
      c.setAttribute('aria-hidden', 'true');
      c.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
      document.body.appendChild(c);
    }
    c.width = W;
    c.height = H;
    const fit = computeFit(W, H);
    const cam = { x: fit.x, y: fit.y, k: fit.k, tx: fit.x, ty: fit.y, tk: fit.k, auto: true, userAt: 0 };
    state.rec = { canvas: c, cam, fit, W, H, dpr: 1 };
    return state.rec;
  }

  function drawCapture(now, dt) {
    if (!state.rec) return null;
    const rec = state.rec;
    rec.fit = computeFit(rec.W, rec.H);
    updateCamera(dt || 0.033, now, rec.cam, rec.W, rec.H, rec.fit);
    draw(now, 0, { canvas: rec.canvas, cam: rec.cam, dpr: 1, watermark: true });
    return rec.canvas;
  }

  function endCapture() {
    state.onCaptureFrame = null;
    if (state.rec && state.rec.canvas && state.rec.canvas.parentNode) {
      try { state.rec.canvas.width = 1; state.rec.canvas.height = 1; } catch {}
    }
  }

  function snapWorld() {
    return {
      stats: JSON.parse(JSON.stringify(state.stats)),
      shown: JSON.parse(JSON.stringify(state.shown)),
      pnl: { ...state.pnl },
      lastEv: { ...state.lastEv },
      particles: state.particles.map((p) => ({ ...p })),
      chips: state.chips.map((c) => ({ ...c })),
      chipBySymbol: new Map(state.chipBySymbol),
      heat: new Map(state.heat),
      pulse: new Map(state.pulse),
      cam: { ...state.cam },
      activity: state.activity.slice(),
      focus: { ...state.focus },
    };
  }

  function restoreWorld(s) {
    if (!s) return;
    state.stats = s.stats;
    state.shown = s.shown;
    state.pnl = s.pnl;
    state.lastEv = s.lastEv;
    state.particles = s.particles;
    state.chips = s.chips;
    state.chipBySymbol = s.chipBySymbol;
    state.heat = s.heat;
    state.pulse = s.pulse;
    Object.assign(state.cam, s.cam);
    state.activity = s.activity;
    state.focus = s.focus;
  }

  function clearMotion() {
    state.particles = [];
    state.chips = [];
    state.chipBySymbol = new Map();
    state.heat = new Map();
    state.pulse = new Map();
    state.activity = [];
    state.focus = { x: 0, y: 0, w: 1, at: 0 };
  }

  function seedSilent(events) {
    state.stats = {};
    state.shown = {};
    state.pnl = {};
    state.lastEv = {};
    for (const ev of events || []) onEvent(ev, { silent: true, now: ev.at });
    for (const id of Object.keys(state.stats)) {
      const st = state.stats[id];
      state.shown[id] = { e: st.events || 0, p: st.passes || 0, r: st.rejects || 0, pnl: state.pnl.exits || 0 };
    }
  }

  async function playEvents({ events, preEvents, speed, aspect, onFrame, onProgress }) {
    const { W, H } = aspectSize(aspect);
    const rec = ensureRecCanvas(W, H);
    const evs = (events || []).filter((e) => e && e.type !== 'hello').slice().sort((a, b) => (a.at || 0) - (b.at || 0));
    const snap = snapWorld();
    state.holdLive = true;
    state.freezeWorld = true;
    clock.useSim = true;
    try {
      seedSilent(preEvents || []);
      clearMotion();
      const t0 = evs.length ? (evs[0].at || Date.now()) : Date.now();
      const t1 = evs.length ? (evs[evs.length - 1].at || t0) : t0;
      clock.sim = t0;
      rec.fit = computeFit(W, H);
      rec.cam.x = rec.cam.tx = rec.fit.x;
      rec.cam.y = rec.cam.ty = rec.fit.y;
      rec.cam.k = rec.cam.tk = rec.fit.k;
      rec.cam.auto = true;
      goFit(true);
      if (typeof onFrame === 'function') await onFrame({ canvas: rec.canvas, t0, t1, W, H, speed: speed || 1 });
    } finally {
      clock.useSim = false;
      restoreWorld(snap);
      state.freezeWorld = false;
      const queued = state.queued.splice(0);
      state.holdLive = false;
      for (const ev of queued) { try { onEvent(ev); } catch {} }
      goFit(false);
    }
  }

  window.DevameerPipeline = {
    open, close, resize, fit: () => goFit(false), setStatus,
    aspectSize, ensureRecCanvas, drawCapture, endCapture, stepWorld,
    onEvent, seedSilent, clearMotion, snapWorld, restoreWorld, playEvents,
    clock,
    get holdLive() { return state.holdLive; },
    set holdLive(v) { state.holdLive = !!v; },
    get freezeWorld() { return state.freezeWorld; },
    set freezeWorld(v) { state.freezeWorld = !!v; },
    setCapture(fn) { state.onCaptureFrame = fn; },
    get rec() { return state.rec; },
    get status() { return state.status; },
    flushQueued() {
      const queued = state.queued.splice(0);
      for (const ev of queued) { try { onEvent(ev); } catch {} }
    },
  };
})();
