/* Minimal pipeline recorder: live or replay-last-N, MP4 download. Record UI is never drawn into the file. */
(() => {
  const FPS = 30;
  const LIVE_MAX = 60;
  const REPLAY_MAX = 90;
  const $ = (s, r = document) => r.querySelector(s);

  const ui = {
    mode: 'live',
    minutes: 1,
    speed: 4,
    aspect: '9:16',
  };
  let session = null; // { kind, encoder, started, timer, stop }

  function P() { return window.DevameerPipeline; }

  function fmtTime(s) {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function setStatus(msg) {
    const el = $('#recStatus');
    if (el) el.textContent = msg || '';
  }

  function fileName(kind, aspect, extra) {
    const asp = aspect === '9:16' ? '9x16' : aspect === '1:1' ? 'square' : '16x9';
    const bits = ['devameer-pipeline', kind, asp, extra].filter(Boolean);
    return bits.join('-') + '.mp4';
  }

  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  async function transcodeOnServer(webm) {
    const r = await fetch('/api/flow/transcode', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': webm.type || 'video/webm' },
      body: webm,
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'transcode failed');
    return r.blob();
  }

  async function createWebCodecs(canvas, W, H) {
    if (typeof VideoEncoder === 'undefined') return null;
    let Muxer, ArrayBufferTarget;
    try {
      ({ Muxer, ArrayBufferTarget } = await import('/vendor/mp4-muxer.mjs'));
    } catch { return null; }
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
      const cfg = { codec, width: W, height: H, bitrate: 3_500_000, framerate: FPS, avc: { format: 'avc' } };
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
    let i = 0;
    return {
      kind: 'webcodecs',
      async add(src) {
        if (encoderError) throw encoderError;
        const ts = Math.round(i * 1e6 / FPS);
        const frame = new VideoFrame(src, { timestamp: ts, duration: Math.round(1e6 / FPS) });
        encoder.encode(frame, { keyFrame: i % 30 === 0 });
        frame.close();
        i++;
        if (encoder.encodeQueueSize > 8) await new Promise((r) => { encoder.addEventListener('dequeue', r, { once: true }); });
      },
      async finish() {
        await encoder.flush();
        muxer.finalize();
        const blob = new Blob([target.buffer], { type: 'video/mp4' });
        if (encoderError) throw encoderError;
        return blob.size > 1000 ? blob : null;
      },
      cancel() { try { encoder.close(); } catch {} },
    };
  }

  function createRecorder(canvas, W, H) {
    if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) return null;
    const stream = canvas.captureStream(FPS);
    const mime = [
      'video/mp4;codecs=avc1.42001f',
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) return null;
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3_500_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise((res) => { rec.onstop = () => res(new Blob(chunks, { type: mime })); rec.onerror = () => res(new Blob(chunks, { type: mime })); });
    rec.start(200);
    return {
      kind: mime.includes('mp4') ? 'mp4' : 'webm',
      mime,
      async add() { /* canvas.captureStream already samples drawn frames */ },
      async finish() {
        if (rec.state !== 'inactive') rec.stop();
        const blob = await done;
        return blob && blob.size > 1000 ? blob : null;
      },
      cancel() { try { if (rec.state !== 'inactive') rec.stop(); } catch {} },
    };
  }

  async function finalizeBlob(raw, fallbackKind) {
    if (!raw) throw new Error('nothing recorded');
    if (raw.type && raw.type.includes('mp4') && raw.size > 1000) return { blob: raw, ext: 'mp4' };
    if (fallbackKind === 'mp4') return { blob: raw, ext: 'mp4' };
    try {
      setStatus('Transcoding to MP4…');
      const mp4 = await transcodeOnServer(raw);
      if (mp4 && mp4.size > 1000) return { blob: mp4, ext: 'mp4' };
    } catch (e) {
      console.warn('transcode failed', e);
    }
    return { blob: raw, ext: 'webm' };
  }

  async function makeEncoder(canvas, W, H) {
    const wc = await createWebCodecs(canvas, W, H).catch(() => null);
    if (wc) {
      try {
        await wc.add(canvas);
        return wc;
      } catch (e) {
        try { wc.cancel(); } catch {}
        console.warn('WebCodecs rejected frame, falling back', e);
      }
    }
    const rec = createRecorder(canvas, W, H);
    if (rec) return rec;
    throw new Error('Recording is not supported in this browser');
  }

  function showLiveBar(on) {
    $('#recPop')?.classList.toggle('hidden', on);
    $('#recLiveBar')?.classList.toggle('hidden', !on);
    $('#recToggle')?.classList.toggle('hot', on);
  }

  function bindSeg(root, attr, key) {
    root.querySelectorAll('[' + attr + ']').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (session) return;
        ui[key] = attr === 'data-mins' || attr === 'data-speed' ? +btn.getAttribute(attr) : btn.getAttribute(attr);
        root.querySelectorAll('[' + attr + ']').forEach((b) => b.classList.toggle('on', b === btn));
        if (key === 'mode') $('#recReplayOpts')?.classList.toggle('hidden', ui.mode !== 'replay');
        $('#recStart').textContent = ui.mode === 'live' ? 'Start live' : 'Replay & download';
      });
    });
  }

  function openPop(open) {
    const pop = $('#recPop');
    if (!pop) return;
    if (session) return;
    const show = open == null ? pop.classList.contains('hidden') : open;
    pop.classList.toggle('hidden', !show);
    $('#recToggle')?.setAttribute('aria-expanded', show ? 'true' : 'false');
  }

  async function startLive() {
    const pipe = P();
    if (!pipe) throw new Error('pipeline not ready');
    const { W, H } = pipe.aspectSize(ui.aspect);
    const rec = pipe.ensureRecCanvas(W, H);
    pipe.drawCapture(performance.now(), 0.033);
    const encoder = await makeEncoder(rec.canvas, W, H);
    const started = performance.now();
    let last = started;
    let stopped = false;
    let adding = false;
    const tick = (now) => {
      if (stopped) return;
      if ((now - last) >= (1000 / FPS) - 2) {
        pipe.drawCapture(now, (now - last) / 1000);
        if (!adding) {
          adding = true;
          Promise.resolve(encoder.add(rec.canvas)).catch(() => {}).finally(() => { adding = false; });
        }
        last = now;
      }
      const elapsed = (now - started) / 1000;
      const timer = $('#recTimer');
      if (timer) timer.textContent = fmtTime(elapsed) + ' / ' + fmtTime(LIVE_MAX);
      if (elapsed >= LIVE_MAX) stopLive();
    };
    pipe.setCapture(tick);
    session = { kind: 'live', encoder, started, stop: () => {} };
    session.stop = () => { stopped = true; };
    showLiveBar(true);
    setStatus('');
    $('#recTimer').textContent = '0:00 / ' + fmtTime(LIVE_MAX);
  }

  async function stopLive() {
    const s = session;
    if (!s || s.kind !== 'live' || s.finishing) return;
    s.finishing = true;
    s.stop();
    const pipe = P();
    pipe.setCapture(null);
    setStatus('Saving…');
    try {
      const raw = await s.encoder.finish();
      const out = await finalizeBlob(raw, s.encoder.kind);
      const name = fileName('live', ui.aspect).replace(/\.mp4$/, '.' + out.ext);
      downloadBlob(out.blob, name);
      setStatus('Saved ' + name);
    } catch (e) {
      setStatus(e.message || 'save failed');
    } finally {
      pipe.endCapture();
      session = null;
      showLiveBar(false);
      openPop(true);
    }
  }

  async function startReplay() {
    const pipe = P();
    if (!pipe) throw new Error('pipeline not ready');
    setStatus('Loading events…');
    const r = await fetch('/api/flow/events?limit=2000', { credentials: 'same-origin' });
    if (!r.ok) throw new Error('could not load events');
    const data = await r.json();
    const all = (data.events || []).filter((e) => e && e.type !== 'hello').slice().sort((a, b) => (a.at || 0) - (b.at || 0));
    const tEnd = Date.now();
    const windowMs = ui.minutes * 60 * 1000;
    const cut = tEnd - windowMs;
    const speed = ui.speed || 1;
    let evs = all.filter((e) => (e.at || 0) >= cut);
    let pre = all.filter((e) => (e.at || 0) < cut);
    let t0 = evs.length ? evs[0].at : tEnd - 8000;
    let t1 = evs.length ? Math.max(evs[evs.length - 1].at, t0 + 4000) : tEnd;
    let outDur = (t1 - t0) / 1000 / speed;
    if (outDur > REPLAY_MAX) {
      t0 = t1 - REPLAY_MAX * speed * 1000;
      pre = all.filter((e) => (e.at || 0) < t0);
      evs = all.filter((e) => (e.at || 0) >= t0);
      outDur = REPLAY_MAX;
    }
    outDur = Math.max(6, Math.min(REPLAY_MAX, outDur));
    const frames = Math.round(outDur * FPS);
    const { W, H } = pipe.aspectSize(ui.aspect);
    const snap = pipe.snapWorld();
    pipe.holdLive = true;
    pipe.freezeWorld = true;
    pipe.clock.useSim = true;
    showLiveBar(true);
    $('#recTimer').textContent = 'Rendering…';
    try {
      pipe.seedSilent(pre);
      pipe.clearMotion();
      const rec = pipe.ensureRecCanvas(W, H);
      pipe.clock.sim = t0;
      rec.fit = rec.fit;
      const encoder = await makeEncoder(rec.canvas, W, H);
      let evIdx = 0;
      let sim = t0;
      for (let i = 0; i < frames; i++) {
        const target = t0 + (i / FPS) * speed * 1000;
        while (evIdx < evs.length && (evs[evIdx].at || 0) <= target) {
          pipe.onEvent(evs[evIdx], { now: evs[evIdx].at || target });
          evIdx++;
        }
        const dt = Math.max(0.001, (target - sim) / 1000);
        pipe.clock.sim = target;
        pipe.stepWorld(dt, target);
        pipe.drawCapture(target, dt);
        await encoder.add(rec.canvas);
        if (i % 10 === 0) {
          const t = $('#recTimer');
          if (t) t.textContent = 'Rendering ' + Math.round((i / frames) * 100) + '%';
          setStatus('Replay ' + ui.minutes + 'm at ' + speed + 'x — ' + evs.length + ' events');
          await new Promise((res) => requestAnimationFrame(res));
        }
        sim = target;
      }
      setStatus('Saving…');
      const raw = await encoder.finish();
      const out = await finalizeBlob(raw, encoder.kind);
      const name = fileName('replay', ui.aspect, ui.minutes + 'm-' + speed + 'x').replace(/\.mp4$/, '.' + out.ext);
      downloadBlob(out.blob, name);
      setStatus('Saved ' + name + (evs.length ? '' : ' (quiet window, ambient only)'));
    } finally {
      pipe.clock.useSim = false;
      pipe.restoreWorld(snap);
      pipe.freezeWorld = false;
      pipe.holdLive = false;
      pipe.flushQueued();
      pipe.endCapture();
      session = null;
      showLiveBar(false);
      openPop(true);
    }
  }

  function bind() {
    if (bind._ok) return;
    bind._ok = true;
    bindSeg($('#recPop'), 'data-mode', 'mode');
    bindSeg($('#recReplayOpts'), 'data-mins', 'minutes');
    bindSeg($('#recReplayOpts'), 'data-speed', 'speed');
    bindSeg($('#recPop'), 'data-aspect', 'aspect');
    $('#recToggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (session) return;
      openPop();
    });
    $('#recStart')?.addEventListener('click', async () => {
      if (session) return;
      try {
        if (ui.mode === 'live') await startLive();
        else {
          session = { kind: 'replay' };
          await startReplay();
        }
      } catch (e) {
        session = null;
        showLiveBar(false);
        openPop(true);
        setStatus(e.message || 'record failed');
      }
    });
    $('#recStop')?.addEventListener('click', () => { if (session && session.kind === 'live') stopLive(); });
    document.addEventListener('click', (e) => {
      if (session) return;
      const hud = $('#recHud');
      if (hud && !hud.contains(e.target)) openPop(false);
    });
  }

  window.DevameerFlowRecord = {
    bind,
    startLive,
    stopLive,
    startReplay,
    get ui() { return ui; },
    set(opts) { Object.assign(ui, opts || {}); },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
