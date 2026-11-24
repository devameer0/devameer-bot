/* Devameer Bot Pipeline — 3D virtual office. Cartoon (Pixar/Animal-Crossing) agents at desks in a toon city, driven only by real SSE events. */
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
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
let walkOn = false, tourOn = false; // walk mode removed; walkOn stays false
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
function isWeak() {
  try {
    const cores = navigator.hardwareConcurrency || 8;
    const mem = navigator.deviceMemory || 8;
    return isMob() || cores <= 4 || mem <= 4;
  } catch { return isMob(); }
}
let pixelRatioCap = 1.5;
let autoTier = 0;
let userFx = 'high';
let pendingInteriors = [];
let cablesWired = false;
let loadDone = false;

const TOUR_ORDER = [
  ['feed', 'Herald'], ['jupiter', 'Quote'], ['rpc', 'Chain'], ['rugs', 'Sentinel'],
  ['sniper', 'Sniper'], ['scout', 'Scout'], ['curve', 'Rider'], ['graduate', 'Graduate'],
  ['risk', 'Oracle'], ['buy', 'Broker'], ['monitor', 'Watch'], ['exits', 'Keeper'],
  ['sell', 'Closer'], ['db', 'Archivist'], ['share', 'Editor'], ['withdraw', 'Vault'],
  ['errors', 'Alarm'],
];
const TOUR_NAME_TO_ID = Object.fromEntries(TOUR_ORDER.map(([id, name]) => [name.toLowerCase(), id]));

function readFlowQuery() {
  let s = '';
  try { s = location.search || ''; } catch {}
  if (!s || s === '?') {
    try { s = sessionStorage.getItem('devameer-flow-query') || ''; } catch {}
    if (s) {
      const q = s.charAt(0) === '?' ? s : '?' + s;
      try { history.replaceState(null, '', (location.pathname || '/') + q + (location.hash || '')); } catch {}
    }
  }
  try { return new URLSearchParams((s.charAt(0) === '?' ? s.slice(1) : s) || ''); } catch { return new URLSearchParams(); }
}
function truthyParam(v) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}
function parseFlowParams() {
  const q = readFlowQuery();
  try {
    if (location.search && /(?:^|[?&])(record|room|loop|secs)=/i.test(location.search)) {
      sessionStorage.setItem('devameer-flow-query', location.search);
    }
  } catch {}
  const rec = truthyParam(q.get('record'));
  const loop = truthyParam(q.get('loop'));
  let secs = parseFloat(q.get('secs'));
  if (!Number.isFinite(secs)) secs = 5;
  secs = Math.max(2, Math.min(20, secs));
  const room = (q.get('room') || '').trim();
  return { rec, loop, secs, room };
}
function resolveRoomParam(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (TOUR_NAME_TO_ID[s]) return TOUR_NAME_TO_ID[s];
  for (const [id, name] of TOUR_ORDER) {
    if (id === s || name.toLowerCase() === s) return id;
  }
  const w = world();
  if (w && w.nodes) {
    for (const n of w.nodes) {
      if (!n) continue;
      if (String(n.id).toLowerCase() === s) return n.id;
      if (String(n.name || '').toLowerCase() === s) return n.id;
    }
  }
  return null;
}

let recordMode = false;
let recordAutoStart = false;
let recordLoop = false;
let recordSecs = 5;
let pendingRoom = '';
let recordTour = { on: false, index: -1, hold: 0, phase: 'idle' };
let jumpMenuSig = '';
let flyLockUntil = 0;
(function initFlowParams() {
  const p = parseFlowParams();
  recordMode = p.rec;
  recordAutoStart = p.rec && !p.room;
  recordLoop = p.loop;
  recordSecs = p.secs;
  pendingRoom = p.room;
})();

function desiredPixelRatio() {
  const dpr = window.devicePixelRatio || 1;
  if (recordMode) return Math.max(0.75, Math.min(1, dpr));
  let cap = Math.min(1.5, pixelRatioCap);
  if (isMob() || isWeak()) cap = Math.min(cap, 1.15);
  if (autoTier >= 1) cap = Math.min(cap, 1);
  if (autoTier >= 3) cap = Math.min(cap, 0.85);
  return Math.max(0.75, Math.min(cap, dpr));
}
function applyPixelRatio() {
  if (!renderer) return;
  const pr = desiredPixelRatio();
  if (Math.abs((renderer.getPixelRatio ? renderer.getPixelRatio() : 0) - pr) > 0.04) {
    renderer.setPixelRatio(pr);
    const wrap = document.getElementById('wrap');
    if (wrap) {
      const r = wrap.getBoundingClientRect();
      renderer.setSize(Math.max(1, Math.floor(r.width)), Math.max(1, Math.floor(r.height)), false);
    }
    resizeFx();
  }
}
function setLoadProgress(pct, msg, done) {
  const gate = document.getElementById('bootGate');
  const bar = document.getElementById('bootBar');
  const label = document.getElementById('bootMsg');
  if (label && msg) label.textContent = msg;
  if (bar) bar.style.width = Math.max(0, Math.min(100, +pct || 0)) + '%';
  if (window.DevameerPipeline && typeof window.DevameerPipeline.setBoot === 'function') {
    try { window.DevameerPipeline.setBoot(pct, msg, !!done); } catch {}
  }
  if (!gate) return;
  if (done) { loadDone = true; gate.classList.add('hidden'); }
  else { loadDone = false; gate.classList.remove('hidden'); }
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

function toonRamp() {
  if (toonRamp._tex) return toonRamp._tex;
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 1;
  const ctx = c.getContext('2d');
  const steps = [0.22, 0.22, 0.48, 0.48, 0.72, 0.72, 1, 1];
  steps.forEach((v, i) => {
    ctx.fillStyle = 'rgb(' + (v * 255) + ',' + (v * 255) + ',' + (v * 255) + ')';
    ctx.fillRect(i, 0, 1, 1);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  toonRamp._tex = tex;
  return tex;
}

function standardMat(opts) {
  return new THREE['MeshStandardMaterial'](opts || {});
}
function cartoonMat(opts) {
  const o = opts || {};
  if (o.standard || o.transparent || (o.opacity != null && o.opacity < 0.98) || (o.roughness != null && o.roughness < 0.14)) {
    return standardMat(o);
  }
  const conf = {
    color: o.color || '#ffffff',
    gradientMap: toonRamp(),
    emissive: o.emissive || '#000000',
    emissiveIntensity: o.emissiveIntensity || 0,
    side: o.side || THREE.FrontSide,
  };
  if (o.map) conf.map = o.map;
  if (o.emissiveMap) conf.emissiveMap = o.emissiveMap;
  if (o.transparent) { conf.transparent = true; conf.opacity = o.opacity != null ? o.opacity : 1; }
  return new THREE.MeshToonMaterial(conf);
}

function mat(color, opts) {
  return cartoonMat(Object.assign({ color }, opts || {}));
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

const CAST = {
  feed:     { kind: 'human', skin: '#F3C7A6', hair: '#2A1B12', hairStyle: 'short',  outfit: 'hoodie',    extra: 'antenna', eye: '#3B82F6', brow: 0.02 },
  jupiter:  { kind: 'human', skin: '#C68642', hair: '#1A1A1A', hairStyle: 'puff',   outfit: 'vest',      extra: 'ring',    eye: '#7C3AED', brow: 0.04 },
  rpc:      { kind: 'robot', skin: '#D5DCE8', hair: '#64748B', hairStyle: 'none',   outfit: 'chassis',   extra: 'hex',     eye: '#14F1C9', brow: 0 },
  rugs:     { kind: 'human', skin: '#E8B895', hair: '#3B1F0F', hairStyle: 'slick',  outfit: 'suit',      extra: 'shield',  eye: '#1F2937', brow: 0.08 },
  sniper:   { kind: 'human', skin: '#F5D0B0', hair: '#4A2C17', hairStyle: 'messy',  outfit: 'tactical',  extra: 'cap',     eye: '#166534', brow: 0.06 },
  scout:    { kind: 'human', skin: '#8D5524', hair: '#1C1008', hairStyle: 'bun',    outfit: 'explorer',  extra: 'headset', eye: '#92400E', brow: 0.03 },
  curve:    { kind: 'human', skin: '#F1C27D', hair: '#7A3E14', hairStyle: 'wavy',   outfit: 'tee',       extra: 'mohawk',  eye: '#0F766E', brow: -0.02 },
  graduate: { kind: 'human', skin: '#FFE0BD', hair: '#F4D03F', hairStyle: 'bob',    outfit: 'blazer',    extra: 'mortar',  eye: '#2563EB', brow: 0.01 },
  risk:     { kind: 'human', skin: '#D1A888', hair: '#2C1810', hairStyle: 'neat',   outfit: 'suit',      extra: 'glasses', eye: '#111827', brow: 0.1 },
  buy:      { kind: 'human', skin: '#E0AC69', hair: '#1A1A1A', hairStyle: 'fade',   outfit: 'trader',    extra: 'headset', eye: '#0F766E', brow: 0.02 },
  monitor:  { kind: 'human', skin: '#F3C7A6', hair: '#6B3A1F', hairStyle: 'pony',   outfit: 'hoodie',    extra: 'glasses', eye: '#0369A1', brow: 0 },
  exits:    { kind: 'human', skin: '#C68642', hair: '#0E0E0E', hairStyle: 'short',  outfit: 'vest',      extra: 'key',     eye: '#9A3412', brow: 0.05 },
  sell:     { kind: 'human', skin: '#FFDAB4', hair: '#8B1A1A', hairStyle: 'spike',  outfit: 'jacket',    extra: 'chevron', eye: '#BE123C', brow: 0.04 },
  db:       { kind: 'robot', skin: '#B8C4D4', hair: '#334155', hairStyle: 'none',   outfit: 'archive',   extra: 'disks',   eye: '#38BDF8', brow: 0 },
  share:    { kind: 'human', skin: '#F6C8A0', hair: '#C45C26', hairStyle: 'wavy',   outfit: 'creative',  extra: 'beret',   eye: '#7C3AED', brow: -0.01 },
  withdraw: { kind: 'human', skin: '#E8B895', hair: '#2A1810', hairStyle: 'slick',  outfit: 'banker',    extra: 'glasses', eye: '#1E3A8A', brow: 0.07 },
  errors:   { kind: 'robot', skin: '#FFC4C4', hair: '#9F1239', hairStyle: 'none',   outfit: 'alert',     extra: 'siren',   eye: '#EF4444', brow: 0.05 },
  mascot:   { kind: 'robot', skin: '#14F1C9', hair: '#9945FF', hairStyle: 'none',   outfit: 'chassis',  extra: 'halo',    eye: '#9945FF', brow: 0.02 },
};

function addOutline(mesh, color) {
  if (!mesh || !mesh.geometry || isWeak()) return mesh;
  const ol = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({
    color: color || '#2A1840',
    side: THREE.BackSide,
  }));
  ol.scale.setScalar(1.08);
  ol.userData.isOutline = true;
  mesh.add(ol);
  return mesh;
}

function styleHair(head, style, hairMat, skinY) {
  const y = 0.12 + (skinY || 0);
  if (style === 'none') return;
  const add = (mesh, px, py, pz, sx, sy, sz) => {
    mesh.position.set(px, py, pz);
    if (sx) mesh.scale.set(sx, sy, sz);
    addOutline(mesh);
    head.add(mesh);
  };
  if (style === 'short' || style === 'fade' || style === 'neat' || style === 'slick') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), hairMat);
    add(cap, 0, 0.04, -0.01, 1.02, 0.85, 1.0);
    if (style === 'slick') {
      const fringe = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), hairMat);
      add(fringe, 0, 0.1, 0.12, 1.6, 0.45, 0.7);
    }
  } else if (style === 'puff' || style === 'wavy') {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), hairMat);
    add(puff, 0, 0.1, -0.02, 1.15, 0.9, 1.1);
    if (style === 'wavy') {
      for (let i = -1; i <= 1; i++) {
        const cl = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), hairMat);
        add(cl, i * 0.1, 0.14, 0.08, 1, 0.8, 1);
      }
    }
  } else if (style === 'messy' || style === 'spike') {
    for (let i = 0; i < 6; i++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.12, 5), hairMat);
      const a = (i / 6) * Math.PI * 2;
      add(sp, Math.cos(a) * 0.08, 0.16, Math.sin(a) * 0.06, 1, style === 'spike' ? 1.4 : 1, 1);
      sp.rotation.z = Math.cos(a) * 0.4;
    }
  } else if (style === 'bun' || style === 'pony') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), hairMat);
    add(cap, 0, 0.05, -0.01, 1.02, 0.8, 1);
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), hairMat);
    add(bun, style === 'pony' ? 0 : 0, 0.14, -0.14, 1, 1, 1);
    if (style === 'pony') {
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.16, 4, 6), hairMat);
      add(tail, 0, 0.02, -0.2, 1, 1, 1);
      tail.rotation.x = 0.6;
    }
  } else if (style === 'bob') {
    const bob = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), hairMat);
    add(bob, 0, 0.0, -0.02, 1.08, 0.85, 1.05);
  }
}

function styleHat(head, extra, color, accMat) {
  if (extra === 'cap') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), accMat);
    cap.position.set(0, 0.12, 0);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.025, 0.12), accMat);
    brim.position.set(0, 0.1, 0.14);
    addOutline(cap); addOutline(brim);
    head.add(cap, brim);
  } else if (extra === 'mortar') {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.28), mat('#1C1917'));
    board.position.y = 0.2;
    const tassel = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 6), mat('#FACC15', { emissive: '#FACC15', emissiveIntensity: 0.3 }));
    tassel.position.set(0.14, 0.16, 0);
    addOutline(board);
    head.add(board, tassel);
  } else if (extra === 'beret') {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), accMat);
    b.scale.set(1.2, 0.4, 1.2);
    b.position.set(-0.02, 0.16, 0);
    addOutline(b);
    head.add(b);
  } else if (extra === 'headset' || extra === 'glasses') {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.012, 6, 16, Math.PI), mat('#1C1917'));
    band.rotation.x = extra === 'headset' ? 0.2 : Math.PI / 2;
    band.position.y = extra === 'headset' ? 0.08 : 0.04;
    head.add(band);
    if (extra === 'headset') {
      const cupL = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), mat('#1C1917'));
      cupL.position.set(-0.16, 0.04, 0);
      const cupR = cupL.clone(); cupR.position.x = 0.16;
      const mic = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.12, 6), mat('#1C1917'));
      mic.rotation.z = 0.8; mic.position.set(-0.1, -0.02, 0.1);
      head.add(cupL, cupR, mic);
    } else {
      const lensM = mat('#93C5FD', { standard: true, transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.2 });
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.05, 10), lensM); l.position.set(-0.06, 0.04, 0.155);
      const r = l.clone(); r.position.x = 0.06;
      head.add(l, r);
    }
  } else if (extra === 'siren') {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 8), mat('#EF4444', { emissive: '#EF4444', emissiveIntensity: 0.85 }));
    s.position.y = 0.22;
    head.add(s);
  } else if (extra === 'disks') {
    for (let i = 0; i < 3; i++) {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.1 - i * 0.015, 0.1 - i * 0.015, 0.03, 10), accMat);
      d.position.y = 0.18 + i * 0.04;
      head.add(d);
    }
  } else if (extra === 'halo' || extra === 'antenna' || extra === 'hex' || extra === 'ring') {
    addAcc(head, extra === 'halo' ? 'halo' : extra, color, {});
  }
}

function styleOutfit(body, torso, cast, color, clothMat, skinMat) {
  const kind = cast.outfit;
  if (kind === 'hoodie' || kind === 'jacket') {
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), clothMat);
    hood.position.set(0, 0.22, -0.08);
    hood.rotation.x = 0.4;
    hood.scale.set(1.05, 0.7, 0.9);
    addOutline(hood);
    body.add(hood);
  }
  if (kind === 'suit' || kind === 'blazer' || kind === 'banker' || kind === 'trader') {
    const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.04), mat('#1C1917'));
    lapel.position.set(0, 0.04, 0.12);
    addOutline(lapel);
    body.add(lapel);
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.02), mat(kind === 'banker' ? '#FACC15' : color, { emissive: color, emissiveIntensity: 0.12 }));
    tie.position.set(0, 0.02, 0.145);
    body.add(tie);
  }
  if (kind === 'vest' || kind === 'tactical') {
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.2), mat(kind === 'tactical' ? '#3F6212' : color));
    vest.position.set(0, 0.02, 0.02);
    addOutline(vest);
    body.add(vest);
  }
  if (kind === 'chassis' || kind === 'archive' || kind === 'alert') {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.08), mat('#14F1C9', { emissive: '#14F1C9', emissiveIntensity: 0.4 }));
    plate.position.set(0, 0.05, 0.14);
    body.add(plate);
  }
  if (kind === 'creative' || kind === 'explorer') {
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 6, 12), mat(kind === 'explorer' ? '#F59E0B' : '#EC4899'));
    scarf.rotation.x = 1.2;
    scarf.position.set(0, 0.2, 0.04);
    body.add(scarf);
  }
}

function makeBot(node) {
  const color = node.color || '#3B82F6';
  const cast = CAST[node.id] || { kind: 'human', skin: '#F3C7A6', hair: '#2A1B12', hairStyle: 'short', outfit: 'tee', extra: 'antenna', eye: color, brow: 0.02 };
  const isRobot = cast.kind === 'robot';
  const skin = isRobot ? (cast.skin || '#D5DCE8') : (cast.skin || '#F3C7A6');
  const ink = '#1A1224';
  const cloth = color;
  const skinMat = mat(skin);
  const clothMat = mat(cloth);
  const inkMat = mat(ink);
  const hairMat = mat(cast.hair || '#2A1B12');
  const accMat = mat(color, { emissive: color, emissiveIntensity: 0.16 });
  const whiteMat = mat('#FFFBFF');
  const eyeMat = mat(cast.eye || '#2563EB');
  const shoeMat = mat(isRobot ? '#334155' : '#1C1917');

  const bot = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.58;

  // Longer, slightly rounded torso — Pixar-ish proportions
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 12), clothMat);
  torso.scale.set(1.15, 1.25, 0.95);
  torso.position.y = 0.02;
  addOutline(torso);
  const hipsMesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), clothMat);
  hipsMesh.scale.set(1.15, 0.7, 0.95);
  hipsMesh.position.y = -0.12;
  addOutline(hipsMesh);
  const collar = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), isRobot ? clothMat : skinMat);
  collar.position.y = 0.2;
  body.add(torso, hipsMesh, collar);
  styleOutfit(body, torso, cast, color, clothMat, skinMat);

  const head = new THREE.Group();
  head.position.y = 0.34;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 14), isRobot ? clothMat : skinMat);
  skull.scale.set(1, 1.02, 0.95);
  addOutline(skull);

  // Expressive cartoon face
  const eyeL = new THREE.Group(); eyeL.position.set(-0.055, 0.03, 0.12);
  const eyeR = new THREE.Group(); eyeR.position.set(0.055, 0.03, 0.12);
  const whiteL = new THREE.Mesh(new THREE.SphereGeometry(0.042, 10, 8), whiteMat);
  whiteL.scale.set(1, 1.15, 0.7);
  const whiteR = whiteL.clone();
  const irisL = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), eyeMat);
  irisL.position.z = 0.016;
  const irisR = irisL.clone();
  const pupilL = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), inkMat);
  pupilL.position.z = 0.03;
  const pupilR = pupilL.clone();
  const hiL = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 6), whiteMat);
  hiL.position.set(-0.01, 0.012, 0.036);
  const hiR = hiL.clone();
  eyeL.add(whiteL, irisL, pupilL, hiL);
  eyeR.add(whiteR, irisR, pupilR, hiR);

  const browMat = isRobot ? clothMat : hairMat;
  const browL = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.012, 0.012), browMat);
  browL.position.set(-0.055, 0.085, 0.13);
  browL.rotation.z = 0.12 + (cast.brow || 0);
  const browR = browL.clone();
  browR.position.x = 0.055;
  browR.rotation.z = -0.12 - (cast.brow || 0);

  const mouth = new THREE.Group();
  mouth.position.set(0, -0.06, 0.135);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.007, 6, 12, Math.PI), inkMat);
  lip.rotation.set(0.15, 0, Math.PI);
  const mouthFill = new THREE.Mesh(new THREE.CircleGeometry(0.028, 10), mat('#E11D48'));
  mouthFill.position.z = 0.002;
  mouthFill.scale.y = 0.25;
  mouth.add(lip, mouthFill);
  mouth.userData.fill = mouthFill;

  // Cheeks
  const cheekL = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), mat('#F9A8D4', { emissive: '#F9A8D4', emissiveIntensity: isRobot ? 0 : 0.15 }));
  cheekL.position.set(-0.1, -0.02, 0.1);
  cheekL.scale.set(1, 0.7, 0.6);
  const cheekR = cheekL.clone(); cheekR.position.x = 0.1;

  head.add(skull, eyeL, eyeR, browL, browR, mouth, cheekL, cheekR);
  styleHair(head, cast.hairStyle, hairMat);
  styleHat(head, cast.extra, color, accMat);
  // Keep classic accessory too when not already a hat
  if (ACCESSORY[node.id] && !['cap', 'mortar', 'beret', 'headset', 'glasses', 'siren', 'disks', 'antenna', 'hex', 'ring'].includes(cast.extra)) {
    addAcc(head, ACCESSORY[node.id], color, {});
  }
  body.add(head);

  const lArm = makeLimb(geos.upperArm, geos.foreArm, clothMat, clothMat, skinMat, -1);
  const rArm = makeLimb(geos.upperArm, geos.foreArm, clothMat, clothMat, skinMat, 1);
  lArm.position.set(-0.18, 0.12, 0.02);
  rArm.position.set(0.18, 0.12, 0.02);
  // chunkier hands
  if (lArm.userData.hand) lArm.userData.hand.scale.setScalar(1.25);
  if (rArm.userData.hand) rArm.userData.hand.scale.setScalar(1.25);
  body.add(lArm, rArm);

  const hips = new THREE.Group();
  const lLeg = makeLimb(geos.thigh, geos.shin, clothMat, clothMat, shoeMat, -1);
  const rLeg = makeLimb(geos.thigh, geos.shin, clothMat, clothMat, shoeMat, 1);
  lLeg.position.set(-0.08, 0, 0);
  rLeg.position.set(0.08, 0, 0);
  hips.add(lLeg, rLeg);
  bot.add(hips, body);
  bot.userData = {
    body, head, lArm, rArm, lLeg, rLeg,
    eyeL, eyeR, mouth, browL, browR, mouthFill,
    color, cast,
  };
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
let roofForced = 'on'; // on | off — never auto-hide
let fadeWalls = [];
let roofFade = 0;
let lastTapAt = 0, lastTapX = 0, lastTapY = 0;
const RING_IN = 5.35, RING_HALL = 7.55, RING_OFFICE = 10.95, RING_OUT = 13.35;
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
  const pods = [
    { id: 'intake', name: 'Intake', ids: ['feed', 'jupiter', 'rpc'], color: '#38BDF8', ang: 0 },
    { id: 'security', name: 'Security', ids: ['rugs'], color: '#FB7185', ang: Math.PI / 3 },
    { id: 'hunters', name: 'Hunters', ids: ['sniper', 'scout', 'curve', 'graduate'], color: '#4ADE80', ang: 2 * Math.PI / 3 },
    { id: 'trading', name: 'Trading', ids: ['buy', 'monitor', 'exits', 'sell'], color: '#2DD4BF', ang: Math.PI },
    { id: 'back', name: 'Back office', ids: ['db', 'share', 'withdraw', 'errors'], color: '#A78BFA', ang: 4 * Math.PI / 3 },
    { id: 'risk', name: 'Risk', ids: ['risk'], color: '#FBBF24', ang: 5 * Math.PI / 3 },
  ];
  const CLUSTER_R = 22;
  const POD_GAP = 7.2;
  const specs = [];
  for (const pod of pods) {
    const n = pod.ids.length;
    const tx = Math.cos(pod.ang), tz = -Math.sin(pod.ang);
    pod.hub = { x: Math.sin(pod.ang) * (CLUSTER_R - 4.4), z: Math.cos(pod.ang) * (CLUSTER_R - 4.4) };
    pod.ids.forEach((id, i) => {
      const u = n === 1 ? 0 : (i - (n - 1) / 2);
      const cx = Math.sin(pod.ang) * CLUSTER_R + tx * u * POD_GAP;
      const cz = Math.cos(pod.ang) * CLUSTER_R + tz * u * POD_GAP;
      // Face outward so agents in a row look at their own screens, never at a neighbor.
      specs.push({ id, cx, cz, ang: pod.ang, dept: pod.id, deptName: pod.name, podColor: pod.color, door: 'in', w: 3.8, d: 4.2 });
    });
  }
  hqLayout.pods = pods;
  return specs;
}


function orientedBox(lx0, lx1, lz0, lz1, y0, y1, cx, cz, ang) {
  const w = Math.abs(lx1 - lx0), d = Math.abs(lz1 - lz0), h = y1 - y0;
  if (w < 0.015 || d < 0.015 || h < 0.015) return null;
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate((lx0 + lx1) / 2, (y0 + y1) / 2, (lz0 + lz1) / 2);
  g.rotateY(ang);
  g.translate(cx, 0, cz);
  return g;
}

function pushOriented(list, lx0, lx1, lz0, lz1, y0, y1, cx, cz, ang) {
  const g = orientedBox(lx0, lx1, lz0, lz1, y0, y1, cx, cz, ang);
  if (g) list.push(g);
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
  const ang = room.ang != null ? room.ang : Math.atan2(room.cx, room.cz);
  const d = room.d || ROOM_D;
  return new THREE.Vector3(
    room.cx - Math.sin(ang) * (d / 2 + 0.7),
    0.18,
    room.cz - Math.cos(ang) * (d / 2 + 0.7),
  );
}

function nearestPathHub(v) {
  const pods = hqLayout.pods || [];
  let best = new THREE.Vector3(0, 0.18, 0), bestD = 1e9;
  for (const p of pods) {
    if (!p.hub) continue;
    const d = Math.hypot(v.x - p.hub.x, v.z - p.hub.z);
    if (d < bestD) { bestD = d; best = new THREE.Vector3(p.hub.x, 0.18, p.hub.z); }
  }
  return best;
}

function hallWayPoints(a, b) {
  const ha = nearestPathHub(a), hb = nearestPathHub(b);
  const mid = new THREE.Vector3(0, 0.18, 0);
  if (Math.hypot(ha.x - hb.x, ha.z - hb.z) < 0.5) return [ha];
  return [ha, mid, hb];
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
  const downA = monA.clone(); downA.y = 0.18;
  const downB = monB.clone(); downB.y = 0.18;
  const pts = [monA, downA, doorA, ...hallWayPoints(doorA, doorB), doorB, downB, monB];
  return new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.18);
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
    const keep = room.id === closeOn || dist < 28 || cy > 8;
    if (room.interior) room.interior.visible = keep;
    room.far = dist > 24 && room.id !== closeOn && cy < 8;
  }
}

function stepDoors() {
  if (!camera || !doorList.length) return;
  const p = camera.position;
  for (const d of doorList) {
    const dist = Math.hypot(p.x - d.x, p.z - d.z);
    const thisOffice = d.roomId && (closeOn === d.roomId || (controls && rooms.get(d.roomId) && Math.hypot((controls.target.x - (rooms.get(d.roomId).cx || 0)), (controls.target.z - (rooms.get(d.roomId).cz || 0))) < 1.8 && dist < 3.2));
    const want = (dist < 1.85 && thisOffice) ? d.openAng : d.closedAng;
    d.mesh.rotation.y += (want - d.mesh.rotation.y) * 0.16;
  }
}

function furnishOffice(spec, node, buckets) {
  const { cx, cz, ang, w, d } = spec;
  const color = node.color || spec.podColor || '#3B82F6';
  const lx0 = -w / 2, lx1 = w / 2, lz0 = -d / 2, lz1 = d / 2;
  // Open-air rug only — no walls, roof, or glass.
  pushOriented(buckets.carpet, lx0 + 0.08, lx1 - 0.08, lz0 + 0.1, lz1 - 0.08, 0.012, 0.04, cx, cz, ang);
  pendingInteriors.push({ spec, node, color });
  rooms.set(spec.id, { ...spec, color, node, far: false, interior: null, furnished: false });
  return null;
}

function furnishOfficeInterior(spec, node) {
  if (!spec || !node || desks.has(node.id)) return null;
  const { cx, cz, ang, w, d } = spec;
  const color = node.color || spec.podColor || '#3B82F6';
  const root = new THREE.Group();
  root.position.set(cx, 0, cz);
  root.rotation.y = ang;
  root.name = 'office-' + spec.id;

  const interior = new THREE.Group();
  interior.name = 'interior-' + spec.id;

  const dsk = makeDesk(node);
  const side = (hashId(spec.id) % 2) ? 1 : -1;
  dsk.root.position.set(0, 0, 0.42);
  dsk.root.rotation.y = 0;
  interior.add(dsk.root);
  // Reparent the agent into the office so they can walk to the door and back.
  if (dsk.bot && dsk.sit && dsk.bot.parent === dsk.sit) {
    const wp = new THREE.Vector3();
    dsk.bot.getWorldPosition(wp);
    dsk.sit.remove(dsk.bot);
    interior.add(dsk.bot);
    interior.worldToLocal(wp);
    dsk.bot.position.copy(wp);
  }
  dsk.homePos = dsk.bot.position.clone();
  dsk.doorPos = new THREE.Vector3(0, 0, -d / 2 + 0.42);
  dsk.officeRoot = interior;

  const plant = makePlant(hashId(spec.id));
  plant.position.set(-side * 1.15, 0, 1.05);
  interior.add(plant);
  tagPick(plant, 'inspect', 'plant');

  // Low three-sided hedge: back + sides, open toward the path. Short so nothing blocks the view.
  const hedgeMat = mat('#3D8C45', { roughness: 0.92 });
  const hh = 0.48, ht = 0.2;
  const backH = new THREE.Mesh(new THREE.BoxGeometry(w - 0.15, hh, ht), hedgeMat);
  backH.position.set(0, hh / 2, d / 2 - ht / 2);
  const leftH = new THREE.Mesh(new THREE.BoxGeometry(ht, hh, d - 0.25), hedgeMat);
  leftH.position.set(-w / 2 + ht / 2, hh / 2, 0.05);
  const rightH = new THREE.Mesh(new THREE.BoxGeometry(ht, hh, d - 0.25), hedgeMat);
  rightH.position.set(w / 2 - ht / 2, hh / 2, 0.05);
  interior.add(backH, leftH, rightH);
  tagPick(backH, 'inspect', 'hedge');

  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.28, 0.32), mat('#8B5A2B', { roughness: 0.7 }));
  crate.position.set(side * 1.05, 0.14, 0.95);
  interior.add(crate);
  tagPick(crate, 'inspect', 'crate');

  root.add(interior);

  // Lawn nameplate at the open path side, facing visitors.
  const sign = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 1.05, 6), mat('#6B4F3A', { roughness: 0.8 }));
  post.position.y = 0.52;
  const plate = makeDoorPlate(node.name || node.id, node.role || node.sub || '', color);
  plate.position.set(0, 1.08, 0.02);
  sign.add(post, plate);
  sign.position.set(side * (w / 2 - 0.35), 0, -d / 2 + 0.15);
  sign.rotation.y = Math.PI;
  sign.userData.agentId = spec.id;
  tagPick(sign, 'inspect', 'nameplate');
  clickables.push(sign);
  root.add(sign);
  dsk.tag = plate;

  hqRoot.add(root);
  const room = rooms.get(spec.id);
  if (room) { room.interior = interior; room.furnished = true; room.root = root; }
  else rooms.set(spec.id, { ...spec, color, interior, node, far: false, furnished: true, root });
  desks.set(node.id, dsk);
  if (dsk.lampLight) {
    const P = TOD[todMode] || TOD.afternoon;
    const lampsOn = (P.lamp || 0) > 0.02 && fxLevel !== 'off' && autoTier < 2;
    dsk.lampLight.visible = lampsOn;
    dsk.lampLight.intensity = lampsOn ? (0.15 + P.lamp * 0.7) : 0;
  }
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
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), cartoonMat({ color: '#FDE68A', emissive: '#FDE68A', emissiveIntensity: 0.15, roughness: 0.3 }));
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

function makeTickerStrip() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#04201A';
  ctx.fillRect(0, 0, 512, 64);
  ctx.fillStyle = '#14F1C9';
  ctx.font = '700 28px Inter,system-ui,sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('DEVAMEER  ·  PAPER  ·  SOL  ·  HQ  ·  LIVE', 256, 34);
  const tex = new THREE.CanvasTexture(c);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.22), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  tagPick(mesh, 'inspect', 'ticker');
  return mesh;
}

function buildAtrium() {
  // Atrium floor
  const atrFloor = new THREE.Mesh(
    new THREE.CircleGeometry(RING_IN - 0.05, 48),
    mat('#1A1F2E', { roughness: 0.35, metalness: 0.18 }),
  );
  atrFloor.rotation.x = -Math.PI / 2;
  atrFloor.position.y = 0.01;
  hqRoot.add(atrFloor);

  // Teal inlay rings
  [2.2, 3.4, 4.6].forEach((r, i) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.03, 6, 48),
      new THREE.MeshBasicMaterial({ color: i === 1 ? '#9945FF' : '#14F1C9', transparent: true, opacity: 0.7 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.03;
    hqRoot.add(ring);
  });

  // Atrium is enclosed by the ordinary roof (no glass dome).
  buildHoloCore();
}

let hqCore = null;
function buildHoloCore() {
  hqCore = new THREE.Group();
  hqCore.name = 'holoCore';
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.35, 0.28, 16), mat('#0F172A', { metalness: 0.4, roughness: 0.3 }));
  plinth.position.y = 0.14;
  const glow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 2.6, 12),
    new THREE.MeshBasicMaterial({ color: '#14F1C9', transparent: true, opacity: 0.55 }),
  );
  glow.position.y = 1.55;
  const ringA = new THREE.Mesh(
    new THREE.TorusGeometry(0.7, 0.035, 8, 32),
    new THREE.MeshBasicMaterial({ color: '#9945FF', transparent: true, opacity: 0.85 }),
  );
  ringA.position.y = 1.35; ringA.rotation.x = Math.PI / 2;
  const ringB = ringA.clone();
  ringB.material = new THREE.MeshBasicMaterial({ color: '#14F1C9', transparent: true, opacity: 0.85 });
  ringB.position.y = 1.85; ringB.scale.setScalar(0.8);
  const ringC = ringA.clone();
  ringC.position.y = 2.25; ringC.scale.setScalar(0.55);
  hqCore.add(plinth, glow, ringA, ringB, ringC);
  hqCore.userData.rings = [ringA, ringB, ringC];

  // Teal chibi mascot
  try {
    const statue = makeBot({ id: 'mascot', name: 'Devameer', color: '#14F1C9', icon: 'halo' });
    statue.scale.setScalar(1.85);
    statue.position.set(0, 0.28, 0);
    statue.rotation.y = Math.PI;
    tagPick(statue, 'inspect', 'mascot');
    hqCore.add(statue);
  } catch (e) { console.warn(e); }

  const title = makeCoreTitle();
  title.position.set(0, 3.05, 0);
  hqCore.add(title);

  if (!isMob() && !isWeak()) {
    const light = new THREE.PointLight('#7CFFDC', 1.1, 16, 2);
    light.position.set(0, 2.0, 0);
    hqCore.add(light);
  }
  hqRoot.add(hqCore);

  // Curved PnL holo board facing the entrance (+Z)
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  wallScreenCtx = c.getContext('2d');
  wallScreenTex = new THREE.CanvasTexture(c);
  wallScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 1.8),
    new THREE.MeshBasicMaterial({ map: wallScreenTex, toneMapped: false, transparent: true, opacity: 0.92 }),
  );
  wallScreen.position.set(0, 2.15, -2.35);
  wallScreen.rotation.y = 0; // faces +Z (entrance)
  tagPick(wallScreen, 'inspect', 'wall screen');
  hqRoot.add(wallScreen);
  paintWallScreen();
}

function makeCoreTitle() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 96);
  ctx.fillStyle = '#14F1C9';
  ctx.font = '800 52px Inter,system-ui,sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('DEVAMEER', 256, 50);
  const tex = new THREE.CanvasTexture(c);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.48), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, side: THREE.DoubleSide }));
  tagPick(mesh, 'inspect', 'holo title');
  return mesh;
}

function stepHQ(dt) {
  if (hqCore && hqCore.userData.rings) {
    const r = hqCore.userData.rings;
    r[0].rotation.z += dt * 0.6;
    r[1].rotation.z -= dt * 0.9;
    r[2].rotation.z += dt * 1.1;
    hqCore.rotation.y += dt * 0.12;
  }
}

function buildRingHall(buckets) {
  const hall = new THREE.Mesh(
    new THREE.RingGeometry(RING_IN - 0.02, RING_OFFICE - ROOM_D / 2 - 0.05, 64, 1),
    hqMats.floor,
  );
  hall.rotation.x = -Math.PI / 2;
  hall.position.y = 0.012;
  hqRoot.add(hall);

  // Data river
  const river = new THREE.Mesh(
    new THREE.TorusGeometry(RING_HALL, 0.2, 8, 72),
    cartoonMat({ color: '#14F1C9', emissive: '#14F1C9', emissiveIntensity: 0.85, roughness: 0.25, metalness: 0.2 }),
  );
  river.rotation.x = Math.PI / 2;
  river.position.y = 0.06;
  river.name = 'dataRiver';
  hqRoot.add(river);
  const riverCore = new THREE.Mesh(
    new THREE.TorusGeometry(RING_HALL, 0.07, 6, 72),
    new THREE.MeshBasicMaterial({ color: '#E9D5FF', transparent: true, opacity: 0.85 }),
  );
  riverCore.rotation.x = Math.PI / 2;
  riverCore.position.y = 0.1;
  hqRoot.add(riverCore);

  // Inner colonnade at atrium edge (entrance opening on +Z)
  const colM = mat('#F4F1EA', { roughness: 0.5, metalness: 0.08 });
  const accent = cartoonMat({ color: '#14F1C9', emissive: '#14F1C9', emissiveIntensity: 0.7, roughness: 0.3 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    // skip a gap at the entrance (ang ~ 0, +Z)
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.28) continue;
    const x = Math.sin(a) * (RING_IN - 0.22), z = Math.cos(a) * (RING_IN - 0.22);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 3.0, 8), colM);
    col.position.set(x, 1.5, z);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.07, 8), accent);
    cap.position.set(x, 3.02, z);
    hqRoot.add(col, cap);
  }
}

function buildPods(buckets) {
  const pods = hqLayout.pods || [];
  pods.forEach((pod) => {
    const n = pod.ids.length;
    const span = pod.span;
    const r0 = RING_OFFICE - ROOM_D / 2 - 0.08;
    const r1 = RING_OUT;
    const segs = Math.max(6, n * 4);
    const outer = [], trim = [];
    for (let i = 0; i < segs; i++) {
      const t0 = pod.ang - span / 2 + (i / segs) * span;
      const t1 = pod.ang - span / 2 + ((i + 1) / segs) * span;
      const mid = (t0 + t1) / 2;
      const arc = (t1 - t0) * r1;
      // outer facade
      const g = new THREE.BoxGeometry(arc + 0.04, CEIL_H, 0.14);
      g.translate(0, CEIL_H / 2, 0);
      g.rotateY(mid);
      g.translate(Math.sin(mid) * r1, 0, Math.cos(mid) * r1);
      outer.push(g);
    }
    // Pod end walls
    [pod.ang - span / 2, pod.ang + span / 2].forEach((t) => {
      const g = new THREE.BoxGeometry(0.14, CEIL_H, r1 - r0);
      g.translate(0, CEIL_H / 2, (r1 - r0) / 2);
      g.rotateY(t);
      g.translate(Math.sin(t) * r0, 0, Math.cos(t) * r0);
      outer.push(g);
    });
    const facade = cartoonMat({ color: '#F7F4EE', roughness: 0.82, metalness: 0.04 });
    mergeBucket(outer, facade);
    // Opaque window insets on the outer wall (solid, cannot see through)
    const paneMat = mat('#3F4654', { roughness: 0.35, metalness: 0.08 });
    const panes = Math.max(2, n * 2);
    for (let i = 0; i < panes; i++) {
      const u = (i + 0.5) / panes;
      const ta = pod.ang - span / 2 + u * span;
      const pane = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.15, 0.06), paneMat);
      pane.position.set(Math.sin(ta) * (r1 + 0.09), 1.55, Math.cos(ta) * (r1 + 0.09));
      pane.rotation.y = ta;
      hqRoot.add(pane);
    }

    // Colored band
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(2.2, n * 1.7), 0.16, 0.18),
      cartoonMat({ color: pod.color, emissive: pod.color, emissiveIntensity: 0.55, roughness: 0.35 }),
    );
    const br = r1 + 0.05;
    band.position.set(Math.sin(pod.ang) * br, 2.35, Math.cos(pod.ang) * br);
    band.rotation.y = pod.ang;
    hqRoot.add(band);

    const sign = makeDeptSign(pod.name, pod.color);
    sign.position.set(Math.sin(pod.ang) * (r0 - 0.25), 2.62, Math.cos(pod.ang) * (r0 - 0.25));
    sign.rotation.y = pod.ang + Math.PI;
    hqRoot.add(sign);

    // Theme exterior (kept at ground, not on the roof)
    if (pod.id === 'security') {
      const scanner = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 0.16), mat('#1C1917', { metalness: 0.5, roughness: 0.3 }));
      const r = r0 - 0.5;
      scanner.position.set(Math.sin(pod.ang) * r, 1.1, Math.cos(pod.ang) * r);
      scanner.rotation.y = pod.ang;
      hqRoot.add(scanner);
      tagPick(scanner, 'inspect', 'scanner');
    }
  });
}

function makeRadarDish(color) {
  const g = new THREE.Group();
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.7, 6), mat('#64748B', { metalness: 0.5, roughness: 0.35 }));
  arm.position.y = 0.35;
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), mat(color || '#94A3B8', { metalness: 0.4, roughness: 0.35 }));
  dish.position.y = 0.72;
  dish.rotation.x = 0.5;
  g.add(arm, dish);
  tagPick(g, 'inspect', 'radar');
  return g;
}

function buildRoofs() {
  if (!roofGroup) roofGroup = new THREE.Group();
  roofGroup.name = 'roof';
  // Plain commercial roof: flat deck, short parapet, ordinary muted colours.
  const roofMat = mat('#7A736B', { roughness: 0.92, metalness: 0.04 });
  const paraMat = mat('#5E5852', { roughness: 0.88, metalness: 0.06 });
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(RING_OUT + 0.35, RING_OUT + 0.35, 0.18, 48), roofMat);
  deck.position.y = CEIL_H + 0.1;
  deck.receiveShadow = true;
  roofGroup.add(deck);
  const parapet = new THREE.Mesh(
    new THREE.CylinderGeometry(RING_OUT + 0.42, RING_OUT + 0.42, 0.46, 48, 1, true),
    paraMat,
  );
  parapet.position.y = CEIL_H + 0.32;
  roofGroup.add(parapet);
  const cap = new THREE.Mesh(
    new THREE.TorusGeometry(RING_OUT + 0.42, 0.07, 6, 48),
    paraMat,
  );
  cap.rotation.x = Math.PI / 2;
  cap.position.y = CEIL_H + 0.55;
  roofGroup.add(cap);
  if (!roofGroup.parent) hqRoot.add(roofGroup);
}

function makeHelipadMark() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = '#FAFAFA';
  ctx.lineWidth = 10;
  ctx.beginPath(); ctx.arc(128, 128, 110, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#FAFAFA';
  ctx.font = '800 140px Inter,system-ui,sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('H', 128, 136);
  const tex = new THREE.CanvasTexture(c);
  return new THREE.Mesh(new THREE.CircleGeometry(1.2, 24), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
}

function buildSkyBridges() {
  const pods = hqLayout.pods || [];
  const glass = cartoonMat({ color: '#D7EEFF', transparent: true, opacity: 0.28, roughness: 0.06, metalness: 0.15 });
  glass.userData.alwaysTransparent = true;
  for (let i = 0; i < pods.length; i++) {
    const a = pods[i], b = pods[(i + 1) % pods.length];
    // skip the widest gap if any; connect neighbors with a chord at mid height, slightly inward
    const r = RING_IN + 1.35;
    const p1 = new THREE.Vector3(Math.sin(a.ang + a.span / 2) * r, 2.45, Math.cos(a.ang + a.span / 2) * r);
    const p2 = new THREE.Vector3(Math.sin(b.ang - b.span / 2) * r, 2.45, Math.cos(b.ang - b.span / 2) * r);
    const dir = p2.clone().sub(p1);
    const len = dir.length();
    if (len < 1.2 || len > 9) continue;
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, len, 10, 1, true), glass);
    tube.position.copy(p1).add(p2).multiplyScalar(0.5);
    tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    hqRoot.add(tube);
    tagPick(tube, 'inspect', 'sky bridge');
  }
}

function buildEntrance() {
  const z = RING_OUT + 0.4;
  const colM = mat('#F4F1EA', { roughness: 0.5 });
  const teal = cartoonMat({ color: '#14F1C9', emissive: '#14F1C9', emissiveIntensity: 1.0, roughness: 0.3 });
  const purp = cartoonMat({ color: '#9945FF', emissive: '#9945FF', emissiveIntensity: 0.7, roughness: 0.3 });
  const makeCol = (x) => {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.42, 3.4, 0.42), colM);
    c.position.set(x, 1.7, z);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.46, 3.4, 0.06), x < 0 ? teal : purp);
    t.position.set(x, 1.7, z + 0.24);
    hqRoot.add(c, t);
  };
  makeCol(-2.1); makeCol(2.1);
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.4, 0.5), colM);
  lintel.position.set(0, 3.35, z);
  const lintelTrim = new THREE.Mesh(new THREE.BoxGeometry(5.1, 0.08, 0.54), teal);
  lintelTrim.position.set(0, 3.14, z);
  hqRoot.add(lintel, lintelTrim);
  const sign = makeHqSign();
  sign.position.set(0, 3.7, z + 0.1);
  hqRoot.add(sign);
  hqSign = sign;
}

function buildParking() {
  const z0 = RING_OUT + 3.2;
  const lot = new THREE.Mesh(new THREE.BoxGeometry(26, 0.04, 14), mat('#3F3F46', { roughness: 0.92 }));
  lot.position.set(0, 0.01, z0 + 6.5);
  hqRoot.add(lot);
  const drive = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.045, 3.6), mat('#3F3F46', { roughness: 0.92 }));
  drive.position.set(0, 0.015, RING_OUT + 1.8);
  hqRoot.add(drive);
  const lineM = mat('#E7E5E4', { roughness: 0.6 });
  const bayW = 2.5, startX = -10, zA = z0 + 2.6, zB = z0 + 10.2;
  for (let i = 0; i <= 8; i++) {
    const x = startX + i * bayW;
    const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 5.0), lineM);
    l1.position.set(x, 0.035, zA);
    const l2 = l1.clone(); l2.position.set(x, 0.035, zB);
    hqRoot.add(l1, l2);
  }
  const colors = ['#1D4ED8', '#B91C1C', '#E7E5E4', '#0F172A', '#14F1C9'];
  [0, 2, 3, 6, 7].forEach((i, n) => {
    const car = makeCar(colors[n % colors.length], n % 2 ? Math.PI : 0);
    const x = startX + (i + 0.5) * bayW;
    const z = (n % 2 ? zB : zA);
    car.position.set(x, 0, z);
    hqRoot.add(car);
    tagPick(car, 'inspect', 'car');
  });
  // Trees around the ring and lot
  const treePts = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.2;
    treePts.push([Math.sin(a) * (RING_OUT + 3.2), Math.cos(a) * (RING_OUT + 3.2)]);
  }
  treePts.push([-12, z0 + 1], [12, z0 + 1], [-12, z0 + 13], [12, z0 + 13]);
  treePts.forEach(([x, z], i) => {
    if (z > RING_OUT && Math.abs(x) < 3.2) return; // keep entrance clear
    const t = makeTree(0.9 + (i % 3) * 0.15);
    t.position.set(x, 0, z);
    hqRoot.add(t);
  });
  const lampPts = [[-8, z0 + 6], [8, z0 + 6], [-5, RING_OUT + 1.2], [5, RING_OUT + 1.2]];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    lampPts.push([Math.sin(a) * (RING_OUT + 1.6), Math.cos(a) * (RING_OUT + 1.6)]);
  }
  lampPts.forEach(([x, z]) => {
    const l = makeLampPost();
    l.position.set(x, 0, z);
    hqRoot.add(l);
  });
}

function addPathSeg(arr, ax, az, bx, bz, width) {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz) || 0.01;
  const g = new THREE.BoxGeometry(width, 0.05, len + 0.15);
  g.translate(0, 0.028, 0);
  g.rotateY(Math.atan2(dx, dz));
  g.translate((ax + bx) / 2, 0, (az + bz) / 2);
  arr.push(g);
}

function buildMeadow(layout) {
  const dirt = [];
  const stone = [];
  const pods = hqLayout.pods || [];
  const byId = {};
  for (const s of layout) byId[s.id] = s;
  for (const pod of pods) {
    if (!pod.hub) continue;
    addPathSeg(dirt, 0, 0, pod.hub.x, pod.hub.z, 1.55);
    for (const id of pod.ids) {
      const spec = byId[id];
      if (!spec) continue;
      const front = doorAnchor(spec);
      addPathSeg(stone, pod.hub.x, pod.hub.z, front.x, front.z, 0.95);
    }
  }
  for (let i = 0; i < pods.length; i++) {
    const a = pods[i], b = pods[(i + 1) % pods.length];
    if (a.hub && b.hub) addPathSeg(dirt, a.hub.x, a.hub.z, b.hub.x, b.hub.z, 1.15);
  }
  mergeBucket(dirt, mat('#C4A574', { roughness: 0.95 }));
  mergeBucket(stone, mat('#C9C2B3', { roughness: 0.92 }));

  const bed = new THREE.Mesh(new THREE.CircleGeometry(2.6, 28), mat('#5F8A4A', { roughness: 0.95 }));
  bed.rotation.x = -Math.PI / 2; bed.position.y = 0.02;
  hqRoot.add(bed);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.12, 6, 28), mat('#3D8C45', { roughness: 0.9 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.16;
  hqRoot.add(ring);

  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.4, 8), mat('#6B4F3A', { roughness: 0.8 }));
  post.position.y = 1.2;
  const board = makeHqSign();
  board.position.set(0, 2.15, 0);
  const sign = new THREE.Group();
  sign.add(post, board);
  sign.position.set(0, 0, 0.2);
  tagPick(sign, 'inspect', 'entrance sign');
  hqRoot.add(sign);
  hqSign = sign;

  // A few path lamps (emissive heads only — no extra point lights).
  const lampSpots = [[0, 4.2], [0, -4.2], [4.2, 0], [-4.2, 0]];
  for (const pod of pods) {
    if (pod.hub) lampSpots.push([pod.hub.x + 0.9, pod.hub.z + 0.4]);
  }
  lampSpots.forEach(([x, z], i) => {
    if (recordMode && i > 6) return;
    const g = makeLampPost();
    if (g.userData.light) { g.remove(g.userData.light); g.userData.light = null; }
    g.position.set(x, 0, z);
    hqRoot.add(g);
  });
}

function makeHqSign() {
  const c = document.createElement('canvas');
  c.width = 768; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#F3E6C8';
  ctx.fillRect(0, 0, 768, 256);
  ctx.strokeStyle = '#6B4F3A';
  ctx.lineWidth = 14;
  ctx.strokeRect(10, 10, 748, 236);
  ctx.fillStyle = '#1C1917';
  ctx.textAlign = 'center';
  ctx.font = '800 64px Inter,system-ui,sans-serif';
  ctx.fillText('DEVAMEER BOT HQ', 384, 115);
  ctx.font = '650 32px Inter,system-ui,sans-serif';
  ctx.fillStyle = '#57534E';
  ctx.fillText('Open-air field offices', 384, 175);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 0.85, 0.08),
    cartoonMat({ color: '#F3E6C8', map: tex, roughness: 0.7 }),
  );
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.8), new THREE.MeshBasicMaterial({ map: tex }));
  face.position.z = 0.045;
  const g = new THREE.Group();
  g.add(board, face);
  return g;
}

function buildHeadquarters(w) {
  rooms.clear();
  colliders.length = 0;
  windowMats.length = 0;
  doorList.length = 0;
  lampPosts.length = 0;
  pendingInteriors.length = 0;
  fadeWalls.length = 0;
  cablesWired = false;
  roofGroup = null;
  hqCore = null;
  wallScreen = null; wallScreenTex = null; wallScreenCtx = null;
  if (hqRoot && hqRoot.parent) hqRoot.parent.remove(hqRoot);
  hqRoot = new THREE.Group();
  hqRoot.name = 'DevameerField';
  scene.add(hqRoot);

  const carpetMat = mat('#CFA56A', { roughness: 0.88, metalness: 0.02 });
  const grassMat = mat('#6FBF62', { roughness: 0.95 });
  hqMats = { carpet: carpetMat, grass: grassMat, plaza: mat('#C9C2B3', { roughness: 0.92 }) };

  const buckets = { carpet: [] };
  const layout = hqLayout();
  buildMeadow(layout);

  const nodeById = {};
  for (const n of (w.nodes || [])) nodeById[n.id] = n;
  for (const spec of layout) {
    const node = nodeById[spec.id];
    if (node) furnishOffice(spec, node, buckets);
  }
  mergeBucket(buckets.carpet, carpetMat);

  buildCity();
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
  const wood = cartoonMat({ color: '#C4A574', map: woodMap(), roughness: 0.55, metalness: 0.04 });
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

const ISO_AZI = 0.62;
const ISO_PHI_FAR = 0.96;
const ISO_PHI_NEAR = 1.22;
const ISO_CITY_DIST = 44;
const CITY_PAN_LIMIT = 118;

function isoOffset(dist) {
  const r = Math.max(0.08, dist);
  const t = Math.max(0, Math.min(1, (42 - r) / 36));
  const s = t * t * (3 - 2 * t);
  const phi = ISO_PHI_FAR + (ISO_PHI_NEAR - ISO_PHI_FAR) * s;
  return new THREE.Vector3().setFromSpherical(new THREE.Spherical(r, phi, ISO_AZI));
}

function viewOffset(dist) {
  const r = Math.max(0.08, dist);
  let dir;
  if (camera && controls) dir = camera.position.clone().sub(controls.target);
  if (!dir || dir.length() < 0.05) dir = new THREE.Vector3(0.55, 0.55, 0.85);
  if (dir.y < 0.1) dir.y = 0.1;
  dir.normalize();
  return dir.multiplyScalar(r);
}

function clampCamBounds() {
  if (!camera || !controls) return;
  const tgt = controls.target;
  const lim = CITY_PAN_LIMIT;
  const pr = Math.hypot(tgt.x, tgt.z);
  if (pr > lim) {
    tgt.x *= lim / pr;
    tgt.z *= lim / pr;
  }
  if (tgt.y < 0.12) tgt.y = 0.12;
  if (camera.position.y < 0.32) camera.position.y = 0.32;
}

function applyIsoRig() {
  // Starting-angle helper only; never locks azimuth while the user orbits.
  clampCamBounds();
}

function frameIso(target, dist, instant) {
  const tgt = target.clone ? target.clone() : new THREE.Vector3(target.x, target.y, target.z);
  const pos = tgt.clone().add(isoOffset(dist));
  if (instant || !camera) {
    camera.position.copy(pos);
    if (controls) { controls.target.copy(tgt); controls.update(); }
    else camera.lookAt(tgt);
    fly = null;
  } else {
    startFly(pos, tgt, 0.9);
  }
  return { pos, target: tgt };
}

const city = {
  root: null,
  cars: null,
  carN: 0,
  carPaths: [],
  carT: [],
  carSpeed: [],
  winMat: null,
  lampMat: null,
  signalMats: [],
  signalPhase: 0,
};

function campusClear(x, z, pad) {
  const p = pad || 0;
  if (Math.hypot(x, z) < 34 + p) return true;
  for (const r of rooms.values()) {
    if (Math.hypot(x - r.cx, z - r.cz) < 5.2 + p) return true;
  }
  return false;
}

function buildCity() {
  if (!scene) return;
  if (city.root && city.root.parent) city.root.parent.remove(city.root);
  city.root = new THREE.Group();
  city.root.name = 'Field';
  scene.add(city.root);
  city.cars = null;
  city.carN = 0;
  city.carNFull = 0;
  city.hats = null;
  city.sigs = null;
  city.winMat = null;
  city.signalMats = [];

  const grassMat = mat('#6FBF62', { roughness: 0.96 });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(165, 64), grassMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.07;
  ground.receiveShadow = true;
  city.root.add(ground);
  city.grassMats = [grassMat];
  if (hqMats.grass) city.grassMats.push(hqMats.grass);

  // Rolling hills only — no buildings, streets, or skyline.
  const hillMat = mat('#5FAA55', { roughness: 0.96 });
  city.hillMat = hillMat;
  city.grassMats.push(hillMat);
  const hillGeo = new THREE.SphereGeometry(1, 10, 7);
  const hillN = recordMode ? 9 : 14;
  const hills = new THREE.InstancedMesh(hillGeo, hillMat, hillN);
  const dummy = new THREE.Object3D();
  let hi = 0;
  for (let i = 0; i < hillN * 3 && hi < hillN; i++) {
    const ang = (i * 2.4) + 0.35;
    const rad = 52 + (i % 5) * 8;
    const x = Math.sin(ang) * rad, z = Math.cos(ang) * rad;
    if (campusClear(x, z, 16)) continue;
    dummy.position.set(x, 0.2, z);
    dummy.scale.set(12 + (i % 5) * 3.2, 3.2 + (i % 4) * 1.6, 12 + ((i * 3) % 5) * 2.4);
    dummy.rotation.set(0, ang, 0);
    dummy.updateMatrix();
    hills.setMatrixAt(hi, dummy.matrix);
    hi += 1;
  }
  hills.count = hi;
  city.hills = hills;
  city.hillN = hi;
  city.root.add(hills);

  const trunkMat = mat('#A35A2A', { roughness: 0.9 });
  const leafMat = mat('#3DDC84', { roughness: 0.9 });
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.26, 1.35, 6);
  const leafGeo = new THREE.SphereGeometry(0.95, 8, 6);
  const treePos = [];
  let seed = 1337;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < 90; i++) {
    const ang = rnd() * Math.PI * 2;
    const rad = 14 + rnd() * 70;
    const x = Math.sin(ang) * rad, z = Math.cos(ang) * rad;
    if (campusClear(x, z, 2.4)) continue;
    if (Math.hypot(x, z) < 8) continue;
    treePos.push({ x, z, s: 0.85 + rnd() * 0.45 });
  }
  if (recordMode) treePos.splice(28);
  if (treePos.length) {
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treePos.length);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, treePos.length);
    treePos.forEach((tr, i) => {
      dummy.position.set(tr.x, 0.65, tr.z);
      dummy.scale.set(tr.s, tr.s, tr.s);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.set(tr.x, 1.55 * tr.s, tr.z);
      dummy.scale.set(tr.s * 1.1, tr.s * 0.95, tr.s * 1.1);
      dummy.updateMatrix();
      leaves.setMatrixAt(i, dummy.matrix);
    });
    trunks.userData.pick = 'inspect';
    trunks.userData.pickLabel = 'Tree';
    leaves.userData.pick = 'inspect';
    leaves.userData.pickLabel = 'Tree';
    city.trunks = trunks;
    city.leaves = leaves;
    city.treeN = treePos.length;
    city.root.add(trunks, leaves);
  }

  // A few sitting rocks — still not buildings.
  const rockMat = mat('#9A9488', { roughness: 0.95 });
  for (let i = 0; i < 8; i++) {
    const ang = i * 0.9 + 0.4;
    const rad = 30 + (i % 3) * 7;
    const x = Math.sin(ang) * rad, z = Math.cos(ang) * rad;
    if (campusClear(x, z, 3)) continue;
    const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7 + (i % 3) * 0.2, 0), rockMat);
    rk.position.set(x, 0.25, z);
    rk.scale.set(1.2, 0.55, 1);
    city.root.add(rk);
  }
}

function carPoint(path, t) {
  const n = path.length;
  const u = ((t % n) + n) % n;
  const i = Math.floor(u);
  const f = u - i;
  const a = path[i], b = path[(i + 1) % n];
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, yaw: Math.atan2(b.x - a.x, b.z - a.z) };
}

function stepCity(dt) {
  if (!city.cars) return;
  const dummy = stepCity._d || (stepCity._d = new THREE.Object3D());
  for (let i = 0; i < city.carN; i++) {
    city.carT[i] += (city.carSpeed[i] || 0.4) * (dt || 0);
    const p = carPoint(city.carPaths[i], city.carT[i]);
    dummy.position.set(p.x, 0.38, p.z);
    dummy.rotation.set(0, p.yaw, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    city.cars.setMatrixAt(i, dummy.matrix);
  }
  city.cars.instanceMatrix.needsUpdate = true;
  city.signalPhase += dt || 0;
  if (city.signalMats.length === 3) {
    const slot = Math.floor(city.signalPhase / 2.2) % 3;
    city.signalMats[0].emissiveIntensity = slot === 0 ? 1.1 : 0.08;
    city.signalMats[1].emissiveIntensity = slot === 1 ? 1.0 : 0.08;
    city.signalMats[2].emissiveIntensity = slot === 2 ? 1.1 : 0.08;
  }
}

function applyCityTod(P) {
  if (!P) return;
  if (city.grassMats) {
    for (const m of city.grassMats) {
      if (m && P.grass) m.color.set(P.grass);
    }
  }
  if (city.hillMat && P.grass) city.hillMat.color.set(P.grass);
  if (city.lampMat) city.lampMat.emissiveIntensity = 0.12 + (P.post || 0) * 1.7;
}

function defaultCamera() {
  const tgt = new THREE.Vector3(0, 0.85, 0);
  camera.position.copy(tgt).add(isoOffset(ISO_CITY_DIST));
  camera.lookAt(tgt);
  if (controls) { controls.target.copy(tgt); controls.update(); }
}

function buildScene(w) {
  const wrap = document.getElementById('wrap');
  const canvas = document.getElementById('cv3d');
  if (!wrap || !canvas) throw new Error('3D canvas missing');

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#0B0B0D');
  scene.fog = new THREE.Fog('#0B0B0D', 48, 180);

  camera = new THREE.PerspectiveCamera(48, 1, 0.02, 560);
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: !isMob(), alpha: false, powerPreference: 'high-performance',
  });
  renderer.setClearColor('#0B0B0D', 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  const pr = desiredPixelRatio();
  renderer.setPixelRatio(pr);

  controls = new MapControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.16;
  controls.enablePan = true;
  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.autoRotate = false;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  controls.rotateSpeed = 0.72;
  controls.panSpeed = 1.15;
  controls.zoomSpeed = 1.2;
  controls.minDistance = 0.08;
  controls.maxDistance = 220;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = Math.PI / 2 + 0.12;
  controls.minAzimuthAngle = -Infinity;
  controls.maxAzimuthAngle = Infinity;
  controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
  controls.touches.ONE = THREE.TOUCH.ROTATE;
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  controls.target.set(0, 1.35, 2.2);
  controls.update();
  bindOfficePointer(canvas);

  hemiLight = new THREE.HemisphereLight(0x8a97b5, 0x1a1210, 0.95);
  keyLight = new THREE.DirectionalLight(0xfff2e0, 1.35);
  keyLight.position.set(10, 16, 12);
  keyLight.castShadow = !isMob() && !isWeak();
  const shadowRes = isWeak() || isMob() ? 512 : 1024;
  keyLight.shadow.mapSize.set(shadowRes, shadowRes);
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
  renderer.shadowMap.enabled = !isMob() && !isWeak();
  renderer.shadowMap.type = THREE.PCFShadowMap;

  makeGeos();
  floor = null;
  gridHelper = null;
  vignette = null;
  clickables.length = 0;
  desks.clear();
  setLoadProgress(12, 'Building HQ…');
  buildHeadquarters(w);
  setLoadProgress(48, 'Lighting the campus…');

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
  userFx = preferredFx();
  applyFxLevel(userFx);
  resizeFx();
  setLoadProgress(55, 'Furnishing offices…');
}

function wireCables() {
  if (cablesWired) return;
  const w = world();
  if (!w) return;
  for (const c of cables) {
    if (c.line && c.line.parent) c.line.parent.remove(c.line);
    if (c.line && c.line.geometry) try { c.line.geometry.dispose(); } catch {}
  }
  cables.length = 0;
  for (const e of (w.edges || [])) {
    const a = desks.get(e.from), b = desks.get(e.to);
    if (!a || !b) continue;
    const curve = trayCurve(e.from, e.to);
    if (!curve) continue;
    const pts = curve.getPoints(24);
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const col = new THREE.Color(a.color || '#3B82F6');
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.42 }));
    scene.add(line);
    cables.push({ id: e.id || (e.from + '-' + e.to), from: e.from, to: e.to, curve, color: col, line, heat: 0 });
  }
  cablesWired = true;
}

function stepFurnish() {
  const total = pendingInteriors.length + desks.size;
  if (!pendingInteriors.length) {
    if (!cablesWired) wireCables();
    if (!loadDone && built) {
      setLoadProgress(100, 'Ready', true);
      maybeStartDeepLink();
    }
    return;
  }
  const n = Math.min(3, pendingInteriors.length);
  for (let i = 0; i < n; i++) {
    const it = pendingInteriors.shift();
    try { furnishOfficeInterior(it.spec, it.node); } catch (e) { console.warn('furnish', it && it.spec && it.spec.id, e); }
  }
  const done = desks.size;
  const left = pendingInteriors.length;
  const denom = Math.max(1, total || (done + left));
  setLoadProgress(55 + (done / denom) * 40, 'Furnishing offices… ' + done + '/' + denom);
  if (!left) {
    wireCables();
    fillJumpMenu();
    setLoadProgress(100, 'Ready', true);
    maybeStartDeepLink();
  }
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
  if (d.anim.mode === 'work' || d.anim.mode === 'celebrate' || d.anim.mode === 'shake' || d.anim.mode === 'walk' || d.anim.mode === 'sigh' || d.anim.mode === 'scratch') {
    if (now < d.anim.until) return;
  }
  if (now < (d.nextIdle || 0)) return;
  const hid = hashId(d.id);
  const acts = ['stretch', 'sip', 'lookAway', 'yawn', 'phone', 'lean', 'stretch', 'sip', 'walk'];
  const pick = acts[Math.floor((now / 97 + hid) % acts.length)];
  const dur = pick === 'walk' ? 6200 : (pick === 'sip' || pick === 'phone' ? 2000 : 1500);
  d.anim = { mode: pick, until: now + dur, started: now, evType: '', look: '' };
  d.nextIdle = now + 4500 + (hid % 8000) + Math.random() * 4000;
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
  let lLegX = Math.PI / 2 - 0.15, rLegX = Math.PI / 2 - 0.15;
  let lLegLow = -Math.PI / 2 + 0.1, rLegLow = -Math.PI / 2 + 0.1;
  let seated = true;
  // Natural look stays on this agent's own screen (tiny saccades), never at another agent.
  headY = Math.sin(t * 0.55 + hid) * 0.04;
  headZ = Math.sin(t * 0.31 + hid * 0.2) * 0.02;

  if (a.mode === 'work' && now < a.until) {
    const typ = Math.sin(t * 22 + hid);
    lArm.x = -0.95 + typ * 0.08;
    rArm.x = -0.95 - typ * 0.08;
    lLow = -1.15 + typ * 0.16;
    rLow = -1.15 - typ * 0.16;
    headX = 0.28 + typ * 0.03;
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
  } else if (a.mode === 'lookAway' && now < a.until) {
    const k = Math.sin(((now - a.started) / Math.max(1, a.until - a.started)) * Math.PI);
    headY = (hid % 2 ? 1 : -1) * 0.38 * k;
    headX = 0.06;
  } else if (a.mode === 'sigh' && now < a.until) {
    const k = Math.sin(((now - a.started) / Math.max(1, a.until - a.started)) * Math.PI);
    headX = 0.16 + 0.28 * k;
    bodyX = 0.04 + 0.16 * k;
    bodyY -= 0.03 * k;
    lArm.x = -0.7; rArm.x = -0.7;
  } else if (a.mode === 'walk' && now < a.until && d.bot && d.homePos && d.doorPos) {
    seated = false;
    const u = (now - a.started) / Math.max(1, a.until - a.started);
    let dest, rising = 0, walking = 0;
    if (u < 0.12) { dest = d.homePos; rising = u / 0.12; }
    else if (u < 0.42) { const k = (u - 0.12) / 0.3; dest = d.homePos.clone().lerp(d.doorPos, k); walking = 1; rising = 1; }
    else if (u < 0.58) { dest = d.doorPos; rising = 1; }
    else if (u < 0.88) { const k = (u - 0.58) / 0.3; dest = d.doorPos.clone().lerp(d.homePos, k); walking = 1; rising = 1; }
    else { dest = d.homePos; rising = 1 - (u - 0.88) / 0.12; }
    const hy = d.homePos.y;
    d.bot.position.set(dest.x, hy * (1 - Math.max(0, Math.min(1, rising))), dest.z);
    const toDoor = d.doorPos.clone().sub(d.homePos);
    if (u >= 0.12 && u < 0.88) d.bot.rotation.y = Math.atan2(toDoor.x, toDoor.z) + (u >= 0.58 ? Math.PI : 0);
    else d.bot.rotation.y = 0;
    const step = walking ? Math.sin(t * 9 + hid) : 0;
    lLegX = 0.08 + step * 0.45 * walking;
    rLegX = 0.08 - step * 0.45 * walking;
    lLegLow = 0.1 + Math.max(0, -step) * 0.25 * walking;
    rLegLow = 0.1 + Math.max(0, step) * 0.25 * walking;
    bodyY = 0.56 + (0.38 * Math.max(0, Math.min(1, rising))) + breathe;
    lArm = { x: -0.15 - step * 0.35 * walking, y: 0.05, z: 0.12 };
    rArm = { x: -0.15 + step * 0.35 * walking, y: -0.05, z: -0.12 };
    lLow = -0.2; rLow = -0.2;
    headX = 0.06;
    if (p.lLeg) { p.lLeg.position.y = 0.42 * (1 - Math.max(0, Math.min(1, rising))); p.rLeg.position.y = p.lLeg.position.y; }
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
  if (p.lLeg && p.rLeg) {
    p.lLeg.rotation.x = lLegX;
    p.rLeg.rotation.x = rLegX;
    if (p.lLeg.userData.lower) p.lLeg.userData.lower.rotation.x = lLegLow;
    if (p.rLeg.userData.lower) p.rLeg.userData.lower.rotation.x = rLegLow;
    if (seated) { p.lLeg.position.y = 0.42; p.rLeg.position.y = 0.42; }
  }
  if (seated && d.bot && d.homePos && a.mode !== 'walk') {
    d.bot.position.lerp(d.homePos, Math.min(1, (dt || 0.016) * 6));
    d.bot.rotation.y *= Math.max(0, 1 - (dt || 0.016) * 6);
  }
  if (d.sit) d.sit.rotation.y = 0;
  const blink = ((now + hid) % 4200) < 120;
  const es = blink ? 0.12 : 1;
  p.eyeL.scale.y = es; p.eyeR.scale.y = es;
  if (p.browL && p.browR) {
    let arch = 0.12;
    if (a.mode === 'shake') arch = 0.32;
    else if (a.mode === 'yawn' || a.mode === 'celebrate') arch = 0.22;
    else if (a.mode === 'work') arch = 0.08;
    p.browL.rotation.z = arch + 0.02;
    p.browR.rotation.z = -arch - 0.02;
  }
  if (p.mouth) {
    let open = 0.22;
    if (a.mode === 'yawn' && now < a.until) {
      const k = Math.sin(((now - a.started) / Math.max(1, a.until - a.started)) * Math.PI);
      open = 0.2 + 0.9 * k;
    } else if (a.mode === 'work' && now < a.until) {
      open = 0.18 + Math.abs(Math.sin(t * 14 + hid)) * 0.22;
    } else if (a.mode === 'sip' && now < a.until) {
      open = 0.08;
    } else if (a.mode === 'celebrate') {
      open = 0.45 + Math.abs(Math.sin(t * 8)) * 0.2;
    }
    p.mouth.scale.y = open;
    if (p.mouthFill) p.mouthFill.scale.y = Math.max(0.15, open);
  }
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
  const cab = from ? cables.find((c) => c.from === from && c.to === id) : null;
  if (cab) {
    d.pendingEv = { celebrate, shake, type };
    spawnPacket(cab, ev, from);
    return;
  }
  if (celebrate) { d.anim = { mode: 'celebrate', until: now + 1400, started: now, evType: type }; playCheer(d); }
  else if (shake && (type === 'reject' || type === 'error')) { d.anim = { mode: 'scratch', until: now + 1400, started: now, evType: type }; playNope(d); }
  else if (shake) { d.anim = { mode: 'sigh', until: now + 1600, started: now, evType: type }; playNope(d); }
  else { d.anim = { mode: 'work', until: now + 2200, started: now, evType: type }; }
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
  const pending = dest.pendingEv || {};
  dest.pendingEv = null;
  if (pending.celebrate) { dest.anim = { mode: 'celebrate', until: now + 1400, started: now, evType: pending.type || 'buy' }; playCheer(dest); }
  else if (pending.shake && (pending.type === 'reject' || pending.type === 'error')) { dest.anim = { mode: 'scratch', until: now + 1400, started: now, evType: pending.type || 'reject' }; playNope(dest); }
  else if (pending.shake) { dest.anim = { mode: 'sigh', until: now + 1600, started: now, evType: pending.type || 'loss' }; playNope(dest); }
  else { dest.anim = { mode: 'work', until: now + 2200, started: now, evType: pending.type || 'incoming' }; }
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
  const cam = camera && camera.position;
  const cy = cam ? cam.y : 10;
  const wallMs = autoTier >= 1 ? 1000 : 500;
  if (wallScreenCtx && Math.floor(now / wallMs) !== Math.floor((stepScreens._wall || 0) / wallMs)) {
    paintWallScreen();
    stepScreens._wall = now;
  }
  for (const [id, d] of desks) {
    if (!d || !d.scr) continue;
    const room = rooms.get(id);
    if (room && room.interior && room.interior.visible === false) continue;
    let dist = 99;
    if (cam && room) dist = Math.hypot(cam.x - room.cx, cam.z - room.cz);
    else if (cam && d.root) dist = d.root.position.distanceTo(cam);
    const far = (room && room.far) || dist > 18 || cy > 8;
    const minGap = recordMode ? 500 : (far ? 200 : (dist > 9 ? 140 : 70));
    if (now - (d.lastPaint || 0) < minGap) continue;
    const mode = agentMode(id, now);
    setStatusColor(d.light, mode);
    const rows = lastRowsFor(id, w);
    d.scr.title = (d.name || id) + ' · ' + (d.role || '');
    d.scr.role = d.role || '';
    d.scr.name = d.name;
    d.scr.agentId = id;
    d.scr.id = id;
    const last = rows[rows.length - 1];
    const blink = (!far && dist < 8) ? (Math.floor(now / 500) % 2) : 0;
    const key = (last ? (last.at + '|' + last.text) : 'empty') + '|' + mode + '|' + (d.scr.flashUntil && now < d.scr.flashUntil ? 'f' : '') + '|' + blink;
    if (key !== d.lastScreen) {
      paintDeskScreens(d, rows, mode, now);
      d.lastScreen = key;
    }
    d.lastPaint = now;
  }
}

function step(now, dt) {
  if (!built) return;
  stepFurnish();
  stepFly(dt);
  if (controls && !fly) { controls.update(); clampCamBounds(); }
  for (const d of desks.values()) {
    pickIdle(d, now);
    applyAnim(d, now, dt);
  }
  stepPackets(dt);
  stepCables(dt);
  stepScreens(now);
  stepAudio(now, dt);
  updateOcclusion(dt);
  stepHQ(dt);
  stepCity(dt);
  stepTour(dt);
  stepRecordTour(dt);
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
  const pr = desiredPixelRatio();
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
    resizeFx();
}

function loop(ts) {
  if (!active) { raf = 0; return; }
  if (hidden) { raf = requestAnimationFrame(loop); return; }
  if (!lastT) lastT = ts;
  const raw = (ts - lastT) / 1000;
  if (recordMode && raw < (1 / 30) - 0.001) {
    raf = requestAnimationFrame(loop);
    return;
  }
  const dt = Math.min(0.05, raw || 0.033);
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
    setLoadProgress(4, 'Starting 3D engine…');
    try { buildScene(w); }
    catch (e) { console.warn('3D office failed, staying on 2D', e); setLoadProgress(0, '3D unavailable', true); return false; }
  }
  // Never tear down a live campus just because interiors are still streaming in.
  // Rebuilding mid-session was freezing Offices/Jump after the first room.
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
  pendingInteriors.length = 0;
  fadeWalls.length = 0;
  cablesWired = false;
  loadDone = false;
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
    setTod(todChoice, true);
    fillJumpMenu();
    if (recordMode) applyRecordMode(true);
    maybeStartDeepLink();
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
    record: recordMode, recordTour: recordTour.on, recordIndex: recordTour.index, recordPhase: recordTour.phase, recordLoop, recordSecs,
    room: closeOn, roomName: closeOn ? tourNameFor(closeOn) : null,
    cam: (function () {
      if (!camera || !controls) return null;
      const off = camera.position.clone().sub(controls.target);
      const sph = new THREE.Spherical().setFromVector3(off);
      return {
        azi: +sph.theta.toFixed(4), phi: +sph.phi.toFixed(4), dist: +sph.radius.toFixed(3),
        x: +camera.position.x.toFixed(3), y: +camera.position.y.toFixed(3), z: +camera.position.z.toFixed(3),
        tx: +controls.target.x.toFixed(3), ty: +controls.target.y.toFixed(3), tz: +controls.target.z.toFixed(3),
      };
    })(),
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
  morning: { ui: 'light', bg: '#F4C9A0', fog: '#F0C8A0', fogN: 46, fogF: 175, hemiS: 0xFFD9B0, hemiG: 0xC9B8A4, hemi: 1.05, sun: 0xFFB36B, sunI: 1.2, sunP: [24, 7, 2], fill: 0.32, rim: 0.18, exp: 1.1, win: '#F0C9A0', winE: 0.55, lamp: 0.12, post: 0, stars: 0, clouds: 0.75, grass: '#7B9A5C', plaza: '#E8E4DC' },
  afternoon: { ui: 'light', bg: '#9ED8FF', fog: '#B8E0FF', fogN: 62, fogF: 210, hemiS: 0xF3F6FF, hemiG: 0xC9B8A4, hemi: 1.2, sun: 0xFFF5E6, sunI: 1.85, sunP: [8, 24, 12], fill: 0.45, rim: 0.22, exp: 1.18, win: '#8EC4F0', winE: 0.45, lamp: 0, post: 0, stars: 0, clouds: 1, grass: '#7B9A5C', plaza: '#E8E4DC' },
  night: { ui: 'dark', bg: '#0B1020', fog: '#0B1020', fogN: 30, fogF: 145, hemiS: 0x1A2744, hemiG: 0x0A0C12, hemi: 0.28, sun: 0xC9D6FF, sunI: 0.28, sunP: [-12, 16, -8], fill: 0.12, rim: 0.35, exp: 0.95, win: '#3B5A9A', winE: 0.9, lamp: 0.7, post: 0.95, stars: 1, clouds: 0.1, grass: '#1F2A1A', plaza: '#2A2A2E' },
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
  applyCityTod(P);
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
  const prev = (todTo && todT < 1) ? lerpPreset(todFrom, todTo, todT) : (TOD[todMode] || preset);
  todMode = mode;
  themeName = preset.ui;
  document.documentElement.setAttribute('data-theme', preset.ui);
  updateTodUi();
  if (instant !== false) {
    todFrom = preset; todTo = preset; todT = 1;
    applyTodLighting(preset);
  } else {
    todFrom = prev; todTo = preset; todT = 0.28;
    applyTodLighting(lerpPreset(todFrom, todTo, 0.28));
  }
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
  if (TOD[todMode]) applyTodLighting(TOD[todMode]);
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
  const dist = tight ? 1.65 : 2.35;
  const pos = target.clone().add(viewOffset(dist));
  return { pos, target };
}

function doorFocus(d) {
  if (!d) return null;
  const room = rooms.get(d.id);
  const root = (d.officeRoot && d.officeRoot.parent) || d.officeRoot || d.root;
  if (root && room) {
    // 3/4 view from the open path side: agent, dual screens, rug, and sign in frame.
    const pos = new THREE.Vector3(1.85, 1.52, -((room.d || ROOM_D) / 2) + 0.15);
    const target = new THREE.Vector3(0.05, 0.98, 0.32);
    if (d.screen) {
      d.screen.getWorldPosition(target);
      if (target.y < 0.8) target.y = 1.12;
    } else {
      root.localToWorld(target);
    }
    root.localToWorld(pos);
    return { pos, target };
  }
  return monitorFocus(d, true);
}

function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

function startFly(toPos, toTarget, dur) {
  if (!camera || !controls) return;
  fly = null;
  fly = {
    fromPos: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPos: toPos.clone(),
    toTarget: toTarget.clone(),
    t: 0,
    dur: Math.max(0.05, dur == null ? 0.85 : dur),
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
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const force = !!(opts && opts.force);
  if (!force && now < flyLockUntil && closeOn === id) return true;
  flyLockUntil = now + 220;
  fly = null;
  if (!closeOn && camera && controls) {
    overviewShot = { pos: camera.position.clone(), target: controls.target.clone() };
  }
  const useDoor = !opts || opts.door !== false;
  const tight = !opts || opts.readable !== false;
  const shot = useDoor ? (doorFocus(d) || monitorFocus(d, tight)) : monitorFocus(d, tight);
  closeOn = id;
  if (opts && opts.instant) {
    camera.position.copy(shot.pos);
    controls.target.copy(shot.target);
    controls.update();
    fly = null;
    clampCamBounds();
    if (typeof updateOcclusion === 'function') updateOcclusion(1);
  } else {
    startFly(shot.pos, shot.target, (opts && opts.dur) || 0.85);
  }
  updateOverviewBtn();
  return true;
}

function flyOverview(opts) {
  inspectObj = null; inspectPrev = null;
  closeOn = null;
  if (typeof updateInspectBtn === 'function') updateInspectBtn();
  if (overviewShot && overviewShot.pos && overviewShot.target) {
    if (opts && opts.instant) {
      camera.position.copy(overviewShot.pos);
      controls.target.copy(overviewShot.target);
      controls.update();
      fly = null;
    } else startFly(overviewShot.pos, overviewShot.target, (opts && opts.dur) || 0.9);
  } else {
    frameIso(new THREE.Vector3(0, 0.85, 0), ISO_CITY_DIST, opts && opts.instant);
  }
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

function closeOfficePanel() {
  const panel = document.getElementById('officePanel');
  const btn = document.getElementById('officeListBtn');
  if (panel) panel.classList.add('hidden');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function bindOfficeList() {
  const btn = document.getElementById('officeListBtn');
  const panel = document.getElementById('officePanel');
  const dock = document.getElementById('officeDock');
  if (btn && !btn._bound) {
    btn._bound = true;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const open = panel && panel.classList.contains('hidden');
      if (panel) panel.classList.toggle('hidden', !open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  if (panel && !panel._delegated) {
    panel._delegated = true;
    panel.addEventListener('click', (ev) => {
      const item = ev.target && ev.target.closest && ev.target.closest('.office-item');
      if (!item || !panel.contains(item)) return;
      ev.preventDefault();
      ev.stopPropagation();
      const id = item.dataset && item.dataset.id;
      if (id) flyToAgent(id, { force: true, door: true });
      closeOfficePanel();
    });
  }
  if (dock && !dock._outside) {
    dock._outside = true;
    document.addEventListener('pointerdown', (e) => {
      if (!dock || !panel || panel.classList.contains('hidden')) return;
      if (dock.contains(e.target)) return;
      closeOfficePanel();
    });
  }
}

function jumpSignature() {
  const w = world();
  if (!w || !w.nodes) return '';
  return w.nodes.map((n) => (n.id + ':' + (n.name || '') + ':' + (n.role || ''))).join('|');
}

function fillJumpMenu() {
  const sel = document.getElementById('agentJump');
  const panel = document.getElementById('officePanel');
  const w = world();
  if (!w || !w.nodes) return;
  bindOfficeList();
  const sig = jumpSignature();
  if (sig && sig === jumpMenuSig && panel && panel.childNodes.length) return;
  jumpMenuSig = sig;
  const byId = {};
  for (const n of w.nodes) byId[n.id] = n;
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = '<option value="">Office…</option>';
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
  if (panel) {
    panel.innerHTML = '';
    for (const dept of DEPTS) {
      const h = document.createElement('div');
      h.className = 'office-dept';
      h.textContent = dept.name;
      panel.appendChild(h);
      for (const id of dept.ids) {
        const n = byId[id];
        if (!n) continue;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'office-item';
        b.setAttribute('role', 'menuitem');
        b.dataset.id = id;
        const strong = document.createElement('strong');
        strong.textContent = n.name || id;
        const span = document.createElement('span');
        span.textContent = n.role || '';
        b.appendChild(strong);
        b.appendChild(span);
        panel.appendChild(b);
      }
    }
  }
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
  const pos = center.clone().add(viewOffset(dist));
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
  if (city && city.root) roots.push(city.root);
  for (const d of desks.values()) if (d.root) roots.push(d.root);
  if (floor) roots.push(floor);
  const hits = raycaster.intersectObjects(roots, true);
  if (!hits.length) return null;
  const hit = hits[0];
  let instancePos = null, instanceSize = null;
  if (hit.object && hit.object.isInstancedMesh && hit.instanceId != null) {
    const mm = new THREE.Matrix4();
    hit.object.getMatrixAt(hit.instanceId, mm);
    instancePos = new THREE.Vector3();
    const rq = new THREE.Quaternion();
    instanceSize = new THREE.Vector3();
    mm.decompose(instancePos, rq, instanceSize);
  }
  let o = hit.object, pick = o.userData && o.userData.pick, agentId = o.userData && o.userData.agentId, label = o.userData && o.userData.pickLabel;
  let walk = o;
  while (walk) {
    if (!agentId && walk.userData && walk.userData.agentId) agentId = walk.userData.agentId;
    if (!pick && walk.userData && walk.userData.pick) { pick = walk.userData.pick; label = walk.userData.pickLabel; o = walk; }
    walk = walk.parent;
  }
  if (!pick) pick = instancePos ? 'inspect' : 'ground';
  return { hit, object: o, pick, agentId, label, point: hit.point, instancePos, instanceSize };
}

function bindOfficePointer(canvas) {
  if (!canvas || canvas._officeBound) return;
  canvas._officeBound = true;
  raycaster = new THREE.Raycaster();
  const onDown = (e) => {
    pointerDown = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  };
  const onUp = (e) => {
    if (!pointerDown || e.pointerId !== pointerDown.id) return;
    const dx = e.clientX - pointerDown.x, dy = e.clientY - pointerDown.y;
    const dt = performance.now() - pointerDown.t;
    const down = pointerDown;
    pointerDown = null;
    if (Math.hypot(dx, dy) > 8 || dt > 500 || fly) return;
    const now = performance.now();
    const dbl = (now - lastTapAt < 340 && Math.hypot(e.clientX - lastTapX, e.clientY - lastTapY) < 28);
    lastTapAt = now; lastTapX = e.clientX; lastTapY = e.clientY;
    const picked = pickFromEvent(e);
    const isObj = picked && (picked.pick === 'inspect' || picked.pick === 'agent' || picked.agentId);
    if (isObj) {
      if (picked.instancePos) flyToPoint(picked.instancePos, picked.instanceSize);
      else if (picked.pick === 'inspect') flyToObject(picked.object);
      else if (picked.agentId) flyToAgent(picked.agentId);
      return;
    }
    if (dbl) { flyOverview(); return; }
    // single tap on empty space: ease back a bit, or leave a close-up
    if (inspectObj) { exitInspect(); return; }
    easeBack();
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', () => { pointerDown = null; });
}

function easeBack() {
  if (!camera || !controls || fly) return;
  const tgt = controls.target;
  const len = camera.position.distanceTo(tgt);
  if (len < 0.05) return;
  const nextDist = Math.min(ISO_CITY_DIST, Math.max(len * 1.7, len + 6.5));
  startFly(tgt.clone().add(viewOffset(nextDist)), tgt.clone(), 0.55);
}

function flyToPoint(center, size) {
  if (!camera || !controls || !center) return false;
  if (!inspectObj && !inspectPrev) {
    inspectPrev = { pos: camera.position.clone(), target: controls.target.clone() };
  }
  const sz = size || new THREE.Vector3(2, 2, 2);
  const maxDim = Math.max(sz.x, sz.y, sz.z, 0.4);
  const fov = (camera.fov * Math.PI) / 180;
  const dist = Math.max(0.8, (maxDim * 0.7) / Math.tan(fov / 2) * 1.15);
  const tgt = center.clone();
  if (tgt.y < 0.2) tgt.y = 0.2;
  inspectObj = { position: tgt };
  closeOn = null;
  startFly(tgt.clone().add(viewOffset(dist)), tgt, 0.7);
  updateInspectBtn();
  updateOverviewBtn();
  return true;
}

function inCampus(x, z) {
  return Math.hypot(x, z) < 36;
}

function updateOcclusion(dt) {
  if (!camera || !controls) return;
  const cam = camera.position, tgt = controls.target;
  if (cam.y < 0.32) cam.y = 0.32;
  if (tgt.y < 0.12) tgt.y = 0.12;
}

function onKey(e) {
  if (e.key === 'Escape' && active) {
    if (inspectObj) { exitInspect(); return; }
    if (tourOn) { setTour(false); return; }
    if (recordTour.on) { stopRecordTour(); return; }
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
  try {
    const saved = localStorage.getItem('devameer-flow-fx');
    if (saved === 'high' || saved === 'low' || saved === 'off') return saved;
  } catch {}
  return (isMob() || isWeak()) ? 'low' : 'high';
}

function setupImmersion() {
  setupComposer(renderer, false);
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

function applyFxLevel(level, fromAuto) {
  if (recordMode && !fromAuto) {
    applyRecordMode(true);
    return;
  }
  const allowed = { high: 1, low: 1, off: 1 };
  const next = allowed[level] ? level : 'high';
  if (!fromAuto) {
    userFx = next;
    fxLevel = next;
    autoTier = 0;
    try { localStorage.setItem('devameer-flow-fx', fxLevel); } catch {}
  } else {
    fxLevel = next;
  }
  const high = fxLevel === 'high';
  const on = !recordMode && fxLevel !== 'off';
  if (bloomPass) {
    const bloomOn = on && high && !isMob() && !isWeak() && autoTier < 1;
    bloomPass.enabled = bloomOn;
    bloomPass.strength = 0.4;
    bloomPass.threshold = 0.76;
  }
  const useShadow = on && !isMob() && !isWeak() && autoTier < 2;
  if (renderer) {
    renderer.shadowMap.enabled = useShadow;
    if (keyLight) keyLight.castShadow = useShadow;
  }
  if (TOD[todMode]) applyTodLighting(TOD[todMode]);
  applyPixelRatio();
  const btn = document.getElementById('fxToggle');
  if (btn) {
    const label = autoTier > 0 && userFx !== 'off' ? ('FX Auto') : ('FX ' + (userFx === 'off' ? 'Off' : (userFx === 'low' ? 'Low' : 'On')));
    btn.textContent = label;
    btn.setAttribute('aria-label', 'Effects: ' + (autoTier > 0 ? 'auto' : userFx));
  }
}

function cycleFx() {
  applyFxLevel(userFx === 'high' ? 'low' : (userFx === 'low' ? 'off' : 'high'));
}

function autoQuality(dt) {
  if (recordMode) return;
  if (userFx === 'off') return;
  if (fps && fps < 40) fpsLowFor += dt;
  else fpsLowFor = Math.max(0, fpsLowFor - dt * 0.6);
  if (fpsLowFor > 1.4) {
    fpsLowFor = 0;
    if (autoTier < 3) {
      autoTier += 1;
      if (autoTier === 1) applyFxLevel(userFx === 'high' ? 'low' : 'off', true);
      else applyFxLevel('off', true);
    }
  }
}

function flashScreen() {}

function renderFrame(which) {
  const useCap = which === 'cap';
  const r = useCap ? capRenderer : renderer;
  if (!r) return;
  const comp = useCap ? capComposer : composer;
  if (!recordMode && fxLevel !== 'off' && comp) {
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
  walkOn = false;
  return;
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
      clampUnderRoof(camera.position);
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
  clampUnderRoof(camera.position);
  resolveWalk(prev);
}

function setTour(on) {
  tourOn = !!on;
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
  const pr = desiredPixelRatio();
  if (composer) composer.setSize(w, h);
  if (bloomPass && bloomPass.setSize) bloomPass.setSize(w * pr, h * pr);
  if (ssaoPass && ssaoPass.setSize) ssaoPass.setSize(w, h);
}


function inBuilding() { return false; }
function clampUnderRoof(pos) { return pos; }
function updateRoof() {
  roofForced = 'off';
  if (roofGroup) roofGroup.visible = false;
  const btn = document.getElementById('roofToggle');
  if (btn) btn.classList.add('hidden');
}
function setRoofMode(mode) {
  roofForced = mode === 'off' ? 'off' : 'on';
  try { localStorage.setItem('devameer-flow-roof', roofForced); } catch {}
  updateRoof();
}
function cycleRoof() {
  setRoofMode(roofForced === 'off' ? 'on' : 'off');
}
function applyCityLite(on) {
  if (!city) return;
  city.carN = 0;
  if (city.hats) city.hats.visible = false;
  if (city.sigs) city.sigs.visible = false;
  if (city.trunks && city.treeN) {
    const n = on ? Math.max(10, Math.floor(city.treeN * 0.4)) : city.treeN;
    city.trunks.count = n;
    if (city.leaves) city.leaves.count = n;
  }
  if (city.hills && city.hillN) {
    city.hills.count = on ? Math.min(8, city.hillN) : city.hillN;
  }
}

function applyRecordMode(on) {
  recordMode = !!on;
  if (recordMode) {
    autoTier = 3;
    fxLevel = 'off';
    if (bloomPass) bloomPass.enabled = false;
    if (composer) {
      try { if (composer.passes) composer.passes.forEach((p) => { if (p && p !== composer.passes[0]) p.enabled = false; }); } catch {}
    }
    if (renderer) {
      renderer.shadowMap.enabled = false;
      if (keyLight) keyLight.castShadow = false;
    }
    spinOn = false;
    if (controls) controls.autoRotate = false;
    if (tourOn) setTour(false);
    applyCityLite(true);
    applyPixelRatio();
    if (TOD[todMode]) applyTodLighting(TOD[todMode]);
    const fxBtn = document.getElementById('fxToggle');
    if (fxBtn) {
      fxBtn.textContent = 'FX Off';
      fxBtn.setAttribute('aria-label', 'Effects: off (record)');
    }
    const gate = document.getElementById('soundGate');
    if (gate) gate.classList.add('hidden');
  }
  updateRecordTourBtn();
}

function tourNameFor(id) {
  for (const [tid, name] of TOUR_ORDER) if (tid === id) return name;
  const d = desks.get(id);
  return (d && d.name) || id;
}
function tourRoleFor(id) {
  const d = desks.get(id);
  if (d && d.role) return d.role;
  const w = world();
  const n = w && w.nodes && w.nodes.find((x) => x.id === id);
  return (n && n.role) || '';
}

function setTourCaption(text, sub) {
  const el = document.getElementById('tourCaption');
  if (!el) return;
  if (!text) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.classList.remove('hidden');
  el.textContent = '';
  el.appendChild(document.createTextNode(text));
  if (sub) {
    const em = document.createElement('em');
    em.textContent = sub;
    el.appendChild(em);
  }
}

function updateRecordTourBtn() {
  const btn = document.getElementById('recordTourBtn');
  if (!btn) return;
  btn.textContent = recordTour.on ? 'Stop tour' : 'Record tour';
  btn.setAttribute('aria-pressed', recordTour.on ? 'true' : 'false');
  btn.setAttribute('aria-label', recordTour.on ? 'Stop the record tour' : 'Record a lightweight office tour');
}

function recordTourReady() {
  if (!built || !loadDone || !camera) return false;
  if (pendingInteriors.length) return false;
  return desks.size >= TOUR_ORDER.length;
}

function goRecordRoom(index, instant) {
  const pair = TOUR_ORDER[index];
  if (!pair) return false;
  const id = pair[0];
  const ok = flyToAgent(id, { door: true, force: true, dur: instant ? 0.05 : Math.min(1.25, Math.max(0.7, recordSecs * 0.28)), instant: !!instant });
  setTourCaption(pair[1], tourRoleFor(id));
  const d = desks.get(id);
  if (d && typeof triggerAnim === 'function') {
    try { triggerAnim(id, { node: id, type: 'work' }); } catch {}
  }
  return ok;
}

function startRecordTour(opts) {
  applyRecordMode(true);
  if (opts && opts.loop != null) recordLoop = !!opts.loop;
  if (opts && opts.secs) recordSecs = Math.max(2, Math.min(20, +opts.secs || recordSecs));
  if (!recordTourReady()) {
    recordAutoStart = true;
    updateRecordTourBtn();
    return false;
  }
  recordTour.on = true;
  recordTour.index = 0;
  recordTour.hold = 0;
  recordTour.phase = 'fly';
  recordAutoStart = false;
  if (tourOn) setTour(false);
  goRecordRoom(0, false);
  updateRecordTourBtn();
  return true;
}

function stopRecordTour(keepCaption) {
  recordTour.on = false;
  recordTour.phase = 'idle';
  recordTour.hold = 0;
  recordAutoStart = false;
  if (!keepCaption) setTourCaption('');
  updateRecordTourBtn();
}

function toggleRecordTour() {
  if (recordTour.on) stopRecordTour();
  else startRecordTour();
}

function finishRecordTour() {
  recordTour.phase = 'overview';
  recordTour.hold = 0;
  setTourCaption('Devameer Bot HQ', 'Overview');
  closeOn = null;
  flyOverview({ dur: 1.1 });
}

function stepRecordTour(dt) {
  if (!recordTour.on) return;
  if (!recordTourReady()) return;
  if (recordTour.phase === 'fly') {
    if (fly) return;
    recordTour.phase = 'hold';
    recordTour.hold = 0;
    return;
  }
  if (recordTour.phase === 'hold') {
    recordTour.hold += dt;
    const dwell = Math.max(1.2, recordSecs - 1.15);
    if (recordTour.hold < dwell) return;
    recordTour.index += 1;
    if (recordTour.index >= TOUR_ORDER.length) {
      finishRecordTour();
      return;
    }
    recordTour.phase = 'fly';
    recordTour.hold = 0;
    goRecordRoom(recordTour.index, false);
    return;
  }
  if (recordTour.phase === 'overview') {
    if (fly) return;
    recordTour.hold += dt;
    if (recordTour.hold < 1.6) return;
    if (recordLoop) {
      recordTour.index = 0;
      recordTour.phase = 'fly';
      recordTour.hold = 0;
      goRecordRoom(0, false);
    } else {
      stopRecordTour(true);
    }
  }
}

let deepLinkStarted = false;
function maybeStartDeepLink() {
  if (!recordTourReady()) return;
  if (recordMode) applyRecordMode(true);
  if (pendingRoom && !deepLinkStarted) {
    const id = resolveRoomParam(pendingRoom);
    if (id && desks.has(id)) {
      deepLinkStarted = true;
      const name = tourNameFor(id);
      flyToAgent(id, { instant: true, door: true, force: true });
      setTourCaption(name, tourRoleFor(id));
      pendingRoom = '';
    }
  }
  if (recordAutoStart && !recordTour.on) startRecordTour();
}

function setSpin() {
  spinOn = false;
  if (controls) controls.autoRotate = false;
}
function toggleSpin() { setSpin(); }

window.DevameerOffice = {
  attach, setActive, isActive: () => active, renderCapture, endCapture,
  onEvent, inspect, resize, defaultCamera, lookAtAgent,
  flyToAgent, flyOverview, flyToObject, exitInspect, supported: hasWebGL,
  setTheme: (n) => setTod((todChoice === 'morning' || todChoice === 'afternoon' || todChoice === 'night') ? todChoice : (n === 'dark' ? 'night' : 'afternoon'), true),
  setTod, tod: () => ({ choice: todChoice, mode: todMode }),
  unlockAudio, setVolume, toggleMute, audioCaptureStream,
  toggleWalk: () => false, setWalk: () => false, isWalk: () => false,
  toggleTour, setTour, isTour: () => tourOn,
  startRecordTour, stopRecordTour, toggleRecordTour, isRecord: () => recordMode,
  applyRecordMode, resolveRoom: resolveRoomParam,
  cycleFx, applyFxLevel, onDoubleClick,
  cycleRoof, setRoofMode, toggleSpin, setSpin,
  walkToAgent: (id) => flyToAgent(id), setWalkDest: () => {},
  setView(pos, target, instant) {
    if (!camera || !controls) return false;
    const p = new THREE.Vector3(pos[0], pos[1], pos[2]);
    const g = new THREE.Vector3(target[0], target[1], target[2]);
    if (instant === false) startFly(p, g, 0.8);
    else { camera.position.copy(p); controls.target.copy(g); controls.update(); fly = null; clampCamBounds(); }
    return true;
  },
  inspectByLabel(label) {
    if (!hqRoot) return false;
    let found = null;
    hqRoot.traverse((o) => { if (!found && o.isMesh && o.userData && o.userData.pickLabel === label) found = o; });
    if (!found) {
      for (const d of desks.values()) d.root.traverse((o) => { if (!found && o.isMesh && o.userData && o.userData.pickLabel === label) found = o; });
    }
    return found ? flyToObject(found) : false;
  },
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
    if (typeof P.applyTod === 'function') {
      try { P.applyTod(P.tod || 'auto', true); } catch (e) { console.warn(e); }
    } else if (typeof P.setTod === 'function') {
      try { P.setTod(P.tod || 'auto'); } catch (e) { console.warn(e); }
    }
  };
  tryApply();
})();
