// Server-side MP4 render from price ticks. One-at-a-time to stay light on the free plan.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Replay = require('../public/replay.js');
const card = require('../public/share-card.js');
const flow = require('./flow');

let Resvg;
function resvg() {
  if (!Resvg) Resvg = require('@resvg/resvg-js').Resvg;
  return Resvg;
}

const FONT_DIR = path.join(__dirname, '..', 'fonts');
const FONTS = ['Inter-400.ttf', 'Inter-600.ttf', 'Inter-800.ttf', 'Inter-900.ttf']
  .map((f) => path.join(FONT_DIR, f))
  .filter((f) => fs.existsSync(f));

function ffmpegBin() {
  try {
    const p = require('ffmpeg-static');
    if (p && fs.existsSync(p)) return p;
  } catch { /* fall through */ }
  return 'ffmpeg';
}

let busy = false;
function isBusy() { return busy; }

async function renderMp4({ data, theme, aspect, seconds, bgImage }) {
  if (busy) { const e = new Error('A replay is already rendering. Try again in a moment.'); e.status = 429; throw e; }
  busy = true;
  try {
    const sym = data && data.symbol ? String(data.symbol).replace(/^\$/, '') : '';
    flow.emit({ node: 'share', type: 'replay', mint: data && data.mint, symbol: sym || undefined, message: sym ? ('rendering replay for $' + sym) : 'rendering account replay', data: { aspect, theme } });
  } catch {}
  const L = Replay.layout(aspect);
  const dur = Math.max(8, Math.min(15, seconds || Replay.durationOf(data)));
  const frames = Math.round(dur * Replay.FPS);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devameer-replay-'));
  const out = path.join(tmp, 'out.mp4');
  const ResvgCls = resvg();
  try {
    const args = [
      '-y', '-hide_banner', '-loglevel', 'error',
    ];
    if (bgImage && fs.existsSync(bgImage)) {
      // still custom image under transparent UI frames
      args.push(
        '-loop', '1', '-t', String(dur), '-i', bgImage,
        '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${L.W}x${L.H}`, '-r', String(Replay.FPS), '-i', 'pipe:0',
        '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
        '-filter_complex', `[0:v]scale=${L.W}:${L.H}:force_original_aspect_ratio=increase,crop=${L.W}:${L.H},boxblur=8:1,eq=brightness=-0.12[bg];[1:v]format=rgba[ui];[bg][ui]overlay=0:0:format=auto,format=yuv420p[v]`,
        '-map', '[v]', '-map', '2:a',
      );
    } else {
      args.push(
        '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${L.W}x${L.H}`, '-r', String(Replay.FPS), '-i', 'pipe:0',
        '-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
        '-map', '0:v', '-map', '1:a',
      );
    }
    args.push(
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30',
      '-preset', 'ultrafast', '-crf', '23',
      '-profile:v', 'high', '-level', '4.1',
      '-c:a', 'aac', '-b:a', '64k', '-shortest', '-movflags', '+faststart',
      out,
    );
    const ff = spawn(ffmpegBin(), args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => { err += d; if (err.length > 4000) err = err.slice(-4000); });
    const done = new Promise((res, rej) => {
      ff.on('error', rej);
      ff.on('close', (code) => code === 0 ? res() : rej(new Error('ffmpeg exit ' + code + (err ? ': ' + err.slice(0, 300) : ''))));
    });
    for (let i = 0; i < frames; i++) {
      const p = frames === 1 ? 1 : i / (frames - 1);
      const svg = Replay.frameSvg(data, p, { theme, aspect, transparent: !!(bgImage && fs.existsSync(bgImage)) });
      const img = new ResvgCls(svg, {
        fitTo: { mode: 'width', value: L.W },
        font: { fontFiles: FONTS, loadSystemFonts: true, defaultFontFamily: 'Inter' },
        background: 'rgba(0,0,0,0)',
      }).render();
      const buf = Buffer.from(img.pixels);
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    }
    ff.stdin.end();
    await done;
    const mp4 = fs.readFileSync(out);
    if (!mp4 || mp4.length < 1000) throw new Error('empty mp4');
    return mp4;
  } finally {
    busy = false;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function transcodeWebm(buf) {
  if (busy) { const e = new Error('A replay is already rendering. Try again in a moment.'); e.status = 429; throw e; }
  if (!buf || buf.length > 25 * 1024 * 1024) { const e = new Error('Video must be 25 MB or smaller'); e.status = 400; throw e; }
  busy = true;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devameer-xcode-'));
  const inn = path.join(tmp, 'in.bin');
  const out = path.join(tmp, 'out.mp4');
  try {
    fs.writeFileSync(inn, buf);
    await new Promise((res, rej) => {
      const ff = spawn(ffmpegBin(), [
        '-y', '-hide_banner', '-loglevel', 'error', '-i', inn,
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30',
        '-preset', 'ultrafast', '-crf', '23',
        '-profile:v', 'high', '-level', '4.1',
        '-threads', '0', '-an', '-movflags', '+faststart', out,
      ]);
      let err = '';
      ff.stderr.on('data', (d) => { err += d; });
      ff.on('error', rej);
      ff.on('close', (code) => code === 0 ? res() : rej(new Error('ffmpeg exit ' + code + (err ? ': ' + err.slice(0, 300) : ''))));
    });
    return fs.readFileSync(out);
  } finally {
    busy = false;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}


function sendMp4(res, buf, name) {
  res.set({
    'Content-Type': 'video/mp4',
    'Content-Disposition': 'inline; filename="' + (name || 'devameer-replay.mp4') + '"',
    'Cache-Control': 'no-store',
    'Content-Length': buf.length,
  });
  res.end(buf);
}

function mount(app, { engine, ticks, share, requireAdmin, requireRead }) {
  async function tradePayload(id, q) {
    let d = share.publicTrade(engine, id);
    if (!d) return null;
    d = share.applyPrivacy(await share.decorateTrade(d, ticks), share.flagsOf(q));
    return d;
  }
  function accountPayload(q) {
    return share.applyPrivacy(share.publicAccount(engine, q), share.flagsOf(q));
  }

  app.get('/api/replay/trade/:id', requireRead, async (req, res) => {
    const d = await tradePayload(req.params.id, req.query);
    if (!d) return res.status(404).json({ error: 'trade not found' });
    res.json(d);
  });
  app.get('/api/replay/account', requireRead, (req, res) => {
    try { res.json(accountPayload(req.query)); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  const runRender = async (req, res, d, name) => {
    try {
      const theme = share.themeOf(req.query);
      const aspect = (req.query.aspect === '9:16' || req.query.aspect === 'portrait') ? '9:16' : '1:1';
      const seconds = Math.max(8, Math.min(15, +req.query.seconds || 0)) || undefined;
      const buf = await renderMp4({ data: d, theme, aspect, seconds });
      sendMp4(res, buf, name);
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message || 'render failed' });
    }
  };

  app.get('/share/trade/:id.mp4', async (req, res) => {
    const d = await tradePayload(req.params.id, req.query);
    if (!d) return res.status(404).json({ error: 'trade not found' });
    const tick = (d.symbol || 'trade').replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
    await runRender(req, res, d, 'devameer-' + tick + '-replay.mp4');
  });
  app.get('/share/account.mp4', async (req, res) => {
    try {
      const d = await Promise.resolve(accountPayload(req.query));
      await runRender(req, res, d, 'devameer-account-replay.mp4');
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.get('/api/replay/render', requireAdmin, async (req, res) => {
    try {
      const kind = req.query.kind || (req.query.id ? 'trade' : 'account');
      const d = kind === 'trade' ? await tradePayload(req.query.id, req.query) : await Promise.resolve(accountPayload(req.query));
      if (!d) return res.status(404).json({ error: 'not found' });
      const name = d.kind === 'account' ? 'devameer-account-replay.mp4' : 'devameer-' + String(d.symbol || 'trade').replace(/[^A-Za-z0-9]/g, '') + '-replay.mp4';
      await runRender(req, res, d, name);
    } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
  });
  app.post('/api/replay/transcode', requireAdmin, expressRaw, async (req, res) => {
    try {
      const buf = await transcodeWebm(req.body);
      sendMp4(res, buf, 'devameer-replay.mp4');
    } catch (e) { res.status(e.status || 500).json({ error: e.message || 'transcode failed' }); }
  });
}

const expressRaw = (req, res, next) => {
  const express = require('express');
  return express.raw({ type: () => true, limit: '25mb' })(req, res, next);
};

module.exports = { renderMp4, transcodeWebm, isBusy, ffmpegBin, mount };

