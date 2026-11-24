/* Devameer Bot Pipeline — dark, full-screen, live motion driven by real SSE events. */
(() => {
  const NODE = 52;
  const R = 13;
  const CARD_W = 248;
  const CARD_H = 196;
  const SCREEN_CAP = 7;
  const PARTICLE_CAP_DESK = 320;
  const PARTICLE_CAP_MOB = 160;
  const CHIP_CAP = 48;
  const IDLE_RESUME_MS = 10000;

  const AGENTS = {
    feed:     { name: 'Herald',    role: 'Token feed' },
    jupiter:  { name: 'Quote',     role: 'SOL price' },
    rpc:      { name: 'Chain',     role: 'On-chain' },
    rugs:     { name: 'Sentinel',  role: 'Rug filter' },
    sniper:   { name: 'Sniper',    role: 'Fresh launches' },
    scout:    { name: 'Scout',     role: 'Live hype' },
    curve:    { name: 'Rider',     role: 'Bonding curve' },
    graduate: { name: 'Graduate',  role: 'Near-grad' },
    risk:     { name: 'Oracle',    role: 'Risk limits' },
    buy:      { name: 'Broker',    role: 'Buyer' },
    monitor:  { name: 'Watch',     role: 'Positions' },
    exits:    { name: 'Keeper',    role: 'Exits' },
    sell:     { name: 'Closer',    role: 'Sells' },
    db:       { name: 'Archivist', role: 'Ledger' },
    share:    { name: 'Editor',    role: 'Replays' },
    withdraw: { name: 'Vault',     role: 'Withdraw' },
    errors:   { name: 'Alarm',     role: 'Alerts' },
  };

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
    screens: {},
    configs: {},
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
    viewMode: (function () {
      try { return localStorage.getItem('devameer-flow-view') === '2d' ? '2d' : '3d'; }
      catch { return '3d'; }
    })(),
    theme: 'light',
    tod: (function () {
      try { return localStorage.getItem('devameer-flow-tod') || 'auto'; }
      catch { return 'auto'; }
    })(),
    worldListeners: [],
  };

  const clock = {
    useSim: false,
    sim: 0,
    now() { return this.useSim ? this.sim : performance.now(); },
  };

  const isMob = () => Math.min(window.innerWidth, window.innerHeight) < 720 || 'ontouchstart' in window;
  const isLight = () => state.theme === 'light' || document.documentElement.getAttribute('data-theme') === 'light';
  const cap = () => isMob() ? PARTICLE_CAP_MOB : PARTICLE_CAP_DESK;
  const $ = (s, r = document) => r.querySelector(s);
  const nodeById = (id) => state.nodes.find((n) => n.id === id);

  function relabel(n) {
    const a = AGENTS[n.id];
    if (a) {
      n.name = a.name;
      n.role = a.role;
      n.sub = a.role;
      n.kind = 'Agent';
    }
    return n;
  }

  function agentTitle(n) {
    const role = n.role || n.sub || '';
    return role ? (n.name + ' · ' + role) : (n.name || n.id);
  }

  function cardBox(n) {
    return { x: n.x - CARD_W / 2, y: n.y - CARD_H / 2, w: CARD_W, h: CARD_H };
  }

  function edgePath(e) {
    const a = nodeById(e.from), b = nodeById(e.to);
    if (!a || !b) return null;
    const y1 = a.y - CARD_H / 2 + 36;
    const y2 = b.y - CARD_H / 2 + 36;
    const x1 = a.x + CARD_W / 2;
    const x2 = b.x - CARD_W / 2;
    const dx = Math.max(56, Math.abs(x2 - x1) * 0.45);
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


  function mixHex(hex, t, into) {
    const p = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const a = p(hex), b = p(into || '#000000');
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
    return 'rgb(' + c.join(',') + ')';
  }

  function drawAvatar(ctx, n, r) {
    const id = n.id, color = n.color || '#3B82F6';
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 7);
    ctx.fillStyle = mixHex(color, 0.45, '#0B0B0D');
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 7);
    ctx.clip();
    ctx.beginPath();
    ctx.arc(-r * 0.28, -r * 0.32, r * 0.55, 0, 7);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fill();

    const cream = '#F4F1EA';
    const ink = '#141416';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Head
    ctx.fillStyle = cream;
    ctx.beginPath();
    if (id === 'rpc') {
      ctx.moveTo(0, -r * 0.62); ctx.lineTo(r * 0.5, -r * 0.18); ctx.lineTo(r * 0.32, r * 0.55);
      ctx.lineTo(-r * 0.32, r * 0.55); ctx.lineTo(-r * 0.5, -r * 0.18); ctx.closePath();
    } else if (id === 'db' || id === 'share') {
      ctx.roundRect(-r * 0.46, -r * 0.5, r * 0.92, r * 1.02, r * 0.22);
    } else if (id === 'risk' || id === 'errors') {
      ctx.moveTo(0, -r * 0.68); ctx.lineTo(r * 0.58, r * 0.48); ctx.lineTo(-r * 0.58, r * 0.48); ctx.closePath();
    } else {
      ctx.ellipse(0, -r * 0.02, r * 0.52, r * 0.6, 0, 0, 7);
    }
    ctx.fill();

    // Unique accessories
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.6;
    if (id === 'feed') {
      ctx.beginPath(); ctx.arc(0, -r * 0.72, 1.6, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, -r * 0.62); ctx.lineTo(0, -r * 0.78); ctx.stroke();
    } else if (id === 'jupiter') {
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.7, r * 0.2, -0.4, 0, 7); ctx.stroke();
    } else if (id === 'rugs') {
      ctx.beginPath();
      ctx.moveTo(-r * 0.28, -r * 0.55); ctx.lineTo(0, -r * 0.8); ctx.lineTo(r * 0.28, -r * 0.55);
      ctx.stroke();
    } else if (id === 'sniper') {
      ctx.fillStyle = ink;
      ctx.fillRect(-r * 0.52, -r * 0.16, r * 1.04, r * 0.18);
      ctx.fillStyle = color;
    } else if (id === 'scout') {
      ctx.beginPath(); ctx.arc(-r * 0.2, -r * 0.72, 1.5, 0, 7); ctx.arc(r * 0.2, -r * 0.72, 1.5, 0, 7); ctx.fill();
    } else if (id === 'curve') {
      ctx.beginPath(); ctx.moveTo(-r * 0.7, r * 0.15); ctx.bezierCurveTo(-r * 0.1, r * 0.7, r * 0.15, -r * 0.2, r * 0.7, r * 0.05); ctx.stroke();
    } else if (id === 'graduate') {
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, -r * 0.28); ctx.lineTo(0, -r * 0.72); ctx.lineTo(r * 0.55, -r * 0.28); ctx.closePath();
      ctx.fill();
    } else if (id === 'buy') {
      ctx.beginPath(); ctx.moveTo(0, -r * 0.85); ctx.lineTo(0, -r * 0.52); ctx.moveTo(-r * 0.14, -r * 0.72); ctx.lineTo(0, -r * 0.88); ctx.lineTo(r * 0.14, -r * 0.72); ctx.stroke();
    } else if (id === 'sell') {
      ctx.beginPath(); ctx.moveTo(0, r * 0.78); ctx.lineTo(0, r * 0.52); ctx.moveTo(-r * 0.14, r * 0.66); ctx.lineTo(0, r * 0.82); ctx.lineTo(r * 0.14, r * 0.66); ctx.stroke();
    } else if (id === 'exits') {
      ctx.beginPath(); ctx.roundRect(-r * 0.16, -r * 0.82, r * 0.32, r * 0.28, 2); ctx.fill();
    } else if (id === 'monitor') {
      ctx.beginPath(); ctx.ellipse(0, -r * 0.08, r * 0.42, r * 0.22, 0, 0, 7); ctx.stroke();
    } else if (id === 'withdraw') {
      ctx.beginPath(); ctx.arc(0, r * 0.02, r * 0.18, Math.PI * 0.15, Math.PI * 1.85); ctx.stroke();
    } else if (id === 'share') {
      ctx.beginPath(); ctx.moveTo(r * 0.22, -r * 0.1); ctx.lineTo(r * 0.62, -r * 0.38); ctx.moveTo(r * 0.22, 0.05); ctx.lineTo(r * 0.62, r * 0.32); ctx.stroke();
    } else if (id === 'errors') {
      ctx.fillStyle = cream;
    }

    // Eyes
    ctx.fillStyle = ink;
    const eyeY = (id === 'sniper') ? -r * 0.02 : -r * 0.12;
    if (id === 'sniper') {
      ctx.fillRect(-r * 0.28, eyeY - 1, r * 0.18, 3);
      ctx.fillRect(r * 0.1, eyeY - 1, r * 0.18, 3);
    } else if (id === 'monitor') {
      ctx.beginPath(); ctx.arc(0, -r * 0.08, r * 0.1, 0, 7); ctx.fill();
    } else {
      const ex = id === 'scout' ? r * 0.2 : r * 0.16;
      const erx = id === 'scout' ? 2.4 : 2.1;
      const ery = id === 'curve' ? 3.1 : 2.6;
      ctx.beginPath(); ctx.ellipse(-ex, eyeY, erx, ery, 0.15, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(ex, eyeY - (id === 'graduate' ? 1.2 : 0), erx, ery, -0.15, 0, 7); ctx.fill();
    }

    // Mouth / smile
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    if (id === 'errors') {
      ctx.moveTo(-r * 0.12, r * 0.2); ctx.lineTo(r * 0.12, r * 0.2);
    } else if (id === 'buy' || id === 'share' || id === 'scout') {
      ctx.arc(0, r * 0.1, r * 0.16, 0.15, Math.PI - 0.15);
    } else if (id === 'risk') {
      ctx.moveTo(-r * 0.08, r * 0.18); ctx.lineTo(r * 0.08, r * 0.18);
    } else {
      ctx.arc(0, r * 0.08, r * 0.14, 0.2, Math.PI - 0.2);
    }
    ctx.stroke();
    ctx.restore();
  }

  function screenTone(ev) {
    if (!ev) return '#D4D4D8';
    if (ev.ok === false || ev.type === 'reject' || ev.type === 'error') return '#FCA5A5';
    if (ev.type === 'pass' || ev.type === 'buy' || ev.type === 'sell' || ev.ok === true) return '#86EFAC';
    if (ev.type === 'price' || ev.type === 'candidate') return '#C4B5FD';
    if (ev.type === 'exit') return '#FCD34D';
    return '#D4D4D8';
  }

  function screenLine(ev) {
    if (!ev) return '';
    const raw = String(ev.message || '').replace(/\s+/g, ' ').trim();
    if (raw) return raw.length > 42 ? raw.slice(0, 41) + '…' : raw;
    const sym = ev.symbol ? ('$' + String(ev.symbol).replace(/^\$/, '')) : '';
    const t = ev.type || 'event';
    const s = [sym, t].filter(Boolean).join(' · ');
    return s.length > 42 ? s.slice(0, 41) + '…' : s;
  }

  function agentNameOf(id) {
    const n = nodeById(id);
    if (n && n.name) return n.name;
    const a = AGENTS[id];
    return (a && a.name) || id || '';
  }

  function thinkPhrase(ev) {
    const id = ev && ev.node;
    if (id === 'rugs') return 'applying rug filters';
    if (id === 'risk') return 'checking open positions, daily cap, and goal hold';
    if (id === 'buy') return 'placing buy against the live quote';
    if (id === 'sell') return 'executing the exit sell';
    if (id === 'exits') return 'checking take profit, stop loss, and max hold';
    if (id === 'sniper') return 'scoring a fresh launch';
    if (id === 'scout') return 'scoring live-hype / X-linked flow';
    if (id === 'curve') return 'reading bonding-curve progress and momentum';
    if (id === 'graduate') return 'checking near-graduation progress';
    if (id === 'monitor') return 'marking open positions';
    if (id === 'feed') return 'ingesting the PumpPortal feed';
    if (id === 'jupiter') return 'quoting SOL/USD';
    if (id === 'rpc') return 'polling on-chain curve state';
    if (id === 'db') return 'writing the ledger';
    if (id === 'share') return 'preparing a public replay';
    if (id === 'withdraw') return 'recording a withdrawal';
    if (id === 'errors') return 'raising an alert';
    return 'processing';
  }

  function resultLine(ev) {
    if (!ev) return '';
    const msg = String(ev.message || '').replace(/\s+/g, ' ').trim();
    const reason = ev.data && ev.data.reason ? String(ev.data.reason) : '';
    const cut = (s) => s.replace(/^rejected\s+\$\S+\s+[—-]\s+/i, '').replace(/^passed rug filters\s*·\s*/i, '').replace(/^skipped:\s*/i, '');
    if (ev.ok === false || ev.type === 'reject' || ev.type === 'error') {
      const body = reason || cut(msg) || ev.type || 'rejected';
      const tag = ev.type === 'error' ? 'ERROR' : 'REJECT';
      return tag + ' · ' + body;
    }
    if (ev.type === 'pass') return 'PASS · ' + (cut(msg) || 'cleared');
    if (ev.type === 'buy') return 'BUY · ' + (msg || 'buy');
    if (ev.type === 'sell') return 'SELL · ' + (msg || 'sell');
    if (ev.type === 'exit') return 'EXIT · ' + (reason || msg || 'exit');
    if (ev.type === 'open') return 'OPEN · ' + (msg || 'tracking');
    if (msg) return msg;
    return ev.type || 'ok';
  }

  function inputLine(ev) {
    if (!ev) return '';
    const sym = ev.symbol ? ('$' + String(ev.symbol).replace(/^\$/, '')) : '';
    const from = ev.from ? agentNameOf(ev.from) : '';
    if (sym && from) return '> input: ' + sym + ' from ' + from;
    if (sym) return '> input: ' + sym;
    if (ev.type === 'incoming') return ev.message || ev.text || '';
    const line = screenLine(ev);
    if (ev.type === 'status' || ev.type === 'tick' || ev.type === 'price' || ev.type === 'lists') return '> ' + (ev.type) + ': ' + line;
    return '> input: ' + line;
  }

  function pushScreen(id, ev) {
    if (!id || !ev || ev.type === 'hello') return;
    const line = screenLine(ev);
    if (!line) return;
    const rows = state.screens[id] || (state.screens[id] = []);
    const last = rows[rows.length - 1];
    if (last && last.text === line && (ev.at || 0) - (last.at || 0) < 800) return;
    rows.push({
      text: line,
      at: ev.at || Date.now(),
      tone: screenTone(ev),
      input: inputLine(ev),
      think: thinkPhrase(ev),
      result: resultLine(ev),
      fresh: true,
    });
    if (rows.length > SCREEN_CAP) rows.splice(0, rows.length - SCREEN_CAP);
  }

  function pushScreenLine(id, text, tone, at) {
    if (!id || !text) return;
    const rows = state.screens[id] || (state.screens[id] = []);
    const line = String(text).replace(/\s+/g, ' ').trim();
    if (!line) return;
    const last = rows[rows.length - 1];
    if (last && last.text === line && (at || Date.now()) - (last.at || 0) < 400) return;
    const short = line.length > 56 ? line.slice(0, 55) + '…' : line;
    rows.push({ text: short, at: at || Date.now(), tone: tone || '#93C5FD', incoming: true, input: short.startsWith('incoming:') ? ('> ' + short) : ('> input: ' + short), think: 'receiving a handoff', result: short, fresh: true });
    if (rows.length > SCREEN_CAP) rows.splice(0, rows.length - SCREEN_CAP);
  }

  function agentMode(n, now) {
    const id = n.id;
    const blockedCap = !!(state.status && (state.status.dailyLossHit || state.status.goalHold) && (id === 'risk' || id === 'buy'));
    if (blockedCap) return 'blocked';
    const pul = state.pulse.get(id);
    if (pul && (now - pul.at) < 1600) return pul.err ? 'blocked' : 'working';
    const st = state.stats[id];
    if (st && st.lastAt && (Date.now() - st.lastAt) < 15000) return 'waiting';
    return 'idle';
  }

  function modeColor(mode) {
    if (mode === 'working') return '#22C55E';
    if (mode === 'waiting') return '#F59E0B';
    if (mode === 'blocked') return '#EF4444';
    return '#52525B';
  }

  function clipText(ctx, text, maxW) {
    if (!text) return '';
    if (ctx.measureText(text).width <= maxW) return text;
    let s = text;
    while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  function drawMonitor(ctx, n, x, y, w, h, now, mode) {
    // Computer bezel
    ctx.fillStyle = isLight() ? '#E2E8F0' : '#1A1A1E';
    ctx.strokeStyle = isLight() ? '#CBD5E1' : '#2A2A30';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 7); ctx.fill(); ctx.stroke();
    // Title bar
    ctx.fillStyle = isLight() ? '#CBD5E1' : '#121216';
    ctx.beginPath(); ctx.roundRect(x + 1, y + 1, w - 2, 12, 5);
    ctx.fill();
    const dots = ['#F43F5E', '#F59E0B', '#22C55E'];
    dots.forEach((c, i) => {
      ctx.beginPath(); ctx.fillStyle = c; ctx.globalAlpha = 0.7;
      ctx.arc(x + 10 + i * 8, y + 7, 2, 0, 7); ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#52525B';
    ctx.font = '600 7px Inter,system-ui,sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText((n.name || n.id).toLowerCase() + '.sh', x + w - 6, y + 7);

    const sx = x + 4, sy = y + 14, sw = w - 8, sh = h - 18;
    ctx.fillStyle = isLight() ? '#0F172A' : '#070709';
    ctx.beginPath(); ctx.roundRect(sx, sy, sw, sh, 4); ctx.fill();

    ctx.save();
    ctx.beginPath(); ctx.roundRect(sx, sy, sw, sh, 4); ctx.clip();

    const rows = state.screens[n.id] || [];
    const lineH = 11;
    const maxShow = Math.min(SCREEN_CAP, Math.floor((sh - 4) / lineH));
    const shown = rows.slice(-maxShow);
    ctx.font = '600 8px ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    if (!shown.length) {
      const blink = (Math.floor(now / 530) % 2) === 0;
      ctx.fillStyle = '#3F3F46';
      ctx.fillText('idle', sx + 5, sy + sh - 8);
      if (blink) {
        ctx.fillStyle = '#71717A';
        ctx.fillRect(sx + 5 + ctx.measureText('idle ').width, sy + sh - 13, 5, 9);
      }
    } else {
      shown.forEach((row, i) => {
        const yy = sy + 8 + i * lineH;
        ctx.fillStyle = row.tone || '#D4D4D8';
        ctx.fillText(clipText(ctx, row.text, sw - 10), sx + 5, yy);
      });
      if (mode === 'working') {
        const blink = (Math.floor(now / 400) % 2) === 0;
        if (blink) {
          const last = shown[shown.length - 1];
          const yy = sy + 8 + (shown.length - 1) * lineH;
          const tw = ctx.measureText(clipText(ctx, last.text, sw - 16)).width;
          ctx.fillStyle = last.tone || '#D4D4D8';
          ctx.fillRect(sx + 6 + tw, yy - 5, 5, 9);
        }
      }
    }

    if (mode === 'working') {
      const shimmer = ((now / 700) % 1);
      const gx = sx + shimmer * (sw + 40) - 40;
      const g = ctx.createLinearGradient(gx, sy, gx + 50, sy);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.07)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx, sy, sw, sh);
    }
    ctx.restore();
  }

  function drawAgentCard(ctx, n, now, breath) {
    const pul = state.pulse.get(n.id);
    const age = pul ? (now - pul.at) / (pul.win ? 1400 : 900) : 1;
    const amt = pul && age < 1 ? (1 - age) * (pul.pow || 1) : 0;
    const feedIdle = n.id === 'feed' ? 0.22 + 0.22 * breath : 0;
    const mode = agentMode(n, now);
    const outline = mode === 'blocked' && amt > 0.1 ? '#EF4444' : (pul && pul.win && amt > 0.15 ? '#22C55E' : n.color);
    const box = cardBox(n);
    const st = state.stats[n.id] || { events: 0, passes: 0, rejects: 0, lastAt: 0, lastMessage: '' };
    const sh = state.shown[n.id] || (state.shown[n.id] = { e: 0, p: 0, r: 0, pnl: 0 });
    const evN = Math.round(sh.e);
    const last = state.lastEv[n.id];
    const status = (last && screenLine(last)) || st.lastMessage || '';

    ctx.save();
    ctx.translate(n.x, n.y);
    if (amt) ctx.scale(1 + 0.03 * Math.min(amt, 1.8), 1 + 0.03 * Math.min(amt, 1.8));
    ctx.translate(-n.x, -n.y);

    ctx.shadowColor = outline;
    ctx.shadowBlur = 8 + Math.max(amt, feedIdle) * 18;
    ctx.fillStyle = isLight() ? '#F8FAFC' : '#121214';
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, 16);
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;

    // Avatar
    ctx.save();
    ctx.translate(box.x + 28, box.y + 28);
    drawAvatar(ctx, n, 20);
    ctx.restore();

    // Status dot
    const dc = modeColor(mode);
    ctx.beginPath();
    ctx.fillStyle = dc;
    ctx.shadowColor = dc;
    ctx.shadowBlur = mode === 'idle' ? 0 : 8;
    ctx.arc(box.x + box.w - 16, box.y + 16, 4, 0, 7);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Name + role
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '700 11px Inter,system-ui,sans-serif';
    ctx.fillStyle = isLight() ? '#0F172A' : '#FAFAFA';
    const nameX = box.x + 52;
    const nameMax = box.w - 52 - 28;
    ctx.fillText(clipText(ctx, agentTitle(n), nameMax), nameX, box.y + 16);

    // Live status line
    ctx.font = '600 9px Inter,system-ui,sans-serif';
    ctx.fillStyle = mode === 'blocked' ? '#B91C1C' : (mode === 'working' ? (isLight() ? '#334155' : '#E4E4E7') : (isLight() ? '#64748B' : '#A1A1AA'));
    const statusText = status ? clipText(ctx, status, nameMax) : (mode === 'idle' ? '—' : '');
    ctx.fillText(statusText, nameX, box.y + 30);

    if (mode === 'working') {
      const shimmer = ((now / 600) % 1);
      const tw = ctx.measureText(statusText).width || nameMax * 0.6;
      const gx = nameX + shimmer * (tw + 30) - 20;
      const g = ctx.createLinearGradient(gx, 0, gx + 28, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.28)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(nameX, box.y + 24, Math.min(nameMax, tw + 8), 12);
    }

    // Last active + count
    ctx.font = '600 8px Inter,system-ui,sans-serif';
    ctx.fillStyle = isLight() ? '#64748B' : '#71717A';
    const ago = st.lastAt ? ('last active ' + relTime(st.lastAt)) : 'last active —';
    const count = evN ? ('  ·  ' + evN) : '';
    ctx.fillText(clipText(ctx, ago + count, nameMax), nameX, box.y + 43);

    drawMonitor(ctx, n, box.x + 10, box.y + 56, box.w - 20, box.h - 66, now, mode);
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
    if (n) pushScreen(n, ev);
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
    if (!silent) {
      for (const fn of state.worldListeners) {
        try { fn(ev); } catch (e) { console.warn(e); }
      }
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
      minX = Math.min(minX, n.x - CARD_W / 2 - 24); maxX = Math.max(maxX, n.x + CARD_W / 2 + 24);
      minY = Math.min(minY, n.y - CARD_H / 2 - 20); maxY = Math.max(maxY, n.y + CARD_H / 2 + 20);
    }
    const w = Math.max(200, maxX - minX), h = Math.max(200, maxY - minY);
    const k = Math.max(0.18, Math.min(1.2, Math.min((viewW - 48) / w, (viewH - 48) / h)));
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
      minX = Math.min(minX, n.x - CARD_W / 2 - 24); maxX = Math.max(maxX, n.x + CARD_W / 2 + 24);
      minY = Math.min(minY, n.y - CARD_H / 2 - 20); maxY = Math.max(maxY, n.y + CARD_H / 2 + 20);
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
        const k = fit.k * (isMob() ? 2.1 : 1.55);
        const blend = 0.28;
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
    return state.nodes.find((n) => {
      const b = cardBox(n);
      return w.x >= b.x && w.x <= b.x + b.w && w.y >= b.y && w.y <= b.y + b.h;
    }) || null;
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
    ctx.fillStyle = isLight() ? '#E8EEF6' : '#0B0B0D';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // screen-space dot grid
    const step = 22 * dpr;
    ctx.fillStyle = isLight() ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.045)';
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

    // agent cards
    const breath = 0.5 + 0.5 * Math.sin(now / 900);
    for (const n of state.nodes) drawAgentCard(ctx, n, now, breath);

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
    if (state.viewMode !== '3d') draw(now, dt);
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
    if (state.viewMode === '3d' && window.DevameerOffice && window.DevameerOffice.resize) {
      try { window.DevameerOffice.resize(); } catch (e) { console.warn(e); }
    }
  }

  function showTip(n, sx, sy) {
    const tip = $('#tip');
    if (!tip || !n) { hideTip(); return; }
    const st = state.stats[n.id] || { events: 0, passes: 0, rejects: 0, lastAt: 0, lastMessage: '' };
    const last = state.lastEv[n.id];
    const ago = st.lastAt ? relTime(st.lastAt) : '—';
    let extra = '';
    if (n.id === 'exits' && state.pnl.exits != null) extra = `<div>last PnL <b>${(state.pnl.exits >= 0 ? '+' : '') + Math.round(state.pnl.exits * 100)}%</b></div>`;
    tip.innerHTML = `<b>${esc(agentTitle(n))}</b><div><span>${st.events || 0} events</span> · <span>${st.passes || 0} pass</span> · <span>${st.rejects || 0} rej</span></div><div>last active ${ago}${last && last.message ? ' — ' + esc(last.message) : ''}</div>${extra}`;
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
      if (state.viewMode === '3d') return;
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
      if (state.viewMode === '3d') return;
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
      if (state.viewMode === '3d') return;
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, state.cam.k * (e.deltaY > 0 ? 0.92 : 1.08));
      markUser();
    }, { passive: false });
    let lastTap = 0;
    wrap.addEventListener('dblclick', (e) => {
      e.preventDefault();
      if (state.viewMode === '3d') {
        if (window.DevameerOffice && window.DevameerOffice.onDoubleClick) window.DevameerOffice.onDoubleClick(e);
        else if (window.DevameerOffice && window.DevameerOffice.defaultCamera) window.DevameerOffice.defaultCamera();
        return;
      }
      goFit(false); state.cam.userAt = 0; state.cam.auto = true;
    });
    wrap.addEventListener('pointerup', (e) => {
      if (state.viewMode === '3d') return;
      const t = performance.now();
      if (t - lastTap < 320) { goFit(false); state.cam.userAt = 0; state.cam.auto = true; }
      lastTap = t;
    });
    window.addEventListener('resize', () => { if (state.open) resize(); });
    const viewBtn = $('#viewToggle');
    if (viewBtn && !viewBtn._bound) {
      viewBtn._bound = true;
      viewBtn.addEventListener('click', () => setViewMode(state.viewMode === '3d' ? '2d' : '3d'));
    }
    bindTodControls();
    const roofBtn = $('#roofToggle');
    if (roofBtn && !roofBtn._bound) {
      roofBtn._bound = true;
      roofBtn.addEventListener('click', () => { if (window.DevameerOffice && window.DevameerOffice.cycleRoof) window.DevameerOffice.cycleRoof(); });
    }
    const spinBtn = $('#spinToggle');
    if (spinBtn && !spinBtn._bound) {
      spinBtn._bound = true;
      spinBtn.addEventListener('click', () => { if (window.DevameerOffice && window.DevameerOffice.toggleSpin) window.DevameerOffice.toggleSpin(); });
    }
    const backBtn = $('#inspectBack');
    if (backBtn && !backBtn._bound) {
      backBtn._bound = true;
      backBtn.addEventListener('click', () => { if (window.DevameerOffice && window.DevameerOffice.exitInspect) window.DevameerOffice.exitInspect(); });
    }
    const ov = $('#camOverview');
    if (ov && !ov._bound) {
      ov._bound = true;
      ov.addEventListener('click', () => { if (window.DevameerOffice && window.DevameerOffice.flyOverview) window.DevameerOffice.flyOverview(); });
    }
    const jump = $('#agentJump');
    if (jump && !jump._bound) {
      jump._bound = true;
      jump.addEventListener('change', () => {
        const id = jump.value;
        if (id && window.DevameerOffice && window.DevameerOffice.flyToAgent) window.DevameerOffice.flyToAgent(id);
        jump.value = '';
      });
    }
    const mute = $('#audioMute');
    const vol = $('#audioVol');
    if (mute && !mute._bound) {
      mute._bound = true;
      mute.addEventListener('click', () => {
        if (window.DevameerOffice && window.DevameerOffice.toggleMute) window.DevameerOffice.toggleMute();
      });
    }
    if (vol && !vol._bound) {
      vol._bound = true;
      try {
        const v = localStorage.getItem('devameer-flow-volume-v3');
        if (v != null && isFinite(+v)) vol.value = String(Math.round(Math.max(0, Math.min(1, +v)) * 100));
        else vol.value = '90';
      } catch {}
      const pct = $('#audioPct');
      if (pct) pct.textContent = vol.value + '%';
      vol.addEventListener('input', () => {
        if (window.DevameerOffice && window.DevameerOffice.setVolume) window.DevameerOffice.setVolume((+vol.value || 0) / 100);
        const p = $('#audioPct');
        if (p) p.textContent = vol.value + '%';
      });
    }
    const en = $('#soundEnable');
    if (en && !en._bound) {
      en._bound = true;
      en.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.DevameerOffice && window.DevameerOffice.unlockAudio) window.DevameerOffice.unlockAudio(true);
      });
    }
    const walkBtn = $('#walkToggle');
    if (walkBtn && !walkBtn._bound) {
      walkBtn._bound = true;
      walkBtn.addEventListener('click', () => { if (window.DevameerOffice && window.DevameerOffice.toggleWalk) window.DevameerOffice.toggleWalk(); });
    }
    const tourBtn = $('#tourToggle');
    if (tourBtn && !tourBtn._bound) {
      tourBtn._bound = true;
      tourBtn.addEventListener('click', () => { if (window.DevameerOffice && window.DevameerOffice.toggleTour) window.DevameerOffice.toggleTour(); });
    }
    const fxBtn = $('#fxToggle');
    if (fxBtn && !fxBtn._bound) {
      fxBtn._bound = true;
      fxBtn.addEventListener('click', () => { if (window.DevameerOffice && window.DevameerOffice.cycleFx) window.DevameerOffice.cycleFx(); });
    }
    updateViewToggle();
    updateThemeToggle();
    applyTod(state.tod || 'auto', true);
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
    state.configs = d.configs || {};
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
    state.screens = {};
    for (const ev of evs) {
      if (ev && ev.node) pushScreen(ev.node, ev);
    }
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
    applyTod(state.tod || 'auto', true);
    bind();
    resize();
    const ok = await load();
    if (ok) {
      await history();
      goFit(true);
      connectSSE();
    }
    applyPreferredView();
    if (!state.raf) { tick._last = 0; state.raf = requestAnimationFrame(tick); }
  }
  function close() {
    state.open = false;
    if (window.DevameerOffice) { try { window.DevameerOffice.setActive(false); } catch {} }
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
    if (state.viewMode === '3d' && window.DevameerOffice && window.DevameerOffice.renderCapture) {
      return window.DevameerOffice.renderCapture(rec.canvas, rec.W, rec.H, now, dt);
    }
    rec.fit = computeFit(rec.W, rec.H);
    updateCamera(dt || 0.033, now, rec.cam, rec.W, rec.H, rec.fit);
    draw(now, 0, { canvas: rec.canvas, cam: rec.cam, dpr: 1, watermark: true });
    return rec.canvas;
  }

  function endCapture() {
    state.onCaptureFrame = null;
    if (window.DevameerOffice && window.DevameerOffice.endCapture) {
      try { window.DevameerOffice.endCapture(); } catch {}
    }
    if (state.rec && state.rec.canvas && state.rec.canvas.parentNode) {
      try { state.rec.canvas.width = 1; state.rec.canvas.height = 1; } catch {}
    }
  }

  function world() {
    return {
      nodes: state.nodes,
      edges: state.edges,
      screens: state.screens,
      stats: state.stats,
      lastEv: state.lastEv,
      status: state.status,
      pnl: state.pnl,
      pulse: state.pulse,
      heat: state.heat,
      configs: state.configs,
    };
  }

  function agentModeOf(id, now) {
    const n = nodeById(id);
    if (!n) return 'idle';
    return agentMode(n, now == null ? clock.now() : now);
  }

  function updateViewToggle() {
    const btn = $('#viewToggle');
    const hint = $('#camHint');
    if (btn) {
      const is3d = state.viewMode === '3d';
      btn.textContent = is3d ? '2D cards' : '3D office';
      btn.setAttribute('aria-label', is3d ? 'Switch to 2D cards' : 'Switch to 3D office');
    }
    if (hint) hint.classList.toggle('hidden', state.viewMode !== '3d');
    const jumpWrap = $('#jumpWrap');
    if (jumpWrap) jumpWrap.classList.toggle('hidden', state.viewMode !== '3d');
    ['walkToggle', 'tourToggle', 'fxToggle', 'roofToggle', 'spinToggle'].forEach((id) => {
      const el = $('#' + id);
      if (el) el.classList.toggle('hidden', state.viewMode !== '3d');
    });
    const todDock = $('#todDock');
    if (todDock) todDock.classList.toggle('hidden', state.viewMode !== '3d');
    const boot = $('#bootGate');
    if (boot && state.viewMode !== '3d') boot.classList.add('hidden');
  }

  function setViewMode(mode) {
    const want = mode === '2d' ? '2d' : '3d';
    if (want === '3d') {
      const Office = window.DevameerOffice;
      if (!Office) { setBoot(8, 'Loading 3D engine…'); updateViewToggle(); return false; }
      setBoot(10, 'Opening HQ…');
      if (!Office.setActive(true)) {
        // Temporary (world not loaded yet). Only give up if WebGL itself is missing.
        if (typeof Office.supported === 'function' && !Office.supported()) {
          state.viewMode = '2d';
          try { localStorage.setItem('devameer-flow-view', '2d'); } catch {}
        }
        updateViewToggle();
        return false;
      }
      state.viewMode = '3d';
    } else {
      if (window.DevameerOffice) { try { window.DevameerOffice.setActive(false); } catch {} }
      state.viewMode = '2d';
    }
    try { localStorage.setItem('devameer-flow-view', state.viewMode); } catch {}
    updateViewToggle();
    return true;
  }

  function applyPreferredView() {
    const want = state.viewMode || '3d';
    if (want === '3d') {
      setBoot(2, 'Loading Devameer Bot HQ…');
      if (window.DevameerOffice) setViewMode('3d');
      else updateViewToggle();
    } else {
      setViewMode('2d');
    }
  }

  function lagosHour() {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', hour12: false }).formatToParts(new Date());
      return +((parts.find((p) => p.type === 'hour') || {}).value || 12);
    } catch { return new Date().getHours(); }
  }
  function resolveTod(choice) {
    if (choice === 'morning' || choice === 'afternoon' || choice === 'night') return choice;
    const h = lagosHour();
    if (h >= 5 && h < 12) return 'morning';
    if (h >= 12 && h < 18) return 'afternoon';
    return 'night';
  }
  function updateThemeToggle() { updateTodUi(); }
  function updateTodUi() {
    const mode = resolveTod(state.tod || 'auto');
    document.querySelectorAll('#todDock [data-tod]').forEach((btn) => {
      const on = btn.getAttribute('data-tod') === (state.tod || 'auto');
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('on', on);
    });
  }
  function applyTheme(mode) {
    const next = mode === 'light' ? 'light' : 'dark';
    state.theme = next;
    document.documentElement.setAttribute('data-theme', next);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', next === 'light' ? '#E8EEF6' : '#0B0B0D');
    updateTodUi();
  }
  function setBoot(pct, msg, done) {
    const gate = $('#bootGate');
    const bar = $('#bootBar');
    const label = $('#bootMsg');
    if (label && msg) label.textContent = msg;
    if (bar) bar.style.width = Math.max(0, Math.min(100, +pct || 0)) + '%';
    if (!gate) return;
    if (done) gate.classList.add('hidden');
    else gate.classList.remove('hidden');
  }
  function bindTodControls() {
    const dock = $('#todDock');
    const pick = (e) => {
      const btn = e.target && e.target.closest && e.target.closest('#todDock [data-tod]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      applyTod(btn.getAttribute('data-tod'), true);
    };
    if (dock && !dock._bound) {
      dock._bound = true;
      dock.addEventListener('pointerdown', pick, true);
      dock.addEventListener('click', pick, true);
    }
    if (!document._todDelegated) {
      document._todDelegated = true;
      document.addEventListener('pointerdown', pick, true);
    }
  }
  function applyTod(choice, instant) {
    const next = choice || 'auto';
    state.tod = next;
    try { localStorage.setItem('devameer-flow-tod', state.tod); } catch {}
    const mode = resolveTod(state.tod);
    applyTheme(mode === 'night' ? 'dark' : 'light');
    updateTodUi();
    if (window.DevameerOffice && window.DevameerOffice.setTod) {
      try { window.DevameerOffice.setTod(state.tod, instant === undefined ? true : instant); } catch (e) { console.warn(e); }
    }
  }
  function setTheme(mode) { applyTod(mode === 'dark' ? 'night' : 'afternoon'); }
  function setTod(choice) { applyTod(choice); }

  function snapWorld() {
    return {
      stats: JSON.parse(JSON.stringify(state.stats)),
      shown: JSON.parse(JSON.stringify(state.shown)),
      pnl: { ...state.pnl },
      lastEv: { ...state.lastEv },
      screens: JSON.parse(JSON.stringify(state.screens || {})),
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
    state.screens = s.screens || {};
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
    state.screens = {};
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
    clock, world, agentModeOf, setViewMode, applyPreferredView, setTheme, applyTheme, setTod, applyTod, pushScreenLine,
    onWorldEvent(fn) { if (typeof fn === 'function') state.worldListeners.push(fn); },
    get viewMode() { return state.viewMode; },
    get theme() { return state.theme; },
    get tod() { return state.tod; },
    setBoot,
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
