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
    impl = {
      kind: 'postgres',
      saveTrade: (t) => pool.query(`insert into trades (id,data,opened_at) values ($1,$2,$3) on conflict (id) do update set data=excluded.data`, [t.id, t, t.openedAt]),
      listTrades: async () => (await pool.query(`select data from trades order by opened_at asc`)).rows.map(r => r.data),
      get: async (k) => { const r = await pool.query(`select v from kv where k=$1`, [k]); return r.rows[0] ? r.rows[0].v : undefined; },
      set: (k, v) => pool.query(`insert into kv (k,v) values ($1,$2) on conflict (k) do update set v=excluded.v`, [k, JSON.stringify(v)]),
    };
  } else {
    fs.mkdirSync(cfg.DATA_DIR, { recursive: true });
    const Database = require('better-sqlite3');
    const db = new Database(path.join(cfg.DATA_DIR, 'bot.db'));
    db.pragma('journal_mode = WAL');
    db.exec(`create table if not exists trades (id text primary key, data text not null, opened_at integer not null);
             create table if not exists kv (k text primary key, v text not null);`);
    const up = db.prepare(`insert into trades (id,data,opened_at) values (?,?,?) on conflict(id) do update set data=excluded.data`);
    const kvGet = db.prepare(`select v from kv where k=?`);
    const kvSet = db.prepare(`insert into kv (k,v) values (?,?) on conflict(k) do update set v=excluded.v`);
    impl = {
      kind: 'sqlite',
      saveTrade: async (t) => up.run(t.id, JSON.stringify(t), t.openedAt),
      listTrades: async () => db.prepare(`select data from trades order by opened_at asc`).all().map(r => JSON.parse(r.data)),
      get: async (k) => { const r = kvGet.get(k); return r ? JSON.parse(r.v) : undefined; },
      set: async (k, v) => kvSet.run(k, JSON.stringify(v)),
    };
  }
  return impl;
}
module.exports = { init, get: () => impl };
