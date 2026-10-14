const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      "type": "service_account",
      "project_id": "aj-chat-df534",
      "private_key_id": "84c37213b9bd681aefbfd2ed435f6f4506473c2c",
      "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDW6x5ClRQaTRNv\nJOj8LntNDpAsRGzJRsxn1Ozxo+m/uIzbp9TLfOx6uZIvZz9msjov4U0hV9uQwk/I\nbwE5A3202vw68F+r3f4bXaHetHMmaAK9hCiOtzWw2TGKP49yOj8lZ2H6ciG2zVjQ\nRDdAv//i2Y+yCaLuSbqr1YivJjrxpkRksqdcr/0Q2pj2pzzC9IXWaGeL4XEVWo/U\nR/fu4PUsHVUhobhGy4aNc0peKp+DHrxA830aPszEFopF3HPcO4Gi2DPVrPZy5Hlc\nF32JNcqtQPM6Lv3mxM0sp75/V6q5FuqYQycGyAyFHJjWGuH6Xgp2+/2pVosYAh95\nhqVy4IgBAgMBAAECggEABZmPgAHZny/Q022Z1Lb6AENGC6IfOtqwkDZ5zHgHKuH0\n92ThmZeD3FTCDKB7IJgPPtiv8BOjzHChBXDGjm+UBG291isVw/dCv45YuhsSViGR\nxLWYOSkTBlcd+Sp4P6UwjCDk3Cf7CCBhDhgoCmZ53FHrcmnZiB+ZyZ5LyNMwy6cn\n4rx+FYIe9wHByxOxzxqPFMmgGAOwuG9aPczw8pnvCbm/O27itYGcb6HCUARRAO3f\nSbhxQ1pe6bhjPiel/Nv6kIifriL+M65hV34DWkRf0PBr1JqG403GKbvc6uNkl1D3\nSNVKM64TlVJ+W03+bgEu+tb4W4piL0OiyZD5f/U0swKBgQD4y2Z5BUXUMimZBe2l\nQEbfy8xPFxYb8VJ5V9Zo/ai9Dn4zBBZ3HSvlCc6xl0qxrEFW4tSV7d6oUZvYeWmT\nc81e4Ase7RvBJUjEXP3Eqh/rR/xasVHeO3lPt4HiYzkt9gN9JxVBRruXG2L+hAsA\xs5jkaBVht5vtCliYWGIBIGYlwKBgQDdJI4ySgZRpRLGkEv8fB5RHIkXK1egx7R/\n0k9yxscNdyVfp4IfIYevpz52LftNcPTd+Gi7NjEUGdVO6ePzcjz3UQLFFqyPGBE0\niWVNuNbYU9VquzLvkjWfsiB9dTcCnWnF35C8zWho8YNqD5RfCDFytGSDkeeYSDa+\n3O4cSJgfJwKBgQDh5Ev2NcNhFuqN9cP/9oxjRjcK2HtKg6HOauJSEX3TqgULbPq4\ny9O+8ViqBiPbjfsFWI6MUp2HVhGaSyKArvQY4HM4cTBx/dhD8eq3VYAFsCaAcd9T\nV8ydhJB5bH3OLUCdsY6q5f4NBOCtFlanLdrWrLJW9U2hPoMUwDY9uVmxoQKBgQCP\nPItB9YKMRYCYzoP5QSed3/7H3BIBGPlHxaAiNrBdf2vcvjHhGiW513j0sSnR6jUg\nxTKI+DvnyifI2mQEnlzw0C8cG2ifsrYKMmhEZFH8gqh8Xk5KsIg9LPIwcMi1z+Hg\nAcPNFrrnJm+5NegjeboVktR8B/hbQYL8MzujZD3sBwKBgQCSKqmhsphrCnJW5+oK\nOJBQEj7F+3i9zMFrUTm4lZGYJ5kwswStiGwQ3ssXKY+eqHqPPagHndOCQHEb1gy5\nFDtdHZWkFJbu/nre67y1fQdgT49UAvIy63wbRZrkt7oFE4HlONrBFFeFO5xSVymI\n5L7x3iXBuTpGdReR1EWAIOxBKA==\n-----END PRIVATE KEY-----",
      "client_email": "firebase-adminsdk-fbsvc@aj-chat-df534.iam.gserviceaccount.com"
    })
  });
}

const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: "Babylon Chat Notification Server is Running! 🚀" });
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
