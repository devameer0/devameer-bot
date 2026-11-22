// Render sample replay MP4s from the local SQLite preview DB.
const path = require('path');
const fs = require('fs');
process.env.DRY_RUN = process.env.DRY_RUN || 'true';
process.env.DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const store = require('../src/db');
const replay = require('../src/replay');
const ticks = require('../src/ticks');

(async () => {
  await store.init();
  const trades = await store.get().listTrades();
  const t = trades.find((x) => String(x.symbol).toUpperCase() === 'ZAP') || trades.find((x) => x.status === 'closed') || trades[0];
  if (!t) throw new Error('no trades to render');
  const extra = await ticks.forTrade(t, 200);
  const d = {
    kind: 'trade',
    id: t.id, mint: t.mint, symbol: t.symbol, name: t.name || '', image: t.image || null,
    agent: t.agent, agentName: t.agent, status: t.status, paper: t.paper !== false,
    openedAt: t.openedAt, closedAt: t.closedAt, holdMs: (t.closedAt || Date.now()) - t.openedAt,
    costSol: t.costSol, proceedsSol: t.proceedsSol, pnlSol: t.pnlSol, pnlPct: t.pnlPct,
    pnlUsd: (t.pnlSol || 0) * (t.solUsdAtClose || 70),
    entryPrice: t.entryPrice, exitPrice: t.exitPrice, solUsd: t.solUsdAtClose || 70,
    exitReason: t.exitReason || '', botName: 'Devameer Bot', badge: 'DEVAMEER TERMINAL',
    ...extra,
  };
  const outDir = process.argv[2] || '/workspace';
  const sample = path.join(outDir, 'devameer-bot-replay-sample.mp4');
  const hidden = path.join(outDir, 'devameer-bot-replay-hidden-dark.mp4');
  const custom = path.join(outDir, 'devameer-bot-replay-custom-bg.mp4');
  console.log('trade', d.symbol, 'ticks', (d.ticks || []).length);
  const mp4 = await replay.renderMp4({ data: d, theme: 'dark', aspect: '1:1', seconds: 10 });
  fs.writeFileSync(sample, mp4);
  console.log('wrote', sample, mp4.length);
  const hid = { ...d, hideProfit: true, hideInvested: true };
  const mp4h = await replay.renderMp4({ data: hid, theme: 'dark', aspect: '1:1', seconds: 10 });
  fs.writeFileSync(hidden, mp4h);
  console.log('wrote', hidden, mp4h.length);
  const bg = path.join(outDir, 'devameer-bot-custom-bg-src.png');
  // caller may pass an existing bg; otherwise skip custom if missing
  if (fs.existsSync(bg)) {
    const mp4c = await replay.renderMp4({ data: d, theme: 'dark', aspect: '1:1', seconds: 10, bgImage: bg });
    fs.writeFileSync(custom, mp4c);
    console.log('wrote', custom, mp4c.length);
  }
})().catch((e) => { console.error(e); process.exit(1); });
