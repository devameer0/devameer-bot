// Execution: paper fills from live curve state, or real txs via PumpPortal trade-local + own RPC.
// The private key is loaded once from env and never logged, stored, or sent anywhere except used to sign locally.
const { Connection, Keypair, VersionedTransaction, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58 = require('bs58').default || require('bs58');
const cfg = require('./config');
// fetch with a hard timeout so a slow/rate-limited RPC can never stall the loop
const rpcFetch = (url, opts) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), 12000); return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t)); };
const mkConn = () => new Connection(cfg.SOLANA_RPC_URL, { commitment: 'confirmed', disableRetryOnRateLimit: true, fetch: rpcFetch });


let keypair = null;
function loadKey() {
  if (keypair || !process.env.WALLET_PRIVATE_KEY) return keypair;
  try {
    const raw = process.env.WALLET_PRIVATE_KEY.trim();
    const bytes = raw.startsWith('[') ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw);
    keypair = Keypair.fromSecretKey(bytes);
  } catch { keypair = null; console.error('WALLET_PRIVATE_KEY could not be parsed (expected base58 or JSON byte array)'); }
  return keypair;
}

class Trader {
  constructor(market) {
    this.market = market;
    this.conn = mkConn();
    this.kp = loadKey();
  }
  get pubkey() { return this.kp ? this.kp.publicKey.toBase58() : null; }
  get live() { return cfg.LIVE_CAPABLE && !!this.kp; }

  async balanceSol() {
    if (!this.kp) return null;
    try { return (await this.conn.getBalance(this.kp.publicKey)) / LAMPORTS_PER_SOL; } catch { return null; }
  }

  // ----- paper fill math (constant product on the live curve reserves) -----
  quoteBuy(t, sol) {
    const net = sol * (1 - cfg.PUMP_FEE);
    const tokens = t.vTok - (t.vSol * t.vTok) / (t.vSol + net);
    return tokens;
  }
  quoteSell(t, tokens) {
    if (t.complete) return tokens * (t.gradPrice || t.price || 0) * (1 - 0.01);
    const sol = t.vSol - (t.vSol * t.vTok) / (t.vTok + tokens);
    return sol * (1 - cfg.PUMP_FEE);
  }

  async portalTx({ action, mint, amount, denominatedInSol, slippage, priorityFee }) {
    const r = await fetch('https://pumpportal.fun/api/trade-local', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicKey: this.pubkey, action, mint, amount, denominatedInSol, slippage, priorityFee, pool: 'auto' }),
    });
    if (r.status !== 200) throw new Error(`PumpPortal ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const tx = VersionedTransaction.deserialize(new Uint8Array(await r.arrayBuffer()));
    tx.sign([this.kp]);
    const sig = await this.conn.sendTransaction(tx, { maxRetries: 3 });
    await this.confirm(sig);
    return sig;
  }

  async confirm(sig, timeoutMs = 60000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const st = (await this.conn.getSignatureStatuses([sig])).value[0];
      if (st?.err) throw new Error('tx failed on-chain: ' + JSON.stringify(st.err));
      if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return true;
      await new Promise(r => setTimeout(r, 1500));
    }
    throw new Error('tx not confirmed in 60s: ' + sig);
  }

  // actual SOL delta (incl. fees) and token delta for our wallet from the confirmed tx
  async deltas(sig, mint) {
    for (let i = 0; i < 6; i++) {
      const tx = await this.conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' });
      if (tx?.meta) {
        const keys = tx.transaction.message.getAccountKeys ? tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses }).staticAccountKeys : tx.transaction.message.accountKeys;
        const idx = keys.findIndex(k => k.toBase58() === this.pubkey);
        const solDelta = idx >= 0 ? (tx.meta.postBalances[idx] - tx.meta.preBalances[idx]) / LAMPORTS_PER_SOL : 0;
        const bal = (arr) => (arr || []).filter(b => b.mint === mint && b.owner === this.pubkey).reduce((s, b) => s + (b.uiTokenAmount.uiAmount || 0), 0);
        return { solDelta, tokenDelta: bal(tx.meta.postTokenBalances) - bal(tx.meta.preTokenBalances) };
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    return null;
  }

  // returns { costSol, tokens, sig, paper }
  async buy(t, sol, s) {
    if (!this.live) {
      const tokens = this.quoteBuy(t, sol);
      return { paper: true, costSol: sol + s.priorityFee, tokens, sig: null };
    }
    const sig = await this.portalTx({ action: 'buy', mint: t.mint, amount: sol, denominatedInSol: 'true', slippage: s.slippage, priorityFee: s.priorityFee });
    const d = await this.deltas(sig, t.mint);
    if (!d || d.tokenDelta <= 0) throw new Error('buy confirmed but no tokens received (' + sig + ')');
    return { paper: false, costSol: -d.solDelta, tokens: d.tokenDelta, sig };
  }

  // returns { proceedsSol, sig, paper }
  async sell(t, pos, s) {
    if (!this.live) {
      return { paper: true, proceedsSol: this.quoteSell(t, pos.tokens) - s.priorityFee, sig: null };
    }
    const sig = await this.portalTx({ action: 'sell', mint: t.mint, amount: '100%', denominatedInSol: 'false', slippage: s.slippage, priorityFee: s.priorityFee });
    const d = await this.deltas(sig, t.mint);
    return { paper: false, proceedsSol: d ? d.solDelta : 0, sig };
  }

  async withdraw(sol) {
    if (!this.live) return { paper: true, sig: null };
    if (!cfg.WITHDRAW_ADDRESS) throw new Error('WITHDRAW_ADDRESS not set');
    const to = new PublicKey(cfg.WITHDRAW_ADDRESS);
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: this.kp.publicKey, toPubkey: to, lamports: Math.floor(sol * LAMPORTS_PER_SOL) }));
    const { blockhash } = await this.conn.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash; tx.feePayer = this.kp.publicKey; tx.sign(this.kp);
    const sig = await this.conn.sendRawTransaction(tx.serialize());
    await this.confirm(sig);
    return { paper: false, sig };
  }
}
module.exports = { Trader };
