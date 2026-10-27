/* calls/calls.js (v4) — مكالمات صوتية 1:1 (WebRTC + إشارات عبر Firestore)
   يعتمد على متغيرات index.html: db, currentUser, currentChatOtherUserId, isGroupChat, babylonApi, showToast */
(function () {
  'use strict';
  var pc = null, localStream = null, callId = null, role = null, peerId = null, unsubs = [], ringTimer = null, tick = null;
  var startedAt = 0, muted = false, spkOn = false, ending = false, incoming = null;
  var seenCand = {}, candReady = false, candQueue = [], nativePending = null;
  var logged = null, ringed = false, finalStatus = null;
  var restartN = 0, appliedAnswerN = 0, handledRestart = 0, restartTries = 0, discTimer = null, failTimer = null, wl = null;

  /* ---------- أيقونات SVG ---------- */
  var IC = {
    mic: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8"/></svg>',
    micOff: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2l20 20"/><path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.8"/><path d="M5 10v1a7 7 0 0 0 11.3 5.5M19 10v1a7 7 0 0 1-.6 2.8M12 18v4M8 22h8"/></svg>',
    spk: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    end: '<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/></svg>',
    answer: '<svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></svg>'
  };

  /* ---------- ستايل ---------- */
  var st = document.createElement('style');
  st.textContent =
    '#bbCallBtn{display:inline-flex}#bbCallBtn.hidden{display:none}' +
    '#bbCallOv{position:fixed;inset:0;z-index:99999;display:none;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:linear-gradient(165deg,#1b1306,#3a2a0b 55%,#120d07);color:#f5e6b8;font-family:inherit;text-align:center;padding:24px}' +
    '#bbCallOv.on{display:flex}' +
    '#bbCallOv .av{width:124px;height:124px;border-radius:50%;background:rgba(212,175,55,.16);border:2px solid rgba(212,175,55,.55);display:flex;align-items:center;justify-content:center;font-size:50px;overflow:hidden;box-shadow:0 0 0 10px rgba(212,175,55,.07)}' +
    '#bbCallOv .av img{width:100%;height:100%;object-fit:cover}' +
    '#bbCallOv .nm{font-size:25px;font-weight:700;margin-top:6px}#bbCallOv .stt{opacity:.8;font-size:15px;min-height:20px}' +
    '#bbCallOv .row{display:none;gap:30px;margin-top:46px;align-items:flex-start;justify-content:center}' +
    '#bbCallOv .cb{display:flex;flex-direction:column;align-items:center;gap:8px;font-size:12.5px;opacity:.95}' +
    '#bbCallOv button{width:66px;height:66px;border-radius:50%;border:0;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;transition:transform .12s,background .15s}' +
    '#bbCallOv button:active{transform:scale(.92)}' +
    '#bbCallOv .acc{background:#22a559}#bbCallOv .rej{background:#e0443e}' +
    '#bbCallOv .tg{background:rgba(255,255,255,.14)}#bbCallOv .tg.on{background:#f5e6b8;color:#2a1d06}';
  document.head.appendChild(st);

  var ov = document.createElement('div');
  ov.id = 'bbCallOv';
  ov.innerHTML =
    '<div class="av" id="bbCallAv"></div><div class="nm" id="bbCallNm"></div><div class="stt" id="bbCallStt"></div>' +
    '<div class="row" id="bbRowActive">' +
      '<div class="cb"><button class="tg" id="bbCallMut" aria-label="كتم">' + IC.mic + '</button><span>كتم</span></div>' +
      '<div class="cb"><button class="rej" id="bbCallEnd" aria-label="إنهاء">' + IC.end + '</button><span>إنهاء</span></div>' +
      '<div class="cb" id="bbSpkWrap"><button class="tg" id="bbCallSpk" aria-label="السماعة">' + IC.spk + '</button><span>السماعة</span></div>' +
    '</div>' +
    '<div class="row" id="bbRowIn">' +
      '<div class="cb"><button class="rej" id="bbCallRej" aria-label="رفض">' + IC.end + '</button><span>رفض</span></div>' +
      '<div class="cb"><button class="acc" id="bbCallAcc" aria-label="رد">' + IC.answer + '</button><span>رد</span></div>' +
    '</div>' +
    '<audio id="bbCallAudio" autoplay playsinline></audio>';
  document.body.appendChild(ov);
  var $ = function (i) { return document.getElementById(i); };
  function nat() { return window.BabylonCallNative || null; }

  $('bbCallEnd').onclick = function () { stopRing(); endCall('ended'); };
  $('bbCallRej').onclick = function () { stopRing(); endCall('rejected'); };
  $('bbCallAcc').onclick = acceptCall;
  $('bbCallMut').onclick = function () {
    muted = !muted;
    if (localStream) localStream.getAudioTracks().forEach(function (t) { t.enabled = !muted; });
    $('bbCallMut').classList.toggle('on', muted);
    $('bbCallMut').innerHTML = muted ? IC.micOff : IC.mic;
  };
  $('bbCallSpk').onclick = function () {
    spkOn = !spkOn;
    try { if (nat()) nat().setSpeaker(spkOn); } catch (e) {}
    prox();
    $('bbCallSpk').classList.toggle('on', spkOn);
  };

  /* ---------- الأصوات (بدون ملفات) ---------- */
  var AC = null, ringIv = null;
  function actx() {
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (AC && AC.state === 'suspended') AC.resume().catch(function () {});
    return AC;
  }
  ['pointerdown', 'touchstart', 'keydown'].forEach(function (ev) {
    document.addEventListener(ev, function () { actx(); }, { once: true, passive: true });
  });
  function beep(freq, dur, when, vol) {
    var a = actx(); if (!a) return;
    var o = a.createOscillator(), g = a.createGain(), t = a.currentTime + (when || 0), v = vol || 0.25;
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.02);
    g.gain.setValueAtTime(v, t + dur - 0.03); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  function vib(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  function stopRing() { if (ringIv) { clearInterval(ringIv); ringIv = null; } vib(0); }
  function startRing(kind) {
    stopRing();
    function once() {
      if (kind === 'in') { beep(880, 0.18, 0); beep(660, 0.18, 0.22); beep(880, 0.18, 0.55); beep(660, 0.18, 0.77); vib([300, 150, 300]); }
      else beep(440, 0.9, 0, 0.18);
    }
    once(); ringIv = setInterval(once, kind === 'in' ? 2200 : 3000);
  }
  function endTone() { beep(520, 0.15, 0); beep(380, 0.25, 0.2); }

  /* ---------- شاشة شغالة + حساس القرب + خدمة المكالمة ---------- */
  function startFg(name) { try { if (nat() && nat().startService) nat().startService(name || ''); } catch (e) {} }
  function awake(on) {
    try { if (nat() && nat().keepScreenOn) nat().keepScreenOn(!!on); } catch (e) {}
    try {
      if (on && navigator.wakeLock && !wl) navigator.wakeLock.request('screen').then(function (l) { wl = l; }).catch(function () {});
      else if (!on && wl) { wl.release(); wl = null; }
    } catch (e) {}
  }
  function prox() {
    try { if (nat() && nat().setProximity) nat().setProximity(!!(startedAt && !spkOn && !ending)); } catch (e) {}
  }

  /* ---------- إعادة الاتصال تلقائياً عند تغيّر الشبكة ---------- */
  function tryRestart() {
    if (role !== 'caller' || !pc || ending || restartTries >= 4) return;
    restartTries++; restartN++;
    var n = restartN;
    pc.createOffer({ iceRestart: true }).then(function (o) {
      return pc.setLocalDescription(o).then(function () {
        return callRef().update({ offer: { type: o.type, sdp: o.sdp }, restartN: n });
      });
    }).catch(function () {});
  }
  function armFail() {
    if (failTimer) return;
    failTimer = setTimeout(function () { failTimer = null; if (pc && pc.connectionState !== 'connected') endCall('ended'); }, 25000);
  }
  function netChanged() {
    if (pc && role === 'caller' && startedAt && !ending) { restartTries = 0; setTimeout(tryRestart, 800); }
  }
  window.addEventListener('online', netChanged);
  try { if (navigator.connection) navigator.connection.addEventListener('change', netChanged); } catch (e) {}

  /* ---------- سجل المكالمات بالمحادثة + إشعار المكالمة الفائتة ---------- */
  function fmtDur(sec) { sec = Math.max(0, sec | 0); return ('0' + Math.floor(sec / 60)).slice(-2) + ':' + ('0' + (sec % 60)).slice(-2); }
  function neutralText(st, dur) {
    if (st === 'ended') return '📞 مكالمة صوتية · ' + fmtDur(dur);
    if (st === 'rejected') return '📞 مكالمة مرفوضة';
    if (st === 'busy') return '📞 الخط مشغول';
    return '📞 مكالمة فائتة';
  }
  /* النص حسب من يشوف الرسالة: المتصل أو المستقبِل */
  window.callLogText = function (m, mine) {
    var st = m.callStatus, d = m.duration || 0;
    if (st === 'ended') return (mine ? '📞 مكالمة صادرة · ' : '📞 مكالمة واردة · ') + fmtDur(d);
    if (st === 'rejected') return mine ? '📞 رفض المكالمة' : '📞 رفضت المكالمة';
    if (st === 'busy') return mine ? '📞 الخط مشغول' : '📞 مكالمة فائتة';
    if (st === 'cancelled') return mine ? '📞 مكالمة ملغاة' : '📞 مكالمة فائتة';
    return mine ? '📞 لم يتم الرد' : '📞 مكالمة فائتة';
  };
  function logCall() {
    try {
      if (role !== 'caller' || !callId || !peerId || !ringed || logged === callId) return;
      logged = callId;
      var dur = startedAt ? Math.max(1, Math.round((Date.now() - startedAt) / 1000)) : 0;
      var st = startedAt ? 'ended' : (finalStatus || 'missed');
      var cid = [currentUser.uid, peerId].sort().join('__'), now = Date.now();
      db.collection('chats').doc(cid).collection('messages').add({
        senderId: currentUser.uid, type: 'call', callStatus: st, duration: dur,
        text: neutralText(st, dur), read: false, createdAt: now
      }).then(function () {
        db.collection('chats').doc(cid).update({ updatedAt: now }).catch(function () {});
      }).catch(function () {});
      /* المستقبِل ما رد: إشعار عادي "مكالمة فائتة" (يظهر حتى والتطبيق مغلق) */
      if (!startedAt && (st === 'missed' || st === 'cancelled')) {
        setTimeout(function () {
          babylonApi('/api/index', { recipientId: peerId, chatId: cid, senderName: myName(), messageText: '📞 مكالمة فائتة' }, currentUser).catch(function () {});
        }, 600);
      }
    } catch (e) {}
  }
  /* عرض رسالة المكالمة كسطر وسطي بالمحادثة (بدون ما تعدّل index.html) */
  function hookRender() {
    if (typeof renderMsgDoc !== 'function' || renderMsgDoc.__bbCall) return !!(typeof renderMsgDoc === 'function' && renderMsgDoc.__bbCall);
    var orig = renderMsgDoc;
    var wrapped = function (doc, box, typing) {
      try {
        var m = doc.data();
        if (m && m.type === 'call') {
          if (typeof getLocalChatSet === 'function' && getLocalChatSet('babylon_hidden_messages_' + activeChatId).has(doc.id)) return;
          if (typeof chatClearedAt === 'function') {
            var cl = chatClearedAt(activeChatId, (typeof chatMetaCache !== 'undefined') ? chatMetaCache[activeChatId] : null);
            if (cl && (Number(m.createdAt) || 0) <= cl) return;
          }
          var row = document.createElement('div');
          row.className = 'sys-msg'; row.id = 'message_' + doc.id;
          row.textContent = window.callLogText(m, m.senderId === currentUser.uid);
          if (typing) box.insertBefore(row, typing); else box.appendChild(row);
          return;
        }
      } catch (e) {}
      return orig.apply(this, arguments);
    };
    wrapped.__bbCall = true;
    window.renderMsgDoc = wrapped;
    return true;
  }
  var hk = setInterval(function () { if (hookRender()) clearInterval(hk); }, 500);

  /* ---------- أدوات ---------- */
  function setUI(name, status, incomingMode, avatarUrl) {
    if (incomingMode && (pc || startedAt)) return;
    $('bbCallNm').textContent = name || '';
    $('bbCallStt').textContent = status || '';
    $('bbRowIn').style.display = incomingMode ? 'flex' : 'none';
    $('bbRowActive').style.display = incomingMode ? 'none' : 'flex';
    $('bbSpkWrap').style.display = nat() ? '' : 'none';
    $('bbCallMut').classList.remove('on'); $('bbCallMut').innerHTML = IC.mic;
    $('bbCallSpk').classList.toggle('on', spkOn);
    var av = $('bbCallAv'); av.innerHTML = '';
    if (avatarUrl) { var im = document.createElement('img'); im.src = avatarUrl; av.appendChild(im); } else av.textContent = (name || '؟').charAt(0);
    ov.classList.add('on');
  }
  function toast(m) { try { showToast(m); } catch (e) { console.log(m); } }
  function myName() { return (typeof currentUserData !== 'undefined' && currentUserData && currentUserData.displayName) || (currentUser && currentUser.displayName) || 'بابل'; }
  function getIce() {
    return babylonApi('/api/turn', {}, currentUser).then(function (r) {
      return (r && r.data && r.data.iceServers) || [{ urls: 'stun:stun.l.google.com:19302' }];
    }).catch(function () { return [{ urls: 'stun:stun.l.google.com:19302' }]; });
  }
  function getMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('nomic'));
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  }
  function callRef() { return db.collection('calls').doc(callId); }
  function pushCall(end) {
    try {
      if (!peerId || !callId) return;
      var cid = [currentUser.uid, peerId].sort().join('__');
      babylonApi('/api/index', { recipientId: peerId, chatId: cid, callId: callId, callEnd: !!end, senderName: myName(), messageText: end ? '' : 'مكالمة صوتية واردة' }, currentUser).catch(function () {});
    } catch (e) {}
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
      var st = pc.connectionState;
      if (st === 'connected') onConnected();
      else if (st === 'disconnected') {
        $('bbCallStt').textContent = 'جاري إعادة الاتصال…';
        clearTimeout(discTimer); discTimer = setTimeout(tryRestart, 3000); armFail();
      } else if (st === 'failed') {
        $('bbCallStt').textContent = 'جاري إعادة الاتصال…';
        tryRestart(); armFail();
      }
    };
  }
  function listenCandidates(col) {
    unsubs.push(callRef().collection(col).onSnapshot(function (s) {
      s.docChanges().forEach(function (c) {
        if (c.type !== 'added' || seenCand[c.doc.id]) return; seenCand[c.doc.id] = 1;
        if (pc) pc.addIceCandidate(new RTCIceCandidate(c.doc.data())).catch(function () {});
      });
    }));
  }
  function onConnected() {
    stopRing(); clearTimeout(ringTimer);
    try { if (nat()) nat().setSpeaker(spkOn); } catch (e) {}
    clearTimeout(discTimer); clearTimeout(failTimer); failTimer = null; restartTries = 0;
    awake(true); prox();
    if (tick) return;
    startedAt = Date.now();
    tick = setInterval(function () {
      var s = Math.floor((Date.now() - startedAt) / 1000);
      $('bbCallStt').textContent = ('0' + Math.floor(s / 60)).slice(-2) + ':' + ('0' + (s % 60)).slice(-2);
    }, 500);
  }
  function cleanup() {
    logCall();
    stopRing(); if (callId) endTone();
    clearTimeout(discTimer); clearTimeout(failTimer);
    clearTimeout(ringTimer); if (tick) clearInterval(tick); tick = null;
    unsubs.forEach(function (u) { try { u(); } catch (e) {} }); unsubs = [];
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    if (localStream) { localStream.getTracks().forEach(function (t) { t.stop(); }); localStream = null; }
    try { if (nat()) nat().resetAudio(); } catch (e) {}
    try { if (nat() && nat().setProximity) nat().setProximity(false); } catch (e) {}
    awake(false);
    try { if (nat() && nat().stopService) nat().stopService(); } catch (e) {}
    $('bbCallAudio').srcObject = null; ov.classList.remove('on');
    callId = null; role = null; peerId = null; incoming = null; muted = false; spkOn = false; ending = false; startedAt = 0;
    seenCand = {}; candReady = false; candQueue = [];
    restartN = 0; appliedAnswerN = 0; handledRestart = 0; restartTries = 0; failTimer = null; discTimer = null;
    ringed = false; finalStatus = null;
  }
  function endCall(status) {
    if (ending) return; ending = true;
    finalStatus = (role === 'caller' && !startedAt && (status === 'ended' || !status)) ? 'cancelled' : status;
    var id = callId;
    if (id) db.collection('calls').doc(id).update({ status: status || 'ended', endedBy: currentUser.uid }).catch(function () {});
    if (role === 'caller' && !startedAt) pushCall(true);   /* ألغِ رنين الطرف الثاني */
    cleanup();
  }
  function watchStatus() {
    unsubs.push(callRef().onSnapshot(function (d) {
      var c = d.data(); if (!c || ending) return;
      if (c.status === 'active' && role === 'caller' && pc && c.answer && !pc.currentRemoteDescription) {
        pc.setRemoteDescription(new RTCSessionDescription(c.answer)).catch(function () {});
        $('bbCallStt').textContent = 'جاري الاتصال…'; stopRing();
      }
      /* إعادة تفاوض بعد انقطاع الشبكة: المتصل يرسل عرضاً جديداً، المستقبِل يجيب */
      if (role === 'callee' && pc && c.restartN && c.restartN > handledRestart && c.offer) {
        var rn = c.restartN; handledRestart = rn;
        pc.setRemoteDescription(new RTCSessionDescription(c.offer)).then(function () { return pc.createAnswer(); }).then(function (ans) {
          return pc.setLocalDescription(ans).then(function () {
            return callRef().update({ answer: { type: ans.type, sdp: ans.sdp }, answerN: rn });
          });
        }).catch(function () {});
      }
      if (role === 'caller' && pc && c.answer && c.answerN && c.answerN === restartN && c.answerN > appliedAnswerN) {
        appliedAnswerN = c.answerN;
        pc.setRemoteDescription(new RTCSessionDescription(c.answer)).catch(function () {});
      }
      if (['ended', 'rejected', 'missed', 'busy'].indexOf(c.status) > -1) {
        finalStatus = (c.status === 'ended' && !startedAt) ? 'rejected' : c.status;
        if (role === 'caller' && c.status === 'busy') toast('الخط مشغول');
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
    actx();
    var nm = (document.getElementById('chatTitleText') || {}).textContent || '', av = (document.querySelector('#chatAvatar img') || {}).src;
    setUI(nm, 'جاري الاتصال…', false, av);
    role = 'caller'; peerId = other; startFg(nm);
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
      candReady = true; ringed = true;
      candQueue.splice(0).forEach(function (q) { callRef().collection(q[0]).add(q[1]).catch(function () {}); });
      watchStatus(); listenCandidates('calleeCandidates');
      $('bbCallStt').textContent = 'يرن…'; startRing('out');
      pushCall(false);
      ringTimer = setTimeout(function () { endCall('missed'); }, 45000);
    }).catch(function (e) {
      toast(e && e.message === 'nomic' ? 'المتصفح لا يدعم المايك' : 'تعذّر بدء المكالمة (اسمح للمايك)'); cleanup();
    });
  }

  /* ---------- المستقبِل ---------- */
  function showIncoming(id, c) {
    if (callId) { db.collection('calls').doc(id).update({ status: 'busy', endedBy: currentUser.uid }).catch(function () {}); return; }
    callId = id; role = 'callee'; incoming = c; peerId = c.from;
    db.collection('users').doc(c.from).get().then(function (u) {
      var d = u.exists ? u.data() : {};
      var url = (typeof pvUrl === 'function' && u.exists) ? pvUrl(d) : '';
      if (callId === id && !pc) setUI(d.displayName || 'مستخدم', 'مكالمة صوتية واردة…', true, url);
    }).catch(function () { if (callId === id && !pc) setUI('مستخدم', 'مكالمة صوتية واردة…', true); });
    watchStatus(); startRing('in');
    ringTimer = setTimeout(function () { if (callId === id && !pc) { ending = true; cleanup(); } }, 45000);
    /* فُتح التطبيق من زر (رد) بالإشعار: رد تلقائياً */
    if (nativePending && nativePending.id === id) {
      var mode = nativePending.mode; nativePending = null;
      if (mode === 'accept') setTimeout(function () { if (callId === id) acceptCall(); }, 350);
    }
  }
  function acceptCall() {
    if (!callId || !incoming || pc) return;
    stopRing(); startFg($('bbCallNm').textContent);
    setUI($('bbCallNm').textContent, 'جاري الاتصال…', false, (document.querySelector('#bbCallAv img') || {}).src);
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

  /* ---------- تسليم من تطبيق الأندرويد (إشعار المكالمة) ---------- */
  function takeNative() {
    try {
      var n = nat(); if (!n) return;
      var s = n.takePending();
      if (s) { var p = s.split('|'); nativePending = { id: p[0], mode: p[1] || 'show' }; }
    } catch (e) {}
  }
  window.BabylonCalls = {
    decline: function (id) {
      if (callId === id && role === 'callee') { stopRing(); endCall('rejected'); return; }
      try { db.collection('calls').doc(id).update({ status: 'rejected', endedBy: currentUser.uid }).catch(function () {}); } catch (e) {}
    }
  };
  document.addEventListener('visibilitychange', function () { if (!document.hidden) takeNative(); });
  window.addEventListener('focus', takeNative);
  takeNative(); setTimeout(takeNative, 1500); setTimeout(takeNative, 4000);

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
