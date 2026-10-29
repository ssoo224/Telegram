/* api/account.js — حذف الحساب بتأكيد من الإيميل (رمز 6 أرقام)
   يحذف: بيانات المستخدم، اليوزر (يصير متاح)، رصيده، قصصه ومنشوراته، عروضه، محادثاته الخاصة، ثم حساب Firebase Auth
   (فيرجع الإيميل متاح للتسجيل من جديد). */
const crypto = require('crypto');
const { admin, db, FieldValue, transporter, FROM, esc, SIGN, WRAP, limited, HttpError, guard, authUser, send } = require('./_shared');

const sha = (salt, uid, code) => crypto.createHash('sha256').update('del:' + salt + ':' + uid + ':' + code).digest('hex');

async function delQuery(q) { const s = await q.get(); for (const d of s.docs) await db.recursiveDelete(d.ref); return s.size; }

async function wipe(uid) {
  const us = await db.collection('users').doc(uid).get();
  const uname = us.exists ? us.data().username : null;

  /* اليوزر يصير متاح */
  const un = await db.collection('usernames').where('uid', '==', uid).get();
  for (const d of un.docs) await d.ref.delete();
  if (uname) { const r = db.collection('usernames').doc(String(uname).toLowerCase()); const s = await r.get(); if (s.exists && s.data().uid === uid) await r.delete(); }

  await delQuery(db.collection('giftListings').where('sellerId', '==', uid));
  await delQuery(db.collection('stories').where('userId', '==', uid));
  await delQuery(db.collection('posts').where('userId', '==', uid));

  /* المحادثات: الخاصة تنحذف كلها، والمجموعات يطلع منها */
  const chats = await db.collection('chats').where('participants', 'array-contains', uid).get();
  for (const c of chats.docs) {
    const d = c.data();
    if (d.type !== 'group') { await db.recursiveDelete(c.ref); continue; }
    const rest = (d.participants || []).filter(x => x !== uid);
    if (!rest.length) { await db.recursiveDelete(c.ref); continue; }
    const upd = { participants: FieldValue.arrayRemove(uid) };
    upd['admins.' + uid] = FieldValue.delete();
    if (d.ownerId === uid) upd.ownerId = rest[0];
    await c.ref.update(upd);
  }

  await db.collection('wallets').doc(uid).delete().catch(() => {});
  await db.collection('loginCodes').doc(uid).delete().catch(() => {});
  await db.collection('deleteCodes').doc(uid).delete().catch(() => {});
  await db.recursiveDelete(db.collection('users').doc(uid));
  await admin.auth().deleteUser(uid);          /* هذا يحرّر الإيميل */
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const { body } = await guard(req);
    const u = await authUser(req, true);          /* لازم جلسة تحققت بالرمز */
    const ref = db.collection('deleteCodes').doc(u.uid);

    if (body.type === 'delete-send') {
      const code = String(crypto.randomInt(100000, 1000000)), salt = crypto.randomBytes(12).toString('hex');
      const ok = await db.runTransaction(async tx => {
        const s = await tx.get(ref), d = s.exists ? s.data() : {}, now = Date.now();
        if (d.lastSent && now - d.lastSent < 60000) return false;
        let hs = d.hourStart || now, hc = d.hourCount || 0;
        if (now - hs > 3600000) { hs = now; hc = 0; }
        if (hc >= 5) return false;
        tx.set(ref, { h: sha(salt, u.uid, code), salt, exp: now + 600000, tries: 0, authTime: u.auth_time, lastSent: now, hourStart: hs, hourCount: hc + 1 });
        return true;
      });
      if (!ok) throw new HttpError(429, 'rate');
      await transporter.sendMail({
        from: FROM(), to: u.email, subject: 'تأكيد حذف حسابك - Babylon Chat',
        html: WRAP('<h2 style="color:#b91c1c;margin:0 0 14px">تأكيد حذف الحساب ⚠️</h2>'
          + '<p style="line-height:1.9;margin:0 0 6px;font-weight:bold">هلا بيك،</p>'
          + '<p style="line-height:1.9;margin:0 0 18px">وصلنا طلب لحذف حسابك نهائياً من Babylon Chat. إذا أنت اللي طلبت، اكتب هذا الرمز بالتطبيق (صالح 10 دقائق):</p>'
          + '<p dir="ltr" style="text-align:center;font-size:34px;letter-spacing:10px;font-weight:bold;background:#fdecec;border-radius:12px;padding:14px 0;margin:0 0 18px;color:#17212b">' + code + '</p>'
          + '<p style="color:#b91c1c;font-size:13px;line-height:1.7;margin:0 0 14px">الحذف نهائي ولا يمكن التراجع عنه. إذا ما أنت اللي طلبت، تجاهل الرسالة وغيّر كلمة المرور فوراً.</p>' + SIGN)
      });
      return res.status(200).json({ ok: true });
    }

    if (body.type === 'delete-confirm') {
      const code = String(body.code || '').trim();
      if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'invalid');
      if (limited('dc:' + u.uid, 3600000, 30)) throw new HttpError(429, 'rate');
      const r = await db.runTransaction(async tx => {
        const s = await tx.get(ref), d = s.exists ? s.data() : null;
        if (!d || !d.h || d.authTime !== u.auth_time || Date.now() > d.exp) return { error: 'expired' };
        if (d.tries >= 5) return { error: 'locked' };
        const good = crypto.timingSafeEqual(Buffer.from(sha(d.salt, u.uid, code)), Buffer.from(d.h));
        if (!good) { tx.update(ref, { tries: d.tries + 1 }); return { error: 'invalid', left: 4 - d.tries }; }
        return { ok: true };
      });
      if (!r.ok) throw new HttpError(r.error === 'locked' ? 429 : 400, r.error, r.left != null ? { left: r.left } : {});
      await wipe(u.uid);
      return res.status(200).json({ ok: true });
    }
    throw new HttpError(400, 'type');
  } catch (e) { return send(res, e); }
};
