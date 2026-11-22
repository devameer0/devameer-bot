// Tiny persistence layer: Postgres if DATABASE_URL is set, otherwise SQLite in DATA_DIR.
const cfg = require('./config');
const fs = require('fs');
const path = require('path');

let impl;
async function init() {
  if (cfg.DATABASE_URL) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: cfg.DATABASE_URL, ssl: /localhost|127\.0\.0\.1/.test(cfg.DATABASE_URL) ? false : { rejectUnauthorized: false } });
    await pool.query(`create table if not exists trades (id text primary key, data jsonb not null, opened_at bigint not null)`);
    await pool.query(`create table if not exists kv (k text primary key, v jsonb not null)`);
    await pool.query(`create table if not exists ticks (mint text not null, at bigint not null, price double precision not null, mcap_sol double precision, primary key (mint, at))`);
    await pool.query(`create table if not exists coin_stats (mint text primary key, data jsonb not null)`);
    impl = {
      kind: 'postgres',
      saveTrade: (t) => pool.query(`insert into trades (id,data,opened_at) values ($1,$2,$3) on conflict (id) do update set data=excluded.data`, [t.id, t, t.openedAt]),
      listTrades: async () => (await pool.query(`select data from trades order by opened_at asc`)).rows.map(r => r.data),
      get: async (k) => { const r = await pool.query(`select v from kv where k=$1`, [k]); return r.rows[0] ? r.rows[0].v : undefined; },
      set: (k, v) => pool.query(`insert into kv (k,v) values ($1,$2) on conflict (k) do update set v=excluded.v`, [k, JSON.stringify(v)]),
      saveTicks: async (rows) => {
        if (!rows.length) return;
        const vals = [], args = [];
        let i = 1;
        for (const r of rows) { vals.push(`($${i++},$${i++},$${i++},$${i++})`); args.push(r.mint, r.t, r.price, r.mcapSol != null ? r.mcapSol : null); }
        await pool.query(`insert into ticks (mint,at,price,mcap_sol) values ${vals.join(',')} on conflict do nothing`, args);
      },
      listTicks: async (mint, from, to, limit) => (await pool.query(
        `select at as t, price, mcap_sol as "mcapSol" from ticks where mint=$1 and at>=$2 and at<=$3 order by at asc limit $4`,
        [mint, from, to, limit || 300]
      )).rows,
      capTicks: async (mint, max) => {
        await pool.query(
          `delete from ticks where mint=$1 and at in (select at from ticks where mint=$1 order by at desc offset $2)`,
          [mint, max]
        );
      },
      saveCoinStats: async (rows) => {
        for (const r of rows) {
          await pool.query(`insert into coin_stats (mint,data) values ($1,$2) on conflict (mint) do update set data=excluded.data`, [r.mint, r]);
        }
      },
      listCoinStats: async () => (await pool.query(`select data from coin_stats`)).rows.map(r => r.data),
    };
  } else {
    fs.mkdirSync(cfg.DATA_DIR, { recursive: true });
    const Database = require('better-sqlite3');
    const db = new Database(path.join(cfg.DATA_DIR, 'bot.db'));
    db.pragma('journal_mode = WAL');
    db.exec(`create table if not exists trades (id text primary key, data text not null, opened_at integer not null);
             create table if not exists kv (k text primary key, v text not null);
             create table if not exists ticks (mint text not null, at integer not null, price real not null, mcap_sol real, primary key (mint, at));
             create table if not exists coin_stats (mint text primary key, data text not null);`);
    const up = db.prepare(`insert into trades (id,data,opened_at) values (?,?,?) on conflict(id) do update set data=excluded.data`);
    const kvGet = db.prepare(`select v from kv where k=?`);
    const kvSet = db.prepare(`insert into kv (k,v) values (?,?) on conflict(k) do update set v=excluded.v`);
    const insTick = db.prepare(`insert into ticks (mint,at,price,mcap_sol) values (?,?,?,?) on conflict(mint,at) do nothing`);
    const insTicks = db.transaction((rows) => { for (const r of rows) insTick.run(r.mint, r.t, r.price, r.mcapSol != null ? r.mcapSol : null); });
    const listTick = db.prepare(`select at as t, price, mcap_sol as mcapSol from ticks where mint=? and at>=? and at<=? order by at asc limit ?`);
    const capTick = db.prepare(`delete from ticks where mint=? and at in (select at from ticks where mint=? order by at desc limit -1 offset ?)`);
    const upStat = db.prepare(`insert into coin_stats (mint,data) values (?,?) on conflict(mint) do update set data=excluded.data`);
    const upStats = db.transaction((rows) => { for (const r of rows) upStat.run(r.mint, JSON.stringify(r)); });
    impl = {
      kind: 'sqlite',
      saveTrade: async (t) => up.run(t.id, JSON.stringify(t), t.openedAt),
      listTrades: async () => db.prepare(`select data from trades order by opened_at asc`).all().map(r => JSON.parse(r.data)),
      get: async (k) => { const r = kvGet.get(k); return r ? JSON.parse(r.v) : undefined; },
      set: async (k, v) => kvSet.run(k, JSON.stringify(v)),
      saveTicks: async (rows) => insTicks(rows),
      listTicks: async (mint, from, to, limit) => listTick.all(mint, from, to, limit || 300),
      capTicks: async (mint, max) => capTick.run(mint, mint, max),
      saveCoinStats: async (rows) => upStats(rows),
      listCoinStats: async () => db.prepare(`select data from coin_stats`).all().map(r => JSON.parse(r.data)),
    };
  }
  return impl;
}
module.exports = { init, get: () => impl };
