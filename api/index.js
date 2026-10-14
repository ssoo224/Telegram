const admin = require('firebase-admin');

// التحقق من عدم تهيئة فايربيس مسبقاً لمنع التكرار
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      "type": "service_account",
      "project_id": "aj-chat-df534",
      "private_key_id": "YOUR_PRIVATE_KEY_ID",
      "private_key": "-----BEGIN PRIVATE KEY-----\nYOUR_KEY\n-----END PRIVATE KEY-----\n",
      "client_email": "firebase-adminsdk@aj-chat-df534.iam.gserviceaccount.com",
    })
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { recipientId, senderName, messageText } = req.body;

  try {
    const userDoc = await db.collection('users').doc(recipientId).get();
    if (!userDoc.exists || !userDoc.data().fcmToken) {
      return res.status(404).json({ error: 'Token not found' });
    }

    const fcmToken = userDoc.data().fcmToken;

    const message = {
      token: fcmToken,
      notification: {
        title: senderName || "رسالة جديدة",
        body: messageText || "أرسل لك رسالة جديدة"
      }
    };

    await admin.messaging().send(message);
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
