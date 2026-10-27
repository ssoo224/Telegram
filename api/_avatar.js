/* api/_avatar.js — روابط مؤقتة موقّعة لصورة المستخدم (للإشعارات).
   الصور محفوظة كـ data-URL بـ Firestore وأكبر من حد رسالة FCM (4KB)، فنرسل رابطاً قصيراً صالحاً 15 دقيقة فقط.
   المفتاح مشتق من FIREBASE_SERVICE_ACCOUNT (أو AVATAR_SECRET إذا حطيته) فما يحتاج متغير جديد. */
const crypto = require('crypto');

const key = () => crypto.createHash('sha256')
  .update('babylon-avatar:' + (process.env.AVATAR_SECRET || process.env.FIREBASE_SERVICE_ACCOUNT || '')).digest();
const sig = (uid, exp) => crypto.createHmac('sha256', key()).update(uid + '.' + exp).digest('hex').slice(0, 32);

function signedUrl(host, uid, ttlMs) {
  const exp = Date.now() + (ttlMs || 15 * 60 * 1000);
  return 'https://' + host + '/api/avatar?u=' + encodeURIComponent(uid) + '&e=' + exp + '&s=' + sig(uid, exp);
}
function verify(uid, exp, s) {
  exp = Number(exp);
  if (!uid || !exp || exp < Date.now() || exp > Date.now() + 24 * 3600 * 1000) return false;
  try { return crypto.timingSafeEqual(Buffer.from(String(s)), Buffer.from(sig(uid, exp))); } catch (e) { return false; }
}
module.exports = { signedUrl, verify };
