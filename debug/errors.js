/* debug/errors.js — يعرض أخطاء JavaScript على الشاشة (للتشخيص فقط).
   اضغط على الشريط الأحمر لإغلاقه. احذف سطر تحميله من index.html بعد ما تخلص. */
(function () {
  var box, list = [];
  function paint() {
    if (!document.body) return;
    if (!box) {
      box = document.createElement('div');
      box.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;max-height:38vh;overflow:auto;background:#7f1d1d;color:#fff;font:11px/1.5 monospace;padding:6px 10px;direction:ltr;text-align:left;white-space:pre-wrap;word-break:break-all;opacity:.96';
      box.onclick = function () { list = []; box.remove(); box = null; };
      document.body.appendChild(box);
    }
    box.textContent = list.slice(-6).join('\n—\n');
  }
  function add(m) { list.push(String(m).slice(0, 400)); if (list.length > 20) list.shift(); paint(); }
  window.addEventListener('error', function (e) {
    add('ERROR: ' + e.message + '\n' + String(e.filename || '').split('/').pop() + ':' + e.lineno + ':' + e.colno);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason; add('PROMISE: ' + ((r && (r.stack || r.message)) || r));
  });
  var ce = console.error;
  console.error = function () {
    try { add('console.error: ' + Array.prototype.map.call(arguments, function (a) { return (a && a.message) || (typeof a === 'object' ? JSON.stringify(a) : a); }).join(' ')); } catch (x) {}
    return ce.apply(console, arguments);
  };
})();
