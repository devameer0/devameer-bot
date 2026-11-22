// Local-only helper: insert paper trades so share cards and timeframes can be previewed.
// Usage: DATA_DIR=/workspace/devameer-bot/data node scripts/seed-demo.js
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new Database(path.join(dir, 'bot.db'));
db.exec(`create table if not exists trades (id text primary key, data text not null, opened_at integer not null);
         create table if not exists kv (k text primary key, v text not null);`);
const up = db.prepare(`insert into trades (id,data,opened_at) values (?,?,?) on conflict(id) do update set data=excluded.data`);

const now = Date.now();
const day = 864e5;
const coins = [
  { symbol: 'FROG', name: 'Frogger', agent: 'sniper', daysAgo: 27, hold: 90_000, pnlPct: 0.62, cost: 0.02 },
  { symbol: 'BEAN', name: 'Beanbag', agent: 'scout', daysAgo: 24, hold: 240_000, pnlPct: -0.18, cost: 0.02 },
  { symbol: 'NOVA', name: 'Novacoin', agent: 'curve', daysAgo: 21, hold: 300_000, pnlPct: 0.34, cost: 0.02 },
  { symbol: 'PEEL', name: 'Banana Peel', agent: 'graduate', daysAgo: 18, hold: 480_000, pnlPct: 0.21, cost: 0.02 },
  { symbol: 'WISP', name: 'Wisp', agent: 'sniper', daysAgo: 15, hold: 70_000, pnlPct: 0.71, cost: 0.02 },
  { symbol: 'DRIP', name: 'Drip House', agent: 'scout', daysAgo: 12, hold: 500_000, pnlPct: -0.22, cost: 0.02 },
  { symbol: 'ORK', name: 'Orkling', agent: 'curve', daysAgo: 9, hold: 200_000, pnlPct: 0.29, cost: 0.02 },
  { symbol: 'MINT', name: 'Minty', agent: 'graduate', daysAgo: 7, hold: 400_000, pnlPct: -0.14, cost: 0.02 },
  { symbol: 'BOLT', name: 'Bolt Cat', agent: 'sniper', daysAgo: 5, hold: 110_000, pnlPct: 0.55, cost: 0.02 },
  { symbol: 'GLOW', name: 'Glowworm', agent: 'scout', daysAgo: 4, hold: 260_000, pnlPct: 0.41, cost: 0.02 },
  { symbol: 'SAND', name: 'Sandbag', agent: 'curve', daysAgo: 3, hold: 180_000, pnlPct: -0.16, cost: 0.02 },
  { symbol: 'PUMP', name: 'Pumpkin', agent: 'graduate', daysAgo: 2, hold: 350_000, pnlPct: 0.27, cost: 0.02 },
  { symbol: 'RIX', name: 'Rix', agent: 'sniper', daysAgo: 1.2, hold: 80_000, pnlPct: 0.48, cost: 0.02 },
  { symbol: 'YOLK', name: 'Yolk', agent: 'scout', daysAgo: 0.6, hold: 220_000, pnlPct: -0.19, cost: 0.02 },
  { symbol: 'ZAP', name: 'Zapdos', agent: 'curve', daysAgo: 0.2, hold: 150_000, pnlPct: 0.33, cost: 0.02 },
];

const reasons = (pct, hold) => {
  if (pct >= 0.25) return `take profit +${Math.round(pct * 100)}%`;
  if (pct <= -0.12) return `stop loss ${Math.round(pct * 100)}%`;
  return `max hold ${Math.round(hold / 60000)}m`;
};

let n = 0;
for (const c of coins) {
  const openedAt = now - c.daysAgo * day;
  const closedAt = openedAt + c.hold;
  const costSol = c.cost;
  const pnlSol = costSol * c.pnlPct;
  const proceedsSol = costSol + pnlSol;
  const entryPrice = 0.00000012 * (1 + c.daysAgo / 10);
  const exitPrice = entryPrice * (1 + c.pnlPct);
  const t = {
    id: crypto.randomUUID(), mint: crypto.randomBytes(16).toString('hex'),
    symbol: c.symbol, name: c.name, image: null, agent: c.agent,
    status: 'closed', paper: true, openedAt, closedAt,
    sizeSol: costSol, costSol, tokens: costSol / entryPrice,
    entryPrice, curvePriceAtEntry: entryPrice, entryMcapSol: entryPrice * 1e9,
    exitPrice, exitMcapSol: exitPrice * 1e9,
    proceedsSol, pnlSol, pnlPct: c.pnlPct, solUsdAtClose: 142,
    exitReason: reasons(c.pnlPct, c.hold), buySig: null, sellSig: null, peakValue: Math.max(costSol, proceedsSol),
  };
  up.run(t.id, JSON.stringify(t), t.openedAt);
  n++;
}

const entryPrice = 0.00000018;
const open = {
  id: crypto.randomUUID(), mint: crypto.randomBytes(16).toString('hex'),
  symbol: 'TEAL', name: 'Teal Sprout', image: null, agent: 'scout',
  status: 'open', paper: true, openedAt: now - 95_000,
  sizeSol: 0.02, costSol: 0.02, tokens: 0.02 / entryPrice,
  entryPrice, curvePriceAtEntry: entryPrice, entryMcapSol: entryPrice * 1e9,
  lastValue: 0.0248, peakValue: 0.0248, buySig: null,
};
up.run(open.id, JSON.stringify(open), open.openedAt);
n++;

const kvSet = db.prepare(`insert into kv (k,v) values (?,?) on conflict(k) do update set v=excluded.v`);
kvSet.run('paper:stack', JSON.stringify(0.5));
console.log('seeded', n, 'paper trades into', path.join(dir, 'bot.db'));
