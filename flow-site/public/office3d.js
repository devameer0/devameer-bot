/* Devameer Bot Pipeline — 3D virtual office. Cute chibi agents at desks, driven only by real SSE events. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const SCALE = 0.012;
const SCREEN_W = 256;
const SCREEN_H = 160;
const PACKET_CAP = 96;
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
let floor, packetMesh, packetCount = 0;
let geos = {};
const desks = new Map(); // id -> { root, bot, parts, screen, tex, ctx, light, tag, lastScreen, anim }
const cables = []; // { from, to, curve, color }
const packets = []; // { curve, t, speed, color, alive }
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
    monitor: new THREE.BoxGeometry(0.74, 0.48, 0.04),
    monitorStem: new THREE.CylinderGeometry(0.025, 0.03, 0.16, 8),
    monitorBase: new THREE.BoxGeometry(0.28, 0.02, 0.14),
    screen: new THREE.PlaneGeometry(0.68, 0.42),
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

function paintScreen(entry, rows, mode, now) {
  const ctx = entry.ctx, w = SCREEN_W, h = SCREEN_H;
  ctx.fillStyle = '#07070A';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#121216';
  ctx.fillRect(0, 0, w, 16);
  const dots = ['#F43F5E', '#F59E0B', '#22C55E'];
  dots.forEach((c, i) => {
    ctx.beginPath(); ctx.fillStyle = c; ctx.globalAlpha = 0.75;
    ctx.arc(10 + i * 10, 8, 2.4, 0, 7); ctx.fill();
  });
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#52525B';
  ctx.font = '600 9px ui-monospace,SFMono-Regular,Menlo,monospace';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  ctx.fillText((entry.name || 'agent').toLowerCase() + '.sh', w - 6, 8);

  ctx.textAlign = 'left';
  ctx.font = '600 11px ui-monospace,SFMono-Regular,Menlo,monospace';
  const lineH = 16;
  const shown = (rows || []).slice(-7);
  if (!shown.length) {
    const blink = (Math.floor(now / 530) % 2) === 0;
    ctx.fillStyle = '#3F3F46';
    ctx.fillText('idle', 8, h - 12);
    if (blink) {
      ctx.fillStyle = '#71717A';
      ctx.fillRect(8 + ctx.measureText('idle ').width, h - 20, 6, 11);
    }
  } else {
    shown.forEach((row, i) => {
      ctx.fillStyle = row.tone || '#D4D4D8';
      const t = String(row.text || '');
      ctx.fillText(t.length > 34 ? t.slice(0, 33) + '…' : t, 8, 28 + i * lineH);
    });
    if (mode === 'working' && (Math.floor(now / 400) % 2) === 0) {
      const last = shown[shown.length - 1];
      const yy = 28 + (shown.length - 1) * lineH;
      ctx.fillStyle = last.tone || '#D4D4D8';
      const tw = ctx.measureText(String(last.text || '').slice(0, 34)).width;
      ctx.fillRect(10 + tw, yy - 8, 6, 11);
    }
  }
  if (mode === 'working') {
    const shimmer = ((now / 700) % 1);
    const gx = shimmer * (w + 40) - 40;
    const g = ctx.createLinearGradient(gx, 0, gx + 50, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 16, w, h - 16);
  }
  entry.tex.needsUpdate = true;
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
  chair.position.set(0, 0, -0.28);
  const seat = new THREE.Mesh(geos.chairSeat, wood2); seat.position.y = 0.38;
  const back = new THREE.Mesh(geos.chairBack, wood2); back.position.set(0, 0.58, -0.18);
  chair.add(seat, back);
  [[-0.16, 0.19, 0.14], [0.16, 0.19, 0.14], [-0.16, 0.19, -0.14], [0.16, 0.19, -0.14]].forEach(([x, y, z]) => {
    const l = new THREE.Mesh(geos.chairLeg, metal); l.position.set(x, y, z); chair.add(l);
  });
  root.add(chair);

  const desk = new THREE.Group();
  desk.position.set(0, 0, 0.18);
  const top = new THREE.Mesh(geos.deskTop, wood); top.position.y = 0.54;
  const lip = new THREE.Mesh(geos.deskLip, wood2); lip.position.set(0, 0.51, 0.37);
  desk.add(top, lip);
  [[-0.6, 0.26, 0.32], [0.6, 0.26, 0.32], [-0.6, 0.26, -0.3], [0.6, 0.26, -0.3]].forEach(([x, y, z]) => {
    const l = new THREE.Mesh(geos.deskLeg, metal); l.position.set(x, y, z); desk.add(l);
  });
  const kb = new THREE.Mesh(geos.keyboard, metal); kb.position.set(0, 0.575, 0.02); desk.add(kb);
  for (let i = 0; i < 3; i++) {
    const row = new THREE.Mesh(geos.keyRow, mat('#2E2E36'));
    row.position.set(0, 0.588, -0.03 + i * 0.04); desk.add(row);
  }
  const mon = new THREE.Group();
  mon.position.set(0, 0.54, 0.28);
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
  light.position.set(0.58, 0.58, 0.28);
  desk.add(light);
  root.add(desk);

  const title = (node.name || node.id) + ' · ' + (node.role || node.sub || '');
  const tag = makeNameTag(title, color);
  root.add(tag);

  const bot = makeBot(node);
  bot.position.set(0, 0, -0.16);
  seatedPose(bot);
  root.add(bot);

  // skip shadows / expensive: no castShadow
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });

  return {
    root, bot, parts: bot.userData, screen, scr, light, tag, mon,
    name: node.name, id: node.id, color,
    lastScreen: '',
    lastPaint: 0,
    anim: { mode: 'idle', until: 0, started: 0, evType: '' },
  };
}

function defaultCamera() {
  camera.position.set(6.2, 11.2, 22.4);
  camera.lookAt(0, 0.5, 0);
  controls.target.set(0, 0.45, 0);
  controls.update();
}

function buildScene(w) {
  const wrap = document.getElementById('wrap');
  const canvas = document.getElementById('cv3d');
  if (!wrap || !canvas) throw new Error('3D canvas missing');

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#0B0B0D');
  scene.fog = new THREE.Fog('#0B0B0D', 32, 72);

  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: !isMob(), alpha: false, powerPreference: 'high-performance',
  });
  renderer.setClearColor('#0B0B0D', 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  const pr = Math.min(isMob() ? 1.25 : 1.6, window.devicePixelRatio || 1);
  renderer.setPixelRatio(pr);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 5;
  controls.maxDistance = 42;
  controls.minPolarAngle = 0.22;
  controls.maxPolarAngle = 1.32;
  controls.target.set(0, 0.45, 0);
  controls.update();

  const hemi = new THREE.HemisphereLight(0x6b7a99, 0x1a1210, 0.7);
  const key = new THREE.DirectionalLight(0xfff2e0, 1.05);
  key.position.set(6, 10, 8);
  const fill = new THREE.DirectionalLight(0x4f6fff, 0.28);
  fill.position.set(-8, 4, -4);
  const rim = new THREE.DirectionalLight(0x66ccff, 0.22);
  rim.position.set(0, 6, -10);
  const floorGlow = new THREE.PointLight(0x3b82f6, 1.1, 28, 2);
  floorGlow.position.set(0, 2.2, 0);
  scene.add(hemi, key, fill, rim, floorGlow);

  makeGeos();
  const floorMat = mat('#121216', { roughness: 0.92, metalness: 0.04 });
  floor = new THREE.Mesh(new THREE.CircleGeometry(28, 48), floorMat);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // faint grid
  const grid = new THREE.GridHelper(36, 36, 0x1c1c24, 0x16161c);
  grid.position.y = 0.002;
  grid.material.transparent = true;
  grid.material.opacity = 0.45;
  scene.add(grid);

  // soft vignette ring
  const ring = new THREE.Mesh(new THREE.RingGeometry(16, 22, 40), new THREE.MeshBasicMaterial({ color: '#0B0B0D', transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01;
  scene.add(ring);

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

  const instGeo = new THREE.SphereGeometry(0.045, 8, 8);
  const instMat = new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.95 });
  packetMesh = new THREE.InstancedMesh(instGeo, instMat, PACKET_CAP);
  packetMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  packetMesh.count = 0;
  packetMesh.setColorAt(0, new THREE.Color('#60A5FA'));
  if (packetMesh.instanceColor) packetMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  scene.add(packetMesh);

  defaultCamera();
  built = true;
  resize();
}

function ensureCapRenderer(W, H) {
  if (!capRenderer) {
    capRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    capRenderer.outputColorSpace = THREE.SRGBColorSpace;
    capRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    capRenderer.toneMappingExposure = 1.08;
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

  if (a.mode === 'work' && now < a.until) {
    const typ = Math.sin(t * 22 + hid);
    lArm.x = -0.95 + typ * 0.08;
    rArm.x = -0.95 - typ * 0.08;
    lLow = -1.15 + typ * 0.16;
    rLow = -1.15 - typ * 0.16;
    headX = 0.28;
    bodyX = 0.12;
    bodyY += 0.01;
  } else if (a.mode === 'celebrate' && now < a.until) {
    const u = 1 - Math.max(0, (a.until - now) / 1400);
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
  } else {
    // idle: occasional lean / stretch, never a fake event
    const cycle = (now + (hid % 17000)) % 18000;
    if (cycle < 1600) {
      // stretch
      const k = Math.sin((cycle / 1600) * Math.PI);
      lArm = { x: -2.1 * k - 0.4 * (1 - k), y: 0.1, z: 0.25 };
      rArm = { x: -2.1 * k - 0.4 * (1 - k), y: -0.1, z: -0.25 };
      lLow = -0.4 * k - 1.0 * (1 - k);
      rLow = lLow;
      headX = -0.15 * k + 0.16 * (1 - k);
      bodyY += 0.04 * k;
    } else if (cycle < 3400) {
      const k = Math.min(1, (cycle - 1600) / 400) * (cycle > 3000 ? (3400 - cycle) / 400 : 1);
      bodyX = 0.04 - 0.38 * k;
      headX = 0.16 - 0.2 * k;
      lArm.x = -0.7; rArm.x = -0.7;
      lLow = -0.8; rLow = -0.8;
    } else {
      // rest sway already applied
    }
    if (now >= a.until) a.mode = 'idle';
  }

  p.body.position.y = bodyY;
  p.body.rotation.set(bodyX, 0, bodyZ);
  p.head.rotation.set(headX, headY, headZ);
  p.lArm.rotation.set(lArm.x, lArm.y, lArm.z);
  p.rArm.rotation.set(rArm.x, rArm.y, rArm.z);
  p.lArm.userData.lower.rotation.x = lLow;
  p.rArm.userData.lower.rotation.x = rLow;
  // blink
  const blink = ((now + hid) % 4200) < 120;
  const es = blink ? 0.12 : 1;
  p.eyeL.scale.y = es; p.eyeR.scale.y = es;
}

function triggerAnim(id, ev) {
  const d = desks.get(id);
  if (!d) return;
  const now = performance.now();
  const type = ev && ev.type;
  const celebrate = type === 'buy' || type === 'sell' || type === 'pass' || (ev && ev.data && ev.data.pnlPct > 0) || (type === 'exit' && ev && ev.ok !== false);
  const shake = ev && (ev.ok === false || type === 'reject' || type === 'error');
  if (celebrate) { d.anim = { mode: 'celebrate', until: now + 1400, started: now, evType: type }; }
  else if (shake) { d.anim = { mode: 'shake', until: now + 800, started: now, evType: type }; }
  else { d.anim = { mode: 'work', until: now + 1600, started: now, evType: type }; }

  // packet along incoming cable
  if (ev && ev.from) {
    const cab = cables.find((c) => c.from === ev.from && c.to === id) || cables.find((c) => c.to === id);
    if (cab) spawnPacket(cab, ev);
  } else {
    const cab = cables.find((c) => c.to === id);
    if (cab) spawnPacket(cab, ev);
  }
}

function spawnPacket(cab, ev) {
  if (packets.length >= PACKET_CAP) packets.shift();
  const err = ev && (ev.ok === false || ev.type === 'reject' || ev.type === 'error');
  const col = err ? '#F43F5E' : (ev && (ev.type === 'buy' || ev.type === 'pass') ? '#22C55E' : (cab.color.getStyle ? cab.color.getStyle() : '#60A5FA'));
  packets.push({ curve: cab.curve, t: 0, speed: 0.85 + Math.random() * 0.5, color: col, alive: true });
  cab.heat = Math.min(1, (cab.heat || 0) + 0.6);
}

function stepPackets(dt) {
  const keep = [];
  for (const p of packets) {
    p.t += p.speed * dt;
    if (p.t < 1) keep.push(p);
  }
  packets.length = 0;
  packets.push(...keep);
  const n = Math.min(PACKET_CAP, packets.length);
  packetMesh.count = n;
  for (let i = 0; i < n; i++) {
    const p = packets[i];
    p.curve.getPoint(p.t, _v);
    _v.y += 0.04;
    _col.set(p.color);
    _m.compose(_v, _q.identity(), _s.set(1, 1, 1));
    packetMesh.setMatrixAt(i, _m);
    packetMesh.setColorAt(i, _col);
  }
  packetMesh.instanceMatrix.needsUpdate = true;
  if (packetMesh.instanceColor) packetMesh.instanceColor.needsUpdate = true;
}

function stepCables(dt) {
  for (const c of cables) {
    c.heat = (c.heat || 0) * Math.exp(-dt * 1.4);
    c.line.material.opacity = 0.22 + c.heat * 0.7;
  }
}

function stepScreens(now) {
  const w = world();
  if (!w) return;
  for (const [id, d] of desks) {
    const mode = agentMode(id, now);
    setStatusColor(d.light, mode);
    const rows = (w.screens && w.screens[id]) || [];
    const key = rows.length ? (rows[rows.length - 1].at + '|' + rows[rows.length - 1].text + '|' + mode) : ('idle|' + mode + '|' + Math.floor(now / 530));
    if (key !== d.lastScreen || now - d.lastPaint > 500) {
      d.scr.name = d.name;
      paintScreen(d.scr, rows, mode, now);
      d.lastScreen = key;
      d.lastPaint = now;
    }
    // name tag faces camera
    if (d.tag && camera) d.tag.lookAt(camera.position);
  }
}

function step(now, dt) {
  if (!built) return;
  if (controls) controls.update();
  for (const d of desks.values()) applyAnim(d, now, dt);
  stepPackets(dt);
  stepCables(dt);
  stepScreens(now);
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
  renderer.render(scene, camera);
  raf = requestAnimationFrame(loop);
}

function drawWatermark(ctx, W, H) {
  const scale = Math.max(0.85, Math.min(W, H) / 1080);
  const x = 28 * scale, y = 28 * scale;
  ctx.save();
  ctx.font = '700 ' + Math.round(22 * scale) + 'px Inter,system-ui,sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 8 * scale;
  ctx.fillStyle = '#FAFAFA';
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
  ctx.fillStyle = '#86EFAC';
  ctx.fillText('LIVE', px + 14 * scale, y);
  const liveW = ctx.measureText('LIVE').width;
  px += 14 * scale + liveW + 12 * scale;
  const st = (pipe() && pipe().status) || {};
  const paper = (st.mode || (st.dryRun ? 'PAPER' : 'LIVE')) !== 'LIVE';
  const label = paper ? 'PAPER' : 'LIVE';
  ctx.font = '800 ' + Math.round(10 * scale) + 'px Inter,system-ui,sans-serif';
  const pw = ctx.measureText(label).width + 16 * scale;
  const ph = 18 * scale;
  ctx.fillStyle = paper ? '#27272A' : '#14532D';
  ctx.beginPath(); ctx.roundRect(px, y - ph / 2, pw, ph, ph / 2); ctx.fill();
  ctx.fillStyle = paper ? '#FCD34D' : '#86EFAC';
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
  cap.render(scene, camera);
  camera.aspect = prevAspect;
  camera.updateProjectionMatrix();
  const ctx = dest.getContext('2d');
  ctx.fillStyle = '#0B0B0D';
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
    // rebuild if graph changed
    disposeScene();
    try { buildScene(w); } catch (e) { console.warn(e); return false; }
  }
  return true;
}

function disposeScene() {
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  for (const d of desks.values()) {
    if (d.scr && d.scr.tex) d.scr.tex.dispose();
  }
  desks.clear();
  cables.length = 0;
  packets.length = 0;
  if (scene) {
    scene.traverse((o) => {
      if (o.geometry && o.geometry !== geos[Object.keys(geos).find((k) => geos[k] === o.geometry)]) {
        /* leave shared geos */
      }
    });
  }
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
  return { active, built, agents: desks.size, fps: Math.round(fps), modes, packets: packets.length, cables: cables.length };
}

document.addEventListener('visibilitychange', () => { hidden = document.hidden; if (!hidden) lastT = 0; });
window.addEventListener('resize', () => { if (active) resize(); });

function lookAtAgent(id, dist) {
  const d = desks.get(id);
  if (!d || !camera || !controls) return false;
  const gap = dist == null ? 3.4 : dist;
  const p = d.root.position.clone();
  p.y += 0.72;
  camera.position.set(p.x + gap * 0.55, p.y + 1.45, p.z + gap);
  controls.target.copy(p);
  controls.update();
  return true;
}

window.DevameerOffice = {
  attach, setActive, isActive: () => active, renderCapture, endCapture,
  onEvent, inspect, resize, defaultCamera, lookAtAgent,
  supported: hasWebGL,
};

(function boot() {
  const P = pipe();
  if (P && typeof P.onWorldEvent === 'function') P.onWorldEvent(onEvent);
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
  };
  tryApply();
})();
