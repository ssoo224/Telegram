const firebaseConfig = {
  apiKey: "AIzaSyDxQZCL4OawmPLKLRdQdbrQOHN7vl3p5EQ",
  authDomain: "aj-chat-df534.firebaseapp.com",
  projectId: "aj-chat-df534",
  storageBucket: "aj-chat-df534.firebasestorage.app",
  messagingSenderId: "1022301130899",
  appId: "1:1022301130899:web:171184929244a979b6bd66"
};

firebase.initializeApp(firebaseConfig);

/* Firebase App Check: ضع مفتاح reCAPTCHA v3 هنا لتفعيله (فارغ = معطل بدون أي تأثير) */
const APP_CHECK_SITE_KEY = "";
if (APP_CHECK_SITE_KEY && firebase.appCheck) {
  if (location.hostname === "localhost") self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  firebase.appCheck().activate(APP_CHECK_SITE_KEY, true);
}
const auth = firebase.auth();
const db = firebase.firestore();

let messaging = null;
if (firebase.messaging.isSupported()) {
  messaging = firebase.messaging();
}

let currentUser = null;
let currentUserData = null;
let activeChatId = null;
let currentChatOtherUserId = null;
let messagesUnsubscribe = null;
let userUnsubscribe = null;
let chatsListUnsubscribe = null;
let userDocUnsubscribe = null;
let heartbeatInterval = null;
let isAppInitialized = false;

let sessionStartTime = Date.now();

let selectedMsgId = null;
let selectedMsgText = null;
let selectedMsgSender = null;
let selectedMsgReactions = {};
let replyingToText = null;
let editingMsgId = null;

let mediaRecorder = null;
let audioChunks = [];
let recordInterval = null;
let recordSeconds = 0;

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('firebase-messaging-sw.js')
    .then(reg => console.log('SW Registered', reg))
    .catch(err => console.log('SW Fail', err));
}

document.addEventListener("DOMContentLoaded", () => {
  const regBtn = document.getElementById("regSubmitBtn");
  if (regBtn) {
    regBtn.addEventListener("click", function(e) {
      e.preventDefault();
      registerUser();
    });
  }
});

function requestNotificationPermission() {
  if (!("Notification" in window)) {
    return showToast("متصفحك لا يدعم الإشعارات");
  }
  Notification.requestPermission().then(permission => {
    if (permission === "granted") {
      showToast("تم تفعيل إشعارات الجهاز بنجاح! 🔔");
      registerPushToken();
    } else {
      showToast("تم رفض إذن الإشعارات من الهاتف");
    }
  });
}

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch(e) {}
}

function isValidUsername(username) {
  const regex = /^[a-zA-Z][a-zA-Z0-9_\.]{2,}$/;
  return regex.test(username);
}

function validateUsernameInput(inputElement) {
  let val = inputElement.value.trim();
  val = val.replace(/[^a-zA-Z0-9_\.]/g, '');
  inputElement.value = val;
}

function clearErrors() {
  document.querySelectorAll('.field-error').forEach(el => {
    el.textContent = "";
    el.classList.add('hidden');
  });
}

function showFieldError(elementId, msg) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = msg;
    el.classList.remove('hidden');
  }
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 3000);
}

function switchTab(type) {
  clearErrors();
  if (type === 'login') {
    document.getElementById("tabLogin").classList.add("active");
    document.getElementById("tabRegister").classList.remove("active");
    document.getElementById("formLogin").classList.remove("hidden");
    document.getElementById("formRegister").classList.add("hidden");
  } else {
    document.getElementById("tabRegister").classList.add("active");
    document.getElementById("tabLogin").classList.remove("active");
    document.getElementById("formRegister").classList.remove("hidden");
    document.getElementById("formLogin").classList.add("hidden");
  }
}

auth.onAuthStateChanged(user => {
  if (user && !user.emailVerified) { showVerifyPage(user); return; }
  if (user) {
    currentUser = user;
    db.collection("users").doc(user.uid).set({ online: true, lastSeen: Date.now() }, { merge: true });
    
    clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      if (document.hidden) return;
      db.collection("users").doc(user.uid).set({ online: true, lastSeen: Date.now() }, { merge: true });
    }, 20000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && currentUser) db.collection("users").doc(currentUser.uid).set({ online: true, lastSeen: Date.now() }, { merge: true });
    });

    window.addEventListener('beforeunload', () => {
      db.collection("users").doc(user.uid).set({ online: false, lastSeen: Date.now() }, { merge: true });
    });

    if (!isAppInitialized) {
      loadUserDataAndEnter(user.uid);
    }
  } else {
    isAppInitialized = false;
    currentUser = null;
    currentUserData = null;
    if (userDocUnsubscribe) { userDocUnsubscribe(); userDocUnsubscribe = null; }
    document.getElementById("authPage").classList.remove("hidden");
    document.getElementById("mainPage").classList.add("hidden");
  }
});

function loadUserDataAndEnter(uid) {
  if (userDocUnsubscribe) userDocUnsubscribe();
  
  userDocUnsubscribe = db.collection("users").doc(uid).onSnapshot(doc => {
    if (doc.exists) {
      currentUserData = doc.data();
      updateProfileUI(currentUserData);
      syncPrefsFromUser(currentUserData);
      refreshPushTokenOnce();
      ensureUsernameDoc(currentUserData);
      
      if (!isAppInitialized) {
        isAppInitialized = true;
        enterApp();
      }
    }
  });
}

function updateProfileUI(u) {
  if (!u) return;
  const displayName = u.displayName || currentUser.email.split('@')[0];
  const username = u.username || "user" + currentUser.uid.substring(0, 5);
  const email = u.email || currentUser.email;

  document.getElementById("pHeaderNameText").textContent = displayName;
  
  // تفعيل التوثيق تلقائياً لحسابك الرئيسي أو إذا كانت الخاصية true
  const isUserVerified = u.isVerified || (username.toLowerCase() === 'ali') || (u.email && u.email.includes('ali'));
  document.getElementById("pBadgeBox").classList.toggle("hidden", !isUserVerified);
  
  document.getElementById("pHeaderUser").textContent = "@" + username;
  document.getElementById("pEmailDisplay").textContent = email;

  const bioEl = document.getElementById("pBioDisplay");
  if (u.bio) { bioEl.textContent = u.bio; bioEl.classList.remove("muted"); }
  else { bioEl.textContent = "أضف نبذة عن نفسك"; bioEl.classList.add("muted"); }

  setProfileRow("pGovRow", "pGovDisplay", u.governorate);
  setProfileRow("pJoinRow", "pJoinDisplay", u.createdAt ? formatJoinDate(u.createdAt) : "");
  setPfStatus(document.getElementById("pHeaderStatus"), true, Date.now());
  applyCover("p", u.cover || "babylon");

  const avatarBox = document.getElementById("pAvatarImg");
  const avatarText = document.getElementById("pAvatarText");

  if (u.avatarUrl) {
    avatarBox.src = u.avatarUrl;
    avatarBox.classList.remove("hidden");
    avatarText.classList.add("hidden");
  } else {
    avatarText.textContent = displayName.charAt(0).toUpperCase();
    avatarText.classList.remove("hidden");
    avatarBox.classList.add("hidden");
  }
}

function openEditProfileModal() {
  if (!currentUserData) return;
  document.getElementById("modalNameInput").value = currentUserData.displayName || "";
  document.getElementById("modalUsernameInput").value = currentUserData.username || "";
  document.getElementById("modalBioInput").value = currentUserData.bio || "";
  document.getElementById("modalGovInput").value = currentUserData.governorate || "";
  document.getElementById("modalUserError").classList.add("hidden");
  document.getElementById("editProfileModal").classList.remove("hidden");
}

function closeEditModal(e) {
  if (e.target.id === "editProfileModal") {
    document.getElementById("editProfileModal").classList.add("hidden");
  }
}

function closeEditModalDirect() {
  document.getElementById("editProfileModal").classList.add("hidden");
}

function saveProfileChanges() {
  const newName = document.getElementById("modalNameInput").value.trim();
  const newUsername = document.getElementById("modalUsernameInput").value.trim().toLowerCase();
  const newBio = document.getElementById("modalBioInput").value.trim();

  if (!newName) return showToast("الرجاء أدخل اسم العرض");

  if (!isValidUsername(newUsername)) {
    showFieldError("modalUserError", "يجب أن يبدأ اليوزر بحرف ويحتوي على 3 أحرف فأكثر");
    return;
  }

  showToast("جاري حفظ التغيرات...");

  db.collection("users").where("username", "==", newUsername).get().then(snap => {
    let taken = false;
    snap.forEach(doc => {
      if (doc.id !== currentUser.uid) taken = true;
    });

    if (taken) {
      showFieldError("modalUserError", "اسم المستخدم هذا مستخدم بالفعل!");
      return;
    }

    const oldUsername = currentUserData && currentUserData.username;
    db.collection("users").doc(currentUser.uid).set({
      displayName: newName,
      username: newUsername,
      bio: newBio,
      governorate: document.getElementById("modalGovInput").value
    }, { merge: true }).then(() => {
      syncUsernameDoc(oldUsername, newUsername);
      closeEditModalDirect();
      showToast("تم تحديث معلوماتك بنجاح ✨");
    });
  });
}

function loginUser() {
  clearErrors();
  let inputVal = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value.trim();

  if (!inputVal) return showFieldError("loginEmailError", "الرجاء أدخل البريد أو اسم المستخدم");
  if (!password) return showFieldError("loginPassError", "الرجاء أدخل كلمة المرور");

  if (inputVal.startsWith('@')) {
    inputVal = inputVal.substring(1);
  }

  if (inputVal.includes('@')) {
    auth.signInWithEmailAndPassword(inputVal, password)
      .catch(() => showFieldError("loginPassError", "البريد أو كلمة المرور غير صحيحة"));
  } else {
    db.collection("usernames").doc(inputVal.toLowerCase()).get().then(d => {
      if (!d.exists) {
        showFieldError("loginEmailError", "اسم المستخدم غير موجود (جرّب بالبريد الإلكتروني)");
      } else {
        auth.signInWithEmailAndPassword(d.data().email, password)
          .catch(() => showFieldError("loginPassError", "كلمة المرور غير صحيحة"));
      }
    }).catch(() => {
      showFieldError("loginEmailError", "حدث خطأ في الاتصال");
    });
  }
}

function registerUser() {
  clearErrors();
  const name = document.getElementById("regName").value.trim();
  const username = document.getElementById("regUsername").value.trim().toLowerCase();
  const email = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPassword").value.trim();

  if (!name) return showToast("الرجاء إدخال اسم العرض");
  if (!isValidUsername(username)) return showFieldError("regUserError", "اليوزر غير صالح!");
  if (!email) return showFieldError("regEmailError", "الرجاء إدخال البريد الإلكتروني");
  if (isDisposableEmail(email)) return showFieldError("regEmailError", "هذا النوع من البريد غير مسموح، استخدم بريداً حقيقياً");
  if (!password || password.length < 6) return showFieldError("regPassError", "كلمة المرور يجب أن تكون 6 أحرف على الأقل");

  showToast("جاري إنشاء الحساب...");

  db.collection("usernames").doc(username).get().then(snap => {
    if (snap.exists) {
      showFieldError("regUserError", "اسم المستخدم مستخدم بالفعل!");
      return;
    }

    auth.createUserWithEmailAndPassword(email, password)
      .then(cred => {
        const userData = {
          id: cred.user.uid,
          displayName: name,
          username: username,
          email: email,
          bio: "",
          avatarUrl: "",
          isVerified: false,
          createdAt: Date.now()
        };
        const batch = db.batch();
        batch.set(db.collection("users").doc(cred.user.uid), userData);
        batch.set(db.collection("usernames").doc(username), { uid: cred.user.uid, email: email });
        batch.commit().then(() => {
          currentUserData = userData;
          showVerifyPage(cred.user);
        }).catch(() => {
          cred.user.delete().catch(() => {});
          showFieldError("regUserError", "اسم المستخدم مستخدم بالفعل!");
        });
      }).catch(err => {
        const msg = err.code === "auth/email-already-in-use" ? "هذا البريد مسجل مسبقاً"
          : err.code === "auth/invalid-email" ? "البريد الإلكتروني غير صالح"
          : err.code === "auth/weak-password" ? "كلمة المرور ضعيفة"
          : err.message;
        showFieldError(err.code === "auth/weak-password" ? "regPassError" : "regEmailError", msg);
      });
  }).catch(() => showFieldError("regUserError", "حدث خطأ في الاتصال"));
}

function enterApp() {
  document.getElementById("authPage").classList.add("hidden");
  document.getElementById("mainPage").classList.remove("hidden");
  goHome();
}

function logout() { 
  if (currentUser) {
    clearInterval(heartbeatInterval);
    db.collection("users").doc(currentUser.uid).set({ online: false, lastSeen: Date.now() }, { merge: true }).then(() => {
      auth.signOut().then(() => location.reload());
    });
  } else {
    auth.signOut().then(() => location.reload());
  }
}

function showView(viewId) {
  ["homeView", "searchView", "profileView", "otherUserProfileView", "settingsView", "chatSettingsView", "notificationSettingsView", "chatView"].forEach(v => {
    const el = document.getElementById(v);
    if (el) el.classList.add("hidden");
  });
  document.getElementById(viewId).classList.remove("hidden");

  const mainHeader = document.getElementById("mainHeader");
  const bottomNav = document.getElementById("bottomNav");
  const mainSearchBtn = document.getElementById("mainSearchBtn");

  const noHeader = ["chatView", "profileView", "otherUserProfileView"].includes(viewId);
  mainHeader.classList.toggle("hidden", noHeader);
  bottomNav.classList.toggle("hidden", viewId === "chatView");

  if (viewId === "homeView") {
    mainSearchBtn.classList.remove("hidden");
  } else {
    mainSearchBtn.classList.add("hidden");
  }

  document.getElementById("navChats").classList.toggle("active", viewId === "homeView" || viewId === "searchView" || viewId === "otherUserProfileView");
  document.getElementById("navProfile").classList.toggle("active", viewId === "profileView");
  document.getElementById("navSettings").classList.toggle("active", viewId === "settingsView" || viewId === "chatSettingsView" || viewId === "notificationSettingsView");
}

function goHome() {
  if (messagesUnsubscribe) { messagesUnsubscribe(); messagesUnsubscribe = null; }
  if (userUnsubscribe) { userUnsubscribe(); userUnsubscribe = null; }
  activeChatId = null;
  currentChatOtherUserId = null;
  cancelReply();
  document.getElementById("searchInput").value = "";
  document.getElementById("searchResults").innerHTML = "";
  showView("homeView");
  loadChats();
}

function openSearch() { 
  showView("searchView");
  document.getElementById("searchInput").focus();
}

function openProfile() {
  if (messagesUnsubscribe) { messagesUnsubscribe(); messagesUnsubscribe = null; }
  if (userUnsubscribe) { userUnsubscribe(); userUnsubscribe = null; }
  activeChatId = null;
  showView("profileView");
  if (currentUserData) {
    updateProfileUI(currentUserData);
  }
}

function openSettings() {
  if (messagesUnsubscribe) { messagesUnsubscribe(); messagesUnsubscribe = null; }
  if (userUnsubscribe) { userUnsubscribe(); userUnsubscribe = null; }
  activeChatId = null;
  showView("settingsView");
}

function openChatSettings() {
  showView('chatSettingsView');
  document.getElementById('fontRange').value = prefs.font;
  document.getElementById('fontVal').textContent = prefs.font;
  document.getElementById('radiusRange').value = prefs.radius;
  document.getElementById('radiusVal').textContent = prefs.radius;
  markSelectedTheme(true);
}

function openNotificationSettings() {
  showView('notificationSettingsView');
}

function uploadAvatarLive(e) {
  const file = e.target.files[0];
  if (!file || !currentUser) return;

  showToast("جاري معالجة ورفع الصورة...");

  const reader = new FileReader();
  reader.onload = function(evt) {
    const img = new Image();
    img.src = evt.target.result;
    img.onload = function() {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = 180;
      canvas.height = 180;
      ctx.drawImage(img, 0, 0, 180, 180);

      const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.85);

      db.collection("users").doc(currentUser.uid).set({
        avatarUrl: compressedDataUrl
      }, { merge: true }).then(() => {
        currentUserData.avatarUrl = compressedDataUrl;
        updateProfileUI(currentUserData);
        showToast("تم تحديث الصورة الشخصية بنجاح!");
      });
    };
  };
  reader.readAsDataURL(file);
}

function searchUsers() {
  let q = document.getElementById("searchInput").value.trim().toLowerCase();
  if (q.startsWith('@')) q = q.substring(1);

  const res = document.getElementById("searchResults");
  res.innerHTML = "";
  if (q.length < 3) return;

  db.collection("users").where("username", ">=", q).where("username", "<=", q + "\uf8ff")
    .get().then(snap => {
      snap.forEach(doc => {
        const u = doc.data();
        if (u.id === currentUser.uid) return;

        const isUVerified = u.isVerified || (u.username && u.username.toLowerCase() === 'ali');
        const verifiedBadge = isUVerified ? `<span class="verified-badge" style="width:14px;height:14px;font-size:9px;">✓</span>` : '';

        const div = document.createElement("div");
        div.className = "chat-item";
        div.innerHTML = `
          <div class="avatar">${u.avatarUrl ? `<img src="${esc(u.avatarUrl)}">` : esc((u.displayName||"?").charAt(0).toUpperCase())}</div>
          <div class="chat-item-info">
            <div class="chat-item-name">${esc(u.displayName)} ${verifiedBadge}</div>
            <div class="chat-item-sub">@${esc(u.username)}</div>
          </div>`;
        div.onclick = () => openUserProfileDirect(u);
        res.appendChild(div);
      });
    });
}

function openUserProfileDirect(u) {
  currentChatOtherUserId = u.id;
  otherProfileUsername = "@" + (u.username || "user");
  document.getElementById("otherHeaderNameText").textContent = u.displayName || "مستخدم";
  
  const isUVerified = u.isVerified || (u.username && u.username.toLowerCase() === 'ali');
  document.getElementById("otherBadgeBox").classList.toggle("hidden", !isUVerified);
  document.getElementById("otherHeaderUser").textContent = otherProfileUsername;

  const bioEl = document.getElementById("otherBioDisplay");
  bioEl.textContent = u.bio || "";
  document.getElementById("otherBioRow").classList.toggle("hidden", !u.bio);

  setProfileRow("otherGovRow", "otherGovDisplay", u.governorate);
  setProfileRow("otherJoinRow", "otherJoinDisplay", u.createdAt ? formatJoinDate(u.createdAt) : "");
  setPfStatus(document.getElementById("otherHeaderStatus"), u.online, u.lastSeen);
  applyCover("other", u.cover || "babylon");

  const avatarBox = document.getElementById("otherAvatarImg");
  const avatarText = document.getElementById("otherAvatarText");

  if (u.avatarUrl) {
    avatarBox.src = u.avatarUrl;
    avatarBox.classList.remove("hidden");
    avatarText.classList.add("hidden");
  } else {
    avatarText.textContent = (u.displayName || "?").charAt(0).toUpperCase();
    avatarText.classList.remove("hidden");
    avatarBox.classList.add("hidden");
  }

  showView("otherUserProfileView");
}

function openCurrentChatUserProfile() {
  if (!currentChatOtherUserId) return;
  db.collection("users").doc(currentChatOtherUserId).get().then(doc => {
    if (doc.exists) {
      openUserProfileDirect(doc.data());
    }
  });
}

function goBackFromOtherProfile() {
  if (activeChatId && currentChatOtherUserId) {
    openChatRoom(currentChatOtherUserId);
  } else {
    goHome();
  }
}

function startChatFromProfile() {
  if (!currentChatOtherUserId) return;
  const targetId = currentChatOtherUserId;
  const chatId = [currentUser.uid, targetId].sort().join("__");
  activeChatId = chatId;

  db.collection("chats").doc(chatId).get().then(doc => {
    if (!doc.exists) {
      db.collection("chats").doc(chatId).set({
        participants: [currentUser.uid, targetId],
        updatedAt: Date.now()
      });
    }
    openChatRoom(targetId);
  });
}

let msgLimit = 50;
let loadingOlder = false;

function openChatRoom(otherUserId, keepLimit) {
  if (!keepLimit) msgLimit = 50;
  currentChatOtherUserId = otherUserId;
  if (messagesUnsubscribe) { messagesUnsubscribe(); messagesUnsubscribe = null; }
  if (userUnsubscribe) { userUnsubscribe(); userUnsubscribe = null; }
  
  showView("chatView");

  userUnsubscribe = db.collection("users").doc(otherUserId).onSnapshot(doc => {
    if (doc.exists) {
      const u = doc.data();
      document.getElementById("chatTitleText").textContent = u.displayName || "مستخدم";
      
      const isUVerified = u.isVerified || (u.username && u.username.toLowerCase() === 'ali');
      document.getElementById("chatBadgeBox").classList.toggle("hidden", !isUVerified);
      
      const sub = document.getElementById("chatSub");
      
      const avatarBox = document.getElementById("chatAvatar");
      if (u.avatarUrl) {
        avatarBox.innerHTML = `<img src="${esc(u.avatarUrl)}">`;
      } else {
        avatarBox.textContent = (u.displayName || "?").charAt(0).toUpperCase();
      }

      if (u.online && (Date.now() - (u.lastSeen || 0) < 45000)) {
        sub.textContent = "متصل الآن";
        sub.style.color = "#4ade80";
      } else {
        sub.textContent = "آخر ظهور كان قريباً";
        sub.style.color = "var(--text-muted)";
      }
    }
  });

  db.collection("chats").doc(activeChatId).collection("messages")
    .where("senderId", "==", otherUserId)
    .where("read", "==", false)
    .get().then(snap => {
      snap.forEach(d => d.ref.update({ read: true }));
    });

  messagesUnsubscribe = db.collection("chats").doc(activeChatId).collection("messages")
    .orderBy("createdAt", "desc").limit(msgLimit)
    .onSnapshot(snap => {
      const box = document.getElementById("messagesArea");
      const prevH = box.scrollHeight;
      box.innerHTML = "";

      if (snap.size >= msgLimit) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "load-older-btn";
        more.textContent = "تحميل رسائل أقدم";
        more.onclick = () => { msgLimit += 50; loadingOlder = true; openChatRoom(currentChatOtherUserId, true); };
        box.appendChild(more);
      }

      snap.docs.forEach(d => {
        const dm = d.data();
        if (dm.senderId !== currentUser.uid && dm.read === false) d.ref.update({ read: true }).catch(() => {});
      });

      snap.docs.slice().reverse().forEach(doc => {
        const m = doc.data();
        const isMine = m.senderId === currentUser.uid;
        
        let checkHtml = "";
        if (isMine) {
          checkHtml = m.read ? `<span class="check-mark read">✓✓</span>` : `<span class="check-mark">✓</span>`;
        }

        let rawTimeStr = new Date(m.createdAt).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
        if (rawTimeStr.startsWith('0')) rawTimeStr = rawTimeStr.substring(1);

        const b = document.createElement("div");
        b.className = "msg-bubble" + (isMine ? " mine" : "");
        
        let htmlContent = "";
        if (m.replyTo) htmlContent += `<div class="reply-quote">${esc(m.replyTo)}</div>`;

        if (m.audioUrl) {
          htmlContent += `<div class="audio-player"><audio controls src="${esc(m.audioUrl)}"></audio></div>`;
        } else {
          htmlContent += m.imageUrl ? `<div class="msg-image"><img src="${esc(m.imageUrl)}" alt="صورة"></div>` : `<div class="msg-text">${esc(m.text)}</div>`;
        }

        if (m.reactions && Object.keys(m.reactions).length > 0) {
          htmlContent += `<div class="reactions-row">`;
          for (let r in m.reactions) {
            htmlContent += `<span class="reaction-badge">${esc(r)}</span>`;
          }
          htmlContent += `</div>`;
        }

        htmlContent += `<div class="msg-meta"><span>${rawTimeStr}</span> ${checkHtml}</div>`;
        b.innerHTML = htmlContent;
        const msgImg = b.querySelector(".msg-image img");
        if (msgImg) msgImg.onclick = (ev) => { ev.stopPropagation(); openImageViewer(msgImg.src); };

        let pressTimer = null;
        let touchStartX = 0;
        let touchStartY = 0;

        b.ontouchstart = (e) => {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
          pressTimer = setTimeout(() => openMsgModal(doc.id, m.text || (m.imageUrl ? "📷 صورة" : "بصمة صوتية"), m.senderId, m.reactions || {}), 450);
        };

        b.ontouchmove = (e) => {
          let moveX = e.touches[0].clientX;
          let moveY = e.touches[0].clientY;
          if (Math.abs(moveX - touchStartX) > 10 || Math.abs(moveY - touchStartY) > 10) clearTimeout(pressTimer);
        };

        b.ontouchend = (e) => {
          clearTimeout(pressTimer);
          if (touchStartX - e.changedTouches[0].clientX > 50) triggerSwipeReply(m.text || (m.imageUrl ? "📷 صورة" : "بصمة صوتية"));
        };

        b.onmousedown = () => {
          pressTimer = setTimeout(() => openMsgModal(doc.id, m.text || (m.imageUrl ? "📷 صورة" : "بصمة صوتية"), m.senderId, m.reactions || {}), 450);
        };
        b.onmouseup = b.onmouseleave = () => clearTimeout(pressTimer);

        box.appendChild(b);
      });
      if (loadingOlder) { box.scrollTop = Math.max(0, box.scrollHeight - prevH); loadingOlder = false; }
      else box.scrollTop = box.scrollHeight;
    });
}

function triggerSwipeReply(text) {
  replyingToText = text;
  document.getElementById("replyPreviewText").textContent = "الرد على: " + replyingToText;
  document.getElementById("replyPreviewBar").classList.remove("hidden");
  document.getElementById("messageInput").focus();
  showToast("تم تفعيل الرد على الرسالة");
}

function openMsgModal(msgId, text, senderId, reactions) {
  selectedMsgId = msgId;
  selectedMsgText = text;
  selectedMsgSender = senderId;
  selectedMsgReactions = reactions || {};

  const btnEdit = document.getElementById("btnEditMsg");
  const btnDelete = document.getElementById("btnDeleteMsg");

  if (senderId === currentUser.uid) {
    btnEdit.classList.remove("hidden");
    btnDelete.classList.remove("hidden");
  } else {
    btnEdit.classList.add("hidden");
    btnDelete.classList.add("hidden");
  }

  document.getElementById("msgModal").classList.remove("hidden");
}

function closeMsgModal(e) {
  if (e.target.id === "msgModal") document.getElementById("msgModal").classList.add("hidden");
}

function addReaction(emoji) {
  if (!activeChatId || !selectedMsgId) return;

  let newReactions = { ...selectedMsgReactions };
  if (newReactions[emoji]) delete newReactions[emoji];
  else newReactions[emoji] = true;

  db.collection("chats").doc(activeChatId).collection("messages").doc(selectedMsgId).update({
    reactions: newReactions
  }).then(() => document.getElementById("msgModal").classList.add("hidden"));
}

function actionCopy() {
  navigator.clipboard.writeText(selectedMsgText);
  showToast("تم نسخ النص!");
  document.getElementById("msgModal").classList.add("hidden");
}

function cancelReply() {
  replyingToText = null;
  document.getElementById("replyPreviewBar").classList.add("hidden");
}

function actionEdit() {
  editingMsgId = selectedMsgId;
  document.getElementById("messageInput").value = selectedMsgText;
  document.getElementById("messageInput").focus();
  document.getElementById("msgModal").classList.add("hidden");
  showToast("أدخل التعديل ثم اضغط إرسال");
}

function actionDelete() {
  if (confirm("هل تريد حذف هذه الرسالة؟")) {
    db.collection("chats").doc(activeChatId).collection("messages").doc(selectedMsgId).delete()
      .then(() => showToast("تم حذف الرسالة"));
  }
  document.getElementById("msgModal").classList.add("hidden");
}

function startRecording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return showToast("المتصفح لا يدعم تسجيل الصوت");
  }

  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];

    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.start();

    recordSeconds = 0;
    document.getElementById("textInputBar").classList.add("hidden");
    document.getElementById("recordingBar").classList.remove("hidden");

    recordInterval = setInterval(() => {
      recordSeconds++;
      if (recordSeconds >= 60) { showToast("وصلت الحد الأقصى للتسجيل (دقيقة)"); stopAndSendRecording(); return; }
      let mins = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
      let secs = String(recordSeconds % 60).padStart(2, '0');
      document.getElementById("recordTimer").textContent = `${mins}:${secs}`;
    }, 1000);
  }).catch(() => showToast("يرجى إعطاء إذن المايكروفون للتسجيل"));
}

function cancelRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  if (mediaRecorder && mediaRecorder.stream) mediaRecorder.stream.getTracks().forEach(t => t.stop());
  clearInterval(recordInterval);
  document.getElementById("recordingBar").classList.add("hidden");
  document.getElementById("textInputBar").classList.remove("hidden");
}

function stopAndSendRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

  mediaRecorder.onstop = () => {
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64Audio = reader.result;
      if (base64Audio.length > 950000) { showToast("البصمة كبيرة جداً، سجّل مدة أقصر"); cancelRecording(); return; }

      db.collection("chats").doc(activeChatId).collection("messages").add({
        senderId: currentUser.uid,
        audioUrl: base64Audio,
        read: false,
        createdAt: Date.now()
      }).then(() => {
        db.collection("chats").doc(activeChatId).set({ updatedAt: Date.now() }, { merge: true });
        notifyPeer(activeChatId, "🎤 بصمة صوتية");
      });

      cancelRecording();
      showToast("تم إرسال البصمة الصوتية!");
    };
    reader.readAsDataURL(audioBlob);
  };

  mediaRecorder.stop();
}

function sendMessage(e) {
  e.preventDefault();
  const input = document.getElementById("messageInput");
  const text = input.value.trim();
  if (!text || !activeChatId) return;

  if (editingMsgId) {
    db.collection("chats").doc(activeChatId).collection("messages").doc(editingMsgId).update({
      text: text
    }).then(() => {
      editingMsgId = null;
      input.value = "";
      showToast("تم تعديل الرسالة بنجاح");
    });
  } else {
    const msgData = {
      senderId: currentUser.uid,
      text: text,
      read: false,
      createdAt: Date.now()
    };

    if (replyingToText) msgData.replyTo = replyingToText;

    db.collection("chats").doc(activeChatId).collection("messages").add(msgData).then(() => {
      db.collection("chats").doc(activeChatId).set({ updatedAt: Date.now() }, { merge: true });

      notifyPeer(activeChatId, text);
    });
    
    input.value = "";
    cancelReply();
  }
}

function loadChats() {
  const container = document.getElementById("chatList");
  
  if (chatsListUnsubscribe) { chatsListUnsubscribe(); chatsListUnsubscribe = null; }
  if (!currentUser) return;

  chatsListUnsubscribe = db.collection("chats")
    .where("participants", "array-contains", currentUser.uid)
    .onSnapshot(snap => {
      if (snap.empty) {
        container.innerHTML = `
          <div class="empty-chats">
            <div class="empty-chats-icon">🏛</div>
            <div style="font-weight: 600; font-size:16px; margin-bottom: 6px; color: var(--babylon-gold);">لا توجد محادثات في بابل بعد</div>
            <div style="font-size: 13px; color: var(--text-muted);">اضغط على أيقونة البحث (🔍) في الأعلى وابحث عن مستخدم بيوزر صالح</div>
          </div>`;
        return;
      }

      let chatDocsList = [];
      snap.forEach(doc => {
        chatDocsList.push({ id: doc.id, data: doc.data() });
      });

      chatDocsList.sort((a, b) => (b.data.updatedAt || 0) - (a.data.updatedAt || 0));

      const emptyElement = container.querySelector('.empty-chats');
      if (emptyElement) container.innerHTML = "";

      chatDocsList.forEach(item => {
        const chatData = item.data;
        const chatId = item.id;
        const participants = chatData.participants || [];
        const otherId = participants.find(id => id !== currentUser.uid);
        if (!otherId) return;

        let existingItem = document.getElementById("chat_item_" + chatId);
        if (!existingItem) {
          existingItem = document.createElement("div");
          existingItem.id = "chat_item_" + chatId;
          existingItem.className = "chat-item";
          existingItem.onclick = () => {
            activeChatId = chatId;
            openChatRoom(otherId);
          };
          container.appendChild(existingItem);
        }

        db.collection("users").doc(otherId).get().then(userDoc => {
          if (!userDoc.exists) return;
          const u = userDoc.data();

          db.collection("chats").doc(chatId).collection("messages")
            .orderBy("createdAt", "desc")
            .limit(1)
            .get().then(msgSnap => {
              let lastMsgText = "لا توجد رسائل بعد";
              let lastMsgTime = "";

              if (!msgSnap.empty) {
                const m = msgSnap.docs[0].data();
                const isMine = (m.senderId === currentUser.uid);
                const prefix = isMine ? "أنت: " : "";
                lastMsgText = prefix + (m.audioUrl ? "🎤 بصمة صوتية" : (m.imageUrl ? "📷 صورة" : (m.text || "")));
                
                let tStr = new Date(m.createdAt).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
                if (tStr.startsWith('0')) tStr = tStr.substring(1);
                lastMsgTime = tStr;

                if (!isMine && m.createdAt > sessionStartTime) playNotificationSound();
              }

              db.collection("chats").doc(chatId).collection("messages")
                .where("senderId", "==", otherId)
                .where("read", "==", false)
                .get().then(unReadSnap => {
                  let unreadCount = unReadSnap.size;
                  const isUVerified = u.isVerified || (u.username && u.username.toLowerCase() === 'ali');
                  const verifiedBadge = isUVerified ? `<span class="verified-badge" style="width:13px;height:13px;font-size:8px;">✓</span>` : '';

                  existingItem.innerHTML = `
                    <div class="avatar">${u.avatarUrl ? `<img src="${esc(u.avatarUrl)}">` : esc((u.displayName||"?").charAt(0).toUpperCase())}</div>
                    <div class="chat-item-info">
                      <div class="chat-item-header-row">
                        <div class="chat-item-name">${esc(u.displayName || "مستخدم")} ${verifiedBadge}</div>
                        <div class="chat-item-time">${lastMsgTime}</div>
                      </div>
                      <div class="chat-item-sub-row">
                        <div class="chat-item-sub">${esc(lastMsgText)}</div>
                        ${unreadCount > 0 ? `<div class="unread-badge">${unreadCount}</div>` : ''}
                      </div>
                    </div>`;
                });
            });
        });
      });
    });
}

/* ثيمات التراث العراقي للمحادثات */
const THEMES = {
  babylon: { name:'بابل', hero:'ic:gate', chatBg:'#0d1626', mine:'linear-gradient(135deg,#1b4d8e,#2f78cf)', other:'#263345',
    textMine:'#ffffff', textOther:'#f3f4f6', accent:'#d4af37', tick:'#ffe08a', metaOther:'#94a3b8', line:'rgba(255,255,255,0.06)',
    pattern:'#d4af37', patternOp:0.11, symbols:['ic:gate','ic:star8','ic:bull','ic:tablet','ic:crescent','ic:jar'] },
  ashur: { name:'آشور', hero:'ic:bull', chatBg:'#1f1710', mine:'linear-gradient(135deg,#8a5a2b,#c48b47)', other:'#3a2c1d',
    textMine:'#fff8ec', textOther:'#f1e4cc', accent:'#e0b36a', tick:'#ffe6b0', metaOther:'#b89f7a', line:'rgba(255,255,255,0.05)',
    pattern:'#c9a064', patternOp:0.11, symbols:['ic:bull','ic:arch','ic:sun','ic:gate','ic:star8','ic:tablet'] },
  sumer: { name:'سومر', hero:'ic:ziggurat', chatBg:'#ecd9b8', mine:'linear-gradient(135deg,#a8552d,#cc7b49)', other:'#fbf1de',
    textMine:'#ffffff', textOther:'#3b2412', accent:'#8a4524', tick:'#fff3c4', metaOther:'#7a5c3a', line:'rgba(0,0,0,0.08)',
    pattern:'#7a4a24', patternOp:0.16, symbols:['ic:ziggurat','ic:tablet','ic:lyre','ic:jar','ic:reeds','ic:sun'] },
  samarra: { name:'سامراء', hero:'ic:minaret', chatBg:'#dcc690', mine:'linear-gradient(135deg,#5f4a1c,#8c6d2f)', other:'#f6eacb',
    textMine:'#ffffff', textOther:'#3a2c10', accent:'#5a4318', tick:'#ffffff', metaOther:'#7b6537', line:'rgba(0,0,0,0.08)',
    pattern:'#5f4a1c', patternOp:0.15, symbols:['ic:minaret','ic:palm','ic:arch','ic:sun','ic:wave','ic:jar'] },
  baghdad: { name:'بغداد العباسية', hero:'ic:arch', chatBg:'#0b2b2c', mine:'linear-gradient(135deg,#13787a,#25aaa3)', other:'#17484a',
    textMine:'#ffffff', textOther:'#eef6f2', accent:'#f3ead3', tick:'#c4f5f0', metaOther:'#8fb8b4', line:'rgba(255,255,255,0.06)',
    pattern:'#f3ead3', patternOp:0.10, symbols:['ic:arch','ic:crescent','ic:star8','ic:minaret','ic:palm','ic:sun'] },
  ahwar: { name:'الأهوار', hero:'ic:boat', chatBg:'#cfe3d4', mine:'linear-gradient(135deg,#2b7a8c,#3f9a7a)', other:'#f2f8ef',
    textMine:'#ffffff', textOther:'#1f3a2a', accent:'#2b6a4a', tick:'#d9f5c8', metaOther:'#5f7f6a', line:'rgba(0,0,0,0.07)',
    pattern:'#3f6b3a', patternOp:0.16, symbols:['ic:reeds','ic:boat','ic:fish','ic:wave','ic:palm','ic:sun'] }
};

const PREFS_KEY = 'babylon_chat_prefs';
let prefs = { theme:'babylon', font:15, radius:12 };
try {
  const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
  if (saved && typeof saved === 'object') {
    if (THEMES[saved.theme]) prefs.theme = saved.theme;
    if (saved.font >= 12 && saved.font <= 22) prefs.font = Number(saved.font);
    if (saved.radius >= 0 && saved.radius <= 20) prefs.radius = Number(saved.radius);
  }
} catch (e) {}

function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  syncPrefsToCloud();
}

function renderPattern(el, t, count) {
  if (!el) return;
  el.innerHTML = '';
  const n = t.symbols.length;
  for (let i = 0; i < count; i++) {
    const sp = document.createElement('span');
    const sym = t.symbols[(i * 5 + Math.floor(i / 5) * 2) % n];
    if (sym.indexOf('ic:') === 0) { try { sp.innerHTML = svgIcon(sym.slice(3), '1em'); } catch (e) {} }
    else sp.textContent = sym;
    sp.style.transform = 'rotate(' + (((i * 37) % 50) - 25) + 'deg)';
    el.appendChild(sp);
  }
}

function applyPrefs(rebuildPattern) {
  const t = THEMES[prefs.theme] || THEMES.babylon;
  const r = document.documentElement.style;
  r.setProperty('--chat-bg', t.chatBg);
  r.setProperty('--bubble-mine', t.mine);
  r.setProperty('--bubble-other', t.other);
  r.setProperty('--text-mine', t.textMine);
  r.setProperty('--text-other', t.textOther);
  r.setProperty('--accent-chat', t.accent);
  r.setProperty('--tick-read', t.tick);
  r.setProperty('--meta-other', t.metaOther);
  r.setProperty('--bubble-line', t.line);
  r.setProperty('--pattern-color', t.pattern);
  r.setProperty('--pattern-opacity', t.patternOp);
  r.setProperty('--msg-font', prefs.font + 'px');
  r.setProperty('--r', prefs.radius + 'px');
  if (rebuildPattern) {
    renderPattern(document.getElementById('chatPattern'), t, 80);
    renderPattern(document.getElementById('pvPattern'), t, 30);
  }
}

function buildThemeStrip() {
  const strip = document.getElementById('themeStrip');
  if (!strip) return;
  strip.innerHTML = '';
  Object.keys(THEMES).forEach(id => {
    const t = THEMES[id];
    const c = document.createElement('div');
    c.className = 'theme-card';
    c.dataset.id = id;
    c.innerHTML =
      '<div class="theme-thumb" style="background:' + t.chatBg + ';--pattern-color:' + t.pattern +
      ';--pattern-opacity:' + Math.min(0.4, t.patternOp * 2.4) + ';--cols:3;--cell:34px;--glyph:15px">' +
      '<div class="pattern-layer"></div>' +
      '<div class="th-mine" style="background:' + t.mine + '"></div>' +
      '<div class="th-other" style="background:' + t.other + '"></div>' +
      '<div class="th-hero" style="color:' + t.pattern + '">' + glyphHtml(t.hero, 40) + '</div></div>' +
      '<div class="theme-name">' + t.name + '</div>';
    renderPattern(c.querySelector('.pattern-layer'), t, 24);
    c.onclick = () => setTheme(id);
    strip.appendChild(c);
  });
  markSelectedTheme(false);
}

function markSelectedTheme(scroll) {
  document.querySelectorAll('#themeStrip .theme-card').forEach(c => {
    const on = c.dataset.id === prefs.theme;
    c.classList.toggle('sel', on);
    if (on && scroll) c.scrollIntoView({ inline: 'center', block: 'nearest' });
  });
}

function setTheme(id) {
  if (!THEMES[id]) return;
  prefs.theme = id;
  applyPrefs(true);
  markSelectedTheme(false);
  savePrefs();
}

function setFont(v) {
  prefs.font = Number(v);
  document.getElementById('fontVal').textContent = prefs.font;
  applyPrefs(false);
  savePrefs();
}

function setRadius(v) {
  prefs.radius = Number(v);
  document.getElementById('radiusVal').textContent = prefs.radius;
  applyPrefs(false);
  savePrefs();
}

buildThemeStrip();
applyPrefs(true);

const ICONS = {
  chat:'<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  user:'<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  sliders:'<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  pencil:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  camera:'<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3Z"/><circle cx="12" cy="13" r="3"/>',
  palette:'<circle cx="13.5" cy="6.5" r=".6"/><circle cx="17.5" cy="10.5" r=".6"/><circle cx="8.5" cy="7.5" r=".6"/><circle cx="6.5" cy="12.5" r=".6"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16c3.3 0 6-2.7 6-6 0-4.9-4.5-9-10-9Z"/>',
  copy:'<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  chevron:'<path d="m9 18 6-6-6-6"/>',
  at:'<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>',
  text:'<path d="M4 6h16M4 12h16M4 18h10"/>',
  pin:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  calendar:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  mail:'<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>'
};
function svgIcon(name, size) {
  const n = size || 20;
  return '<svg viewBox="0 0 24 24" width="' + n + '" height="' + n + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
}
function hydrateIcons() {
  document.querySelectorAll('[data-ic]').forEach(el => {
    el.innerHTML = svgIcon(el.dataset.ic, el.dataset.size);
  });
}

const GOVERNORATES = ['بغداد','البصرة','نينوى','أربيل','السليمانية','دهوك','كركوك','الأنبار','ديالى','صلاح الدين','بابل','كربلاء','النجف','واسط','ذي قار','ميسان','المثنى','القادسية'];
const COVER_RING = { babylon:'#d4af37', ashur:'#e0b36a', sumer:'#cc7b49', samarra:'#c9a24a', baghdad:'#25aaa3', ahwar:'#5fb98f' };
let otherProfileUsername = '';

function fillGovSelect() {
  const sel = document.getElementById('modalGovInput');
  if (!sel) return;
  sel.innerHTML = '<option value="">— غير محددة —</option>' + GOVERNORATES.map(g => '<option value="' + g + '">' + g + '</option>').join('');
}

function applyCover(prefix, id) {
  const themeId = THEMES[id] ? id : 'babylon';
  const t = THEMES[themeId];
  const cover = document.getElementById(prefix + 'Cover');
  if (!cover) return;
  cover.closest('.profile-view').style.setProperty('--ring', COVER_RING[themeId] || '#d4af37');
  if (cover.dataset.id === themeId) return;
  cover.dataset.id = themeId;
  cover.style.background = t.mine;
  renderPattern(document.getElementById(prefix + 'CoverPattern'), t, 24);
}

function setProfileRow(rowId, valId, text) {
  document.getElementById(rowId).classList.toggle('hidden', !text);
  document.getElementById(valId).textContent = text || '';
}

function arCount(n, one, two, few, many) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return n + ' ' + few;
  return n + ' ' + many;
}

function formatLastSeen(ts) {
  if (!ts) return 'غير متصل';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return 'آخر ظهور قبل لحظات';
  const m = Math.floor(sec / 60);
  if (m < 60) return 'آخر ظهور قبل ' + arCount(m, 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة');
  const h = Math.floor(m / 60);
  if (h < 24) return 'آخر ظهور قبل ' + arCount(h, 'ساعة', 'ساعتين', 'ساعات', 'ساعة');
  const d = Math.floor(h / 24);
  if (d < 7) return 'آخر ظهور قبل ' + arCount(d, 'يوم', 'يومين', 'أيام', 'يوم');
  return 'آخر ظهور ' + new Date(ts).toLocaleDateString('ar-IQ', { day: 'numeric', month: 'long' });
}

function formatJoinDate(ts) {
  return new Date(ts).toLocaleDateString('ar-IQ', { year: 'numeric', month: 'long' });
}

function setPfStatus(el, online, lastSeen) {
  const live = !!online && (Date.now() - (lastSeen || 0) < 45000);
  el.classList.toggle('online', live);
  el.querySelector('span:last-child').textContent = live ? 'متصل الآن' : formatLastSeen(lastSeen);
}

function copyText(text, msg) {
  if (!text) return;
  const done = () => showToast(msg || 'تم النسخ');
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;user-select:text;';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) {}
    document.body.removeChild(ta);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(fallback);
  } else {
    fallback();
  }
}

function buildCoverGrid() {
  const grid = document.getElementById('coverGrid');
  const current = (currentUserData && currentUserData.cover) || 'babylon';
  grid.innerHTML = '';
  Object.keys(THEMES).forEach(id => {
    const t = THEMES[id];
    const d = document.createElement('div');
    d.className = 'cover-opt' + (id === current ? ' sel' : '');
    d.style.background = t.mine;
    d.innerHTML = '<div class="pattern-layer"></div><b>' + t.name + '</b>';
    renderPattern(d.querySelector('.pattern-layer'), t, 12);
    d.onclick = () => setCover(id);
    grid.appendChild(d);
  });
}

function openCoverPicker() {
  buildCoverGrid();
  document.getElementById('coverModal').classList.remove('hidden');
}
function closeCoverModal(e) {
  if (e.target.id === 'coverModal') closeCoverModalDirect();
}
function closeCoverModalDirect() {
  document.getElementById('coverModal').classList.add('hidden');
}

function setCover(id) {
  if (!THEMES[id] || !currentUser) return;
  if (currentUserData) currentUserData.cover = id;
  applyCover('p', id);
  closeCoverModalDirect();
  db.collection('users').doc(currentUser.uid).set({ cover: id }, { merge: true })
    .then(() => showToast('تم تغيير الغلاف ✨'))
    .catch(() => showToast('تعذر حفظ الغلاف'));
}

hydrateIcons();
fillGovSelect();
/* ===== تعقيم النصوص ومزامنة الإعدادات ===== */
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

let prefsSyncTimer = null;
let prefsFromCloudDone = false;
function syncPrefsToCloud() {
  clearTimeout(prefsSyncTimer);
  prefsSyncTimer = setTimeout(() => {
    if (currentUser) db.collection('users').doc(currentUser.uid).set({ chatPrefs: prefs }, { merge: true }).catch(() => {});
  }, 800);
}
function syncPrefsFromUser(u) {
  if (prefsFromCloudDone || !u) return;
  prefsFromCloudDone = true;
  const c = u.chatPrefs;
  if (!c) { syncPrefsToCloud(); return; }
  if (THEMES[c.theme]) prefs.theme = c.theme;
  if (c.font >= 12 && c.font <= 22) prefs.font = Number(c.font);
  if (c.radius >= 0 && c.radius <= 20) prefs.radius = Number(c.radius);
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
  applyPrefs(true);
}
/* ===== رسومات SVG عراقية + إرسال الصور ===== */
Object.assign(ICONS, {
  image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  ziggurat:'<path d="M2 21h20M4 21v-4h16v4M7 17v-4h10v4M10 13V9h4v4M12 9V6"/>',
  gate:'<path d="M4 21V8h3V5h2v3h6V5h2v3h3v13M9 21v-6a3 3 0 0 1 6 0v6M4 12h5M15 12h5"/>',
  star8:'<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"/><circle cx="12" cy="12" r="3"/>',
  crescent:'<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
  palm:'<path d="M12 22V10M12 10c-1-3-4-4-7-3M12 10c1-3 4-4 7-3M12 10c-3 0-5 2-6 5M12 10c3 0 5 2 6 5M12 10V4"/>',
  minaret:'<path d="M12 2v3M12 5c-2.5 0-4 .8-4 2s1.500 2 4 2 4 .8 4 2-1.500 2-4 2-5 .8-5 2 2 2 5 2 5 .8 5 2M5 22h14"/>',
  tablet:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="m9 8 2 1-2 1M13 8l2 1-2 1M9 14l2 1-2 1M13 14l2 1-2 1"/>',
  jar:'<path d="M10 3h4M10.500 3v3C7 7 5.500 10 5.500 14c0 4 2.500 7 6.500 7s6.500-3 6.500-7c0-4-1.500-7-5-8V3M7 12h10"/>',
  boat:'<path d="M2 15c4 4 16 4 20 0M5 15 3 9M19 15l2-6M8 11c1-2 3-3 4-3s3 1 4 3"/>',
  reeds:'<path d="M8 22V8M8 8c-1-2 0-4 0-6 1 2 1 4 0 6M13 22V5M13 5c-1-2 0-3 0-4 1 1 1 3 0 4M18 22V10M18 10c-1-2 0-3 0-5 1 2 1 3 0 5"/>',
  bull:'<path d="M3 5c0 5 3 7 5 7M21 5c0 5-3 7-5 7M8 12c-1 3 0 7 4 9 4-2 5-6 4-9M10 15.500h.01M14 15.500h.01"/>',
  arch:'<path d="M5 22V11a7 7 0 0 1 14 0v11M9 22V12a3 3 0 0 1 6 0v10M3 22h18"/>',
  fish:'<path d="M3 12c3-5 9-6 13-2l5-3v10l-5-3c-4 4-10 3-13-2zM8 11h.01"/>',
  lyre:'<path d="M6 3c-2 6 0 12 6 14 6-2 8-8 6-14M6 3h12M10 6v13M14 6v13M8 21h8"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  wave:'<path d="M2 9c3-3 5 3 8 0s5 3 8 0 3 0 4-1M2 16c3-3 5 3 8 0s5 3 8 0 3 0 4-1"/>'
});
function glyphHtml(sym, size) {
  if (sym.indexOf('ic:') !== 0) return esc(sym);
  try { return svgIcon(sym.slice(3), size || 24); } catch (e) { return ''; }
}

function compressImage(file, cb) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(url);
    let dim = 1024, q = 0.72, out = '';
    for (let i = 0; i < 6; i++) {
      const sc = Math.min(1, dim / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * sc);
      c.height = Math.round(img.height * sc);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      out = c.toDataURL('image/jpeg', q);
      if (out.length < 850000) break;
      dim *= 0.8; q = Math.max(0.5, q - 0.08);
    }
    cb(out.length < 900000 ? out : null);
  };
  img.onerror = () => { URL.revokeObjectURL(url); cb(null); };
  img.src = url;
}

function sendImage(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file || !activeChatId) return;
  if (!file.type.startsWith('image/')) return showToast('اختر ملف صورة فقط');
  if (file.size > 15 * 1024 * 1024) return showToast('الصورة كبيرة جداً');
  showToast('جاري تجهيز الصورة...');
  compressImage(file, dataUrl => {
    if (!dataUrl) return showToast('تعذر تجهيز الصورة، جرب صورة أخرى');
    const chatId = activeChatId;
    db.collection('chats').doc(chatId).collection('messages').add({
      senderId: currentUser.uid, imageUrl: dataUrl, read: false, createdAt: Date.now()
    }).then(() => {
      db.collection('chats').doc(chatId).set({ updatedAt: Date.now() }, { merge: true });
      notifyPeer(chatId, '📷 صورة');
    }).catch(() => showToast('تعذر إرسال الصورة'));
  });
}

function openImageViewer(src) {
  const v = document.createElement('div');
  v.style.cssText = 'position:fixed;inset:0;z-index:999;background:rgba(0,0,0,.94);display:flex;align-items:center;justify-content:center;padding:12px;';
  const im = document.createElement('img');
  im.src = src;
  im.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;';
  v.appendChild(im);
  v.onclick = () => v.remove();
  document.body.appendChild(v);
}

hydrateIcons();
buildThemeStrip();
applyPrefs(true);
/* ===== الإشعارات الخارجية (Push) ===== */
function registerPushToken() {
  if (!messaging || !currentUser) return;
  messaging.getToken().then(token => {
    if (!token) return;
    db.collection('users').doc(currentUser.uid).set({
      fcmToken: token,
      fcmTokens: firebase.firestore.FieldValue.arrayUnion(token)
    }, { merge: true });
  }).catch(err => console.log('FCM token error:', err));
}

let pushTokenRefreshed = false;
function refreshPushTokenOnce() {
  if (pushTokenRefreshed) return;
  pushTokenRefreshed = true;
  if ('Notification' in window && Notification.permission === 'granted') registerPushToken();
}

function notifyPeer(chatId, text) {
  if (!currentUser || !chatId) return;
  const recipientId = chatId.split('__').find(id => id !== currentUser.uid);
  if (!recipientId) return;
  currentUser.getIdToken().then(idToken => fetch('/api/index', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + idToken },
    body: JSON.stringify({
      recipientId: recipientId,
      chatId: chatId,
      senderName: currentUserData ? currentUserData.displayName : 'رسالة جديدة',
      messageText: text
    })
  })).catch(err => console.log('Notification fetch error:', err));
}
/* ===== استعادة كلمة المرور + التحقق من البريد ===== */
auth.languageCode = 'ar';

const DISPOSABLE_DOMAINS = ['mailinator.com','yopmail.com','guerrillamail.com','sharklasers.com','10minutemail.com','tempmail.com','temp-mail.org','trashmail.com','getnada.com','dispostable.com','maildrop.cc','throwawaymail.com','fakeinbox.com','mohmal.com'];
function isDisposableEmail(e) {
  return DISPOSABLE_DOMAINS.includes(((e.split('@')[1]) || '').toLowerCase());
}

const _switchTab = switchTab;
switchTab = function (t) { document.getElementById('formForgot').classList.add('hidden'); _switchTab(t); };

function openForgotPassword() {
  clearErrors();
  document.getElementById('formLogin').classList.add('hidden');
  document.getElementById('formForgot').classList.remove('hidden');
  const v = document.getElementById('loginEmail').value.trim().replace(/^@/, '');
  if (v.includes('@')) document.getElementById('forgotEmail').value = v;
}
function closeForgotPassword() {
  document.getElementById('formForgot').classList.add('hidden');
  document.getElementById('formLogin').classList.remove('hidden');
}
function sendReset() {
  clearErrors();
  const email = document.getElementById('forgotEmail').value.trim();
  if (!email || !email.includes('@')) return showFieldError('forgotEmailError', 'اكتب بريدك الإلكتروني');
  auth.sendPasswordResetEmail(email).then(() => {
    showToast('إذا البريد مسجل عندنا، وصلك رابط الاستعادة. شيّك السبام');
    closeForgotPassword();
  }).catch(err => {
    if (err.code === 'auth/invalid-email') showFieldError('forgotEmailError', 'البريد الإلكتروني غير صالح');
    else if (err.code === 'auth/too-many-requests') showFieldError('forgotEmailError', 'محاولات كثيرة، جرّب بعد قليل');
    else { showToast('إذا البريد مسجل عندنا، وصلك رابط الاستعادة. شيّك السبام'); closeForgotPassword(); }
  });
}

function sendVerification(u) {
  return u.sendEmailVerification({ url: location.origin }).catch(err => {
    if (err && /continue-uri/.test(err.code || '')) return u.sendEmailVerification();
    throw err;
  });
}
function showVerifyPage(user) {
  document.getElementById('authPage').classList.add('hidden');
  document.getElementById('mainPage').classList.add('hidden');
  document.getElementById('verifyPage').classList.remove('hidden');
  document.getElementById('verifyEmail').textContent = user.email || '';
  try {
    const k = 'vsent_' + user.uid;
    if (!sessionStorage.getItem(k)) { sessionStorage.setItem(k, '1'); sendVerification(user).catch(() => {}); }
  } catch (e) {}
}
let resendCooldown = false;
function resendVerification() {
  const u = auth.currentUser, btn = document.getElementById('resendBtn');
  if (!u || resendCooldown) return;
  resendCooldown = true;
  sendVerification(u).then(() => showToast('أرسلنا الرابط من جديد'))
    .catch(e => showToast(e && e.code === 'auth/too-many-requests' ? 'محاولات كثيرة، انتظر قليلاً' : 'تعذر الإرسال'));
  let n = 60;
  const t = setInterval(() => {
    btn.textContent = 'إعادة الإرسال (' + n + ')';
    if (--n < 0) { clearInterval(t); resendCooldown = false; btn.textContent = 'إعادة إرسال الرابط'; }
  }, 1000);
}
function checkVerified() {
  const u = auth.currentUser;
  if (!u) return;
  u.reload().then(() => u.getIdToken(true)).then(() => {
    if (u.emailVerified) location.reload();
    else showToast('لم يتم التحقق بعد، افتح الرابط من بريدك أولاً');
  }).catch(() => showToast('تعذر الفحص، حاول مرة ثانية'));
}

/* جدول أسماء المستخدمين (للدخول باليوزر قبل تسجيل الدخول) */
let usernameDocChecked = false;
function ensureUsernameDoc(u) {
  if (usernameDocChecked || !u || !u.username || !currentUser) return;
  usernameDocChecked = true;
  const ref = db.collection('usernames').doc(u.username);
  ref.get().then(d => { if (!d.exists) ref.set({ uid: currentUser.uid, email: u.email || currentUser.email }); }).catch(() => {});
}
function syncUsernameDoc(oldName, newName) {
  if (!currentUser || !newName || oldName === newName) return;
  db.collection('usernames').doc(newName).set({ uid: currentUser.uid, email: currentUser.email })
    .then(() => { if (oldName) return db.collection('usernames').doc(oldName).delete(); })
    .catch(() => {});
}
