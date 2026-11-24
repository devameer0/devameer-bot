/* Minimal pipeline recorder: fast offline replay + uncapped live MP4 download. Record UI is never drawn into the file. */
(() => {
  const FPS = 30;
  const LIVE_WARN_SEC = 10 * 60;
  const $ = (s, r = document) => r.querySelector(s);

  const ui = {
    mode: 'live',
    minutes: 1,
    speed: 4,
    aspect: '9:16',
  };
  let session = null;

  function P() { return window.DevameerPipeline; }

  function fmtTime(s) {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h) return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    return m + ':' + String(sec).padStart(2, '0');
  }

  function setStatus(msg) {
    const el = $('#recStatus');
    if (el) el.textContent = msg || '';
  }

  function setProgress(p) {
    const wrap = $('#recProgress');
    const bar = $('#recProgressBar');
    const pct = $('#recPct');
    const on = p != null && Number.isFinite(p);
    wrap?.classList.toggle('hidden', !on);
    pct?.classList.toggle('hidden', !on);
    if (on) {
      const v = Math.max(0, Math.min(1, p));
      if (bar) bar.style.width = Math.round(v * 100) + '%';
      if (pct) pct.textContent = Math.round(v * 100) + '%';
    } else if (bar) bar.style.width = '0%';
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
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 8000);
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

  function assembleStream(chunks, length) {
    chunks.sort((a, b) => a.position - b.position);
    const out = new Uint8Array(length);
    for (const c of chunks) out.set(c.data, c.position);
    return new Blob([out], { type: 'video/mp4' });
  }

  async function createWebCodecs(canvas, W, H) {
    if (typeof VideoEncoder === 'undefined') return null;
    let Muxer, StreamTarget;
    try {
      ({ Muxer, StreamTarget } = await import('/vendor/mp4-muxer.mjs'));
    } catch { return null; }
    const chunks = [];
    let length = 0;
    const target = new StreamTarget({
      onData: (data, position) => {
        const u8 = data instanceof Uint8Array
          ? data
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        chunks.push({ data: u8.slice(), position });
        length = Math.max(length, position + u8.byteLength);
      },
    });
    const muxer = new Muxer({
      target,
      video: { codec: 'avc', width: W, height: H },
      fastStart: false,
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
      // Create the VideoFrame immediately so later canvas draws cannot overwrite it.
      add(src) {
        if (encoderError) return Promise.reject(encoderError);
        const ts = Math.round(i * 1e6 / FPS);
        const frame = new VideoFrame(src, { timestamp: ts, duration: Math.round(1e6 / FPS) });
        encoder.encode(frame, { keyFrame: i % 30 === 0 });
        frame.close();
        i++;
        if (encoder.encodeQueueSize > 24) {
          return new Promise((r) => { encoder.addEventListener('dequeue', r, { once: true }); });
        }
        return Promise.resolve();
      },
      async finish() {
        await encoder.flush();
        muxer.finalize();
        try { encoder.close(); } catch {}
        const blob = assembleStream(chunks, length);
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
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3_500_000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise((res) => { rec.onstop = () => res(new Blob(chunks, { type: mime })); rec.onerror = () => res(new Blob(chunks, { type: mime })); });
    rec.start(250);
    return {
      kind: mime.includes('mp4') ? 'mp4' : 'webm',
      mime,
      add() { return Promise.resolve(); },
      async finish() {
        if (rec.state !== 'inactive') rec.stop();
        const blob = await done;
        return blob && blob.size > 1000 ? blob : null;
      },
      cancel() { try { if (rec.state !== 'inactive') rec.stop(); } catch {} },
    };
  }

  async function blobLooksLikeMp4(blob) {
    if (!blob || blob.size < 8) return false;
    const u8 = new Uint8Array(await blob.slice(4, 8).arrayBuffer());
    return String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) === 'ftyp';
  }

  async function finalizeBlob(raw, fallbackKind) {
    if (!raw) throw new Error('nothing recorded');
    try {
      setStatus('Transcoding to MP4…');
      const mp4 = await transcodeOnServer(raw);
      if (mp4 && mp4.size > 1000 && await blobLooksLikeMp4(mp4)) return { blob: mp4, ext: 'mp4' };
    } catch (e) {
      console.warn('transcode failed', e);
    }
    // Never download WebM under a .mp4 name. Keep a client MP4 only if the container is real.
    if (await blobLooksLikeMp4(raw)) return { blob: raw, ext: 'mp4' };
    throw new Error('Could not encode a real H.264 MP4. Server transcode failed.');
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

  function showLiveBar(on, opts) {
    $('#recPop')?.classList.toggle('hidden', on);
    $('#recLiveBar')?.classList.toggle('hidden', !on);
    $('#recToggle')?.classList.toggle('hot', on);
    const stop = $('#recStop');
    if (stop) stop.classList.toggle('hidden', !!(opts && opts.hideStop));
    if (!on) setProgress(null);
  }

  function bindSeg(root, attr, key) {
    if (!root) return;
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
    let warned = false;
    const tick = (now) => {
      if (stopped) return;
      if ((now - last) >= (1000 / FPS) - 2) {
        pipe.drawCapture(now, (now - last) / 1000);
        encoder.add(rec.canvas);
        last = now;
      }
      const elapsed = (now - started) / 1000;
      const timer = $('#recTimer');
      if (timer) timer.textContent = fmtTime(elapsed);
      if (!warned && elapsed >= LIVE_WARN_SEC) {
        warned = true;
        setStatus('Long recording — this tab uses more memory as it runs. Stop whenever you want to download.');
      }
    };
    pipe.setCapture(tick);
    session = { kind: 'live', encoder, started, stop: () => { stopped = true; } };
    showLiveBar(true);
    setStatus('');
    setProgress(null);
    $('#recTimer').textContent = '0:00';
  }

  async function stopLive() {
    const s = session;
    if (!s || s.kind !== 'live' || s.finishing) return;
    s.finishing = true;
    s.stop();
    const pipe = P();
    pipe.setCapture(null);
    const t0 = performance.now();
    setStatus('Saving…');
    try {
      const raw = await s.encoder.finish();
      const out = await finalizeBlob(raw, s.encoder.kind);
      const name = fileName('live', ui.aspect).replace(/\.mp4$/, '.' + out.ext);
      downloadBlob(out.blob, name);
      const ms = Math.round(performance.now() - t0);
      setStatus('Saved ' + name + ' in ' + (ms / 1000).toFixed(2) + 's');
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
    const tLoad = performance.now();
    setStatus('Loading events…');
    setProgress(0);
    const from = Date.now() - ui.minutes * 60 * 1000;
    const qs = new URLSearchParams({ limit: '20000', from: String(from) });
    const r = await fetch('/api/flow/events?' + qs, { credentials: 'same-origin' });
    if (!r.ok) throw new Error('could not load events');
    const data = await r.json();
    const all = (data.events || []).filter((e) => e && e.type !== 'hello').slice().sort((a, b) => (a.at || 0) - (b.at || 0));
    const tEnd = Date.now();
    const cut = from;
    const speed = ui.speed || 1;
    const evs = all.filter((e) => (e.at || 0) >= cut);
    const pre = all.filter((e) => (e.at || 0) < cut);
    let t0 = evs.length ? evs[0].at : tEnd - 8000;
    let t1 = evs.length ? Math.max(evs[evs.length - 1].at, t0 + 4000) : tEnd;
    let outDur = Math.max(4, (t1 - t0) / 1000 / speed);
    const frames = Math.round(outDur * FPS);
    const { W, H } = pipe.aspectSize(ui.aspect);
    const snap = pipe.snapWorld();
    pipe.holdLive = true;
    pipe.freezeWorld = true;
    pipe.clock.useSim = true;
    showLiveBar(true, { hideStop: true });
    $('#recTimer').textContent = 'Rendering…';
    const tEnc = performance.now();
    try {
      pipe.seedSilent(pre);
      pipe.clearMotion();
      const rec = pipe.ensureRecCanvas(W, H);
      pipe.clock.sim = t0;
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
        if (i % 45 === 0 || i === frames - 1) {
          const p = (i + 1) / frames;
          setProgress(p);
          const t = $('#recTimer');
          if (t) t.textContent = 'Rendering ' + Math.round(p * 100) + '%';
          if (i % 90 === 0) await new Promise((res) => setTimeout(res, 0));
        }
        sim = target;
      }
      setStatus('Saving…');
      const raw = await encoder.finish();
      const out = await finalizeBlob(raw, encoder.kind);
      const name = fileName('replay', ui.aspect, ui.minutes + 'm-' + speed + 'x').replace(/\.mp4$/, '.' + out.ext);
      downloadBlob(out.blob, name);
      const encSec = ((performance.now() - tEnc) / 1000).toFixed(2);
      const totalSec = ((performance.now() - tLoad) / 1000).toFixed(2);
      setStatus('Saved ' + name + ' — ' + evs.length + ' events in ' + encSec + 's' + (evs.length ? '' : ' (quiet window, ambient only)'));
      window.__devameerLastReplay = { name, events: evs.length, encodeMs: Math.round(performance.now() - tEnc), totalMs: Math.round(performance.now() - tLoad), outDur, frames, minutes: ui.minutes, speed };
      return window.__devameerLastReplay;
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
        if (ui.mode === 'live') {
          session = { kind: 'live' };
          await startLive();
        } else {
          session = { kind: 'replay' };
          await startReplay();
        }
      } catch (e) {
        session = null;
        showLiveBar(false);
        openPop(true);
        setProgress(null);
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
