/* Devameer Bot Pipeline — 3D virtual office. Cute chibi agents at desks, driven only by real SSE events. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const SCALE = 0.012;
const SCREEN_W = 640;
const SCREEN_H = 400;
const PACKET_CAP = 28;
const SCREEN_LINES = 5;
const ORIGIN = { x: 1400, y: 560 };

const ACCESSORY = {
  feed: 'antenna', jupiter: 'ring', rpc: 'hex', rugs: 'shield',
  sniper: 'visor', scout: 'ears', curve: 'mohawk', graduate: 'cap',
  risk: 'halo', buy: 'bow', monitor: 'lens', exits: 'key',
  sell: 'chevron', db: 'disks', share: 'play', withdraw: 'lock', errors: 'siren',
};

function toWorld(n) {
  return new THREE.Vector3((n.x - ORIGIN.x) * SCALE, 0, (n.y - ORIGIN.y) * SCALE);
}

function hashId(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0);
}

function pipe() { return window.DevameerPipeline; }

function world() {
  const P = pipe();
  return P && typeof P.world === 'function' ? P.world() : null;
}

function agentMode(id, now) {
  const P = pipe();
  if (P && typeof P.agentModeOf === 'function') return P.agentModeOf(id, now);
  return 'idle';
}

let active = false;
let built = false;
let raf = 0;
let lastT = 0;
let fps = 0;
let hidden = false;
let lastStepNow = -1;
let renderer, camera, scene, controls, clock;
let capRenderer = null;
let floor, packetMesh, packetCount = 0, gridHelper, vignette, keyLight, hemiLight, fillLight, rimLight, floorGlow;
let geos = {};
let themeName = 'dark';
let fly = null;
let closeOn = null;
let overviewShot = null;
let raycaster = null;
let pointerDown = null;
let composer = null, capComposer = null;
let bloomPass = null, ssaoPass = null, bokehPass = null, filmPass = null, vignettePass = null, outputPass = null;
let floorReflector = null, dust = null, dustGeo = null, lightBeams = [];
let ptrLock = null;
let walkOn = false, tourOn = false;
let fxLevel = 'high';
let fpsLowFor = 0;
let shakeAmt = 0;
let camShake = new THREE.Vector3();
const walk = { keys: Object.create(null), joy: { x: 0, z: 0 }, vert: 0, look: { x: 0, y: 0 } };
const clickables = [];
const desks = new Map();
const cables = [];
const packets = [];
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _col = new THREE.Color();

function isMob() {
  return Math.min(window.innerWidth, window.innerHeight) < 720 || 'ontouchstart' in window;
}

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl'));
  } catch { return false; }
}

function makeGeos() {
  for (const k of Object.keys(geos)) {
    try { geos[k].dispose(); } catch {}
  }
  geos = {
    head: new THREE.SphereGeometry(0.22, 20, 16),
    eye: new THREE.SphereGeometry(0.038, 8, 8),
    pupil: new THREE.SphereGeometry(0.018, 8, 8),
    body: new THREE.CylinderGeometry(0.13, 0.16, 0.28, 12),
    belly: new THREE.SphereGeometry(0.12, 10, 8),
    upperArm: new THREE.CylinderGeometry(0.038, 0.032, 0.18, 8),
    foreArm: new THREE.CylinderGeometry(0.032, 0.028, 0.16, 8),
    hand: new THREE.SphereGeometry(0.042, 8, 8),
    thigh: new THREE.CylinderGeometry(0.048, 0.042, 0.2, 8),
    shin: new THREE.CylinderGeometry(0.04, 0.036, 0.18, 8),
    foot: new THREE.SphereGeometry(0.05, 8, 8),
    joint: new THREE.SphereGeometry(0.04, 8, 8),
    deskTop: new THREE.BoxGeometry(1.35, 0.05, 0.78),
    deskLeg: new THREE.BoxGeometry(0.055, 0.52, 0.055),
    deskLip: new THREE.BoxGeometry(1.35, 0.03, 0.04),
    chairSeat: new THREE.BoxGeometry(0.4, 0.045, 0.4),
    chairBack: new THREE.BoxGeometry(0.4, 0.42, 0.04),
    chairLeg: new THREE.BoxGeometry(0.04, 0.38, 0.04),
    keyboard: new THREE.BoxGeometry(0.42, 0.02, 0.16),
    keyRow: new THREE.BoxGeometry(0.38, 0.008, 0.025),
    monitor: new THREE.BoxGeometry(0.90, 0.58, 0.04),
    monitorStem: new THREE.CylinderGeometry(0.025, 0.03, 0.16, 8),
    monitorBase: new THREE.BoxGeometry(0.28, 0.02, 0.14),
    screen: new THREE.PlaneGeometry(0.84, 0.52),
    status: new THREE.SphereGeometry(0.035, 10, 10),
    tag: new THREE.PlaneGeometry(0.95, 0.22),
    shadow: new THREE.CircleGeometry(0.42, 16),
    antenna: new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6),
    cone: new THREE.ConeGeometry(0.08, 0.1, 8),
    torus: new THREE.TorusGeometry(0.16, 0.018, 8, 16),
    hex: new THREE.CylinderGeometry(0.1, 0.1, 0.04, 6),
    cap: new THREE.CylinderGeometry(0.18, 0.2, 0.05, 8),
    capTop: new THREE.BoxGeometry(0.08, 0.01, 0.28),
    disk: new THREE.CylinderGeometry(0.09, 0.09, 0.03, 12),
    bow: new THREE.SphereGeometry(0.05, 8, 6),
    mug: new THREE.CylinderGeometry(0.035, 0.03, 0.07, 16),
    mugHandle: new THREE.TorusGeometry(0.022, 0.007, 8, 14, Math.PI),
    phone: new THREE.BoxGeometry(0.046, 0.01, 0.086),
    packet: new THREE.SphereGeometry(0.055, 10, 10),
  };
}

function mat(color, opts) {
  return new THREE.MeshStandardMaterial(Object.assign({
    color, roughness: 0.48, metalness: 0.16,
  }, opts || {}));
}

function addAcc(head, kind, color, mats) {
  const g = new THREE.Group();
  const acc = mat(color, { roughness: 0.35, metalness: 0.3, emissive: color, emissiveIntensity: 0.18 });
  if (kind === 'antenna') {
    const rod = new THREE.Mesh(geos.antenna, acc); rod.position.y = 0.28; g.add(rod);
    const tip = new THREE.Mesh(geos.cone, acc); tip.position.y = 0.38; tip.scale.setScalar(0.7); g.add(tip);
  } else if (kind === 'ring') {
    const r = new THREE.Mesh(geos.torus, acc); r.rotation.x = 0.9; r.position.y = 0.02; g.add(r);
  } else if (kind === 'hex') {
    const h = new THREE.Mesh(geos.hex, acc); h.rotation.x = Math.PI / 2; h.position.z = 0.2; h.position.y = 0.04; g.add(h);
  } else if (kind === 'shield') {
    const s = new THREE.Mesh(geos.hex, acc); s.scale.set(1.3, 0.4, 1.5); s.rotation.x = Math.PI / 2; s.position.set(0, 0.02, 0.22); g.add(s);
  } else if (kind === 'visor') {
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.07, 0.08), mat('#111111', { metalness: 0.6, roughness: 0.2 }));
    v.position.set(0, 0.04, 0.18); g.add(v);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.02), mat(color, { emissive: color, emissiveIntensity: 0.5, metalness: 0.4 }));
    glass.position.set(0, 0.04, 0.22); g.add(glass);
  } else if (kind === 'ears') {
    const e1 = new THREE.Mesh(geos.cone, acc); e1.position.set(-0.12, 0.22, 0); e1.scale.set(0.6, 1.1, 0.6); g.add(e1);
    const e2 = e1.clone(); e2.position.x = 0.12; g.add(e2);
  } else if (kind === 'mohawk') {
    for (let i = -1; i <= 1; i++) {
      const f = new THREE.Mesh(geos.cone, acc);
      f.position.set(0, 0.22, i * 0.07); f.scale.set(0.45, 0.7 + (i === 0 ? 0.25 : 0), 0.45);
      g.add(f);
    }
  } else if (kind === 'cap') {
    const c = new THREE.Mesh(geos.cap, acc); c.position.y = 0.2; g.add(c);
    const brim = new THREE.Mesh(geos.capTop, acc); brim.position.set(0, 0.2, 0.12); g.add(brim);
  } else if (kind === 'halo') {
    const r = new THREE.Mesh(geos.torus, acc); r.rotation.x = Math.PI / 2; r.position.y = 0.32; r.scale.setScalar(0.7); g.add(r);
  } else if (kind === 'bow') {
    const b = new THREE.Mesh(geos.bow, acc); b.scale.set(1.4, 0.7, 0.5); b.position.set(0, -0.16, 0.16); g.add(b);
  } else if (kind === 'lens') {
    const l = new THREE.Mesh(geos.torus, acc); l.scale.setScalar(0.35); l.position.set(0.1, 0.04, 0.2); g.add(l);
  } else if (kind === 'key') {
    const k = new THREE.Mesh(geos.torus, acc); k.scale.setScalar(0.28); k.position.set(0, -0.12, 0.18); g.add(k);
    const shaft = new THREE.Mesh(geos.antenna, acc); shaft.rotation.z = Math.PI / 2; shaft.position.set(0.1, -0.12, 0.18); shaft.scale.set(1, 0.6, 1); g.add(shaft);
  } else if (kind === 'chevron') {
    const c = new THREE.Mesh(geos.cone, acc); c.rotation.x = Math.PI; c.position.set(0, 0.26, 0); c.scale.set(0.7, 0.5, 0.7); g.add(c);
  } else if (kind === 'disks') {
    for (let i = 0; i < 3; i++) {
      const d = new THREE.Mesh(geos.disk, acc); d.position.y = 0.22 + i * 0.04; d.scale.setScalar(1 - i * 0.1); g.add(d);
    }
  } else if (kind === 'play') {
    const p = new THREE.Mesh(geos.cone, acc); p.rotation.z = -Math.PI / 2; p.position.set(0.02, 0.02, 0.22); p.scale.set(0.7, 0.9, 0.4); g.add(p);
  } else if (kind === 'lock') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.06), acc); body.position.set(0, -0.1, 0.18); g.add(body);
    const sh = new THREE.Mesh(geos.torus, acc); sh.scale.setScalar(0.22); sh.position.set(0, -0.04, 0.18); g.add(sh);
  } else if (kind === 'siren') {
    const s = new THREE.Mesh(geos.cone, mat('#EF4444', { emissive: '#EF4444', emissiveIntensity: 0.7 }));
    s.position.y = 0.26; s.scale.set(0.7, 0.55, 0.7); g.add(s);
  }
  head.add(g);
  return g;
}

function makeLimb(upperGeo, lowerGeo, upperMat, lowerMat, handMat, dir) {
  const root = new THREE.Group();
  const upper = new THREE.Mesh(upperGeo, upperMat);
  upper.position.y = -0.09;
  const joint = new THREE.Mesh(geos.joint, lowerMat);
  joint.position.y = -0.18;
  const lowerG = new THREE.Group();
  lowerG.position.y = -0.18;
  const lower = new THREE.Mesh(lowerGeo, lowerMat);
  lower.position.y = -0.08;
  const hand = new THREE.Mesh(geos.hand, handMat);
  hand.position.y = -0.17;
  lowerG.add(lower, hand);
  root.add(upper, joint, lowerG);
  root.userData = { lower: lowerG, hand, dir };
  return root;
}

function makeBot(node) {
  const color = node.color || '#3B82F6';
  const cream = '#F3EDE3';
  const ink = '#16161A';
  const dark = '#1C1C22';
  const bodyMat = mat(color);
  const creamMat = mat(cream, { roughness: 0.55 });
  const inkMat = mat(ink, { roughness: 0.4 });
  const darkMat = mat(dark, { roughness: 0.5 });
  const accMat = mat(color, { emissive: color, emissiveIntensity: 0.12 });

  const bot = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.56;
  const torso = new THREE.Mesh(geos.body, bodyMat);
  torso.position.y = 0.02;
  const belly = new THREE.Mesh(geos.belly, creamMat);
  belly.position.set(0, -0.02, 0.1);
  belly.scale.set(0.95, 0.8, 0.7);
  body.add(torso, belly);

  const head = new THREE.Group();
  head.position.y = 0.28;
  const skull = new THREE.Mesh(geos.head, creamMat);
  const cheek = new THREE.Mesh(geos.head, bodyMat);
  cheek.scale.set(1.02, 0.55, 1.02); cheek.position.y = -0.08;
  const eyeL = new THREE.Group(); eyeL.position.set(-0.07, 0.04, 0.17);
  const eyeR = new THREE.Group(); eyeR.position.set(0.07, 0.04, 0.17);
  const ewL = new THREE.Mesh(geos.eye, inkMat);
  const ewR = new THREE.Mesh(geos.eye, inkMat);
  const pL = new THREE.Mesh(geos.pupil, mat('#FAFAFA')); pL.position.z = 0.024;
  const pR = new THREE.Mesh(geos.pupil, mat('#FAFAFA')); pR.position.z = 0.024;
  eyeL.add(ewL, pL); eyeR.add(ewR, pR);
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.007, 6, 10, Math.PI), inkMat);
  mouth.position.set(0, -0.07, 0.18); mouth.rotation.set(0, 0, Math.PI);
  head.add(skull, cheek, eyeL, eyeR, mouth);
  addAcc(head, ACCESSORY[node.id] || 'antenna', color, { acc: accMat });
  body.add(head);

  const armMat = bodyMat;
  const lArm = makeLimb(geos.upperArm, geos.foreArm, armMat, armMat, creamMat, -1);
  const rArm = makeLimb(geos.upperArm, geos.foreArm, armMat, armMat, creamMat, 1);
  lArm.position.set(-0.16, 0.1, 0.02);
  rArm.position.set(0.16, 0.1, 0.02);
  body.add(lArm, rArm);

  const hips = new THREE.Group();
  const lLeg = makeLimb(geos.thigh, geos.shin, bodyMat, bodyMat, darkMat, -1);
  const rLeg = makeLimb(geos.thigh, geos.shin, bodyMat, bodyMat, darkMat, 1);
  lLeg.position.set(-0.08, 0, 0);
  rLeg.position.set(0.08, 0, 0);
  hips.add(lLeg, rLeg);
  bot.add(hips, body);
  bot.userData = { body, head, lArm, rArm, lLeg, rLeg, eyeL, eyeR, mouth, color };
  return bot;
}

function seatedPose(bot) {
  const u = bot.userData;
  // thighs forward, shins down — sitting
  u.lLeg.rotation.x = Math.PI / 2 - 0.15;
  u.rLeg.rotation.x = Math.PI / 2 - 0.15;
  u.lLeg.userData.lower.rotation.x = -Math.PI / 2 + 0.1;
  u.rLeg.userData.lower.rotation.x = -Math.PI / 2 + 0.1;
  u.lLeg.position.y = 0.42;
  u.rLeg.position.y = 0.42;
  u.body.position.y = 0.56;
  // arms hover over keyboard
  u.lArm.rotation.set(-0.85, 0.15, 0.35);
  u.rArm.rotation.set(-0.85, -0.15, -0.35);
  u.lArm.userData.lower.rotation.x = -1.05;
  u.rArm.userData.lower.rotation.x = -1.05;
  u.head.rotation.set(0.18, 0, 0);
}

function makeScreenTex() {
  const c = document.createElement('canvas');
  c.width = SCREEN_W; c.height = SCREEN_H;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return { canvas: c, ctx, tex };
}

function clipLine(ctx, text, maxW) {
  const s = String(text || '');
  if (ctx.measureText(s).width <= maxW) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

const FALLBACK_PROMPT = {
  feed: ['Ingest the PumpPortal websocket: newToken, migration, and tokenTrade for open positions.', 'Refresh pump.fun lists and forward each new mint to Sentinel.'],
  jupiter: ['Quote SOL/USD from lite-api.jup.ag, falling back to api.coingecko.com.', 'Supply the live SOL price to Watch and Broker for valuation.'],
  rpc: ['Poll Solana RPC every 3000ms for bonding-curve state.', 'Watch at most 200 mints; emit curve ticks and surface RPC errors.'],
  rugs: ['Reject if this creator already rugged (prior-rug set).', 'Reject if the dev holds more than 20% of supply.', 'On the sniper path, reject if non-dev buys in the first 15s exceed 30%.', 'Reject if liquidity is below 2 SOL (sniper fresh launches are exempt).'],
  sniper: ['Select PumpPortal launches less than 60s old that already show first organic buys.', 'Require at least 0.5 SOL added to the curve since creation and a rising last tick.', 'Exits for this agent: take profit 60%, stop loss 25%, max hold 3m.'],
  scout: ['Select live-streamed or X-linked tokens with 1h volume of at least $5,000.', 'Require curve progress between 10% and 80% and +3% momentum over 30s, still ticking up.', 'Exits for this agent: take profit 40%, stop loss 20%, max hold 10m.'],
  curve: ['Select tokens 30–75% through the bonding curve, older than 2 minutes.', 'Require +8% momentum over 60s and a rising last tick.', 'Exits for this agent: take profit 30%, stop loss 15%, max hold 8m.'],
  graduate: ['Select tokens 85–97% through the curve, still climbing, close to graduating.', 'Require +2% momentum over 30s and a rising last tick.', 'Exits for this agent: take profit 25%, stop loss 12%, max hold 10m.'],
  risk: ['Allow at most 3 open positions at once.', 'Block new buys if realized loss today reaches 0.25 SOL, or if the 5x stack goal is hit.', 'Keep scanning and exits running when new buys are on hold. Enforce a 5s buy cooldown.', 'Trade size 0.02 SOL, capped at 0.05 SOL.'],
  buy: ['Place buys at 0.02 SOL (cap 0.05 SOL) with 10% slippage.', 'Priority fee 0.0005 SOL. Paper mode when DRY_RUN is on.', 'Only buy after Oracle has cleared risk. Record the fill for Archivist and Watch.'],
  monitor: ['Track every open position, pin those mints, and follow curve and Jupiter prices.', 'Refresh about every 3000ms and hand off exit candidates to Keeper.'],
  exits: ['Scout: TP 40% / SL 20% / max hold 10m. Sniper: TP 60% / SL 25% / max hold 3m.', 'Rider: TP 30% / SL 15% / max hold 8m. Graduate: TP 25% / SL 12% / max hold 10m.', 'When a threshold is hit, emit the exit reason and send the position to Closer.'],
  sell: ['Execute Keeper exit signals (take profit, stop loss, or max hold) as sells.', 'Paper mode when DRY_RUN is on. Save the close and notify Editor for a replay.'],
  db: ['Persist trades, withdrawals, and flow events (cap 20000 events, ring 2000).', 'Record opens, closes, and withdrawal receipts from Broker, Closer, and Vault.'],
  share: ['Build public share cards and replay MP4s for closed trades and the account.', 'Public links must never include wallet, keys, admin, or withdraw destinations.'],
  withdraw: ['Keep a 0.005 SOL reserve. Send only to the configured withdraw address.', 'Paper withdrawals are recorded without moving live funds.'],
  errors: ['Collect buy/sell failures, rug rejects, risk holds, and Solana RPC errors.', 'Surface the alert and keep the rest of the pipeline running.'],
};

function promptLinesFor(id) {
  const w = world();
  const cfg = w && w.configs && w.configs[id];
  if (cfg && Array.isArray(cfg.prompt) && cfg.prompt.length) return cfg.prompt;
  return FALLBACK_PROMPT[id] || [];
}

function paintScreen(entry, rows, mode, now) {
  const ctx = entry.ctx, w = SCREEN_W, h = SCREEN_H;
  const flash = entry.flashUntil && now < entry.flashUntil;
  const flashK = flash ? (entry.flashUntil - now) / 900 : 0;
  ctx.fillStyle = flash ? mixHex('#14532D', '#07140C', flashK) : '#07140C';
  ctx.fillRect(0, 0, w, h);

  const headerH = 44;
  ctx.fillStyle = '#0B1F14';
  ctx.fillRect(0, 0, w, headerH);
  const dots = ['#F43F5E', '#F59E0B', '#22C55E'];
  dots.forEach((c, i) => {
    ctx.beginPath(); ctx.fillStyle = c; ctx.globalAlpha = 0.9;
    ctx.arc(18 + i * 16, 22, 5, 0, 7); ctx.fill();
  });
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#86EFAC';
  ctx.font = '800 20px ui-monospace,Menlo,monospace';
  const title = entry.title || entry.name || 'agent';
  ctx.fillText(clipLine(ctx, title, w - 220), 64, 22);
  ctx.textAlign = 'right';
  ctx.font = '800 12px ui-monospace,SFMono-Regular,Menlo,monospace';
  const modeLabel = mode === 'working' ? 'LIVE' : (mode === 'blocked' ? 'BLOCKED' : (mode === 'waiting' ? 'WAIT' : 'IDLE'));
  ctx.fillStyle = mode === 'working' ? '#86EFAC' : (mode === 'blocked' ? '#FCA5A5' : (mode === 'waiting' ? '#FCD34D' : '#71717A'));
  ctx.fillText(modeLabel, w - 14, 22);

  // System prompt block — real role instructions
  const prompts = promptLinesFor(entry.agentId || entry.id);
  ctx.textAlign = 'left';
  ctx.font = '700 11px Inter,system-ui,sans-serif';
  ctx.fillStyle = '#4ADE80';
  const promptTop = headerH + 8;
  ctx.fillText('SYSTEM PROMPT', 16, promptTop + 8);
  ctx.font = '600 14px ui-monospace,SFMono-Regular,Menlo,monospace';
  ctx.fillStyle = '#86EFAC';
  let py = promptTop + 28;
  const pLineH = 18;
  const maxPrompt = 4;
  const shownP = (prompts || []).slice(0, maxPrompt);
  shownP.forEach((line) => {
    ctx.fillText(clipLine(ctx, '· ' + line, w - 28), 16, py);
    py += pLineH;
  });
  const promptBoxH = 16 + 22 + shownP.length * pLineH + 8;
  ctx.strokeStyle = 'rgba(74,222,128,0.28)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(8, headerH + 4, w - 16, promptBoxH);
  const logTop = headerH + 4 + promptBoxH + 10;

  // Prompt-style live log
  ctx.font = '700 17px ui-monospace,SFMono-Regular,Menlo,monospace';
  const turns = (rows || []).slice(-3);
  const wall = Date.now();
  let y = logTop + 16;
  const blink = (Math.floor(now / 480) % 2) === 0;
  if (!turns.length) {
    ctx.fillStyle = '#52525B';
    ctx.fillText('waiting for first event', 16, y);
    if (blink) { ctx.fillStyle = '#A1A1AA'; ctx.fillRect(16 + ctx.measureText('waiting for first event ').width, y - 12, 9, 18); }
  } else {
    turns.forEach((row) => {
      const input = row.input || ('> ' + (row.text || ''));
      const think = row.think || 'processing';
      const result = row.result || row.text || '';
      const age = wall - (row.at || 0);
      const liveType = age >= 0 && age < 2400;
      let thinkShown = think, showResult = true, typing = false;
      if (liveType) {
        const n = Math.min(think.length, Math.max(0, Math.floor(age / 28)));
        thinkShown = think.slice(0, n);
        showResult = n >= think.length && age > think.length * 28 + 140;
        typing = !showResult;
      }
      if (row.incoming) {
        ctx.fillStyle = 'rgba(59,130,246,0.16)';
        ctx.fillRect(8, y - 16, w - 16, 22);
      }
      ctx.fillStyle = '#93C5FD';
      ctx.fillText(clipLine(ctx, input, w - 28), 16, y);
      y += 20;
      ctx.fillStyle = '#A1A1AA';
      const thinkLine = '  thinking: ' + thinkShown + (typing && blink ? '▋' : '');
      ctx.fillText(clipLine(ctx, thinkLine, w - 28), 16, y);
      y += 20;
      if (showResult) {
        ctx.fillStyle = row.tone || '#E4E4E7';
        ctx.fillText(clipLine(ctx, '  ' + result, w - 28), 16, y);
        y += 22;
      } else {
        y += 8;
      }
    });
    if (blink && mode === 'working') {
      ctx.fillStyle = '#4ADE80';
      ctx.fillRect(16, y - 6, 9, 18);
    }
  }
  if (flash) {
    ctx.strokeStyle = 'rgba(147,197,253,' + (0.3 + flashK * 0.7) + ')';
    ctx.lineWidth = 8;
    ctx.strokeRect(3, 3, w - 6, h - 6);
  }
  entry.tex.needsUpdate = true;
}

function paintLogScreen(entry, rows, mode, now) {
  if (!entry || !entry.ctx) return;
  const ctx = entry.ctx, w = SCREEN_W, h = SCREEN_H;
  const flash = entry.flashUntil && now < entry.flashUntil;
  const flashK = flash ? (entry.flashUntil - now) / 900 : 0;
  ctx.fillStyle = flash ? mixHex('#14532D', '#07140C', flashK) : '#07140C';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#0B1F14';
  ctx.fillRect(0, 0, w, 44);
  const dots = ['#F43F5E', '#F59E0B', '#22C55E'];
  dots.forEach((c, i) => { ctx.beginPath(); ctx.fillStyle = c; ctx.arc(18 + i * 16, 22, 5, 0, 7); ctx.fill(); });
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#86EFAC';
  ctx.font = '800 20px ui-monospace,Menlo,monospace';
  ctx.fillText(clipLine(ctx, 'LIVE LOG', w - 160), 64, 22);
  ctx.textAlign = 'right';
  ctx.font = '800 12px ui-monospace,Menlo,monospace';
  const modeLabel = mode === 'working' ? 'LIVE' : (mode === 'blocked' ? 'BLOCKED' : (mode === 'waiting' ? 'WAIT' : 'IDLE'));
  ctx.fillStyle = mode === 'working' ? '#86EFAC' : (mode === 'blocked' ? '#FCA5A5' : (mode === 'waiting' ? '#FCD34D' : '#4ADE80'));
  ctx.fillText(modeLabel, w - 14, 22);
  ctx.textAlign = 'left';
  ctx.font = '700 18px ui-monospace,Menlo,monospace';
  const turns = (rows || []).slice(-5);
  const wall = Date.now();
  let y = 70;
  const blink = (Math.floor(now / 480) % 2) === 0;
  if (!turns.length) {
    ctx.fillStyle = '#166534';
    ctx.fillText('waiting for first event', 16, y);
    if (blink) { ctx.fillStyle = '#4ADE80'; ctx.fillRect(16 + ctx.measureText('waiting for first event ').width, y - 12, 9, 18); }
  } else {
    turns.forEach((row) => {
      const input = row.input || ('> ' + (row.text || ''));
      const think = row.think || 'processing';
      const result = row.result || row.text || '';
      const age = wall - (row.at || 0);
      const liveType = age >= 0 && age < 2400;
      let thinkShown = think, showResult = true, typing = false;
      if (liveType) {
        const n = Math.min(think.length, Math.max(0, Math.floor(age / 28)));
        thinkShown = think.slice(0, n);
        showResult = n >= think.length && age > think.length * 28 + 140;
        typing = !showResult;
      }
      ctx.fillStyle = '#86EFAC';
      ctx.fillText(clipLine(ctx, input, w - 28), 16, y); y += 22;
      ctx.fillStyle = '#4ADE80';
      ctx.fillText(clipLine(ctx, '  thinking: ' + thinkShown + (typing && blink ? '▋' : ''), w - 28), 16, y); y += 22;
      if (showResult) { ctx.fillStyle = row.tone || '#BBF7D0'; ctx.fillText(clipLine(ctx, '  ' + result, w - 28), 16, y); y += 24; }
      else y += 8;
    });
    if (blink && mode === 'working') { ctx.fillStyle = '#4ADE80'; ctx.fillRect(16, y - 6, 9, 18); }
  }
  entry.tex.needsUpdate = true;
}

function paintDeskScreens(d, rows, mode, now) {
  if (!d || !d.scr) return;
  paintScreen(d.scr, rows, mode, now);
  if (d.scr2) paintLogScreen(d.scr2, rows, mode, now);
}

function mixHex(a, b, t) {
  const pa = parseInt(String(a).replace('#', ''), 16);
  const pb = parseInt(String(b).replace('#', ''), 16);
  const mix = (sh) => Math.round(((pa >> sh) & 255) * t + ((pb >> sh) & 255) * (1 - t));
  return '#' + [mix(16), mix(8), mix(0)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

function makeNameTag(title, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  const r = 20;
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = 'rgba(18,18,20,0.92)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(8, 10, 240, 44, r);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#FAFAFA';
  ctx.font = '700 18px Inter,system-ui,sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(title, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const mesh = new THREE.Mesh(geos.tag, new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }));
  mesh.position.y = 1.38;
  return mesh;
}

const ROOM_W = 3.15;
const ROOM_D = 3.45;
const HALL_W = 2.4;
const WALL_T = 0.08;
const CEIL_H = 3.05;
const DOOR_W = 1.16;
const DOOR_H = 2.18;
const TRAY_Y = 2.62;
const ATRIUM = 4.55;
const DEPTS = [
  { id: 'intake', name: 'Intake', ids: ['feed', 'jupiter', 'rpc'] },
  { id: 'security', name: 'Security', ids: ['rugs'] },
  { id: 'hunters', name: 'Hunters', ids: ['sniper', 'scout', 'curve', 'graduate'] },
  { id: 'risk', name: 'Risk', ids: ['risk'] },
  { id: 'trading', name: 'Trading', ids: ['buy', 'monitor', 'exits', 'sell'] },
  { id: 'back', name: 'Back office', ids: ['db', 'share', 'withdraw', 'errors'] },
];

const rooms = new Map();
const colliders = [];
const windowMats = [];
const doorList = [];
const lampPosts = [];
let hqRoot = null;
let roofGroup = null;
let skyGroup = null;
let hqMats = {};
let hqSign = null;
let wallScreen = null;
let wallScreenTex = null;
let wallScreenCtx = null;
let roofForced = 'auto'; // auto | on | off
let spinOn = false;
let todChoice = 'auto';
let todMode = 'afternoon';
let todBlend = 1;
let todFrom = null;
let todTo = null;
let todT = 1;
let sunMesh = null, moonMesh = null, starPoints = null, cloudMeshes = [];
let hazeFog = null;
const TOD_KEYS = ['morning', 'afternoon', 'night'];
let walkDest = null, walkLookAt = null, walkMarker = null;
let inspectObj = null, inspectPrev = null;
let walkDrag = { down: false, dragged: false, x: 0, y: 0, id: -1, pinch: 0 };
const walkLook = { yaw: 0, pitch: 0 };

function hallCenter() { return ATRIUM + HALL_W / 2; }
function officeCenter() { return ATRIUM + HALL_W + ROOM_D / 2; }

function hqLayout() {
  const mid = officeCenter();
  const specs = [];
  const place = (id, cx, cz, door, dept) => specs.push({ id, cx, cz, door, dept, w: ROOM_W, d: ROOM_D });
  const xs = [-3.35, 0, 3.35];
  ['feed', 'jupiter', 'rpc'].forEach((id, i) => place(id, xs[i], -mid, 's', 'intake'));
  const west = [-6.7, -3.35, 0, 3.35, 6.7];
  ['rugs', 'buy', 'monitor', 'exits', 'sell'].forEach((id, i) => place(id, -mid, west[i], 'e', i === 0 ? 'security' : 'trading'));
  ['risk', 'sniper', 'scout', 'curve', 'graduate'].forEach((id, i) => place(id, mid, west[i], 'w', i === 0 ? 'risk' : 'hunters'));
  place('db', -6.7, mid, 'n', 'back');
  place('share', -3.35, mid, 'n', 'back');
  place('withdraw', 3.35, mid, 'n', 'back');
  place('errors', 6.7, mid, 'n', 'back');
  return specs;
}

function addCollider(minx, maxx, minz, maxz, miny, maxy, kind) {
  colliders.push({ minx, maxx, minz, maxz, miny: miny == null ? 0 : miny, maxy: maxy == null ? CEIL_H : maxy, kind: kind || 'wall' });
}

function wallPieces(geosList, x0, x1, z0, z1, y0, y1) {
  const w = Math.abs(x1 - x0), d = Math.abs(z1 - z0), h = y1 - y0;
  if (w < 0.015 || d < 0.015 || h < 0.015) return;
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  geosList.push(g);
}

function doorCutX(solid, glass, x0, x1, z, y0, y1, doorCx, useGlass) {
  const z0 = z - WALL_T / 2, z1 = z + WALL_T / 2;
  const left = doorCx - DOOR_W / 2, right = doorCx + DOOR_W / 2;
  const bucket = useGlass ? glass : solid;
  wallPieces(bucket, x0, left, z0, z1, y0, y1);
  wallPieces(bucket, right, x1, z0, z1, y0, y1);
  wallPieces(bucket, left, right, z0, z1, y0 + DOOR_H, y1);
  addCollider(x0, left, z0, z1);
  addCollider(right, x1, z0, z1);
  addCollider(left, right, z0, z1, DOOR_H, y1);
}

function doorCutZ(solid, glass, z0, z1, x, y0, y1, doorCz, useGlass) {
  const x0 = x - WALL_T / 2, x1 = x + WALL_T / 2;
  const lo = doorCz - DOOR_W / 2, hi = doorCz + DOOR_W / 2;
  const bucket = useGlass ? glass : solid;
  wallPieces(bucket, x0, x1, z0, lo, y0, y1);
  wallPieces(bucket, x0, x1, hi, z1, y0, y1);
  wallPieces(bucket, x0, x1, lo, hi, y0 + DOOR_H, y1);
  addCollider(x0, x1, z0, lo);
  addCollider(x0, x1, hi, z1);
  addCollider(x0, x1, lo, hi, DOOR_H, y1);
}

function makeDoorPlate(name, role, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#F7F6F2';
  ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = color || '#C4A574';
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 500, 148);
  ctx.fillStyle = color || '#C4A574';
  ctx.fillRect(0, 0, 14, 160);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#1C1917';
  ctx.font = '800 52px Inter,system-ui,sans-serif';
  ctx.fillText(String(name || '').slice(0, 18), 36, 72);
  ctx.fillStyle = '#57534E';
  ctx.font = '650 30px Inter,system-ui,sans-serif';
  ctx.fillText(String(role || '').slice(0, 28), 36, 122);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(0.92, 0.29),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }),
  );
}

function makeArchSign() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 192;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 1024, 192);
  ctx.fillStyle = '#F4F1EA';
  ctx.beginPath(); ctx.roundRect(8, 16, 1008, 160, 20); ctx.fill();
  ctx.strokeStyle = '#E8E2D6';
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.fillStyle = '#1C1917';
  ctx.font = '800 92px Inter,system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('DEVAMEER BOT HQ', 512, 100);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(6.4, 1.2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }),
  );
  return mesh;
}

function makeDeptSign(text, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(247,246,242,0.94)';
  ctx.fillRect(0, 0, 512, 96);
  ctx.strokeStyle = color || '#C4A574';
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, 504, 88);
  ctx.fillStyle = '#1C1917';
  ctx.font = '800 40px Inter,system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(text).toUpperCase(), 256, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 0.32),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide }),
  );
}

function makePlant(seed) {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.12, 8), mat('#6B4F3A', { roughness: 0.85 }));
  pot.position.y = 0.06;
  const dirt = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 8), mat('#1C1917', { roughness: 1 }));
  dirt.position.y = 0.12;
  const leafCol = seed % 2 ? '#3F7A2A' : '#1F6B3A';
  const foliage = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), mat(leafCol, { roughness: 0.9 }));
  foliage.position.y = 0.34;
  foliage.scale.set(1, 1.2, 1);
  g.add(pot, dirt, foliage);
  return g;
}

function doorAnchor(room) {
  const { cx, cz, door, w, d } = room;
  if (door === 's') return new THREE.Vector3(cx, TRAY_Y, cz + d / 2 + 0.45);
  if (door === 'n') return new THREE.Vector3(cx, TRAY_Y, cz - d / 2 - 0.45);
  if (door === 'e') return new THREE.Vector3(cx + w / 2 + 0.45, TRAY_Y, cz);
  return new THREE.Vector3(cx - w / 2 - 0.45, TRAY_Y, cz);
}

function snapToHall(p) {
  const hc = hallCenter();
  const x = Math.max(-hc, Math.min(hc, p.x));
  const z = Math.max(-hc, Math.min(hc, p.z));
  const dx = Math.abs(Math.abs(p.x) - hc);
  const dz = Math.abs(Math.abs(p.z) - hc);
  if (dx < dz) return new THREE.Vector3(p.x < 0 ? -hc : hc, TRAY_Y, z);
  return new THREE.Vector3(x, TRAY_Y, p.z < 0 ? -hc : hc);
}

function hallWayPoints(a, b) {
  const hc = hallCenter();
  const A = snapToHall(a), B = snapToHall(b);
  const pts = [A];
  const sameX = Math.abs(A.x - B.x) < 0.2, sameZ = Math.abs(A.z - B.z) < 0.2;
  if (sameX || sameZ) { pts.push(B); return pts.slice(1); }
  // Two-corner routes around the atrium ring
  const c1 = new THREE.Vector3(A.x, TRAY_Y, B.z);
  const c2 = new THREE.Vector3(B.x, TRAY_Y, A.z);
  // Prefer corners that stay on the ring (x or z near ±hc)
  const onRing = (p) => Math.abs(Math.abs(p.x) - hc) < 0.25 || Math.abs(Math.abs(p.z) - hc) < 0.25;
  if (onRing(c1)) { pts.push(c1, B); }
  else { pts.push(c2, B); }
  return pts.slice(1);
}

function trayCurve(fromId, toId) {
  const a = rooms.get(fromId), b = rooms.get(toId);
  const da = desks.get(fromId), db = desks.get(toId);
  if (!a || !b || !da || !db) return null;
  const monA = new THREE.Vector3(), monB = new THREE.Vector3();
  if (da.screen) da.screen.getWorldPosition(monA); else da.root.getWorldPosition(monA);
  if (db.screen) db.screen.getWorldPosition(monB); else db.root.getWorldPosition(monB);
  monA.y += 0.04; monB.y += 0.04;
  const doorA = doorAnchor(a), doorB = doorAnchor(b);
  const upA = monA.clone(); upA.y = TRAY_Y;
  const upB = monB.clone(); upB.y = TRAY_Y;
  const pts = [monA, upA, doorA, ...hallWayPoints(doorA, doorB), doorB, upB, monB];
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.12);
}

function hitsWall(x, y, z, r) {
  r = r == null ? 0.18 : r;
  if (y > CEIL_H + 0.4) return false;
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (y > b.maxy + 0.05 || y + 0.35 < b.miny) continue;
    if (x + r > b.minx && x - r < b.maxx && z + r > b.minz && z - r < b.maxz) return true;
  }
  return false;
}

function unstuck(p, r) {
  r = r == null ? 0.18 : r;
  if (!hitsWall(p.x, p.y, p.z, r)) return;
  let best = null, bestD = 1e9;
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (p.y > b.maxy + 0.05 || p.y + 0.35 < b.miny) continue;
    if (!(p.x + r > b.minx && p.x - r < b.maxx && p.z + r > b.minz && p.z - r < b.maxz)) continue;
    const opts = [
      { x: b.minx - r - 0.02, z: p.z },
      { x: b.maxx + r + 0.02, z: p.z },
      { x: p.x, z: b.minz - r - 0.02 },
      { x: p.x, z: b.maxz + r + 0.02 },
    ];
    for (const o of opts) {
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      if (d < bestD) { bestD = d; best = o; }
    }
  }
  if (best) { p.x = best.x; p.z = best.z; }
}

function resolveWalk(prev) {
  const p = camera.position;
  if (!hitsWall(p.x, p.y, p.z)) return;
  const nx = p.x, nz = p.z;
  p.x = nx; p.z = prev.z;
  if (!hitsWall(p.x, p.y, p.z)) return;
  p.x = prev.x; p.z = nz;
  if (!hitsWall(p.x, p.y, p.z)) return;
  p.copy(prev);
  unstuck(p);
}

function cullRooms() {
  if (!camera || !rooms.size) return;
  const cx = camera.position.x, cz = camera.position.z, cy = camera.position.y;
  for (const room of rooms.values()) {
    const dist = Math.hypot(cx - room.cx, cz - room.cz);
    const keep = room.id === closeOn || dist < 18 || cy > 6;
    if (room.interior) room.interior.visible = keep;
    room.far = dist > 20 && room.id !== closeOn && cy < 6;
  }
  updateRoof();
  stepDoors();
}

function stepDoors() {
  if (!camera || !doorList.length) return;
  const p = camera.position;
  for (const d of doorList) {
    const dist = Math.hypot(p.x - d.x, p.z - d.z);
    const want = dist < 2.15 ? d.openAng : d.closedAng;
    d.mesh.rotation.y += (want - d.mesh.rotation.y) * 0.14;
  }
}

function furnishOffice(spec, node, buckets) {
  const { cx, cz, door, w, d } = spec;
  const color = node.color || '#3B82F6';
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const solid = buckets.wall, glass = buckets.glass, floorG = buckets.carpet, trim = buckets.trim;

  wallPieces(floorG, x0 + 0.03, x1 - 0.03, z0 + 0.03, z1 - 0.03, 0.012, 0.03);

  if (door === 's') {
    wallPieces(solid, x0, x1, z0, z0 + WALL_T, 0, CEIL_H); addCollider(x0, x1, z0, z0 + WALL_T);
    wallPieces(solid, x0, x0 + WALL_T, z0, z1, 0, CEIL_H); addCollider(x0, x0 + WALL_T, z0, z1);
    wallPieces(solid, x1 - WALL_T, x1, z0, z1, 0, CEIL_H); addCollider(x1 - WALL_T, x1, z0, z1);
    doorCutX(solid, glass, x0, x1, z1, 0, CEIL_H, cx, true);
  } else if (door === 'n') {
    wallPieces(solid, x0, x1, z1 - WALL_T, z1, 0, CEIL_H); addCollider(x0, x1, z1 - WALL_T, z1);
    wallPieces(solid, x0, x0 + WALL_T, z0, z1, 0, CEIL_H); addCollider(x0, x0 + WALL_T, z0, z1);
    wallPieces(solid, x1 - WALL_T, x1, z0, z1, 0, CEIL_H); addCollider(x1 - WALL_T, x1, z0, z1);
    doorCutX(solid, glass, x0, x1, z0, 0, CEIL_H, cx, true);
  } else if (door === 'e') {
    wallPieces(solid, x0, x0 + WALL_T, z0, z1, 0, CEIL_H); addCollider(x0, x0 + WALL_T, z0, z1);
    wallPieces(solid, x0, x1, z0, z0 + WALL_T, 0, CEIL_H); addCollider(x0, x1, z0, z0 + WALL_T);
    wallPieces(solid, x0, x1, z1 - WALL_T, z1, 0, CEIL_H); addCollider(x0, x1, z1 - WALL_T, z1);
    doorCutZ(solid, glass, z0, z1, x1, 0, CEIL_H, cz, true);
  } else {
    wallPieces(solid, x1 - WALL_T, x1, z0, z1, 0, CEIL_H); addCollider(x1 - WALL_T, x1, z0, z1);
    wallPieces(solid, x0, x1, z0, z0 + WALL_T, 0, CEIL_H); addCollider(x0, x1, z0, z0 + WALL_T);
    wallPieces(solid, x0, x1, z1 - WALL_T, z1, 0, CEIL_H); addCollider(x0, x1, z1 - WALL_T, z1);
    doorCutZ(solid, glass, z0, z1, x0, 0, CEIL_H, cz, true);
  }

  // Exterior window on the back wall
  const win = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 1.35),
    new THREE.MeshStandardMaterial({ color: '#9EC9F0', emissive: '#9EC9F0', emissiveIntensity: 0.4, roughness: 0.12, metalness: 0.05, side: THREE.DoubleSide, transparent: true, opacity: 0.92 }),
  );
  if (door === 's') win.position.set(cx, 1.6, z0 + 0.05);
  else if (door === 'n') win.position.set(cx, 1.6, z1 - 0.05);
  else if (door === 'e') { win.position.set(x0 + 0.05, 1.6, cz); win.rotation.y = Math.PI / 2; }
  else { win.position.set(x1 - 0.05, 1.6, cz); win.rotation.y = Math.PI / 2; }
  windowMats.push(win.material);
  hqRoot.add(win);

  // Warm LED trim along the floor
  wallPieces(trim, x0 + 0.05, x1 - 0.05, z0 + 0.02, z0 + 0.045, 0.03, 0.05);
  wallPieces(trim, x0 + 0.05, x1 - 0.05, z1 - 0.045, z1 - 0.02, 0.03, 0.05);

  const interior = new THREE.Group();
  interior.name = 'interior-' + spec.id;

  const dsk = makeDesk(node);
  const side = (hashId(spec.id) % 2) ? 1 : -1;
  if (door === 's') {
    dsk.root.position.set(cx + side * 0.62, 0, cz - 0.2);
    dsk.root.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
  } else if (door === 'n') {
    dsk.root.position.set(cx + side * 0.62, 0, cz + 0.2);
    dsk.root.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
  } else if (door === 'e') {
    dsk.root.position.set(cx - 0.2, 0, cz + side * 0.62);
    dsk.root.rotation.y = side > 0 ? 0 : Math.PI;
  } else {
    dsk.root.position.set(cx + 0.2, 0, cz + side * 0.62);
    dsk.root.rotation.y = side > 0 ? 0 : Math.PI;
  }
  interior.add(dsk.root);

  // Desk collider (desktop only, so you can stand beside the agent)
  const deskBox = { x: 0.7, z: 0.42 };
  // approximate in world after rotation
  const yaw = dsk.root.rotation.y;
  const wx = Math.abs(Math.cos(yaw)) * 0.7 + Math.abs(Math.sin(yaw)) * 0.42;
  const wz = Math.abs(Math.sin(yaw)) * 0.7 + Math.abs(Math.cos(yaw)) * 0.42;
  addCollider(dsk.root.position.x - wx, dsk.root.position.x + wx, dsk.root.position.z - wz, dsk.root.position.z + wz, 0, 0.85, 'desk');

  const plant = makePlant(hashId(spec.id));
  if (door === 's') plant.position.set(cx - side * 1.15, 0, cz - 1.3);
  else if (door === 'n') plant.position.set(cx - side * 1.15, 0, cz + 1.3);
  else if (door === 'e') plant.position.set(cx - 1.3, 0, cz - side * 1.15);
  else plant.position.set(cx + 1.3, 0, cz - side * 1.15);
  interior.add(plant);
  tagPick(plant, 'inspect', 'plant');

  const shelf = new THREE.Group();
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.04, 0.22), mat('#C4A574', { roughness: 0.5 }));
  board.position.y = 1.48;
  const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.16), mat(color, { roughness: 0.7 }));
  b1.position.set(-0.2, 1.61, 0);
  const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.15), mat('#44403C', { roughness: 0.7 }));
  b2.position.set(-0.1, 1.60, 0);
  const b3 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.14), mat('#7F1D1D', { roughness: 0.7 }));
  b3.position.set(0.0, 1.59, 0);
  shelf.add(board, b1, b2, b3);
  if (door === 's') shelf.position.set(cx, 0, z0 + 0.16);
  else if (door === 'n') { shelf.position.set(cx, 0, z1 - 0.16); shelf.rotation.y = Math.PI; }
  else if (door === 'e') { shelf.position.set(x0 + 0.16, 0, cz); shelf.rotation.y = Math.PI / 2; }
  else { shelf.position.set(x1 - 0.16, 0, cz); shelf.rotation.y = -Math.PI / 2; }
  interior.add(shelf);
  tagPick(shelf, 'inspect', 'shelves');

  const plate = makeDoorPlate(node.name || node.id, node.role || node.sub || '', color);
  const off = DOOR_W / 2 + 0.55;
  if (door === 's') plate.position.set(cx + off, 1.55, z1 + 0.03);
  else if (door === 'n') { plate.position.set(cx + off, 1.55, z0 - 0.03); plate.rotation.y = Math.PI; }
  else if (door === 'e') { plate.position.set(x1 + 0.03, 1.55, cz + off); plate.rotation.y = Math.PI / 2; }
  else { plate.position.set(x0 - 0.03, 1.55, cz + off); plate.rotation.y = -Math.PI / 2; }
  plate.userData.agentId = spec.id;
  tagPick(plate, 'inspect', 'nameplate');
  clickables.push(plate);
  hqRoot.add(plate);
  dsk.tag = plate;

  // Auto-opening glass door — doorway itself has no collider
  const doorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, DOOR_H - 0.1, DOOR_W - 0.1),
    new THREE.MeshStandardMaterial({ color: '#DCEAF6', transparent: true, opacity: 0.28, roughness: 0.06, metalness: 0.18 }),
  );
  let dx, dz, baseYaw, closed, hingeX, hingeZ;
  if (door === 's') { hingeX = cx - DOOR_W / 2; hingeZ = z1; baseYaw = 0; closed = 0.18; }
  else if (door === 'n') { hingeX = cx - DOOR_W / 2; hingeZ = z0; baseYaw = Math.PI; closed = Math.PI - 0.18; }
  else if (door === 'e') { hingeX = x1; hingeZ = cz - DOOR_W / 2; baseYaw = Math.PI / 2; closed = Math.PI / 2 + 0.18; }
  else { hingeX = x0; hingeZ = cz - DOOR_W / 2; baseYaw = -Math.PI / 2; closed = -Math.PI / 2 - 0.18; }
  const pivot = new THREE.Group();
  pivot.position.set(hingeX, 0, hingeZ);
  doorMesh.position.set(0, DOOR_H / 2, DOOR_W / 2 - 0.05);
  pivot.add(doorMesh);
  pivot.rotation.y = closed;
  hqRoot.add(pivot);
  const openAng = closed + (door === 'e' || door === 's' ? 1.25 : -1.25);
  doorList.push({ mesh: pivot, x: hingeX, z: hingeZ, closedAng: closed, openAng });

  hqRoot.add(interior);
  rooms.set(spec.id, { ...spec, color, interior, node, far: false });
  desks.set(node.id, dsk);
  return dsk;
}

function mergeBucket(list, material, group) {
  if (!list.length) return null;
  const g = mergeGeometries(list, false);
  if (!g) return null;
  const m = new THREE.Mesh(g, material);
  m.castShadow = false;
  m.receiveShadow = true;
  (group || hqRoot).add(m);
  return m;
}

function makeCar(color, rot) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.42, 0.9), mat(color, { roughness: 0.4, metalness: 0.3 }));
  body.position.y = 0.42;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.38, 0.84), mat('#9CA3AF', { roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.55 }));
  cabin.position.set(-0.1, 0.78, 0);
  const wheelG = new THREE.CylinderGeometry(0.16, 0.16, 0.12, 8);
  const wheelM = mat('#111111', { roughness: 0.8 });
  [[0.52, 0.16, 0.42], [0.52, 0.16, -0.42], [-0.52, 0.16, 0.42], [-0.52, 0.16, -0.42]].forEach(([x, y, z]) => {
    const w = new THREE.Mesh(wheelG, wheelM);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, y, z);
    g.add(w);
  });
  g.add(body, cabin);
  g.rotation.y = rot || 0;
  return g;
}

function makeTree(scale) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.7, 6), mat('#5C4033', { roughness: 0.9 }));
  trunk.position.y = 0.35;
  const leaves = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), mat('#2F7A3E', { roughness: 0.9 }));
  leaves.position.y = 1.05;
  g.add(trunk, leaves);
  g.scale.setScalar(scale || 1);
  return g;
}

function makeLampPost() {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 3.1, 6), mat('#374151', { metalness: 0.4, roughness: 0.4 }));
  pole.position.y = 1.55;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshStandardMaterial({ color: '#FDE68A', emissive: '#FDE68A', emissiveIntensity: 0.15, roughness: 0.3 }));
  head.position.y = 3.15;
  const light = new THREE.PointLight('#FDE68A', 0, 8, 2);
  light.position.y = 3.1;
  g.add(pole, head, light);
  g.userData.head = head;
  g.userData.light = light;
  lampPosts.push(g);
  return g;
}

function paintWallScreen() {
  if (!wallScreenCtx || !wallScreenTex) return;
  const ctx = wallScreenCtx, w = 1024, h = 512;
  const wr = world() || {};
  const st = wr.status || {};
  const stats = wr.stats || {};
  const pnl = wr.pnl || {};
  let ev = 0, pass = 0, rej = 0;
  for (const id of Object.keys(stats)) {
    ev += stats[id].events || 0;
    pass += stats[id].passes || 0;
    rej += stats[id].rejects || 0;
  }
  ctx.fillStyle = '#07140C';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#16A34A';
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, w - 16, h - 16);
  ctx.fillStyle = '#4ADE80';
  ctx.font = '800 42px ui-monospace,Menlo,monospace';
  ctx.textAlign = 'left';
  ctx.fillText('DEVAMEER BOT HQ', 40, 70);
  ctx.font = '700 28px ui-monospace,Menlo,monospace';
  ctx.fillStyle = '#86EFAC';
  const mode = st.mode || (st.paper || st.dryRun ? 'PAPER' : '—');
  const run = st.running ? 'RUNNING' : 'STOPPED';
  ctx.fillText(mode + '  ·  ' + run + (st.dryRun ? '  ·  DRY_RUN' : ''), 40, 120);
  ctx.fillStyle = '#A7F3D0';
  ctx.font = '600 26px ui-monospace,Menlo,monospace';
  const open = (st.open != null) ? String(st.open) : '—';
  ctx.fillText('Open positions   ' + open, 40, 190);
  const last = (typeof pnl.exits === 'number') ? ((pnl.exits >= 0 ? '+' : '') + Math.round(pnl.exits * 100) + '%') : '—';
  ctx.fillText('Last exit PnL    ' + last, 40, 240);
  ctx.fillText('Passes           ' + pass, 40, 310);
  ctx.fillText('Rejects          ' + rej, 40, 360);
  ctx.fillText('Events           ' + ev, 40, 410);
  if (st.dailyLossHit) { ctx.fillStyle = '#FCA5A5'; ctx.fillText('Daily loss cap reached', 40, 465); }
  else if (st.goalHold) { ctx.fillStyle = '#FCD34D'; ctx.fillText('Goal hold — scanning continues', 40, 465); }
  else { ctx.fillStyle = '#6EE7B7'; ctx.fillText('Pipeline live  ·  real SSE data', 40, 465); }
  wallScreenTex.needsUpdate = true;
}

function buildAtrium(buckets) {
  const a = ATRIUM;
  wallPieces(buckets.floor, -a, a, -a, a, 0.012, 0.028);
  // Lounge sofas
  const fabric = mat('#D6CEC0', { roughness: 0.85 });
  const sofa = (x, z, rot) => {
    const g = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.32, 0.7), fabric);
    seat.position.y = 0.32;
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 0.16), fabric);
    back.position.set(0, 0.62, -0.28);
    g.add(seat, back);
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    hqRoot.add(g);
    addCollider(x - 1, x + 1, z - 0.45, z + 0.45, 0, 0.7, 'furniture');
  };
  sofa(-2.4, -1.8, 0.2);
  sofa(-2.4, 0.4, 0.05);
  // Meeting table
  const table = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 1.1), mat('#C4A574', { roughness: 0.5 }));
  table.position.set(2.0, 0.72, -1.3);
  hqRoot.add(table);
  addCollider(1.0, 3.0, -1.9, -0.7, 0, 0.8, 'furniture');
  [[1.15, -1.85], [2.85, -1.85], [1.15, -0.75], [2.85, -0.75]].forEach(([x, z]) => {
    const ch = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.42, 0.38), mat('#1C1917', { roughness: 0.6 }));
    ch.position.set(x, 0.22, z);
    hqRoot.add(ch);
  });
  // Coffee / kitchen bar along west-south of atrium
  const bar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 0.7), mat('#E7E0D4', { roughness: 0.55 }));
  bar.position.set(2.0, 0.45, 2.4);
  const barTop = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.06, 0.78), mat('#C4A574', { roughness: 0.4 }));
  barTop.position.set(2.0, 0.93, 2.4);
  hqRoot.add(bar, barTop);
  addCollider(0.75, 3.25, 2.0, 2.85, 0, 1.0, 'furniture');
  const machine = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.4, 0.28), mat('#44403C', { metalness: 0.4, roughness: 0.3 }));
  machine.position.set(1.3, 1.16, 2.4);
  hqRoot.add(machine);
  const p1 = makePlant(3); p1.position.set(-3.6, 0, 3.4); hqRoot.add(p1);
  const p2 = makePlant(7); p2.position.set(3.6, 0, -3.5); hqRoot.add(p2);

  // Live PnL / pipeline wall screen on the north interior face of the atrium
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  wallScreenCtx = c.getContext('2d');
  wallScreenTex = new THREE.CanvasTexture(c);
  wallScreenTex.colorSpace = THREE.SRGBColorSpace;
  wallScreenTex.minFilter = THREE.LinearFilter;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.15, 0.08), mat('#1C1917', { roughness: 0.4, metalness: 0.2 }));
  frame.position.set(0, 1.7, -a + 0.08);
  wallScreen = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 2.0), new THREE.MeshBasicMaterial({ map: wallScreenTex }));
  wallScreen.position.set(0, 1.7, -a + 0.13);
  hqRoot.add(frame, wallScreen);
  tagPick(wallScreen, 'inspect', 'wall screen');
  tagPick(frame, 'inspect', 'wall screen');
  paintWallScreen();
}

function buildRoof(bx0, bx1, bz0, bz1) {
  if (!roofGroup) roofGroup = new THREE.Group();
  roofGroup.name = 'roof';
  const roofMat = mat('#EFECE6', { roughness: 0.8, metalness: 0.05 });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(bx1 - bx0 + 0.6, 0.14, bz1 - bz0 + 0.6), roofMat);
  roof.position.set((bx0 + bx1) / 2, CEIL_H + 0.18, (bz0 + bz1) / 2);
  roofGroup.add(roof);
  // Parapet / railings
  const rail = mat('#D6D3CD', { metalness: 0.3, roughness: 0.4 });
  const pw = bx1 - bx0 + 0.6, pd = bz1 - bz0 + 0.6, cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
  const parapet = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.42, d), rail);
    m.position.set(x, CEIL_H + 0.42, z);
    roofGroup.add(m);
  };
  parapet(pw, 0.08, cx, cz - pd / 2);
  parapet(pw, 0.08, cx, cz + pd / 2);
  parapet(0.08, pd, cx - pw / 2, cz);
  parapet(0.08, pd, cx + pw / 2, cz);
  // AC units
  const acM = mat('#CBD5E1', { metalness: 0.35, roughness: 0.45 });
  [[-4, -3], [3.5, 2], [-2, 4]].forEach(([x, z]) => {
    const ac = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.55, 0.9), acM);
    ac.position.set(x, CEIL_H + 0.52, z);
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 10), mat('#94A3B8', { metalness: 0.5, roughness: 0.3 }));
    fan.position.set(x, CEIL_H + 0.82, z);
    roofGroup.add(ac, fan);
  });
  // Solar panels
  const sol = mat('#1E3A5F', { metalness: 0.6, roughness: 0.25 });
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 1.2), sol);
    p.position.set(4.2, CEIL_H + 0.4, -5 + i * 2.4);
    p.rotation.x = -0.15;
    roofGroup.add(p);
  }
  if (!roofGroup.parent) hqRoot.add(roofGroup);
}

function updateRoof() {
  if (!roofGroup || !camera) return;
  const p = camera.position;
  const over = p.x > -11 && p.x < 11 && p.z > -11 && p.z < 11.5;
  const aboveRoof = p.y > CEIL_H + 0.5;
  let show;
  if (roofForced === 'off') show = false;
  else if (roofForced === 'on') show = true;
  else show = !(over && aboveRoof);
  roofGroup.visible = show;
  const btn = document.getElementById('roofToggle');
  if (btn) {
    const label = roofForced === 'off' ? 'Roof off' : (roofForced === 'on' ? 'Roof on' : (show ? 'Roof auto' : 'Roof auto'));
    btn.textContent = roofForced === 'off' ? 'Roof off' : (roofForced === 'on' ? 'Roof on' : 'Roof auto');
    btn.setAttribute('aria-label', 'Roof visibility: ' + roofForced);
  }
}

function setRoofMode(mode) {
  roofForced = (mode === 'on' || mode === 'off') ? mode : 'auto';
  try { localStorage.setItem('devameer-flow-roof', roofForced); } catch {}
  updateRoof();
}

function cycleRoof() {
  setRoofMode(roofForced === 'auto' ? 'off' : (roofForced === 'off' ? 'on' : 'auto'));
}

function setSpin(on) {
  spinOn = !!on;
  if (controls) {
    controls.autoRotate = spinOn && !walkOn;
    controls.autoRotateSpeed = 0.55;
  }
  const btn = document.getElementById('spinToggle');
  if (btn) {
    btn.textContent = spinOn ? 'Stop spin' : 'Spin';
    btn.setAttribute('aria-pressed', spinOn ? 'true' : 'false');
  }
}
function toggleSpin() { setSpin(!spinOn); }

function buildParking(bx0, bx1, bz1) {
  const lot = new THREE.Mesh(
    new THREE.BoxGeometry(28, 0.04, 16),
    mat('#3F3F46', { roughness: 0.92, metalness: 0.02 }),
  );
  lot.position.set(0, 0.01, bz1 + 9.2);
  hqRoot.add(lot);
  // Driveway
  const drive = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.045, 4.2), mat('#3F3F46', { roughness: 0.92 }));
  drive.position.set(0, 0.015, bz1 + 1.8);
  hqRoot.add(drive);
  // Bay lines
  const lineM = mat('#E7E5E4', { roughness: 0.6 });
  const bayW = 2.5, bayD = 5.2;
  const startX = -11, zA = bz1 + 4.2, zB = bz1 + 12.2;
  for (let i = 0; i <= 8; i++) {
    const x = startX + i * bayW;
    const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, bayD), lineM);
    l1.position.set(x, 0.035, zA);
    const l2 = l1.clone(); l2.position.set(x, 0.035, zB);
    hqRoot.add(l1, l2);
  }
  // Parked cars
  const colors = ['#1D4ED8', '#B91C1C', '#E7E5E4', '#365314', '#0F172A'];
  const spots = [0, 2, 3, 5, 7];
  spots.forEach((i, n) => {
    const car = makeCar(colors[n % colors.length], n % 2 ? Math.PI : 0);
    const x = startX + (i + 0.5) * bayW;
    const z = (n % 2 ? zB : zA);
    car.position.set(x, 0, z);
    hqRoot.add(car);
    addCollider(x - 1.0, x + 1.0, z - 0.6, z + 0.6, 0, 1.1, 'car');
  });
  // Trees and lamps
  const treePts = [[-14, bz1 + 3], [14, bz1 + 3], [-14, bz1 + 14], [14, bz1 + 14], [-16, 0], [16, 0], [-16, -8], [16, -8], [-8, -13], [8, -13]];
  treePts.forEach(([x, z], i) => { const t = makeTree(0.9 + (i % 3) * 0.15); t.position.set(x, 0, z); hqRoot.add(t); });
  const lampPts = [[-12, bz1 + 8], [12, bz1 + 8], [-6, bz1 + 2.2], [6, bz1 + 2.2], [-12, 0], [12, 0]];
  lampPts.forEach(([x, z]) => { const l = makeLampPost(); l.position.set(x, 0, z); hqRoot.add(l); });
}

function buildHeadquarters(w) {
  rooms.clear();
  colliders.length = 0;
  windowMats.length = 0;
  doorList.length = 0;
  lampPosts.length = 0;
  if (hqRoot && hqRoot.parent) hqRoot.parent.remove(hqRoot);
  hqRoot = new THREE.Group();
  hqRoot.name = 'DevameerBotHQ';
  scene.add(hqRoot);

  const wallMat = mat('#F7F6F2', { roughness: 0.88, metalness: 0.02 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: '#D7E8F6', roughness: 0.05, metalness: 0.12, transparent: true, opacity: 0.22,
    side: THREE.DoubleSide, emissive: '#E8F3FF', emissiveIntensity: 0.06,
  });
  const floorMat = mat('#F3F0EA', { roughness: 0.55, metalness: 0.06 });
  const carpetMat = mat('#EFEBE3', { roughness: 0.8, metalness: 0.02 });
  const ceilMat = mat('#FBFAF7', { roughness: 0.9, metalness: 0.02 });
  const trayMat = mat('#64748B', { metalness: 0.55, roughness: 0.35 });
  const trimMat = new THREE.MeshStandardMaterial({ color: '#F6E7B8', emissive: '#F6E7B8', emissiveIntensity: 0.85, roughness: 0.35, metalness: 0.15 });
  const plazaMat = mat('#E8E4DC', { roughness: 0.85, metalness: 0.02 });
  const grassMat = mat('#7B9A5C', { roughness: 0.95 });
  hqMats = { wall: wallMat, glass: glassMat, floor: floorMat, carpet: carpetMat, ceil: ceilMat, tray: trayMat, trim: trimMat, plaza: plazaMat, grass: grassMat };

  const buckets = { wall: [], glass: [], carpet: [], floor: [], ceil: [], tray: [], trim: [] };
  const mid = officeCenter();
  const BX0 = -mid - ROOM_W / 2 - 0.08, BX1 = mid + ROOM_W / 2 + 0.08;
  const BZ0 = -mid - ROOM_D / 2 - 0.08, BZ1 = mid + ROOM_D / 2 + 0.08;
  const entX0 = -1.45, entX1 = 1.45;

  // Campus ground
  const grass = new THREE.Mesh(new THREE.CircleGeometry(48, 48), grassMat);
  grass.rotation.x = -Math.PI / 2; grass.position.y = -0.04;
  hqRoot.add(grass);
  const plaza = new THREE.Mesh(new THREE.BoxGeometry(BX1 - BX0 + 8, 0.03, BZ1 - BZ0 + 6), plazaMat);
  plaza.position.set(0, -0.005, 1.5);
  hqRoot.add(plaza);

  // Building slab
  wallPieces(buckets.floor, BX0, BX1, BZ0, BZ1, -0.05, 0.012);

  // Outer walls with south entrance
  wallPieces(buckets.wall, BX0, BX1, BZ0, BZ0 + WALL_T, 0, CEIL_H);
  addCollider(BX0, BX1, BZ0, BZ0 + WALL_T);
  wallPieces(buckets.wall, BX0, entX0, BZ1 - WALL_T, BZ1, 0, CEIL_H);
  wallPieces(buckets.wall, entX1, BX1, BZ1 - WALL_T, BZ1, 0, CEIL_H);
  wallPieces(buckets.wall, entX0, entX1, BZ1 - WALL_T, BZ1, DOOR_H + 0.05, CEIL_H);
  addCollider(BX0, entX0, BZ1 - WALL_T, BZ1);
  addCollider(entX1, BX1, BZ1 - WALL_T, BZ1);
  addCollider(entX0, entX1, BZ1 - WALL_T, BZ1, DOOR_H + 0.05, CEIL_H);
  wallPieces(buckets.wall, BX0, BX0 + WALL_T, BZ0, BZ1, 0, CEIL_H);
  addCollider(BX0, BX0 + WALL_T, BZ0, BZ1);
  wallPieces(buckets.wall, BX1 - WALL_T, BX1, BZ0, BZ1, 0, CEIL_H);
  addCollider(BX1 - WALL_T, BX1, BZ0, BZ1);

  // Interior ceiling (goes with the roof group so cutaway reveals offices)
  const ceilMeshGeo = [];
  wallPieces(ceilMeshGeo, BX0, BX1, BZ0, BZ1, CEIL_H, CEIL_H + 0.08);

  // Hall floors + atrium
  const hc = hallCenter();
  wallPieces(buckets.floor, -hc - 0.1, hc + 0.1, -hc - HALL_W / 2, -ATRIUM, 0.012, 0.026);
  wallPieces(buckets.floor, -hc - 0.1, hc + 0.1, ATRIUM, hc + HALL_W / 2, 0.012, 0.026);
  wallPieces(buckets.floor, -hc - HALL_W / 2, -ATRIUM, -hc - 0.1, hc + 0.1, 0.012, 0.026);
  wallPieces(buckets.floor, ATRIUM, hc + HALL_W / 2, -hc - 0.1, hc + 0.1, 0.012, 0.026);
  wallPieces(buckets.floor, entX0, entX1, ATRIUM, BZ1, 0.012, 0.026);

  // Cable trays: atrium ring + outer edge
  const trayW = 0.28;
  wallPieces(buckets.tray, -ATRIUM - 0.05, ATRIUM + 0.05, -ATRIUM - trayW / 2, -ATRIUM + trayW / 2, TRAY_Y - 0.04, TRAY_Y + 0.05);
  wallPieces(buckets.tray, -ATRIUM - 0.05, ATRIUM + 0.05, ATRIUM - trayW / 2, ATRIUM + trayW / 2, TRAY_Y - 0.04, TRAY_Y + 0.05);
  wallPieces(buckets.tray, -ATRIUM - trayW / 2, -ATRIUM + trayW / 2, -ATRIUM, ATRIUM, TRAY_Y - 0.04, TRAY_Y + 0.05);
  wallPieces(buckets.tray, ATRIUM - trayW / 2, ATRIUM + trayW / 2, -ATRIUM, ATRIUM, TRAY_Y - 0.04, TRAY_Y + 0.05);
  wallPieces(buckets.tray, BX0 + 0.4, BX1 - 0.4, BZ0 + 0.35, BZ0 + 0.35 + trayW, TRAY_Y - 0.04, TRAY_Y + 0.05);
  wallPieces(buckets.tray, BX0 + 0.4, BX1 - 0.4, BZ1 - 0.35 - trayW, BZ1 - 0.35, TRAY_Y - 0.04, TRAY_Y + 0.05);
  wallPieces(buckets.tray, BX0 + 0.35, BX0 + 0.35 + trayW, BZ0 + 0.4, BZ1 - 0.4, TRAY_Y - 0.04, TRAY_Y + 0.05);
  wallPieces(buckets.tray, BX1 - 0.35 - trayW, BX1 - 0.35, BZ0 + 0.4, BZ1 - 0.4, TRAY_Y - 0.04, TRAY_Y + 0.05);

  const nodeById = {};
  for (const n of (w.nodes || [])) nodeById[n.id] = n;
  for (const spec of hqLayout()) {
    const node = nodeById[spec.id];
    if (node) furnishOffice(spec, node, buckets);
  }

  buildAtrium(buckets);

  // Department signs over halls
  const signs = [
    { text: 'Intake', color: '#60A5FA', x: 0, z: -hc, rot: 0 },
    { text: 'Trading', color: '#F59E0B', x: -hc, z: 1.5, rot: Math.PI / 2 },
    { text: 'Hunters', color: '#22C55E', x: hc, z: 1.5, rot: -Math.PI / 2 },
    { text: 'Back office', color: '#A78BFA', x: 0, z: hc, rot: Math.PI },
    { text: 'Security', color: '#F43F5E', x: -hc, z: -6.7, rot: Math.PI / 2 },
    { text: 'Risk', color: '#38BDF8', x: hc, z: -6.7, rot: -Math.PI / 2 },
  ];
  for (const s of signs) {
    const mesh = makeDeptSign(s.text, s.color);
    mesh.position.set(s.x, 2.55, s.z);
    mesh.rotation.y = s.rot;
    hqRoot.add(mesh);
  }

  // Entrance arch
  const colM = mat('#F4F1EA', { roughness: 0.55 });
  const trimE = new THREE.MeshStandardMaterial({ color: '#F6E7B8', emissive: '#F6E7B8', emissiveIntensity: 1.1, roughness: 0.35 });
  const makeCol = (x) => {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.36, 3.15, 0.36), colM);
    c.position.set(x, 1.58, BZ1 + 0.2);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.15, 0.04), trimE);
    t.position.set(x, 1.58, BZ1 + 0.4);
    hqRoot.add(c, t);
  };
  makeCol(entX0 - 0.15); makeCol(entX1 + 0.15);
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(entX1 - entX0 + 1.2, 0.35, 0.4), colM);
  lintel.position.set(0, 3.05, BZ1 + 0.2);
  const lintelTrim = new THREE.Mesh(new THREE.BoxGeometry(entX1 - entX0 + 1.25, 0.06, 0.42), trimE);
  lintelTrim.position.set(0, 2.86, BZ1 + 0.2);
  hqRoot.add(lintel, lintelTrim);
  hqSign = makeArchSign();
  hqSign.position.set(0, 3.25, BZ1 + 0.22);
  hqRoot.add(hqSign);

  // Big facade windows either side of the arch
  [[-5.5, BZ1 - 0.04], [5.5, BZ1 - 0.04]].forEach(([x, z]) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 2.1),
      new THREE.MeshStandardMaterial({ color: '#9EC9F0', emissive: '#9EC9F0', emissiveIntensity: 0.4, roughness: 0.12, metalness: 0.05, side: THREE.DoubleSide, transparent: true, opacity: 0.92 }),
    );
    m.position.set(x, 1.65, z);
    windowMats.push(m.material);
    hqRoot.add(m);
  });

  mergeBucket(buckets.wall, wallMat);
  mergeBucket(buckets.glass, glassMat);
  mergeBucket(buckets.carpet, carpetMat);
  mergeBucket(buckets.floor, floorMat);
  mergeBucket(buckets.tray, trayMat);
  mergeBucket(buckets.trim, trimMat);

  // Ceiling lives on the roof group so cutaway hides it too
  roofGroup = new THREE.Group();
  roofGroup.name = 'roof';
  mergeBucket(ceilMeshGeo, ceilMat, roofGroup);
  buildRoof(BX0, BX1, BZ0, BZ1);

  buildParking(BX0, BX1, BZ1);

  try { roofForced = localStorage.getItem('devameer-flow-roof') || 'auto'; } catch { roofForced = 'auto'; }
  updateRoof();
}


function tagPick(obj, kind, label) {
  if (!obj) return;
  obj.userData.pick = kind;
  obj.userData.pickLabel = label;
  obj.traverse((o) => {
    if (o.isMesh) { o.userData.pick = kind; o.userData.pickLabel = label; if (obj.userData.agentId) o.userData.agentId = obj.userData.agentId; }
  });
}

function woodMap() {
  if (woodMap._tex) return woodMap._tex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#C4A574';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 48; i++) {
    ctx.strokeStyle = 'rgba(90,58,28,' + (0.08 + Math.random() * 0.12) + ')';
    ctx.lineWidth = 1 + Math.random();
    const y = i * 5.4 + Math.random() * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(80, y + 5, 170, y - 5, 256, y + 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  tex.anisotropy = 4;
  woodMap._tex = tex;
  return tex;
}

function makeDesk(node) {
  const color = node.color || '#3B82F6';
  const wood = new THREE.MeshStandardMaterial({ color: '#C4A574', map: woodMap(), roughness: 0.55, metalness: 0.04 });
  const wood2 = mat('#B0894F', { roughness: 0.6 });
  const metal = mat('#1C1917', { metalness: 0.45, roughness: 0.35 });
  const black = mat('#1C1917', { roughness: 0.55, metalness: 0.15 });
  const root = new THREE.Group();

  const sh = new THREE.Mesh(geos.shadow, new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.38, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.012; root.add(sh);

  const chair = new THREE.Group();
  chair.position.set(-0.05, 0.04, -0.32);
  const seat = new THREE.Mesh(geos.chairSeat, black); seat.position.y = 0.38;
  const back = new THREE.Mesh(geos.chairBack, black); back.position.set(0, 0.58, -0.18);
  chair.add(seat, back);
  [[-0.16, 0.19, 0.14], [0.16, 0.19, 0.14], [-0.16, 0.19, -0.14], [0.16, 0.19, -0.14]].forEach(([x, y, z]) => {
    const l = new THREE.Mesh(geos.chairLeg, metal); l.position.set(x, y, z); chair.add(l);
  });
  root.add(chair);

  const desk = new THREE.Group();
  desk.position.set(0, 0, 0.18);
  const top = new THREE.Mesh(geos.deskTop, wood); top.position.y = 0.50;
  const lip = new THREE.Mesh(geos.deskLip, wood2); lip.position.set(0, 0.47, 0.37);
  desk.add(top, lip);
  [[-0.6, 0.26, 0.32], [0.6, 0.26, 0.32], [-0.6, 0.26, -0.3], [0.6, 0.26, -0.3]].forEach(([x, y, z]) => {
    const l = new THREE.Mesh(geos.deskLeg, metal); l.position.set(x, y, z); desk.add(l);
  });
  const kb = new THREE.Mesh(geos.keyboard, metal); kb.position.set(0, 0.535, 0.02); desk.add(kb);
  for (let i = 0; i < 3; i++) {
    const row = new THREE.Mesh(geos.keyRow, mat('#2E2E36'));
    row.position.set(0, 0.548, -0.03 + i * 0.04); desk.add(row);
  }
  function makeMonitor(ox, yaw) {
    const mon = new THREE.Group();
    mon.position.set(ox, 0.50, 0.26);
    mon.rotation.y = yaw;
    const bezelM = mat('#151515', { metalness: 0.35, roughness: 0.28 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.12), metal); base.position.y = 0.01;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.14, 10), metal); stem.position.y = 0.09;
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.38, 0.035), bezelM); bezel.position.y = 0.30;
    const scr = makeScreenTex();
    scr.name = node.name || node.id;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.50, 0.34), new THREE.MeshBasicMaterial({ map: scr.tex }));
    screen.position.set(0, 0.30, 0.02);
    mon.add(base, stem, bezel, screen);
    tagPick(bezel, 'inspect', 'monitor');
    tagPick(screen, 'inspect', 'monitor');
    tagPick(base, 'inspect', 'monitor');
    return { mon, scr, screen, bezel };
  }
  const leftMon = makeMonitor(-0.30, 0.16);
  const rightMon = makeMonitor(0.30, -0.16);
  desk.add(leftMon.mon, rightMon.mon);
  const scr = leftMon.scr, screen = leftMon.screen, bezel = leftMon.bezel, mon = leftMon.mon;
  const scr2 = rightMon.scr, screen2 = rightMon.screen;

  const light = new THREE.Mesh(geos.status, mat('#52525B', { emissive: '#52525B', emissiveIntensity: 0.8, roughness: 0.3 }));
  light.position.set(0.58, 0.54, 0.28);
  desk.add(light);

  const mug = new THREE.Group();
  const mugBody = new THREE.Mesh(geos.mug, mat('#F4E1C8', { roughness: 0.6 }));
  const mugH = new THREE.Mesh(geos.mugHandle, mat('#F4E1C8', { roughness: 0.6 }));
  mugH.rotation.y = Math.PI / 2; mugH.position.x = 0.04;
  mug.add(mugBody, mugH);
  mug.position.set(0.48, 0.575, -0.12);
  desk.add(mug);
  const phone = new THREE.Mesh(geos.phone, mat('#18181B', { metalness: 0.5, roughness: 0.3, emissive: '#1E293B', emissiveIntensity: 0.15 }));
  phone.position.set(-0.52, 0.555, -0.12);
  phone.rotation.y = 0.3;
  desk.add(phone);
  const lamp = new THREE.Group();
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 8), metal);
  arm.position.set(0.06, 0.14, 0); arm.rotation.z = -0.5;
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.09, 10, 1, true), mat('#F5E6C8', { emissive: '#F5E6C8', emissiveIntensity: 0.4, roughness: 0.4, side: THREE.DoubleSide }));
  shade.position.set(0.14, 0.24, 0);
  lamp.add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.02, 10), metal), arm, shade);
  lamp.position.set(0.52, 0.535, -0.18);
  desk.add(lamp);
  const lampLight = new THREE.PointLight('#FFE7B0', 0.55, 3.0, 2);
  lampLight.position.set(0.2, 1.0, 0.05);
  root.add(lampLight);
  tagPick(lamp, 'inspect', 'lamp');
  tagPick(phone, 'inspect', 'phone');
  tagPick(mug, 'inspect', 'mug');
  tagPick(kb, 'inspect', 'keyboard');
  tagPick(top, 'inspect', 'desk');
  tagPick(chair, 'inspect', 'chair');
  root.add(desk);

  const title = (node.name || node.id) + ' · ' + (node.role || node.sub || '');
  let tag = null;

  const bot = makeBot(node);
  bot.position.set(-0.05, 0.14, -0.2);
  bot.scale.setScalar(1.16);
  seatedPose(bot);

  const sit = new THREE.Group();
  sit.add(chair, bot);
  root.add(sit);

  root.userData.agentId = node.id;
  screen.userData.agentId = node.id;
  bezel.userData.agentId = node.id;
  bot.userData.agentId = node.id;
  bot.userData.agentId = node.id;
  tagPick(bot, 'inspect', 'agent');
  clickables.push(screen, bezel, screen2, rightMon.bezel, bot, top, mug, phone, lamp, kb, chair);
  [scr, scr2].forEach((s) => {
    s.title = title; s.role = node.role || node.sub || ''; s.name = node.name || node.id; s.agentId = node.id; s.id = node.id;
  });

  return {
    root, bot, sit, chair, parts: bot.userData, screen, scr, screen2, scr2, light, tag, mon, mug, phone, lampLight,
    name: node.name, id: node.id, color, role: node.role || node.sub || '',
    lastScreen: '',
    lastPaint: 0,
    nextIdle: 2500 + (hashId(node.id) % 8000),
    typeAcc: 0,
    glanceUntil: 0,
    glanceId: '',
    anim: { mode: 'idle', until: 0, started: 0, evType: '' },
  };
}

function defaultCamera() {
  camera.position.set(16, 15.5, 22);
  camera.lookAt(0, 0.3, 1);
  controls.target.set(0, 0.3, 1);
  controls.update();
}

function buildScene(w) {
  const wrap = document.getElementById('wrap');
  const canvas = document.getElementById('cv3d');
  if (!wrap || !canvas) throw new Error('3D canvas missing');

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#0B0B0D');
  scene.fog = new THREE.Fog('#0B0B0D', 38, 85);

  camera = new THREE.PerspectiveCamera(50, 1, 0.02, 400);
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: !isMob(), alpha: false, powerPreference: 'high-performance',
  });
  renderer.setClearColor('#0B0B0D', 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  const pr = Math.min(isMob() ? 1.25 : 1.6, window.devicePixelRatio || 1);
  renderer.setPixelRatio(pr);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  controls.minDistance = 0.025;
  controls.maxDistance = 320;
  controls.minPolarAngle = 0.001;
  controls.maxPolarAngle = Math.PI - 0.06;
  controls.minAzimuthAngle = -Infinity;
  controls.maxAzimuthAngle = Infinity;
  controls.target.set(0, 0.55, 0);
  controls.update();
  bindOfficePointer(canvas);

  hemiLight = new THREE.HemisphereLight(0x8a97b5, 0x1a1210, 0.95);
  keyLight = new THREE.DirectionalLight(0xfff2e0, 1.35);
  keyLight.position.set(10, 16, 12);
  keyLight.castShadow = !isMob();
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 90;
  keyLight.shadow.camera.left = -32;
  keyLight.shadow.camera.right = 32;
  keyLight.shadow.camera.top = 32;
  keyLight.shadow.camera.bottom = -32;
  keyLight.shadow.bias = -0.001;
  fillLight = new THREE.DirectionalLight(0x4f6fff, 0.42);
  fillLight.position.set(-8, 4, -4);
  rimLight = new THREE.DirectionalLight(0x66ccff, 0.35);
  rimLight.position.set(0, 6, -10);
  floorGlow = new THREE.PointLight(0x3b82f6, 1.45, 32, 2);
  floorGlow.position.set(0, 2.4, 0);
  scene.add(hemiLight, keyLight, fillLight, rimLight, floorGlow);
  renderer.shadowMap.enabled = !isMob();
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  makeGeos();
  floor = null;
  gridHelper = null;
  vignette = null;
  clickables.length = 0;
  desks.clear();
  buildHeadquarters(w);

  cables.length = 0;
  for (const e of (w.edges || [])) {
    const a = desks.get(e.from), b = desks.get(e.to);
    if (!a || !b) continue;
    const curve = trayCurve(e.from, e.to);
    if (!curve) continue;
    const pts = curve.getPoints(32);
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const col = new THREE.Color(a.color || '#3B82F6');
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.42 }));
    scene.add(line);
    cables.push({ id: e.id || (e.from + '-' + e.to), from: e.from, to: e.to, curve, color: col, line, heat: 0 });
  }

  packetMesh = null;
  defaultCamera();
  overviewShot = { pos: camera.position.clone(), target: controls.target.clone() };
  built = true;
  resize();
  setupImmersion();
  setupSky();
  try { todChoice = localStorage.getItem('devameer-flow-tod') || 'auto'; } catch { todChoice = 'auto'; }
  setTod(todChoice, true);
  fillJumpMenu();
  applyFxLevel(preferredFx());
  resizeFx();
}

function ensureCapRenderer(W, H) {
  if (!capRenderer) {
    capRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    capRenderer.outputColorSpace = THREE.SRGBColorSpace;
    capRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    capRenderer.toneMappingExposure = 1.22;
    capRenderer.setPixelRatio(1);
    capRenderer.setClearColor('#0B0B0D', 1);
  }
  capRenderer.setSize(W, H, false);
  return capRenderer;
}

function setStatusColor(mesh, mode) {
  const map = { working: '#22C55E', waiting: '#F59E0B', blocked: '#EF4444', idle: '#52525B' };
  const c = map[mode] || map.idle;
  mesh.material.color.set(c);
  mesh.material.emissive.set(c);
  mesh.material.emissiveIntensity = mode === 'idle' ? 0.25 : (mode === 'working' ? 1.15 : 0.85);
}

function nearestNeighbor(id) {
  const me = desks.get(id);
  if (!me) return null;
  let best = null, bestD = 1e9;
  for (const [oid, d] of desks) {
    if (oid === id) continue;
    const dist = me.root.position.distanceTo(d.root.position);
    if (dist < bestD) { bestD = dist; best = d; }
  }
  return best;
}

function headToward(d, other) {
  if (!other) return 0;
  const a = d.root.position, b = other.root.position;
  const lx = b.x - a.x, lz = b.z - a.z;
  // bot faces +Z; yaw around Y
  return Math.atan2(lx, lz) * 0.55;
}

function pickIdle(d, now) {
  if (d.anim.mode === 'work' || d.anim.mode === 'celebrate' || d.anim.mode === 'shake') {
    if (now < d.anim.until) return;
  }
  if (now < (d.nextIdle || 0)) return;
  const acts = ['stretch', 'sip', 'scratch', 'lookNeighbor', 'spin', 'yawn', 'phone', 'lean'];
  const hid = hashId(d.id);
  const pick = acts[Math.floor((now / 97 + hid) % acts.length)];
  const dur = pick === 'spin' ? 1600 : (pick === 'sip' || pick === 'phone' ? 1800 : 1400);
  const look = pick === 'lookNeighbor' ? (nearestNeighbor(d.id) || {}).id : '';
  d.anim = { mode: pick, until: now + dur, started: now, evType: '', look };
  d.nextIdle = now + 5000 + (hid % 9000) + Math.random() * 5000;
}

function applyAnim(d, now, dt) {
  const p = d.parts;
  const a = d.anim;
  const t = now / 1000;
  const hid = hashId(d.id);
  const breathe = Math.sin(t * 2.1 + hid) * 0.01;
  const sway = Math.sin(t * 1.15 + hid) * 0.02;
  let bodyY = 0.56 + breathe;
  let bodyX = 0.04;
  let bodyZ = sway;
  let headX = 0.16, headY = 0, headZ = 0;
  let lArm = { x: -0.85, y: 0.15, z: 0.35 }, rArm = { x: -0.85, y: -0.15, z: -0.35 };
  let lLow = -1.05, rLow = -1.05;
  let sitY = 0;

  const glance = d.glanceUntil && now < d.glanceUntil && d.glanceId;
  if (glance) {
    const other = desks.get(d.glanceId);
    headY = headToward(d, other);
    headX = 0.05;
  }

  if (a.mode === 'work' && now < a.until) {
    const typ = Math.sin(t * 22 + hid);
    lArm.x = -0.95 + typ * 0.08;
    rArm.x = -0.95 - typ * 0.08;
    lLow = -1.15 + typ * 0.16;
    rLow = -1.15 - typ * 0.16;
    if (!glance) { headX = 0.28; headY *= 0.3; }
    bodyX = 0.12;
    bodyY += 0.01;
  } else if (a.mode === 'celebrate' && now < a.until) {
    const wave = Math.sin(t * 10) * 0.15;
    lArm = { x: -2.35 + wave, y: 0.1, z: 0.4 };
    rArm = { x: -2.35 - wave, y: -0.1, z: -0.4 };
    lLow = -0.3; rLow = -0.3;
    bodyY += 0.08 + Math.abs(Math.sin(t * 10)) * 0.05;
    headX = -0.1; headY = wave * 0.4;
  } else if (a.mode === 'shake' && now < a.until) {
    headY = Math.sin(t * 18) * 0.45;
    headX = 0.1;
    bodyZ = Math.sin(t * 18) * 0.03;
  } else if (a.mode === 'stretch' && now < a.until) {
    const k = Math.sin(((now - a.started) / (a.until - a.started)) * Math.PI);
    lArm = { x: -2.1 * k - 0.4 * (1 - k), y: 0.1, z: 0.25 };
    rArm = { x: -2.1 * k - 0.4 * (1 - k), y: -0.1, z: -0.25 };
    lLow = -0.4 * k - 1.0 * (1 - k); rLow = lLow;
    headX = -0.15 * k + 0.16 * (1 - k);
    bodyY += 0.04 * k;
  } else if (a.mode === 'lean' && now < a.until) {
    const k = Math.sin(((now - a.started) / (a.until - a.started)) * Math.PI);
    bodyX = 0.04 - 0.38 * k;
    headX = 0.16 - 0.2 * k;
    lArm.x = -0.7; rArm.x = -0.7; lLow = -0.8; rLow = -0.8;
  } else if (a.mode === 'sip' && now < a.until) {
    const u = (now - a.started) / (a.until - a.started);
    const k = u < 0.35 ? u / 0.35 : (u > 0.7 ? (1 - u) / 0.3 : 1);
    rArm = { x: -1.7 * k - 0.85 * (1 - k), y: -0.35, z: -0.7 };
    rLow = -1.4 * k - 1.05 * (1 - k);
    headX = 0.16 - 0.12 * k; headY = 0.2 * k;
  } else if (a.mode === 'scratch' && now < a.until) {
    const k = Math.sin(((now - a.started) / (a.until - a.started)) * Math.PI);
    rArm = { x: -2.2 * k - 0.5 * (1 - k), y: -0.4, z: -0.2 };
    rLow = -0.9;
    headY = 0.25 * k;
  } else if (a.mode === 'lookNeighbor' && now < a.until) {
    const other = desks.get(a.look) || nearestNeighbor(d.id);
    headY = headToward(d, other);
    headX = 0.06;
    bodyZ = headY * 0.15;
  } else if (a.mode === 'spin' && now < a.until) {
    const u = (now - a.started) / (a.until - a.started);
    sitY = Math.sin(u * Math.PI) * 0.55 * (hid % 2 ? 1 : -1);
  } else if (a.mode === 'yawn' && now < a.until) {
    const k = Math.sin(((now - a.started) / (a.until - a.started)) * Math.PI);
    headX = 0.16 - 0.35 * k;
    lArm = { x: -1.8 * k - 0.85 * (1 - k), y: 0.2, z: 0.5 };
    lLow = -0.7;
  } else if (a.mode === 'phone' && now < a.until) {
    const k = Math.sin(((now - a.started) / (a.until - a.started)) * Math.PI);
    lArm = { x: -1.85 * k - 0.7 * (1 - k), y: 0.45, z: 0.15 };
    lLow = -1.35;
    headX = 0.28; headY = 0.2 * k;
  } else {
    if (now >= a.until) a.mode = 'idle';
  }

  p.body.position.y = bodyY;
  p.body.rotation.set(bodyX, 0, bodyZ);
  p.head.rotation.set(headX, headY, headZ);
  p.lArm.rotation.set(lArm.x, lArm.y, lArm.z);
  p.rArm.rotation.set(rArm.x, rArm.y, rArm.z);
  p.lArm.userData.lower.rotation.x = lLow;
  p.rArm.userData.lower.rotation.x = rLow;
  if (d.sit) d.sit.rotation.y = sitY;
  const blink = ((now + hid) % 4200) < 120;
  const es = blink ? 0.12 : 1;
  p.eyeL.scale.y = es; p.eyeR.scale.y = es;
}

function evSymbol(ev) {
  if (!ev) return '';
  const raw = ev.symbol || (ev.data && (ev.data.symbol || ev.data.mint || ev.data.token));
  if (raw) return String(raw).replace(/^\$/, '').slice(0, 10);
  const msg = String(ev.message || '');
  const m = msg.match(/\$([A-Za-z0-9]{2,12})/);
  return m ? m[1] : '';
}

function inferFrom(ev, toId) {
  if (ev && ev.from) return ev.from;
  const sym = evSymbol(ev);
  const w = world();
  const incoming = cables.filter((c) => c.to === toId);
  if (sym && w && w.lastEv) {
    for (const c of incoming) {
      const last = w.lastEv[c.from];
      if (last && evSymbol(last).toUpperCase() === sym.toUpperCase()) return c.from;
    }
  }
  return incoming.length === 1 ? incoming[0].from : (ev && ev.from) || '';
}

function senderName(id) {
  const d = desks.get(id);
  return (d && d.name) || id || 'upstream';
}

function triggerAnim(id, ev) {
  const d = desks.get(id);
  if (!d) return;
  const now = performance.now();
  const type = ev && ev.type;
  const celebrate = type === 'buy' || type === 'sell' || type === 'pass' || (ev && ev.data && ev.data.pnlPct > 0) || (type === 'exit' && ev && ev.ok !== false);
  const shake = ev && (ev.ok === false || type === 'reject' || type === 'error');
  const from = inferFrom(ev, id);
  if (from && from !== id) {
    d.glanceId = from;
    d.glanceUntil = now + 700;
  }
  const cab = from ? cables.find((c) => c.from === from && c.to === id) : null;
  if (cab) {
    d.pendingEv = { celebrate, shake, type };
    spawnPacket(cab, ev, from);
    return;
  }
  if (celebrate) { d.anim = { mode: 'celebrate', until: now + 1400, started: now, evType: type }; playCheer(d); }
  else if (shake) { d.anim = { mode: 'shake', until: now + 800, started: now, evType: type }; playNope(d); }
  else { d.anim = { mode: 'work', until: now + 1800, started: now, evType: type }; }
}

function packetLabelTex(text, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = 'rgba(12,12,16,0.92)';
  ctx.strokeStyle = color || '#60A5FA';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.roundRect(8, 10, 240, 44, 16); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#FAFAFA';
  ctx.font = '800 22px Inter,system-ui,sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(text || '').slice(0, 14), 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

function spawnPacket(cab, ev, fromId) {
  if (packets.length >= PACKET_CAP) {
    const old = packets.shift();
    disposePacket(old);
  }
  const err = ev && (ev.ok === false || ev.type === 'reject' || ev.type === 'error');
  const col = err ? '#F43F5E' : (ev && (ev.type === 'buy' || ev.type === 'pass') ? '#22C55E' : (cab.color.getStyle ? cab.color.getStyle() : '#60A5FA'));
  const sym = evSymbol(ev);
  const label = sym ? ('$' + sym) : (ev && ev.type ? String(ev.type) : 'event');
  const group = new THREE.Group();
  const ball = new THREE.Mesh(geos.packet, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95 }));
  const tex = packetLabelTex(label, col);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(0.7, 0.18, 1);
  sprite.position.y = 0.14;
  group.add(ball, sprite);
  scene.add(group);
  packets.push({
    group, ball, sprite, tex, curve: cab.curve, t: 0,
    speed: 0.48 + Math.random() * 0.28, color: col, from: fromId || cab.from, to: cab.to,
    symbol: sym, ev, label, arrived: false,
  });
  cab.heat = Math.min(1, (cab.heat || 0) + 0.7);
  const dest = desks.get(cab.to);
  if (dest) {
    const line = 'incoming: ' + label + ' from ' + senderName(fromId || cab.from);
    const P = pipe();
    if (P && typeof P.pushScreenLine === 'function') P.pushScreenLine(cab.to, line, '#93C5FD', Date.now());
    dest.lastScreen = '';
  }
}

function disposePacket(p) {
  if (!p) return;
  if (p.group && p.group.parent) p.group.parent.remove(p.group);
  try { if (p.tex) p.tex.dispose(); } catch {}
  try { if (p.sprite && p.sprite.material) p.sprite.material.dispose(); } catch {}
}

function onPacketArrive(p) {
  if (p.arrived) return;
  p.arrived = true;
  const dest = desks.get(p.to);
  if (!dest) return;
  const now = performance.now();
  const fromName = senderName(p.from);
  const token = p.symbol ? ('$' + p.symbol) : (p.label || 'event');
  const line = 'incoming: ' + token + ' from ' + fromName;
  const P = pipe();
  if (P && typeof P.pushScreenLine === 'function') P.pushScreenLine(p.to, line, '#93C5FD', Date.now());
  dest.scr.flashUntil = now + 900;
  dest.lastScreen = '';
  dest.glanceId = p.from;
  dest.glanceUntil = now + 350;
  const pending = dest.pendingEv || {};
  dest.pendingEv = null;
  if (pending.celebrate) { dest.anim = { mode: 'celebrate', until: now + 1400, started: now, evType: pending.type || 'buy' }; playCheer(dest); }
  else if (pending.shake) { dest.anim = { mode: 'shake', until: now + 800, started: now, evType: pending.type || 'reject' }; playNope(dest); }
  else { dest.anim = { mode: 'work', until: now + 1800, started: now, evType: pending.type || 'incoming' }; }
  playChime(dest);
}

function stepPackets(dt) {
  const keep = [];
  for (const p of packets) {
    p.t += p.speed * dt;
    if (p.t < 1) {
      p.curve.getPoint(p.t, _v);
      _v.y += 0.08 + Math.sin(p.t * Math.PI) * 0.06;
      p.group.position.copy(_v);
      keep.push(p);
    } else {
      if (!p.arrived) onPacketArrive(p);
      disposePacket(p);
    }
  }
  packets.length = 0;
  packets.push(...keep);
}

function stepCables(dt) {
  for (const c of cables) {
    c.heat = (c.heat || 0) * Math.exp(-dt * 1.4);
    c.line.material.opacity = 0.22 + c.heat * 0.7;
  }
}

function lastRowsFor(id, w) {
  let rows = (w.screens && w.screens[id]) || [];
  if (rows.length) return rows;
  const ev = w.lastEv && w.lastEv[id];
  const st = w.stats && w.stats[id];
  let text = '';
  if (ev) {
    text = String(ev.message || '').replace(/\s+/g, ' ').trim();
    if (!text && ev.symbol) text = '$' + String(ev.symbol).replace(/^\$/, '') + ' · ' + (ev.type || 'event');
    if (!text && ev.type) text = String(ev.type);
  }
  if (!text && st && st.lastMessage) text = String(st.lastMessage);
  if (!text) return [];
  return [{ text, at: (st && st.lastAt) || (ev && ev.at) || 0, tone: '#A1A1AA' }];
}

function stepScreens(now) {
  const w = world();
  if (!w) return;
  if (wallScreenCtx && Math.floor(now / 500) % 2 === 0) paintWallScreen();
  for (const [id, d] of desks) {
    const room = rooms.get(id);
    if (room && room.far && now - (d.lastPaint || 0) < 800) continue;
    const mode = agentMode(id, now);
    setStatusColor(d.light, mode);
    const rows = lastRowsFor(id, w);
    d.scr.title = (d.name || id) + ' · ' + (d.role || '');
    d.scr.role = d.role || '';
    d.scr.name = d.name;
    d.scr.agentId = id;
    d.scr.id = id;
    const last = rows[rows.length - 1];
    const key = (last ? (last.at + '|' + last.text) : 'empty') + '|' + mode + '|' + (d.scr.flashUntil && now < d.scr.flashUntil ? 'f' : '') + '|' + Math.floor(now / 500);
    if (key !== d.lastScreen || now - d.lastPaint > 500) {
      paintDeskScreens(d, rows, mode, now);
      d.lastScreen = key;
      d.lastPaint = now;
    }
  }
}

function step(now, dt) {
  if (!built) return;
  stepFly(dt);
  if (controls && !fly) controls.update();
  for (const d of desks.values()) {
    pickIdle(d, now);
    applyAnim(d, now, dt);
  }
  stepPackets(dt);
  stepCables(dt);
  stepScreens(now);
  stepAudio(now, dt);
  stepWalk(dt);
  stepTour(dt);
  cullRooms();
  stepTod(dt);
  autoQuality(dt);
}

function stepOnce(now, dt) {
  const key = now | 0;
  if (key === lastStepNow) return;
  lastStepNow = key;
  step(now, dt);
}

function resize() {
  if (!renderer || !camera) return;
  const wrap = document.getElementById('wrap');
  if (!wrap) return;
  const r = wrap.getBoundingClientRect();
  const w = Math.max(1, Math.floor(r.width));
  const h = Math.max(1, Math.floor(r.height));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const pr = Math.min(isMob() ? 1.25 : 1.6, window.devicePixelRatio || 1);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
    resizeFx();
}

function loop(ts) {
  if (!active) { raf = 0; return; }
  if (hidden) { raf = requestAnimationFrame(loop); return; }
  if (!lastT) lastT = ts;
  const dt = Math.min(0.05, (ts - lastT) / 1000);
  lastT = ts;
  fps = fps * 0.9 + (dt > 0 ? (1 / dt) * 0.1 : 0);
  const now = (pipe() && pipe().clock && pipe().clock.now()) || ts;
  stepOnce(now, dt);
  renderFrame();
  raf = requestAnimationFrame(loop);
}

function drawWatermark(ctx, W, H) {
  const scale = Math.max(0.85, Math.min(W, H) / 1080);
  const x = 28 * scale, y = 28 * scale;
  const light = themeName === 'light';
  ctx.save();
  ctx.font = '700 ' + Math.round(22 * scale) + 'px Inter,system-ui,sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.shadowColor = light ? 'rgba(15,23,42,0.25)' : 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 8 * scale;
  ctx.fillStyle = light ? '#0F172A' : '#FAFAFA';
  const title = 'Devameer Bot Pipeline';
  ctx.fillText(title, x, y);
  const tw = ctx.measureText(title).width;
  let px = x + tw + 14 * scale;
  ctx.beginPath();
  ctx.fillStyle = '#22C55E';
  ctx.shadowColor = '#22C55E';
  ctx.arc(px + 5 * scale, y, 5 * scale, 0, 7); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.font = '800 ' + Math.round(11 * scale) + 'px Inter,system-ui,sans-serif';
  ctx.fillStyle = light ? '#15803D' : '#86EFAC';
  ctx.fillText('LIVE', px + 14 * scale, y);
  const liveW = ctx.measureText('LIVE').width;
  px += 14 * scale + liveW + 12 * scale;
  const st = (pipe() && pipe().status) || {};
  const paper = (st.mode || (st.dryRun ? 'PAPER' : 'LIVE')) !== 'LIVE';
  const label = paper ? 'PAPER' : 'LIVE';
  ctx.font = '800 ' + Math.round(10 * scale) + 'px Inter,system-ui,sans-serif';
  const pw = ctx.measureText(label).width + 16 * scale;
  const ph = 18 * scale;
  ctx.fillStyle = paper ? (light ? '#FEF3C7' : '#27272A') : '#14532D';
  ctx.beginPath(); ctx.roundRect(px, y - ph / 2, pw, ph, ph / 2); ctx.fill();
  ctx.fillStyle = paper ? (light ? '#92400E' : '#FCD34D') : '#86EFAC';
  ctx.textAlign = 'center';
  ctx.fillText(label, px + pw / 2, y);
  ctx.restore();
}

function renderCapture(dest, W, H, now, dt) {
  if (!built) return dest;
  const cap = ensureCapRenderer(W, H);
  const prevAspect = camera.aspect;
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  stepOnce(now, dt || 0.033);
  if (fxLevel !== 'off') {
    if (!capComposer) setupComposer(cap, true);
    if (capComposer) {
      const W0 = cap.domElement.width, H0 = cap.domElement.height;
      capComposer.setSize(W0, H0);
      try { capComposer.render(); } catch { cap.render(scene, camera); }
    } else cap.render(scene, camera);
  } else cap.render(scene, camera);
  camera.aspect = prevAspect;
  camera.updateProjectionMatrix();
  const ctx = dest.getContext('2d');
  ctx.fillStyle = themeName === 'light' ? '#E8EEF6' : '#0B0B0D';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(cap.domElement, 0, 0, W, H);
  drawWatermark(ctx, W, H);
  return dest;
}

function endCapture() {
  if (capRenderer) {
    try { capRenderer.dispose(); } catch {}
    capRenderer = null;
  }
}

function onEvent(ev) {
  if (!ev || ev.type === 'hello' || !ev.node) return;
  triggerAnim(ev.node, ev);
}

function attach() {
  if (!hasWebGL()) {
    console.warn('WebGL unavailable, staying on 2D cards');
    return false;
  }
  const w = world();
  if (!w || !w.nodes || !w.nodes.length) return false;
  const canvas = document.getElementById('cv3d');
  if (!canvas) return false;
  if (!built) {
    try { buildScene(w); }
    catch (e) { console.warn('3D office failed, staying on 2D', e); return false; }
  } else if (desks.size !== w.nodes.length) {
    disposeScene();
    try { buildScene(w); } catch (e) { console.warn(e); return false; }
  }
  return true;
}

function disposeScene() {
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  for (const p of packets) disposePacket(p);
  packets.length = 0;
  for (const d of desks.values()) {
    if (d.scr && d.scr.tex) d.scr.tex.dispose();
  }
  desks.clear();
  rooms.clear();
  cables.length = 0;
  clickables.length = 0;
  colliders.length = 0;
  windowMats.length = 0;
  hqRoot = null;
  hqSign = null;
  built = false;
}

function setActive(on) {
  active = !!on;
  const canvas = document.getElementById('cv3d');
  const wrap = document.getElementById('wrap');
  const cv = document.getElementById('cv');
  if (canvas) canvas.classList.toggle('hidden', !active);
  if (wrap) wrap.classList.toggle('is-3d', active);
  if (cv) cv.classList.toggle('hidden', active);
  if (active) {
    if (!attach()) { active = false; if (canvas) canvas.classList.add('hidden'); if (cv) cv.classList.remove('hidden'); if (wrap) wrap.classList.remove('is-3d'); return false; }
    hidden = document.hidden;
    lastT = 0;
    applyTheme(currentTheme());
    fillJumpMenu();
    updateOverviewBtn();
    resize();
    if (!raf) raf = requestAnimationFrame(loop);
  } else if (raf) {
    cancelAnimationFrame(raf); raf = 0;
  }
  return active;
}

function inspect() {
  const modes = {};
  for (const [id, d] of desks) modes[id] = { name: d.name, anim: d.anim.mode, until: d.anim.until };
  return {
    active, built, agents: desks.size, fps: Math.round(fps), modes,
    packets: packets.map((p) => ({ from: p.from, to: p.to, label: p.label, t: +p.t.toFixed(2) })),
    cables: cables.length, rooms: rooms.size, layout: 'hq', theme: themeName, closeOn, audio: !!(audio.ctx && audio.enabled), muted: !!audio.muted, volume: audio.volume,
    walk: walkOn, tour: tourOn, fx: fxLevel, tod: todMode, todChoice, roof: roofForced, inspect: !!(inspectObj), gains: AUDIO_GAINS,
  };
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
const TOD = {
  morning: { ui: 'light', bg: '#D7C3A8', fog: '#D9C4A4', fogN: 38, fogF: 95, hemiS: 0xFFD9B0, hemiG: 0xC9B8A4, hemi: 1.05, sun: 0xFFB36B, sunI: 1.2, sunP: [24, 7, 2], fill: 0.32, rim: 0.18, exp: 1.1, win: '#F0C9A0', winE: 0.55, lamp: 0.12, post: 0, stars: 0, clouds: 0.75, grass: '#7B9A5C', plaza: '#E8E4DC' },
  afternoon: { ui: 'light', bg: '#C5D9EE', fog: '#C5D9EE', fogN: 52, fogF: 125, hemiS: 0xF3F6FF, hemiG: 0xC9B8A4, hemi: 1.2, sun: 0xFFF5E6, sunI: 1.85, sunP: [8, 24, 12], fill: 0.45, rim: 0.22, exp: 1.18, win: '#8EC4F0', winE: 0.45, lamp: 0, post: 0, stars: 0, clouds: 1, grass: '#7B9A5C', plaza: '#E8E4DC' },
  night: { ui: 'dark', bg: '#070A14', fog: '#070A14', fogN: 22, fogF: 70, hemiS: 0x1A2744, hemiG: 0x0A0C12, hemi: 0.28, sun: 0xC9D6FF, sunI: 0.28, sunP: [-12, 16, -8], fill: 0.12, rim: 0.35, exp: 0.95, win: '#3B5A9A', winE: 0.9, lamp: 0.7, post: 0.95, stars: 1, clouds: 0.1, grass: '#1F2A1A', plaza: '#2A2A2E' },
};
function lerpNum(a, b, k) { return a + (b - a) * k; }
function lerpC(a, b, k) { const c = new THREE.Color(a); c.lerp(new THREE.Color(b), k); return c; }
function lerpPreset(A, B, k) {
  if (!A) return B;
  const o = {};
  for (const key of Object.keys(B)) {
    if (key === 'ui') o[key] = k > 0.5 ? B[key] : A[key];
    else if (key === 'sunP') o[key] = [lerpNum(A.sunP[0], B.sunP[0], k), lerpNum(A.sunP[1], B.sunP[1], k), lerpNum(A.sunP[2], B.sunP[2], k)];
    else if (typeof B[key] === 'number') o[key] = lerpNum(A[key], B[key], k);
    else if (key === 'bg' || key === 'fog' || key === 'win' || key === 'grass' || key === 'plaza') o[key] = '#' + lerpC(A[key], B[key], k).getHexString();
    else if (key === 'sun' || key === 'hemiS' || key === 'hemiG') o[key] = lerpC(A[key], B[key], k);
    else o[key] = B[key];
  }
  return o;
}
function setupSky() {
  if (skyGroup && skyGroup.parent) skyGroup.parent.remove(skyGroup);
  skyGroup = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(180, 24, 16), new THREE.MeshBasicMaterial({ color: '#C5D9EE', side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.name = 'skyDome';
  sunMesh = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 12), new THREE.MeshBasicMaterial({ color: '#FFF3C4', fog: false }));
  moonMesh = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 12), new THREE.MeshBasicMaterial({ color: '#E2E8F0', fog: false }));
  const starGeo = new THREE.BufferGeometry();
  const st = new Float32Array(600 * 3);
  for (let i = 0; i < 600; i++) {
    const u = Math.random() * Math.PI * 2, v = Math.acos(2 * Math.random() - 1), r = 160;
    st[i * 3] = r * Math.sin(v) * Math.cos(u);
    st[i * 3 + 1] = Math.abs(r * Math.cos(v));
    st[i * 3 + 2] = r * Math.sin(v) * Math.sin(u);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(st, 3));
  starPoints = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#E0E7FF', size: 0.7, sizeAttenuation: true, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  cloudMeshes = [];
  for (let i = 0; i < 5; i++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(6 + i, 10, 8), new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.45, fog: false, depthWrite: false }));
    c.position.set(-40 + i * 22, 42 + (i % 2) * 6, -30 + (i * 13) % 40);
    c.scale.set(1.8, 0.55, 1.2);
    cloudMeshes.push(c);
    skyGroup.add(c);
  }
  skyGroup.add(dome, sunMesh, moonMesh, starPoints);
  skyGroup.userData.dome = dome;
  scene.add(skyGroup);
}
function applyTodLighting(P) {
  if (!P || !scene) return;
  scene.background = new THREE.Color(P.bg);
  scene.fog = new THREE.Fog(P.fog, P.fogN, P.fogF);
  if (renderer) { renderer.setClearColor(P.bg, 1); renderer.toneMappingExposure = P.exp; }
  if (capRenderer) { capRenderer.setClearColor(P.bg, 1); capRenderer.toneMappingExposure = P.exp; }
  if (hemiLight) { hemiLight.color.set(P.hemiS); hemiLight.groundColor.set(P.hemiG); hemiLight.intensity = P.hemi; }
  if (keyLight) { keyLight.color.set(P.sun); keyLight.intensity = P.sunI; keyLight.position.set(P.sunP[0], P.sunP[1], P.sunP[2]); }
  if (fillLight) fillLight.intensity = P.fill;
  if (rimLight) rimLight.intensity = P.rim;
  if (skyGroup && skyGroup.userData.dome) skyGroup.userData.dome.material.color.set(P.bg);
  if (sunMesh) { sunMesh.visible = P.stars < 0.5; sunMesh.position.set(P.sunP[0] * 4.2, Math.max(8, P.sunP[1] * 3.2), P.sunP[2] * 4.2); sunMesh.material.color.set(P.sun); }
  if (moonMesh) { moonMesh.visible = P.stars > 0.4; moonMesh.position.set(-48, 52, -30); }
  if (starPoints) { starPoints.material.opacity = P.stars; starPoints.visible = P.stars > 0.05; }
  cloudMeshes.forEach((c) => { c.material.opacity = 0.18 * P.clouds; c.visible = P.clouds > 0.15; });
  for (const m of windowMats) { m.color.set(P.win); m.emissive.set(P.win); m.emissiveIntensity = P.winE; }
  if (hqMats.grass) hqMats.grass.color.set(P.grass);
  if (hqMats.plaza) hqMats.plaza.color.set(P.plaza);
  if (hqMats.wall) hqMats.wall.color.set(P.ui === 'dark' ? '#2A2D36' : '#F7F6F2');
  if (hqMats.ceil) hqMats.ceil.color.set(P.ui === 'dark' ? '#1C1F28' : '#FBFAF7');
  if (hqMats.floor) hqMats.floor.color.set(P.ui === 'dark' ? '#3A3F4A' : '#F3F0EA');
  if (hqMats.carpet) hqMats.carpet.color.set(P.ui === 'dark' ? '#2C313C' : '#EFEBE3');
  if (hqMats.trim) hqMats.trim.emissiveIntensity = P.ui === 'dark' ? 1.2 : 0.85;
  for (const d of desks.values()) {
    if (d.lampLight) { d.lampLight.visible = P.lamp > 0.02; d.lampLight.intensity = 0.15 + P.lamp * 0.7; }
  }
  lampPosts.forEach((g) => {
    if (g.userData.light) g.userData.light.intensity = P.post * 1.3;
    if (g.userData.head) g.userData.head.material.emissiveIntensity = 0.15 + P.post * 1.4;
  });
}
function updateTodUi() {
  document.querySelectorAll('#todDock [data-tod]').forEach((btn) => {
    const on = btn.getAttribute('data-tod') === todChoice;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('on', on);
  });
}
function setTod(choice, instant) {
  todChoice = choice || 'auto';
  try { localStorage.setItem('devameer-flow-tod', todChoice); } catch {}
  const mode = resolveTod(todChoice);
  const preset = TOD[mode];
  const prev = TOD[todMode] || preset;
  todMode = mode;
  if (instant) { todFrom = preset; todTo = preset; todT = 1; }
  else { todFrom = prev; todTo = preset; todT = 0; }
  themeName = preset.ui;
  document.documentElement.setAttribute('data-theme', preset.ui);
  applyTheme(preset.ui);
  if (instant) applyTodLighting(preset);
  updateTodUi();
}
function stepTod(dt) {
  if (todChoice === 'auto') {
    const m = resolveTod('auto');
    if (m !== todMode) setTod('auto', false);
  }
  if (todTo && todT < 1) {
    todT = Math.min(1, todT + dt / 1.15);
    const k = todT * todT * (3 - 2 * todT);
    applyTodLighting(lerpPreset(todFrom, todTo, k));
  }
  cloudMeshes.forEach((c, i) => { c.position.x += dt * (0.4 + i * 0.08); if (c.position.x > 70) c.position.x = -70; });
}

function currentTheme() {
  return (TOD[resolveTod(todChoice)] || TOD.afternoon).ui;
}

function applyTheme(name) {
  themeName = name === 'light' ? 'light' : 'dark';
  if (!scene || !renderer) return;
  const light = themeName === 'light';
  const bg = light ? '#C9D7E8' : '#07080C';
  scene.background = new THREE.Color(bg);
  scene.fog = new THREE.Fog(bg, light ? 42 : 28, light ? 70 : 55);
  renderer.setClearColor(bg, 1);
  renderer.toneMappingExposure = light ? 1.08 : 1.22;
  if (hemiLight) {
    hemiLight.color.set(light ? 0xf3f6ff : 0x6d7a96);
    hemiLight.groundColor.set(light ? 0xc9b8a4 : 0x1a1210);
    hemiLight.intensity = light ? 1.15 : 0.55;
  }
  if (keyLight) {
    keyLight.color.set(light ? 0xfff6e8 : 0xb8c4e0);
    keyLight.intensity = light ? 1.7 : 0.35;
  }
  if (fillLight) fillLight.intensity = light ? 0.5 : 0.28;
  if (rimLight) rimLight.intensity = light ? 0.22 : 0.4;
  if (floorGlow) {
    floorGlow.color.set(light ? 0x93c5fd : 0x1d4ed8);
    floorGlow.intensity = light ? 0.35 : 0.7;
    floorGlow.position.set(0, 2.2, 9);
  }
  if (hqMats.wall) hqMats.wall.color.set(light ? '#D7D3CB' : '#2A2D36');
  if (hqMats.ceil) hqMats.ceil.color.set(light ? '#E7E2DA' : '#1C1F28');
  if (hqMats.floor) hqMats.floor.color.set(light ? '#B7BDC8' : '#3A3F4A');
  if (hqMats.carpet) hqMats.carpet.color.set(light ? '#CBD2DC' : '#2C313C');
  if (hqMats.glass) {
    hqMats.glass.color.set(light ? '#9EC9F0' : '#1E3A5F');
    hqMats.glass.opacity = light ? 0.2 : 0.28;
  }
  for (const m of windowMats) {
    m.color.set(light ? '#8EC4F0' : '#1A2A4A');
    m.emissive.set(light ? '#8EC4F0' : '#3B5A9A');
    m.emissiveIntensity = light ? 0.45 : 0.85;
  }
  const useShadow = fxLevel !== 'off' && !isMob();
  renderer.shadowMap.enabled = useShadow;
  if (keyLight) keyLight.castShadow = useShadow;
  if (hqRoot) {
    hqRoot.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = useShadow && !o.material.transparent;
      o.receiveShadow = useShadow;
    });
  }
  for (const d of desks.values()) {
    d.root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = useShadow && o !== d.tag && o !== d.screen;
      o.receiveShadow = useShadow;
    });
  }
  if (capRenderer) {
    capRenderer.setClearColor(bg, 1);
    capRenderer.toneMappingExposure = light ? 1.08 : 1.22;
    capRenderer.shadowMap.enabled = useShadow;
  }
}

function monitorFocus(d, tight) {
  const target = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  if (d.screen) {
    d.screen.getWorldPosition(target);
    d.screen.getWorldQuaternion(quat);
  } else {
    d.root.getWorldPosition(target).add(new THREE.Vector3(0, 0.95, 0.4));
  }
  const nrm = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
  const pos = target.clone().addScaledVector(nrm, tight ? 1.2 : 1.85).add(new THREE.Vector3(0, tight ? 0.06 : 0.22, 0));
  return { pos, target };
}

function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

function startFly(toPos, toTarget, dur) {
  if (!camera || !controls) return;
  fly = {
    fromPos: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPos: toPos.clone(),
    toTarget: toTarget.clone(),
    t: 0,
    dur: dur == null ? 0.85 : dur,
  };
}

function stepFly(dt) {
  if (!fly) return;
  fly.t += dt / fly.dur;
  const k = easeInOut(Math.min(1, fly.t));
  camera.position.lerpVectors(fly.fromPos, fly.toPos, k);
  controls.target.lerpVectors(fly.fromTarget, fly.toTarget, k);
  controls.update();
  if (fly.t >= 1) fly = null;
}

function flyToAgent(id, opts) {
  const d = desks.get(id);
  if (!d || !camera) return false;
  if (!closeOn && camera && controls) {
    overviewShot = { pos: camera.position.clone(), target: controls.target.clone() };
  }
  const tight = !opts || opts.readable !== false;
  const { pos, target } = monitorFocus(d, tight);
  closeOn = id;
  if (opts && opts.instant) {
    camera.position.copy(pos);
    controls.target.copy(target);
    controls.update();
    fly = null;
  } else {
    startFly(pos, target, (opts && opts.dur) || 0.85);
  }
  updateOverviewBtn();
  return true;
}

function flyOverview(opts) {
  const shot = overviewShot || { pos: new THREE.Vector3(16, 15.5, 22), target: new THREE.Vector3(0, 0.3, 1) };
  inspectObj = null; inspectPrev = null;
  closeOn = null;
  if (typeof updateInspectBtn === 'function') updateInspectBtn();
  if (opts && opts.instant) {
    camera.position.copy(shot.pos);
    controls.target.copy(shot.target);
    controls.update();
    fly = null;
  } else startFly(shot.pos, shot.target, 0.9);
  updateOverviewBtn();
}

function lookAtAgent(id, dist) {
  return flyToAgent(id, { instant: true, readable: dist == null || dist < 3.5 });
}

function updateOverviewBtn() {
  const btn = document.getElementById('camOverview');
  if (btn) btn.classList.toggle('hidden', !closeOn && !fly && !inspectObj);
  if (typeof updateInspectBtn === 'function') updateInspectBtn();
}

function fillJumpMenu() {
  const sel = document.getElementById('agentJump');
  const w = world();
  if (!sel || !w || !w.nodes) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">Office…</option>';
  const byId = {};
  for (const n of w.nodes) byId[n.id] = n;
  for (const dept of DEPTS) {
    const grp = document.createElement('optgroup');
    grp.label = dept.name;
    for (const id of dept.ids) {
      const n = byId[id];
      if (!n) continue;
      const o = document.createElement('option');
      o.value = n.id;
      o.textContent = (n.name || n.id) + ' · ' + (n.role || '');
      grp.appendChild(o);
    }
    if (grp.childNodes.length) sel.appendChild(grp);
  }
  sel.value = prev || '';
}


function ensureWalkMarker() {
  if (walkMarker) return walkMarker;
  const g = new THREE.RingGeometry(0.12, 0.22, 24);
  walkMarker = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#4ADE80', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  walkMarker.rotation.x = -Math.PI / 2;
  walkMarker.position.y = 0.04;
  walkMarker.visible = false;
  scene.add(walkMarker);
  return walkMarker;
}

function setWalkDest(x, z, lookAt) {
  const dest = new THREE.Vector3(x, 1.15, z);
  unstuck(dest, 0.22);
  dest.y = 1.15;
  walkDest = dest;
  walkLookAt = lookAt || null;
  const m = ensureWalkMarker();
  m.position.set(dest.x, 0.04, dest.z);
  m.visible = true;
  m.material.opacity = 0.9;
}

function walkToAgent(id) {
  const d = desks.get(id);
  if (!d) return false;
  const { pos, target } = monitorFocus(d, true);
  setWalkDest(pos.x, pos.z, target);
  return true;
}

function updateInspectBtn() {
  const btn = document.getElementById('inspectBack');
  if (btn) btn.classList.toggle('hidden', !inspectObj && !closeOn);
}

function exitInspect() {
  const prev = inspectPrev;
  inspectObj = null;
  inspectPrev = null;
  closeOn = null;
  updateInspectBtn();
  updateOverviewBtn();
  if (prev && camera && controls) startFly(prev.pos, prev.target, 0.7);
  else flyOverview();
}

function flyToObject(obj) {
  if (!obj || !camera || !controls) return false;
  if (walkOn) setWalk(false);
  if (!inspectObj && !inspectPrev) {
    inspectPrev = { pos: camera.position.clone(), target: controls.target.clone() };
  }
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  if (!isFinite(center.x) || size.length() < 0.001) {
    obj.getWorldPosition(center);
    size.set(0.2, 0.2, 0.2);
  }
  const maxDim = Math.max(size.x, size.y, size.z, 0.06);
  const fov = (camera.fov * Math.PI) / 180;
  const dist = Math.max(0.12, (maxDim * 0.7) / Math.tan(fov / 2) * 1.4);
  let dir = camera.position.clone().sub(controls.target);
  if (dir.length() < 0.05) dir.set(0.55, 0.4, 0.85);
  dir.normalize();
  const pos = center.clone().addScaledVector(dir, dist);
  inspectObj = obj;
  closeOn = null;
  startFly(pos, center, 0.7);
  updateInspectBtn();
  updateOverviewBtn();
  return true;
}

function pickFromEvent(e) {
  const canvas = document.getElementById('cv3d');
  if (!canvas || !camera || !raycaster) return null;
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera({ x, y }, camera);
  const roots = [];
  if (hqRoot) roots.push(hqRoot);
  for (const d of desks.values()) if (d.root) roots.push(d.root);
  if (floor) roots.push(floor);
  const hits = raycaster.intersectObjects(roots, true);
  if (!hits.length) return null;
  const hit = hits[0];
  let o = hit.object, pick = o.userData && o.userData.pick, agentId = o.userData && o.userData.agentId, label = o.userData && o.userData.pickLabel;
  let walk = o;
  while (walk) {
    if (!agentId && walk.userData && walk.userData.agentId) agentId = walk.userData.agentId;
    if (!pick && walk.userData && walk.userData.pick) { pick = walk.userData.pick; label = walk.userData.pickLabel; o = walk; }
    walk = walk.parent;
  }
  if (!pick) pick = 'ground';
  return { hit, object: o, pick, agentId, label, point: hit.point };
}

function bindOfficePointer(canvas) {
  if (!canvas || canvas._officeBound) return;
  canvas._officeBound = true;
  raycaster = new THREE.Raycaster();
  const onDown = (e) => {
    pointerDown = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    walkDrag.down = true; walkDrag.dragged = false; walkDrag.x = e.clientX; walkDrag.y = e.clientY; walkDrag.id = e.pointerId;
    if (walkOn && camera) {
      const eul = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      walkLook.yaw = eul.y; walkLook.pitch = eul.x;
    }
  };
  const onMove = (e) => {
    if (!walkOn || !walkDrag.down || e.pointerId !== walkDrag.id) return;
    const dx = e.clientX - walkDrag.x, dy = e.clientY - walkDrag.y;
    if (Math.hypot(dx, dy) > 6) walkDrag.dragged = true;
    if (!walkDrag.dragged || !camera) return;
    walkLook.yaw -= dx * 0.0055;
    walkLook.pitch -= dy * 0.0055;
    const lim = Math.PI / 2 - 0.08;
    if (walkLook.pitch > lim) walkLook.pitch = lim;
    if (walkLook.pitch < -lim) walkLook.pitch = -lim;
    camera.rotation.set(walkLook.pitch, walkLook.yaw, 0, 'YXZ');
    walkDrag.x = e.clientX; walkDrag.y = e.clientY;
  };
  const onUp = (e) => {
    const dragged = walkDrag.dragged;
    walkDrag.down = false;
    if (!pointerDown) return;
    const dx = e.clientX - pointerDown.x, dy = e.clientY - pointerDown.y;
    const dt = performance.now() - pointerDown.t;
    pointerDown = null;
    if (dragged || Math.hypot(dx, dy) > 7 || dt > 900 || fly) return;
    const picked = pickFromEvent(e);
    if (walkOn) {
      if (picked && picked.agentId && (picked.pick === 'inspect' || picked.pick === 'agent' || picked.label === 'agent' || picked.label === 'monitor' || picked.label === 'nameplate')) {
        walkToAgent(picked.agentId); return;
      }
      if (picked && picked.point) { setWalkDest(picked.point.x, picked.point.z, null); return; }
      return;
    }
    if (picked && picked.pick === 'inspect') { flyToObject(picked.object); return; }
    if (picked && picked.agentId && !(inspectObj)) { flyToAgent(picked.agentId); return; }
    if (inspectObj) { exitInspect(); return; }
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', () => { walkDrag.down = false; pointerDown = null; });
  canvas.addEventListener('wheel', (e) => {
    if (!walkOn || !camera) return;
    e.preventDefault();
    camera.fov = Math.max(32, Math.min(80, camera.fov + e.deltaY * 0.03));
    camera.updateProjectionMatrix();
  }, { passive: false });
  // pinch zoom (walk FOV, inspect/orbit uses default controls — disabled in walk)
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY;
      walkDrag.pinch = Math.hypot(dx, dy);
    }
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !walkDrag.pinch) return;
    const dx = e.touches[0].clientX - e.touches[1].clientX, dy = e.touches[0].clientY - e.touches[1].clientY;
    const d = Math.hypot(dx, dy);
    const k = walkDrag.pinch / d;
    walkDrag.pinch = d;
    if (walkOn && camera) {
      camera.fov = Math.max(32, Math.min(80, camera.fov * k));
      camera.updateProjectionMatrix();
      e.preventDefault();
    }
  }, { passive: false });
}

function onKey(e) {
  if (e.key === 'Escape' && active) {
    if (inspectObj) { exitInspect(); return; }
    if (walkOn) { setWalk(false); return; }
    if (tourOn) { setTour(false); return; }
    flyOverview();
  }
}
document.addEventListener('keydown', onKey);

/* ---- Web Audio: all sounds synthesized (see flow-site/AUDIO.md) ---- */
const AUDIO_GAINS = {
  defaultVolume: 0.9,
  preGain: 2.4,
  compressor: { threshold: -18, ratio: 4, knee: 6, attack: 0.003, release: 0.18 },
  limiter: { threshold: -3, ratio: 18, knee: 0, attack: 0.001, release: 0.08 },
  typing: [0.22, 0.32],
  click: 0.12,
  chime: 0.28,
  cheer: 0.30,
  nope: 0.22,
  hum: 0.085,
  ac: 0.02,
  creak: 0.055,
  murmur: 0.045,
};

const audio = {
  ctx: null, master: null, dest: null, bus: null, pre: null, comp: null, limit: null,
  enabled: false, muted: false, volume: AUDIO_GAINS.defaultVolume,
  amb: null, lastCreak: 0, lastMurmur: 0,
};
try {
  const v = localStorage.getItem('devameer-flow-volume-v3');
  if (v != null && isFinite(+v)) audio.volume = Math.max(0, Math.min(1, +v));
  audio.muted = localStorage.getItem('devameer-flow-muted') === '1';
} catch {}

function ensureAudio() {
  if (audio.ctx) return audio.ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  const bus = ctx.createGain();
  bus.gain.value = 1;
  const pre = ctx.createGain();
  pre.gain.value = AUDIO_GAINS.preGain;
  const comp = ctx.createDynamicsCompressor();
  const c = AUDIO_GAINS.compressor;
  comp.threshold.value = c.threshold; comp.ratio.value = c.ratio; comp.knee.value = c.knee;
  comp.attack.value = c.attack; comp.release.value = c.release;
  const limit = ctx.createDynamicsCompressor();
  const l = AUDIO_GAINS.limiter;
  limit.threshold.value = l.threshold; limit.ratio.value = l.ratio; limit.knee.value = l.knee;
  limit.attack.value = l.attack; limit.release.value = l.release;
  const master = ctx.createGain();
  master.gain.value = audio.muted ? 0 : audio.volume;
  bus.connect(pre); pre.connect(comp); comp.connect(limit); limit.connect(master);
  master.connect(ctx.destination);
  const dest = ctx.createMediaStreamDestination();
  master.connect(dest);
  Object.assign(audio, { ctx, master, dest, bus, pre, comp, limit });
  return ctx;
}

function unlockAudio(fromGate) {
  const ctx = ensureAudio();
  if (!ctx) return false;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  if (!audio.enabled) {
    audio.enabled = true;
    startAmbient();
  }
  if (fromGate || audio.enabled) {
    const gate = document.getElementById('soundGate');
    if (gate) gate.classList.add('hidden');
  }
  updateAudioUi();
  return true;
}

function setVolume(v) {
  audio.volume = Math.max(0, Math.min(1, +v || 0));
  if (audio.master && audio.ctx) audio.master.gain.setTargetAtTime(audio.muted ? 0 : audio.volume, audio.ctx.currentTime, 0.03);
  try { localStorage.setItem('devameer-flow-volume-v3', String(audio.volume)); } catch {}
  if (audio.volume > 0 && audio.muted) { audio.muted = false; try { localStorage.setItem('devameer-flow-muted', '0'); } catch {} }
  updateAudioUi();
}

function toggleMute() {
  unlockAudio(true);
  audio.muted = !audio.muted;
  if (audio.master && audio.ctx) audio.master.gain.setTargetAtTime(audio.muted ? 0 : audio.volume, audio.ctx.currentTime, 0.03);
  try { localStorage.setItem('devameer-flow-muted', audio.muted ? '1' : '0'); } catch {}
  updateAudioUi();
}

function updateAudioUi() {
  const btn = document.getElementById('audioMute');
  const vol = document.getElementById('audioVol');
  const pct = document.getElementById('audioPct');
  const gate = document.getElementById('soundGate');
  const label = btn && btn.querySelector('.spk-label');
  if (btn) {
    btn.classList.toggle('is-muted', !!audio.muted);
    btn.setAttribute('aria-label', audio.muted ? 'Unmute office sound' : 'Mute office sound');
    const spk = btn.querySelector('.spk');
    if (spk) spk.textContent = audio.muted ? '🔇' : '🔊';
    if (label) label.textContent = audio.muted ? 'Muted' : 'Sound';
  }
  const shown = Math.round(audio.volume * 100);
  if (vol && document.activeElement !== vol) vol.value = String(shown);
  if (pct) pct.textContent = shown + '%';
  if (gate && audio.enabled) gate.classList.add('hidden');
}

function deskPanner(d) {
  if (!audio.ctx || !audio.bus) return null;
  if (d.panner && d.panner.context === audio.ctx) return d.panner;
  const p = audio.ctx.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'inverse';
  p.refDistance = 6;
  p.maxDistance = 42;
  p.rolloffFactor = 0.7;
  p.connect(audio.bus);
  d.panner = p;
  const pos = d.root.position;
  if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y + 0.8; p.positionZ.value = pos.z; }
  else p.setPosition(pos.x, pos.y + 0.8, pos.z);
  return p;
}

function envNoise(duration, out) {
  const ctx = audio.ctx;
  const n = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * duration)), ctx.sampleRate);
  const data = n.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
  const src = ctx.createBufferSource();
  src.buffer = n;
  src.connect(out);
  src.start();
  return src;
}

function playAt(d, fn) {
  if (!audio.enabled || !ensureAudio() || audio.muted) return;
  const p = deskPanner(d);
  if (p) fn(audio.ctx, p);
}

function typeKey(d) {
  playAt(d, (ctx, p) => {
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800 + Math.random() * 2200;
    f.Q.value = 1.6;
    g.gain.value = AUDIO_GAINS.typing[0] + Math.random() * (AUDIO_GAINS.typing[1] - AUDIO_GAINS.typing[0]);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.03);
    f.connect(g); g.connect(p);
    envNoise(0.03, f);
  });
}

function playClick(d) {
  playAt(d, (ctx, p) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square'; o.frequency.value = 600 + Math.random() * 200;
    g.gain.value = AUDIO_GAINS.click;
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.04);
    o.connect(g); g.connect(p); o.start(); o.stop(ctx.currentTime + 0.05);
  });
}

function playChime(d) {
  playAt(d, (ctx, p) => {
    const now = ctx.currentTime;
    [880, 1180].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      g.gain.value = 0.0001;
      g.gain.setValueAtTime(0.0001, now + i * 0.05);
      g.gain.exponentialRampToValueAtTime(AUDIO_GAINS.chime, now + i * 0.05 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.05 + 0.45);
      o.connect(g); g.connect(p); o.start(now + i * 0.05); o.stop(now + i * 0.05 + 0.5);
    });
  });
}

function playCheer(d) {
  flashScreen(0.22);
  playAt(d, (ctx, p) => {
    const now = ctx.currentTime;
    [523, 659, 784, 1046].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = freq;
      g.gain.value = 0.0001;
      g.gain.setValueAtTime(0.0001, now + i * 0.07);
      g.gain.exponentialRampToValueAtTime(AUDIO_GAINS.cheer, now + i * 0.07 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.07 + 0.35);
      o.connect(g); g.connect(p); o.start(now + i * 0.07); o.stop(now + i * 0.07 + 0.4);
    });
  });
}

function playNope(d) {
  playAt(d, (ctx, p) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = 220;
    o.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + 0.28);
    g.gain.value = AUDIO_GAINS.nope;
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
    o.connect(f); f.connect(g); g.connect(p); o.start(); o.stop(ctx.currentTime + 0.34);
  });
}

function startAmbient() {
  if (!audio.ctx || audio.amb) return;
  const ctx = audio.ctx;
  const dest = audio.bus || audio.master;
  const hum = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = hum.getChannelData(0);
  let b = 0;
  for (let i = 0; i < data.length; i++) { b = b * 0.98 + (Math.random() * 2 - 1) * 0.02; data[i] = b * 4; }
  const src = ctx.createBufferSource();
  src.buffer = hum; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 140;
  const g = ctx.createGain(); g.gain.value = AUDIO_GAINS.hum;
  src.connect(f); f.connect(g); g.connect(dest);
  src.start();
  const ac = ctx.createOscillator();
  ac.type = 'sine'; ac.frequency.value = 58;
  const acg = ctx.createGain(); acg.gain.value = AUDIO_GAINS.ac;
  ac.connect(acg); acg.connect(dest); ac.start();
  audio.amb = { src, ac, lastCreak: ctx.currentTime + 4 + Math.random() * 8 };
}

function maybeAmbience(now) {
  if (!audio.ctx || !audio.enabled || audio.muted) return;
  const ctx = audio.ctx;
  const t = ctx.currentTime;
  if (!audio.amb) return;
  if (t > (audio.amb.lastCreak || 0)) {
    audio.amb.lastCreak = t + 8 + Math.random() * 16;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    o.type = 'triangle';
    o.frequency.value = 140 + Math.random() * 80;
    o.frequency.exponentialRampToValueAtTime(70 + Math.random() * 40, t + 0.35);
    f.type = 'bandpass'; f.frequency.value = 200; f.Q.value = 1.2;
    g.gain.value = AUDIO_GAINS.creak;
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(f); f.connect(g); g.connect(audio.bus || audio.master);
    o.start(); o.stop(t + 0.42);
  }
  if (t > (audio.lastMurmur || 0)) {
    audio.lastMurmur = t + 6 + Math.random() * 10;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 400 + Math.random() * 500; f.Q.value = 2;
    g.gain.value = AUDIO_GAINS.murmur;
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    f.connect(g); g.connect(audio.bus || audio.master);
    envNoise(1.1, f);
  }
}

function stepAudio(now, dt) {
  if (!audio.ctx || !audio.enabled) return;
  maybeAmbience(now);
  const l = audio.ctx.listener;
  if (camera && l) {
    const p = camera.position;
    const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
    const up = camera.up;
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z;
      l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z;
    } else if (l.setPosition) {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }
  for (const d of desks.values()) {
    if (d.panner && d.root) {
      d.root.getWorldPosition(_v);
      if (d.panner.positionX) {
        d.panner.positionX.value = _v.x; d.panner.positionY.value = _v.y + 0.8; d.panner.positionZ.value = _v.z;
      }
    }
    const working = d.anim.mode === 'work' && now < d.anim.until;
    if (working) {
      d.typeAcc = (d.typeAcc || 0) + dt;
      const gap = 0.065 + Math.random() * 0.055;
      if (d.typeAcc >= gap) { d.typeAcc = 0; typeKey(d); }
      d.clickAcc = (d.clickAcc || 0) + dt;
      if (d.clickAcc > 0.9 + Math.random()) { d.clickAcc = 0; playClick(d); }
    }
  }
}

function audioCaptureStream() {
  unlockAudio();
  if (!audio.dest) return null;
  return audio.dest.stream;
}


document.addEventListener('visibilitychange', () => {
  hidden = document.hidden;
  if (!hidden) {
    lastT = 0;
    if (audio.ctx && audio.enabled && audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {});
  }
});
window.addEventListener('resize', () => { if (active) resize(); });


function preferredFx() {
  try { return localStorage.getItem('devameer-flow-fx') || (isMob() ? 'low' : 'high'); }
  catch { return isMob() ? 'low' : 'high'; }
}

function setupImmersion() {
  setupComposer(renderer, false);
  bindWalk();
}

function setupComposer(r, isCap) {
  if (!r || !scene || !camera) return null;
  const w = r.domElement.width || 800, h = r.domElement.height || 450;
  const comp = new EffectComposer(r);
  comp.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.38, 0.5, 0.78);
  comp.addPass(bloom);
  comp.addPass(new OutputPass());
  if (isCap) capComposer = comp;
  else { composer = comp; bloomPass = bloom; }
  return comp;
}

function applyFxLevel(level) {
  const allowed = { high: 1, low: 1, off: 1 };
  fxLevel = allowed[level] ? level : 'high';
  try { localStorage.setItem('devameer-flow-fx', fxLevel); } catch {}
  const high = fxLevel === 'high';
  const low = fxLevel === 'low';
  const on = fxLevel !== 'off';
  if (bloomPass) {
    bloomPass.enabled = on;
    bloomPass.strength = high ? 0.4 : 0.22;
    bloomPass.threshold = high ? 0.76 : 0.82;
  }
  for (const d of desks.values()) {
    if (d.lampLight) {
      d.lampLight.visible = on;
      d.lampLight.intensity = high ? 0.6 : 0.32;
    }
  }
  const useShadow = on && !isMob();
  if (renderer) {
    renderer.shadowMap.enabled = useShadow;
    if (keyLight) keyLight.castShadow = useShadow;
  }
  const btn = document.getElementById('fxToggle');
  if (btn) {
    btn.textContent = 'FX ' + (fxLevel === 'off' ? 'Off' : (fxLevel === 'low' ? 'Low' : 'On'));
    btn.setAttribute('aria-label', 'Effects: ' + fxLevel);
  }
}

function cycleFx() {
  applyFxLevel(fxLevel === 'high' ? 'low' : (fxLevel === 'low' ? 'off' : 'high'));
}

function autoQuality(dt) {
  if (fxLevel === 'off') return;
  if (fps && fps < 28) fpsLowFor += dt;
  else fpsLowFor = Math.max(0, fpsLowFor - dt * 0.5);
  if (fpsLowFor > 2.2) {
    fpsLowFor = 0;
    if (fxLevel === 'high') applyFxLevel('low');
    else if (fxLevel === 'low') applyFxLevel('off');
  }
}

function flashScreen() {}

function renderFrame(which) {
  const useCap = which === 'cap';
  const r = useCap ? capRenderer : renderer;
  if (!r) return;
  const comp = useCap ? capComposer : composer;
  if (fxLevel !== 'off' && comp) {
    try { comp.render(); }
    catch (e) { r.render(scene, camera); }
  } else {
    r.render(scene, camera);
  }
}

function bindWalk() {
  if (bindWalk._done) return;
  bindWalk._done = true;
  const down = (e) => {
    walk.keys[e.code] = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') walk.keys.sprint = true;
  };
  const up = (e) => {
    walk.keys[e.code] = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') walk.keys.sprint = false;
  };
  document.addEventListener('keydown', down);
  document.addEventListener('keyup', up);
}

function setWalk(on) {
  walkOn = !!on;
  if (walkOn && tourOn) setTour(false);
  if (walkOn && inspectObj) { inspectObj = null; inspectPrev = null; }
  if (walkOn) {
    if (controls) { controls.enabled = false; controls.autoRotate = false; }
    if (camera.position.y > 3.2 || hitsWall(camera.position.x, 1.15, camera.position.z, 0.22)) {
      camera.position.set(0, 1.15, 22.5);
      camera.rotation.set(0, 0, 0, 'YXZ');
      camera.lookAt(0, 1.15, 10.5);
    } else if (camera.position.y < 0.85) {
      camera.position.y = 1.15;
    }
    const eul = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    walkLook.yaw = eul.y; walkLook.pitch = eul.x;
    walkDest = null;
    if (walkMarker) walkMarker.visible = false;
  } else {
    if (controls) {
      controls.enabled = true;
      controls.autoRotate = spinOn;
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      controls.target.copy(camera.position).add(fwd.multiplyScalar(3));
      controls.update();
    }
  }
  const btn = document.getElementById('walkToggle');
  if (btn) {
    btn.textContent = walkOn ? 'Exit walk' : 'Walk';
    btn.setAttribute('aria-pressed', walkOn ? 'true' : 'false');
  }
  updateInspectBtn();
}

function toggleWalk() { setWalk(!walkOn); }

function stepWalk(dt) {
  if (!walkOn || !camera) return;
  const k = walk.keys;
  let x = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
  let z = (k.KeyS || k.ArrowDown ? 1 : 0) - (k.KeyW || k.ArrowUp ? 1 : 0);
  let y = (k.KeyQ || k.PageUp ? 1 : 0) - (k.KeyE || k.PageDown ? 1 : 0);
  if (walkDest) {
    const dx = walkDest.x - camera.position.x, dz = walkDest.z - camera.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.12) {
      walkDest = null;
      if (walkMarker) walkMarker.visible = false;
      if (walkLookAt) {
        const eul = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        camera.lookAt(walkLookAt);
        const e2 = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        walkLook.yaw = e2.y; walkLook.pitch = e2.x;
        walkLookAt = null;
      }
    } else {
      x += dx / dist;
      z += -(-dz / dist);
      // move forward in world XZ toward dest regardless of facing
      const speed = 4.6 * dt;
      const prev = camera.position.clone();
      camera.position.x += (dx / dist) * speed;
      camera.position.z += (dz / dist) * speed;
      resolveWalk(prev);
      if (walkMarker) walkMarker.material.opacity = 0.4 + 0.5 * Math.abs(Math.sin(performance.now() / 200));
      // still allow look; skip WASD compose this frame after dest move
      camera.position.y = Math.max(0.85, Math.min(8, camera.position.y + y * speed));
      return;
    }
  }
  const len = Math.hypot(x, z);
  if (len > 1) { x /= len; z /= len; }
  const speed = (k.sprint ? 7.6 : 4.4) * dt;
  const euler = new THREE.Euler(0, camera.rotation.y, 0, 'YXZ');
  const forward = new THREE.Vector3(0, 0, -1).applyEuler(euler);
  const right = new THREE.Vector3(1, 0, 0).applyEuler(euler);
  const prev = camera.position.clone();
  camera.position.addScaledVector(right, x * speed);
  camera.position.addScaledVector(forward, -z * speed);
  camera.position.y += y * speed;
  camera.position.y = Math.max(0.85, Math.min(8, camera.position.y));
  resolveWalk(prev);
}

function setTour(on) {
  tourOn = !!on;
  if (tourOn && walkOn) setWalk(false);
  const btn = document.getElementById('tourToggle');
  if (btn) {
    btn.textContent = tourOn ? 'Stop tour' : 'Tour';
    btn.setAttribute('aria-pressed', tourOn ? 'true' : 'false');
  }
  if (tourOn) tourNext(true);
}

function toggleTour() { setTour(!tourOn); }

function tourNext(immediate) {
  if (!tourOn) return;
  if (packets.length) {
    const p = packets[packets.length - 1];
    const dest = desks.get(p.to);
    if (dest) { flyToAgent(p.to, { readable: true, dur: immediate ? 0.4 : 1.4 }); return; }
  }
  let busy = null;
  for (const d of desks.values()) {
    if (d.anim && (d.anim.mode === 'work' || d.anim.mode === 'celebrate') && performance.now() < d.anim.until) { busy = d; break; }
  }
  if (!busy) {
    const list = [...desks.values()];
    busy = list[Math.floor(Date.now() / 7000) % list.length];
  }
  if (busy) flyToAgent(busy.id, { readable: true, dur: immediate ? 0.5 : 1.6 });
}

let tourWait = 0;
function stepTour(dt) {
  if (!tourOn) return;
  if (fly) { tourWait = 0; return; }
  tourWait += dt;
  if (packets.length && tourWait > 0.4) { tourNext(); tourWait = 0; }
  else if (tourWait > 4.5) { tourNext(); tourWait = 0; }
}

function onDoubleClick(e) {
  if (!camera || !raycaster) { flyOverview(); return; }
  const canvas = document.getElementById('cv3d');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera({ x, y }, camera);
  const objs = [...clickables.filter((o) => o && o.parent)];
  if (floor) objs.push(floor);
  if (floorReflector) objs.push(floorReflector);
  const hits = raycaster.intersectObjects(objs, true);
  if (!hits.length) { flyOverview(); return; }
  const hit = hits[0];
  let o = hit.object, id = null;
  while (o && !id) { id = o.userData && o.userData.agentId; o = o.parent; }
  if (id) { flyToAgent(id); return; }
  const pt = hit.point.clone();
  const pos = pt.clone();
  pos.y = Math.max(1.05, pt.y + 1.05);
  pos.add(new THREE.Vector3(0.8, 0.2, 1.1));
  if (walkOn) {
    camera.position.copy(pos);
    camera.lookAt(pt);
  } else {
    startFly(pos, pt, 0.7);
  }
}

function resizeFx() {
  const wrap = document.getElementById('wrap');
  if (!wrap) return;
  const r = wrap.getBoundingClientRect();
  const w = Math.max(1, Math.floor(r.width));
  const h = Math.max(1, Math.floor(r.height));
  const pr = Math.min(isMob() ? 1.25 : 1.6, window.devicePixelRatio || 1);
  if (composer) composer.setSize(w, h);
  if (bloomPass && bloomPass.setSize) bloomPass.setSize(w * pr, h * pr);
  if (ssaoPass && ssaoPass.setSize) ssaoPass.setSize(w, h);
}

window.DevameerOffice = {
  attach, setActive, isActive: () => active, renderCapture, endCapture,
  onEvent, inspect, resize, defaultCamera, lookAtAgent,
  flyToAgent, flyOverview, flyToObject, exitInspect, supported: hasWebGL,
  setTheme: (n) => setTod(n === 'dark' ? 'night' : 'afternoon', true),
  setTod, tod: () => ({ choice: todChoice, mode: todMode }),
  unlockAudio, setVolume, toggleMute, audioCaptureStream,
  toggleWalk, setWalk, isWalk: () => walkOn,
  toggleTour, setTour, isTour: () => tourOn,
  cycleFx, applyFxLevel, onDoubleClick,
  cycleRoof, setRoofMode, toggleSpin, setSpin,
  audioGains: () => ({ ...AUDIO_GAINS, master: audio.volume, muted: audio.muted, enabled: audio.enabled }),
};

(function boot() {
  const P = pipe();
  if (P && typeof P.onWorldEvent === 'function') P.onWorldEvent(onEvent);
  updateAudioUi();
  let tries = 0;
  const tryApply = () => {
    const P = pipe();
    if (!P || typeof P.applyPreferredView !== 'function') {
      if (tries++ < 40) setTimeout(tryApply, 200);
      return;
    }
    const w = typeof P.world === 'function' ? P.world() : null;
    if (!w || !w.nodes || !w.nodes.length) {
      if (tries++ < 40) setTimeout(tryApply, 200);
      return;
    }
    try { P.applyPreferredView(); } catch (e) { console.warn(e); }
    if (typeof P.applyTheme === 'function') {
      try { P.applyTheme(P.theme || currentTheme()); } catch (e) { console.warn(e); }
    }
  };
  tryApply();
})();
