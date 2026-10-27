/* api/avatar.js — يرجّع صورة مستخدم لإشعارات أندرويد عبر رابط موقّع ومؤقت (انظر _avatar.js) */
const { db } = require('./_shared');
const { verify } = require('./_avatar');

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    const uid = String(q.u || '');
    if (!verify(uid, q.e, q.s)) return res.status(403).end();
    const d = await db.collection('users').doc(uid).get();
    const x = d.exists ? d.data() : null;
    const av = (x && !x.hideAvatar) ? String(x.avatarUrl || '') : '';
    if (!av) return res.status(404).end();

    if (av.startsWith('data:image/')) {
      const comma = av.indexOf(',');
      const head = av.slice(5, comma);                       /* image/jpeg;base64 */
      if (comma < 0 || !head.endsWith(';base64')) return res.status(404).end();
      const buf = Buffer.from(av.slice(comma + 1), 'base64');
      if (!buf.length || buf.length > 3 * 1024 * 1024) return res.status(404).end();
      res.setHeader('Content-Type', head.split(';')[0]);
      res.setHeader('Cache-Control', 'private, max-age=300');
      return res.status(200).send(buf);
    }
    if (/^https:\/\//.test(av)) {
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.statusCode = 302; res.setHeader('Location', av); return res.end();
    }
    return res.status(404).end();
  } catch (e) { return res.status(500).end(); }
};
