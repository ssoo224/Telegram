importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDxQZCL4OawmPLKLRdQdbrQOHN7vl3p5EQ",
  authDomain: "aj-chat-df534.firebaseapp.com",
  projectId: "aj-chat-df534",
  storageBucket: "aj-chat-df534.firebasestorage.app",
  messagingSenderId: "1022301130899",
  appId: "1:1022301130899:web:171184929244a979b6bd66"
});

const messaging = firebase.messaging();

// مكتبة Firebase تعرض الإشعار تلقائياً من حمولة السيرفر (العنوان والنص والأيقونة)،
// لذلك لا نستدعي showNotification هنا حتى لا يظهر الإشعار مرتين.
messaging.onBackgroundMessage(() => {});
