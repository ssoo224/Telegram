/* api/send-mail.js — يرسل رسائل التأكيد ونسيان كلمة السر من Gmail بتصميم بابل
   المتغيرات المطلوبة بـ Vercel (Environment Variables):
   FIREBASE_SERVICE_ACCOUNT  = محتوى ملف JSON كامل
   GMAIL_USER                = BabylnSupport@gmail.com
   GMAIL_APP_PASSWORD        = App Password (16 حرف) */
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com', port: 465, secure: true,
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
});

/* حد للمرات (best-effort داخل نفس النسخة) */
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
function page(title, text, btn, link, foot) {
  return '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:480px;margin:auto;padding:26px;border:1px solid #e5e7eb;border-radius:16px;text-align:right;background:#fff;color:#17212b">'
    + '<h2 style="color:#b8860b;margin:0 0 14px">' + esc(title) + '</h2>'
    + '<p style="line-height:1.8;margin:0 0 18px">' + text + '</p>'
    + '<p style="text-align:center;margin:26px 0"><a href="' + esc(link) + '" style="background:#d4a937;color:#17212b;padding:13px 30px;border-radius:10px;text-decoration:none;font-weight:bold;display:inline-block">' + esc(btn) + '</a></p>'
    + '<p style="color:#6b7280;font-size:13px;line-height:1.7;margin:0">' + esc(foot) + '</p></div>';
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  /* نقبل الطلبات من موقعنا فقط */
  const origin = req.headers.origin || '';
  if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'origin' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  try {
    if (body.type === 'verify') {
      const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
      if (!m) return res.status(401).json({ error: 'auth' });
      const dec = await admin.auth().verifyIdToken(m[1]);
      if (!dec.email) return res.status(400).json({ error: 'email' });
      if (dec.email_verified) return res.status(200).json({ ok: true });
      if (limited('v:' + dec.uid, 60000, 1) || limited('vip:' + ip, 3600000, 20)) return res.status(429).json({ error: 'rate' });
      const link = await admin.auth().generateEmailVerificationLink(dec.email);
      await transporter.sendMail({
        from: '"بابل" <' + process.env.GMAIL_USER + '>', to: dec.email,
        subject: 'فعّل حسابك في بابل',
        html: page('أهلاً بيك في بابل', 'اضغط على الزر حتى تفعّل حسابك:', 'تفعيل الحساب', link, 'إذا ما أنت اللي سجّلت، تجاهل هذه الرسالة.')
      });
      return res.status(200).json({ ok: true });
    }

    if (body.type === 'reset') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email)) return res.status(400).json({ error: 'email' });
      if (limited('r:' + email, 60000, 1) || limited('rip:' + ip, 3600000, 10)) return res.status(429).json({ error: 'rate' });
      try {
        const link = await admin.auth().generatePasswordResetLink(email);
        await transporter.sendMail({
          from: '"بابل" <' + process.env.GMAIL_USER + '>', to: email,
          subject: 'إعادة تعيين كلمة المرور - بابل',
          html: page('إعادة تعيين كلمة المرور', 'طلبنا إعادة تعيين كلمة المرور لحسابك (' + esc(email) + '). اضغط على الزر:', 'تغيير كلمة المرور', link, 'إذا ما أنت اللي طلبت، تجاهل الرسالة وكلمة سرك تبقى كما هي.')
        });
      } catch (e) {
        if (!(e && e.code === 'auth/user-not-found')) throw e;   /* لا نكشف هل الإيميل مسجل */
      }
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'type' });
  } catch (e) {
    console.error('send-mail', e && e.code, e && e.message);
    return res.status(500).json({ error: 'server' });
  }
};
