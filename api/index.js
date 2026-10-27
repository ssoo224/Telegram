// Vercel Serverless: يرسل إشعار Push للمستلم عبر FCM (مجاني، بدون Cloud Functions)
// المتغير المطلوب في Vercel: FIREBASE_SERVICE_ACCOUNT = محتوى ملف الـ JSON كاملاً
//
// تغييرات هذه النسخة:
//  - أندرويد: رسالة بيانات فقط (data-only) حتى يبني التطبيق الإشعار بنفسه (صورة المرسل + زر رد + زر مقروءة)
//    حتى لو كان التطبيق مغلقاً.
//  - الويب: يبقى إشعار المتصفح عبر webpush.notification.
//  - المجموعات: يُقبل chatId القادم من التطبيق بعد التحقق أن المرسل والمستلم من المشاركين.
const admin = require('firebase-admin');
const { signedUrl } = require('./_avatar');

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  try {
    const m = (req.headers.authorization || '').match(/^Bearer (.+)$/);
    if (!m) return res.status(401).json({ error: 'unauthorized' });
    const decoded = await admin.auth().verifyIdToken(m[1]);

    const { recipientId, messageText, chatId: bodyChatId, senderName, callId, callEnd } = req.body || {};
    if (!recipientId || typeof recipientId !== 'string') return res.status(400).json({ error: 'bad request' });

    const db = admin.firestore();
    const pairId = [decoded.uid, recipientId].sort().join('__');
    // محادثة فردية: المعرّف دائماً حاصل دمج المعرّفين. مجموعة: نقبل chatId من الطلب بعد التحقق.
    const chatId = (typeof bodyChatId === 'string' && bodyChatId && bodyChatId !== pairId && bodyChatId.length < 200 && !bodyChatId.includes('/'))
      ? bodyChatId : pairId;
    const chat = await db.collection('chats').doc(chatId).get();
    const participants = (chat.exists && chat.data().participants) || [];
    if (!chat.exists || !participants.includes(decoded.uid) || !participants.includes(recipientId)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const isGroup = chatId !== pairId;

    // مكالمة: نتأكد أن المتصل صاحب المكالمة فعلاً والمستلم هو الطرف الثاني
    const isCall = typeof callId === 'string' && callId.length > 0 && callId.length < 100 && !callId.includes('/');
    if (isCall) {
      const cd = await db.collection('calls').doc(callId).get();
      if (!cd.exists || cd.data().from !== decoded.uid || cd.data().to !== recipientId) {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    const [me, other] = await Promise.all([
      db.collection('users').doc(decoded.uid).get(),
      db.collection('users').doc(recipientId).get()
    ]);
    const o = other.data() || {};
    const mine = me.data() || {};
    // لا نتخطى الإرسال بحجة أن المستلم "متصل": عند إغلاق التطبيق تبقى حالة online صحيحة حتى 45 ثانية.
    // التطبيق نفسه يمنع عرض الإشعار إذا كان مفتوحاً أمام المستخدم.

    const tokens = [...new Set([...(o.fcmTokens || []), ...(o.fcmToken ? [o.fcmToken] : [])])];
    if (!tokens.length) return res.json({ sent: 0 });

    const title = String((isGroup && senderName) ? senderName : (mine.displayName || 'رسالة جديدة')).slice(0, 40);
    const body = String(messageText || (isCall ? 'مكالمة صوتية واردة' : '')).slice(0, 150);
    // صورة المرسل: تُرسل فقط إذا كانت رابطاً قصيراً وغير مخفية. غير ذلك يستخدم التطبيق الصورة المحفوظة عنده.
    // الصور محفوظة غالباً كـ data-URL (أكبر من حد FCM)، فنرسل رابطاً موقّعاً قصيراً يحمّله التطبيق من /api/avatar
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    const av = String(mine.avatarUrl || '');
    let avatar = '';
    if (!mine.hideAvatar) {
      if (/^https?:\/\//.test(av) && av.length < 1000) avatar = av;
      else if (av.startsWith('data:image/') && host) avatar = signedUrl(host, decoded.uid);
    }

    // صورة المستلم نفسه (أنا): تُستعمل في الإشعار عند الرد حتى يظهر ردّي بصورتي لا بصورة المرسل.
    const mav = String(o.avatarUrl || '');
    let meAvatar = '';
    if (/^https?:\/\//.test(mav) && mav.length < 1000) meAvatar = mav;
    else if (mav.startsWith('data:image/') && host) meAvatar = signedUrl(host, recipientId);

    const r = await admin.messaging().sendEachForMulticast({
      tokens,
      // لا يوجد حقل notification في المستوى الأعلى عمداً: أندرويد يستقبل بيانات فقط ويبني الإشعار بنفسه.
      data: isCall
        ? { type: callEnd ? 'call_end' : 'call', callId, chatId, senderId: decoded.uid, title, body, avatar }
        : { type: 'msg', chatId, senderId: decoded.uid, title, body, avatar, meAvatar },
      android: { priority: 'high', ttl: isCall ? 45 * 1000 : 86400 * 1000 },
      webpush: (isCall && callEnd)
        ? { headers: { Urgency: 'high' } }
        : {
            headers: isCall ? { Urgency: 'high', TTL: '45' } : { Urgency: 'high' },
            notification: { title, body, icon: avatar || '/icon-512.png', badge: '/badge-96.png', tag: chatId, renotify: true },
            fcmOptions: { link: '/' }
          }
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
