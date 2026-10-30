/* ===== stickers/stickers.js — ملصقات بابل (على طريقة تليجرام) =====
   - لوحة الملصقات بجانب حقل الكتابة: المفضلة، المستخدمة مؤخراً، حزمك المثبتة، بحث
   - حزم الملصقات: إنشاء، إضافة، حذف، ترتيب، رابط مشاركة /addstickers/<الاسم>
   - ثلاثة أنواع: ثابتة (WebP/PNG) ومتحركة (TGS) وفيديو (WEBM)
   - الإرسال: رسالة type='sticker' (وحقل text احتياطي ليظهر "😀 ملصق" في النسخ القديمة والإشعارات)
   كل العمليات الحساسة تمر من /api/stickers، والقراءة من Firestore.
   يعتمد على متغيرات index.html: db, currentUser, activeChatId, showToast, babylonApi, CLD_CLOUD, CLD_PRESET */
(function (root) {
  'use strict';

  /* ---------- ثوابت ---------- */
  var API = '/api/stickers';
  var MAX_RECENT = 30, MAX_FAVES = 5, MAX_PER_SET = 120;
  var CACHE_KEY = 'bsk_cache_v1';
  var NAME_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
  var KIND = {
    static:   { label: 'ثابتة',  hint: 'صورة شفافة (PNG أو WebP)، ضلع واحد 512 بكسل', accept: 'image/png,image/webp,image/jpeg,image/gif', res: 'image', ext: 'webp' },
    animated: { label: 'متحركة', hint: 'ملف TGS: 512×512، أقل من 3 ثوانٍ، أقل من 64KB', accept: '.tgs', res: 'raw', ext: 'tgs' },
    video:    { label: 'فيديو',  hint: 'ملف WEBM: ضلع 512، أقل من 3 ثوانٍ، أقل من 256KB', accept: 'video/webm,.webm', res: 'video', ext: 'webm' }
  };
  var QUICK_EMOJI = ['😀', '😂', '🥹', '😍', '😎', '🥳', '😭', '😡', '🤔', '🙄', '😴', '🤯', '👍', '👎', '🙏', '👏', '💪', '🔥', '❤️', '💔', '🎉', '✨', '👀', '💯'];
  var ERR = {
    name: 'الاسم غير صالح: من 5 إلى 32 حرفاً إنجليزياً صغيراً وأرقاماً و _', taken: 'هذا الاسم محجوز، جرّب اسماً آخر',
    title: 'العنوان مطلوب (حتى 40 حرفاً)', emoji: 'اختر إيموجي للملصق', size: 'حجم الملف أكبر من المسموح',
    dimensions: 'الأبعاد غير مناسبة: يجب أن يكون أحد الضلعين 512 بكسل', format: 'صيغة الملف غير مدعومة',
    duration: 'مدة الحركة أطول من 3 ثوانٍ', expressions: 'ملف الحركة يحتوي تعابير غير مسموحة', layers: 'ملف الحركة يحتوي نصوصاً أو صوراً غير مسموحة',
    assets: 'ملف الحركة يحتوي صوراً خارجية', complex: 'ملف الحركة معقّد جداً', full: 'الحزمة ممتلئة (120 ملصق)', setlimit: 'وصلت الحد الأقصى من الحزم',
    rate: 'محاولات كثيرة، انتظر قليلاً', owner: 'هذه ليست حزمتك', last: 'هذا آخر ملصق، احذف الحزمة بدلاً منه', url: 'تعذر قراءة الملف المرفوع',
    file: 'تعذر قراءة الملف المرفوع', noset: 'الحزمة غير موجودة', own: 'لا يمكنك الإبلاغ عن حزمتك', unverified: 'أكّد بريدك أولاً', otp: 'سجّل الدخول من جديد'
  };

  /* ---------- دوال صرفة (تُختبر خارج المتصفح) ---------- */
  var SINGLE_EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic}\uFE0F?)*$/u;
  function stripVS(s) { return String(s || '').replace(/\uFE0F/g, ''); }
  function isSingleEmoji(t) { t = String(t || '').trim(); return !!t && SINGLE_EMOJI.test(t); }
  function firstEmojis(t, n) {
    t = String(t || '');
    var parts = (typeof Intl !== 'undefined' && Intl.Segmenter)
      ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t), function (x) { return x.segment; })
      : Array.from(t);
    return parts.filter(function (g) { return /\p{Extended_Pictographic}/u.test(g); }).slice(0, n).join('');
  }
  function okUrl(u) { return typeof u === 'string' && /^https:\/\/res\.cloudinary\.com\/[A-Za-z0-9_-]+\/(image|video|raw)\/upload\/[A-Za-z0-9_\-./,%]+$/.test(u); }
  function pushUnique(arr, item, max) {
    return [item].concat((arr || []).filter(function (x) { return !(x.s === item.s && x.i === item.i); })).slice(0, max);
  }
  function validName(n) { n = String(n || ''); return n.length >= 5 && n.length <= 32 && NAME_RE.test(n); }
  function E(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var pure = { isSingleEmoji: isSingleEmoji, firstEmojis: firstEmojis, stripVS: stripVS, okUrl: okUrl, pushUnique: pushUnique, validName: validName, E: E };
  if (typeof module !== 'undefined' && module.exports) { module.exports = pure; }
  if (typeof document === 'undefined') return;

  /* ====================================================================== */
  function boot() {
    var $ = function (s, r) { return (r || document).querySelector(s); };
    var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
    var S = { uid: null, data: null, loading: null, sets: {}, ovs: [], skipPop: 0, lp: false, suggTried: false, panelOpen: false };
    var saveT = 0;

    var ICON = {
      sticker: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12.5V7a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h5.5"/><path d="M20 12.5 12.5 20v-4a3.5 3.5 0 0 1 3.5-3.5z"/><path d="M9 9.5h.01M15 9.5h.01"/><path d="M9 14c.8.7 1.8 1 2.8.8"/></svg>',
      kbd: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7 14h10"/></svg>',
      search: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/></svg>',
      plus: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
      clock: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
      star: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.9z"/></svg>',
      more: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5.5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="18.5" r="1.8"/></svg>',
      close: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'
    };

    /* ---------- أدوات عامة ---------- */
    function toast(m) { try { showToast(m); } catch (e) {} }
    function me() { return (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null; }
    function curChat() { return (typeof activeChatId !== 'undefined') ? activeChatId : null; }
    function amDev() { try { return typeof isDevUser === 'function' && !!isDevUser(); } catch (e) { return false; } }
    function setRef(n) { return db.collection('stickerSets').doc(n); }
    function dataRef() { return db.collection('users').doc(me().uid).collection('stickerData').doc('main'); }
    function link(name) { return location.origin + '/addstickers/' + name; }
    function api(op, body) {
      return babylonApi(API, Object.assign({ op: op }, body || {}), me()).then(function (r) {
        if (r.status >= 200 && r.status < 300 && r.data && r.data.ok) return r.data;
        var code = (r.data && r.data.error) || ('http' + r.status);
        var e = new Error(code); e.code = code; e.userMsg = ERR[code] || 'تعذر إكمال العملية'; throw e;
      });
    }
    function fail(e) { toast((e && e.userMsg) || 'تعذر إكمال العملية'); }

    /* ---------- التخزين المحلي للحزم (يتحقق من updatedAt قبل الاستعمال) ---------- */
    function cacheAll() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); } catch (e) { return {}; } }
    function cachePut(n, u, st) { try { var c = cacheAll(); c[n] = { u: u, st: st }; var s = JSON.stringify(c); if (s.length < 2500000) localStorage.setItem(CACHE_KEY, s); } catch (e) {} }
    function cacheDrop(n) { try { var c = cacheAll(); delete c[n]; localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch (e) {} }

    /* ---------- بيانات المستخدم: المثبتة / الأخيرة / المفضلة ---------- */
    function ensureData() {
      var u = me(); if (!u) return Promise.reject(new Error('auth'));
      if (S.uid !== u.uid) { S.uid = u.uid; S.data = null; S.loading = null; S.sets = {}; S.suggTried = false; }
      if (S.data) return Promise.resolve(S.data);
      if (!S.loading) {
        S.loading = dataRef().get().then(function (d) {
          var v = d.exists ? d.data() : {};
          S.data = { installed: (v.installed || []).slice(0, 100), recent: (v.recent || []).slice(0, MAX_RECENT), faves: (v.faves || []).slice(0, MAX_FAVES) };
          return S.data;
        }).catch(function (e) { S.loading = null; throw e; });     /* لا نكتب فوق بياناتنا لو فشلت القراءة */
      }
      return S.loading;
    }
    function saveData() {
      clearTimeout(saveT);
      saveT = setTimeout(function () {
        if (!S.data || !me()) return;
        dataRef().set({ installed: S.data.installed, recent: S.data.recent, faves: S.data.faves, updatedAt: Date.now() }).catch(function () {});
      }, 600);
    }
    function isInstalled(n) { return !!S.data && S.data.installed.indexOf(n) > -1; }
    function install(n) { if (!S.data || isInstalled(n)) return; S.data.installed.unshift(n); saveData(); }
    function uninstall(n) { if (!S.data) return; S.data.installed = S.data.installed.filter(function (x) { return x !== n; }); saveData(); }

    /* ---------- تحميل الحزم ---------- */
    function toSt(name, id, v) { return { s: name, i: id, u: v.url, k: v.kind, e: v.emoji, w: v.w || 512, h: v.h || 512 }; }
    function loadSet(name) {
      if (S.sets[name]) return Promise.resolve(S.sets[name]);
      return setRef(name).get().then(function (d) {
        if (!d.exists) return null;
        var m = d.data();
        if (m.hidden && m.ownerId !== (me() && me().uid) && !amDev()) return null;
        var c = cacheAll()[name];
        if (c && c.u === m.updatedAt) return (S.sets[name] = { meta: m, stickers: c.st });
        return setRef(name).collection('stickers').orderBy('order').get().then(function (q) {
          var st = q.docs.map(function (x) { return toSt(name, x.id, x.data()); });
          cachePut(name, m.updatedAt, st);
          return (S.sets[name] = { meta: m, stickers: st });
        });
      }).catch(function () { return undefined; });                  /* undefined = فشل مؤقت (نبقيها مثبتة) */
    }
    function loadInstalled() {
      return ensureData().then(function (d) {
        return Promise.all(d.installed.map(loadSet)).then(function (arr) {
          var gone = d.installed.filter(function (n, i) { return arr[i] === null; });
          if (gone.length) { d.installed = d.installed.filter(function (n) { return gone.indexOf(n) < 0; }); saveData(); }
          return arr.filter(Boolean);
        });
      });
    }
    function findSt(s, i) {
      var set = S.sets[s]; if (set) for (var a = 0; a < set.stickers.length; a++) if (set.stickers[a].i === i) return set.stickers[a];
      var pool = ((S.data && S.data.recent) || []).concat((S.data && S.data.faves) || []);
      for (var b = 0; b < pool.length; b++) if (pool[b].s === s && pool[b].i === i) return pool[b];
      return null;
    }

    /* ---------- رسم الملصق: ثابت / فيديو / Lottie (يُركّب فقط وهو ظاهر بالشاشة) ---------- */
    var lotP = null, jsonCache = {}, jsonOrder = [], activeLots = [];
    function loadLottie() {
      if (root.lottie) return Promise.resolve(root.lottie);
      if (lotP) return lotP;
      var urls = ['https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js', 'https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie.min.js'];
      return (lotP = new Promise(function (res, rej) {
        var i = 0;
        (function next() {
          if (i >= urls.length) { lotP = null; return rej(new Error('lottie')); }
          var s = document.createElement('script'); s.src = urls[i++];
          s.onload = function () { root.lottie ? res(root.lottie) : next(); }; s.onerror = next; document.head.appendChild(s);
        })();
      }));
    }
    function lotJson(url) {
      if (jsonCache[url]) return Promise.resolve(jsonCache[url]);
      return fetch(url).then(function (r) { if (!r.ok) throw new Error('tgs'); return r.arrayBuffer(); }).then(function (b) {
        return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
      }).then(function (t) {
        var j = JSON.parse(t); jsonCache[url] = j; jsonOrder.push(url);
        if (jsonOrder.length > 40) delete jsonCache[jsonOrder.shift()];
        return j;
      });
    }
    function mountAnim(el, json, still, once) {
      return loadLottie().then(function (lot) {
        if (!el._on || !el.isConnected) return;
        var an = lot.loadAnimation({ container: el, renderer: 'canvas', loop: !(still || once), autoplay: !still, animationData: JSON.parse(JSON.stringify(json)), rendererSettings: { clearCanvas: true, preserveAspectRatio: 'xMidYMid meet' } });
        if (still) an.addEventListener('DOMLoaded', function () { try { an.goToAndStop(0, true); } catch (e) {} });
        if (once) an.addEventListener('complete', function () { try { an.goToAndStop(0, true); } catch (e) {} });
        el._an = an; activeLots.push(el);
        while (activeLots.length > 24) unmountEl(activeLots.shift());
      });
    }
    function mountEl(el) {
      if (el._on) return;
      var k = el.dataset.k, u = el.dataset.u;
      if (!okUrl(u)) return;
      el._on = true;
      var still = el.dataset.still === '1', once = el.dataset.once === '1';
      if (k === 'static') {
        var im = new Image(); im.alt = ''; im.draggable = false; im.decoding = 'async'; im.src = u; el.appendChild(im);
      } else if (k === 'video') {
        var v = document.createElement('video');
        v.muted = true; v.loop = !once; v.playsInline = true; v.disablePictureInPicture = true;
        v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
        v.preload = still ? 'metadata' : 'auto'; v.src = still ? u + '#t=0.1' : u;
        el.appendChild(v);
        if (!still) { var p = v.play(); if (p && p.catch) p.catch(function () {}); }
      } else if (k === 'animated') {
        lotJson(u).then(function (j) { return mountAnim(el, j, still, once); }).catch(function () { el._on = false; });
      }
    }
    function unmountEl(el) {
      if (!el._on) return;
      el._on = false;
      if (el._an) { try { el._an.destroy(); } catch (e) {} el._an = null; }
      var i = activeLots.indexOf(el); if (i > -1) activeLots.splice(i, 1);
      if (el.dataset.k !== 'static') el.innerHTML = '';
    }
    var io = ('IntersectionObserver' in root) ? new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) mountEl(e.target); else unmountEl(e.target); });
    }, { rootMargin: '140px' }) : null;
    function watch(scope) {
      $$('.bsk:not([data-w])', scope).forEach(function (el) { el.setAttribute('data-w', '1'); if (io) io.observe(el); else mountEl(el); });
    }
    function sk(st, o) {
      o = o || {};
      return '<span class="bsk' + (o.cls ? ' ' + o.cls : '') + '" data-k="' + E(st.k) + '" data-u="' + E(st.u) + '"' + (o.still ? ' data-still="1"' : '') + (o.once ? ' data-once="1"' : '') + '></span>';
    }
    /* تستدعيها index.html عند رسم رسالة ملصق */
    root.stickerHtml = function (m) {
      var s = m.sticker || {};
      if (!okUrl(s.url)) return '<div class="msg-text">' + E(m.text || 'ملصق') + '</div>';
      return '<div class="bsk-msg" data-set="' + E(s.set) + '" role="img" aria-label="ملصق ' + E(s.emoji || '') + '">' + sk({ k: s.kind, u: s.url }, { once: true, cls: 'bsk-big' }) + '</div>';
    };

    /* ---------- الطبقات (Sheets) مع زر الرجوع ---------- */
    function flag() { root.__babylonMediaViewerOpen = S.ovs.length > 0; }
    function openOv(cls, html) {
      var o = document.createElement('div'); o.className = 'bsk-ov ' + cls; o.innerHTML = html; document.body.appendChild(o);
      var rec = { el: o, hist: false };
      try { history.pushState({ bsk: 1 }, ''); rec.hist = true; } catch (e) {}
      S.ovs.push(rec); flag();
      o.addEventListener('click', function (e) { if (e.target === o) closeOv(rec); });
      requestAnimationFrame(function () { o.classList.add('on'); });
      return rec;
    }
    function closeOv(rec, fromBack) {
      var i = S.ovs.indexOf(rec); if (i < 0) return;
      S.ovs.splice(i, 1);
      $$('.bsk', rec.el).forEach(unmountEl);
      rec.el.remove();
      if (rec.hist && !fromBack) { S.skipPop++; root.__babylonIgnoreNextBack = true; try { history.back(); } catch (e) { S.skipPop--; } }
      if (fromBack) setTimeout(flag, 0); else flag();
    }
    function closeAllOv() { while (S.ovs.length) closeOv(S.ovs[S.ovs.length - 1]); }
    window.addEventListener('popstate', function () {
      if (S.skipPop > 0) { S.skipPop--; return; }
      var top = S.ovs[S.ovs.length - 1]; if (top) closeOv(top, true);
    });
    function later(fn) { setTimeout(fn, 160); }

    /* ---------- الإرسال ---------- */
    function sendSticker(st) {
      var u = me(), chatId = curChat();
      if (!u || !chatId || !st) return;
      try { if (typeof chatBlockedNow !== 'undefined' && chatBlockedNow) return toast(chatBlockedMsg); } catch (e) {}
      var emoji = st.e || '🙂', text = emoji + ' ملصق';
      var msg = { senderId: u.uid, type: 'sticker', text: text, sticker: { set: st.s, id: st.i, url: st.u, kind: st.k, emoji: emoji, w: st.w || 512, h: st.h || 512 }, read: false, createdAt: Date.now() };
      try { if (replyingToText) { msg.replyTo = replyingToText; if (replyingToId) msg.replyToId = replyingToId; if (replyingToSenderId) msg.replyToSenderId = replyingToSenderId; } } catch (e) {}
      db.collection('chats').doc(chatId).collection('messages').add(msg).then(function () {
        var last = {}; try { last = groupLastMsgFor(chatId, text) || {}; } catch (e) {}
        var upd = Object.assign({ updatedAt: Date.now() }, last); upd['typing_' + u.uid] = false;
        db.collection('chats').doc(chatId).set(upd, { merge: true });
        try { notifyPeer(chatId, text); } catch (e) {}
      }).catch(function () { toast('تعذر إرسال الملصق'); });
      try { if (replyingToText) cancelReply(); } catch (e) {}
      if (S.data) { S.data.recent = pushUnique(S.data.recent, { s: st.s, i: st.i, u: st.u, k: st.k, e: emoji, w: st.w || 512, h: st.h || 512 }, MAX_RECENT); saveData(); }
    }
    function toggleFave(st) {
      if (!S.data) return;
      var has = S.data.faves.some(function (x) { return x.s === st.s && x.i === st.i; });
      if (has) S.data.faves = S.data.faves.filter(function (x) { return !(x.s === st.s && x.i === st.i); });
      else {
        if (S.data.faves.length >= MAX_FAVES) return toast('المفضلة تتسع لـ ' + MAX_FAVES + ' ملصقات فقط');
        S.data.faves.unshift({ s: st.s, i: st.i, u: st.u, k: st.k, e: st.e, w: st.w, h: st.h });
      }
      saveData(); toast(has ? 'أُزيل من المفضلة' : 'أُضيف للمفضلة'); if (S.panelOpen) renderPanel();
    }

    /* ---------- معاينة (ضغطة مطوّلة / نقرة داخل الحزمة) ---------- */
    function showPreview(st, canSend) {
      var fav = !!S.data && S.data.faves.some(function (x) { return x.s === st.s && x.i === st.i; });
      var rec = openOv('bsk-prev', '<div class="bsk-pcard"><div class="bsk-pst">' + sk(st, { cls: 'bsk-huge' }) + '</div><div class="bsk-pem">' + E(st.e || '') + '</div><div class="bsk-pact">' +
        (canSend && curChat() ? '<button type="button" data-a="send" class="bsk-btn gold">إرسال</button>' : '') +
        '<button type="button" data-a="fav" class="bsk-btn">' + (fav ? 'إزالة من المفضلة' : 'إضافة للمفضلة') + '</button>' +
        '<button type="button" data-a="pack" class="bsk-btn">فتح الحزمة</button></div></div>');
      watch(rec.el);
      rec.el.addEventListener('click', function (e) {
        var a = e.target.closest && e.target.closest('[data-a]'); if (!a) return;
        var act = a.dataset.a;
        if (act === 'send') { sendSticker(st); closeOv(rec); if (S.panelOpen) closePanel(true); }
        else if (act === 'fav') { toggleFave(st); closeOv(rec); }
        else if (act === 'pack') { closeOv(rec); later(function () { openPack(st.s); }); }
      });
    }

    /* ---------- لوحة الملصقات تحت حقل الكتابة ---------- */
    function injectUi() {
      var form = $('#textInputBar'); if (!form || form.dataset.bsk) return;
      form.dataset.bsk = '1';
      var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'icon-btn bsk-toggle'; btn.setAttribute('aria-label', 'ملصقات'); btn.innerHTML = ICON.sticker;
      form.insertBefore(btn, $('label[for="chatImageInput"]', form) || form.children[1] || null);
      var panel = document.createElement('div'); panel.id = 'bskPanel'; panel.className = 'bsk-panel hidden';
      panel.innerHTML = '<div class="bsk-head"><button type="button" class="bsk-hb" data-a="search" aria-label="بحث">' + ICON.search + '</button><input class="bsk-q hidden" type="text" placeholder="ابحث بإيموجي أو اسم حزمة" autocomplete="off"><div class="bsk-ht">ملصقات</div><button type="button" class="bsk-hb" data-a="manage" aria-label="إدارة الحزم">' + ICON.plus + '</button></div><div class="bsk-body"></div><div class="bsk-tabs"></div>';
      form.parentNode.insertBefore(panel, form.nextSibling);
      var sug = document.createElement('div'); sug.id = 'bskSuggest'; sug.className = 'bsk-suggest hidden'; form.parentNode.insertBefore(sug, form);

      btn.addEventListener('click', function () { S.panelOpen ? closePanel(true) : openPanel(); });
      var inp = $('#messageInput');
      if (inp) {
        inp.addEventListener('focus', function () { if (S.panelOpen) closePanel(false); });
        inp.addEventListener('input', onTyping);
      }
      panel.addEventListener('click', onPanelClick);
      panel.addEventListener('pointerdown', onPanelDown);
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { panel.addEventListener(ev, cancelLp); });
      panel.addEventListener('scroll', cancelLp, true);
      $('.bsk-q', panel).addEventListener('input', function () { renderPanel(); });
      sug.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('.bsk-it'); if (!b) return;
        var st = findSt(b.dataset.s, b.dataset.i); if (!st) return;
        sendSticker(st); if (inp) { inp.textContent = ''; inp.dispatchEvent(new Event('input', { bubbles: true })); } hideSuggest();
      });
      var lastChat = curChat();
      setInterval(function () { var c = curChat(); if (c !== lastChat) { lastChat = c; if (S.panelOpen) closePanel(false); hideSuggest(); } }, 700);
    }
    function openPanel() {
      var panel = $('#bskPanel'); if (!panel) return;
      S.panelOpen = true; panel.classList.remove('hidden');
      var tg = $('.bsk-toggle'); if (tg) { tg.innerHTML = ICON.kbd; tg.classList.add('on'); }
      var inp = $('#messageInput'); if (inp) inp.blur();
      $('.bsk-body', panel).innerHTML = '<div class="bsk-empty">جاري التحميل…</div>';
      loadInstalled().then(renderPanel).catch(function () { $('.bsk-body', panel).innerHTML = '<div class="bsk-empty">تعذر تحميل الملصقات<br><button type="button" class="bsk-btn" data-a="retry">إعادة المحاولة</button></div>'; });
    }
    function closePanel(focus) {
      var panel = $('#bskPanel'); S.panelOpen = false; if (panel) { panel.classList.add('hidden'); $$('.bsk', panel).forEach(unmountEl); }
      var tg = $('.bsk-toggle'); if (tg) { tg.innerHTML = ICON.sticker; tg.classList.remove('on'); }
      if (focus) { var inp = $('#messageInput'); if (inp) { try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); } } }
    }
    function matchQuery(st, set, q) {
      var qq = stripVS(q).toLowerCase();
      return stripVS(st.e || '').indexOf(qq) > -1 || (set && String(set.meta.title || '').toLowerCase().indexOf(qq) > -1);
    }
    function grid(list, sec) {
      return '<div class="bsk-grid">' + list.map(function (st) { return '<button type="button" class="bsk-it" data-s="' + E(st.s) + '" data-i="' + E(st.i) + '" data-sec="' + E(sec) + '">' + sk(st) + '</button>'; }).join('') + '</div>';
    }
    function renderPanel() {
      var panel = $('#bskPanel'); if (!panel || !S.data) return;
      var body = $('.bsk-body', panel), tabs = $('.bsk-tabs', panel), qEl = $('.bsk-q', panel);
      var q = qEl && !qEl.classList.contains('hidden') ? qEl.value.trim() : '';
      var sets = S.data.installed.map(function (n) { return S.sets[n]; }).filter(Boolean);
      var html = '', tb = '';
      if (q) {
        var found = [];
        sets.forEach(function (set) { set.stickers.forEach(function (st) { if (matchQuery(st, set, q)) found.push(st); }); });
        html = found.length ? '<div class="bsk-sec"><div class="bsk-sec-t plain">نتائج البحث</div>' + grid(found.slice(0, 120), 'q') + '</div>' : '<div class="bsk-empty">لا توجد نتائج</div>';
      } else {
        if (S.data.faves.length) { html += '<div class="bsk-sec" data-sec="fav"><div class="bsk-sec-t plain">المفضلة</div>' + grid(S.data.faves, 'fav') + '</div>'; tb += '<button type="button" class="bsk-tab" data-go="fav" aria-label="المفضلة">' + ICON.star + '</button>'; }
        if (S.data.recent.length) { html += '<div class="bsk-sec" data-sec="rec"><div class="bsk-sec-t plain">المستخدمة مؤخراً</div>' + grid(S.data.recent, 'rec') + '</div>'; tb += '<button type="button" class="bsk-tab" data-go="rec" aria-label="الأخيرة">' + ICON.clock + '</button>'; }
        sets.forEach(function (set) {
          var m = set.meta, first = set.stickers[0];
          html += '<div class="bsk-sec" data-sec="set:' + E(m.name) + '"><div class="bsk-sec-t" data-pack="' + E(m.name) + '">' + E(m.title) + '</div>' + grid(set.stickers, m.name) + '</div>';
          if (first) tb += '<button type="button" class="bsk-tab" data-go="set:' + E(m.name) + '" aria-label="' + E(m.title) + '">' + sk(first, { still: true, cls: 'bsk-tn' }) + '</button>';
        });
        if (!html) html = '<div class="bsk-empty"><div class="bsk-eico">🏺</div>لا توجد ملصقات بعد<br><span>اضغط + لاكتشاف الحزم أو إنشاء حزمتك</span><br><button type="button" class="bsk-btn gold" data-a="manage">استكشاف الحزم</button></div>';
      }
      body.innerHTML = html; tabs.innerHTML = tb; watch(panel);
    }
    function onPanelClick(e) {
      var t = e.target; if (!t.closest) return;
      var a = t.closest('[data-a]');
      if (a) {
        var act = a.dataset.a;
        if (act === 'manage') return openManager();
        if (act === 'retry') return openPanel();
        if (act === 'search') { var q = $('.bsk-q'), ht = $('.bsk-ht'); var on = q.classList.contains('hidden'); q.classList.toggle('hidden', !on); ht.classList.toggle('hidden', on); if (on) q.focus(); else { q.value = ''; renderPanel(); } return; }
      }
      var it = t.closest('.bsk-it');
      if (it) { if (S.lp) { S.lp = false; return; } var st = findSt(it.dataset.s, it.dataset.i); if (st) sendSticker(st); return; }
      var pk = t.closest('[data-pack]'); if (pk) return openPack(pk.dataset.pack);
      var tab = t.closest('.bsk-tab');
      if (tab) {
        var sec = $('.bsk-sec[data-sec="' + tab.dataset.go + '"]'), body = $('.bsk-body');
        if (sec && body) body.scrollTo({ top: sec.offsetTop - body.offsetTop, behavior: 'smooth' });
      }
    }
    var lpT = 0;
    function cancelLp() { clearTimeout(lpT); }
    function onPanelDown(e) {
      var it = e.target.closest && e.target.closest('.bsk-it'); if (!it) return;
      clearTimeout(lpT);
      lpT = setTimeout(function () { var st = findSt(it.dataset.s, it.dataset.i); if (st) { S.lp = true; try { navigator.vibrate && navigator.vibrate(12); } catch (x) {} showPreview(st, true); } }, 380);
    }

    /* ---------- اقتراح ملصقات عند كتابة إيموجي واحد ---------- */
    function hideSuggest() { var s = $('#bskSuggest'); if (s) { s.classList.add('hidden'); $$('.bsk', s).forEach(unmountEl); s.innerHTML = ''; } }
    function onTyping() {
      var inp = $('#messageInput'); if (!inp) return;
      var t = (inp.textContent || '').trim();
      if (!isSingleEmoji(t)) return hideSuggest();
      if (!S.data) { if (S.suggTried) return; S.suggTried = true; return loadInstalled().then(onTyping).catch(function () {}); }
      var key = stripVS(t), out = [], seen = {};
      S.data.installed.forEach(function (n) { var set = S.sets[n]; if (set) set.stickers.forEach(function (st) { if (stripVS(st.e) === key && !seen[st.s + st.i]) { seen[st.s + st.i] = 1; out.push(st); } }); });
      if (!out.length) return hideSuggest();
      var box = $('#bskSuggest'); box.innerHTML = out.slice(0, 14).map(function (st) { return '<button type="button" class="bsk-it" data-s="' + E(st.s) + '" data-i="' + E(st.i) + '">' + sk(st) + '</button>'; }).join('');
      box.classList.remove('hidden'); watch(box);
    }

    /* ---------- صفحة الحزمة ---------- */
    function openPack(name) {
      name = String(name || '').toLowerCase();
      if (!validName(name)) return toast('رابط الحزمة غير صالح');
      var rec = openOv('bsk-sheet', '<div class="bsk-card"><div class="bsk-grab"></div><div class="bsk-ld">جاري التحميل…</div></div>');
      ensureData().catch(function () { return null; }).then(function () { delete S.sets[name]; return loadSet(name); }).then(function (set) {
        if (!rec.el.isConnected) return;
        if (set === undefined) { $('.bsk-ld', rec.el).textContent = 'تعذر التحميل، تحقق من الاتصال'; return; }
        if (!set) { $('.bsk-ld', rec.el).textContent = 'هذه الحزمة غير موجودة'; return; }
        renderPack(rec, set);
      });
    }
    function renderPack(rec, set) {
      var m = set.meta, mine = me() && m.ownerId === me().uid, inst = isInstalled(m.name);
      var card = $('.bsk-card', rec.el);
      card.innerHTML = '<div class="bsk-grab"></div><div class="bsk-ph"><div class="bsk-pt"><b>' + E(m.title) + '</b><span>' + set.stickers.length + ' ملصق · ' + KIND[m.kind].label + (m.ownerName ? ' · ' + E(m.ownerName) : '') + (m.hidden ? ' · <em>مخفية</em>' : '') + '</span></div><button type="button" class="bsk-hb" data-a="menu" aria-label="المزيد">' + ICON.more + '</button><button type="button" class="bsk-hb" data-a="close" aria-label="إغلاق">' + ICON.close + '</button></div><div class="bsk-menu hidden"></div><div class="bsk-pbody">' + grid(set.stickers, m.name) + '</div><div class="bsk-pf"><button type="button" class="bsk-btn ' + (inst ? '' : 'gold') + ' wide" data-a="toggle">' + (inst ? 'إزالة الملصقات' : 'إضافة ' + set.stickers.length + ' ملصق') + '</button></div>';
      watch(card);
      card.addEventListener('click', function (e) {
        var t = e.target; if (!t.closest) return;
        var it = t.closest('.bsk-it'); if (it) { var st = findSt(it.dataset.s, it.dataset.i); if (st) showPreview(st, true); return; }
        var a = t.closest('[data-a]'); if (!a) return;
        var act = a.dataset.a;
        if (act === 'close') return closeOv(rec);
        if (act === 'toggle') {
          ensureData().then(function () { if (isInstalled(m.name)) { uninstall(m.name); toast('أُزيلت الحزمة'); } else { install(m.name); toast('تمت إضافة الحزمة'); } renderPack(rec, set); if (S.panelOpen) loadInstalled().then(renderPanel); }).catch(function () { toast('تعذر الحفظ'); });
          return;
        }
        if (act === 'menu') return packMenu(rec, set, mine);
      });
    }
    function packMenu(rec, set, mine) {
      var m = set.meta, box = $('.bsk-menu', rec.el);
      if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
      var items = [['copy', 'نسخ الرابط'], ['share', 'مشاركة في المحادثة']];
      if (mine) items.push(['edit', 'تعديل الحزمة']); else items.push(['report', 'إبلاغ']);
      if (amDev()) { items.push(['devhide', m.hidden ? 'إظهار الحزمة (مطوّر)' : 'إخفاء الحزمة (مطوّر)']); if (!mine) items.push(['devdel', 'حذف الحزمة (مطوّر)']); }
      box.innerHTML = items.map(function (x) { return '<button type="button" data-m="' + x[0] + '"' + (x[0].indexOf('dev') === 0 || x[0] === 'report' ? ' class="warn"' : '') + '>' + x[1] + '</button>'; }).join('');
      box.classList.remove('hidden');
      box.onclick = function (e) {
        var b = e.target.closest && e.target.closest('[data-m]'); if (!b) return; var k = b.dataset.m; box.classList.add('hidden');
        if (k === 'copy') { copyText(link(m.name)); toast('تم نسخ الرابط'); }
        else if (k === 'share') { var inp = $('#messageInput'); if (inp && curChat()) { inp.textContent = link(m.name); inp.dispatchEvent(new Event('input', { bubbles: true })); closeOv(rec); toast('الرابط جاهز للإرسال'); } else copyText(link(m.name)), toast('تم نسخ الرابط'); }
        else if (k === 'edit') { closeOv(rec); later(function () { openStudio(m.name); }); }
        else if (k === 'report') reportMenu(rec, m);
        else if (k === 'devhide') api('dev-hide', { set: m.name, hidden: !m.hidden }).then(function () { toast('تم'); closeOv(rec); }).catch(fail);
        else if (k === 'devdel') { if (confirm('حذف الحزمة نهائياً؟')) api('delete', { set: m.name }).then(function () { cacheDrop(m.name); toast('تم الحذف'); closeOv(rec); }).catch(fail); }
      };
    }
    function reportMenu(rec, m) {
      var box = $('.bsk-menu', rec.el), reasons = [['spam', 'سبام'], ['abuse', 'إساءة أو كراهية'], ['adult', 'محتوى غير لائق'], ['copyright', 'حقوق ملكية'], ['other', 'سبب آخر']];
      box.innerHTML = '<div class="bsk-mt">سبب الإبلاغ</div>' + reasons.map(function (r) { return '<button type="button" data-r="' + r[0] + '">' + r[1] + '</button>'; }).join('');
      box.classList.remove('hidden');
      box.onclick = function (e) { var b = e.target.closest && e.target.closest('[data-r]'); if (!b) return; box.classList.add('hidden'); api('report', { set: m.name, reason: b.dataset.r }).then(function () { toast('شكراً، وصلنا بلاغك'); }).catch(fail); };
    }
    function copyText(t) {
      try { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).catch(function () {}); } catch (e) {}
      var a = document.createElement('textarea'); a.value = t; a.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); } catch (e) {} a.remove();
    }

    /* ---------- إدارة الحزم: اكتشف / حزمي / المثبتة ---------- */
    function packRow(set, extra) {
      var m = set.meta || set, first = set.thumb || m.thumb;
      return '<div class="bsk-row" data-pack="' + E(m.name) + '"><div class="bsk-rt">' + (first ? sk({ k: first.kind, u: first.url }, { still: true }) : '') + '</div><div class="bsk-rm"><b>' + E(m.title) + '</b><span>' + (m.count || 0) + ' ملصق · ' + KIND[m.kind].label + '</span></div>' + (extra || '') + '</div>';
    }
    function openManager(tab) {
      var rec = openOv('bsk-sheet tall', '<div class="bsk-card"><div class="bsk-grab"></div><div class="bsk-ph"><div class="bsk-pt"><b>حزم الملصقات</b></div><button type="button" class="bsk-hb" data-a="close" aria-label="إغلاق">' + ICON.close + '</button></div><div class="bsk-seg"><button type="button" data-t="disc">اكتشف</button><button type="button" data-t="mine">حزمي</button><button type="button" data-t="inst">المثبتة</button></div><input class="bsk-qs" type="text" placeholder="ابحث باسم الحزمة (إنجليزي)" autocomplete="off"><div class="bsk-list"></div><div class="bsk-pf"><button type="button" class="bsk-btn gold wide" data-a="new">＋ إنشاء حزمة جديدة</button></div></div>');
      var list = $('.bsk-list', rec.el), cur = tab || 'disc', qt = 0;
      function setList(html) { list.innerHTML = html || '<div class="bsk-empty">لا يوجد شيء هنا</div>'; watch(list); }
      function show(t) {
        cur = t; $$('.bsk-seg button', rec.el).forEach(function (b) { b.classList.toggle('on', b.dataset.t === t); });
        $('.bsk-qs', rec.el).classList.toggle('hidden', t !== 'disc');
        list.innerHTML = '<div class="bsk-empty">جاري التحميل…</div>';
        if (t === 'inst') {
          loadInstalled().then(function (sets) {
            setList(sets.map(function (s, i) { return packRow(s, '<div class="bsk-mv"><button type="button" data-mv="-1" data-n="' + E(s.meta.name) + '"' + (i === 0 ? ' disabled' : '') + '>▲</button><button type="button" data-mv="1" data-n="' + E(s.meta.name) + '"' + (i === sets.length - 1 ? ' disabled' : '') + '>▼</button></div>'); }).join(''));
          }).catch(function () { setList(''); });
        } else if (t === 'mine') {
          db.collection('stickerSets').where('ownerId', '==', me().uid).get().then(function (q) { setList(q.docs.map(function (d) { return packRow(d.data()); }).join('')); }).catch(function () { setList(''); });
        } else {
          var qv = ($('.bsk-qs', rec.el).value || '').trim().toLowerCase(), qry = db.collection('stickerSets');
          qry = qv ? qry.orderBy('name').startAt(qv).endAt(qv + '\uf8ff').limit(20) : qry.orderBy('createdAt', 'desc').limit(20);
          qry.get().then(function (q) { setList(q.docs.map(function (d) { return d.data(); }).filter(function (x) { return !x.hidden; }).map(function (x) { return packRow(x); }).join('')); }).catch(function () { setList(''); });
        }
      }
      $('.bsk-qs', rec.el).addEventListener('input', function () { clearTimeout(qt); qt = setTimeout(function () { if (cur === 'disc') show('disc'); }, 350); });
      rec.el.addEventListener('click', function (e) {
        var t = e.target; if (!t.closest) return;
        var seg = t.closest('.bsk-seg button'); if (seg) return show(seg.dataset.t);
        var mv = t.closest('[data-mv]');
        if (mv) { e.stopPropagation(); var n = mv.dataset.n, d = parseInt(mv.dataset.mv, 10), arr = S.data.installed, i = arr.indexOf(n), j = i + d; if (i < 0 || j < 0 || j >= arr.length) return; arr.splice(j, 0, arr.splice(i, 1)[0]); saveData(); show('inst'); return; }
        var row = t.closest('.bsk-row'); if (row) { var nm = row.dataset.pack; closeOv(rec); later(function () { openPack(nm); }); return; }
        var a = t.closest('[data-a]'); if (!a) return;
        if (a.dataset.a === 'close') closeOv(rec);
        if (a.dataset.a === 'new') { closeOv(rec); later(function () { openStudio(null); }); }
      });
      ensureData().then(function () { show(cur); }).catch(function () { list.innerHTML = '<div class="bsk-empty">تعذر التحميل</div>'; });
    }

    /* ---------- معالجة الملفات قبل الرفع ---------- */
    function loadImage(file) {
      return new Promise(function (res, rej) { var u = URL.createObjectURL(file), im = new Image(); im.onload = function () { res({ im: im, url: u }); }; im.onerror = function () { URL.revokeObjectURL(u); rej(new Error('format')); }; im.src = u; });
    }
    function drawSticker(im, outline) {
      var big = Math.max(im.naturalWidth, im.naturalHeight), pad = outline ? 14 : 0, sc = (512 - pad * 2) / big;
      var w = Math.max(1, Math.round(im.naturalWidth * sc)), h = Math.max(1, Math.round(im.naturalHeight * sc));
      var cw = outline ? 512 : w, ch = outline ? 512 : h, c = document.createElement('canvas'); c.width = cw; c.height = ch;
      var x = c.getContext('2d'), ox = Math.round((cw - w) / 2), oy = Math.round((ch - h) / 2);
      if (outline) {
        var t = document.createElement('canvas'); t.width = cw; t.height = ch; var tx = t.getContext('2d');
        tx.drawImage(im, ox, oy, w, h); tx.globalCompositeOperation = 'source-in'; tx.fillStyle = '#fff'; tx.fillRect(0, 0, cw, ch);
        for (var k = 0; k < 32; k++) { var ang = k / 32 * Math.PI * 2; x.drawImage(t, Math.cos(ang) * 7, Math.sin(ang) * 7); }
      }
      x.drawImage(im, ox, oy, w, h);
      return c;
    }
    function canvasToBlob(c) {
      var tries = [['image/webp', 0.92], ['image/webp', 0.8], ['image/webp', 0.6], ['image/png']];
      return new Promise(function (res, rej) {
        (function go(i) {
          if (i >= tries.length) return rej(new Error('size'));
          c.toBlob(function (b) { if (b && b.size <= 500 * 1024) res({ blob: b, ext: b.type === 'image/webp' ? 'webp' : 'png' }); else go(i + 1); }, tries[i][0], tries[i][1]);
        })(0);
      });
    }
    function readTgs(file) {
      if (file.size > 64 * 1024) return Promise.reject({ userMsg: ERR.size });
      return file.arrayBuffer().then(function (b) { return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).text(); }).then(function (t) {
        var j = JSON.parse(t);
        if (j.w !== 512 || j.h !== 512) throw { userMsg: ERR.dimensions };
        if ((j.op - j.ip) / j.fr > 3.05) throw { userMsg: ERR.duration };
        return j;
      }).catch(function (e) { throw e && e.userMsg ? e : { userMsg: ERR.format }; });
    }
    function probeVideo(file) {
      return new Promise(function (res, rej) {
        if (file.size > 256 * 1024) return rej({ userMsg: ERR.size });
        var u = URL.createObjectURL(file), v = document.createElement('video'); v.preload = 'metadata'; v.muted = true;
        v.onloadedmetadata = function () { var ok = v.duration <= 3.05 && Math.max(v.videoWidth, v.videoHeight) === 512; URL.revokeObjectURL(u); ok ? res() : rej({ userMsg: v.duration > 3.05 ? ERR.duration : ERR.dimensions }); };
        v.onerror = function () { URL.revokeObjectURL(u); rej({ userMsg: ERR.format }); };
        v.src = u;
      });
    }
    function uploadCld(blob, resource, ext, onProg) {
      return new Promise(function (res, rej) {
        var fd = new FormData(); fd.append('file', blob, 'sticker.' + ext); fd.append('upload_preset', CLD_PRESET); fd.append('folder', 'stickers');
        var x = new XMLHttpRequest(); x.open('POST', 'https://api.cloudinary.com/v1_1/' + CLD_CLOUD + '/' + resource + '/upload');
        x.upload.onprogress = function (e) { if (e.lengthComputable && onProg) onProg(e.loaded / e.total); };
        x.onload = function () { try { var j = JSON.parse(x.responseText); if (x.status < 300 && j.secure_url) return res(j.secure_url); } catch (e) {} rej({ userMsg: 'فشل رفع الملف' }); };
        x.onerror = function () { rej({ userMsg: 'فشل رفع الملف، تحقق من الاتصال' }); };
        x.send(fd);
      });
    }

    /* ---------- استوديو إنشاء/تعديل الحزمة ---------- */
    function openStudio(editName) {
      var rec = openOv('bsk-studio', '<div class="bsk-full"><div class="bsk-sh"><button type="button" class="bsk-hb" data-a="close" aria-label="رجوع">' + ICON.close + '</button><b class="bsk-stt"></b><span></span></div><div class="bsk-sbody"></div></div>');
      var body = $('.bsk-sbody', rec.el), titleEl = $('.bsk-stt', rec.el);
      var C = { name: editName || '', title: '', kind: 'static', set: null, pick: null, busy: false };
      var checkT = 0;
      rec.el.addEventListener('click', function (e) { var a = e.target.closest && e.target.closest('[data-a="close"]'); if (a) closeOv(rec); });

      function stepInfo() {
        titleEl.textContent = 'حزمة ملصقات جديدة';
        body.innerHTML = '<label class="bsk-l">عنوان الحزمة</label><input id="bskTitle" class="bsk-in" maxlength="40" placeholder="مثال: وجوه بابل" value="' + E(C.title) + '">' +
          '<label class="bsk-l">الاسم القصير (للرابط)</label><div class="bsk-lk"><span dir="ltr">' + E(location.host) + '/addstickers/</span><input id="bskName" class="bsk-in" dir="ltr" maxlength="32" placeholder="babylon_faces" value="' + E(C.name) + '"></div><div class="bsk-hint" id="bskNameHint">5–32 حرفاً إنجليزياً صغيراً وأرقاماً و _</div>' +
          '<label class="bsk-l">نوع الملصقات</label><div class="bsk-kinds">' + Object.keys(KIND).map(function (k) { return '<button type="button" class="bsk-kind' + (C.kind === k ? ' on' : '') + '" data-k="' + k + '"><b>' + KIND[k].label + '</b><span>' + KIND[k].hint + '</span></button>'; }).join('') + '</div>' +
          '<div class="bsk-pf"><button type="button" class="bsk-btn gold wide" id="bskNext">التالي: إضافة أول ملصق</button></div>';
        var nm = $('#bskName', body), hint = $('#bskNameHint', body);
        $('#bskTitle', body).oninput = function () { C.title = this.value; };
        nm.oninput = function () {
          C.name = this.value.trim().toLowerCase(); clearTimeout(checkT); hint.className = 'bsk-hint';
          if (!validName(C.name)) { hint.textContent = '5–32 حرفاً إنجليزياً صغيراً وأرقاماً و _ (بدون شرطتين متتاليتين)'; return; }
          hint.textContent = 'جاري التحقق…';
          checkT = setTimeout(function () { api('check', { name: C.name }).then(function (r) { hint.textContent = r.ok ? '✓ الاسم متاح' : 'الاسم محجوز'; hint.className = 'bsk-hint ' + (r.ok ? 'ok' : 'bad'); }).catch(function () { hint.textContent = ''; }); }, 400);
        };
        $$('.bsk-kind', body).forEach(function (b) { b.onclick = function () { C.kind = b.dataset.k; $$('.bsk-kind', body).forEach(function (x) { x.classList.toggle('on', x === b); }); }; });
        $('#bskNext', body).onclick = function () {
          C.title = $('#bskTitle', body).value.trim(); C.name = nm.value.trim().toLowerCase();
          if (!C.title) return toast(ERR.title);
          if (!validName(C.name)) return toast(ERR.name);
          stepSticker();
        };
      }
      function stepSticker() {
        var kind = C.set ? C.set.kind : C.kind, ki = KIND[kind];
        titleEl.textContent = C.set ? 'إضافة ملصق' : 'أول ملصق';
        C.pick = null;
        body.innerHTML = '<div class="bsk-drop" id="bskDrop"><div class="bsk-prevbox checker" id="bskPrev"><span class="bsk-hint">اختر ملفاً</span></div><button type="button" class="bsk-btn" id="bskPick">اختيار ملف</button><div class="bsk-hint">' + ki.hint + '</div></div>' +
          (kind === 'static' ? '<label class="bsk-chk"><input type="checkbox" id="bskOutline"> إضافة حدود بيضاء حول الشكل</label>' : '') +
          '<label class="bsk-l">الإيموجي المرتبط</label><input id="bskEmoji" class="bsk-in" maxlength="12" placeholder="😀"><div class="bsk-quick">' + QUICK_EMOJI.map(function (e) { return '<button type="button" data-e="' + e + '">' + e + '</button>'; }).join('') + '</div>' +
          '<div class="bsk-pf"><div class="bsk-prog hidden" id="bskProg"><i></i></div><button type="button" class="bsk-btn gold wide" id="bskGo" disabled>' + (C.set ? 'رفع وإضافة' : 'رفع وإنشاء الحزمة') + '</button></div>';
        var emo = $('#bskEmoji', body), go = $('#bskGo', body), prev = $('#bskPrev', body);
        $('.bsk-quick', body).onclick = function (e) { var b = e.target.closest && e.target.closest('[data-e]'); if (b) { emo.value = firstEmojis(emo.value + b.dataset.e, 3); sync(); } };
        emo.oninput = function () { emo.value = firstEmojis(emo.value, 3); sync(); };
        function sync() { go.disabled = !(C.pick && emo.value && !C.busy); }
        function showPick() {
          prev.innerHTML = '';
          if (kind === 'static') { prev.appendChild(C.pick.canvas); }
          else if (kind === 'video') { var v = document.createElement('video'); v.src = C.pick.url; v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true; prev.appendChild(v); }
          else { var h = document.createElement('div'); h.className = 'bsk-still'; prev.appendChild(h); loadLottie().then(function (lot) { lot.loadAnimation({ container: h, renderer: 'canvas', loop: true, autoplay: true, animationData: JSON.parse(JSON.stringify(C.pick.json)) }); }); }
          sync();
        }
        function rebuildStatic() { if (!C.pick || kind !== 'static') return; var c = drawSticker(C.pick.im, !!$('#bskOutline', body).checked); C.pick.canvas = c; c.className = 'bsk-cv'; prev.innerHTML = ''; prev.appendChild(c); }
        if (kind === 'static') $('#bskOutline', body).onchange = rebuildStatic;
        $('#bskPick', body).onclick = function () {
          var f = document.createElement('input'); f.type = 'file'; f.accept = ki.accept;
          f.onchange = function () {
            var file = f.files && f.files[0]; if (!file) return;
            if (kind === 'static') {
              if (!/^image\//.test(file.type)) return toast(ERR.format);
              loadImage(file).then(function (r) { C.pick = { im: r.im, url: r.url, canvas: null }; rebuildStatic(); showPick(); }).catch(function () { toast(ERR.format); });
            } else if (kind === 'animated') {
              readTgs(file).then(function (j) { C.pick = { file: file, json: j }; showPick(); }).catch(fail);
            } else {
              probeVideo(file).then(function () { C.pick = { file: file, url: URL.createObjectURL(file) }; showPick(); }).catch(fail);
            }
          };
          f.click();
        };
        go.onclick = function () {
          if (!C.pick || C.busy) return;
          var emoji = firstEmojis(emo.value, 3); if (!emoji) return toast(ERR.emoji);
          C.busy = true; go.disabled = true; go.textContent = 'جاري الرفع…';
          var prog = $('#bskProg', body); prog.classList.remove('hidden'); var bar = $('i', prog);
          var prep = kind === 'static' ? canvasToBlob(C.pick.canvas) : Promise.resolve({ blob: C.pick.file, ext: ki.ext });
          prep.then(function (p) { return uploadCld(p.blob, ki.res, p.ext, function (f) { bar.style.width = Math.round(f * 100) + '%'; }); }).then(function (url) {
            return C.set ? api('add', { set: C.set.name, url: url, emoji: emoji }) : api('create', { name: C.name, title: C.title, kind: kind, url: url, emoji: emoji });
          }).then(function () {
            var name = C.set ? C.set.name : C.name; delete S.sets[name]; cacheDrop(name);
            return ensureData().then(function () { if (!C.set) install(name); return loadSet(name); }).then(function (set) { C.busy = false; toast(C.set ? 'تمت إضافة الملصق' : 'تم إنشاء الحزمة 🎉'); if (set) { C.set = set.meta; stepManage(set); } else closeOv(rec); });
          }).catch(function (e) { C.busy = false; prog.classList.add('hidden'); go.textContent = C.set ? 'رفع وإضافة' : 'رفع وإنشاء الحزمة'; sync(); fail(e); });
        };
      }
      function stepManage(set) {
        var m = set.meta; C.set = m; titleEl.textContent = m.title;
        var full = set.stickers.length >= MAX_PER_SET;
        body.innerHTML = '<div class="bsk-mh"><input id="bskRen" class="bsk-in" maxlength="40" value="' + E(m.title) + '"><button type="button" class="bsk-btn" id="bskRenGo">حفظ العنوان</button></div><div class="bsk-hint" dir="ltr">' + E(link(m.name)) + '</div>' +
          '<div class="bsk-grid edit">' + set.stickers.map(function (st, i) { return '<button type="button" class="bsk-it" data-i="' + E(st.i) + '" data-idx="' + i + '">' + sk(st, { still: false }) + '<em>' + E(st.e) + '</em></button>'; }).join('') + (full ? '' : '<button type="button" class="bsk-it bsk-addt" data-a="addst">' + ICON.plus + '</button>') + '</div>' +
          '<div class="bsk-pf"><button type="button" class="bsk-btn warn wide" id="bskDel">حذف الحزمة</button></div>';
        watch(body);
        $('#bskRenGo', body).onclick = function () { api('rename', { set: m.name, title: $('#bskRen', body).value }).then(function () { delete S.sets[m.name]; cacheDrop(m.name); toast('تم تحديث العنوان'); }).catch(fail); };
        $('#bskDel', body).onclick = function () { if (!confirm('سيتم حذف الحزمة وكل ملصقاتها نهائياً. متأكد؟')) return; api('delete', { set: m.name }).then(function () { uninstall(m.name); delete S.sets[m.name]; cacheDrop(m.name); toast('تم حذف الحزمة'); closeOv(rec); }).catch(fail); };
        body.onclick = function (e) {
          var t = e.target; if (!t.closest) return;
          if (t.closest('[data-a="addst"]')) return stepSticker();
          var it = t.closest('.bsk-it[data-i]'); if (it) stickerEditor(set, parseInt(it.dataset.idx, 10));
        };
      }
      function stickerEditor(set, idx) {
        var st = set.stickers[idx], m = set.meta;
        var r2 = openOv('bsk-sheet', '<div class="bsk-card"><div class="bsk-grab"></div><div class="bsk-ph"><div class="bsk-pt"><b>ملصق ' + (idx + 1) + '</b></div><button type="button" class="bsk-hb" data-a="x" aria-label="إغلاق">' + ICON.close + '</button></div><div class="bsk-pst">' + sk(st, { cls: 'bsk-huge' }) + '</div><input id="bskE2" class="bsk-in" value="' + E(st.e) + '" maxlength="12"><div class="bsk-pact"><button type="button" class="bsk-btn" data-a="save">حفظ الإيموجي</button><button type="button" class="bsk-btn" data-a="left"' + (idx === set.stickers.length - 1 ? ' disabled' : '') + '>تأخير ◀</button><button type="button" class="bsk-btn" data-a="right"' + (idx === 0 ? ' disabled' : '') + '>▶ تقديم</button><button type="button" class="bsk-btn warn" data-a="del">حذف الملصق</button></div></div>');
        watch(r2.el);
        function refresh() { delete S.sets[m.name]; cacheDrop(m.name); closeOv(r2); later(function () { loadSet(m.name).then(function (s) { if (s) stepManage(s); }); }); }
        r2.el.addEventListener('click', function (e) {
          var a = e.target.closest && e.target.closest('[data-a]'); if (!a) return; var act = a.dataset.a;
          if (act === 'x') return closeOv(r2);
          if (act === 'save') { var em = firstEmojis($('#bskE2', r2.el).value, 3); if (!em) return toast(ERR.emoji); api('update', { set: m.name, id: st.i, emoji: em }).then(refresh).catch(fail); }
          if (act === 'del') { if (confirm('حذف هذا الملصق؟')) api('remove', { set: m.name, id: st.i }).then(refresh).catch(fail); }
          if (act === 'left' || act === 'right') { var ids = set.stickers.map(function (x) { return x.i; }), j = act === 'left' ? idx + 1 : idx - 1; ids.splice(j, 0, ids.splice(idx, 1)[0]); api('reorder', { set: m.name, ids: ids }).then(refresh).catch(fail); }
        });
      }
      if (editName) { titleEl.textContent = 'جاري التحميل…'; delete S.sets[editName]; loadSet(editName).then(function (set) { if (set) stepManage(set); else { toast(ERR.noset); closeOv(rec); } }); }
      else stepInfo();
    }

    /* ---------- روابط الحزم: /addstickers/<name> ---------- */
    function openFromUrl() {
      var p = new URLSearchParams(location.search), n = p.get('stickers');
      if (!n) return;
      var t = setInterval(function () { if (me()) { clearInterval(t); try { history.replaceState(null, '', location.pathname); } catch (e) {} openPack(n); } }, 400);
      setTimeout(function () { clearInterval(t); }, 30000);
    }
    document.addEventListener('click', function (e) {
      var t = e.target; if (!t.closest) return;
      var a = t.closest('a[href*="/addstickers/"]');
      if (a) { var m = /\/addstickers\/([a-z0-9_]+)/i.exec(a.getAttribute('href') || ''); if (m) { e.preventDefault(); e.stopPropagation(); openPack(m[1]); } return; }
      var big = t.closest('.bsk-msg');
      if (big && !(typeof messageSelectionMode !== 'undefined' && messageSelectionMode)) { e.stopPropagation(); openPack(big.dataset.set); }
    }, true);

    /* ---------- تشغيل ---------- */
    function start() {
      if (!$('#textInputBar')) return setTimeout(start, 600);
      injectUi(); openFromUrl();
      var area = $('#messagesArea'), pend = 0;
      if (area) new MutationObserver(function () { if (pend) return; pend = requestAnimationFrame(function () { pend = 0; watch(area); }); }).observe(area, { childList: true, subtree: true });
    }
    start();
    root.BabylonStickers = { openPack: openPack, openManager: openManager, openStudio: openStudio, closePanel: closePanel };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(typeof window !== 'undefined' ? window : globalThis);
