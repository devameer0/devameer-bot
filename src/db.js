// Tiny persistence layer: Postgres if DATABASE_URL is set, otherwise SQLite in DATA_DIR.
const cfg = require('./config');
const fs = require('fs');
const path = require('path');

let impl;
function ident(name) {
  const schema = (cfg.DATABASE_SCHEMA || 'public').replace(/[^a-zA-Z0-9_]/g, '') || 'public';
  const table = String(name).replace(/[^a-zA-Z0-9_]/g, '');
  return schema === 'public' ? table : '"' + schema + '".' + table;
}

async function afterTrade(savePos, delPos, t) {
  try {
    if (t.status === 'open') await savePos(t);
    else await delPos(t.id);
  } catch { /* positions are a convenience copy */ }
}

async function init() {
  if (cfg.DATABASE_URL) {
    const { Pool } = require('pg');
    // Strip sslmode from the URL so pg does not force verify-full (Render + Supabase
    // pooler often present a chain Node rejects). We still use TLS, without CA pinning.
    let conn = cfg.DATABASE_URL;
    try {
      const u = new URL(conn);
      u.searchParams.delete('sslmode');
      u.searchParams.set('sslmode', 'no-verify');
      conn = u.toString();
    } catch { /* keep raw */ }
    const pool = new Pool({
      connectionString: conn,
      ssl: /localhost|127\.0\.0\.1/.test(cfg.DATABASE_URL) ? false : { rejectUnauthorized: false },
      max: 4,
      idleTimeoutMillis: 10000,
    });
    const schema = (cfg.DATABASE_SCHEMA || 'public').replace(/[^a-zA-Z0-9_]/g, '') || 'public';
    if (schema !== 'public') {
      // Schema is provisioned ahead of time; the app role may not have CREATE.
      await pool.query('set search_path to "' + schema + '"');
      pool.on('connect', (c) => { c.query('set search_path to "' + schema + '"').catch(() => {}); });
    }
    const ddl = `
      create table if not exists ${ident('trades')} (id text primary key, data jsonb not null, opened_at bigint not null);
      create table if not exists ${ident('kv')} (k text primary key, v jsonb not null);
      create table if not exists ${ident('ticks')} (mint text not null, at bigint not null, price double precision not null, mcap_sol double precision, primary key (mint, at));
      create table if not exists ${ident('coin_stats')} (mint text primary key, data jsonb not null);
      create table if not exists ${ident('positions')} (id text primary key, data jsonb not null, opened_at bigint not null);
      create table if not exists ${ident('account_snapshots')} (at bigint primary key, data jsonb not null);
      create table if not exists ${ident('flow_events')} (
        id bigint primary key,
        at bigint not null,
        node text not null,
        type text,
        mint text,
        symbol text,
        agent text,
        ok boolean,
        message text,
        data jsonb
      );
      create index if not exists flow_events_at_idx on ${ident('flow_events')} (at desc);
    `;
    await pool.query(ddl);
    const savePos = (t) => pool.query(`insert into ${ident('positions')} (id,data,opened_at) values ($1,$2,$3) on conflict (id) do update set data=excluded.data`, [t.id, t, t.openedAt]);
    const delPos = (id) => pool.query(`delete from ${ident('positions')} where id=$1`, [id]);
    impl = {
      kind: 'postgres',
      schema,
      saveTrade: async (t) => {
        await pool.query(`insert into ${ident('trades')} (id,data,opened_at) values ($1,$2,$3) on conflict (id) do update set data=excluded.data`, [t.id, t, t.openedAt]);
        await afterTrade(savePos, delPos, t);
      },
      listTrades: async () => (await pool.query(`select data from ${ident('trades')} order by opened_at asc`)).rows.map(r => r.data),
      get: async (k) => { const r = await pool.query(`select v from ${ident('kv')} where k=$1`, [k]); return r.rows[0] ? r.rows[0].v : undefined; },
      set: (k, v) => pool.query(`insert into ${ident('kv')} (k,v) values ($1,$2) on conflict (k) do update set v=excluded.v`, [k, JSON.stringify(v)]),
      saveTicks: async (rows) => {
        if (!rows.length) return;
        const vals = [], args = [];
        let i = 1;
        for (const r of rows) { vals.push(`($${i++},$${i++},$${i++},$${i++})`); args.push(r.mint, r.t, r.price, r.mcapSol != null ? r.mcapSol : null); }
        await pool.query(`insert into ${ident('ticks')} (mint,at,price,mcap_sol) values ${vals.join(',')} on conflict do nothing`, args);
      },
      listTicks: async (mint, from, to, limit) => (await pool.query(
        `select at as t, price, mcap_sol as "mcapSol" from ${ident('ticks')} where mint=$1 and at>=$2 and at<=$3 order by at asc limit $4`,
        [mint, from, to, limit || 300]
      )).rows,
      capTicks: async (mint, max) => {
        await pool.query(
          `delete from ${ident('ticks')} where mint=$1 and at in (select at from ${ident('ticks')} where mint=$1 order by at desc offset $2)`,
          [mint, max]
        );
      },
      saveCoinStats: async (rows) => {
        for (const r of rows) {
          await pool.query(`insert into ${ident('coin_stats')} (mint,data) values ($1,$2) on conflict (mint) do update set data=excluded.data`, [r.mint, r]);
        }
      },
      listCoinStats: async () => (await pool.query(`select data from ${ident('coin_stats')}`)).rows.map(r => r.data),
      saveSnapshot: (data) => pool.query(`insert into ${ident('account_snapshots')} (at,data) values ($1,$2) on conflict (at) do update set data=excluded.data`, [Date.now(), data]),
      listSnapshots: async (limit) => (await pool.query(`select at, data from ${ident('account_snapshots')} order by at desc limit $1`, [limit || 200])).rows,
      saveFlowEvents: async (rows) => {
        if (!rows.length) return;
        const vals = [], args = [];
        let i = 1;
        for (const r of rows) {
          vals.push(`($${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++},$${i++})`);
          args.push(r.id, r.at, r.node, r.type || null, r.mint || null, r.symbol || null, r.agent || null, r.ok == null ? null : !!r.ok, r.message || null, r.data != null ? r.data : null);
        }
        await pool.query(`insert into ${ident('flow_events')} (id,at,node,type,mint,symbol,agent,ok,message,data) values ${vals.join(',')} on conflict (id) do nothing`, args);
      },
      listFlowEvents: async ({ since, limit } = {}) => {
        const lim = Math.min(limit || 2000, 5000);
        if (since) {
          return (await pool.query(`select id, at, node, type, mint, symbol, agent, ok, message, data from ${ident('flow_events')} where id>$1 order by id asc limit $2`, [since, lim])).rows;
        }
        const rows = (await pool.query(`select id, at, node, type, mint, symbol, agent, ok, message, data from ${ident('flow_events')} order by id desc limit $1`, [lim])).rows;
        return rows.reverse();
      },
      capFlowEvents: async (max) => {
        await pool.query(`delete from ${ident('flow_events')} where id < coalesce((select id from ${ident('flow_events')} order by id desc offset $1 limit 1), 0)`, [max]);
      },
      maxFlowEventId: async () => {
        const r = await pool.query(`select max(id) as m from ${ident('flow_events')}`);
        return Number(r.rows[0] && r.rows[0].m) || 0;
      },
    };
  } else {
    fs.mkdirSync(cfg.DATA_DIR, { recursive: true });
    const Database = require('better-sqlite3');
    const db = new Database(path.join(cfg.DATA_DIR, 'bot.db'));
    db.pragma('journal_mode = WAL');
    db.exec(`create table if not exists trades (id text primary key, data text not null, opened_at integer not null);
             create table if not exists kv (k text primary key, v text not null);
             create table if not exists ticks (mint text not null, at integer not null, price real not null, mcap_sol real, primary key (mint, at));
             create table if not exists coin_stats (mint text primary key, data text not null);
             create table if not exists positions (id text primary key, data text not null, opened_at integer not null);
             create table if not exists account_snapshots (at integer primary key, data text not null);
             create table if not exists flow_events (
               id integer primary key,
               at integer not null,
               node text not null,
               type text,
               mint text,
               symbol text,
               agent text,
               ok integer,
               message text,
               data text
             );
             create index if not exists flow_events_at_idx on flow_events (at desc);`);
    const up = db.prepare(`insert into trades (id,data,opened_at) values (?,?,?) on conflict(id) do update set data=excluded.data`);
    const kvGet = db.prepare(`select v from kv where k=?`);
    const kvSet = db.prepare(`insert into kv (k,v) values (?,?) on conflict(k) do update set v=excluded.v`);
    const insTick = db.prepare(`insert into ticks (mint,at,price,mcap_sol) values (?,?,?,?) on conflict(mint,at) do nothing`);
    const insTicks = db.transaction((rows) => { for (const r of rows) insTick.run(r.mint, r.t, r.price, r.mcapSol != null ? r.mcapSol : null); });
    const listTick = db.prepare(`select at as t, price, mcap_sol as mcapSol from ticks where mint=? and at>=? and at<=? order by at asc limit ?`);
    const capTick = db.prepare(`delete from ticks where mint=? and at in (select at from ticks where mint=? order by at desc limit -1 offset ?)`);
    const upStat = db.prepare(`insert into coin_stats (mint,data) values (?,?) on conflict(mint) do update set data=excluded.data`);
    const upStats = db.transaction((rows) => { for (const r of rows) upStat.run(r.mint, JSON.stringify(r)); });
    const upPos = db.prepare(`insert into positions (id,data,opened_at) values (?,?,?) on conflict(id) do update set data=excluded.data`);
    const delPos = db.prepare(`delete from positions where id=?`);
    const upSnap = db.prepare(`insert into account_snapshots (at,data) values (?,?) on conflict(at) do update set data=excluded.data`);
    const insFlow = db.prepare(`insert into flow_events (id,at,node,type,mint,symbol,agent,ok,message,data) values (?,?,?,?,?,?,?,?,?,?) on conflict(id) do nothing`);
    const insFlows = db.transaction((rows) => {
      for (const r of rows) insFlow.run(r.id, r.at, r.node, r.type || null, r.mint || null, r.symbol || null, r.agent || null, r.ok == null ? null : (r.ok ? 1 : 0), r.message || null, r.data != null ? JSON.stringify(r.data) : null);
    });
    const parseFlow = (r) => ({ ...r, ok: r.ok == null ? null : !!r.ok, data: r.data ? JSON.parse(r.data) : null });
    impl = {
      kind: 'sqlite',
      schema: 'main',
      saveTrade: async (t) => {
        up.run(t.id, JSON.stringify(t), t.openedAt);
        if (t.status === 'open') upPos.run(t.id, JSON.stringify(t), t.openedAt);
        else delPos.run(t.id);
      },
      listTrades: async () => db.prepare(`select data from trades order by opened_at asc`).all().map(r => JSON.parse(r.data)),
      get: async (k) => { const r = kvGet.get(k); return r ? JSON.parse(r.v) : undefined; },
      set: async (k, v) => kvSet.run(k, JSON.stringify(v)),
      saveTicks: async (rows) => insTicks(rows),
      listTicks: async (mint, from, to, limit) => listTick.all(mint, from, to, limit || 300),
      capTicks: async (mint, max) => capTick.run(mint, mint, max),
      saveCoinStats: async (rows) => upStats(rows),
      listCoinStats: async () => db.prepare(`select data from coin_stats`).all().map(r => JSON.parse(r.data)),
      saveSnapshot: async (data) => upSnap.run(Date.now(), JSON.stringify(data)),
      listSnapshots: async (limit) => db.prepare(`select at, data from account_snapshots order by at desc limit ?`).all(limit || 200).map((r) => ({ at: r.at, data: JSON.parse(r.data) })),
      saveFlowEvents: async (rows) => insFlows(rows),
      listFlowEvents: async ({ since, limit } = {}) => {
        const lim = Math.min(limit || 2000, 5000);
        if (since) return db.prepare(`select id, at, node, type, mint, symbol, agent, ok, message, data from flow_events where id>? order by id asc limit ?`).all(since, lim).map(parseFlow);
        return db.prepare(`select id, at, node, type, mint, symbol, agent, ok, message, data from flow_events order by id desc limit ?`).all(lim).map(parseFlow).reverse();
      },
      capFlowEvents: async (max) => {
        db.prepare(`delete from flow_events where id not in (select id from flow_events order by id desc limit ?)`).run(max);
      },
      maxFlowEventId: async () => {
        const r = db.prepare(`select max(id) as m from flow_events`).get();
        return Number(r && r.m) || 0;
      },
    };
  }
  return impl;
}
module.exports = { init, get: () => impl };
