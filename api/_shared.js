/* api/_shared.js — أدوات مشتركة (الملفات اللي تبدأ بـ _ ما تصير روابط) */
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const DEV_EMAIL = String(process.env.DEV_EMAIL || 'anldheb429@gmail.com').toLowerCase();
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyDxQZCL4OawmPLKLRdQdbrQOHN7vl3p5EQ';   /* مفتاح الويب عام أصلاً */

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com', port: 465, secure: true,
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
});
const FROM = () => '"Babylon Chat" <' + process.env.GMAIL_USER + '>';

const hits = new Map();
function limited(key, ms, max) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < ms);
  if (arr.length >= max) { hits.set(key, arr); return true; }
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return false;
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SIGN = '<p style="line-height:1.8;margin:0;border-top:1px solid #eee;padding-top:12px">تحياتنا،<br><b style="color:#b8860b">فريق Babylon Chat</b> 💛</p>';
const WRAP = inner => '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:480px;margin:auto;padding:26px;border:1px solid #e5e7eb;border-radius:16px;text-align:right;background:#fff;color:#17212b">' + inner + '</div>';

class HttpError extends Error { constructor(status, code, extra) { super(code); this.status = status; this.code = code; this.extra = extra || {}; } }

/* فحص الطلب العام: POST + من موقعنا + App Check (إذا مفعّل) */
async function guard(req) {
  if (req.method !== 'POST') throw new HttpError(405, 'method');
  const origin = req.headers.origin || '';
  if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'origin');
  if (process.env.APPCHECK_ENFORCE === '1') {
    const t = req.headers['x-firebase-appcheck'];
    if (!t) throw new HttpError(401, 'appcheck');
    try { await admin.appCheck().verifyToken(t); } catch (e) { throw new HttpError(401, 'appcheck'); }
  }
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  return { body, ip };
}
/* المستخدم المسجّل: بريده مؤكد (+ جلسة تحققت بالرمز إذا requireOtp) */
async function authUser(req, requireOtp) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) throw new HttpError(401, 'auth');
  let dec;
  try { dec = await admin.auth().verifyIdToken(m[1]); } catch (e) { throw new HttpError(401, 'auth'); }
  if (!dec.email || !dec.email_verified) throw new HttpError(403, 'unverified');
  if (requireOtp && !(dec.otpAuthTime != null && Number(dec.otpAuthTime) === Number(dec.auth_time))) throw new HttpError(403, 'otp');
  dec.isDev = String(dec.email).toLowerCase() === DEV_EMAIL;
  return dec;
}
function send(res, e) {
  if (e instanceof HttpError) return res.status(e.status).json(Object.assign({ error: e.code }, e.extra));
  console.error('api error', e && e.code, e && e.message);
  return res.status(500).json({ error: 'server' });
}
async function ensureChat(a, b, now) {
  const cref = db.collection('chats').doc([a, b].sort().join('__'));
  const cs = await cref.get();
  if (cs.exists) await cref.update({ updatedAt: now }); else await cref.set({ participants: [a, b], updatedAt: now });
  return cref;
}
module.exports = { admin, db, FieldValue, DEV_EMAIL, WEB_API_KEY, transporter, FROM, limited, esc, SIGN, WRAP, HttpError, guard, authUser, send, ensureChat };
