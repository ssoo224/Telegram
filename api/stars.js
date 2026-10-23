/* Authoritative star/gift purchase operations for Babylon. */
const admin=require('firebase-admin');
if(!admin.apps.length) admin.initializeApp({credential:admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))});
const db=admin.firestore();
async function guard(req){
 const m=/^Bearer (.+)$/.exec(req.headers.authorization||''); if(!m) throw Object.assign(new Error('auth'),{status:401});
 const decoded=await admin.auth().verifyIdToken(m[1]);
 if(process.env.APP_CHECK_ENFORCE==='true'){const t=req.headers['x-firebase-appcheck'];if(!t)throw Object.assign(new Error('app_check'),{status:401});await admin.appCheck().verifyToken(t);}
 if(!decoded.email_verified)throw Object.assign(new Error('verified'),{status:403});
 return decoded;
}
module.exports=async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'method'});
 try{
  const user=await guard(req), body=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{}), uid=user.uid;
  if(body.action==='purchase'){
   const kind=String(body.kind||'pepe').toLowerCase();
   const builtin={pepe:{coll:'pepes',sales:'pepeSales',price:1000,max:30,field:'lastBuy'},cat:{coll:'cats',sales:'catSales',price:500,max:30,field:'lastBuyCat'}};
   const isDev=user.email==='anldheb429@gmail.com';
   const result=await db.runTransaction(async tx=>{
    let coll,sales,price,max,field,key=kind;
    if(builtin[kind])({coll,sales,price,max,field}=builtin[kind]);
    else {const c=await tx.get(db.collection('giftCatalog').doc(kind));if(!c.exists)throw new Error('gift_not_found');const d=c.data();coll='gifts';sales='giftSales';price=Number(d.price);max=Number(d.max);field='lastBuyGift';}
    const walletRef=db.collection('wallets').doc(uid), wallet=await tx.get(walletRef);
    const all=await tx.get(db.collection(sales)); const taken=new Set();
    all.docs.forEach(d=>{const x=d.data();if(builtin[kind])taken.add(Number(d.id));else if(x.k===kind)taken.add(Number(x.n));});
    let n=0;for(let i=1;i<=max;i++)if(!taken.has(i)){n=i;break;} if(!n)throw new Error('sold_out');
    const balance=wallet.exists?Number(wallet.data().stars)||0:0;
    if(!isDev&&balance<price)throw new Error('insufficient_stars');
    const now=Date.now(), saleId=builtin[kind]?String(n):kind+'_'+n;
    const saleRef=db.collection(sales).doc(saleId), giftRef=db.collection('users').doc(uid).collection(coll).doc(saleId);
    tx.set(saleRef,builtin[kind]?{ownerId:uid,at:now}:{ownerId:uid,at:now,k:kind,n});
    const gift={number:n,upgraded:false,at:now};if(!builtin[kind])gift.k=kind;
    tx.set(giftRef,gift);
    if(!isDev)tx.set(walletRef,{stars:balance-price,[field]:saleId},{merge:true});
    tx.set(db.collection('users').doc(uid).collection('txs').doc(),{type:'buy',gift:n,stars:price,at:now,...(kind!=='pepe'?{kind}:{})});
    tx.set(db.collection('giftEvents').doc(kind+'_'+n).collection('log').doc(),{k:kind,number:n,coll,type:'mint',to:uid,price,at:now});
    return {number:n,kind,price,balance:isDev?balance:balance-price};
   });
   return res.json({ok:true,...result});
  }
  if(body.action==='transfer-gift'){
   const to=String(body.to||''),kind=String(body.kind||'pepe'),number=Number(body.number);
   if(!to||to===uid||!Number.isSafeInteger(number)||number<1)return res.status(400).json({error:'input'});
   const cfg={pepe:{coll:'pepes',sales:'pepeSales'},cat:{coll:'cats',sales:'catSales'}};
   const c=cfg[kind]||{coll:'gifts',sales:'giftSales'};const id=c.coll==='gifts'?kind+'_'+number:String(number);
   const source=db.collection('users').doc(uid).collection(c.coll).doc(id),dest=db.collection('users').doc(to).collection(c.coll).doc(id),saleRef=db.collection(c.sales).doc(id),listingRef=db.collection('giftListings').doc(kind+'_'+number),chatId=[uid,to].sort().join('__'),chatRef=db.collection('chats').doc(chatId);
   await db.runTransaction(async tx=>{
    const [g,sale,d,l,chat,recipient]=await Promise.all([tx.get(source),tx.get(saleRef),tx.get(dest),tx.get(listingRef),tx.get(chatRef),tx.get(db.collection('users').doc(to))]);
    if(!recipient.exists||recipient.data().isDeleted)throw new Error('recipient');
    if(!g.exists||d.exists||!sale.exists||sale.data().ownerId!==uid||l.exists)throw new Error('gift_unavailable');
    const gift=g.data(),now=Date.now(),message={senderId:uid,type:'gift',k:kind,number,upgraded:!!gift.upgraded,to,text:'🎁 هدية '+kind+' #'+number,createdAt:now,read:false};
    if(gift.model!=null){message.model=gift.model;message.bg=gift.bg;message.sym=gift.sym;}
    tx.delete(source);tx.set(dest,gift);tx.update(saleRef,{ownerId:to});
    tx.set(db.collection('giftEvents').doc(kind+'_'+number).collection('log').doc(),{k:kind,number,coll:c.coll,type:'send',from:uid,to,at:now});
    if(chat.exists){const parts=chat.data().participants||[];if(!parts.includes(uid)||!parts.includes(to))throw new Error('chat');tx.update(chatRef,{updatedAt:now});}
    else tx.set(chatRef,{participants:[uid,to].sort(),updatedAt:now});
    tx.set(chatRef.collection('messages').doc(),message);
   });
   return res.json({ok:true});
  }
  if(body.action==='buy-listing'){
   const lid=String(body.listingId||'');if(!lid||lid.length>100)return res.status(400).json({error:'listing'});
   const result=await db.runTransaction(async tx=>{
    const lr=db.collection('giftListings').doc(lid), ls=await tx.get(lr);if(!ls.exists)throw new Error('listing_missing');
    const l=ls.data();if(l.sellerId===uid)throw new Error('own_listing');
    const isDev=user.email==='anldheb429@gmail.com';
    const coll=l.coll==='pepes'?'pepes':l.coll==='cats'?'cats':'gifts';
    const sales=l.coll==='pepes'?'pepeSales':l.coll==='cats'?'catSales':'giftSales';
    const sid=coll==='gifts'?lid:String(l.number), saleRef=db.collection(sales).doc(sid);
    const buyerWalletRef=db.collection('wallets').doc(uid),sellerWalletRef=db.collection('wallets').doc(l.sellerId);
    const giftBuyerRef=db.collection('users').doc(uid).collection(coll).doc(sid),giftSellerRef=db.collection('users').doc(l.sellerId).collection(coll).doc(sid);
    const [sale,bw,sw,sg,bg,bu]=await Promise.all([tx.get(saleRef),tx.get(buyerWalletRef),tx.get(sellerWalletRef),tx.get(giftSellerRef),tx.get(giftBuyerRef),tx.get(db.collection('users').doc(uid))]);
    if(!sale.exists||sale.data().ownerId!==l.sellerId||!sg.exists||bg.exists)throw new Error('listing_changed');
    if(!sg.data().upgraded)throw new Error('gift_not_upgraded');
    const balance=bw.exists?Number(bw.data().stars)||0:0, price=Number(l.price);if(!Number.isSafeInteger(price)||price<1||(!isDev&&balance<price))throw new Error('insufficient_stars');
    const net=Math.floor(price*95/100),now=Date.now();
    tx.update(saleRef,{ownerId:uid});tx.delete(lr);tx.delete(giftSellerRef);
    const newGift={...sg.data(),number:Number(l.number),upgraded:true};if(coll==='gifts')newGift.k=l.k;
    tx.set(giftBuyerRef,newGift);
    if(!isDev)tx.set(buyerWalletRef,{stars:balance-price,lastBuyListing:lid},{merge:true});
    tx.set(sellerWalletRef,{stars:(sw.exists?Number(sw.data().stars)||0:0)+net},{merge:true});
    tx.set(db.collection('users').doc(uid).collection('txs').doc(),{type:'buy',gift:Number(l.number),stars:price,at:now,kind:l.k||'pepe'});
    tx.set(db.collection('users').doc(l.sellerId).collection('txs').doc(),{type:'sell',gift:Number(l.number),stars:net,at:now,kind:l.k||'pepe',buyer:uid,buyerName:(bu.data()||{}).displayName||'مستخدم'});
    tx.set(db.collection('giftEvents').doc((l.k||'pepe')+'_'+l.number).collection('log').doc(),{k:l.k||'pepe',number:Number(l.number),coll,type:'sale',from:l.sellerId,to:uid,price,at:now});
    return {number:Number(l.number),kind:l.k||'pepe',price};
   });
   return res.json({ok:true,...result});
  }
  if(body.action==='gift-stars'){
   if(user.email!=='anldheb429@gmail.com')return res.status(403).json({error:'forbidden'});
   const to=String(body.to||''), amount=Number(body.amount);
   if(!to||to===uid||!Number.isSafeInteger(amount)||amount<1||amount>1000000)return res.status(400).json({error:'input'});
   const [target,from]=await Promise.all([admin.auth().getUser(to),db.collection('users').doc(uid).get()]);
   const now=Date.now(), name=(from.data()||{}).displayName||'المطور', toName=(await db.collection('users').doc(to).get()).data()?.displayName||'مستخدم';
   await db.runTransaction(async tx=>{
    const wr=db.collection('wallets').doc(to), w=await tx.get(wr);tx.set(wr,{stars:(w.exists?Number(w.data().stars)||0:0)+amount},{merge:true});
    tx.set(db.collection('users').doc(to).collection('txs').doc(),{type:'in',from:uid,fromName:name,stars:amount,at:now});
    tx.set(db.collection('users').doc(uid).collection('txs').doc(),{type:'out',to,toName,stars:amount,at:now});
   });
   return res.json({ok:true});
  }
  return res.status(400).json({error:'action'});
 }catch(e){console.error('stars api',e);const status=e.status||(/insufficient_stars|sold_out|gift_not_found/.test(e.message)?400:500);return res.status(status).json({error:/insufficient_stars|sold_out|gift_not_found|auth|verified|app_check/.test(e.message)?e.message:'failed'});}
};
