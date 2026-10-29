/* dev-panel.js — لوحة المطوّر: إذاعة إشعار للكل + إحصائيات.
   تظهر بالإعدادات لحساب المطوّر فقط، والسيرفر (api/broadcast.js) يتحقق مرة ثانية. */
(function () {
  'use strict';
  var DEVS = ['anldheb429@gmail.com', 'hamodeygame45@gmail.com'];
  var overlay = null, armed = false, armTimer = null;

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { return Number(n || 0).toLocaleString('en-US'); }
  function isDev(u) { return !!(u && u.email && DEVS.indexOf(String(u.email).trim().toLowerCase()) !== -1); }

  var ERR = {
    forbidden: 'هذا الخيار للمطوّر فقط',
    rate: 'انتظر قليلاً قبل المحاولة مرة ثانية',
    empty: 'اكتب العنوان والنص',
    auth: 'سجّل دخول من جديد',
    unverified: 'البريد غير مؤكد',
    origin: 'طلب مرفوض',
    server: 'خطأ بالسيرفر، حاول بعد شوي'
  };

  function api(op, data) {
    var u = window.firebase && firebase.auth().currentUser;
    if (!u) return Promise.reject({ code: 'auth' });
    return u.getIdToken().then(function (t) {
      return fetch('/api/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t },
        body: JSON.stringify(Object.assign({ op: op }, data || {}))
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw { code: j.error || 'server' };
        return j;
      });
    });
  }

  function addStyle() {
    if ($('#dvpStyle')) return;
    var s = document.createElement('style');
    s.id = 'dvpStyle';
    s.textContent =
      '#dvpOverlay{position:fixed;inset:0;z-index:100000;background:#0b1220;color:#f1f5f9;display:flex;flex-direction:column;font-family:inherit;direction:rtl}' +
      '#dvpOverlay .dvp-head{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.08)}' +
      '#dvpOverlay .dvp-head h2{margin:0;font-size:18px;font-weight:800;flex:1;color:#e8c85d}' +
      '#dvpOverlay .dvp-x{width:40px;height:40px;border-radius:12px;border:0;background:rgba(255,255,255,.07);color:#f1f5f9;font-size:20px;cursor:pointer}' +
      '#dvpOverlay .dvp-body{flex:1;overflow-y:auto;padding:16px 16px 40px}' +
      '#dvpOverlay .dvp-label{font-size:12px;font-weight:700;color:#8798aa;margin:18px 4px 10px}' +
      '#dvpOverlay .dvp-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}' +
      '#dvpOverlay .dvp-card{background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.09);border-radius:16px;padding:14px 8px;text-align:center}' +
      '#dvpOverlay .dvp-card b{display:block;font-size:22px;font-weight:800;color:#e8c85d}' +
      '#dvpOverlay .dvp-card span{font-size:11px;color:#8798aa}' +
      '#dvpOverlay input,#dvpOverlay textarea{width:100%;box-sizing:border-box;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#f1f5f9;border-radius:14px;padding:13px 14px;font-size:15px;font-family:inherit;outline:none;margin-bottom:10px;direction:rtl}' +
      '#dvpOverlay textarea{min-height:110px;resize:vertical}' +
      '#dvpOverlay input:focus,#dvpOverlay textarea:focus{border-color:#cba843}' +
      '#dvpOverlay .dvp-cnt{font-size:11px;color:#8798aa;text-align:left;margin:-4px 4px 8px}' +
      '#dvpOverlay .dvp-send{width:100%;border:0;border-radius:14px;min-height:50px;font-size:15px;font-weight:800;font-family:inherit;cursor:pointer;background:linear-gradient(135deg,#e8c85d,#cba843);color:#292216}' +
      '#dvpOverlay .dvp-send.armed{background:#ef4444;color:#fff}' +
      '#dvpOverlay .dvp-send:disabled{opacity:.55}' +
      '#dvpOverlay .dvp-msg{margin-top:12px;padding:12px 14px;border-radius:12px;font-size:13px;line-height:1.7;background:rgba(255,255,255,.06)}' +
      '#dvpOverlay .dvp-msg.ok{background:rgba(74,222,128,.14);color:#4ade80}' +
      '#dvpOverlay .dvp-msg.err{background:rgba(239,68,68,.14);color:#f87171}' +
      '#dvpOverlay .dvp-row{display:flex;justify-content:space-between;gap:10px;padding:11px 14px;border-radius:12px;background:rgba(255,255,255,.04);margin-bottom:8px;font-size:13px}' +
      '#dvpOverlay .dvp-row small{color:#8798aa;display:block;margin-top:3px}' +
      '#dvpOverlay .dvp-note{font-size:11px;line-height:1.7;color:#8798aa;margin-top:14px}';
    document.head.appendChild(s);
  }

  function renderStats(d) {
    var el = $('#dvpStats'); if (!el) return;
    el.innerHTML =
      '<div class="dvp-card"><b>' + num(d.total) + '</b><span>كل المستخدمين</span></div>' +
      '<div class="dvp-card"><b>' + num(d.day) + '</b><span>نشطين 24 ساعة</span></div>' +
      '<div class="dvp-card"><b>' + num(d.online) + '</b><span>متصلين الآن</span></div>';
    var last = $('#dvpLast'); if (!last) return;
    last.innerHTML = (d.last && d.last.length) ? d.last.map(function (x) {
      return '<div class="dvp-row"><div><strong>' + esc(x.title) + '</strong><small>' +
        esc(new Date(x.at).toLocaleString('ar-IQ')) + '</small></div><div style="text-align:left">' +
        num(x.sent) + '/' + num(x.devices) + '<small>وصل</small></div></div>';
    }).join('') : '<div class="dvp-note">ما اكو إذاعات سابقة.</div>';
  }

  function loadStats() {
    api('stats').then(renderStats).catch(function (e) {
      var el = $('#dvpStats'); if (el) el.innerHTML = '<div class="dvp-msg err" style="grid-column:1/-1">' + esc(ERR[e.code] || ERR.server) + '</div>';
    });
  }

  function showMsg(cls, txt) { var m = $('#dvpMsg'); if (m) { m.className = 'dvp-msg ' + cls; m.textContent = txt; m.style.display = 'block'; } }
  function disarm() { armed = false; clearTimeout(armTimer); var b = $('#dvpSend'); if (b) { b.classList.remove('armed'); b.textContent = 'إرسال للكل'; } }

  function onSend() {
    var t = $('#dvpTitle').value.trim(), b = $('#dvpText').value.trim(), btn = $('#dvpSend');
    if (!t || !b) { showMsg('err', ERR.empty); return; }
    if (!armed) {
      armed = true; btn.classList.add('armed'); btn.textContent = 'اضغط مرة ثانية لتأكيد الإرسال لكل المستخدمين';
      armTimer = setTimeout(disarm, 5000); return;
    }
    disarm(); btn.disabled = true; btn.textContent = 'جاري الإرسال...';
    api('send', { title: t, body: b }).then(function (r) {
      showMsg('ok', 'تم الإرسال ✅  وصل لـ ' + num(r.sent) + ' جهاز من ' + num(r.devices) + (r.failed ? ' (فشل ' + num(r.failed) + ')' : '') + (r.cleaned ? ' · تنظيف ' + num(r.cleaned) + ' توكن ميت' : ''));
      $('#dvpTitle').value = ''; $('#dvpText').value = ''; count();
      loadStats();
    }).catch(function (e) { showMsg('err', ERR[e.code] || ERR.server); })
      .then(function () { btn.disabled = false; btn.textContent = 'إرسال للكل'; });
  }

  function count() { var c = $('#dvpCnt'); if (c) c.textContent = ($('#dvpTitle').value.length) + '/60  ·  ' + ($('#dvpText').value.length) + '/300'; }

  function closePanel() { if (overlay) { overlay.remove(); overlay = null; } disarm(); }

  function openPanel() {
    if (overlay) return;
    addStyle();
    overlay = document.createElement('div');
    overlay.id = 'dvpOverlay';
    overlay.innerHTML =
      '<div class="dvp-head"><button class="dvp-x" id="dvpClose" aria-label="إغلاق">✕</button><h2>لوحة المطوّر</h2></div>' +
      '<div class="dvp-body">' +
        '<div class="dvp-label">إحصائيات</div><div class="dvp-stats" id="dvpStats"><div class="dvp-card" style="grid-column:1/-1"><span>جاري التحميل...</span></div></div>' +
        '<div class="dvp-label">إشعار عام لكل المستخدمين</div>' +
        '<input id="dvpTitle" maxlength="60" placeholder="العنوان" autocomplete="off">' +
        '<textarea id="dvpText" maxlength="300" placeholder="نص الإشعار"></textarea>' +
        '<div class="dvp-cnt" id="dvpCnt">0/60  ·  0/300</div>' +
        '<button class="dvp-send" id="dvpSend">إرسال للكل</button>' +
        '<div class="dvp-msg" id="dvpMsg" style="display:none"></div>' +
        '<div class="dvp-note">يوصل لكل الأجهزة المسجلة للإشعارات. من فتح التطبيق وقت الإرسال ممكن ما يطلعله إشعار بالشريط.</div>' +
        '<div class="dvp-label">آخر الإذاعات</div><div id="dvpLast"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    $('#dvpClose').addEventListener('click', closePanel);
    $('#dvpSend').addEventListener('click', onSend);
    $('#dvpTitle').addEventListener('input', count);
    $('#dvpText').addEventListener('input', count);
    loadStats();
  }

  function inject() {
    if ($('#devPanelRow')) return true;
    var ref = $('#settingsView .sx-item[onclick*="openNotificationSettings"]');
    if (!ref) return false;
    var row = ref.cloneNode(true);
    row.id = 'devPanelRow';
    row.removeAttribute('onclick');
    var ic = $('.sx-ic', row), tx = $('.sx-t', row);
    if (ic) { ic.style.background = '#8b5cf6'; ic.innerHTML = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>'; }
    if (tx) tx.textContent = 'لوحة المطوّر';
    row.addEventListener('click', openPanel);
    ref.parentNode.appendChild(row);
    return true;
  }

  function remove() { var r = $('#devPanelRow'); if (r) r.remove(); closePanel(); }

  function start() {
    var tries = 0;
    var wait = setInterval(function () {
      if (window.firebase && firebase.auth) {
        clearInterval(wait);
        firebase.auth().onAuthStateChanged(function (u) {
          if (!isDev(u)) { remove(); return; }
          var n = 0, t = setInterval(function () { if (inject() || ++n > 40) clearInterval(t); }, 500);
        });
      } else if (++tries > 120) clearInterval(wait);
    }, 500);
  }
  start();
})();
