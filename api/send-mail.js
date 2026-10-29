/* api/send-mail.js — Babylon Chat Golden Emails
   Environment:
   FIREBASE_SERVICE_ACCOUNT, GMAIL_USER, GMAIL_APP_PASSWORD
   Types: verify | reset | login-send | login-verify | email-change
*/

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

/* Rate limiting */
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

/* HTML escaping */
const esc = s =>
  String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

/* Golden logo URL */
function logoUrl(req) {
  const base = String(
    process.env.BABYLON_APP_URL ||
    process.env.APP_URL ||
    ('https://' + String(
      req.headers.host || 'telegram-pi-rouge.vercel.app'
    ))
  ).replace(/\/+$/, '');

  return base + '/babylon-email-logo-gold.png';
}

/* Email signature */
const SIGN =
  '<div style="' +
    'border-top:1px solid #ead9a4;' +
    'margin-top:28px;' +
    'padding-top:18px;' +
    'line-height:2;' +
    'color:#39342a;' +
    'text-align:right;' +
  '">' +
    'تحياتنا،<br>' +
    '<b style="color:#a87508">فريق Babylon Chat</b>' +
    ' <span style="color:#d3aa43">◆</span>' +
  '</div>';

/* Main golden email wrapper.
   Logo is passed per request to avoid shared mutable state. */
const WRAP = (inner, logo) =>
  '<!doctype html>' +
  '<html>' +
  '<head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">' +
  '</head>' +

  '<body style="' +
    'margin:0;' +
    'padding:0;' +
    'background:#f7f5ef;' +
    'font-family:Tahoma,Arial,sans-serif;' +
    'color:#242424;' +
  '">' +

  '<div dir="rtl" style="' +
    'max-width:680px;' +
    'margin:0 auto;' +
    'padding:22px 12px;' +
  '">' +

    '<div style="' +
      'border:2px solid #d7b24a;' +
      'border-radius:28px;' +
      'overflow:hidden;' +
      'background:#ffffff;' +
      'box-shadow:0 8px 30px rgba(150,110,20,.10);' +
    '">' +

      '<div style="' +
        'height:8px;' +
        'background:linear-gradient(90deg,#a87508,#f9e7a5,#d2a32f,#fff0b5,#a87508);' +
      '"></div>' +

      '<div style="padding:30px 24px 32px;">' +

        '<div style="text-align:center;margin:0 0 30px;">' +

          '<img src="' +
            esc(logo || 'https://telegram-pi-rouge.vercel.app/babylon-email-logo-gold.png') +
            '" alt="Babylon Chat" width="100" height="100" ' +
            'style="' +
              'display:block;' +
              'width:100px;' +
              'height:100px;' +
              'object-fit:contain;' +
              'margin:0 auto 12px;' +
            '">' +

          '<div style="' +
            'font-size:32px;' +
            'font-weight:bold;' +
            'line-height:1.4;' +
            'color:#b8860b;' +
          '">Babylon Chat</div>' +

          '<div style="' +
            'height:2px;' +
            'width:115px;' +
            'margin:14px auto 0;' +
            'background:linear-gradient(90deg,#fff0b5,#c89b2d,#fff0b5);' +
          '"></div>' +

        '</div>' +

        '<div style="' +
          'background:#fff;' +
          'border-right:4px solid #d5ae43;' +
          'padding-right:15px;' +
        '">' +

          inner +

        '</div>' +

      '</div>' +

      '<div style="' +
        'height:8px;' +
        'background:linear-gradient(90deg,#a87508,#f9e7a5,#d2a32f,#fff0b5,#a87508);' +
      '"></div>' +

    '</div>' +

    '<div style="' +
      'text-align:center;' +
      'color:#93866a;' +
      'font-size:11px;' +
      'margin-top:14px;' +
    '">Babylon Chat</div>' +

  '</div>' +

  '</body></html>';

/* Verification and password-reset email */
function page(title, text, btn, link, foot, hello, logo) {
  return WRAP(

    '<h2 style="' +
      'color:#a87508;' +
      'font-size:27px;' +
      'line-height:1.6;' +
      'margin:0 0 18px;' +
      'text-align:right;' +
    '">' +
      esc(title) +
    '</h2>' +

    '<p style="' +
      'line-height:1.9;' +
      'margin:0 0 8px;' +
      'font-weight:bold;' +
      'font-size:18px;' +
    '">' +
      hello +
    '</p>' +

    '<p style="' +
      'line-height:2;' +
      'margin:0 0 20px;' +
      'font-size:16px;' +
      'color:#333333;' +
    '">' +
      text +
    '</p>' +

    '<div style="text-align:center;margin:28px 0 25px;">' +

      '<a href="' + esc(link) + '" style="' +
        'background-color:#c99a25;' +
        'background-image:linear-gradient(135deg,#f8e6a3,#d3a331,#a87508);' +
        'color:#ffffff;' +
        'padding:15px 30px;' +
        'border-radius:12px;' +
        'text-decoration:none;' +
        'font-weight:bold;' +
        'display:inline-block;' +
        'font-size:16px;' +
        'box-shadow:0 5px 15px rgba(190,150,40,.25);' +
      '">' +
        esc(btn) +
      '</a>' +

    '</div>' +

    '<p style="' +
      'color:#756b54;' +
      'font-size:13px;' +
      'line-height:1.9;' +
      'margin:0 0 14px;' +
    '">' +
      esc(foot) +
    '</p>' +

    SIGN,

    logo
  );
}

/* Login verification code email */
function codePage(code, logo) {
  return WRAP(

    '<div style="text-align:center;margin:0 0 22px;">' +

      '<h2 style="' +
        'color:#a87508;' +
        'font-size:27px;' +
        'line-height:1.7;' +
        'margin:0;' +
      '">' +
        'رمز الدخول إلى Babylon Chat 🔐' +
      '</h2>' +

    '</div>' +

    '<p style="' +
      'line-height:1.9;' +
      'margin:0 0 8px;' +
      'font-weight:bold;' +
      'font-size:19px;' +
    '">' +
      'هلا بيك! 👋' +
    '</p>' +

    '<p style="' +
      'line-height:2;' +
      'margin:0 0 24px;' +
      'font-size:16px;' +
      'color:#333333;' +
    '">' +
      'هذا رمز التحقق حتى تكمل تسجيل الدخول. صالح لمدة 10 دقائق:' +
    '</p>' +

    '<div dir="ltr" style="' +
      'text-align:center;' +
      'font-size:43px;' +
      'letter-spacing:7px;' +
      'font-weight:bold;' +
      'background:linear-gradient(135deg,#fff9e6,#fff1c4,#fff9e6);' +
      'border:2px solid #d5ad43;' +
      'border-radius:22px;' +
      'padding:24px 7px;' +
      'margin:0 0 24px;' +
      'color:#624400;' +
      'box-shadow:inset 0 1px 5px rgba(190,150,40,.08);' +
    '">' +
      esc(code) +
    '</div>' +

    '<div style="' +
      'background:#fff7f5;' +
      'border:1px solid #f0c7c1;' +
      'border-right:5px solid #b91c1c;' +
      'border-radius:8px;' +
      'padding:14px 15px;' +
      'color:#a51d1d;' +
      'font-size:15px;' +
      'line-height:2;' +
      'margin:0 0 22px;' +
    '">' +
      'لا تعطي هذا الرمز لأي أحد، حتى لو ادّعى أنه من فريق Babylon Chat. ' +
      'إذا لم تطلب تسجيل الدخول، تجاهل الرسالة وغيّر كلمة مرورك فوراً ' +
      'إذا شككت بوجود نشاط غير مألوف.' +
    '</div>' +

    SIGN,

    logo
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
    /* ---------- Account verification email ---------- */
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

    /* ---------- Password reset ---------- */
    if (body.type === 'reset') {
      let email = String(body.email || '')
        .trim()
        .toLowerCase();

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
        const link = await admin.auth()
          .generatePasswordResetLink(email);

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
        if (!(e && e.code === 'auth/user-not-found')) {
          throw e;
        }
      }

      return res.status(200).json({ ok: true });
    }

    /* ---------- Login code: send ---------- */
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

        if (hourCount >= 6) {
          return false;
        }

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

    /* ---------- Login code: verify ---------- */
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
          return {
            error: 'invalid',
            left: 4 - d.tries
          };
        }

        tx.update(ref, { h: null });
        return { ok: true };
      });

      if (!r.ok) {
        return res.status(
          r.error === 'locked' ? 429 : 400
        ).json(r);
      }

      const rec = await admin.auth().getUser(dec.uid);

      await admin.auth().setCustomUserClaims(
        dec.uid,
        Object.assign(
          {},
          rec.customClaims || {},
          { otpAuthTime: dec.auth_time }
        )
      );

      return res.status(200).json({ ok: true });
    }

    /* ---------- Change email ---------- */
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

      /* Notify the old email address */
      transporter.sendMail({
        from: FROM(),
        to: dec.email,
        subject: 'طلب تغيير بريد حسابك - Babylon Chat',
        html: WRAP(
          '<h2 style="color:#a87508;margin:0 0 14px">' +
            'طلب تغيير البريد ⚠️</h2>' +

          '<p style="line-height:1.9;margin:0 0 14px">' +
            'وصلنا طلب لتغيير بريد حسابك إلى ' +
            '<b dir="ltr">' + esc(ne) + '</b>. ' +
            'إذا ما أنت اللي طلبت، غيّر كلمة المرور فوراً.' +
          '</p>' +

          SIGN,

          logoUrl(req)
        )
      }).catch(() => {});

      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'type' });

  } catch (e) {
    console.error(
      'send-mail',
      e && e.code,
      e && e.message
    );

    return res.status(500).json({ error: 'server' });
  }
};
