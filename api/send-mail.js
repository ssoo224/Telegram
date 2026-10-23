/* api/send-mail.js — رسائل بابل + رمز التحقق عند تسجيل الدخول
   المتغيرات بـ Vercel: FIREBASE_SERVICE_ACCOUNT, GMAIL_USER, GMAIL_APP_PASSWORD
   الأنواع: verify | reset | login-send | login-verify | email-change */
const crypto = require('crypto');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
const db = admin.firestore();
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com', port: 465, secure: true,
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
});
const FROM = () => '"Babylon Chat" <' + process.env.GMAIL_USER + '>';

/* حد للمرات (best-effort داخل نفس النسخة) — رموز الدخول لها حد دائم بـ Firestore */
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
function page(title, text, btn, link, foot, hello) {
  return WRAP('<h2 style="color:#b8860b;margin:0 0 14px">' + esc(title) + '</h2>'
    + '<p style="line-height:1.9;margin:0 0 6px;font-weight:bold">' + hello + '</p>'
    + '<p style="line-height:1.9;margin:0 0 18px">' + text + '</p>'
    + '<p style="text-align:center;margin:26px 0"><a href="' + esc(link) + '" style="background:#d4a937;color:#17212b;padding:13px 30px;border-radius:10px;text-decoration:none;font-weight:bold;display:inline-block">' + esc(btn) + '</a></p>'
    + '<p style="color:#6b7280;font-size:13px;line-height:1.7;margin:0 0 14px">' + esc(foot) + '</p>' + SIGN);
}
function codePage(code) {
  return WRAP('<h2 style="color:#b8860b;margin:0 0 14px">رمز الدخول إلى Babylon Chat 🔐</h2>'
    + '<p style="line-height:1.9;margin:0 0 6px;font-weight:bold">هلا بيك! 👋</p>'
    + '<p style="line-height:1.9;margin:0 0 18px">هذا رمز التحقق حتى تكمل تسجيل الدخول. صالح لمدة 10 دقائق:</p>'
    + '<p dir="ltr" style="text-align:center;font-size:34px;letter-spacing:10px;font-weight:bold;background:#faf5e4;border-radius:12px;padding:14px 0;margin:0 0 18px;color:#17212b">' + code + '</p>'
    + '<p style="color:#b91c1c;font-size:13px;line-height:1.7;margin:0 0 14px">لا تعطي هذا الرمز لأي أحد، حتى لو ادّعى إنه من فريق Babylon Chat. إذا ما أنت اللي تحاول تدخل، غيّر كلمة المرور فوراً.</p>' + SIGN);
}
const sha = (salt, uid, code) => crypto.createHash('sha256').update(salt + ':' + uid + ':' + code).digest('hex');
const otpOk = d => d.otpAuthTime != null && Number(d.otpAuthTime) === Number(d.auth_time);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const origin = req.headers.origin || '';
  if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'origin' });

  if (process.env.APPCHECK_ENFORCE === '1') {
    const t = req.headers['x-firebase-appcheck'];
    try { if (!t) throw new Error('no'); await admin.appCheck().verifyToken(t); } catch (e) { return res.status(401).json({ error: 'appcheck' }); }
  }
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  try {
    /* ---------- رسالة تأكيد الحساب ---------- */
    if (body.type === 'verify') {
      if (!bearer) return res.status(401).json({ error: 'auth' });
      const dec = await admin.auth().verifyIdToken(bearer[1]);
      if (!dec.email) return res.status(400).json({ error: 'email' });
      if (dec.email_verified) return res.status(200).json({ ok: true });
      if (limited('v:' + dec.uid, 60000, 1) || limited('vip:' + ip, 3600000, 20)) return res.status(429).json({ error: 'rate' });
      const link = await admin.auth().generateEmailVerificationLink(dec.email);
      await transporter.sendMail({
        from: FROM(), to: dec.email, subject: 'أهلاً بيك في Babylon Chat - فعّل حسابك',
        html: page('نورتنا في Babylon Chat 🎉', 'خطوة وحدة بس وتبدي: اضغط على الزر حتى نفعّل حسابك وتنطلق بالدردشة.', 'فعّل حسابي', link, 'إذا ما أنت اللي سجّلت، تجاهل هذه الرسالة وما راح يصير شي.', 'هلا والله بيك! 👋')
      });
      return res.status(200).json({ ok: true });
    }

    /* ---------- نسيان كلمة السر ---------- */
    if (body.type === 'reset') {
      let email = String(body.email || '').trim().toLowerCase();
      if (!email && body.username) {           /* يوزر بدل إيميل: نجيب الإيميل بالخادم ولا نرجّعه */
        const un = String(body.username).trim().replace(/^@/, '').toLowerCase();
        if (!/^[a-z0-9_.]{3,32}$/.test(un)) return res.status(200).json({ ok: true });
        if (limited('ru:' + ip, 3600000, 10)) return res.status(429).json({ error: 'rate' });
        const ud = await db.collection('usernames').doc(un).get();
        if (!ud.exists || !ud.data().email) return res.status(200).json({ ok: true });
        email = String(ud.data().email).toLowerCase();
      }
      if (!/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email)) return res.status(400).json({ error: 'email' });
      if (limited('r:' + email, 60000, 1) || limited('rip:' + ip, 3600000, 10)) return res.status(429).json({ error: 'rate' });
      try {
        const link = await admin.auth().generatePasswordResetLink(email);
        await transporter.sendMail({
          from: FROM(), to: email, subject: 'إعادة تعيين كلمة المرور - Babylon Chat',
          html: page('نسيت كلمة المرور؟ ولا يهمك 😉', 'وصلنا طلب لتغيير كلمة المرور لحسابك (' + esc(email) + '). اضغط على الزر وسوّي كلمة سر جديدة بثواني.', 'غيّر كلمة المرور', link, 'إذا ما أنت اللي طلبت، تجاهل الرسالة وكلمة سرك تبقى مثل ما هي.', 'هلا بيك! 👋')
        });
      } catch (e) { if (!(e && e.code === 'auth/user-not-found')) throw e; }
      return res.status(200).json({ ok: true });
    }

    /* ---------- رمز الدخول: إرسال ---------- */
    if (body.type === 'login-send') {
      if (!bearer) return res.status(401).json({ error: 'auth' });
      const dec = await admin.auth().verifyIdToken(bearer[1]);
      if (!dec.email || !dec.email_verified) return res.status(400).json({ error: 'unverified' });
      const ref = db.collection('loginCodes').doc(dec.uid);
      const code = String(crypto.randomInt(100000, 1000000));
      const salt = crypto.randomBytes(12).toString('hex');
      const allowed = await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const d = snap.exists ? snap.data() : {};
        const now = Date.now();
        if (d.lastSent && now - d.lastSent < 60000) return false;
        let hourStart = d.hourStart || now, hourCount = d.hourCount || 0;
        if (now - hourStart > 3600000) { hourStart = now; hourCount = 0; }
        if (hourCount >= 6) return false;
        tx.set(ref, { h: sha(salt, dec.uid, code), salt, exp: now + 600000, tries: 0, authTime: dec.auth_time, lastSent: now, hourStart, hourCount: hourCount + 1 });
        return true;
      });
      if (!allowed) return res.status(429).json({ error: 'rate' });
      await transporter.sendMail({ from: FROM(), to: dec.email, subject: 'رمز الدخول إلى Babylon Chat: ' + code, html: codePage(code) });
      return res.status(200).json({ ok: true });
    }

    /* ---------- رمز الدخول: تحقق ---------- */
    if (body.type === 'login-verify') {
      if (!bearer) return res.status(401).json({ error: 'auth' });
      const dec = await admin.auth().verifyIdToken(bearer[1]);
      const code = String(body.code || '').trim();
      if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'invalid' });
      const ref = db.collection('loginCodes').doc(dec.uid);
      const r = await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const d = snap.exists ? snap.data() : null;
        if (!d || !d.h || d.authTime !== dec.auth_time) return { error: 'expired' };
        if (Date.now() > d.exp) return { error: 'expired' };
        if (d.tries >= 5) return { error: 'locked' };
        const good = crypto.timingSafeEqual(Buffer.from(sha(d.salt, dec.uid, code)), Buffer.from(d.h));
        if (!good) { tx.update(ref, { tries: d.tries + 1 }); return { error: 'invalid', left: 4 - d.tries }; }
        tx.update(ref, { h: null });
        return { ok: true };
      });
      if (!r.ok) return res.status(r.error === 'locked' ? 429 : 400).json(r);
      const rec = await admin.auth().getUser(dec.uid);
      await admin.auth().setCustomUserClaims(dec.uid, Object.assign({}, rec.customClaims || {}, { otpAuthTime: dec.auth_time }));
      return res.status(200).json({ ok: true });
    }

    /* ---------- تغيير الإيميل (يحتاج جلسة تحققت بالرمز) ---------- */
    if (body.type === 'email-change') {
      if (!bearer) return res.status(401).json({ error: 'auth' });
      const dec = await admin.auth().verifyIdToken(bearer[1]);
      if (!otpOk(dec) || !dec.email) return res.status(403).json({ error: 'otp' });
      const ne = String(body.newEmail || '').trim().toLowerCase();
      if (!/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(ne) || ne === dec.email.toLowerCase()) return res.status(400).json({ error: 'email' });
      if (limited('ec:' + dec.uid, 60000, 1) || limited('ecd:' + dec.uid, 86400000, 5)) return res.status(429).json({ error: 'rate' });
      let link;
      try { link = await admin.auth().generateVerifyAndChangeEmailLink(dec.email, ne); }
      catch (e) { if (e && /email-already-exists|EMAIL_EXISTS/.test((e.code || '') + (e.message || ''))) return res.status(409).json({ error: 'exists' }); throw e; }
      await transporter.sendMail({
        from: FROM(), to: ne, subject: 'تأكيد البريد الجديد - Babylon Chat',
        html: page('تأكيد بريدك الجديد ✉️', 'طلبت تغيير بريد حسابك إلى هذا العنوان. اضغط على الزر حتى نكمل التغيير.', 'تأكيد البريد الجديد', link, 'إذا ما أنت اللي طلبت، تجاهل الرسالة وما راح يتغير شي.', 'هلا بيك! 👋')
      });
      /* تنبيه للبريد القديم */
      transporter.sendMail({
        from: FROM(), to: dec.email, subject: 'طلب تغيير بريد حسابك - Babylon Chat',
        html: WRAP('<h2 style="color:#b8860b;margin:0 0 14px">طلب تغيير البريد ⚠️</h2><p style="line-height:1.9;margin:0 0 14px">وصلنا طلب لتغيير بريد حسابك إلى <b dir="ltr">' + esc(ne) + '</b>. إذا ما أنت اللي طلبت، غيّر كلمة المرور فوراً.</p>' + SIGN)
      }).catch(() => {});
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'type' });
  } catch (e) {
    console.error('send-mail', e && e.code, e && e.message);
    return res.status(500).json({ error: 'server' });
  }
};
