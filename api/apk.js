/* api/apk.js — تنزيل التطبيق من موقعنا مباشرة (بدون ما يظهر المستودع للمستخدم)
   - مستودع عام: يجلب آخر إصدار من github.com ويمرره للمستخدم.
   - مستودع خاص: ضع GH_TOKEN (صلاحية Contents: read لهذا المستودع فقط) بمتغيرات Vercel. */
const { Readable } = require('stream');

const REPO = process.env.GH_REPO || 'ssoo224/Telegram';
const ASSET = 'babylon-chat.apk';
const TOKEN = process.env.GH_TOKEN || '';
const UA = 'babylon-chat-download';

async function assetUrl() {
  if (!TOKEN) return `https://github.com/${REPO}/releases/latest/download/${ASSET}`;
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Authorization: 'Bearer ' + TOKEN, 'User-Agent': UA, Accept: 'application/vnd.github+json' }
  });
  if (!r.ok) throw new Error('release ' + r.status);
  const rel = await r.json();
  const a = (rel.assets || []).find(x => x.name === ASSET);
  if (!a) throw new Error('asset missing');
  return a.url;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end(); }
  try {
    const headers = { 'User-Agent': UA, Accept: 'application/octet-stream' };
    if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
    const up = await fetch(await assetUrl(), { headers, redirect: 'follow' });
    if (!up.ok || !up.body) throw new Error('download ' + up.status);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="babylon-chat.apk"');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const len = up.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);
    if (req.method === 'HEAD') { up.body.cancel().catch(() => {}); return res.end(); }
    Readable.fromWeb(up.body).on('error', () => res.destroy()).pipe(res);
  } catch (e) {
    console.error('apk:', e.message);
    if (res.headersSent) return res.destroy();
    res.statusCode = 502;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('التنزيل غير متاح حالياً، حاول بعد قليل');
  }
};
