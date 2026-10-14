const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ربط مشروع فايربيس (استبدل القيم بمعلومات مشروعك الفعلي)
const serviceAccount = {
  "type": "service_account",
  "project_id": "aj-chat-df534",
  "private_key_id": "YOUR_PRIVATE_KEY_ID",
  "private_key": "-----BEGIN PRIVATE KEY-----\nYOUR_KEY\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk@aj-chat-df534.iam.gserviceaccount.com",
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// مسار استقبال أي رسالة جديدة وإرسال إشعار فوري
app.post('/api/send-notification', async (req, res) => {
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
      },
      webpush: {
        fcmOptions: {
          link: "https://your-app-url.vercel.app"
        }
      }
    };

    await admin.messaging().send(message);
    res.status(200).json({ success: true, message: 'Notification sent successfully' });
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Babylon Notification Server running on port ${PORT}`);
});
