// Shared SVG PNL cards. Works in the browser and in Node (CommonJS).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShareCard = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const HANDLE = '@devameer0';
  const W = 1200, H = 630;

  const THEMES = {
    dark: {
      bg: '#09090B', bg2: '#1A1A1F', text: '#FAFAFA', mut: '#A1A1AA', dim: '#71717A',
      line: '#27272A', panel: '#18181B', stroke: '#27272A',
      green: '#22C55E', red: '#EF4444', orange: '#F97316',
      paperBg: '#27272A', paperFg: '#FCD34D', liveBg: '#14532D', liveFg: '#86EFAC',
      openBg: '#1A1A1F', openFg: '#F97316', glow: '#22C55E',
    },
    light: {
      bg: '#F4F4F5', bg2: '#FFFFFF', text: '#0A0A0A', mut: '#52525B', dim: '#71717A',
      line: '#E4E4E7', panel: '#FFFFFF', stroke: '#E4E4E7',
      green: '#16A34A', red: '#DC2626', orange: '#EA580C',
      paperBg: '#FEF3C7', paperFg: '#92400E', liveBg: '#DCFCE7', liveFg: '#166534',
      openBg: '#FFEDD5', openFg: '#C2410C', glow: '#16A34A',
    },
  };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtUsd = (v, sign = true) => {
    if (v == null || !Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    const n = a >= 1000 ? a.toLocaleString('en-US', { maximumFractionDigits: 0 }) : a >= 100 ? a.toFixed(0) : a.toFixed(2);
    return (sign ? (v < 0 ? '−' : '+') : (v < 0 ? '−' : '')) + '$' + n;
  };
  const fmtSol = (v, sign = true) => {
    if (v == null || !Number.isFinite(v)) return '—';
    return (sign ? (v < 0 ? '−' : '+') : (v < 0 ? '−' : '')) + Math.abs(v).toFixed(4) + ' SOL';
  };
  const fmtPct = (v, sign = true) => {
    if (v == null || !Number.isFinite(v)) return '—';
    const p = v * 100;
    return (sign ? (p < 0 ? '↓' : '↑') : (p < 0 ? '−' : '')) + Math.abs(p).toFixed(Math.abs(p) >= 10 ? 0 : 1) + '%';
  };
  const fmtHold = (ms) => {
    if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60), rs = s % 60;
    if (m < 60) return rs ? m + 'm ' + rs + 's' : m + 'm';
    const h = Math.floor(m / 60), rm = m % 60;
    if (h < 48) return rm ? h + 'h ' + rm + 'm' : h + 'h';
    const d = Math.floor(h / 24), rh = h % 24;
    return rh ? d + 'd ' + rh + 'h' : d + 'd';
  };
  const fmtDate = (ms) => {
    if (!ms) return '';
    return new Date(ms).toLocaleString('en-US', { timeZone: 'Africa/Lagos', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  };
  const fmtMcap = (sol, solUsd) => {
    if (sol == null || !Number.isFinite(sol)) return '—';
    if (solUsd) {
      const usd = sol * solUsd;
      if (usd >= 1e6) return '$' + (usd / 1e6).toFixed(2) + 'M';
      if (usd >= 1e3) return '$' + (usd / 1e3).toFixed(1) + 'K';
      return '$' + usd.toFixed(0);
    }
    return sol.toFixed(2) + ' SOL';
  };
  const fmtPrice = (v) => {
    if (v == null || !Number.isFinite(v) || v === 0) return '—';
    const a = Math.abs(v);
    if (a >= 1) return a.toFixed(4);
    if (a >= 0.0001) return a.toFixed(6);
    return a.toExponential(2);
  };
  const tick = (s) => '$' + String(s || '?').replace(/^\$/, '').toUpperCase();

  function bean(x, y, size, id) {
    const s = size / 200;
    return `<g transform="translate(${x},${y}) scale(${s.toFixed(4)})">
      <defs>
        <radialGradient id="${id}g1" cx="38%" cy="30%" r="75%"><stop offset="0" stop-color="#fff"/><stop offset=".62" stop-color="#F1F1F3"/><stop offset="1" stop-color="#B9BAC2"/></radialGradient>
        <radialGradient id="${id}g2" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      </defs>
      <path d="M104 26c18 2 24 14 22 24" stroke="#0F766E" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M124 46c10-16 30-18 38-12-6 14-24 22-38 12z" fill="#2DD4BF"/>
      <path d="M100 44c46-2 82 30 82 78 0 44-34 70-82 70S18 170 18 128c0-50 36-82 82-84z" fill="url(#${id}g1)"/>
      <ellipse cx="78" cy="78" rx="34" ry="20" fill="url(#${id}g2)" transform="rotate(-20 78 78)"/>
      <ellipse cx="108" cy="104" rx="9" ry="16" fill="#0A0A0A" transform="rotate(14 108 104)"/>
      <ellipse cx="146" cy="98" rx="9" ry="16" fill="#0A0A0A" transform="rotate(14 146 98)"/>
      <ellipse cx="111" cy="97" rx="3" ry="4.5" fill="#fff"/><ellipse cx="149" cy="91" rx="3" ry="4.5" fill="#fff"/>
      <ellipse cx="96" cy="134" rx="10" ry="5" fill="#FDBA74" opacity=".7"/><ellipse cx="164" cy="126" rx="9" ry="5" fill="#FDBA74" opacity=".7"/>
      <path d="M124 132q8 7 16 0" stroke="#0A0A0A" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    </g>`;
  }

  function badge(x, y, text, bg, fg) {
    const w = 18 + text.length * 9.2;
    return `<g transform="translate(${x},${y})">
      <rect width="${w}" height="28" rx="14" fill="${bg}"/>
      <text x="${w / 2}" y="19" text-anchor="middle" font-size="11" font-weight="800" letter-spacing="0.8" fill="${fg}">${esc(text)}</text>
    </g>`;
  }

  function header(T, d, rightBadges) {
    const bot = d.botName || 'Devameer Bot';
    return `${bean(36, 28, 86, 'b')}
      <text x="132" y="62" font-size="26" font-weight="800" fill="${T.text}">${esc(bot)}</text>
      <text x="132" y="86" font-size="14" font-weight="600" fill="${T.mut}">${HANDLE} · ${esc(d.badge || 'DEVAMEER TERMINAL')}</text>
      ${rightBadges}`;
  }

  function wrap(T, inner) {
    const stroke = T.stroke;
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="80%" y1="0%" x2="0%" y2="100%">
      <stop offset="0" stop-color="${T.bg2}"/><stop offset=".55" stop-color="${T.bg}"/>
    </linearGradient>
    <clipPath id="av"><rect x="56" y="132" width="88" height="88" rx="18"/></clipPath>
  </defs>
  <rect width="${W}" height="${H}" rx="36" fill="url(#bg)" stroke="${stroke}" stroke-width="2"/>
  ${inner}
</svg>`;
  }

  function tokenAvatar(d, T) {
    const letter = esc(String(d.symbol || '?').replace(/^\$/, '').charAt(0).toUpperCase());
    const color = d.agentColor || '#71717A';
    if (d.imageData || d.image) {
      const href = d.imageData || d.image;
      return `<rect x="56" y="132" width="88" height="88" rx="18" fill="${color}"/>
        <image href="${esc(href)}" x="56" y="132" width="88" height="88" preserveAspectRatio="xMidYMid slice" clip-path="url(#av)"/>`;
    }
    return `<rect x="56" y="132" width="88" height="88" rx="18" fill="${color}"/>
      <text x="100" y="190" text-anchor="middle" font-size="36" font-weight="800" fill="#fff">${letter}</text>`;
  }

  function tradeSvg(d, theme) {
    const T = THEMES[theme === 'light' ? 'light' : 'dark'];
    const win = (d.pnlSol || 0) >= 0;
    const accent = win ? T.green : T.red;
    const paper = !!d.paper;
    const open = d.status === 'open';
    let bx = 1160;
    const badges = [];
    if (open) { const t = 'OPEN'; const w = 18 + t.length * 9.2; bx -= w; badges.push(badge(bx, 48, t, T.openBg, T.openFg)); bx -= 10; }
    { const t = paper ? 'PAPER' : 'LIVE'; const w = 18 + t.length * 9.2; bx -= w; badges.push(badge(bx, 48, t, paper ? T.paperBg : T.liveBg, paper ? T.paperFg : T.liveFg)); }
    const name = d.name || tick(d.symbol);
    const agent = d.agentName || d.agent || '';
    const usdLine = d.solUsd ? fmtUsd(d.pnlUsd != null ? d.pnlUsd : d.pnlSol * d.solUsd) : fmtSol(d.pnlSol);
    const solLine = d.solUsd ? fmtSol(d.pnlSol) : '';
    const stats = [
      ['IN', fmtSol(d.costSol, false)],
      ['OUT', fmtSol(d.proceedsSol, false)],
      ['ENTRY MCAP', fmtMcap(d.entryMcapSol, d.solUsd)],
      ['EXIT MCAP', (open && fmtMcap(d.exitMcapSol, d.solUsd) !== '—' ? fmtMcap(d.exitMcapSol, d.solUsd) + ' now' : fmtMcap(d.exitMcapSol, d.solUsd))],
      ['HOLD', fmtHold(d.holdMs)],
    ];
    const sw = 210, sx0 = 56, sy = 430;
    const cells = stats.map((s, i) => {
      const x = sx0 + i * (sw + 12);
      return `<rect x="${x}" y="${sy}" width="${sw}" height="86" rx="16" fill="${T.panel}" stroke="${T.line}"/>
        <text x="${x + 16}" y="${sy + 28}" font-size="11" font-weight="700" letter-spacing="1" fill="${T.dim}">${s[0]}</text>
        <text x="${x + 16}" y="${sy + 60}" font-size="20" font-weight="800" fill="${T.text}">${esc(s[1])}</text>`;
    }).join('');
    const foot = [fmtDate(open ? d.openedAt : (d.closedAt || d.openedAt)), d.exitReason, agent && !d.exitReason ? agent : null].filter(Boolean).join('  ·  ');
    const inner = `
      ${header(T, d, badges.join(''))}
      ${tokenAvatar(d, T)}
      <text x="164" y="174" font-size="34" font-weight="800" fill="${T.text}">${esc(tick(d.symbol))}</text>
      <text x="164" y="206" font-size="16" font-weight="500" fill="${T.mut}">${esc(name === tick(d.symbol) ? '' : name)}${name && name !== tick(d.symbol) && agent ? ' · ' : ''}${esc(agent)}</text>
      <text x="56" y="310" font-size="84" font-weight="900" fill="${accent}" letter-spacing="-2">${esc(usdLine)}</text>
      <text x="56" y="356" font-size="22" font-weight="700" fill="${T.mut}">${esc(solLine)}${solLine ? '   ' : ''}<tspan fill="${accent}">${esc(fmtPct(d.pnlPct))}</tspan></text>
      ${cells}
      <text x="56" y="556" font-size="14" font-weight="500" fill="${T.dim}">${esc(foot)}</text>
      <text x="1144" y="594" text-anchor="end" font-size="12" font-weight="600" fill="${T.dim}">devameer-bot</text>`;
    return wrap(T, inner);
  }

  function spark(points, x, y, w, h, T, accent) {
    if (!points || points.length < 1) return '';
    const ys = points.map((p) => p.pnl);
    const min = Math.min(0, ...ys), max = Math.max(0, ...ys);
    const span = max - min || 1;
    const n = Math.max(points.length - 1, 1);
    const coords = points.map((p, i) => {
      const px = x + (i / n) * w;
      const py = y + h - ((p.pnl - min) / span) * h;
      return [px, py];
    });
    if (coords.length === 1) coords.unshift([x, y + h - ((0 - min) / span) * h]);
    const d = coords.map((c, i) => (i ? 'L' : 'M') + c[0].toFixed(1) + ',' + c[1].toFixed(1)).join(' ');
    const last = coords[coords.length - 1];
    const zy = y + h - ((0 - min) / span) * h;
    const area = d + ` L${last[0].toFixed(1)},${zy.toFixed(1)} L${coords[0][0].toFixed(1)},${zy.toFixed(1)} Z`;
    return `<line x1="${x}" x2="${x + w}" y1="${zy}" y2="${zy}" stroke="${T.line}" stroke-dasharray="5 6" stroke-width="1.5"/>
      <path d="${area}" fill="${accent}" fill-opacity="0.12"/>
      <path d="${d}" fill="none" stroke="${accent}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${last[0]}" cy="${last[1]}" r="5.5" fill="${accent}"/>`;
  }

  function accountSvg(d, theme) {
    const T = THEMES[theme === 'light' ? 'light' : 'dark'];
    const win = (d.pnlSol || 0) >= 0;
    const accent = win ? T.green : T.red;
    const paper = !!d.paper;
    let bx = 1160;
    const badges = [];
    { const t = d.label || 'ALL TIME'; const w = 18 + t.length * 9.2; bx -= w; badges.push(badge(bx, 48, t, T.panel, T.text)); bx -= 10; }
    { const t = paper ? 'PAPER' : 'LIVE'; const w = 18 + t.length * 9.2; bx -= w; badges.push(badge(bx, 48, t, paper ? T.paperBg : T.liveBg, paper ? T.paperFg : T.liveFg)); }
    const usdLine = d.solUsd ? fmtUsd(d.pnlUsd != null ? d.pnlUsd : d.pnlSol * d.solUsd) : fmtSol(d.pnlSol);
    const solLine = d.solUsd ? fmtSol(d.pnlSol) : '';
    const best = d.best ? `${tick(d.best.symbol)} ${fmtSol(d.best.pnlSol)}` : '—';
    const worst = d.worst ? `${tick(d.worst.symbol)} ${fmtSol(d.worst.pnlSol)}` : '—';
    const stats = [
      ['TRADES', String(d.trades || 0)],
      ['WIN RATE', d.trades ? Math.round((d.winRate || 0) * 100) + '%' : '—'],
      ['BEST', best],
      ['WORST', worst],
    ];
    const sw = 264, sx0 = 56, sy = 470;
    const cells = stats.map((s, i) => {
      const x = sx0 + i * (sw + 12);
      const color = i === 2 ? T.green : i === 3 ? T.red : T.text;
      return `<rect x="${x}" y="${sy}" width="${sw}" height="86" rx="16" fill="${T.panel}" stroke="${T.line}"/>
        <text x="${x + 16}" y="${sy + 28}" font-size="11" font-weight="700" letter-spacing="1" fill="${T.dim}">${s[0]}</text>
        <text x="${x + 16}" y="${sy + 60}" font-size="20" font-weight="800" fill="${color}">${esc(s[1])}</text>`;
    }).join('');
    const pct = d.pnlPct != null ? (d.pnlPct < 0 ? '−' : '+') + Math.abs(d.pnlPct * 100).toFixed(1) + '%' : '';
    const inner = `
      ${header(T, d, badges.join(''))}
      <text x="56" y="168" font-size="13" font-weight="700" letter-spacing="1.4" fill="${T.dim}">${esc((d.label || 'ALL TIME') + ' PNL')}</text>
      <text x="56" y="250" font-size="76" font-weight="900" fill="${accent}" letter-spacing="-2">${esc(usdLine)}</text>
      <text x="56" y="292" font-size="20" font-weight="700" fill="${T.mut}">${esc(solLine)}${solLine && pct ? '   ·   ' : ''}${esc(pct)}</text>
      ${spark(d.curve, 620, 140, 524, 280, T, accent)}
      ${cells}
      <text x="1144" y="594" text-anchor="end" font-size="12" font-weight="600" fill="${T.dim}">devameer-bot</text>`;
    return wrap(T, inner);
  }

  function tweetText(d, url) {
    if (d.kind === 'account') {
      const usd = d.solUsd ? fmtUsd(d.pnlUsd != null ? d.pnlUsd : d.pnlSol * d.solUsd) + '  ·  ' : '';
      const pct = d.pnlPct != null ? ' (' + (d.pnlPct < 0 ? '−' : '+') + Math.abs(d.pnlPct * 100).toFixed(1) + '%)' : '';
      return `Devameer Bot ${d.label || 'All-time'} PnL  ${usd}${fmtSol(d.pnlSol)}${pct}\n${d.trades || 0} trades · ${d.trades ? Math.round((d.winRate || 0) * 100) + '% win' : 'no trades yet'}${d.best ? ' · Best ' + tick(d.best.symbol) : ''}${d.paper ? ' · PAPER' : ''}\n${HANDLE}${url ? '\n' + url : ''}`;
    }
    const usd = d.solUsd ? fmtUsd(d.pnlUsd != null ? d.pnlUsd : d.pnlSol * d.solUsd) : '';
    return `${tick(d.symbol)}  ${fmtPct(d.pnlPct)}  ·  ${fmtSol(d.pnlSol)}${usd ? ' (' + usd + ')' : ''}\n${d.agentName || ''}${d.holdMs != null ? ' · held ' + fmtHold(d.holdMs) : ''}${d.paper ? ' · PAPER' : ''}\n${HANDLE}${url ? '\n' + url : ''}`;
  }

  return {
    W, H, THEMES, HANDLE, esc, fmtUsd, fmtSol, fmtPct, fmtHold, fmtDate, fmtMcap, fmtPrice, tick,
    tradeSvg, accountSvg, tweetText, spark,
  };
});
