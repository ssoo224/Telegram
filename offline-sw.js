/* offline-sw.js — يجعل التطبيق يفتح بدون إنترنت (الواجهة فقط).
   - لا يعترض طلبات Firestore / Auth / Storage / الـ API، فلا إرسال ولا استلام بدون اتصال.
   - يحفظ الصفحة الرئيسية وملفاتها وسكربتات Firebase عند أول فتح مع الإنترنت.
   ضعه بجانب index.html (نفس المجلد الجذر) وارفعه مع الموقع. */
var VERSION = 'v2';
var SHELL = 'babylon-shell-' + VERSION;
var RUNTIME = 'babylon-rt-' + VERSION;

/* نُبقي منطق إشعارات Firebase الموجود في ملفك القديم يعمل كما هو */
try { importScripts('firebase-messaging-sw.js'); } catch (e) {}

var CDN_PRECACHE = [
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check-compat.js'
];
var CDN_HOSTS = ['www.gstatic.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];

function okRes(r) { return r && (r.ok || r.type === 'opaque'); }

function normalizeNav(url) {
  var u = new URL(url);
  return (u.pathname === '/' || u.pathname === '/index.html') ? '/' : null;
}

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    var cache = await caches.open(SHELL);
    var urls = ['/', '/manifest.json'];
    try {
      var res = await fetch('/', { cache: 'reload' });
      if (res.ok) {
        await cache.put('/', res.clone());
        var html = await res.text();
        var re = /(?:src|href)\s*=\s*["']([^"'#]+)["']/g, m;
        while ((m = re.exec(html))) {
          var u = m[1];
          if (/^(data:|javascript:|mailto:|tel:|blob:)/i.test(u)) continue;
          try {
            var abs = new URL(u, self.location.origin + '/');
            if (abs.origin === self.location.origin || CDN_HOSTS.indexOf(abs.hostname) !== -1) urls.push(abs.href);
          } catch (e) {}
        }
      }
    } catch (e) {}
    CDN_PRECACHE.forEach(function (u) { if (urls.indexOf(u) === -1) urls.push(u); });
    await Promise.all(urls.map(async function (u) {
      try {
        var abs = new URL(u, self.location.origin + '/');
        var same = abs.origin === self.location.origin;
        var r = await fetch(abs.href, same ? { cache: 'reload' } : { mode: 'no-cors' });
        if (okRes(r)) await cache.put(same ? abs.pathname + abs.search : abs.href, r);
      } catch (e) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.filter(function (k) { return k !== SHELL && k !== RUNTIME && k.indexOf('babylon-') === 0; })
      .map(function (k) { return caches.delete(k); }));
    await self.clients.claim();
  })());
});

async function navigationHandler(request) {
  var cache = await caches.open(SHELL);
  var key = normalizeNav(request.url);
  try {
    var net = await Promise.race([
      fetch(request),
      new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, 4000); })
    ]);
    if (net && net.ok && key) cache.put(key, net.clone());
    return net;
  } catch (e) {
    var hit = (key && await cache.match(key)) || await cache.match('/') || await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;text-align:center;padding:40px;direction:rtl">عذرا الهاتف غير متصل بالانترنت</body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  var cache = await caches.open(cacheName);
  var hit = await cache.match(request);
  var update = fetch(request).then(function (r) { if (okRes(r)) cache.put(request, r.clone()); return r; }).catch(function () { return null; });
  if (hit) return hit;
  var r = await update;
  if (r) return r;
  var shell = await (await caches.open(SHELL)).match(request, { ignoreSearch: false });
  return shell || Response.error();
}

async function cacheFirst(request) {
  var cache = await caches.open(SHELL);
  var hit = await cache.match(request) || await (await caches.open(RUNTIME)).match(request);
  if (hit) return hit;
  try {
    var r = await fetch(request);
    if (okRes(r)) (await caches.open(RUNTIME)).put(request, r.clone());
    return r;
  } catch (e) { return Response.error(); }
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.searchParams.has('__ping')) return;               /* فحص الاتصال: دائمًا من الشبكة */
  if (url.origin === self.location.origin && url.pathname.indexOf('/api/') === 0) return;   /* لا نعترض الـ API */
  if (req.headers.has('range')) return;

  if (req.mode === 'navigate') { event.respondWith(navigationHandler(req)); return; }

  if (url.origin === self.location.origin) {
    if (url.pathname === '/firebase-messaging-sw.js' || url.pathname === '/offline-sw.js') return;
    event.respondWith(staleWhileRevalidate(req, SHELL));
    return;
  }
  if (CDN_HOSTS.indexOf(url.hostname) !== -1 && (url.hostname !== 'www.gstatic.com' || url.pathname.indexOf('/firebasejs/') === 0)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  /* أي شيء آخر (Firestore, Auth, Storage, صور خارجية ...) يمر بشكل طبيعي */
});
