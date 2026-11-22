// Attach a synthetic pump/dump price path to each paper trade so charts can be previewed locally.
// Usage: DATA_DIR=/workspace/devameer-bot/data node scripts/seed-ticks.js
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const db = new Database(path.join(dir, 'bot.db'));
db.exec(`create table if not exists ticks (mint text not null, at integer not null, price real not null, mcap_sol real, primary key (mint, at));
         create table if not exists coin_stats (mint text primary key, data text not null);`);
const ins = db.prepare(`insert into ticks (mint,at,price,mcap_sol) values (?,?,?,?) on conflict(mint,at) do nothing`);
const upStat = db.prepare(`insert into coin_stats (mint,data) values (?,?) on conflict(mint) do update set data=excluded.data`);
const trades = db.prepare(`select data from trades`).all().map((r) => JSON.parse(r.data));

const insertMany = db.transaction((rows) => { for (const r of rows) ins.run(r.mint, r.t, r.price, r.mcapSol); });

let nTicks = 0, nStats = 0;
for (const t of trades) {
  const entry = t.curvePriceAtEntry || t.entryPrice || 1e-7;
  const exitP = t.exitPrice || entry * (1 + (t.pnlPct || 0));
  const opened = t.openedAt;
  const closed = t.closedAt || (opened + 180000);
  const before = opened - 4 * 60000;
  const after = closed + 3 * 60000;
  const peakMult = 1 + Math.max(0.35, (t.pnlPct || 0) + 0.25);
  const troughMult = 1 - Math.max(0.12, Math.abs(Math.min(0, t.pnlPct || 0)) + 0.08);
  const points = [];
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const at = Math.round(before + (after - before) * u);
    let m;
    if (at < opened) {
      // start slightly above, then dip, then recover into the entry
      const h = (at - before) / Math.max(1, opened - before);
      m = h < 0.45 ? 1.1 - (1.1 - troughMult) * (h / 0.45) : troughMult + (1 - troughMult) * ((h - 0.45) / 0.55);
    } else if (at <= closed) {
      const h = (at - opened) / Math.max(1, closed - opened);
      m = h < 0.55 ? 1 + (peakMult - 1) * (h / 0.55) : peakMult + (exitP / entry - peakMult) * ((h - 0.55) / 0.45);
    } else {
      const h = (at - closed) / Math.max(1, after - closed);
      m = exitP / entry * (1 + (t.pnlPct >= 0 ? -0.08 : 0.05) * h);
    }
    const price = entry * Math.max(0.05, m);
    points.push({ mint: t.mint, t: at, price, mcapSol: price * 1e9 });
  }
  insertMany(points);
  nTicks += points.length;
  const prices = points.map((p) => p.price);
  const first = points[0].price, peak = Math.max(...prices), trough = Math.min(...prices);
  upStat.run(t.mint, JSON.stringify({
    mint: t.mint, symbol: t.symbol, name: t.name || '', image: t.image || null,
    firstSeenAt: points[0].t, lastAt: points[points.length - 1].t,
    firstPrice: first, peakPrice: peak, troughPrice: trough, lastPrice: points[points.length - 1].price,
    pumpPct: peak / first - 1, dumpPct: trough / first - 1, traded: true,
  }));
  nStats++;
}
console.log('seeded', nTicks, 'ticks across', nStats, 'coins');
