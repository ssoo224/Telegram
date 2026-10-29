/* api/gifts.js — كل ما يخص النجوم والهدايا يصير هنا (الرصيد ما يتعدل من التطبيق أبداً)
   العمليات: buy | upgrade | buy-listing | dev-stars | send-stars */
const crypto = require('crypto');
const { db, FieldValue, limited, HttpError, guard, authUser, send, ensureChat } = require('./_shared');
const { loadKinds } = require('./_gift-kinds');

const gidOf = (K, n) => K.gen ? K.key + '_' + n : String(n);
const pick = ws => { let r = crypto.randomInt(ws.reduce((a, b) => a + b, 0)); for (let i = 0; i < ws.length; i++) { r -= ws[i]; if (r < 0) return i; } return ws.length - 1; };
const fmt = n => Number(n).toLocaleString('en-US');

async function opBuy(uid, isDev, K) {
  const col = K.gen ? 'giftSales' : K.sales;
  for (let attempt = 0; attempt < 5; attempt++) {
    const snap = K.gen ? await db.collection('giftSales').where('k', '==', K.key).get() : await db.collection(K.sales).get();
    const taken = new Set(snap.docs.map(d => K.gen ? String(d.data().n) : d.id));
    let n = 0; for (let k = 1; k <= K.max; k++) if (!taken.has(String(k))) { n = k; break; }
    if (!n) throw new HttpError(409, 'soldout');
    const id = gidOf(K, n), now = Date.now();
    const sref = db.collection(col).doc(id), wref = db.collection('wallets').doc(uid);
    const gref = db.collection('users').doc(uid).collection(K.coll).doc(id);
    try {
      await db.runTransaction(async tx => {
        const [ss, ws] = await Promise.all([tx.get(sref), tx.get(wref)]);
        if (ss.exists) throw new HttpError(409, 'taken');
        const bal = ws.exists ? Number(ws.data().stars) || 0 : 0;
        if (!isDev && bal < K.price) throw new HttpError(402, 'funds');
        if (!isDev) tx.set(wref, { stars: bal - K.price }, { merge: true });
        tx.set(sref, K.gen ? { ownerId: uid, at: now, k: K.key, n } : { ownerId: uid, at: now });
        tx.set(gref, K.gen ? { number: n, upgraded: false, at: now, k: K.key } : { number: n, upgraded: false, at: now });
        const t = { type: 'buy', gift: n, stars: K.price, at: now }; if (K.key !== 'pepe') t.kind = K.key;
        tx.set(db.collection('users').doc(uid).collection('txs').doc(), t);
        tx.set(db.collection('giftEvents').doc(K.key + '_' + n).collection('log').doc(), { k: K.key, number: n, coll: K.coll, type: 'mint', to: uid, price: K.price, at: now });
      });
      return { number: n };
    } catch (e) { if (e instanceof HttpError && e.code === 'taken') continue; throw e; }
  }
  throw new HttpError(409, 'taken');
}

async function opUpgrade(uid, K, number, bgs, syms) {
  const gref = db.collection('users').doc(uid).collection(K.coll).doc(gidOf(K, number));
  return db.runTransaction(async tx => {
    const s = await tx.get(gref);
    if (!s.exists) throw new HttpError(404, 'nogift');
    if (s.data().upgraded) throw new HttpError(409, 'already');
    const res = { model: pick(K.models), bg: pick(bgs), sym: pick(syms) };
    tx.update(gref, { upgraded: true, model: res.model, bg: res.bg, sym: res.sym });
    return res;
  });
}

async function opBuyListing(uid, isDev, K, number, buyerName) {
  const id = gidOf(K, number), lid = K.key + '_' + number, col = K.gen ? 'giftSales' : K.sales;
  const lref = db.collection('giftListings').doc(lid), sref = db.collection(col).doc(id);
  const out = await db.runTransaction(async tx => {
    const ls = await tx.get(lref);
    if (!ls.exists) throw new HttpError(409, 'gone');
    const l = ls.data(), seller = l.sellerId;
    if (!seller || seller === uid || l.k !== K.key) throw new HttpError(409, 'gone');
    const price = l.price;
    if (!Number.isInteger(price) || price < 1 || price > 1000000) throw new HttpError(409, 'gone');
    const net = Math.floor(price * 95 / 100);
    const sgRef = db.collection('users').doc(seller).collection(K.coll).doc(id);
    const bRef = db.collection('wallets').doc(uid), sWRef = db.collection('wallets').doc(seller);
    const [ss, sg, bw, sw] = await Promise.all([tx.get(sref), tx.get(sgRef), tx.get(bRef), tx.get(sWRef)]);
    if (!ss.exists || ss.data().ownerId !== seller || !sg.exists || !sg.data().upgraded) throw new HttpError(409, 'gone');
    const bBal = bw.exists ? Number(bw.data().stars) || 0 : 0;
    if (!isDev && bBal < price) throw new HttpError(402, 'funds');
    const sBal = sw.exists ? Number(sw.data().stars) || 0 : 0;
    const now = Date.now(), g = sg.data();
    if (!isDev) tx.set(bRef, { stars: bBal - price }, { merge: true });
    tx.set(sWRef, { stars: sBal + net }, { merge: true });
    tx.update(sref, { ownerId: uid });
    tx.delete(sgRef);
    const doc = { number, upgraded: true, at: g.at || 0, model: g.model, bg: g.bg, sym: g.sym }; if (K.gen) doc.k = K.key;
    tx.set(db.collection('users').doc(uid).collection(K.coll).doc(id), doc);
    tx.delete(lref);
    tx.set(db.collection('users').doc(uid).collection('txs').doc(), { type: 'buy', gift: number, stars: price, at: now, kind: K.key });
    tx.set(db.collection('users').doc(seller).collection('txs').doc(), { type: 'sell', gift: number, stars: net, at: now, kind: K.key, buyer: uid, buyerName });
    tx.set(db.collection('giftEvents').doc(K.key + '_' + number).collection('log').doc(), { k: K.key, number, coll: K.coll, type: 'sale', from: seller, to: uid, price, at: now });
    return { seller, price, net, now };
  });
  /* إشعار للبائع بالمحادثة (إذا فشل ما يأثر على الشراء) */
  try {
    const cref = await ensureChat(uid, out.seller, out.now);
    await cref.collection('messages').add({ senderId: uid, type: 'sold', k: K.key, number, price: out.price, net: out.net, text: '🛒 انباعت ' + K.name + ' #' + number + ' بـ ' + fmt(out.price) + ' ⭐', createdAt: out.now, read: false });
  } catch (e) { console.warn('sold notice', e && e.message); }
  return { ok: true };
}

async function opDevStars(uid, to, amount, myName) {
  if (!to || typeof to !== 'string' || to.length > 128 || !Number.isInteger(amount) || amount < 1 || amount > 1000000) throw new HttpError(400, 'bad');
  const tu = await db.collection('users').doc(to).get();
  if (!tu.exists) throw new HttpError(404, 'nouser');
  const toName = tu.data().displayName || 'مستخدم', now = Date.now();
  const b = db.batch();
  b.set(db.collection('wallets').doc(to), { stars: FieldValue.increment(amount) }, { merge: true });
  b.set(db.collection('users').doc(to).collection('txs').doc(), { type: 'in', from: uid, fromName: myName, stars: amount, at: now });
  b.set(db.collection('users').doc(uid).collection('txs').doc(), { type: 'out', to, toName, stars: amount, at: now });
  await b.commit();
  try {
    const cref = await ensureChat(uid, to, now);
    await cref.collection('messages').add({ senderId: uid, type: 'stars', stars: amount, text: '🎁 هدية ' + fmt(amount) + ' نجمة', createdAt: now, read: false });
  } catch (e) { console.warn('star message', e && e.message); }
  return { ok: true };
}

/* إهداء نجوم من أي مستخدم لمستخدم ثاني: ما يتجاوز رصيده، والمستلم ياخذ 95% (عمولة 5%) */
const GIFT_FEE_PCT = 5;
async function opSendStars(uid, to, amount, myName) {
  if (!to || typeof to !== 'string' || to.length > 128 || to === uid) throw new HttpError(400, 'bad');
  if (!Number.isInteger(amount) || amount < 2 || amount > 1000000) throw new HttpError(400, 'bad');
  const net = Math.floor(amount * (100 - GIFT_FEE_PCT) / 100), fee = amount - net;
  if (net < 1) throw new HttpError(400, 'bad');
  const tu = await db.collection('users').doc(to).get();
  if (!tu.exists) throw new HttpError(404, 'nouser');
  const [b1, b2] = await Promise.all([
    db.collection('users').doc(to).collection('blocks').doc(uid).get(),
    db.collection('users').doc(uid).collection('blocks').doc(to).get()
  ]);
  if (b1.exists || b2.exists) throw new HttpError(403, 'blocked');
  const toName = tu.data().displayName || 'مستخدم', now = Date.now();
  const wref = db.collection('wallets').doc(uid), rref = db.collection('wallets').doc(to);
  await db.runTransaction(async tx => {
    const ws = await tx.get(wref);
    const bal = ws.exists ? Number(ws.data().stars) || 0 : 0;
    if (bal < amount) throw new HttpError(402, 'funds', { balance: bal });
    tx.set(wref, { stars: bal - amount }, { merge: true });
    tx.set(rref, { stars: FieldValue.increment(net) }, { merge: true });
    tx.set(db.collection('users').doc(to).collection('txs').doc(), { type: 'in', from: uid, fromName: myName, stars: net, gross: amount, fee, at: now });
    tx.set(db.collection('users').doc(uid).collection('txs').doc(), { type: 'out', to, toName, stars: amount, net, fee, at: now });
    tx.set(db.collection('appStats').doc('fees'), { stars: FieldValue.increment(fee), count: FieldValue.increment(1), updatedAt: now }, { merge: true });
  });
  try {
    const cref = await ensureChat(uid, to, now);
    await cref.collection('messages').add({ senderId: uid, type: 'stars', stars: net, gross: amount, fee, text: '🎁 هدية ' + fmt(net) + ' نجمة', createdAt: now, read: false });
  } catch (e) { console.warn('star message', e && e.message); }
  return { ok: true, net, fee };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { body } = await guard(req);
    const u = await authUser(req, true);
    if (limited('g:' + u.uid, 60000, 40)) throw new HttpError(429, 'rate');
    const origin = process.env.SITE_ORIGIN || ('https://' + req.headers.host);
    const { kinds, bgs, syms } = await loadKinds(origin);
    const num = Number(body.number);
    if (body.op === 'dev-stars') {
      if (!u.isDev) throw new HttpError(403, 'dev');
      const me = await db.collection('users').doc(u.uid).get();
      return res.status(200).json(await opDevStars(u.uid, body.to, Number(body.amount), (me.exists && me.data().displayName) || 'المطور'));
    }
    if (body.op === 'send-stars') {
      if (limited('ss:' + u.uid, 60000, 8)) throw new HttpError(429, 'rate');
      const me = await db.collection('users').doc(u.uid).get();
      const myName = (me.exists && me.data().displayName) || 'مستخدم';
      if (u.isDev) return res.status(200).json(await opDevStars(u.uid, body.to, Number(body.amount), myName));
      return res.status(200).json(await opSendStars(u.uid, body.to, Number(body.amount), myName));
    }
    const K = kinds[String(body.kind || '')];
    if (!K) throw new HttpError(400, 'kind');
    if (body.op === 'buy') return res.status(200).json(await opBuy(u.uid, u.isDev, K));
    if (!Number.isInteger(num) || num < 1 || num > K.max) throw new HttpError(400, 'number');
    if (body.op === 'upgrade') return res.status(200).json(await opUpgrade(u.uid, K, num, bgs, syms));
    if (body.op === 'buy-listing') {
      const me = await db.collection('users').doc(u.uid).get();
      return res.status(200).json(await opBuyListing(u.uid, u.isDev, K, num, (me.exists && me.data().displayName) || 'مستخدم'));
    }
    throw new HttpError(400, 'op');
  } catch (e) { return send(res, e); }
};
