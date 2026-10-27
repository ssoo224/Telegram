/* update-gate.js (v2 — تصميم جديد) — بوابة التحديث (تعمل داخل تطبيق الأندرويد فقط).
   version.json: minVersion = إجباري (يمنع فتح التطبيق)، latest = اختياري، notes = ملاحظات الإصدار.
   الزر ينزّل الملف من موقعنا نفسه (/api/apk) بدون ذكر المستودع. */
(function () {
  'use strict';
  var KEY = 'babylon_update_gate';
  var DL = '/api/apk';
  var cur = 0, el = null, mode = '', dismissed = false, tries = 0, rebuild = false;
  var RING_C = 2 * Math.PI * 62;                 /* محيط حلقة التقدم */

  var ICON = {
    up: '<svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M5 20h14"/></svg>',
    ok: '<svg viewBox="0 0 24 24" width="50" height="50" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    warn: '<svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v5"/><circle cx="12" cy="16.5" r=".6" fill="currentColor"/><path d="M10.3 3.9L2.4 17.6a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    spark: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/></svg>'
  };

  var CSS =
    '#updPage{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'padding:calc(var(--sat-real,env(safe-area-inset-top,0px)) + 20px) 22px calc(env(safe-area-inset-bottom,0px) + 22px);box-sizing:border-box;' +
    'font-family:inherit;text-align:center;color:#f4efe0;overflow:hidden;overflow-y:auto;' +
    'background:radial-gradient(120% 80% at 50% -10%,#2b2110 0%,#120e08 46%,#07090f 100%)}' +
    /* نجوم خفيفة */
    '#updPage:before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.55;' +
    'background-image:radial-gradient(1.2px 1.2px at 12% 18%,#e8c85d,transparent 60%),radial-gradient(1px 1px at 78% 12%,#fff,transparent 60%),' +
    'radial-gradient(1.4px 1.4px at 88% 42%,#e8c85d,transparent 60%),radial-gradient(1px 1px at 22% 62%,#fff,transparent 60%),' +
    'radial-gradient(1.2px 1.2px at 66% 78%,#e8c85d,transparent 60%),radial-gradient(1px 1px at 9% 88%,#fff,transparent 60%),' +
    'radial-gradient(1px 1px at 50% 30%,#fff,transparent 60%);animation:updTw 5s ease-in-out infinite alternate}' +
    /* توهّج متحرك خلف الأيقونة */
    '#updPage .u-glow{position:absolute;top:18%;left:50%;width:340px;height:340px;margin-left:-170px;border-radius:50%;pointer-events:none;' +
    'background:radial-gradient(circle,rgba(232,200,93,.28),rgba(232,200,93,0) 68%);filter:blur(6px);animation:updBreath 4.2s ease-in-out infinite}' +
    '#updPage .u-wrap{position:relative;z-index:1;width:100%;max-width:360px;display:flex;flex-direction:column;align-items:center}' +

    /* الأيقونة + حلقة التقدم */
    '#updPage .u-orb{position:relative;width:150px;height:150px;margin-bottom:22px;display:flex;align-items:center;justify-content:center}' +
    '#updPage .u-orb:before,#updPage .u-orb:after{content:"";position:absolute;inset:6px;border-radius:50%;border:1.5px solid rgba(232,200,93,.55);animation:updRing 2.8s ease-out infinite}' +
    '#updPage .u-orb:after{animation-delay:1.4s}' +
    '#updPage .u-orb svg.u-ring{position:absolute;inset:0;width:150px;height:150px;transform:rotate(-90deg)}' +
    '#updPage .u-track{fill:none;stroke:rgba(255,255,255,.09);stroke-width:5}' +
    '#updPage .u-fill{fill:none;stroke:url(#updGrad);stroke-width:5;stroke-linecap:round;stroke-dasharray:' + RING_C.toFixed(2) + ';stroke-dashoffset:' + RING_C.toFixed(2) + ';transition:stroke-dashoffset .25s ease;filter:drop-shadow(0 0 6px rgba(232,200,93,.7))}' +
    '#updPage .u-core{position:relative;width:104px;height:104px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;' +
    'background:linear-gradient(145deg,#e6bf4a,#c29428 55%,#96700f);box-shadow:0 10px 34px rgba(203,168,67,.45),inset 0 2px 0 rgba(255,255,255,.35);font-weight:900;font-size:26px;text-shadow:0 1px 3px rgba(0,0,0,.25)}' +
        '#updPage.err .u-core{background:linear-gradient(145deg,#ff9a8f,#e0443e 60%,#a42a26);color:#fff;box-shadow:0 10px 34px rgba(224,68,62,.4),inset 0 2px 0 rgba(255,255,255,.35)}' +

    /* النصوص */
    '#updPage .u-chip{display:inline-flex;align-items:center;gap:7px;direction:ltr;padding:5px 13px;border-radius:999px;font-size:12.5px;font-weight:800;letter-spacing:.4px;' +
    'color:#e8c85d;background:rgba(232,200,93,.10);border:1px solid rgba(232,200,93,.35);margin-bottom:14px}' +
    '#updPage .u-chip i{font-style:normal;opacity:.6}' +
    '#updPage h1{margin:0 0 10px;font-size:27px;font-weight:900;line-height:1.25;background:linear-gradient(180deg,#fff3c4,#e8c85d 60%,#cba843);-webkit-background-clip:text;background-clip:text;color:transparent}' +
    '#updPage .u-msg{margin:0 0 20px;font-size:14.5px;line-height:1.95;color:#cdc6b0;max-width:320px;white-space:pre-line}' +

    /* بطاقة ما الجديد */
    '#updPage .u-card{width:100%;box-sizing:border-box;margin:0 0 20px;padding:13px 15px;border-radius:18px;text-align:right;' +
    'background:linear-gradient(160deg,rgba(255,255,255,.07),rgba(255,255,255,.02));border:1px solid rgba(255,255,255,.09);' +
    '-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}' +
    '#updPage .u-card b{display:flex;align-items:center;gap:6px;font-size:12.5px;color:#e8c85d;margin-bottom:8px}' +
    '#updPage .u-card div{font-size:13.5px;line-height:1.9;color:#e3dcc6;white-space:pre-line}' +

    /* الأزرار */
    '#updPage .u-go{position:relative;overflow:hidden;width:100%;border:0;border-radius:18px;min-height:58px;font-size:17px;font-weight:900;font-family:inherit;cursor:pointer;' +
    'color:#2a1d06;background:linear-gradient(135deg,#f6dd83,#cba843 60%,#b38a22);box-shadow:0 12px 30px rgba(203,168,67,.38),inset 0 1px 0 rgba(255,255,255,.5);transition:transform .12s,opacity .2s}' +
    '#updPage .u-go:active{transform:scale(.97)}' +
    '#updPage .u-go[disabled]{opacity:.7}' +
    '#updPage .u-go:after{content:"";position:absolute;top:0;bottom:0;width:60px;left:-80px;background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);transform:skewX(-18deg);animation:updShine 3.2s ease-in-out infinite}' +
    '#updPage .u-go[disabled]:after{display:none}' +
    '#updPage .u-later{width:100%;border:0;background:none;color:#9b9484;font-size:14.5px;font-family:inherit;margin-top:10px;padding:12px;cursor:pointer}' +
    '#updPage .u-alt{display:none;width:100%;margin-top:18px;font-size:12.5px;line-height:1.8;color:#9b9484}' +
    '#updPage .u-link{direction:ltr;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:10px;margin:8px 0;color:#d9d2bc;word-break:break-all;user-select:all;font-size:12px}' +
    '#updPage .u-copy{width:100%;border:1px solid rgba(232,200,93,.4);background:none;color:#e8c85d;border-radius:14px;min-height:46px;font-size:14px;font-weight:800;font-family:inherit;cursor:pointer}' +

    '@keyframes updRing{0%{transform:scale(.72);opacity:.8}100%{transform:scale(1.32);opacity:0}}' +
    '@keyframes updBreath{0%,100%{opacity:.75;transform:scale(1)}50%{opacity:1;transform:scale(1.08)}}' +
    '@keyframes updTw{0%{opacity:.35}100%{opacity:.7}}' +
    '@keyframes updShine{0%{left:-80px}55%,100%{left:120%}}' +
    '@media (prefers-reduced-motion:reduce){#updPage *,#updPage:before{animation:none!important}}';

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
  /* يخلّي خلفية الواجهة تمتد خلف شريط الإشعارات بدل ما يظهر بلونه الفاتح */
  function cover(on) {
    try { var nb = window.BabylonAndroidNative; if (nb && typeof nb.coverBars === 'function') nb.coverBars(!!on); } catch (e) {}
  }
  function hide() {
    if (!rebuild) cover(false);
    if (el) { try { el.remove(); } catch (e) {} }
    el = null; mode = '';
    try { delete window.__babylonUpd; } catch (e) { window.__babylonUpd = null; }
  }
  function why(code) {
    var c = String(code || '').toLowerCase();
    if (!c) return '';
    var hint = '';
    if (/^http 5/.test(c)) hint = 'السيرفر ما قدر يجيب الملف حالياً (جرّب بعد دقيقة).';
    else if (/^http 4/.test(c)) hint = 'رابط التنزيل غير متاح.';
    else if (/unknownhost|connectexception|sockettimeout|ioexception|ssl/.test(c)) hint = 'مشكلة بالاتصال بالإنترنت أثناء التنزيل.';
    else if (/^truncated/.test(c)) hint = 'انقطع التنزيل قبل ما يكتمل، جرّب مرة ثانية.';
    else if (/^small|corrupt|not apk/.test(c)) hint = 'الملف اللي نزل مو سليم.';
    else if (/^wrong package/.test(c)) hint = 'الملف مو لنفس التطبيق.';
    else if (/^fileprovider|^install/.test(c)) hint = 'ما قدر يفتح شاشة التثبيت.';
    else if (/^url/.test(c)) hint = 'رابط التحديث غير مسموح.';
    return (hint ? hint + '\n' : '') + '(' + code + ')';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function show(force, notes, url, latest) {
    var m = force ? 'force' : 'soft';
    if (el && mode === m && el.__u === url) return;
    rebuild = true; hide(); rebuild = false; mode = m;
    cover(true);

    if (!document.getElementById('updStyle')) {
      var st = document.createElement('style'); st.id = 'updStyle'; st.textContent = CSS;
      (document.head || document.documentElement).appendChild(st);
    }
    var d = document.createElement('div');
    d.__u = url; d.id = 'updPage'; d.setAttribute('dir', 'rtl');
    var hasNotes = !!(notes && String(notes).trim());
    d.innerHTML =
      '<div class="u-glow"></div>' +
      '<div class="u-wrap">' +
        '<div class="u-orb">' +
          '<svg class="u-ring" viewBox="0 0 150 150"><defs><linearGradient id="updGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset="1" stop-color="#cba843"/></linearGradient></defs>' +
          '<circle class="u-track" cx="75" cy="75" r="62"/><circle class="u-fill" id="updRing" cx="75" cy="75" r="62"/></svg>' +
          '<div class="u-core" id="updCore">' + ICON.up + '</div>' +
        '</div>' +
        '<div class="u-chip">' + (cur ? 'v' + cur + ' <i>→</i> ' : '') + 'v' + (latest || '') + '</div>' +
        '<h1 id="updTitle">' + (force ? 'تحديث مطلوب' : 'يوجد تحديث جديد') + '</h1>' +
        '<p class="u-msg" id="updMsg"></p>' +
        (hasNotes ? '<div class="u-card"><b>' + ICON.spark + ' شنو الجديد</b><div>' + esc(String(notes).trim()) + '</div></div>' : '') +
        '<button id="updGo" class="u-go" type="button">تحديث الآن</button>' +
        '<div id="updAlt" class="u-alt">إذا ما بدأ التنزيل، انسخ الرابط وافتحه بكروم:' +
          '<div id="updLink" class="u-link"></div>' +
          '<button id="updCopy" class="u-copy" type="button">نسخ الرابط</button></div>' +
        (force ? '' : '<button id="updLater" class="u-later" type="button">لاحقاً</button>') +
      '</div>';

    var msg = d.querySelector('#updMsg'), core = d.querySelector('#updCore'), ring = d.querySelector('#updRing');
    var go = d.querySelector('#updGo'), alt = d.querySelector('#updAlt');
    msg.textContent = force ? 'لازم تحدّث التطبيق حتى يكمل يشتغل.' : 'صدرت نسخة جديدة من Babylon Chat.';
    d.querySelector('#updLink').textContent = url;
    d.querySelector('#updCopy').onclick = function () {
      var b = this;
      copyText(url, function (ok) { b.textContent = ok ? 'تم النسخ ✓' : 'انسخه يدوياً من الأعلى'; });
    };
    function setRing(p) { ring.style.strokeDashoffset = (RING_C * (1 - Math.max(0, Math.min(100, p)) / 100)).toFixed(2); }
    var gotState = false;
    function idle() { go.disabled = false; go.textContent = 'تحديث الآن'; }

    /* النسخ الجديدة من التطبيق تنزّل وتثبّت بنفسها وتبلّغ الصفحة بالتقدم */
    window.__babylonUpd = function (st, pct, detail) {
      gotState = true;
      d.classList.remove('err');
      if (st === 'dl') {
        core.className = 'u-core';
        var pc = core.querySelector('#updPct');
        if (!pc) { core.innerHTML = '<span dir="ltr"><span id="updPct"></span><small style="font-size:15px;margin-left:2px">%</small></span>'; pc = core.querySelector('#updPct'); }
        pc.textContent = Math.round(pct);
        setRing(pct); go.disabled = true; go.textContent = 'جاري التنزيل…';
        msg.textContent = 'لا تطلع من التطبيق لحد ما يخلص التنزيل.';
      } else if (st === 'ready') {
        core.className = 'u-core'; core.innerHTML = ICON.ok; setRing(100); idle();
        go.textContent = 'تثبيت التحديث';
        msg.textContent = 'اكتمل التنزيل. اضغط تثبيت بالنافذة اللي طلعت، وبعدها افتح التطبيق.';
      } else if (st === 'perm') {
        core.className = 'u-core'; core.innerHTML = ICON.up; idle();
        msg.textContent = 'فعّل خيار (السماح بالتثبيت من هذا المصدر) لبابل، وارجع واضغط تحديث الآن.';
      } else {
        d.classList.add('err'); core.className = 'u-core'; core.innerHTML = ICON.warn; setRing(0); idle();
        msg.textContent = 'تعذر التنزيل داخل التطبيق. انسخ الرابط وافتحه بكروم.' + (detail ? '\n' + why(detail) : ''); alt.style.display = 'block';
      }
    };
    go.onclick = function () {
      var nb = window.BabylonAndroidNative, done = false;
      try {
        if (nb && typeof nb.installUpdate === 'function') {
          gotState = false; go.disabled = true; go.textContent = 'جاري التحضير…';
          nb.installUpdate(location.origin + DL);
          setTimeout(function () { if (!gotState) { idle(); msg.textContent = 'ما وصل رد من التطبيق. اضغط تحديث الآن مرة ثانية.'; } }, 8000);
          return;
        }
      } catch (e) {}
      try { if (nb && typeof nb.openExternal === 'function') { nb.openExternal(url); done = true; } } catch (e) {}
      if (!done) { try { window.open(url, '_blank'); } catch (e) {} }
      msg.textContent = 'بدأ التنزيل. بعد ما يخلص افتح الملف من إشعار التنزيلات وثبّته. إذا طلب السماح بالتثبيت من هذا المصدر فعّله.';
      alt.style.display = 'block';
    };
    var later = d.querySelector('#updLater');
    if (later) later.onclick = function () { dismissed = true; hide(); };
    el = d;                                      /* مهم: بدونها تتكرر الصفحة مع كل فحص وتتراكم فوق بعض */
    (document.body || document.documentElement).appendChild(d);
  }

  function decide(v) {
    if (!v || !cur) return;                      /* رقم النسخة مجهول: لا نحظر أحداً */
    var min = parseInt(v.min, 10) || 0, latest = parseInt(v.latest, 10) || 0;
    if (cur < min) show(true, v.notes, pick(v.url), Math.max(min, latest));
    else if (cur < latest) { if (!dismissed) show(false, v.notes, pick(v.url), latest); else hide(); }
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
