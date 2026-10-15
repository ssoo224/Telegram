const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    })
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const { recipientId, senderName, messageText } = req.body;

  try {
    const userDoc = await admin.firestore().collection('users').doc(recipientId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const fcmToken = userDoc.data().fcmToken;
    if (!fcmToken) {
      return res.status(200).json({ message: 'No FCM token for user' });
    }

    // إرسال إشعار واحد ذو صياغة واضحة
    await admin.messaging().send({
      token: fcmToken,
      notification: {
        title: senderName,
        body: messageText
      }
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error sending notification:', error);
    return res.status(500).json({ error: error.message });
  }
};
