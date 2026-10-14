const firebaseConfig = {
  apiKey: "AIzaSyDxQZCL4OawmPLKLRdQdbrQOHN7vl3p5EQ",
  authDomain: "aj-chat-df534.firebaseapp.com",
  projectId: "aj-chat-df534",
  storageBucket: "aj-chat-df534.firebasestorage.app",
  messagingSenderId: "1022301130899",
  appId: "1:1022301130899:web:171184929244a979b6bd66"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let activeChatId = null;

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 3000);
}

function switchTab(type) {
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
  if (user) {
    currentUser = user;
    enterApp();
  }
});

function loginUser() {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value.trim();
  if (!email || !password) return showToast("يرجى إدخال البريد وكلمة المرور");

  auth.signInWithEmailAndPassword(email, password)
    .catch(() => showToast("بيانات الدخول غير صحيحة"));
}

function registerUser() {
  const name = document.getElementById("regName").value.trim();
  const username = document.getElementById("regUsername").value.trim().toLowerCase();
  const email = document.getElementById("regEmail").value.trim();
  const password = document.getElementById("regPassword").value.trim();

  if (!name || !username || !email || !password) return showToast("يرجى ملء كافة البيانات");

  auth.createUserWithEmailAndPassword(email, password)
    .then(cred => {
      cred.user.sendEmailVerification();
      db.collection("users").doc(cred.user.uid).set({
        id: cred.user.uid,
        displayName: name,
        username: username,
        email: email,
        avatarUrl: "",
        createdAt: Date.now()
      }).then(() => {
        showToast("تم إنشاء الحساب وإرسال رابط التأكيد لإيميلك!");
        enterApp();
      });
    })
    .catch(err => showToast("خطأ: " + err.message));
}

function enterApp() {
  document.getElementById("authPage").classList.add("hidden");
  document.getElementById("mainPage").classList.remove("hidden");
  goHome();
}

function logout() { auth.signOut().then(() => location.reload()); }
function toggleMenu() { document.getElementById("menu").classList.toggle("hidden"); }

function showView(viewId) {
  ["homeView", "searchView", "profileView", "chatView"].forEach(v => document.getElementById(v).classList.add("hidden"));
  document.getElementById(viewId).classList.remove("hidden");
  document.getElementById("menu").classList.add("hidden");
}

function goHome() {
  showView("homeView");
  loadChats();
}

function openSearch() { showView("searchView"); }

function openProfile() {
  showView("profileView");
  db.collection("users").doc(currentUser.uid).get().then(doc => {
    if (doc.exists) {
      const u = doc.data();
      document.getElementById("pNameInput").value = u.displayName || "";
      document.getElementById("pUsernameInput").value = u.username || "";
      document.getElementById("pEmailInput").value = u.email || currentUser.email;

      document.getElementById("pHeaderName").textContent = u.displayName || "مستخدم";
      document.getElementById("pHeaderUser").textContent = "@" + (u.username || "username");

      if (u.avatarUrl) {
        document.getElementById("pAvatarImg").src = u.avatarUrl;
        document.getElementById("pAvatarImg").classList.remove("hidden");
        document.getElementById("pAvatarText").classList.add("hidden");
      } else {
        document.getElementById("pAvatarText").textContent = (u.displayName || "؟").charAt(0);
        document.getElementById("pAvatarText").classList.remove("hidden");
        document.getElementById("pAvatarImg").classList.add("hidden");
      }
    }
  });
}

function uploadAvatar(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    const imgData = evt.target.result;
    db.collection("users").doc(currentUser.uid).update({ avatarUrl: imgData })
      .then(() => {
        showToast("تمت تحديث صورة البروفايل!");
        openProfile();
      });
  };
  reader.readAsDataURL(file);
}

function saveProfile() {
  db.collection("users").doc(currentUser.uid).update({
    displayName: document.getElementById("pNameInput").value.trim(),
    username: document.getElementById("pUsernameInput").value.trim().toLowerCase()
  }).then(() => {
    showToast("تمت حفظ البيانات بنجاح!");
    openProfile();
  });
}

function searchUsers() {
  const q = document.getElementById("searchInput").value.trim().toLowerCase();
  const res = document.getElementById("searchResults");
  res.innerHTML = "";
  if (q.length < 2) return;

  db.collection("users").where("username", ">=", q).where("username", "<=", q + "\uf8ff")
    .get().then(snap => {
      snap.forEach(doc => {
        const u = doc.data();
        if (u.id === currentUser.uid) return;

        const div = document.createElement("div");
        div.className = "chat-item";
        div.innerHTML = `
          <div class="avatar">${u.avatarUrl ? `<img src="${u.avatarUrl}" style="width:100%;height:100%;border-radius:50%">` : (u.displayName||"?").charAt(0)}</div>
          <div class="chat-item-info">
            <div class="chat-item-name">${u.displayName}</div>
            <div class="chat-item-sub">@${u.username}</div>
          </div>`;
        div.onclick = () => startChat(u);
        res.appendChild(div);
      });
    });
}

function startChat(u) {
  const chatId = [currentUser.uid, u.id].sort().join("__");
  activeChatId = chatId;

  db.collection("chats").doc(chatId).get().then(doc => {
    if (!doc.exists) {
      db.collection("chats").doc(chatId).set({
        participants: [currentUser.uid, u.id],
        otherUser: { id: u.id, displayName: u.displayName, username: u.username },
        updatedAt: Date.now()
      });
    }
    openChatRoom(u.displayName, u.username);
  });
}

function openChatRoom(name, username) {
  document.getElementById("chatTitle").textContent = name;
  document.getElementById("chatSub").textContent = "@" + username;
  showView("chatView");

  db.collection("chats").doc(activeChatId).collection("messages")
    .orderBy("createdAt", "asc")
    .onSnapshot(snap => {
      const box = document.getElementById("messagesArea");
      box.innerHTML = "";
      snap.forEach(doc => {
        const m = doc.data();
        const b = document.createElement("div");
        b.className = "msg-bubble" + (m.senderId === currentUser.uid ? " mine" : "");
        b.innerHTML = `<div>${m.text}</div><div class="msg-time">${new Date(m.createdAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>`;
        box.appendChild(b);
      });
      box.scrollTop = box.scrollHeight;
    });
}

function sendMessage(e) {
  e.preventDefault();
  const input = document.getElementById("messageInput");
  const text = input.value.trim();
  if (!text || !activeChatId) return;

  db.collection("chats").doc(activeChatId).collection("messages").add({
    senderId: currentUser.uid,
    text: text,
    createdAt: Date.now()
  });

  db.collection("chats").doc(activeChatId).update({ updatedAt: Date.now() });
  input.value = "";
}

function loadChats() {
  const container = document.getElementById("chatList");
  db.collection("chats").where("participants", "array-contains", currentUser.uid)
    .onSnapshot(snap => {
      container.innerHTML = "";
      snap.forEach(doc => {
        const c = doc.data();
        const other = c.otherUser || {};
        const div = document.createElement("div");
        div.className = "chat-item";
        div.innerHTML = `
          <div class="avatar">${(other.displayName||"?").charAt(0)}</div>
          <div class="chat-item-info">
            <div class="chat-item-name">${other.displayName || "مستخدم"}</div>
            <div class="chat-item-sub">@${other.username || ""}</div>
          </div>`;
        div.onclick = () => {
          activeChatId = doc.id;
          openChatRoom(other.displayName, other.username);
        };
        container.appendChild(div);
      });
    });
}
