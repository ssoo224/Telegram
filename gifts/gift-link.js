/* ===== gift-link.js — روابط الهدايا (مثل t.me/nft/...) =====
   الرابط:  <موقعنا>/nft/PlushPepe-7   (يتحول تلقائياً إلى /?nft=PlushPepe-7)
   - قائمة الثلاث نقاط بصفحة الهدية: نسخ الرابط
   - الرابط داخل رسالة يطلع بكارت معاينة، والضغط عليه يفتح الهدية مباشرة
   - فتح الرابط من خارج التطبيق يدخل على الهدية بعد تسجيل الدخول
   يعتمد على gifts.js (GIFT_KINDS, gk, gid, bgCss, thumbUrl, thumbLocal, patSvg, openGiftPage, GIFTS_READY) */
(function () {
  'use strict';
  var RE_URL = /(?:https?:\/\/[^\s<>"']+)?\/(?:nft\/|\?nft=)([A-Za-z0-9]+-\d{1,7})/;
  var cache = {};

  function slugName(K) { return String(K.name || K.key).replace(/[^A-Za-z0-9]+/g, ''); }
  function giftLink(kind, n) { return location.origin + '/nft/' + slugName(gk(kind)) + '-' + n; }
  function parseSlug(s) {
    var m = /^([A-Za-z0-9]+)-(\d{1,7})$/.exec(String(s || ''));
    if (!m) return null;
    var want = m[1].toLowerCase(), K = null;
    Object.keys(GIFT_KINDS).forEach(function (k) { if (!K && slugName(GIFT_KINDS[k]).toLowerCase() === want) K = GIFT_KINDS[k]; });
    var n = parseInt(m[2], 10);
    return (K && n >= 1 && n <= K.max) ? { K: K, n: n } : null;
  }
  function toast(t) { try { showToast(t); } catch (e) {} }
  function ready() { return (typeof GIFTS_READY !== 'undefined' && GIFTS_READY && GIFTS_READY.then) ? GIFTS_READY : Promise.resolve(); }

  /* مين يملك الهدية + بياناتها (للكارت وللفتح) */
  function fetchGift(K, n) {
    var key = K.key + '_' + n;
    if (cache[key]) return cache[key];
    cache[key] = db.collection(K.gen ? 'giftSales' : K.sales).doc(gid(K, n)).get().then(function (s) {
      if (!s.exists) return null;
      var uid = s.data().ownerId;
      return db.collection('users').doc(uid).collection(K.coll).doc(gid(K, n)).get().then(function (d) {
        return d.exists ? { uid: uid, g: Object.assign({ k: K.key }, d.data()) } : null;
      });
    }).catch(function () { delete cache[key]; return null; });
    return cache[key];
  }

  function openBySlug(slug) {
    return ready().then(function () {
      var p = parseSlug(slug);
      if (!p) { toast('رابط الهدية غير صحيح'); return; }
      return db.collection(p.K.gen ? 'giftSales' : p.K.sales).doc(gid(p.K, p.n)).get().then(function (s) {
        if (!s.exists) { toast('هذه الهدية غير موجودة'); return; }
        try { closeHistory(); } catch (e) {}
        openGiftPage(s.data().ownerId, p.n, p.K.key);
      });
    }).catch(function () { toast('تعذر فتح الهدية'); });
  }

  /* ---------- نسخ الرابط ---------- */
  function copyText(t) {
    function fb() {
      try {
        var a = document.createElement('textarea'); a.value = t; a.setAttribute('readonly', '');
        a.style.cssText = 'position:fixed;opacity:0;top:0;left:0'; document.body.appendChild(a); a.select();
        var ok = document.execCommand('copy'); a.remove(); return ok;
      } catch (e) { return false; }
    }
    try { return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return fb(); }); }
    catch (e) { return Promise.resolve(fb()); }
  }

  /* قائمة الثلاث نقاط بصفحة الهدية */
  window.giftMoreMenu = function (ov, g) {
    var old = ov.querySelector('.gp-menu'); if (old) { old.remove(); return; }
    var menu = document.createElement('div'); menu.className = 'gp-menu';
    menu.innerHTML = '<button type="button" class="gp-mi" id="gpCopy"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.1 0l-3 3A5 5 0 0 0 11 21.1l1.7-1.7"/></svg><span>نسخ الرابط</span></button>';
    ov.appendChild(menu);
    var close = function () { menu.remove(); ov.removeEventListener('click', close, true); };
    setTimeout(function () { ov.addEventListener('click', close, true); }, 0);
    menu.querySelector('#gpCopy').onclick = function (ev) {
      ev.stopPropagation();
      copyText(giftLink(g.k, g.number)).then(function (ok) { toast(ok ? 'تم نسخ الرابط' : 'تعذر النسخ'); });
      close();
    };
  };

  /* ---------- كارت المعاينة داخل المحادثة ---------- */
  function cardHtml(K, n, data) {
    var g = data && data.g;
    return '<div class="gl-site">Babylon Chat</div>'
      + '<div class="gl-title">' + esc(K.name) + ' <span>#' + n + '</span></div>'
      + '<div class="gl-art">' + (g ? '<img alt="" src="' + thumbUrl(g) + '">' : '') + '</div>'
      + '<div class="gl-sep"></div><div class="gl-btn">عرض الهدية</div>';
  }
  function decorate(box) {
    if (!box || box.__gl) return;
    var m = RE_URL.exec(box.textContent || ''); if (!m) return;
    box.__gl = 1;
    ready().then(function () {
      var p = parseSlug(m[1]); if (!p) return;
      /* الرابط يصير أزرق وقابل للضغط */
      try {
        var full = m[0].replace(/&/g, '&amp;');
        if (box.innerHTML.indexOf(full) >= 0) box.innerHTML = box.innerHTML.replace(full, '<span class="gl-link" data-gl="' + m[1] + '">' + full + '</span>');
      } catch (e) {}
      var card = document.createElement('div'); card.className = 'gl-card'; card.dataset.gl = m[1];
      card.innerHTML = cardHtml(p.K, p.n, null);
      box.parentNode.insertBefore(card, box.nextSibling);
      fetchGift(p.K, p.n).then(function (d) {
        if (!d) { card.classList.add('gone'); card.querySelector('.gl-btn').textContent = 'الهدية غير متوفرة'; return; }
        card.style.background = bgCss(d.g);
        card.innerHTML = cardHtml(p.K, p.n, d);
        card.classList.add('on');
        var im = card.querySelector('.gl-art img');
        if (im) im.onerror = function () { im.onerror = null; im.src = thumbLocal(d.g); };
      });
    });
  }
  function scan(root) { (root.querySelectorAll ? root : document).querySelectorAll('.msg-bubble .msg-text').forEach(decorate); }

  function watch() {
    var area = document.getElementById('messagesArea');
    if (!area) return setTimeout(watch, 600);
    scan(area);
    new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) { var a = list[i].addedNodes; for (var j = 0; j < a.length; j++) if (a[j].nodeType === 1) scan(a[j].matches && a[j].matches('.msg-text') ? a[j].parentNode : a[j]); }
    }).observe(area, { childList: true, subtree: true });
    area.addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest('.gl-card,.gl-link'); if (!el) return;
      if (typeof messageSelectionMode !== 'undefined' && messageSelectionMode) return;
      e.preventDefault(); e.stopPropagation();
      openBySlug(el.dataset.gl);
    }, true);
  }

  /* ---------- فتح الرابط من خارج المحادثة (/?nft=Slug-N) ---------- */
  function routeFromUrl() {
    var slug = null;
    try { slug = new URLSearchParams(location.search).get('nft'); } catch (e) {}
    if (!slug) return;
    var done = false;
    function go() {
      if (done) return; done = true;
      try { history.replaceState(null, '', location.pathname); } catch (e) {}
      setTimeout(function () { openBySlug(slug); }, 1200);
    }
    var t = setInterval(function () {
      if (window.currentUser || (typeof currentUser !== 'undefined' && currentUser)) { clearInterval(t); go(); }
    }, 400);
    setTimeout(function () { clearInterval(t); }, 120000);
  }

  window.giftLink = giftLink; window.openGiftBySlug = openBySlug; window.__glDecorate = decorate;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { watch(); routeFromUrl(); });
  else { watch(); routeFromUrl(); }
})();
