/* api/stickers.js — كل عمليات الملصقات تمر من هنا (التطبيق ما يكتب على stickerSets مباشرة)
   العمليات: check | create | add | remove | update | reorder | rename | delete | report | dev-hide
   الملف نفسه يُرفع من التطبيق إلى Cloudinary، والخادم هنا يجلبه ويفحصه بنفسه قبل ما يقبله،
   فلا أحد يقدر يتحايل على القيود (الحجم، الأبعاد، المدة، نوع الملف) من جهة التطبيق. */
const zlib = require('zlib');
const crypto = require('crypto');
const { db, FieldValue, limited, HttpError, guard, authUser, send } = require('./_shared');

const CLOUD = String(process.env.CLD_CLOUD || 'xuljmnmh');
const URL_RE = new RegExp('^https://res\\.cloudinary\\.com/' + CLOUD.replace(/[^A-Za-z0-9_-]/g, '') + '/(image|video|raw)/upload/[A-Za-z0-9_\\-./,%]{3,300}$');

const KINDS = ['static', 'animated', 'video'];
const MAX_PER_SET = 120;          // مثل تليجرام
const MAX_SETS_PER_USER = 30;
const MAX_BYTES = { static: 512 * 1024, animated: 64 * 1024, video: 256 * 1024 };
const REPORTS_TO_HIDE = 3;        // عدد المبلّغين المختلفين الذي يخفي الحزمة تلقائياً
const NAME_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;     // أحرف إنجليزية صغيرة وأرقام وشرطة سفلية، بدون شرطتين متتاليتين
const RESERVED = new Set(['admin', 'babylon', 'support', 'stickers', 'sticker', 'official', 'telegram']);

/* ---------- أدوات التحقق من الملفات ---------- */
async function fetchBytes(url, max) {
  if (typeof url !== 'string' || !URL_RE.test(url)) throw new HttpError(400, 'url');
  let r;
  try { r = await fetch(url, { redirect: 'error' }); } catch (e) { throw new HttpError(400, 'file'); }
  if (!r.ok) throw new HttpError(400, 'file');
  const len = Number(r.headers.get('content-length') || 0);
  if (len > max) throw new HttpError(413, 'size', { max });
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length || buf.length > max) throw new HttpError(413, 'size', { max });
  return buf;
}

function webpInfo(b) {
  if (b.length < 30 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const t = b.toString('ascii', 12, 16);
  if (t === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3), animated: !!(b[20] & 0x02) };
  if (t === 'VP8L') { if (b[20] !== 0x2f) return null; const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1, animated: false }; }
  if (t === 'VP8 ') { if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null; return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, animated: false }; }
  return null;
}
function pngInfo(b) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 33 || sig.some((v, i) => b[i] !== v) || b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), animated: b.includes(Buffer.from('acTL')) };
}
function checkStatic(buf) {
  const info = webpInfo(buf) || pngInfo(buf);
  if (!info || info.animated) throw new HttpError(400, 'format');
  const big = Math.max(info.w, info.h), small = Math.min(info.w, info.h);
  if (big !== 512 || small < 16) throw new HttpError(400, 'dimensions', { w: info.w, h: info.h });   // ضلع واحد بالضبط 512 والثاني أقل أو يساوي
  return { w: info.w, h: info.h };
}
function checkWebm(buf) {
  if (buf.length < 64 || buf.readUInt32BE(0) !== 0x1a45dfa3 || !buf.subarray(0, 64).includes(Buffer.from('webm'))) throw new HttpError(400, 'format');
  /* الأبعاد والمدة يفحصها التطبيق قبل الرفع؛ الخادم يضمن النوع والحجم فقط */
  return { w: 512, h: 512 };
}
/* فحص ملف Lottie (tgs): 512×512، أقل من 3 ثوانٍ، بدون تعابير برمجية ولا صور خارجية ولا نصوص (مثل قيود تليجرام) */
function checkTgs(buf) {
  let raw;
  try { raw = zlib.gunzipSync(buf, { maxOutputLength: 3 * 1024 * 1024 }); } catch (e) { throw new HttpError(400, 'format'); }
  let j;
  try { j = JSON.parse(raw.toString('utf8')); } catch (e) { throw new HttpError(400, 'format'); }
  if (!j || j.w !== 512 || j.h !== 512) throw new HttpError(400, 'dimensions', { w: j && j.w, h: j && j.h });
  const fr = Number(j.fr), ip = Number(j.ip), op = Number(j.op);
  if (!(fr > 0 && fr <= 60) || !(op > ip)) throw new HttpError(400, 'format');
  if ((op - ip) / fr > 3.05) throw new HttpError(400, 'duration');
  /* مشي على الشجرة كاملة بحد أقصى للعقد */
  let nodes = 0;
  const stack = [j];
  while (stack.length) {
    const o = stack.pop();
    if (++nodes > 400000) throw new HttpError(400, 'complex');
    if (Array.isArray(o)) { for (const v of o) if (v && typeof v === 'object') stack.push(v); continue; }
    if (typeof o.x === 'string') throw new HttpError(400, 'expressions');                      // تعابير After Effects
    if (o.ty === 5 || o.ty === 2) throw new HttpError(400, 'layers');                           // طبقة نص أو صورة
    if (typeof o.p === 'string' && ('u' in o || 'e' in o) && 'w' in o) throw new HttpError(400, 'assets');   // أصل صورة خارجي
    for (const k in o) { const v = o[k]; if (v && typeof v === 'object') stack.push(v); }
  }
  return { w: 512, h: 512 };
}
async function inspect(kind, url) {
  const buf = await fetchBytes(url, MAX_BYTES[kind]);
  const info = kind === 'static' ? checkStatic(buf) : kind === 'animated' ? checkTgs(buf) : checkWebm(buf);
  return Object.assign({ size: buf.length }, info);
}

/* ---------- أدوات عامة ---------- */
const cleanEmoji = e => {
  const s = String(e == null ? '' : e).trim();
  if (!s || s.length > 24) throw new HttpError(400, 'emoji');
  if (!/\p{Extended_Pictographic}/u.test(s)) throw new HttpError(400, 'emoji');
  return s;
};
const cleanTitle = t => {
  const s = String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
  if (s.length < 1 || s.length > 40) throw new HttpError(400, 'title');
  return s;
};
const cleanName = n => {
  const s = String(n == null ? '' : n).trim().toLowerCase();
  if (s.length < 5 || s.length > 32 || !NAME_RE.test(s) || RESERVED.has(s)) throw new HttpError(400, 'name');
  return s;
};
const sref = name => db.collection('stickerSets').doc(name);
const newId = () => crypto.randomBytes(8).toString('hex');

async function ownedSet(tx, uid, isDev, name) {
  const ref = sref(cleanName(name));
  const s = await (tx ? tx.get(ref) : ref.get());
  if (!s.exists) throw new HttpError(404, 'noset');
  if (s.data().ownerId !== uid && !isDev) throw new HttpError(403, 'owner');
  return { ref, data: s.data() };
}

/* ---------- العمليات ---------- */
async function opCheck(body) {
  let name;
  try { name = cleanName(body.name); } catch (e) { return { ok: false, reason: 'invalid' }; }
  const s = await sref(name).get();
  return s.exists ? { ok: false, reason: 'taken' } : { ok: true };
}

async function opCreate(u, body) {
  const name = cleanName(body.name), title = cleanTitle(body.title), emoji = cleanEmoji(body.emoji);
  if (!KINDS.includes(body.kind)) throw new HttpError(400, 'kind');
  const mine = await db.collection('stickerSets').where('ownerId', '==', u.uid).count().get();
  if (mine.data().count >= MAX_SETS_PER_USER) throw new HttpError(429, 'setlimit');
  const meta = await inspect(body.kind, body.url);
  const now = Date.now(), id = newId();
  const ref = sref(name);
  const udoc = await db.collection('users').doc(u.uid).get();
  const ownerName = String((udoc.exists && udoc.data().displayName) || '').slice(0, 60);
  const thumb = { url: body.url, kind: body.kind };
  await db.runTransaction(async tx => {
    const ex = await tx.get(ref);
    if (ex.exists) throw new HttpError(409, 'taken');
    tx.set(ref, { name, title, ownerId: u.uid, ownerName, kind: body.kind, count: 1, thumb, hidden: false, createdAt: now, updatedAt: now });
    tx.set(ref.collection('stickers').doc(id), { url: body.url, kind: body.kind, emoji, w: meta.w, h: meta.h, size: meta.size, order: 0, at: now });
  });
  return { name, id };
}

async function opAdd(u, body) {
  const emoji = cleanEmoji(body.emoji);
  const { data } = await ownedSet(null, u.uid, false, body.set);     // الإضافة للمالك فقط حتى للمطور
  if (data.ownerId !== u.uid) throw new HttpError(403, 'owner');
  const meta = await inspect(data.kind, body.url);
  const ref = sref(data.name), id = newId(), now = Date.now();
  await db.runTransaction(async tx => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpError(404, 'noset');
    const c = s.data().count || 0;
    if (c >= MAX_PER_SET) throw new HttpError(409, 'full');
    tx.set(ref.collection('stickers').doc(id), { url: body.url, kind: data.kind, emoji, w: meta.w, h: meta.h, size: meta.size, order: c, at: now });
    tx.update(ref, { count: c + 1, updatedAt: now });
  });
  return { id };
}

async function opRemove(u, body) {
  const id = String(body.id || '');
  if (!/^[a-f0-9]{16}$/.test(id)) throw new HttpError(400, 'id');
  await db.runTransaction(async tx => {
    const { ref, data } = await ownedSet(tx, u.uid, false, body.set);
    if (data.ownerId !== u.uid) throw new HttpError(403, 'owner');
    const st = ref.collection('stickers').doc(id);
    const s = await tx.get(st);
    if (!s.exists) throw new HttpError(404, 'nosticker');
    if ((data.count || 0) <= 1) throw new HttpError(409, 'last');          // آخر ملصق: احذف الحزمة كلها
    const first = await tx.get(ref.collection('stickers').orderBy('order').limit(2));
    const upd = { count: (data.count || 1) - 1, updatedAt: Date.now() };
    const firstOther = first.docs.find(d => d.id !== id);
    if (firstOther && (!data.thumb || data.thumb.url === s.data().url)) upd.thumb = { url: firstOther.data().url, kind: firstOther.data().kind };
    tx.delete(st);
    tx.update(ref, upd);
  });
  return {};
}

async function opUpdate(u, body) {
  const id = String(body.id || ''), emoji = cleanEmoji(body.emoji);
  if (!/^[a-f0-9]{16}$/.test(id)) throw new HttpError(400, 'id');
  const { ref, data } = await ownedSet(null, u.uid, false, body.set);
  if (data.ownerId !== u.uid) throw new HttpError(403, 'owner');
  const st = ref.collection('stickers').doc(id);
  if (!(await st.get()).exists) throw new HttpError(404, 'nosticker');
  await st.update({ emoji });
  await ref.update({ updatedAt: Date.now() });
  return {};
}

async function opReorder(u, body) {
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  if (!ids.length || ids.length > MAX_PER_SET || new Set(ids).size !== ids.length || ids.some(i => !/^[a-f0-9]{16}$/.test(i))) throw new HttpError(400, 'ids');
  const { ref, data } = await ownedSet(null, u.uid, false, body.set);
  if (data.ownerId !== u.uid) throw new HttpError(403, 'owner');
  const all = await ref.collection('stickers').get();
  const have = new Set(all.docs.map(d => d.id));
  if (have.size !== ids.length || ids.some(i => !have.has(i))) throw new HttpError(400, 'ids');
  const batch = db.batch();
  ids.forEach((i, n) => batch.update(ref.collection('stickers').doc(i), { order: n }));
  const first = all.docs.find(d => d.id === ids[0]).data();
  batch.update(ref, { thumb: { url: first.url, kind: first.kind }, updatedAt: Date.now() });
  await batch.commit();
  return {};
}

async function opRename(u, body) {
  const title = cleanTitle(body.title);
  const { ref, data } = await ownedSet(null, u.uid, false, body.set);
  if (data.ownerId !== u.uid) throw new HttpError(403, 'owner');
  await ref.update({ title, updatedAt: Date.now() });
  return {};
}

async function opDelete(u, body) {
  const { ref } = await ownedSet(null, u.uid, u.isDev, body.set);       // المالك أو المطور
  for (;;) {
    const snap = await ref.collection('stickers').limit(200).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  const rep = await ref.collection('reports').get();
  if (!rep.empty) { const b = db.batch(); rep.docs.forEach(d => b.delete(d.ref)); await b.commit(); }
  await ref.delete();
  return {};
}

async function opReport(u, body) {
  const reason = ['spam', 'abuse', 'adult', 'copyright', 'other'].includes(body.reason) ? body.reason : 'other';
  const ref = sref(cleanName(body.set));
  await db.runTransaction(async tx => {
    const s = await tx.get(ref);
    if (!s.exists) throw new HttpError(404, 'noset');
    if (s.data().ownerId === u.uid) throw new HttpError(400, 'own');
    const rref = ref.collection('reports').doc(u.uid);
    const r = await tx.get(rref);
    const agg = await tx.get(ref.collection('reports'));
    const distinct = agg.size + (r.exists ? 0 : 1);
    tx.set(rref, { reason, at: Date.now() });
    if (distinct >= REPORTS_TO_HIDE && !s.data().hidden) tx.update(ref, { hidden: true, hiddenBy: 'reports', updatedAt: Date.now() });
  });
  return {};
}

async function opDevHide(u, body) {
  if (!u.isDev) throw new HttpError(403, 'dev');
  const ref = sref(cleanName(body.set));
  if (!(await ref.get()).exists) throw new HttpError(404, 'noset');
  await ref.update({ hidden: body.hidden === true, hiddenBy: body.hidden === true ? 'dev' : FieldValue.delete(), updatedAt: Date.now() });
  return {};
}

module.exports = async (req, res) => {
  try {
    const { body } = await guard(req);
    const u = await authUser(req, true);
    if (limited('stk:' + u.uid, 60 * 1000, 40)) throw new HttpError(429, 'rate');
    const ops = { check: opCheck, create: opCreate, add: opAdd, remove: opRemove, update: opUpdate, reorder: opReorder, rename: opRename, delete: opDelete, report: opReport, 'dev-hide': opDevHide };
    const fn = ops[body.op];
    if (!fn) throw new HttpError(400, 'op');
    const out = await (fn === opCheck ? fn(body) : fn(u, body));
    return res.status(200).json(Object.assign({ ok: true }, out));
  } catch (e) { return send(res, e); }
};
module.exports._test = { checkStatic, checkTgs, checkWebm, webpInfo, pngInfo, cleanName, cleanEmoji, URL_RE };
