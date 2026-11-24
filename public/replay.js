// PnL replay: canvas preview + MP4 export. Works in the browser and (frameSvg) in Node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./share-card.js'));
  else root.Replay = factory(root.ShareCard);
})(typeof self !== 'undefined' ? self : this, function (ShareCard) {
  const HANDLE = '@devameer0';
  const FPS = 30;

  function layout(aspect) {
    const portrait = aspect === '9:16' || aspect === 'portrait' || aspect === '1080x1920';
    const W = 1080, H = portrait ? 1920 : 1080;
    if (portrait) {
      return { W, H, portrait, pad: 56, bean: 120, titleY: 118, subY: 158,
        tickerY: 300, pnlY: 470, solY: 545,
        chart: { x: 56, y: 620, w: 968, h: 980 }, footY: 1860 };
    }
    return { W, H, portrait, pad: 52, bean: 92, titleY: 86, subY: 116,
      tickerY: 185, pnlY: 290, solY: 340,
      chart: { x: 48, y: 390, w: 984, h: 520 }, footY: 1008 };
  }

  function priceAt(ticks, t) {
    if (!ticks || !ticks.length) return null;
    if (t <= ticks[0].t) return ticks[0].price;
    const last = ticks[ticks.length - 1];
    if (t >= last.t) return last.price;
    for (let i = 1; i < ticks.length; i++) {
      if (ticks[i].t >= t) {
        const a = ticks[i - 1], b = ticks[i];
        const u = (t - a.t) / ((b.t - a.t) || 1);
        return a.price + (b.price - a.price) * u;
      }
    }
    return last.price;
  }

  function durationOf(d) {
    const n = (d && d.kind === 'account') ? (d.curve || []).length : (d && d.ticks || []).length;
    const s = n >= 80 ? 14 : n >= 30 ? 12 : 10;
    return Math.max(8, Math.min(15, s));
  }

  function ease(x) { return 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 1.12); }

  // Start drawing immediately (no leading 10% blank), with a short hold on the final frame.
  function lineProgress(p) {
    const endHold = 0.04;
    if (p <= 0) return 0;
    if (p >= 1 - endHold) return 1;
    return ease(p / (1 - endHold));
  }

  function equityBase(d, curve) {
    if (d && Number.isFinite(d.startEq) && d.startEq) return d.startEq;
    if (d && Number.isFinite(d.stack) && d.stack) return d.stack;
    if (d && Number.isFinite(d.pnlPct) && Math.abs(d.pnlPct) > 1e-12 && Number.isFinite(d.pnlSol)) return d.pnlSol / d.pnlPct;
    const last = curve && curve[curve.length - 1];
    if (d && Number.isFinite(d.pnlPct) && Math.abs(d.pnlPct) > 1e-12 && last && Number.isFinite(last.pnl)) return last.pnl / d.pnlPct;
    return 0;
  }

  function progressCounts(shown, curve, d) {
    const last = shown[shown.length - 1];
    if (last && last.trades != null) return { trades: last.trades, wins: last.wins || 0 };
    let trades = 0, wins = 0;
    for (let i = 1; i < shown.length; i++) {
      const isLastUnreal = i === shown.length - 1 && curve && i === curve.length - 1 && d && d.unrealSol;
      if (isLastUnreal) continue;
      const prev = shown[i - 1].pnl, cur = shown[i].pnl;
      trades++;
      if (Number.isFinite(prev) && Number.isFinite(cur) && cur - prev > 0) wins++;
    }
    return { trades, wins };
  }

  function signedPnl(st) {
    if (st && Number.isFinite(st.pnlUsd)) return st.pnlUsd;
    if (st && Number.isFinite(st.pnlSol)) return st.pnlSol;
    return (st && st.pnlPct) || 0;
  }

  function stateAt(d, p) {
    const F = ShareCard.flagsOf(d || {});
    if (d && d.kind === 'account') {
      const curve = d.curve || [];
      const lp = lineProgress(p);
      const idx = curve.length ? Math.max(0, Math.round((curve.length - 1) * lp)) : 0;
      const shown = curve.slice(0, idx + 1);
      const last = shown[shown.length - 1] || { pnl: 0, pct: 0, trades: 0, wins: 0 };
      const key = (curve[0] && curve[0].pct != null && curve[0].pnl == null) ? 'pct' : 'pnl';
      const base = equityBase(d, curve);
      let pnlSol = key === 'pnl' ? (last.pnl != null ? last.pnl : 0) : (base && last.pct != null ? last.pct * base : null);
      let pnlPct = key === 'pct'
        ? (last.pct != null ? last.pct : 0)
        : (base ? (last.pnl || 0) / base : 0);
      if (lp >= 1) {
        if (d.pnlSol != null) pnlSol = d.pnlSol;
        if (d.pnlPct != null) pnlPct = d.pnlPct;
      }
      const pnlUsd = (pnlSol != null && d.solUsd) ? pnlSol * d.solUsd : (lp >= 1 ? d.pnlUsd : null);
      let { trades, wins } = progressCounts(shown, curve, d);
      if (lp >= 1) {
        if (d.trades != null) trades = d.trades;
        if (d.wins != null) wins = d.wins;
      }
      const winRate = trades ? (wins || 0) / trades : 0;
      const peak = shown.reduce((m, x) => {
        const v = x[key] != null ? x[key] : 0;
        return !m || v > m.v ? { p: x, v } : m;
      }, null);
      return { kind: 'account', F, lp, p, shown, key, pnlSol, pnlPct, pnlUsd, trades, wins, winRate, peak, reachedPeak: !!(peak && shown.indexOf(peak.p) >= 0 && lp > 0) };
    }
    const ticks = (d && d.ticks) || [];
    const tBuy = d && (d.openedAt || (ticks[0] && ticks[0].t));
    const tEnd = d && (d.closedAt || (ticks.length ? ticks[ticks.length - 1].t : tBuy));
    const lp = lineProgress(p);
    const tNow = tBuy != null ? tBuy + ((tEnd || tBuy) - tBuy) * lp : 0;
    const entry = (d && (d.entryPrice || d.curvePriceAtEntry)) || (ticks[0] && ticks[0].price);
    const price = priceAt(ticks, tNow) ?? (d && d.exitPrice) ?? entry;
    let pnlPct = entry && price ? price / entry - 1 : (d && d.pnlPct) || 0;
    if (d && d.status !== 'open' && lp >= 1 && d.pnlPct != null) pnlPct = d.pnlPct;
    let pnlSol = d && d.costSol != null ? d.costSol * pnlPct : (d && d.pnlSol);
    if (d && d.status !== 'open' && lp >= 1 && d.pnlSol != null) pnlSol = d.pnlSol;
    const pnlUsd = (pnlSol != null && d && d.solUsd) ? pnlSol * d.solUsd : null;
    const hold = ticks.filter((x) => x.t >= (tBuy || 0) && x.t <= (tEnd || x.t));
    const peak = hold.reduce((m, x) => (!m || x.price > m.price ? x : m), null);
    const reachedPeak = !!(peak && tNow >= peak.t && lp > 0);
    const peakPct = entry && peak ? peak.price / entry - 1 : (d && d.holdPumpPct);
    return { kind: 'trade', F, lp, p, ticks, tBuy, tEnd, tNow, entry, price, pnlPct, pnlSol, pnlUsd, peak, reachedPeak, peakPct, open: d && d.status === 'open' };
  }

  function drawMedia(ctx, src, W, H, fit) {
    const iw = src.videoWidth || src.naturalWidth || src.width || 0;
    const ih = src.videoHeight || src.naturalHeight || src.height || 0;
    if (!iw || !ih) { try { ctx.drawImage(src, 0, 0, W, H); } catch { /* not ready */ } return; }
    const ir = iw / ih, r = W / H;
    let dw, dh, dx, dy;
    const cover = fit !== 'contain';
    if (cover ? ir < r : ir > r) { dh = H; dw = H * ir; dx = (W - dw) / 2; dy = 0; }
    else { dw = W; dh = W / ir; dx = 0; dy = (H - dh) / 2; }
    if (!cover) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
    ctx.drawImage(src, dx, dy, dw, dh);
  }

  function drawBackground(ctx, W, H, opts) {
    const theme = opts && opts.theme === 'light' ? 'light' : 'dark';
    const T = ShareCard.THEMES[theme];
    const bg = opts && opts.bg;
    const media = bg && (bg.video || bg.image || bg.el);
    ctx.save();
    if (media) {
      const blur = Math.max(0, Math.min(24, bg.blur != null ? bg.blur : 10));
      const dim = Math.max(0, Math.min(0.85, bg.dim != null ? bg.dim : 0.48));
      const fit = bg.fit === 'contain' ? 'contain' : 'cover';
      const pad = blur * 2;
      if (blur) {
        ctx.filter = 'blur(' + blur + 'px)';
        ctx.drawImage ? null : 0;
        ctx.beginPath();
        // scale up to hide blur edges
        ctx.translate(-pad, -pad);
        ctx.scale((W + pad * 2) / W, (H + pad * 2) / H);
        drawMedia(ctx, media, W, H, fit);
        ctx.filter = 'none';
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      } else {
        drawMedia(ctx, media, W, H, fit);
      }
      ctx.fillStyle = theme === 'light' ? ('rgba(255,255,255,' + dim + ')') : ('rgba(8,8,10,' + dim + ')');
      ctx.fillRect(0, 0, W, H);
    } else {
      const g = ctx.createLinearGradient(W * 0.8, 0, 0, H);
      g.addColorStop(0, T.bg2);
      g.addColorStop(0.55, T.bg);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function pill(ctx, x, y, text, bg, fg, font) {
    ctx.font = font || '800 22px Inter,system-ui,sans-serif';
    const w = ctx.measureText(text).width + 36;
    roundRect(ctx, x, y, w, 40, 20);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + 21);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    return w;
  }

  function drawChart(ctx, pts, box, T, accent, marks) {
    if (!pts || pts.length < 2) return;
    const ys = pts.map((p) => p.y);
    const min = Math.min(...ys), max = Math.max(...ys), span = max - min || Math.abs(min) * 0.01 || 1;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t, ts = t1 - t0 || 1;
    const xy = (p) => [box.x + ((p.t - t0) / ts) * box.w, box.y + box.h - ((p.y - min) / span) * box.h];
    const coords = pts.map(xy);
    roundRect(ctx, box.x, box.y, box.w, box.h, 22);
    ctx.fillStyle = T.panel;
    ctx.globalAlpha = 0.72;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = T.line;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.save();
    roundRect(ctx, box.x, box.y, box.w, box.h, 22);
    ctx.clip();
    ctx.beginPath();
    coords.forEach((c, i) => i ? ctx.lineTo(c[0], c[1]) : ctx.moveTo(c[0], c[1]));
    const last = coords[coords.length - 1];
    ctx.lineTo(last[0], box.y + box.h);
    ctx.lineTo(coords[0][0], box.y + box.h);
    ctx.closePath();
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.16;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    coords.forEach((c, i) => i ? ctx.lineTo(c[0], c[1]) : ctx.moveTo(c[0], c[1]));
    ctx.strokeStyle = accent;
    ctx.lineWidth = 4.2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(last[0], last[1], 7, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.restore();

    (marks || []).forEach((m) => {
      if (m.at == null || m.at < t0 || m.at > t1) return;
      const px = box.x + ((m.at - t0) / ts) * box.w;
      const py = m.price != null ? (box.y + box.h - ((m.price - min) / span) * box.h) : box.y + box.h / 2;
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, box.y);
      ctx.lineTo(px, box.y + box.h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.fillStyle = m.color;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = T.bg;
      ctx.stroke();
      ctx.fillStyle = m.color;
      ctx.font = '800 20px Inter,system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(m.label, px, box.y - 10);
      ctx.textAlign = 'left';
    });
  }

  function setText(ctx, shadow) {
    if (shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 2;
    } else {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    }
  }

  function drawFrame(ctx, d, p, opts) {
    opts = opts || {};
    const L = layout(opts.aspect);
    const theme = opts.theme === 'light' ? 'light' : 'dark';
    const T = ShareCard.THEMES[theme];
    const st = stateAt(d, p);
    const F = st.F;
    const win = signedPnl(st) >= 0;
    const accent = win ? T.green : T.red;
    const paper = !!(d && d.paper);
    const custom = !!(opts.bg && (opts.bg.video || opts.bg.image || opts.bg.el));

    ctx.clearRect(0, 0, L.W, L.H);
    drawBackground(ctx, L.W, L.H, opts);

    setText(ctx, custom);
    ctx.font = '800 36px Inter,system-ui,sans-serif';
    ctx.fillStyle = T.text;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText((d && d.botName) || 'Devameer Bot', 160, L.titleY);
    ctx.font = '600 22px Inter,system-ui,sans-serif';
    ctx.fillStyle = T.mut;
    ctx.fillText(HANDLE + ' · ' + ((d && d.badge) || 'DEVAMEER TERMINAL'), 160, L.subY);

    // bean: simple circle badge if no image; skip complex svg
    ctx.beginPath();
    ctx.arc(96, L.titleY - 8, 36, 0, Math.PI * 2);
    ctx.fillStyle = '#F1F1F3';
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#0A0A0A';
    ctx.beginPath(); ctx.ellipse(86, L.titleY - 10, 5, 9, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(108, L.titleY - 14, 5, 9, 0.2, 0, Math.PI * 2); ctx.fill();

    let bx = L.W - 48;
    const badges = [];
    if (F.hideProfit || F.hideInvested) badges.push({ t: F.hideProfit && F.hideInvested ? 'HIDDEN' : (F.hideProfit ? 'P&L HIDDEN' : 'SIZE HIDDEN'), bg: T.panel, fg: T.mut });
    if (d && d.kind !== 'account' && d.status === 'open') badges.push({ t: 'OPEN', bg: T.openBg, fg: T.openFg });
    if (d && d.kind === 'account' && d.label) badges.push({ t: d.label, bg: T.panel, fg: T.text });
    badges.push({ t: paper ? 'PAPER' : 'LIVE', bg: paper ? T.paperBg : T.liveBg, fg: paper ? T.paperFg : T.liveFg });
    badges.reverse().forEach((b) => {
      ctx.font = '800 20px Inter,system-ui,sans-serif';
      const w = ctx.measureText(b.t).width + 36;
      bx -= w;
      pill(ctx, bx, 48, b.t, b.bg, b.fg, '800 20px Inter,system-ui,sans-serif');
      bx -= 12;
    });

    const pctStr = ShareCard.fmtPct(st.pnlPct);
    const usdStr = F.hideProfit ? pctStr : (d && d.solUsd ? ShareCard.fmtUsd(st.pnlUsd != null ? st.pnlUsd : (st.pnlSol || 0) * d.solUsd) : ShareCard.fmtSol(st.pnlSol));
    const solStr = F.hideProfit ? '' : ShareCard.fmtSol(st.pnlSol);

    if (d && d.kind === 'account') {
      ctx.font = '700 20px Inter,system-ui,sans-serif';
      ctx.fillStyle = T.dim;
      ctx.fillText(((d.label || 'ALL TIME') + (F.hideProfit ? ' RETURN' : ' PNL')), L.pad, L.tickerY);
      ctx.font = '900 92px Inter,system-ui,sans-serif';
      ctx.fillStyle = accent;
      ctx.fillText(usdStr, L.pad, L.pnlY);
      ctx.font = '700 28px Inter,system-ui,sans-serif';
      ctx.fillStyle = T.mut;
      ctx.fillText(solStr + (solStr && !F.hideProfit ? '   ' + pctStr : ''), L.pad, L.solY);
      const key = st.key || 'pnl';
      const pts = (st.shown || []).map((c) => ({ t: c.t, y: c[key] != null ? c[key] : 0 }));
      if (pts.length === 1) pts.push({ t: pts[0].t + 1, y: pts[0].y });
      if (pts.length >= 2) drawChart(ctx, pts, L.chart, T, accent, []);
      ctx.font = '700 22px Inter,system-ui,sans-serif';
      ctx.fillStyle = T.mut;
      const trades = st.trades != null ? st.trades : 0;
      const wr = trades ? Math.round((st.winRate || 0) * 100) + '% win' : 'no trades yet';
      ctx.fillText(trades + ' trades · ' + wr, L.pad, L.footY);
    } else {
      ctx.font = '800 48px Inter,system-ui,sans-serif';
      ctx.fillStyle = T.text;
      ctx.fillText(ShareCard.tick(d && d.symbol), L.pad, L.tickerY);
      ctx.font = '500 24px Inter,system-ui,sans-serif';
      ctx.fillStyle = T.mut;
      ctx.fillText(((d && d.name) || '') + (d && d.agentName ? ' · ' + d.agentName : ''), L.pad, L.tickerY + 36);
      ctx.font = '900 96px Inter,system-ui,sans-serif';
      ctx.fillStyle = accent;
      ctx.fillText(F.hideProfit ? pctStr : usdStr, L.pad, L.pnlY);
      ctx.font = '700 28px Inter,system-ui,sans-serif';
      ctx.fillStyle = T.mut;
      const extra = F.hideProfit ? '' : (solStr ? solStr + '   ' + pctStr : pctStr);
      ctx.fillText(extra, L.pad, L.solY);

      const ticks = st.ticks || [];
      const visible = ticks.filter((x) => x.t <= st.tNow || x.t <= st.tBuy);
      const pts = visible.map((x) => ({ t: x.t, y: x.price }));
      if (pts.length === 1) pts.push({ t: pts[0].t + 1, y: pts[0].y });
      const marks = [];
      if (st.lp > 0 && st.tBuy != null) marks.push({ at: st.tBuy, price: st.entry, color: T.orange, label: 'IN' });
      if (st.lp >= 0.97) marks.push({ at: st.tEnd, price: st.price, color: accent, label: st.open ? 'NOW' : 'OUT' });
      if (pts.length >= 2) drawChart(ctx, pts, L.chart, T, accent, marks);

      if (st.reachedPeak && st.peak && st.peakPct != null) {
        ctx.font = '800 26px Inter,system-ui,sans-serif';
        const label = 'PEAK ' + ShareCard.fmtPct(st.peakPct);
        const tw = ctx.measureText(label).width + 40;
        const x = L.chart.x + L.chart.w - tw - 16;
        const y = L.chart.y + 16;
        roundRect(ctx, x, y, tw, 48, 16);
        ctx.fillStyle = T.green;
        ctx.globalAlpha = 0.95;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#052e16';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + tw / 2, y + 25);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      }
      ctx.font = '600 20px Inter,system-ui,sans-serif';
      ctx.fillStyle = T.dim;
      const hold = d && d.holdMs != null ? ShareCard.fmtHold(d.holdMs) : '';
      ctx.fillText([hold && ('held ' + hold), d && d.exitReason, 'devameer-bot'].filter(Boolean).join('  ·  '), L.pad, L.footY);
    }
    setText(ctx, false);
    ctx.fillStyle = T.dim;
    ctx.font = '600 18px Inter,system-ui,sans-serif';
    ctx.textAlign = 'end';
    ctx.fillText(HANDLE, L.W - L.pad, L.footY);
    ctx.textAlign = 'left';
  }

  function play(canvas, d, opts, hooks) {
    hooks = hooks || {};
    const seconds = opts && opts.seconds || durationOf(d);
    let start = 0, raf = 0, stopped = false;
    const ctx = canvas.getContext('2d');
    const L = layout(opts && opts.aspect);
    canvas.width = L.W;
    canvas.height = L.H;
    const tick = (now) => {
      if (stopped) return;
      if (!start) start = now;
      const p = Math.min(1, (now - start) / (seconds * 1000));
      if (opts && opts.bg && opts.bg.video && opts.bg.video.paused) opts.bg.video.play().catch(() => {});
      drawFrame(ctx, d, p, opts);
      if (hooks.onFrame) hooks.onFrame(p);
      if (p < 1) raf = requestAnimationFrame(tick);
      else if (hooks.onDone) hooks.onDone();
    };
    raf = requestAnimationFrame(tick);
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }

  async function waitFont() {
    try { if (typeof document !== 'undefined' && document.fonts) await document.fonts.ready; } catch { /* ignore */ }
  }

  function evenDim(n) { n = Math.round(Number(n) || 0); return n % 2 ? n + 1 : n; }

  async function blobLooksLikeMp4(blob) {
    if (!blob || blob.size < 8) return false;
    const u8 = new Uint8Array(await blob.slice(4, 8).arrayBuffer());
    return String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) === 'ftyp';
  }

  async function encodeWebCodecs(canvas, d, opts, onProgress) {
    if (typeof VideoEncoder === 'undefined') return null;
    const { Muxer, ArrayBufferTarget } = await import('/vendor/mp4-muxer.mjs');
    const L = layout(opts && opts.aspect);
    const W = evenDim(L.W), H = evenDim(L.H);
    const seconds = (opts && opts.seconds) || durationOf(d);
    const frames = Math.round(seconds * FPS);
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: { codec: 'avc', width: W, height: H },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });
    let encoderError = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => { encoderError = e; },
    });
    const codecs = ['avc1.640032', 'avc1.640028', 'avc1.4d002a', 'avc1.4d0028', 'avc1.420028', 'avc1.4d001f', 'avc1.42001f'];
    let ok = false;
    for (const codec of codecs) {
      const cfg = { codec, width: W, height: H, bitrate: 5_000_000, framerate: FPS, avc: { format: 'avc' } };
      try {
        if (typeof VideoEncoder.isConfigSupported === 'function') {
          const sup = await VideoEncoder.isConfigSupported(cfg).catch(() => null);
          if (sup && sup.supported === false) continue;
        }
        encoder.configure(cfg);
        ok = true;
        break;
      } catch { /* try next level */ }
    }
    if (!ok) { try { encoder.close(); } catch {} return null; }
    // Warm the (just-resized) canvas so the first encoded frame is not black.
    drawFrame(ctx, d, 0, opts);
    if (typeof requestAnimationFrame === 'function') await new Promise((r) => requestAnimationFrame(r));
    drawFrame(ctx, d, 0, opts);
    const video = opts && opts.bg && opts.bg.video;
    for (let i = 0; i < frames; i++) {
      const p = frames === 1 ? 1 : i / (frames - 1);
      if (video && Number.isFinite(video.duration) && video.duration > 0) {
        const t = (i / FPS) % video.duration;
        if (Math.abs(video.currentTime - t) > 0.04) {
          await new Promise((res) => {
            const done = () => { video.removeEventListener('seeked', done); res(); };
            video.addEventListener('seeked', done);
            video.currentTime = t;
            setTimeout(done, 120);
          });
        }
      }
      drawFrame(ctx, d, p, opts);
      const ts = Math.round(i * 1e6 / FPS);
      const frame = new VideoFrame(canvas, { timestamp: ts, duration: Math.round(1e6 / FPS) });
      encoder.encode(frame, { keyFrame: i % 30 === 0 });
      frame.close();
      if (onProgress && i % 8 === 0) onProgress(i / frames);
      if (encoderError) throw encoderError;
      if (encoder.encodeQueueSize > 8) await new Promise((r) => { encoder.addEventListener('dequeue', r, { once: true }); });
    }
    await encoder.flush();
    muxer.finalize();
    try { encoder.close(); } catch {}
    return new Blob([target.buffer], { type: 'video/mp4' });
  }

  async function recordCanvas(canvas, d, opts, onProgress) {
    if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) return null;
    const L = layout(opts && opts.aspect);
    const W = evenDim(L.W), H = evenDim(L.H);
    const seconds = (opts && opts.seconds) || durationOf(d);
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    drawFrame(ctx, d, 0, opts);
    const stream = canvas.captureStream(FPS);
    const mime = [
      'video/mp4;codecs=avc1.640028',
      'video/mp4;codecs=avc1.4d0028',
      'video/mp4;codecs=avc1.420028',
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) return null;
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise((res) => { rec.onstop = () => res(new Blob(chunks, { type: mime })); });
    rec.start(100);
    await new Promise((resolve) => {
      const stop = play(canvas, d, opts, { onFrame: onProgress, onDone: () => { rec.stop(); resolve(); } });
      setTimeout(() => { stop(); try { rec.stop(); } catch {} resolve(); }, (seconds + 0.6) * 1000);
    });
    return done;
  }

  async function transcodeOnServer(blob) {
    const r = await fetch('/api/replay/transcode', { method: 'POST', headers: { 'Content-Type': (blob && blob.type) || 'application/octet-stream' }, body: blob, credentials: 'same-origin' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'transcode failed');
    return r.blob();
  }

  async function exportMp4(canvas, d, opts, onProgress) {
    await waitFont();
    let raw = await encodeWebCodecs(canvas, d, opts, onProgress).catch(() => null);
    if (!(raw && raw.size > 1000)) raw = await recordCanvas(canvas, d, opts, onProgress).catch(() => null);
    if (raw && raw.size > 1000) {
      try {
        const mp4 = await transcodeOnServer(raw);
        if (mp4 && mp4.size > 1000 && await blobLooksLikeMp4(mp4)) return { blob: mp4, mime: 'video/mp4', ext: 'mp4' };
      } catch { /* fall through to a verified client MP4, never a WebM named .mp4 */ }
      if (await blobLooksLikeMp4(raw)) return { blob: raw, mime: 'video/mp4', ext: 'mp4' };
    }
    // last resort: server render (default background only)
    const qs = new URLSearchParams();
    if (d && d.kind === 'account') {
      qs.set('kind', 'account');
      if (d.range) qs.set('range', d.range);
    } else if (d && d.id) {
      qs.set('kind', 'trade');
      qs.set('id', d.id);
    }
    if (opts && opts.theme === 'light') qs.set('theme', 'light');
    if (opts && opts.aspect) qs.set('aspect', opts.aspect === '9:16' || opts.aspect === 'portrait' ? '9:16' : '1:1');
    const hide = [d && d.hideProfit && 'profit', d && d.hideInvested && 'invested'].filter(Boolean).join(',');
    if (hide) qs.set('hide', hide);
    const r = await fetch('/api/replay/render?' + qs, { credentials: 'same-origin' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not encode a real H.264 MP4');
    const blob = await r.blob();
    if (!(await blobLooksLikeMp4(blob))) throw new Error('Could not encode a real H.264 MP4');
    return { blob, mime: 'video/mp4', ext: 'mp4' };
  }

  function frameSvg(d, p, opts) {
    // Lightweight SVG frame for the server ffmpeg path (default background).
    const L = layout(opts && opts.aspect);
    const theme = opts && opts.theme === 'light' ? 'light' : 'dark';
    const T = ShareCard.THEMES[theme];
    const st = stateAt(d, p);
    const F = st.F;
    const win = signedPnl(st) >= 0;
    const accent = win ? T.green : T.red;
    const paper = !!(d && d.paper);
    const esc = ShareCard.esc;
    const pctStr = ShareCard.fmtPct(st.pnlPct);
    const usdStr = F.hideProfit ? pctStr : (d && d.solUsd ? ShareCard.fmtUsd(st.pnlUsd != null ? st.pnlUsd : (st.pnlSol || 0) * (d.solUsd || 0)) : ShareCard.fmtSol(st.pnlSol));
    const solStr = F.hideProfit ? '' : ShareCard.fmtSol(st.pnlSol);
    const title = d && d.kind === 'account' ? ((d.label || 'ALL TIME') + (F.hideProfit ? ' RETURN' : ' PNL')) : ShareCard.tick(d && d.symbol);
    const badges = [];
    if (F.hideProfit || F.hideInvested) badges.push((F.hideProfit && F.hideInvested) ? 'HIDDEN' : (F.hideProfit ? 'P&L HIDDEN' : 'SIZE HIDDEN'));
    if (d && d.kind !== 'account' && d.status === 'open') badges.push('OPEN');
    if (d && d.kind === 'account' && d.label) badges.push(d.label);
    badges.push(paper ? 'PAPER' : 'LIVE');
    const badgeXml = badges.map((t, i) => {
      const w = 28 + t.length * 12;
      const x = L.W - 48 - (i + 1) * (w + 12);
      const bg = t === 'LIVE' ? T.liveBg : t === 'PAPER' ? T.paperBg : t === 'OPEN' ? T.openBg : T.panel;
      const fg = t === 'LIVE' ? T.liveFg : t === 'PAPER' ? T.paperFg : t === 'OPEN' ? T.openFg : T.text;
      return `<rect x="${x}" y="48" width="${w}" height="40" rx="20" fill="${bg}"/>
        <text x="${x + w / 2}" y="75" text-anchor="middle" font-size="18" font-weight="800" fill="${fg}">${esc(t)}</text>`;
    }).join('');
    let chart = '';
    const pts = d && d.kind === 'account'
      ? (st.shown || []).map((c) => ({ t: c.t, y: c[st.key] != null ? c[st.key] : 0 }))
      : (st.ticks || []).filter((x) => x.t <= st.tNow || x.t <= st.tBuy).map((x) => ({ t: x.t, y: x.price }));
    if (pts.length === 1) pts.push({ t: pts[0].t + 1, y: pts[0].y });
    if (pts.length >= 2) {
      const ys = pts.map((p) => p.y);
      const min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1;
      const t0 = pts[0].t, t1 = pts[pts.length - 1].t, ts = t1 - t0 || 1;
      const c = L.chart;
      const xy = (pt) => [c.x + ((pt.t - t0) / ts) * c.w, c.y + c.h - ((pt.y - min) / span) * c.h];
      const coords = pts.map(xy);
      const dpath = coords.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ');
      const last = coords[coords.length - 1];
      const area = dpath + ` L${last[0].toFixed(1)},${(c.y + c.h).toFixed(1)} L${coords[0][0].toFixed(1)},${(c.y + c.h).toFixed(1)} Z`;
      chart = `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="22" fill="${T.panel}" fill-opacity=".72" stroke="${T.line}"/>
        <path d="${area}" fill="${accent}" fill-opacity=".16"/>
        <path d="${dpath}" fill="none" stroke="${accent}" stroke-width="4.2" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="7" fill="${accent}"/>`;
      if (st.kind === 'trade' && st.lp > 0 && st.tBuy != null) {
        const px = c.x + ((st.tBuy - t0) / ts) * c.w;
        chart += `<line x1="${px.toFixed(1)}" x2="${px.toFixed(1)}" y1="${c.y}" y2="${c.y + c.h}" stroke="${T.orange}" stroke-dasharray="6 6" stroke-width="2"/>`;
      }
    }
    const peak = (st.reachedPeak && st.peakPct != null) ? `<rect x="${L.chart.x + L.chart.w - 220}" y="${L.chart.y + 16}" width="200" height="48" rx="16" fill="${T.green}"/><text x="${L.chart.x + L.chart.w - 120}" y="${L.chart.y + 48}" text-anchor="middle" font-size="24" font-weight="800" fill="#052e16">PEAK ${esc(ShareCard.fmtPct(st.peakPct))}</text>` : '';
    const transparent = !!(opts && opts.transparent);
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${L.W}" height="${L.H}" viewBox="0 0 ${L.W} ${L.H}">
  <defs><linearGradient id="bg" x1="80%" y1="0%" x2="0%" y2="100%"><stop offset="0" stop-color="${T.bg2}"/><stop offset=".55" stop-color="${T.bg}"/></linearGradient></defs>
  ${transparent ? '' : `<rect width="${L.W}" height="${L.H}" fill="url(#bg)"/>`}
  <circle cx="96" cy="${L.titleY - 8}" r="36" fill="#F1F1F3" stroke="#111" stroke-width="3"/>
  <text x="160" y="${L.titleY}" font-family="Inter" font-size="36" font-weight="800" fill="${T.text}">${esc((d && d.botName) || 'Devameer Bot')}</text>
  <text x="160" y="${L.subY}" font-family="Inter" font-size="22" font-weight="600" fill="${T.mut}">${HANDLE} · ${esc((d && d.badge) || 'DEVAMEER TERMINAL')}</text>
  ${badgeXml}
  <text x="${L.pad}" y="${L.tickerY}" font-family="Inter" font-size="${d && d.kind === 'account' ? 20 : 48}" font-weight="800" fill="${d && d.kind === 'account' ? T.dim : T.text}">${esc(title)}</text>
  <text x="${L.pad}" y="${L.pnlY}" font-family="Inter" font-size="92" font-weight="900" fill="${accent}">${esc(usdStr)}</text>
  <text x="${L.pad}" y="${L.solY}" font-family="Inter" font-size="28" font-weight="700" fill="${T.mut}">${esc(solStr)}${!F.hideProfit && solStr ? '   ' + esc(pctStr) : ''}</text>
  ${chart}${peak}
  <text x="${L.pad}" y="${L.footY}" font-family="Inter" font-size="20" font-weight="600" fill="${T.dim}">${esc(d && d.kind === 'account' ? ((st.trades || 0) + ' trades · ' + (st.trades ? Math.round((st.winRate || 0) * 100) + '% win' : 'no trades yet')) : [d && d.holdMs != null ? 'held ' + ShareCard.fmtHold(d.holdMs) : '', d && d.exitReason, 'devameer-bot'].filter(Boolean).join('  ·  '))}</text>
  <text x="${L.W - L.pad}" y="${L.footY}" text-anchor="end" font-family="Inter" font-size="18" font-weight="600" fill="${T.dim}">${HANDLE}</text>
</svg>`;
  }

  return { FPS, HANDLE, layout, stateAt, durationOf, drawBackground, drawFrame, play, exportMp4, frameSvg, priceAt };
});
