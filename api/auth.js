/* api/auth.js — تسجيل الدخول باليوزر بدون كشف الإيميل + توفر اليوزر + البحث عن مستخدم
   جدول usernames صار مقفول عن التطبيق بالقواعد؛ الخادم وحده يقرأه. */
const { db, WEB_API_KEY, limited, HttpError, guard, authUser, send } = require('./_shared');

const UNAME = /^[a-z0-9_.]{3,32}$/;
const clean = s => String(s || '').trim().replace(/^@/, '').toLowerCase();

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { body, ip } = await guard(req);

    /* يتحقق من كلمة السر بالخادم ويرجّع الإيميل فقط إذا كانت صحيحة (فما يتسرّب لأحد غير صاحبه) */
    if (body.type === 'resolve-login') {
      const name = clean(body.username), pw = String(body.password || '');
      if (!UNAME.test(name) || !pw || pw.length > 128) throw new HttpError(401, 'invalid');
      if (limited('rl:' + ip, 600000, 15) || limited('rln:' + name, 600000, 8)) throw new HttpError(429, 'rate');
      const d = await db.collection('usernames').doc(name).get();
      if (!d.exists || !d.data().email) throw new HttpError(401, 'invalid');
      const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + WEB_API_KEY, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: d.data().email, password: pw, returnSecureToken: false })
      });
      if (!r.ok) throw new HttpError(401, 'invalid');
      return res.status(200).json({ email: d.data().email });
    }

    /* هل اليوزر متاح؟ (للتسجيل) */
    if (body.type === 'username-available') {
      const name = clean(body.username);
      if (!UNAME.test(name)) return res.status(200).json({ available: false, reason: 'format' });
      if (limited('ua:' + ip, 60000, 30)) throw new HttpError(429, 'rate');
      const d = await db.collection('usernames').doc(name).get();
      return res.status(200).json({ available: !d.exists });
    }

    /* uid من اليوزر (للبحث والمنشن) — للمسجّلين فقط */
    if (body.type === 'lookup') {
      const u = await authUser(req, true);
      const name = clean(body.username);
      if (!UNAME.test(name)) throw new HttpError(404, 'nouser');
      if (limited('lk:' + u.uid, 60000, 40)) throw new HttpError(429, 'rate');
      const d = await db.collection('usernames').doc(name).get();
      if (!d.exists || !d.data().uid) throw new HttpError(404, 'nouser');
      return res.status(200).json({ uid: d.data().uid });
    }
    throw new HttpError(400, 'type');
  } catch (e) { return send(res, e); }
};
