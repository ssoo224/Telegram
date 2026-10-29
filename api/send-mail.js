/* api/send-mail.js — رسائل بابل + رمز التحقق عند تسجيل الدخول
   المتغيرات بـ Vercel: FIREBASE_SERVICE_ACCOUNT, GMAIL_USER, GMAIL_APP_PASSWORD
   الأنواع: verify | reset | login-send | login-verify | email-change */

const crypto = require('crypto');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    )
  });
}

const db = admin.firestore();

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

const FROM = () => '"Babylon Chat" <' + process.env.GMAIL_USER + '>';

/* تحديد عدد الطلبات */
const hits = new Map();

function limited(key, ms, max) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < ms);

  if (arr.length >= max) {
    hits.set(key, arr);
    return true;
  }

  arr.push(now);
  hits.set(key, arr);

  if (hits.size > 5000) hits.clear();

  return false;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

/* رابط شعار Babylon */
const logoUrl = req => {
  const base = String(
    process.env.BABYLON_APP_URL ||
    process.env.APP_URL ||
    ('https://' + String(
      req.headers.host || 'telegram-pi-rouge.vercel.app'
    ))
  ).replace(/\/+$/, '');

  return base + '/babylon-email-logo.png';
};

/* توقيع الرسائل */
const SIGN =
  '<div style="border-top:1px solid #e9d9ad;margin-top:24px;padding-top:16px;line-height:1.9;color:#303030">' +
  'تحياتنا،<br>' +
  '<b style="color:#a87508">فريق Babylon Chat</b> ' +
  '<span style="color:#c99a25">◆</span></div>';

/* القالب الذهبي الرئيسي */
const WRAP = (inner, logo) =>
  '<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:620px;margin:0 auto;padding:12px;background:#fffdf7;color:#202124">' +
  '<div style="border:2px solid #d9aa35;border-radius:24px;overflow:hidden;background:#fff;padding:26px 22px;box-shadow:0 8px 28px rgba(171,125,14,.12)">' +

  '<div style="text-align:center;margin:0 0 18px">' +
  '<img src="' +
  esc(logo || 'https://telegram-pi-rouge.vercel.app/babylon-email-logo.png') +
  '" alt="Babylon Chat" width="82" height="82" style="display:block;width:82px;height:82px;object-fit:cover;border-radius:20px;margin:0 auto 10px;border:1px solid #e6c66e">' +

  '<div style="font-size:26px;font-weight:bold;color:#b8860b;letter-spacing:.2px">Babylon Chat</div>' +
  '</div>' +

  inner +
  '</div></div>';

/* قالب الرسائل العادية */
function page(title, text, btn, link, foot, hello, logo) {
  return WRAP(
    '<h2 style="color:#a87508;font-size:25px;line-height:1.6;margin:0 0 18px;text-align:right">' +
    esc(title) +
    '</h2>' +

    '<p style="line-height:1.9;margin:0 0 8px;font-weight:bold;font-size:17px">' +
    hello +
    '</p>' +

    '<p style="line-height:1.95;margin:0 0 18px;font-size:16px">' +
    text +
    '</p>' +

    '<div style="text-align:center;margin:26px 0 22px">' +
    '<a href="' + esc(link) +
    '" style="background:#c99a25;background-image:linear-gradient(135deg,#f7df91,#d7aa36,#a87508);color:#fff;padding:14px 28px;border-radius:12px;text-decoration:none;font-weight:bold;display:inline-block;font-size:16px;box-shadow:0 5px 14px rgba(190,150,40,.25)">' +
    esc(btn) +
    '</a></div>' +

    '<p style="color:#6b6250;font-size:13px;line-height:1.8;margin:0 0 14px">' +
    esc(foot) +
    '</p>' +

    SIGN,
    logo || 'https://telegram-pi-rouge.vercel.app/babylon-email-logo.png'
  );
}

/* قالب رمز تسجيل الدخول */
function codePage(code, logo) {
  return WRAP(
    '<h2 style="color:#a87508;font-size:25px;line-height:1.6;margin:0 0 18px;text-align:center">🔐 رمز الدخول إلى Babylon Chat</h2>' +

    '<p style="line-height:1.9;margin:0 0 8px;font-weight:bold;font-size:17px">هلا بيك! 👋</p>' +

    '<p style="line-height:1.95;margin:0 0 22px;font-size:16px">هذا رمز التحقق حتى تكمل تسجيل الدخول. صالح لمدة 10 دقائق:</p>' +

    '<div dir="ltr" style="text-align:center;font-size:36px;letter-spacing:8px;font-weight:bold;background:#fff7dc;border:2px solid #d9aa35;border-radius:18px;padding:20px 8px;margin:0 0 22px;color:#674400">' +
    esc(code) +
    '</div>' +

    '<p style="background:#fff7f5;border-right:4px solid #b91c1c;padding:12px 14px;color:#a51d1d;font-size:14px;line-height:1.9;margin:0 0 18px">لا تعطي هذا الرمز لأي أحد، حتى لو ادّعى أنه من فريق Babylon Chat. إذا لم تطلب تسجيل الدخول، تجاهل الرسالة وغيّر كلمة مرورك إذا شككت بوجود نشاط غير مألوف.</p>' +

    SIGN,
    logo || 'https://telegram-pi-rouge.vercel.app/babylon-email-logo.png'
  );
}

const sha = (salt, uid, code) =>
  crypto.createHash('sha256')
    .update(salt + ':' + uid + ':' + code)
    .digest('hex');

const otpOk = d =>
  d.otpAuthTime != null &&
  Number(d.otpAuthTime) === Number(d.auth_time);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method' });
  }

  const origin = req.headers.origin || '';

  if (origin && new URL(origin).host !== req.headers.host) {
    return res.status(403).json({ error: 'origin' });
  }

  if (process.env.APPCHECK_ENFORCE === '1') {
    const t = req.headers['x-firebase-appcheck'];

    try {
      if (!t) throw new Error('no');
      await admin.appCheck().verifyToken(t);
    } catch (e) {
      return res.status(401).json({ error: 'appcheck' });
    }
  }

  const body = typeof req.body === 'string'
    ? JSON.parse(req.body || '{}')
    : (req.body || {});

  const ip = String(
    req.headers['x-forwarded-for'] || ''
  ).split(',')[0].trim() || 'x';

  const bearer = /^Bearer (.+)$/.exec(
    req.headers.authorization || ''
  );

  try {
    /* ---------- رسالة تأكيد الحساب ---------- */
    if (body.type === 'verify') {
      if (!bearer) {
        return res.status(401).json({ error: 'auth' });
      }

      const dec = await admin.auth().verifyIdToken(bearer[1]);

      if (!dec.email) {
        return res.status(400).json({ error: 'email' });
      }

      if (dec.email_verified) {
        return res.status(200).json({ ok: true });
      }

      if (
        limited('v:' + dec.uid, 60000, 1) ||
        limited('vip:' + ip, 3600000, 20)
      ) {
        return res.status(429).json({ error: 'rate' });
      }

      const link = await admin.auth()
        .generateEmailVerificationLink(dec.email);

      await transporter.sendMail({
        from: FROM(),
        to: dec.email,
        subject: 'أهلاً بيك في Babylon Chat - فعّل حسابك',
        html: page(
          'نورتنا في Babylon Chat 🎉',
          'خطوة وحدة بس وتبدي: اضغط على الزر حتى نفعّل حسابك وتنطلق بالدردشة.',
          'فعّل حسابي',
          link,
          'إذا ما أنت اللي سجّلت، تجاهل هذه الرسالة وما راح يصير شي.',
          'هلا والله بيك! 👋',
          logoUrl(req)
        )
      });

      return res.status(200).json({ ok: true });
    }

    /* ---------- نسيان كلمة السر ---------- */
    if (body.type === 'reset') {
      let email = String(body.email || '').trim().toLowerCase();

      if (!email && body.username) {
        const un = String(body.username)
          .trim()
          .replace(/^@/, '')
          .toLowerCase();

        if (!/^[a-z0-9_.]{3,32}$/.test(un)) {
          return res.status(200).json({ ok: true });
        }

        if (limited('ru:' + ip, 3600000, 10)) {
          return res.status(429).json({ error: 'rate' });
        }

        const ud = await db.collection('usernames').doc(un).get();

        if (!ud.exists || !ud.data().email) {
          return res.status(200).json({ ok: true });
        }

        email = String(ud.data().email).toLowerCase();
      }

      if (!/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(email)) {
        return res.status(400).json({ error: 'email' });
      }

      if (
        limited('r:' + email, 60000, 1) ||
        limited('rip:' + ip, 3600000, 10)
      ) {
        return res.status(429).json({ error: 'rate' });
      }

      try {
        const link = await admin.auth().generatePasswordResetLink(email);

        await transporter.sendMail({
          from: FROM(),
          to: email,
          subject: 'إعادة تعيين كلمة المرور - Babylon Chat',
          html: page(
            'نسيت كلمة المرور؟ ولا يهمك 😉',
            'وصلنا طلب لتغيير كلمة المرور لحسابك (' +
              esc(email) +
              '). اضغط على الزر وسوّي كلمة سر جديدة بثواني.',
            'غيّر كلمة المرور',
            link,
            'إذا ما أنت اللي طلبت، تجاهل الرسالة وكلمة سرك تبقى مثل ما هي.',
            'هلا بيك! 👋',
            logoUrl(req)
          )
        });
      } catch (e) {
        if (!(e && e.code === 'auth/user-not-found')) throw e;
      }

      return res.status(200).json({ ok: true });
    }

    /* ---------- رمز الدخول: إرسال ---------- */
    if (body.type === 'login-send') {
      if (!bearer) {
        return res.status(401).json({ error: 'auth' });
      }

      const dec = await admin.auth().verifyIdToken(bearer[1]);

      if (!dec.email || !dec.email_verified) {
        return res.status(400).json({ error: 'unverified' });
      }

      const ref = db.collection('loginCodes').doc(dec.uid);
      const code = String(crypto.randomInt(100000, 1000000));
      const salt = crypto.randomBytes(12).toString('hex');

      const allowed = await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const d = snap.exists ? snap.data() : {};
        const now = Date.now();

        if (d.lastSent && now - d.lastSent < 60000) {
          return false;
        }

        let hourStart = d.hourStart || now;
        let hourCount = d.hourCount || 0;

        if (now - hourStart > 3600000) {
          hourStart = now;
          hourCount = 0;
        }

        if (hourCount >= 6) return false;

        tx.set(ref, {
          h: sha(salt, dec.uid, code),
          salt,
          exp: now + 600000,
          tries: 0,
          authTime: dec.auth_time,
          lastSent: now,
          hourStart,
          hourCount: hourCount + 1
        });

        return true;
      });

      if (!allowed) {
        return res.status(429).json({ error: 'rate' });
      }

      await transporter.sendMail({
        from: FROM(),
        to: dec.email,
        subject: 'رمز الدخول إلى Babylon Chat: ' + code,
        html: codePage(code, logoUrl(req))
      });

      return res.status(200).json({ ok: true });
    }

    /* ---------- رمز الدخول: تحقق ---------- */
    if (body.type === 'login-verify') {
      if (!bearer) {
        return res.status(401).json({ error: 'auth' });
      }

      const dec = await admin.auth().verifyIdToken(bearer[1]);
      const code = String(body.code || '').trim();

      if (!/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: 'invalid' });
      }

      const ref = db.collection('loginCodes').doc(dec.uid);

      const r = await db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        const d = snap.exists ? snap.data() : null;

        if (!d || !d.h || d.authTime !== dec.auth_time) {
          return { error: 'expired' };
        }

        if (Date.now() > d.exp) {
          return { error: 'expired' };
        }

        if (d.tries >= 5) {
          return { error: 'locked' };
        }

        const good = crypto.timingSafeEqual(
          Buffer.from(sha(d.salt, dec.uid, code)),
          Buffer.from(d.h)
        );

        if (!good) {
          tx.update(ref, { tries: d.tries + 1 });
          return { error: 'invalid', left: 4 - d.tries };
        }

        tx.update(ref, { h: null });
        return { ok: true };
      });

      if (!r.ok) {
        return res.status(r.error === 'locked' ? 429 : 400).json(r);
      }

      const rec = await admin.auth().getUser(dec.uid);

      await admin.auth().setCustomUserClaims(
        dec.uid,
        Object.assign({}, rec.customClaims || {}, {
          otpAuthTime: dec.auth_time
        })
      );

      /* حسابات المطورين: توثيق تلقائي */
      const DEVS = [
        'anldheb429@gmail.com',
        'hamodeygame45@gmail.com'
      ]
        .concat(String(process.env.DEV_EMAIL || '').split(','))
        .concat(String(process.env.DEV_EMAILS || '').split(','))
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);

      if (DEVS.includes(String(dec.email || '').toLowerCase())) {
        try {
          const uref = db.collection('users').doc(dec.uid);

          if ((await uref.get()).exists) {
            await uref.update({
              isVerified: true,
              isDev: true
            });
          }
        } catch (e) {}
      }

      return res.status(200).json({ ok: true });
    }

    /* ---------- تغيير الإيميل ---------- */
    if (body.type === 'email-change') {
      if (!bearer) {
        return res.status(401).json({ error: 'auth' });
      }

      const dec = await admin.auth().verifyIdToken(bearer[1]);

      if (!otpOk(dec) || !dec.email) {
        return res.status(403).json({ error: 'otp' });
      }

      const ne = String(body.newEmail || '')
        .trim()
        .toLowerCase();

      if (
        !/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(ne) ||
        ne === dec.email.toLowerCase()
      ) {
        return res.status(400).json({ error: 'email' });
      }

      if (
        limited('ec:' + dec.uid, 60000, 1) ||
        limited('ecd:' + dec.uid, 86400000, 5)
      ) {
        return res.status(429).json({ error: 'rate' });
      }

      let link;

      try {
        link = await admin.auth()
          .generateVerifyAndChangeEmailLink(dec.email, ne);
      } catch (e) {
        if (
          e &&
          /email-already-exists|EMAIL_EXISTS/.test(
            (e.code || '') + (e.message || '')
          )
        ) {
          return res.status(409).json({ error: 'exists' });
        }

        throw e;
      }

      await transporter.sendMail({
        from: FROM(),
        to: ne,
        subject: 'تأكيد البريد الجديد - Babylon Chat',
        html: page(
          'تأكيد بريدك الجديد ✉️',
          'طلبت تغيير بريد حسابك إلى هذا العنوان. اضغط على الزر حتى نكمل التغيير.',
          'تأكيد البريد الجديد',
          link,
          'إذا ما أنت اللي طلبت، تجاهل الرسالة وما راح يتغير شي.',
          'هلا بيك! 👋',
          logoUrl(req)
        )
      });

      /* تنبيه للبريد القديم */
      transporter.sendMail({
        from: FROM(),
        to: dec.email,
        subject: 'طلب تغيير بريد حسابك - Babylon Chat',
        html: WRAP(
          '<h2 style="color:#a87508;margin:0 0 14px">طلب تغيير البريد ⚠️</h2>' +
          '<p style="line-height:1.9;margin:0 0 14px">وصلنا طلب لتغيير بريد حسابك إلى <b dir="ltr">' +
          esc(ne) +
          '</b>. إذا ما أنت اللي طلبت، غيّر كلمة المرور فوراً.</p>' +
          SIGN,
          logoUrl(req)
        )
      }).catch(() => {});

      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'type' });

  } catch (e) {
    console.error('send-mail', e && e.code, e && e.message);
    return res.status(500).json({ error: 'server' });
  }
};
