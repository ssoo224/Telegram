/* update-gate.js — بوابة التحديث الإجباري (تعمل داخل تطبيق الأندرويد فقط).
   تقرأ version.json: minVersion = إجباري (يمنع فتح التطبيق)، latest = اختياري.
   الزر ينزّل الملف من موقعنا نفسه (/api/apk) بدون ذكر المستودع. */
(function () {
  'use strict';
  var KEY = 'babylon_update_gate';
  var DL = '/api/apk';
  var cur = 0, el = null, mode = '', dismissed = false, tries = 0;

  function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function pick(u) {
    try { var x = new URL(u || DL, location.origin); if (x.protocol === 'https:') return x.href; } catch (e) {}
    return location.origin + DL;
  }
  function copyText(t, done) {
    function fallback() {
      try {
        var a = document.createElement('textarea'); a.value = t; a.setAttribute('readonly', '');
        a.style.cssText = 'position:fixed;opacity:0;top:0;left:0'; document.body.appendChild(a); a.select();
        document.execCommand('copy'); a.remove(); done(true);
      } catch (e) { done(false); }
    }
    try { navigator.clipboard.writeText(t).then(function () { done(true); }, fallback); } catch (e) { fallback(); }
  }
  function hide() { if (el) { try { el.remove(); } catch (e) {} } el = null; mode = ''; }

  function show(force, notes, url) {
    var m = force ? 'force' : 'soft';
    if (el && mode === m && el.__u === url) return;
    hide(); mode = m;
    var d = document.createElement('div');
    d.__u = url;
    d.id = 'updPage';
    d.setAttribute('dir', 'rtl');
    d.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;background:#0b1220;color:#f1f5f9;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;font-family:inherit;text-align:center';
    d.innerHTML =
      '<div style="max-width:340px;width:100%">' +
      '<div style="font-size:54px;margin-bottom:10px">⬆️</div>' +
      '<h1 style="margin:0 0 10px;font-size:22px;font-weight:800;color:#e8c85d">' + (force ? 'تحديث مطلوب' : 'يوجد تحديث جديد') + '</h1>' +
      '<p id="updMsg" style="margin:0 0 22px;font-size:14px;line-height:1.9;color:#cbd5e1"></p>' +
      '<button id="updGo" type="button" style="width:100%;border:0;border-radius:14px;min-height:52px;font-size:16px;font-weight:800;font-family:inherit;background:linear-gradient(135deg,#e8c85d,#cba843);color:#292216">تحديث الآن</button>' +
      '<div id="updAlt" style="display:none;margin-top:18px;font-size:12px;line-height:1.8;color:#8798aa">إذا ما بدأ التنزيل، انسخ الرابط وافتحه بكروم:' +
      '<div id="updLink" dir="ltr" style="background:rgba(255,255,255,.07);border-radius:10px;padding:10px;margin:8px 0;color:#cbd5e1;word-break:break-all;user-select:all"></div>' +
      '<button id="updCopy" type="button" style="width:100%;border:1px solid rgba(255,255,255,.18);background:none;color:#e8c85d;border-radius:12px;min-height:44px;font-size:14px;font-weight:700;font-family:inherit">نسخ الرابط</button></div>' +
      (force ? '' : '<button id="updLater" type="button" style="width:100%;border:0;background:none;color:#8798aa;font-size:14px;font-family:inherit;margin-top:12px;padding:10px">لاحقاً</button>') +
      '</div>';
    var msg = d.querySelector('#updMsg');
    msg.textContent = (notes && String(notes)) || (force ? 'لازم تحدّث التطبيق حتى يكمل يشتغل.' : 'صدرت نسخة جديدة من Babylon Chat.');
    d.querySelector('#updLink').textContent = url;
    d.querySelector('#updCopy').onclick = function () {
      var b = this;
      copyText(url, function (ok) { b.textContent = ok ? 'تم النسخ ✓' : 'انسخه يدوياً من الأعلى'; });
    };
    d.querySelector('#updGo').onclick = function () {
      var nb = window.BabylonAndroidNative, done = false;
      try { if (nb && typeof nb.openExternal === 'function') { nb.openExternal(url); done = true; } } catch (e) {}
      if (!done) { try { window.open(url, '_blank'); } catch (e) {} }
      msg.textContent = 'بدأ التنزيل. بعد ما يخلص افتح الملف من إشعار التنزيلات وثبّته. إذا طلب السماح بالتثبيت من هذا المصدر فعّله.';
      d.querySelector('#updAlt').style.display = 'block';
    };
    var later = d.querySelector('#updLater');
    if (later) later.onclick = function () { dismissed = true; hide(); };
    (document.body || document.documentElement).appendChild(d);
  }

  function decide(v) {
    if (!v || !cur) return;                      /* رقم النسخة مجهول: لا نحظر أحداً */
    var min = parseInt(v.min, 10) || 0, latest = parseInt(v.latest, 10) || 0;
    if (cur < min) show(true, v.notes, pick(v.url));
    else if (cur < latest) { if (!dismissed) show(false, v.notes, pick(v.url)); else hide(); }
    else hide();
  }

  function refresh() {
    if (!cur) return;
    fetch('/version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) return;
        var v = { min: j.minVersion || 0, latest: j.latest || 0, notes: j.notes || '', url: j.url || '' };
        save(v); decide(v);
      }).catch(function () {});
  }

  function boot() {
    var C = window.Capacitor, AP = C && C.Plugins && C.Plugins.App;
    if (!AP || typeof AP.getInfo !== 'function') return false;
    if (typeof C.isNativePlatform === 'function' && !C.isNativePlatform()) return true;
    AP.getInfo().then(function (info) {
      cur = parseInt(info && info.build, 10) || 0;
      decide(load());                            /* فوراً من آخر قيمة محفوظة (حتى بدون إنترنت) */
      refresh();
    }).catch(function () {});
    if (typeof AP.addListener === 'function') AP.addListener('resume', refresh);
    return true;
  }

  if (!boot()) {
    var t = setInterval(function () { if (boot() || ++tries > 60) clearInterval(t); }, 50);
  }
})();
