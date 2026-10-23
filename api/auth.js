/* Username privacy: public usernames contain UID only; private email mapping is server-only. */
const admin=require('firebase-admin');
const nodemailer=require('nodemailer');
if(!admin.apps.length)admin.initializeApp({credential:admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))});
const db=admin.firestore();
const mailer=nodemailer.createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user:process.env.GMAIL_USER,pass:process.env.GMAIL_APP_PASSWORD}});
const hits=new Map();
function limited(k){const now=Date.now(),a=(hits.get(k)||[]).filter(t=>now-t<60000);if(a.length>=8){hits.set(k,a);return true;}a.push(now);hits.set(k,a);return false;}
async function appCheck(req){if(process.env.APP_CHECK_ENFORCE!=='true')return;const t=req.headers['x-firebase-appcheck'];if(!t)throw Object.assign(new Error('app_check'),{status:401});await admin.appCheck().verifyToken(t);}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');if(req.method!=='POST')return res.status(405).json({error:'method'});
 try{
  await appCheck(req);const b=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
  if(b.action==='rename'){
   const m=/^Bearer (.+)$/.exec(req.headers.authorization||'');if(!m)return res.status(401).json({error:'auth'});
   const u=await admin.auth().verifyIdToken(m[1]);const oldName=String(b.oldUsername||'').toLowerCase(),newName=String(b.newUsername||'').toLowerCase();
   if(!/^[a-z][a-z0-9_.]{4,39}$/.test(newName)&&!(u.email==='anldheb429@gmail.com'&&/^[a-z][a-z0-9_.]{2,39}$/.test(newName)))return res.status(400).json({error:'username'});
   await db.runTransaction(async tx=>{const np=db.collection('usernames').doc(newName),nq=db.collection('usernameLookup').doc(newName),op=oldName?db.collection('usernames').doc(oldName):null,oq=oldName?db.collection('usernameLookup').doc(oldName):null;const reads=[tx.get(np),tx.get(nq)];if(op&&oldName!==newName)reads.push(tx.get(op),tx.get(oq));const rr=await Promise.all(reads);if((rr[0].exists&&rr[0].data().uid!==u.uid)||(rr[1].exists&&rr[1].data().uid!==u.uid))throw new Error('taken');tx.set(np,{uid:u.uid});tx.set(nq,{uid:u.uid,email:u.email});if(op&&oldName!==newName){if(rr[2].exists&&rr[2].data().uid===u.uid)tx.delete(op);if(rr[3].exists&&rr[3].data().uid===u.uid)tx.delete(oq);}});
   return res.json({ok:true});
  }
  if(b.action==='claim'){
   const m=/^Bearer (.+)$/.exec(req.headers.authorization||'');if(!m)return res.status(401).json({error:'auth'});
   const u=await admin.auth().verifyIdToken(m[1]);const username=String(b.username||'').toLowerCase();
   if(!/^[a-z][a-z0-9_.]{4,39}$/.test(username)&&!(u.email==='anldheb429@gmail.com'&&/^[a-z][a-z0-9_.]{2,39}$/.test(username)))return res.status(400).json({error:'username'});
   const pub=db.collection('usernames').doc(username),priv=db.collection('usernameLookup').doc(username);
   await db.runTransaction(async tx=>{const [p,q]=await Promise.all([tx.get(pub),tx.get(priv)]);if((p.exists&&p.data().uid!==u.uid)||(q.exists&&q.data().uid!==u.uid))throw new Error('taken');tx.set(pub,{uid:u.uid});tx.set(priv,{uid:u.uid,email:u.email});});
   return res.json({ok:true});
  }
  if(b.action==='reset-username'){
   const username=String(b.username||'').replace(/^@/,'').toLowerCase();if(!/^[a-z][a-z0-9_.]{2,39}$/.test(username))return res.json({ok:true});
   const snap=await db.collection('usernameLookup').doc(username).get();
   if(snap.exists&&snap.data().email){try{const link=await admin.auth().generatePasswordResetLink(snap.data().email);await mailer.sendMail({from:'\"Babylon Chat\" <'+process.env.GMAIL_USER+'>',to:snap.data().email,subject:'إعادة تعيين كلمة المرور - Babylon Chat',text:'لإعادة تعيين كلمة المرور افتح الرابط التالي: '+link});}catch(e){console.error('reset mail',e);}}
   return res.json({ok:true});
  }
  if(b.action==='username-login'){
   const username=String(b.username||'').replace(/^@/,'').toLowerCase(),password=String(b.password||'');
   const ip=String(req.headers['x-forwarded-for']||'unknown').split(',')[0];if(limited(ip+':'+username))return res.status(429).json({error:'rate'});
   if(!/^[a-z][a-z0-9_.]{2,39}$/.test(username)||!password)return res.status(400).json({error:'credentials'});
   const snap=await db.collection('usernameLookup').doc(username).get();if(!snap.exists)return res.status(401).json({error:'credentials'});
   const email=snap.data().email;if(!email)return res.status(401).json({error:'credentials'});
   const apiKey=process.env.FIREBASE_WEB_API_KEY;if(!apiKey)return res.status(500).json({error:'configuration'});
   const verify=await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key='+encodeURIComponent(apiKey),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
   const authData=await verify.json();if(!verify.ok)return res.status(401).json({error:'credentials'});
   const decoded=await admin.auth().verifyIdToken(authData.idToken);if(decoded.uid!==snap.data().uid)return res.status(401).json({error:'credentials'});
   const customToken=await admin.auth().createCustomToken(decoded.uid);return res.json({customToken});
  }
  return res.status(400).json({error:'action'});
 }catch(e){console.error('auth api',e);return res.status(e.status||(/taken/.test(e.message)?409:500)).json({error:/taken/.test(e.message)?'taken':e.message==='app_check'?'app_check':'failed'});}
};
