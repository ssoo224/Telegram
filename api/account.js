/* Babylon account deletion: email confirmation code + server-side cleanup.
 * Vercel env: FIREBASE_SERVICE_ACCOUNT, GMAIL_USER, GMAIL_APP_PASSWORD.
 */
const crypto = require('crypto');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
if (!admin.apps.length) admin.initializeApp({credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))});
const db = admin.firestore();
const mailer = nodemailer.createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user:process.env.GMAIL_USER,pass:process.env.GMAIL_APP_PASSWORD}});
const sha = (salt, code) => crypto.createHash('sha256').update(salt + ':' + code).digest('hex');
const timingSafe = (a,b) => { try { return crypto.timingSafeEqual(Buffer.from(a,'hex'), Buffer.from(b,'hex')); } catch (_) { return false; } };
const appCheck = async req => {
  if (process.env.APP_CHECK_ENFORCE !== 'true') return;
  const t = req.headers['x-firebase-appcheck'];
  if (!t) throw Object.assign(new Error('app_check'),{status:401});
  await admin.appCheck().verifyToken(t);
};
const bearer = req => /^Bearer (.+)$/.exec(req.headers.authorization || '');
module.exports = async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'method'});
  try {
    await appCheck(req);
    const b=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
    if(b.action==='request-delete') {
      const m=bearer(req); if(!m) return res.status(401).json({error:'auth'});
      const user=await admin.auth().verifyIdToken(m[1]);
      if(!user.email || !user.email_verified) return res.status(403).json({error:'email_unverified'});
      const ref=db.collection('accountDeletionCodes').doc(user.uid);
      const now=Date.now();
      const prev=await ref.get();
      if(prev.exists && now-(prev.data().sentAt||0)<60000) return res.status(429).json({error:'rate'});
      const code=String(crypto.randomInt(100000,1000000)), salt=crypto.randomBytes(16).toString('hex');
      await ref.set({hash:sha(salt,code),salt,expiresAt:now+10*60*1000,sentAt:now,attempts:0,email:user.email});
      await mailer.sendMail({from:'"Babylon Chat" <'+process.env.GMAIL_USER+'>',to:user.email,subject:'تأكيد حذف حساب Babylon',text:'رمز تأكيد حذف حساب Babylon هو: '+code+'\nصالح لمدة 10 دقائق. إذا لم تطلب الحذف فتجاهل الرسالة.',html:'<div dir="rtl" style="font-family:Tahoma,Arial;max-width:480px;margin:auto;padding:24px"><h2>تأكيد حذف حساب Babylon</h2><p>أدخل الرمز التالي لتأكيد حذف الحساب نهائياً. تبقى الرسائل القديمة، لكن الحساب والهدايا والرصيد المرتبط به ستتم معالجتها.</p><div dir="ltr" style="font-size:32px;letter-spacing:8px;text-align:center;padding:18px;background:#f7f0d8">'+code+'</div><p>الرمز صالح لمدة 10 دقائق. إذا لم تطلب الحذف فتجاهل الرسالة.</p></div>'});
      return res.json({ok:true});
    }
    if(b.action==='confirm-delete') {
      const m=bearer(req); if(!m) return res.status(401).json({error:'auth'});
      const user=await admin.auth().verifyIdToken(m[1]);
      const code=String(b.code||'').trim(); if(!/^\d{6}$/.test(code)) return res.status(400).json({error:'code'});
      const cref=db.collection('accountDeletionCodes').doc(user.uid), cs=await cref.get();
      if(!cs.exists) return res.status(400).json({error:'no_code'});
      const c=cs.data();
      if(c.expiresAt<Date.now() || c.attempts>=5) { await cref.delete().catch(()=>{}); return res.status(400).json({error:'expired'}); }
      if(!timingSafe(c.hash,sha(c.salt,code))) { await cref.update({attempts:admin.firestore.FieldValue.increment(1)}); return res.status(400).json({error:'wrong_code'}); }
      const uid=user.uid;
      // Reindex each numbered catalog: deleted user's gifts become free stock at the end;
      // every surviving number above a removed slot shifts down. Run server-side only.
      const kinds=[{coll:'pepes',sales:'pepeSales',key:'pepe',max:30},{coll:'cats',sales:'catSales',key:'cat',max:30}];
      for(const k of kinds) {
        const salesSnap=await db.collection(k.sales).get();
        const records=salesSnap.docs.map(d=>({n:Number(d.id),id:d.id,data:d.data()})).filter(x=>Number.isInteger(x.n)&&x.n>=1&&x.n<=k.max).sort((a,b)=>a.n-b.n);
        const removed=new Set(records.filter(x=>x.data.ownerId===uid).map(x=>x.n));
        if(!removed.size) continue;
        const affected=records.filter(x=>x.n>=Math.min(...removed));
        const preserved=[];
        for(const rec of affected) {
          if(removed.has(rec.n)) continue;
          const shift=[...removed].filter(n=>n<rec.n).length, next=rec.n-shift;
          const giftRef=db.collection('users').doc(rec.data.ownerId).collection(k.coll).doc(rec.id);
          const giftSnap=await giftRef.get();
          const listingRef=db.collection('giftListings').doc(k.key+'_'+rec.n), listingSnap=await listingRef.get();
          preserved.push({old:rec.n,next,sale:rec.data,owner:rec.data.ownerId,gift:giftSnap.exists?giftSnap.data():null,listing:listingSnap.exists?listingSnap.data():null});
        }
        // First clear all affected source IDs, then recreate compacted IDs to avoid collisions.
        for(let i=0;i<affected.length;i+=400){const batch=db.batch();for(const rec of affected.slice(i,i+400)){batch.delete(db.collection(k.sales).doc(rec.id));batch.delete(db.collection('users').doc(rec.data.ownerId).collection(k.coll).doc(rec.id));batch.delete(db.collection('giftListings').doc(k.key+'_'+rec.n));}await batch.commit();}
        for(let i=0;i<preserved.length;i+=200){const batch=db.batch();for(const rec of preserved.slice(i,i+200)){batch.set(db.collection(k.sales).doc(String(rec.next)),rec.sale);if(rec.gift)batch.set(db.collection('users').doc(rec.owner).collection(k.coll).doc(String(rec.next)),{...rec.gift,number:rec.next});if(rec.listing)batch.set(db.collection('giftListings').doc(k.key+'_'+rec.next),{...rec.listing,number:rec.next});}await batch.commit();}
      }
      // Extra catalog gifts are stored in the shared giftSales collection with IDs kind_number.
      const catalogSnap=await db.collection('giftCatalog').get();
      for(const cat of catalogSnap.docs){
        const key=cat.id, max=Math.max(1,Math.min(500,Number(cat.data().max)||30));
        const ss=await db.collection('giftSales').where('k','==',key).get();
        const records=ss.docs.map(d=>({id:d.id,n:Number(d.data().n),data:d.data()})).filter(x=>Number.isInteger(x.n)&&x.n>=1&&x.n<=max).sort((a,b)=>a.n-b.n);
        const removed=new Set(records.filter(x=>x.data.ownerId===uid).map(x=>x.n));if(!removed.size)continue;
        const affected=records.filter(x=>x.n>=Math.min(...removed)), preserved=[];
        for(const rec of affected){if(removed.has(rec.n))continue;const shift=[...removed].filter(n=>n<rec.n).length,next=rec.n-shift;const oldId=key+'_'+rec.n,newId=key+'_'+next;const gr=db.collection('users').doc(rec.data.ownerId).collection('gifts').doc(oldId),gs=await gr.get();const lr=db.collection('giftListings').doc(oldId),ls=await lr.get();preserved.push({next,id:newId,data:{...rec.data,n:next},owner:rec.data.ownerId,gift:gs.exists?gs.data():null,listing:ls.exists?ls.data():null});}
        for(let i=0;i<affected.length;i+=350){const batch=db.batch();for(const rec of affected.slice(i,i+350)){const id=key+'_'+rec.n;batch.delete(db.collection('giftSales').doc(id));batch.delete(db.collection('users').doc(rec.data.ownerId).collection('gifts').doc(id));batch.delete(db.collection('giftListings').doc(id));}await batch.commit();}
        for(let i=0;i<preserved.length;i+=150){const batch=db.batch();for(const rec of preserved.slice(i,i+150)){batch.set(db.collection('giftSales').doc(rec.id),rec.data);if(rec.gift)batch.set(db.collection('users').doc(rec.owner).collection('gifts').doc(rec.id),{...rec.gift,number:rec.next});if(rec.listing)batch.set(db.collection('giftListings').doc(rec.id),{...rec.listing,number:rec.next});}await batch.commit();}
      }
      // Keep a tombstone so old chats/messages can render as “حساب محذوف”.
      const userRef=db.collection('users').doc(uid); const u=await userRef.get();
      const old=u.exists?u.data():{}; const username=String(old.username||'').toLowerCase();
      const batch=db.batch();
      if(username) { batch.delete(db.collection('usernames').doc(username)); batch.delete(db.collection('usernameLookup').doc(username)); }
      batch.delete(db.collection('wallets').doc(uid));
      batch.delete(db.collection('accountDeletionCodes').doc(uid));
      batch.set(userRef,{id:uid,displayName:'حساب محذوف',username:'',email:'',bio:'',avatarUrl:'',isDeleted:true,deletedAt:Date.now(),fcmTokens:[]},{merge:false});
      await batch.commit();
      // Remove private per-user data while retaining messages and chat documents.
      for(const col of ['pepes','cats','gifts','txs','blocks']) await db.recursiveDelete(userRef.collection(col));
      await admin.auth().deleteUser(uid);
      return res.json({ok:true,deleted:true});
    }
    return res.status(400).json({error:'action'});
  } catch(e) { console.error('account api',e); return res.status(e.status||500).json({error:e.message==='app_check'?'app_check':'failed'}); }
};
