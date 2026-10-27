/* chat-enhance.js (v1)
   1) فواصل التواريخ بين الرسائل: اليوم / البارحة / اسم اليوم / التاريخ.
   2) خانة الكتابة تكبر للأعلى (وما تنزل تحت الكيبورد) لما تنزل سطر جديد.
   لا يحتاج تعديل على index.html غير سطر السكربت. */
(function () {
  'use strict';

  /* ================= 1) فواصل التواريخ ================= */
  var css = document.createElement('style');
  css.textContent =
    '#chatView #messagesArea .bb-date-sep{align-self:center;flex:none;margin:12px 0 6px;padding:4px 14px;border-radius:14px;' +
    'font-size:12.5px;font-weight:700;line-height:1.5;letter-spacing:.1px;color:#fff;background:rgba(0,0,0,.30);' +
    '-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);pointer-events:none;user-select:none;-webkit-user-select:none}' +
    '.app-container[data-app-theme="light"] #chatView #messagesArea .bb-date-sep{background:rgba(0,0,0,.10);color:#2a3a48}' +

    /* ================= 2) الخانة تكبر للأعلى ================= */
    '#chatView:not(.bb-blk-on) .chat-input-container{position:fixed!important;left:0!important;right:0!important;' +
    'bottom:var(--bb-comp-bottom,0px)!important;z-index:7}' +
    '#chatView:not(.bb-blk-on) .messages-area{padding-bottom:calc(var(--bb-comp-h,64px) + 10px)!important}';
  document.head.appendChild(css);

  function toMs(v) {
    if (v && typeof v === 'object' && typeof v.toMillis === 'function') return v.toMillis();
    return Number(v) || 0;
  }
  function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
  function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function label(ts) {
    var d = new Date(ts), now = new Date();
    var diff = Math.round((dayStart(now) - dayStart(d)) / 86400000);
    if (diff <= 0) return 'اليوم';
    if (diff === 1) return 'البارحة';
    if (diff < 7) return d.toLocaleDateString('ar', { weekday: 'long' });
    var o = { day: 'numeric', month: 'long' };
    if (d.getFullYear() !== now.getFullYear()) o.year = 'numeric';
    return d.toLocaleDateString('ar', o);
  }

  function decorate(doc, box) {
    var m = doc.data(); if (!m) return;
    var ts = toMs(m.createdAt) || toMs(m.at);
    if (!ts) return;
    var el = document.getElementById('message_' + doc.id);
    if (!el) return;                                   /* رسالة مخفية/ما انرسمت */
    while (el.parentNode && el.parentNode !== box) el = el.parentNode;
    if (!el.parentNode) return;
    var day = dayKey(ts);
    var prev = el.previousElementSibling;
    while (prev && !prev.dataset.bbDay) prev = prev.previousElementSibling;
    var prevDay = prev ? prev.dataset.bbDay : null;
    el.dataset.bbDay = day;
    if (prevDay !== day) {
      var sep = document.createElement('div');
      sep.className = 'bb-date-sep'; sep.dataset.bbDay = day; sep.dataset.ts = String(ts);
      sep.textContent = label(ts);
      box.insertBefore(sep, el);
    }
  }

  var wrapped = false;
  function hookRender() {
    if (wrapped) return true;
    if (typeof renderMsgDoc !== 'function') return false;
    var cur = renderMsgDoc;
    var w = function (doc, box) {
      var ret = cur.apply(this, arguments);
      try { decorate(doc, box); } catch (e) {}
      return ret;
    };
    window.renderMsgDoc = w;
    wrapped = true;
    return true;
  }
  var hk = setInterval(function () { if (hookRender()) clearInterval(hk); }, 400);
  hookRender();

  /* يحدّث التسميات (اليوم/البارحة) لو عدّى منتصف الليل والتطبيق مفتوح */
  setInterval(function () {
    try {
      document.querySelectorAll('#messagesArea .bb-date-sep[data-ts]').forEach(function (s) {
        var t = label(Number(s.dataset.ts));
        if (s.textContent !== t) s.textContent = t;
      });
    } catch (e) {}
  }, 60000);

  /* ================= خصوصية: لا نكشف الإيميل بشاشة رمز التحقق ================= */
  var loginUser = null, loginAt = 0;
  function maskMail(e) {
    var p = String(e || '').split('@');
    if (p.length !== 2 || !p[0]) return '••••';
    var d = p[1].split('.');
    return p[0].charAt(0) + '•••@' + d[0].charAt(0) + '•••' + (d.length > 1 ? '.' + d.slice(1).join('.') : '');
  }
  function hookApi() {
    if (typeof babylonApi !== 'function') return false;
    if (babylonApi.__bbp) return true;
    var o = babylonApi;
    var w = function (path, body) {
      try {
        if (path === '/api/auth' && body && body.type === 'resolve-login') {
          loginUser = String(body.username || '').trim().replace(/^@/, '').toLowerCase(); loginAt = Date.now();
        }
      } catch (e) {}
      return o.apply(this, arguments);
    };
    w.__bbp = true; window.babylonApi = w;
    return true;
  }
  var hkApi = setInterval(function () { if (hookApi()) clearInterval(hkApi); }, 300);
  hookApi();

  function fixOtp(root) {
    var els = root.querySelectorAll ? root.querySelectorAll('.otp-mail') : [];
    Array.prototype.forEach.call(els, function (b) {
      var real = b.textContent || '';
      if (b.dataset.bbDone === real) return;
      var out;
      if (loginUser && Date.now() - loginAt < 600000) { b.setAttribute('dir', 'rtl'); out = 'البريد المرتبط باليوزر @' + loginUser; }
      else if (real.indexOf('@') > 0) out = maskMail(real);
      else return;
      b.dataset.bbDone = out; b.textContent = out;
    });
  }
  try {
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'characterData' && m.target.parentNode && m.target.parentNode.classList && m.target.parentNode.classList.contains('otp-mail')) fixOtp(m.target.parentNode.parentNode || document);
        for (var j = 0; j < m.addedNodes.length; j++) { var n = m.addedNodes[j]; if (n.nodeType === 1) fixOtp(n.matches && n.matches('.otp-mail') ? n.parentNode : n); }
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  } catch (e) {}

  /* ================= 2) الخانة فوق الكيبورد ================= */
  var atBottom = true, lastH = 0;
  function composer() { return document.querySelector('#chatView .chat-input-container'); }
  function area() { return document.getElementById('messagesArea'); }

  function place() {
    var c = composer(); if (!c) return;
    var vv = window.visualViewport, off = 0;
    if (vv) off = Math.max(0, Math.round(window.innerHeight - (vv.offsetTop + vv.height)));
    c.style.setProperty('--bb-comp-bottom', off + 'px');
  }
  function measure() {
    var c = composer(), cv = document.getElementById('chatView'), a = area();
    if (!c || !cv) return;
    var h = Math.round(c.getBoundingClientRect().height);
    if (h < 20) return;                                /* المحادثة مخفية */
    cv.style.setProperty('--bb-comp-h', h + 'px');
    if (h !== lastH) {
      lastH = h;
      if (a && atBottom) a.scrollTop = a.scrollHeight;
    }
  }
  function boot() {
    var c = composer(), a = area();
    if (!c || !a) return false;
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', function () { place(); measure(); });
      window.visualViewport.addEventListener('scroll', place);
    }
    window.addEventListener('resize', function () { place(); measure(); });
    a.addEventListener('scroll', function () { atBottom = (a.scrollHeight - a.scrollTop - a.clientHeight) < 140; }, { passive: true });
    try { new ResizeObserver(measure).observe(c); } catch (e) { setInterval(measure, 300); }
    var inp = document.getElementById('messageInput');
    if (inp) {
      inp.addEventListener('input', function () { place(); setTimeout(measure, 0); });
      inp.addEventListener('focus', function () { setTimeout(function () { place(); measure(); }, 150); });
    }
    place(); measure();
    return true;
  }
  var bt = setInterval(function () { if (boot()) clearInterval(bt); }, 300);
})();
