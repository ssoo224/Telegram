/* dev-panel.js — لوحة المطوّر: إذاعة إشعار للكل + إحصائيات.
   تظهر بالإعدادات لحساب المطوّر فقط، والسيرفر (api/broadcast.js) يتحقق مرة ثانية. */
(function () {
  'use strict';
  var DEVS = ['anldheb429@gmail.com', 'hamodeygame45@gmail.com'];
  var overlay = null, armed = false, armTimer = null, themeObs = null;
  /* الطور النهاري/الليلي: يتبع طور التطبيق */
  function syncTheme() {
    if (!overlay) return;
    var h = document.querySelector('.app-container[data-app-theme]');
    var t = (h && h.getAttribute('data-app-theme')) || 'dark';
    overlay.setAttribute('data-dvp-theme', t === 'light' ? 'light' : 'dark');
  }

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
      '#dvpOverlay{--dv-bg:#0b1220;--dv-text:#f1f5f9;--dv-sub:#8798aa;--dv-card:rgba(255,255,255,.045);--dv-line:rgba(255,255,255,.09);--dv-head-line:rgba(255,255,255,.08);--dv-title:#e8c85d;--dv-num:#e8c85d;--dv-input:rgba(255,255,255,.05);--dv-input-line:rgba(255,255,255,.12);--dv-x:rgba(255,255,255,.07);--dv-row:rgba(255,255,255,.04);--dv-msg:rgba(255,255,255,.06);--dv-ok:#4ade80;--dv-ok-bg:rgba(74,222,128,.14);--dv-err:#f87171;--dv-err-bg:rgba(239,68,68,.14);--dv-focus:#cba843;color-scheme:dark}' +
      '#dvpOverlay[data-dvp-theme=\"light\"]{--dv-bg:#f2f5fa;--dv-text:#16202b;--dv-sub:#6b7a8c;--dv-card:#ffffff;--dv-line:rgba(22,32,43,.10);--dv-head-line:rgba(22,32,43,.09);--dv-title:#a8790f;--dv-num:#b8891a;--dv-input:#ffffff;--dv-input-line:rgba(22,32,43,.16);--dv-x:#e8edf4;--dv-row:#ffffff;--dv-msg:rgba(22,32,43,.05);--dv-ok:#15803d;--dv-ok-bg:rgba(22,163,74,.12);--dv-err:#dc2626;--dv-err-bg:rgba(220,38,38,.10);--dv-focus:#c99a1c;color-scheme:light}' +
      '#dvpOverlay{position:fixed;inset:0;z-index:100000;background:var(--dv-bg);color:var(--dv-text);display:flex;flex-direction:column;font-family:inherit;direction:rtl}' +
      '#dvpOverlay .dvp-head{display:flex;align-items:center;gap:12px;padding:calc(14px + env(safe-area-inset-top,0px)) 16px 14px;border-bottom:1px solid var(--dv-head-line)}' +
      '#dvpOverlay .dvp-head h2{margin:0;font-size:18px;font-weight:800;flex:1;color:var(--dv-title)}' +
      '#dvpOverlay .dvp-x{width:40px;height:40px;border-radius:12px;border:0;background:var(--dv-x);color:var(--dv-text);font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}' +
      '#dvpOverlay .dvp-body{flex:1;overflow-y:auto;padding:16px 16px 40px}' +
      '#dvpOverlay .dvp-label{font-size:12px;font-weight:700;color:var(--dv-sub);margin:18px 4px 10px}' +
      '#dvpOverlay .dvp-top{background:var(--dv-card);border:1px solid var(--dv-line);border-radius:18px;padding:14px 14px 12px}' +
      '#dvpOverlay .dvp-top .dvp-label{margin:0 2px 10px;display:flex;align-items:center;gap:8px;color:var(--dv-title);font-size:13.5px;font-weight:800}' +
      '#dvpOverlay .dvp-top .dvp-label svg{width:18px;height:18px;flex:0 0 18px}' +
      '#dvpOverlay .dvp-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}' +
      '#dvpOverlay .dvp-card{background:var(--dv-card);border:1px solid var(--dv-line);border-radius:16px;padding:14px 8px;text-align:center}' +
      '#dvpOverlay .dvp-card b{display:block;font-size:22px;font-weight:800;color:var(--dv-num)}' +
      '#dvpOverlay .dvp-card span{font-size:11px;color:var(--dv-sub)}' +
      '#dvpOverlay input,#dvpOverlay textarea{width:100%;box-sizing:border-box;border:1px solid var(--dv-input-line);background:var(--dv-input);color:var(--dv-text);-webkit-text-fill-color:var(--dv-text);border-radius:14px;padding:13px 14px;font-size:15px;font-family:inherit;outline:none;margin-bottom:10px;direction:rtl}' +
      '#dvpOverlay input::placeholder,#dvpOverlay textarea::placeholder{color:var(--dv-sub);-webkit-text-fill-color:var(--dv-sub);opacity:.8}' +
      '#dvpOverlay textarea{min-height:96px;resize:vertical}' +
      '#dvpOverlay input:focus,#dvpOverlay textarea:focus{border-color:var(--dv-focus)}' +
      '#dvpOverlay .dvp-cnt{font-size:11px;color:var(--dv-sub);text-align:left;margin:-4px 4px 8px}' +
      '#dvpOverlay[data-dvp-theme="dark"] .dvp-x{color:#e8c85d;-webkit-text-fill-color:#e8c85d}' +
      '#dvpOverlay[data-dvp-theme="light"] .dvp-x{color:#000;-webkit-text-fill-color:#000}' +
      '#dvpOverlay .dvp-send{width:100%;border:0;border-radius:14px;min-height:50px;font-size:15px;font-weight:800;font-family:inherit;cursor:pointer;background:linear-gradient(135deg,#e8c85d,#cba843);color:#fff;-webkit-text-fill-color:#fff}' +
      '#dvpOverlay .dvp-send.armed{background:#ef4444;color:#fff;-webkit-text-fill-color:#fff}' +
      '#dvpOverlay .dvp-send:disabled{opacity:.55}' +
      '#dvpOverlay .dvp-row{display:flex;justify-content:space-between;gap:10px;padding:11px 14px;border-radius:12px;background:var(--dv-row);border:1px solid var(--dv-line);margin-bottom:8px;font-size:13px;color:var(--dv-text)}' +
      '#dvpOverlay .dvp-row{align-items:center}' +
      '#dvpOverlay .dvp-row-main{flex:1;min-width:0}' +
      '#dvpOverlay .dvp-row-main strong{display:block;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '#dvpOverlay .dvp-row small{color:var(--dv-sub);display:block;margin-top:3px;font-size:11px}' +
      '#dvpOverlay .dvp-bar{height:4px;border-radius:4px;background:var(--dv-msg);margin-top:8px;overflow:hidden}' +
      '#dvpOverlay .dvp-bar i{display:block;height:100%;border-radius:4px;background:linear-gradient(90deg,#e8c85d,#cba843)}' +
      '#dvpOverlay .dvp-row-n{flex:0 0 auto;min-width:64px;text-align:center;padding-inline-start:12px;border-inline-start:1px solid var(--dv-line)}' +
      '#dvpOverlay .dvp-row-n b{display:block;font-size:20px;font-weight:800;color:var(--dv-num);line-height:1.1}' +
      '#dvpOverlay .dvp-row-n span{display:block;font-size:11px;color:var(--dv-sub);margin-top:2px}' +
      '#dvpOverlay .dvp-empty{padding:16px;text-align:center;font-size:12.5px;color:var(--dv-sub);background:var(--dv-row);border:1px solid var(--dv-line);border-radius:12px}' +
      '#dvpOverlay .dvp-toast{position:absolute;left:14px;right:14px;bottom:calc(18px + env(safe-area-inset-bottom,0px));z-index:5;display:flex;align-items:center;gap:10px;padding:13px 14px;border-radius:16px;background:var(--dv-card);border:1px solid var(--dv-line);box-shadow:0 10px 30px rgba(0,0,0,.28);font-size:13.5px;font-weight:700;line-height:1.6;color:var(--dv-text);transform:translateY(140%);opacity:0;transition:transform .28s ease,opacity .22s ease;pointer-events:none}' +
      '#dvpOverlay .dvp-toast.show{transform:none;opacity:1}' +
      '#dvpOverlay .dvp-toast-ic{flex:0 0 28px;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center}' +
      '#dvpOverlay .dvp-toast-ic svg{width:16px;height:16px}' +
      '#dvpOverlay .dvp-toast.ok .dvp-toast-ic{background:var(--dv-ok-bg);color:var(--dv-ok)}' +
      '#dvpOverlay .dvp-toast.err .dvp-toast-ic{background:var(--dv-err-bg);color:var(--dv-err)}' +
      '#dvpOverlay .dvp-note{font-size:11px;line-height:1.7;color:var(--dv-sub);margin-top:12px}';
    document.head.appendChild(s);
  }

  function renderStats(d) {
    var last = $('#dvpLast'); if (!last) return;
    last.innerHTML = (d && d.last && d.last.length) ? d.last.map(function (x) {
      var pct = x.devices ? Math.max(0, Math.min(100, Math.round((x.sent / x.devices) * 100))) : 0;
      return '<div class="dvp-row"><div class="dvp-row-main"><strong>' + esc(x.title) + '</strong><small>' +
        esc(new Date(x.at).toLocaleString('ar-IQ')) + '</small>' +
        '<div class="dvp-bar"><i style="width:' + pct + '%"></i></div></div>' +
        '<div class="dvp-row-n"><b>' + num(x.sent) + '</b><span>من ' + num(x.devices) + '</span><small>وصل</small></div></div>';
    }).join('') : '<div class="dvp-empty">ما اكو إرسال سابق.</div>';
  }

  function loadStats() {
    api('stats').then(renderStats).catch(function (e) {
      var el = $('#dvpLast'); if (el) el.innerHTML = '<div class="dvp-empty">' + esc(ERR[e.code] || ERR.server) + '</div>';
    });
  }

  var toastTimer = null;
  function showMsg(cls, txt) {
    if (!overlay) return;
    var t = $('#dvpToast'); if (!t) { t = document.createElement('div'); t.id = 'dvpToast'; overlay.appendChild(t); }
    t.className = 'dvp-toast ' + cls;
    t.innerHTML = '<span class="dvp-toast-ic">' + (cls === 'ok'
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v6M12 17h.01"/></svg>') + '</span><span class="dvp-toast-t"></span>';
    t.querySelector('.dvp-toast-t').textContent = txt;
    void t.offsetWidth; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3800);
  }
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
      showMsg('ok', 'تم الإرسال · وصل لـ ' + num(r.sent) + ' جهاز من ' + num(r.devices) + (r.failed ? ' (فشل ' + num(r.failed) + ')' : '') + (r.cleaned ? ' · تنظيف ' + num(r.cleaned) + ' توكن ميت' : ''));
      $('#dvpTitle').value = ''; $('#dvpText').value = ''; count();
      loadStats();
    }).catch(function (e) { showMsg('err', ERR[e.code] || ERR.server); })
      .then(function () { btn.disabled = false; btn.textContent = 'إرسال للكل'; });
  }

  function count() { var c = $('#dvpCnt'); if (c) c.textContent = ($('#dvpTitle').value.length) + '/60  ·  ' + ($('#dvpText').value.length) + '/300'; }

  function closePanel() { if (themeObs) { themeObs.disconnect(); themeObs = null; } if (overlay) { overlay.remove(); overlay = null; } disarm(); }

  function openPanel() {
    if (overlay) return;
    addStyle();
    overlay = document.createElement('div');
    overlay.id = 'dvpOverlay';
    overlay.innerHTML =
      '<div class="dvp-head"><button class="dvp-x" id="dvpClose" aria-label="رجوع"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button><h2>لوحة المطوّر</h2></div>' +
      '<div class="dvp-body">' +
        '<div class="dvp-top">' +
          '<div class="dvp-label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg><span>إشعار للهاتف لكل المستخدمين</span></div>' +
          '<input id="dvpTitle" maxlength="60" placeholder="العنوان" autocomplete="off">' +
          '<textarea id="dvpText" maxlength="300" placeholder="نص الإشعار"></textarea>' +
          '<div class="dvp-cnt" id="dvpCnt">0/60  ·  0/300</div>' +
          '<button class="dvp-send" id="dvpSend">إرسال للكل</button>' +
        '</div>' +
        '<div class="dvp-label">إحصائيات الإرسال</div><div id="dvpLast"><div class="dvp-empty">جاري التحميل...</div></div>' +
        '<div class="dvp-note">يوصل لكل الأجهزة المسجلة للإشعارات. من فتح التطبيق وقت الإرسال ممكن ما يطلعله إشعار بالشريط.</div>' +
      '</div>';
    syncTheme();
    document.body.appendChild(overlay);
    var host = document.querySelector('.app-container[data-app-theme]');
    if (host && window.MutationObserver) {
      themeObs = new MutationObserver(syncTheme);
      themeObs.observe(host, { attributes: true, attributeFilter: ['data-app-theme'] });
    }
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
