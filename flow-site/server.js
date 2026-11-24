// Read-only Devameer Bot Pipeline site. Proxies flow APIs with FLOW_READ_TOKEN; never exposes the token.
const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = +process.env.PORT || 4001;
const BOT_URL = (process.env.BOT_URL || 'https://devameer-bot.onrender.com').replace(/\/$/, '');
const DASHBOARD_URL = (process.env.DASHBOARD_URL || BOT_URL).replace(/\/$/, '');
const TOKEN = process.env.FLOW_READ_TOKEN || '';
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('devameer-flow:' + (TOKEN || crypto.randomBytes(16).toString('hex'))).digest('hex');
const KEEP_AWAKE = /^(1|true|yes|on)$/i.test(process.env.KEEP_AWAKE || '');
const PUBLIC_URL = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || '';

const sign = (v) => v + '.' + crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const verify = (s) => {
  if (!s) return false;
  const i = s.lastIndexOf('.');
  const v = s.slice(0, i);
  return sign(v) === s && +v.split(':')[1] > Date.now();
};

const attempts = new Map();
function loginLimited(ip) {
  const a = attempts.get(ip) || { n: 0, at: Date.now() };
  if (Date.now() - a.at > 15 * 60000) { a.n = 0; a.at = Date.now(); }
  if (a.n >= 10) return { ok: false, a };
  return { ok: true, a };
}

function botRequest(pathname, { method = 'GET', headers = {}, body, timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(BOT_URL + pathname);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method,
      headers: { ...headers, host: u.host },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('upstream timeout')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8kb' }));
app.use(cookieParser());

const requireSession = (req, res, next) => verify(req.cookies.sid) ? next() : res.status(401).json({ error: 'login required' });

app.get('/healthz', (req, res) => res.json({ ok: true, bot: BOT_URL }));

app.get('/api/session', (req, res) => {
  if (!verify(req.cookies.sid)) return res.status(401).json({ error: 'login required' });
  res.json({ ok: true, dashboardUrl: DASHBOARD_URL });
});

app.post('/api/login', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip;
  const lim = loginLimited(ip);
  if (!lim.ok) return res.status(429).json({ error: 'too many attempts, wait 15 min' });
  const password = req.body && req.body.password;
  if (typeof password !== 'string' || !password) return res.status(400).json({ error: 'password required' });
  try {
    const up = await botRequest('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ password }),
      timeoutMs: 90000,
    });
    if (up.status !== 200) {
      lim.a.n++; lim.a.at = Date.now(); attempts.set(ip, lim.a);
      let err = 'wrong password';
      try { err = JSON.parse(up.body.toString()).error || err; } catch {}
      return res.status(up.status === 429 ? 429 : 401).json({ error: err });
    }
    attempts.delete(ip);
    res.cookie('sid', sign(`flow:${Date.now() + 30 * 864e5}`), {
      httpOnly: true, sameSite: 'strict',
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      maxAge: 30 * 864e5,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: 'pipeline is waking up, try again in a moment' });
  }
});

app.post('/api/logout', (req, res) => { res.clearCookie('sid'); res.json({ ok: true }); });

function tokenHeaders(extra = {}) {
  if (!TOKEN) throw new Error('FLOW_READ_TOKEN is not set');
  return { authorization: 'Bearer ' + TOKEN, accept: 'application/json', ...extra };
}

async function proxyJson(req, res, pathname) {
  if (!TOKEN) return res.status(503).json({ error: 'FLOW_READ_TOKEN is not set' });
  try {
    const q = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    const up = await botRequest(pathname + q, { headers: tokenHeaders() });
    res.status(up.status);
    const ct = up.headers['content-type'];
    if (ct) res.setHeader('content-type', ct);
    res.send(up.body);
  } catch (e) {
    res.status(502).json({ error: 'pipeline is waking up, try again in a moment' });
  }
}

app.get('/api/flow', requireSession, (req, res) => proxyJson(req, res, '/api/flow'));
app.get('/api/flow/events', requireSession, (req, res) => proxyJson(req, res, '/api/flow/events'));
app.get('/api/state', requireSession, (req, res) => proxyJson(req, res, '/api/state'));

app.get('/api/flow/stream', requireSession, (req, res) => {
  if (!TOKEN) return res.status(503).json({ error: 'FLOW_READ_TOKEN is not set' });
  const u = new URL(BOT_URL + '/api/flow/stream');
  const lib = u.protocol === 'https:' ? https : http;
  const up = lib.request({
    protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
    path: u.pathname, method: 'GET',
    headers: { authorization: 'Bearer ' + TOKEN, accept: 'text/event-stream', host: u.host },
  }, (r) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.status(r.statusCode || 200);
    r.pipe(res);
    req.on('close', () => { try { r.destroy(); } catch {} });
  });
  up.setTimeout(0);
  up.on('error', () => { if (!res.headersSent) res.status(502).json({ error: 'stream unavailable' }); else try { res.end(); } catch {} });
  up.end();
});


function ffmpegBin() {
  try {
    const p = require('ffmpeg-static');
    if (p && fs.existsSync(p)) return p;
  } catch { /* fall through */ }
  return 'ffmpeg';
}

let xcodeBusy = false;
app.post('/api/flow/transcode', requireSession, express.raw({ type: () => true, limit: '150mb' }), async (req, res) => {
  if (xcodeBusy) return res.status(429).json({ error: 'A video is already transcoding. Try again in a moment.' });
  const buf = req.body;
  if (!buf || !buf.length) return res.status(400).json({ error: 'video required' });
  if (buf.length > 150 * 1024 * 1024) return res.status(400).json({ error: 'Video must be 150 MB or smaller' });
  xcodeBusy = true;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devameer-flow-xcode-'));
  const inn = path.join(tmp, 'in.bin');
  const out = path.join(tmp, 'out.mp4');
  try {
    fs.writeFileSync(inn, buf);
    await new Promise((resolve, reject) => {
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
      const to = setTimeout(() => { try { ff.kill('SIGKILL'); } catch {} reject(new Error('transcode timed out')); }, 8 * 60 * 1000);
      ff.on('error', (e) => { clearTimeout(to); reject(e); });
      ff.on('close', (code) => {
        clearTimeout(to);
        code === 0 ? resolve() : reject(new Error('ffmpeg exit ' + code + (err ? ': ' + err.slice(0, 300) : '')));
      });
    });
    const mp4 = fs.readFileSync(out);
    if (!mp4 || mp4.length < 1000) throw new Error('empty mp4');
    res.set({
      'Content-Type': 'video/mp4',
      'Content-Disposition': 'attachment; filename="devameer-pipeline.mp4"',
      'Cache-Control': 'no-store',
      'Content-Length': mp4.length,
    });
    res.end(mp4);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'transcode failed' });
  } finally {
    xcodeBusy = false;
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

app.get('/vendor/mp4-muxer.mjs', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, '..', 'public', 'vendor', 'mp4-muxer.mjs'));
});

const pub = path.join(__dirname, 'public');
const threeDir = path.join(__dirname, 'node_modules', 'three');
if (fs.existsSync(threeDir)) {
  app.use('/vendor/three', express.static(threeDir, { maxAge: '7d' }));
}
app.use(express.static(pub, { extensions: ['html'] }));

app.listen(PORT, () => console.log(`Devameer Bot Pipeline on :${PORT} · bot ${BOT_URL}`));

if (KEEP_AWAKE && PUBLIC_URL) setInterval(() => fetch(PUBLIC_URL + '/healthz').catch(() => {}), 10 * 60000);
