export default async function handler(req, res) {
  // إذا فتح شخص الرابط بالمتصفح مباشرة
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'Babylon Chat Notification Server is Running! 🚀' });
  }

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
