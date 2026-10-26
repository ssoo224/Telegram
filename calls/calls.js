/* calls/calls.js — مكالمات صوتية 1:1 (WebRTC + إشارات عبر Firestore)
   يعتمد على متغيرات index.html: db, currentUser, activeChatId, currentChatOtherUserId, isGroupChat, babylonApi, showToast */
(function () {
  'use strict';
  var pc = null, localStream = null, callId = null, role = null, unsubs = [], ringTimer = null, tick = null, startedAt = 0, muted = false, ending = false;
  var seenCand = {}, candReady = false, candQueue = [];

  /* ---------- ستايل ---------- */
  var st = document.createElement('style');
  st.textContent =
    '#bbCallBtn{display:inline-flex}#bbCallBtn.hidden{display:none}' +
    '#bbCallOv{position:fixed;inset:0;z-index:99999;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:linear-gradient(160deg,#1b1306,#3a2a0b 55%,#14100a);color:#f5e6b8;font-family:inherit;text-align:center;padding:24px}' +
    '#bbCallOv.on{display:flex}' +
    '#bbCallOv .av{width:120px;height:120px;border-radius:50%;background:rgba(212,175,55,.18);border:2px solid rgba(212,175,55,.6);display:flex;align-items:center;justify-content:center;font-size:48px;overflow:hidden}' +
    '#bbCallOv .av img{width:100%;height:100%;object-fit:cover}' +
    '#bbCallOv .nm{font-size:24px;font-weight:700}#bbCallOv .stt{opacity:.8;font-size:15px;min-height:20px}' +
    '#bbCallOv .row{display:flex;gap:26px;margin-top:30px}' +
    '#bbCallOv button{width:68px;height:68px;border-radius:50%;border:0;font-size:28px;color:#fff;cursor:pointer}' +
    '#bbCallOv .acc{background:#22a559}#bbCallOv .rej{background:#e0443e}#bbCallOv .mut{background:rgba(255,255,255,.16)}#bbCallOv .mut.on{background:#d4af37;color:#000}';
  document.head.appendChild(st);

  var ov = document.createElement('div');
  ov.id = 'bbCallOv';
  ov.innerHTML = '<div class="av" id="bbCallAv">📞</div><div class="nm" id="bbCallNm"></div><div class="stt" id="bbCallStt"></div>' +
    '<div class="row"><button class="mut" id="bbCallMut" title="كتم">🎙️</button><button class="acc" id="bbCallAcc" title="رد">📞</button><button class="rej" id="bbCallRej" title="إنهاء">✖</button></div>' +
    '<audio id="bbCallAudio" autoplay playsinline></audio>';
  document.body.appendChild(ov);
  var $ = function (i) { return document.getElementById(i); };
  $('bbCallRej').onclick = function () { endCall(role === 'callee' && $('bbCallAcc').style.display !== 'none' ? 'rejected' : 'ended'); };
  $('bbCallAcc').onclick = acceptCall;
  $('bbCallMut').onclick = function () {
    muted = !muted; if (localStream) localStream.getAudioTracks().forEach(function (t) { t.enabled = !muted; });
    $('bbCallMut').classList.toggle('on', muted);
  };

  /* ---------- أدوات ---------- */
  function setUI(name, status, showAccept, avatarUrl) {
    $('bbCallNm').textContent = name || '';
    $('bbCallStt').textContent = status || '';
    $('bbCallAcc').style.display = showAccept ? '' : 'none';
    $('bbCallMut').style.display = showAccept ? 'none' : '';
    var av = $('bbCallAv'); av.innerHTML = '';
    if (avatarUrl) { var im = document.createElement('img'); im.src = avatarUrl; av.appendChild(im); } else av.textContent = (name || '؟').charAt(0);
    ov.classList.add('on');
  }
  function toast(m) { try { showToast(m); } catch (e) { console.log(m); } }
  function getIce() {
    return babylonApi('/api/turn', {}, currentUser).then(function (r) {
      return (r && r.data && r.data.iceServers) || [{ urls: 'stun:stun.l.google.com:19302' }];
    }).catch(function () { return [{ urls: 'stun:stun.l.google.com:19302' }]; });
  }
  function getMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('nomic'));
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  }
  function makePC(ice, candCol) {
    pc = new RTCPeerConnection({ iceServers: ice });
    localStream.getTracks().forEach(function (t) { pc.addTrack(t, localStream); });
    pc.ontrack = function (e) { $('bbCallAudio').srcObject = e.streams[0]; };
    pc.onicecandidate = function (e) {
      if (!e.candidate) return;
      var j = e.candidate.toJSON();
      if (!candReady) { candQueue.push([candCol, j]); return; }
      callRef().collection(candCol).add(j).catch(function () {});
    };
    pc.onconnectionstatechange = function () {
      if (pc.connectionState === 'connected') onConnected();
      if (pc.connectionState === 'failed') endCall('ended');
    };
  }
  function callRef() { return db.collection('calls').doc(callId); }
  function listenCandidates(col) {
    unsubs.push(callRef().collection(col).onSnapshot(function (s) {
      s.docChanges().forEach(function (c) {
        if (c.type !== 'added' || seenCand[c.doc.id]) return; seenCand[c.doc.id] = 1;
        if (pc) pc.addIceCandidate(new RTCIceCandidate(c.doc.data())).catch(function () {});
      });
    }));
  }
  function onConnected() {
    clearTimeout(ringTimer);
    if (tick) return;
    startedAt = Date.now();
    tick = setInterval(function () {
      var s = Math.floor((Date.now() - startedAt) / 1000);
      $('bbCallStt').textContent = ('0' + Math.floor(s / 60)).slice(-2) + ':' + ('0' + (s % 60)).slice(-2);
    }, 500);
  }
  function cleanup() {
    clearTimeout(ringTimer); if (tick) clearInterval(tick); tick = null;
    unsubs.forEach(function (u) { try { u(); } catch (e) {} }); unsubs = [];
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    if (localStream) { localStream.getTracks().forEach(function (t) { t.stop(); }); localStream = null; }
    $('bbCallAudio').srcObject = null; ov.classList.remove('on');
    callId = null; role = null; muted = false; ending = false; seenCand = {}; candReady = false; candQueue = []; $('bbCallMut').classList.remove('on');
  }
  function endCall(status) {
    if (ending) return; ending = true;
    var id = callId;
    if (id) db.collection('calls').doc(id).update({ status: status || 'ended', endedBy: currentUser.uid }).catch(function () {});
    cleanup();
  }
  function watchStatus() {
    unsubs.push(callRef().onSnapshot(function (d) {
      var c = d.data(); if (!c || ending) return;
      if (c.status === 'active' && role === 'caller' && pc && c.answer && !pc.currentRemoteDescription) {
        pc.setRemoteDescription(new RTCSessionDescription(c.answer)).catch(function () {});
        $('bbCallStt').textContent = 'جاري الاتصال…';
      }
      if (['ended', 'rejected', 'missed'].indexOf(c.status) > -1) {
        if (role === 'caller' && c.status === 'rejected') toast('رفض المكالمة');
        if (role === 'caller' && c.status === 'missed') toast('ما رد على المكالمة');
        ending = true; cleanup();
      }
    }));
  }

  /* ---------- المتصل ---------- */
  function startCall() {
    var other = (typeof currentChatOtherUserId !== 'undefined') ? currentChatOtherUserId : null;
    if (!other || !currentUser || callId) return;
    if (typeof isGroupChat === 'function' && isGroupChat()) return toast('المكالمات للمحادثات الفردية فقط');
    var nm = (document.getElementById('chatTitleText') || {}).textContent || '', av = (document.querySelector('#chatAvatar img') || {}).src;
    setUI(nm, 'جاري الاتصال…', false, av);
    role = 'caller';
    Promise.all([getMic(), getIce()]).then(function (a) {
      localStream = a[0];
      callId = db.collection('calls').doc().id;
      makePC(a[1], 'callerCandidates');
      return pc.createOffer({ offerToReceiveAudio: true }).then(function (o) {
        return pc.setLocalDescription(o).then(function () {
          return callRef().set({ from: currentUser.uid, to: other, status: 'ringing', createdAt: Date.now(), offer: { type: o.type, sdp: o.sdp }, fromName: (currentUser.displayName || '') });
        });
      });
    }).then(function () {
      candReady = true;
      candQueue.splice(0).forEach(function (q) { callRef().collection(q[0]).add(q[1]).catch(function () {}); });
      watchStatus(); listenCandidates('calleeCandidates');
      $('bbCallStt').textContent = 'يرن…';
      ringTimer = setTimeout(function () { endCall('missed'); }, 45000);
    }).catch(function (e) {
      toast(e && e.message === 'nomic' ? 'المتصفح لا يدعم المايك' : 'تعذّر بدء المكالمة (اسمح للمايك)'); cleanup();
    });
  }

  /* ---------- المستقبِل ---------- */
  var incoming = null;
  function showIncoming(id, c) {
    if (callId) { db.collection('calls').doc(id).update({ status: 'rejected' }).catch(function () {}); return; }
    callId = id; role = 'callee'; incoming = c;
    db.collection('users').doc(c.from).get().then(function (u) {
      var d = u.exists ? u.data() : {};
      var url = (typeof pvUrl === 'function' && u.exists) ? pvUrl(d) : '';
      if (callId === id) setUI(d.displayName || 'مستخدم', 'مكالمة صوتية واردة…', true, url);
    }).catch(function () { setUI('مستخدم', 'مكالمة صوتية واردة…', true); });
    watchStatus();
    ringTimer = setTimeout(function () { if (callId === id && !pc) { ending = true; cleanup(); } }, 45000);
  }
  function acceptCall() {
    if (!callId || !incoming) return;
    $('bbCallStt').textContent = 'جاري الاتصال…'; $('bbCallAcc').style.display = 'none'; $('bbCallMut').style.display = '';
    Promise.all([getMic(), getIce()]).then(function (a) {
      localStream = a[0];
      candReady = true;
      makePC(a[1], 'calleeCandidates');
      listenCandidates('callerCandidates');
      return pc.setRemoteDescription(new RTCSessionDescription(incoming.offer)).then(function () { return pc.createAnswer(); }).then(function (ans) {
        return pc.setLocalDescription(ans).then(function () {
          return callRef().update({ answer: { type: ans.type, sdp: ans.sdp }, status: 'active' });
        });
      });
    }).catch(function () { toast('تعذّر الرد (اسمح للمايك)'); endCall('ended'); });
  }
  function listenIncoming() {
    db.collection('calls').where('to', '==', currentUser.uid).where('status', '==', 'ringing').onSnapshot(function (s) {
      s.docChanges().forEach(function (ch) {
        if (ch.type !== 'added') return;
        var c = ch.doc.data();
        if (Date.now() - (c.createdAt || 0) > 40000) return;   /* مكالمة قديمة */
        showIncoming(ch.doc.id, c);
      });
    }, function () {});
  }

  /* ---------- زر المكالمة بالهيدر ---------- */
  function ensureBtn() {
    var h = document.querySelector('#chatView .telegram-chat-header'); if (!h) return;
    var b = document.getElementById('bbCallBtn');
    if (!b) {
      b = document.createElement('button'); b.id = 'bbCallBtn'; b.className = 'icon-btn'; b.title = 'مكالمة صوتية'; b.setAttribute('aria-label', 'مكالمة صوتية');
      b.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>';
      b.onclick = startCall;
      var more = h.querySelector('.chat-more-btn'); h.insertBefore(b, more);
    }
    var grp = typeof isGroupChat === 'function' && isGroupChat();
    b.classList.toggle('hidden', !!grp);
  }
  setInterval(ensureBtn, 1000);

  var wait = setInterval(function () {
    if (typeof currentUser !== 'undefined' && currentUser && typeof db !== 'undefined') { clearInterval(wait); listenIncoming(); }
  }, 800);
  window.addEventListener('beforeunload', function () { if (callId) endCall('ended'); });
})();
