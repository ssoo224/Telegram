/* api/broadcast.js — لوحة المطوّر: إذاعة إشعار للكل + إحصائيات
   العمليات: stats | send   (للمطوّر فقط، يتحقق السيرفر من البريد) */
const { admin, db, FieldValue, limited, HttpError, guard, authUser, send } = require('./_shared');

const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

async function count(q) {
  const s = await q.count().get();
  return s.data().count;
}

async function opStats() {
  const now = Date.now();
  const users = db.collection('users');
  const [total, day, online, last] = await Promise.all([
    count(users),
    count(users.where('lastSeen', '>', now - 86400000)),
    count(users.where('lastSeen', '>', now - 60000)),
    db.collection('broadcasts').orderBy('at', 'desc').limit(5).get()
  ]);
  return {
    total, day, online,
    last: last.docs.map(d => { const x = d.data(); return { title: x.title, at: x.at, devices: x.devices, sent: x.sent, failed: x.failed }; })
  };
}

async function opSend(uid, body) {
  const title = clip(body.title, 60), text = clip(body.body, 300);
  if (!title || !text) throw new HttpError(400, 'empty');

  /* اجمع كل التوكنات وربطها بصاحبها (حتى نحذف الميتة) */
  const snap = await db.collection('users').select('fcmTokens', 'fcmToken').get();
  const owner = new Map();
  snap.forEach(d => {
    const x = d.data() || {};
    [...(x.fcmTokens || []), ...(x.fcmToken ? [x.fcmToken] : [])].forEach(t => { if (t && !owner.has(t)) owner.set(t, d.id); });
  });
  const tokens = [...owner.keys()];

  let sent = 0, failed = 0;
  const dead = new Map();
  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
    const r = await admin.messaging().sendEachForMulticast({
      tokens: chunk,
      notification: { title, body: text },
      webpush: { notification: { icon: '/icon-512.png', badge: '/badge-96.png' }, fcmOptions: { link: '/' } },
      android: { priority: 'high', notification: { channelId: 'messages' } },
      data: { type: 'broadcast' }
    });
    sent += r.successCount; failed += r.failureCount;
    r.responses.forEach((x, k) => {
      const code = (x.error && x.error.code) || '';
      if (!x.success && /not-registered|invalid-registration|invalid-argument/.test(code)) {
        const u = owner.get(chunk[k]);
        if (!dead.has(u)) dead.set(u, []);
        dead.get(u).push(chunk[k]);
      }
    });
  }

  /* نظّف التوكنات الميتة */
  const jobs = [...dead.entries()];
  for (let i = 0; i < jobs.length; i += 25) {
    await Promise.all(jobs.slice(i, i + 25).map(([u, t]) =>
      db.collection('users').doc(u).update({ fcmTokens: FieldValue.arrayRemove(...t) }).catch(() => {})));
  }

  await db.collection('broadcasts').add({ title, body: text, at: Date.now(), by: uid, devices: tokens.length, sent, failed });
  return { devices: tokens.length, sent, failed, cleaned: jobs.reduce((a, [, t]) => a + t.length, 0) };
}

module.exports = async (req, res) => {
  try {
    const { body } = await guard(req);
    const u = await authUser(req);
    if (!u.isDev) throw new HttpError(403, 'forbidden');
    if (limited('bc:' + u.uid, 60000, 12)) throw new HttpError(429, 'rate');
    if (body.op === 'stats') return res.json(await opStats());
    if (body.op === 'send') {
      if (limited('bcs:' + u.uid, 30000, 1)) throw new HttpError(429, 'rate');
      return res.json(await opSend(u.uid, body));
    }
    throw new HttpError(400, 'op');
  } catch (e) { return send(res, e); }
};
