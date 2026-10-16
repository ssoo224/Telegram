// Vercel Serverless: يرسل إشعار Push للمستلم عبر FCM (مجاني، بدون Cloud Functions)
// المتغير المطلوب في Vercel: FIREBASE_SERVICE_ACCOUNT = محتوى ملف الـ JSON كاملاً
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  try {
    const m = (req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (!m) return res.status(401).json({ error: 'unauthorized' });
    const decoded = await admin.auth().verifyIdToken(m[1]);

    const { recipientId, messageText } = req.body || {};
    if (!recipientId || typeof recipientId !== 'string') return res.status(400).json({ error: 'bad request' });

    const db = admin.firestore();
    const chatId = [decoded.uid, recipientId].sort().join('__');
    const chat = await db.collection('chats').doc(chatId).get();
    if (!chat.exists || !(chat.data().participants || []).includes(decoded.uid)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const [me, other] = await Promise.all([
      db.collection('users').doc(decoded.uid).get(),
      db.collection('users').doc(recipientId).get()
    ]);
    const o = other.data() || {};
    if (o.online && Date.now() - (o.lastSeen || 0) < 45000) return res.json({ skipped: 'online' });

    const tokens = [...new Set([...(o.fcmTokens || []), ...(o.fcmToken ? [o.fcmToken] : [])])];
    if (!tokens.length) return res.json({ sent: 0 });

    const title = String((me.data() || {}).displayName || 'رسالة جديدة').slice(0, 40);
    const body = String(messageText || '').slice(0, 100);
    const r = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      webpush: { fcmOptions: { link: '/' } },
      data: { chatId, senderId: decoded.uid }
    });

    const bad = [];
    r.responses.forEach((x, i) => {
      const code = (x.error && x.error.code) || '';
      if (!x.success && /not-registered|invalid-registration/.test(code)) bad.push(tokens[i]);
    });
    if (bad.length) {
      await db.collection('users').doc(recipientId).update({ fcmTokens: admin.firestore.FieldValue.arrayRemove(...bad) });
    }
    return res.json({ sent: r.successCount });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'failed' });
  }
};
