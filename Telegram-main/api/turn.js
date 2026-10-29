/* api/turn.js — يرجّع سيرفرات ICE للمكالمات (STUN مجاني + TURN من Metered إذا مفعّل)
   متغيرات Vercel (كلها اختيارية؛ بدونها يشتغل STUN فقط):
     METERED_TURN_USER   اسم المستخدم من لوحة Metered (Credential)
     METERED_TURN_PASS   كلمة السر
     METERED_TURN_HOST   اختياري، الافتراضي global.relay.metered.ca */
const { limited, HttpError, guard, authUser, send } = require('./_shared');

const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    await guard(req);
    const u = await authUser(req, false);
    if (limited('turn:' + u.uid, 60000, 20)) throw new HttpError(429, 'rate');
    let iceServers = STUN;
    const user = process.env.METERED_TURN_USER, pass = process.env.METERED_TURN_PASS;
    if (user && pass) {
      const host = process.env.METERED_TURN_HOST || 'global.relay.metered.ca';
      iceServers = STUN.concat([{
        urls: [
          'turn:' + host + ':80',
          'turn:' + host + ':80?transport=tcp',
          'turn:' + host + ':443',
          'turns:' + host + ':443?transport=tcp'
        ],
        username: user,
        credential: pass
      }]);
    }
    return res.status(200).json({ iceServers });
  } catch (e) { return send(res, e); }
};
