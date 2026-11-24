/* Devameer Bot Pipeline — 3D virtual office. Cute chibi agents at desks, driven only by real SSE events. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FilmPass } from 'three/addons/postprocessing/FilmPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

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
    head: new THREE.SphereGeometry(0.22, 14, 12),
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
    mug: new THREE.CylinderGeometry(0.035, 0.03, 0.07, 10),
    mugHandle: new THREE.TorusGeometry(0.022, 0.007, 6, 10, Math.PI),
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
  ctx.fillStyle = flash ? mixHex('#0B1A2A', '#07070A', flashK) : '#07070A';
  ctx.fillRect(0, 0, w, h);

  const headerH = 44;
  ctx.fillStyle = '#12141C';
  ctx.fillRect(0, 0, w, headerH);
  const dots = ['#F43F5E', '#F59E0B', '#22C55E'];
  dots.forEach((c, i) => {
    ctx.beginPath(); ctx.fillStyle = c; ctx.globalAlpha = 0.9;
    ctx.arc(18 + i * 16, 22, 5, 0, 7); ctx.fill();
  });
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FAFAFA';
  ctx.font = '800 20px Inter,system-ui,sans-serif';
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
      ctx.fillStyle = '#E4E4E7';
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

function makeDesk(node) {
  const color = node.color || '#3B82F6';
  const wood = mat('#1A1A20', { roughness: 0.7, metalness: 0.08 });
  const wood2 = mat('#141418', { roughness: 0.65 });
  const metal = mat('#2A2A32', { metalness: 0.45, roughness: 0.35 });
  const root = new THREE.Group();
  const pos = toWorld(node);
  root.position.copy(pos);

  const sh = new THREE.Mesh(geos.shadow, new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.38, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.012; root.add(sh);

  const chair = new THREE.Group();
  chair.position.set(-0.05, 0.04, -0.32);
  const seat = new THREE.Mesh(geos.chairSeat, wood2); seat.position.y = 0.38;
  const back = new THREE.Mesh(geos.chairBack, wood2); back.position.set(0, 0.58, -0.18);
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
  const mon = new THREE.Group();
  mon.position.set(0.1, 0.50, 0.28);
  const base = new THREE.Mesh(geos.monitorBase, metal); base.position.y = 0.01;
  const stem = new THREE.Mesh(geos.monitorStem, metal); stem.position.y = 0.1;
  const bezel = new THREE.Mesh(geos.monitor, mat('#101014', { metalness: 0.35, roughness: 0.3 }));
  bezel.position.y = 0.38;
  const scr = makeScreenTex();
  scr.name = node.name || node.id;
  const screen = new THREE.Mesh(geos.screen, new THREE.MeshBasicMaterial({ map: scr.tex }));
  screen.position.set(0, 0.38, 0.022);
  mon.add(base, stem, bezel, screen);
  desk.add(mon);

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
  phone.position.set(-0.48, 0.555, 0.02);
  phone.rotation.y = 0.3;
  desk.add(phone);
  root.add(desk);

  const title = (node.name || node.id) + ' · ' + (node.role || node.sub || '');
  const tag = makeNameTag(title, color);
  root.add(tag);

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
  clickables.push(screen, bezel, bot, tag, top);

  scr.title = title;
  scr.role = node.role || node.sub || '';
  scr.name = node.name || node.id;
  scr.agentId = node.id;
  scr.id = node.id;

  return {
    root, bot, sit, chair, parts: bot.userData, screen, scr, light, tag, mon, mug, phone,
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
  camera.position.set(3.4, 7.6, 16.8);
  camera.lookAt(0, 0.55, 0);
  controls.target.set(0, 0.55, 0);
  controls.update();
}

function buildScene(w) {
  const wrap = document.getElementById('wrap');
  const canvas = document.getElementById('cv3d');
  if (!wrap || !canvas) throw new Error('3D canvas missing');

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#0B0B0D');
  scene.fog = new THREE.Fog('#0B0B0D', 38, 85);

  camera = new THREE.PerspectiveCamera(47, 1, 0.1, 90);
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
  controls.minDistance = 0.12;
  controls.maxDistance = 220;
  controls.minPolarAngle = 0.001;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.target.set(0, 0.55, 0);
  controls.update();
  bindOfficePointer(canvas);

  hemiLight = new THREE.HemisphereLight(0x8a97b5, 0x1a1210, 0.95);
  keyLight = new THREE.DirectionalLight(0xfff2e0, 1.35);
  keyLight.position.set(6, 12, 8);
  keyLight.castShadow = false;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 42;
  keyLight.shadow.camera.left = -20;
  keyLight.shadow.camera.right = 20;
  keyLight.shadow.camera.top = 20;
  keyLight.shadow.camera.bottom = -20;
  keyLight.shadow.bias = -0.001;
  fillLight = new THREE.DirectionalLight(0x4f6fff, 0.42);
  fillLight.position.set(-8, 4, -4);
  rimLight = new THREE.DirectionalLight(0x66ccff, 0.35);
  rimLight.position.set(0, 6, -10);
  floorGlow = new THREE.PointLight(0x3b82f6, 1.45, 32, 2);
  floorGlow.position.set(0, 2.4, 0);
  scene.add(hemiLight, keyLight, fillLight, rimLight, floorGlow);
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  makeGeos();
  const floorMat = mat('#1C1C24', { roughness: 0.9, metalness: 0.05 });
  floor = new THREE.Mesh(new THREE.CircleGeometry(28, 48), floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  gridHelper = new THREE.GridHelper(36, 36, 0x1c1c24, 0x16161c);
  gridHelper.position.y = 0.002;
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = 0.45;
  scene.add(gridHelper);

  vignette = new THREE.Mesh(new THREE.RingGeometry(16, 22, 40), new THREE.MeshBasicMaterial({ color: '#0B0B0D', transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
  vignette.rotation.x = -Math.PI / 2; vignette.position.y = 0.01;
  scene.add(vignette);

  clickables.length = 0;
  desks.clear();
  for (const n of (w.nodes || [])) {
    const d = makeDesk(n);
    scene.add(d.root);
    desks.set(n.id, d);
  }

  cables.length = 0;
  const used = new Set();
  for (const e of (w.edges || [])) {
    const a = desks.get(e.from), b = desks.get(e.to);
    if (!a || !b) continue;
    const start = a.root.position.clone().add(new THREE.Vector3(0.68, 0.52, 0.18));
    const end = b.root.position.clone().add(new THREE.Vector3(-0.68, 0.52, 0.18));
    const mid = start.clone().add(end).multiplyScalar(0.5);
    mid.y -= 0.35 + Math.min(1.2, start.distanceTo(end) * 0.12);
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    const pts = curve.getPoints(24);
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const col = new THREE.Color(a.color || '#3B82F6');
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.35 }));
    scene.add(line);
    cables.push({ id: e.id || (e.from + '-' + e.to), from: e.from, to: e.to, curve, color: col, line, heat: 0 });
    used.add(e.from + '>' + e.to);
  }

  packetMesh = null;
  defaultCamera();
  overviewShot = { pos: camera.position.clone(), target: controls.target.clone() };
  built = true;
  resize();
  setupImmersion();
  applyTheme(currentTheme());
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
  for (const [id, d] of desks) {
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
      paintScreen(d.scr, rows, mode, now);
      d.lastScreen = key;
      d.lastPaint = now;
    }
    if (d.tag && camera) d.tag.lookAt(camera.position);
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
  stepDust(dt);
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
  cables.length = 0;
  clickables.length = 0;
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
    cables: cables.length, theme: themeName, closeOn, audio: !!(audio.ctx && audio.enabled), muted: !!audio.muted, volume: audio.volume,
    walk: walkOn, tour: tourOn, fx: fxLevel, gains: AUDIO_GAINS,
  };
}

function currentTheme() {
  const P = pipe();
  if (P && P.theme) return P.theme;
  try { return localStorage.getItem('devameer-flow-theme') === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}

function applyTheme(name) {
  themeName = name === 'light' ? 'light' : 'dark';
  if (!scene || !renderer) return;
  const light = themeName === 'light';
  const bg = light ? '#E8EEF6' : '#0B0B0D';
  scene.background = new THREE.Color(bg);
  scene.fog = new THREE.Fog(bg, light ? 46 : 38, light ? 95 : 85);
  renderer.setClearColor(bg, 1);
  renderer.toneMappingExposure = light ? 1.08 : 1.22;
  if (floor && floor.material) floor.material.color.set(light ? '#D5DEE8' : '#1C1C24');
  if (gridHelper) {
    gridHelper.material.opacity = light ? 0.35 : 0.45;
    if (gridHelper.material.color) gridHelper.material.color.set(light ? '#94A3B8' : '#16161c');
  }
  if (vignette && vignette.material) {
    vignette.material.color.set(bg);
    vignette.material.opacity = light ? 0.15 : 0.5;
  }
  if (hemiLight) {
    hemiLight.color.set(light ? 0xf3f6ff : 0x8a97b5);
    hemiLight.groundColor.set(light ? 0xc9b8a4 : 0x1a1210);
    hemiLight.intensity = light ? 1.15 : 0.95;
  }
  if (keyLight) {
    keyLight.color.set(light ? 0xfff6e8 : 0xfff2e0);
    keyLight.intensity = light ? 1.7 : 1.35;
  }
  if (fillLight) fillLight.intensity = light ? 0.55 : 0.42;
  if (rimLight) rimLight.intensity = light ? 0.25 : 0.35;
  if (floorGlow) {
    floorGlow.color.set(light ? 0x93c5fd : 0x3b82f6);
    floorGlow.intensity = light ? 0.6 : 1.45;
  }
  const useShadow = light && !isMob();
  renderer.shadowMap.enabled = useShadow;
  if (keyLight) keyLight.castShadow = useShadow;
  if (floor) floor.receiveShadow = useShadow;
  for (const d of desks.values()) {
    d.root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = useShadow && o !== d.tag;
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
  if (d.screen) d.screen.getWorldPosition(target);
  else d.root.getWorldPosition(target).add(new THREE.Vector3(0, 0.95, 0.4));
  const pos = target.clone().add(tight
    ? new THREE.Vector3(0.22, 0.08, 1.05)
    : new THREE.Vector3(1.15, 0.32, 1.25));
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
  const shot = overviewShot || { pos: new THREE.Vector3(3.4, 7.6, 16.8), target: new THREE.Vector3(0, 0.55, 0) };
  closeOn = null;
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
  if (btn) btn.classList.toggle('hidden', !closeOn && !fly);
}

function fillJumpMenu() {
  const sel = document.getElementById('agentJump');
  const w = world();
  if (!sel || !w || !w.nodes) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">Agent…</option>';
  for (const n of w.nodes) {
    const o = document.createElement('option');
    o.value = n.id;
    o.textContent = (n.name || n.id) + ' · ' + (n.role || '');
    sel.appendChild(o);
  }
  sel.value = prev || '';
}

function bindOfficePointer(canvas) {
  if (!canvas || canvas._officeBound) return;
  canvas._officeBound = true;
  raycaster = new THREE.Raycaster();
  const onDown = (e) => { pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() }; };
  const onUp = (e) => {
    if (!pointerDown) return;
    const dx = e.clientX - pointerDown.x, dy = e.clientY - pointerDown.y;
    const dt = performance.now() - pointerDown.t;
    pointerDown = null;
    if (Math.hypot(dx, dy) > 7 || dt > 700 || fly) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera({ x, y }, camera);
    const hits = raycaster.intersectObjects(clickables.filter((o) => o && o.parent), true);
    const hit = hits.find((h) => {
      let o = h.object;
      while (o) { if (o.userData && o.userData.agentId) return true; o = o.parent; }
      return false;
    });
    if (!hit) return;
    let o = hit.object, id = null;
    while (o && !id) { id = o.userData && o.userData.agentId; o = o.parent; }
    if (id) flyToAgent(id);
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
}

function onKey(e) {
  if (e.key === 'Escape' && active) {
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
  shakeAmt = Math.max(shakeAmt, 0.085);
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
      const pos = d.root.position;
      if (d.panner.positionX) {
        d.panner.positionX.value = pos.x; d.panner.positionY.value = pos.y + 0.8; d.panner.positionZ.value = pos.z;
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
  // Desk monitor glow lamps
  for (const d of desks.values()) {
    if (d.lampLight) continue;
    const pl = new THREE.PointLight(d.color || '#ffe7b0', 0.6, 2.0, 2);
    pl.position.set(0.1, 1.02, 0.4);
    d.root.add(pl);
    d.lampLight = pl;
  }
  // Reflective floor
  if (!floorReflector) {
    try {
      floorReflector = new Reflector(new THREE.CircleGeometry(28, 64), {
        clipBias: 0.003,
        textureWidth: 512,
        textureHeight: 512,
        color: 0x7a8796,
      });
      floorReflector.rotation.x = -Math.PI / 2;
      floorReflector.position.y = 0.004;
      scene.add(floorReflector);
    } catch (e) { console.warn('reflector', e); }
  }
  // Dust motes
  if (!dust) {
    const n = 280;
    dustGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 28;
      pos[i * 3 + 1] = 0.2 + Math.random() * 6;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 20;
      vel[i * 3] = (Math.random() - 0.5) * 0.15;
      vel[i * 3 + 1] = 0.02 + Math.random() * 0.08;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.15;
    }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dustGeo.userData.vel = vel;
    dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
      color: '#E2E8F0', size: 0.035, transparent: true, opacity: 0.35, depthWrite: false,
    }));
    scene.add(dust);
  }
  // Soft volumetric window beams
  if (!lightBeams.length) {
    const beamMat = new THREE.MeshBasicMaterial({
      color: '#F8E7C3', transparent: true, opacity: 0.045, depthWrite: false, side: THREE.DoubleSide,
    });
    [[-6, 9, -2], [4, 9, 1], [0, 10, -5]].forEach(([x, y, z], i) => {
      const g = new THREE.ConeGeometry(2.4 + i * 0.3, 10, 16, 1, true);
      const m = new THREE.Mesh(g, beamMat.clone());
      m.position.set(x, y - 5, z);
      m.rotation.z = 0.15 - i * 0.08;
      m.rotation.x = 0.12;
      scene.add(m);
      lightBeams.push(m);
    });
  }
  setupComposer(renderer, false);
  bindWalk();
  ensureFlashEl();
}

function setupComposer(r, isCap) {
  if (!r || !scene || !camera) return null;
  const w = r.domElement.width || 800, h = r.domElement.height || 450;
  const comp = new EffectComposer(r);
  comp.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.55, 0.72);
  comp.addPass(bloom);
  if (!isCap && !isMob()) {
    try {
      const ssao = new SSAOPass(scene, camera, w, h);
      ssao.kernelRadius = 8;
      ssao.minDistance = 0.001;
      ssao.maxDistance = 0.12;
      ssao.output = SSAOPass.OUTPUT ? SSAOPass.OUTPUT.Default : 0;
      comp.addPass(ssao);
      if (!isCap) ssaoPass = ssao;
    } catch (e) { console.warn('ssao', e); }
  }
  if (!isCap) {
    try {
      const bokeh = new BokehPass(scene, camera, { focus: 4.5, aperture: 0.00018, maxblur: 0.008 });
      bokeh.enabled = false;
      comp.addPass(bokeh);
      bokehPass = bokeh;
    } catch (e) { console.warn('bokeh', e); }
  }
  const vig = new ShaderPass(VignetteShader);
  vig.uniforms.offset.value = 0.85;
  vig.uniforms.darkness.value = 0.85;
  comp.addPass(vig);
  const film = new FilmPass(0.12, false);
  comp.addPass(film);
  comp.addPass(new OutputPass());
  if (isCap) {
    capComposer = comp;
  } else {
    composer = comp;
    bloomPass = bloom;
    vignettePass = vig;
    filmPass = film;
  }
  return comp;
}

function applyFxLevel(level) {
  const allowed = { high: 1, low: 1, off: 1 };
  fxLevel = allowed[level] ? level : 'high';
  try { localStorage.setItem('devameer-flow-fx', fxLevel); } catch {}
  const high = fxLevel === 'high';
  const low = fxLevel === 'low';
  const on = fxLevel !== 'off';
  if (bloomPass) bloomPass.strength = high ? 0.55 : (low ? 0.28 : 0);
  if (ssaoPass) ssaoPass.enabled = high && !isMob();
  if (bokehPass) bokehPass.enabled = high && !!closeOn;
  if (filmPass) filmPass.enabled = on;
  if (vignettePass) vignettePass.enabled = on;
  if (floorReflector) floorReflector.visible = high;
  if (dust) dust.visible = on;
  lightBeams.forEach((m) => { m.visible = on; m.material.opacity = high ? 0.05 : 0.028; });
  for (const d of desks.values()) {
    if (d.lampLight) d.lampLight.visible = on;
    if (d.lampLight) d.lampLight.intensity = high ? 0.7 : 0.35;
  }
  const btn = document.getElementById('fxToggle');
  if (btn) {
    btn.textContent = 'FX ' + (fxLevel === 'off' ? 'Off' : (fxLevel === 'low' ? 'Low' : 'High'));
    btn.setAttribute('aria-label', 'Cinematic FX: ' + fxLevel);
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

function stepDust(dt) {
  if (!dust || !dust.visible || !dustGeo) return;
  const pos = dustGeo.attributes.position.array;
  const vel = dustGeo.userData.vel;
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] += vel[i] * dt;
    pos[i + 1] += vel[i + 1] * dt;
    pos[i + 2] += vel[i + 2] * dt;
    if (pos[i + 1] > 7) pos[i + 1] = 0.15;
    if (pos[i] > 14) pos[i] = -14;
    if (pos[i] < -14) pos[i] = 14;
    if (pos[i + 2] > 10) pos[i + 2] = -10;
    if (pos[i + 2] < -10) pos[i + 2] = 10;
  }
  dustGeo.attributes.position.needsUpdate = true;
}

function ensureFlashEl() {
  if (document.getElementById('fxFlash')) return;
  const el = document.createElement('div');
  el.id = 'fxFlash';
  el.style.cssText = 'position:absolute;inset:0;z-index:7;pointer-events:none;background:#fff;opacity:0;transition:opacity .12s linear;';
  const wrap = document.getElementById('wrap');
  if (wrap) wrap.appendChild(el);
}

function flashScreen(amt) {
  const el = document.getElementById('fxFlash');
  if (!el) return;
  el.style.opacity = String(Math.max(0.08, Math.min(0.35, amt || 0.2)));
  setTimeout(() => { el.style.opacity = '0'; }, 90);
}

function renderFrame(which) {
  const useCap = which === 'cap';
  const r = useCap ? capRenderer : renderer;
  if (!r) return;
  // camera shake offset
  if (shakeAmt > 0.001 && camera) {
    camShake.set((Math.random() - 0.5) * shakeAmt, (Math.random() - 0.5) * shakeAmt * 0.6, (Math.random() - 0.5) * shakeAmt);
    camera.position.add(camShake);
    shakeAmt *= 0.84;
  } else {
    camShake.set(0, 0, 0);
  }
  if (bokehPass && !useCap) bokehPass.enabled = fxLevel === 'high' && !!closeOn;
  const comp = useCap ? capComposer : composer;
  if (fxLevel !== 'off' && comp) {
    try { comp.render(); }
    catch (e) { r.render(scene, camera); }
  } else {
    r.render(scene, camera);
  }
  if (camShake.x || camShake.y || camShake.z) camera.position.sub(camShake);
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
  const canvas = document.getElementById('cv3d');
  if (canvas) {
    canvas.addEventListener('click', () => {
      if (walkOn && ptrLock && !ptrLock.isLocked && !isMob()) {
        try { ptrLock.lock(); } catch {}
      }
    });
  }
  const joy = document.getElementById('joy');
  if (joy) {
    const setFrom = (e) => {
      const r = joy.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width * 2 - 1;
      const y = (e.clientY - r.top) / r.height * 2 - 1;
      walk.joy.x = Math.max(-1, Math.min(1, x));
      walk.joy.z = Math.max(-1, Math.min(1, y));
      const knob = document.getElementById('joyKnob');
      if (knob) knob.style.transform = 'translate(' + (walk.joy.x * 28) + 'px,' + (walk.joy.z * 28) + 'px)';
    };
    const clear = () => {
      walk.joy.x = 0; walk.joy.z = 0;
      const knob = document.getElementById('joyKnob');
      if (knob) knob.style.transform = '';
    };
    joy.addEventListener('pointerdown', (e) => { joy.setPointerCapture(e.pointerId); setFrom(e); });
    joy.addEventListener('pointermove', (e) => { if (joy.hasPointerCapture(e.pointerId)) setFrom(e); });
    joy.addEventListener('pointerup', clear);
    joy.addEventListener('pointercancel', clear);
  }
  const upBtn = document.getElementById('walkUp');
  const downBtn = document.getElementById('walkDown');
  const hold = (el, dir) => {
    if (!el) return;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); walk.vert = dir; });
    el.addEventListener('pointerup', () => { if (walk.vert === dir) walk.vert = 0; });
    el.addEventListener('pointerleave', () => { if (walk.vert === dir) walk.vert = 0; });
  };
  hold(upBtn, 1); hold(downBtn, -1);
}

function setWalk(on) {
  walkOn = !!on;
  if (walkOn && tourOn) setTour(false);
  if (walkOn) {
    if (controls) controls.enabled = false;
    if (!ptrLock && camera) {
      const canvas = document.getElementById('cv3d');
      ptrLock = new PointerLockControls(camera, canvas || document.body);
    }
    if (camera.position.y < 0.7) camera.position.y = 1.05;
    if (camera.position.y > 12) camera.position.y = 1.2;
  } else {
    if (ptrLock && ptrLock.isLocked) { try { ptrLock.unlock(); } catch {} }
    if (controls) {
      controls.enabled = true;
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      controls.target.copy(camera.position).add(fwd.multiplyScalar(3));
      controls.update();
    }
  }
  const ui = document.getElementById('walkUi');
  if (ui) ui.classList.toggle('hidden', !walkOn);
  const btn = document.getElementById('walkToggle');
  if (btn) {
    btn.textContent = walkOn ? 'Exit walk' : 'Walk';
    btn.setAttribute('aria-pressed', walkOn ? 'true' : 'false');
  }
}

function toggleWalk() { setWalk(!walkOn); }

function stepWalk(dt) {
  if (!walkOn || !camera) return;
  const k = walk.keys;
  let x = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0) + walk.joy.x;
  let z = (k.KeyS || k.ArrowDown ? 1 : 0) - (k.KeyW || k.ArrowUp ? 1 : 0) + walk.joy.z;
  let y = (k.KeyQ || k.PageUp ? 1 : 0) - (k.KeyE || k.PageDown ? 1 : 0) + walk.vert;
  const len = Math.hypot(x, z);
  if (len > 1) { x /= len; z /= len; }
  const speed = (k.sprint ? 7.6 : 4.4) * dt;
  const euler = new THREE.Euler(0, camera.rotation.y, 0, 'YXZ');
  const forward = new THREE.Vector3(0, 0, -1).applyEuler(euler);
  const right = new THREE.Vector3(1, 0, 0).applyEuler(euler);
  camera.position.addScaledVector(right, x * speed);
  camera.position.addScaledVector(forward, -z * speed);
  camera.position.y += y * speed;
  camera.position.y = Math.max(0.42, Math.min(14, camera.position.y));
  if (ptrLock && ptrLock.isLocked) {
    // PointerLockControls already applied mouse look
  }
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
  flyToAgent, flyOverview, setTheme: applyTheme, supported: hasWebGL,
  unlockAudio, setVolume, toggleMute, audioCaptureStream,
  toggleWalk, setWalk, isWalk: () => walkOn,
  toggleTour, setTour, isTour: () => tourOn,
  cycleFx, applyFxLevel, onDoubleClick,
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
