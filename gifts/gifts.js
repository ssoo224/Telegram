/* ===== gifts.js — هدايا Plush Pepe + المحفظة + المتجر ===== */
/* يُحمَّل بعد models.js وقبل star-gift.js. اقرأ gifts/README.md */
const PEPE_MAX=30, PEPE_PRICE=1000, DEV_BIG=1000000000;
/* أنواع الهدايا: كل نوع له مجموعة بفايربيس + مبيعات + نماذج. نوع جديد = سطر هنا + قواعد firestore */
const GIFT_KINDS={
  pepe:{key:'pepe',name:'Plush Pepe',coll:'pepes',sales:'pepeSales',field:'lastBuy',max:30,price:1000,dir:'models',models:PEPE_MODELS},
  cat:{key:'cat',name:'Scared Cat',coll:'cats',sales:'catSales',field:'lastBuyCat',max:30,price:500,dir:'cat-models',models:CAT_MODELS}
};
const gk=k=>GIFT_KINDS[k||'pepe']||GIFT_KINDS.pepe;
const PEPE_BGS=[{n:'Chocolate',a:'#b8795a',b:'#5b3326',p:30},{n:'Emerald',a:'#3fd0a0',b:'#0a5a40',p:25},{n:'Sapphire',a:'#5784e6',b:'#122565',p:20},{n:'Ruby',a:'#ea4b50',b:'#650d1a',p:15},{n:'Black',a:'#26262c',b:'#000000',p:10}];
const PEPE_SYMS=[
 {n:'Moon',p:30,d:'M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5a8.6 8.6 0 1 0 10.7 10.7z'},
 {n:'Flame',p:25,d:'M12.2 2.5c.5 3.2 3.3 4.7 4.6 7.6 1.4 3.2.3 7.2-2.8 8.9a6 6 0 0 1-7.9-7.2c.5-1.6 1.6-2.6 2.5-3.9.3 1.5.9 2.3 1.9 2.6-.6-3.1.1-6.4 1.7-8z'},
 {n:'Crown',p:20,d:'M3 7.5l4.2 3.6L12 4l4.8 7.1L21 7.5 19.2 18H4.8zM5 20h14v2H5z'},
 {n:'Diamond',p:15,d:'M6.5 3h11L22 9l-10 12.5L2 9z'},
 {n:'Skull',p:10,e:1,d:'M12 2.2c-4.6 0-8 3.2-8 7.6 0 2.5 1.1 4.3 2.6 5.5V19a1 1 0 0 0 1 1H9v1.8h1.8V20h2.4v1.8H15V20h1.4a1 1 0 0 0 1-1v-3.7c1.5-1.2 2.6-3 2.6-5.5 0-4.4-3.4-7.6-8-7.6zM8.6 12.9a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2zm6.8 0a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2zM12 14.2l1.2 2.3h-2.4z'}
];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
/* كل عمليات النجوم والهدايا الحساسة تمر من الخادم (/api/gifts) */
async function giftApi(op,body){
  const r=await babylonApi('/api/gifts',Object.assign({op:op},body||{}),currentUser);
  if(r.status===200)return r.data;
  const e=new Error((r.data&&r.data.error)||('http '+r.status));e.code=e.message;e.status=r.status;throw e;
}
function wpick(a){let r=Math.random()*a.reduce((s,x)=>s+x.p,0);for(let i=0;i<a.length;i++){r-=a[i].p;if(r<0)return i;}return a.length-1;}
function fmtN(n){return Number(n).toLocaleString('en-US');}

/* ---------- الرصيد ---------- */
let myStars=0,walletUnsub=null,walletFor=null,walletReady=false;
function isDevUser(){return !!(currentUser&&String(currentUser.email||'').toLowerCase()===DEV_EMAIL);}
function starsLabel(){return isDevUser()?'∞':fmtN(myStars);}
function paintStars(){document.querySelectorAll('[data-stars]').forEach(e=>{e.textContent=starsLabel();});}
function startWallet(uid){
  if(walletFor===uid)return;
  if(walletUnsub)walletUnsub();
  walletFor=uid;walletReady=false;
  walletUnsub=db.collection('wallets').doc(uid).onSnapshot(d=>{
    const v=d.exists?(Number(d.data().stars)||0):0;
    if(walletReady&&v>myStars&&!isDevUser())showToast('🎁 وصلتك نجوم! رصيدك الآن '+fmtN(v)+' ⭐');
    myStars=v;walletReady=true;paintStars();
  },()=>{});
}
auth.onAuthStateChanged(u=>{if(u)startWallet(u.uid);else{if(walletUnsub)walletUnsub();walletUnsub=null;walletFor=null;myStars=0;walletReady=false;}});

/* ---------- Lottie ---------- */
const GIFTS_CDN='https://cdn.changes.tg/gifts/models/';
const GIFTS_CDN_DIR={pepe:'Plush Pepe',cat:'Scared Cat'};
/* ===== هدايا إضافية من gifts/manifest.json (تولّده make_manifest.py) ===== */
const gid=(K,n)=>K.gen?K.key+'_'+n:String(n);
const salesQ=K=>K.gen?db.collection('giftSales').where('k','==',K.key):db.collection(K.sales);
const FEE_PCT=5,netOf=p=>Math.floor(p*(100-FEE_PCT)/100);
const evRef=(K,n)=>db.collection('giftEvents').doc(K.key+'_'+n).collection('log').doc();
const listId=(K,n)=>K.key+'_'+n;
const kindDir=K=>GIFTS_CDN_DIR[K.key]||K.name;
const modelName=(K,i)=>i<0?(K.gen&&!K.orig?K.models[0].n:'Original'):K.models[i].n;
const BLANK_IMG='data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const loadManifest=async()=>{
  for(const u of [GIFTS_BASE+'manifest.json?v=1','/gifts/manifest.json?v=1','/manifest.json?v=1']){
    try{const r=await fetch(u);if(!r.ok)continue;const j=await r.json();if(j&&j.gifts)return j;}catch(e){}
  }
  console.warn('gifts manifest.json not found');return null;
};
const GIFTS_READY=loadManifest().then(m=>{
  if(!m||!m.gifts)return;
  m.gifts.forEach(g=>{
    const key=g.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    if(!key||GIFT_KINDS[key]||/^plush pepe$|^scared cat$/i.test(g.name)||!g.models||!g.models.length)return;
    GIFTS_CDN_DIR[key]=g.name;
    const names=g.models.filter(n=>n!=='Original'),orig=names.length<g.models.length;
    if(!names.length)return;
    GIFT_KINDS[key]={key,name:g.name,gen:true,orig,coll:'gifts',field:'lastBuyGift',max:g.max||30,price:g.price||500,models:names.map(n=>({n,p:1}))};
  });
}).catch(()=>{});
const _pepeTxt={};
async function pepeText(i,kind){
  const K=gk(kind),key=K.key+':'+i;
  if(_pepeTxt[key])return _pepeTxt[key];
  const f=i<0?'original':K.models[i].f;
  /* المصدر: موقع CDN خارجي (اترك GIFTS_CDN فاضي '' للرجوع لملفات gifts/ المحلية) */
  const url=GIFTS_CDN?GIFTS_CDN+encodeURIComponent(kindDir(K))+'/'+encodeURIComponent(modelName(K,i))+'.tgs':GIFTS_BASE+K.dir+'/'+f+'.tgs';
  const r=await fetch(url);
  if(!r.ok)throw new Error('tgs '+r.status);
  const st=new Blob([await r.arrayBuffer()]).stream().pipeThrough(new DecompressionStream('gzip'));
  return _pepeTxt[key]=await new Response(st).text();
}
let _lotP=null;
function loadLottie(){
  if(window.lottie)return Promise.resolve(window.lottie);
  if(_lotP)return _lotP;
  const urls=['https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js','https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie.min.js'];
  return _lotP=new Promise((res,rej)=>{let i=0;(function next(){
    if(i>=urls.length){_lotP=null;return rej(new Error('lottie'));}
    const s=document.createElement('script');s.src=urls[i++];
    s.onload=()=>window.lottie?res(window.lottie):next();s.onerror=next;document.head.appendChild(s);
  })();});
}
async function mountPepeAnim(h,mi,opt){
  opt=opt||{};
  if(!h)return;
  h.innerHTML='<div class="pp-fb">🐸</div>';
  try{
    const [lot,txt]=await Promise.all([loadLottie(),pepeText(mi,opt.kind)]);
    if(!h.isConnected)return;
    h.innerHTML='';
    const an=lot.loadAnimation({container:h,renderer:'svg',loop:!opt.still,autoplay:!opt.still,animationData:JSON.parse(txt)});
    if(opt.still)an.addEventListener('DOMLoaded',()=>an.goToAndStop(40,true));
    h._an=an;
  }catch(e){console.error('pepe',e);}
}

/* ---------- رسم الهدية (خلفية + رموز + Pepe) ---------- */
function patInner(si){
  const sym=PEPE_SYMS[si],rings=[[29,7,7.6,.24],[42,10,6.4,.17],[55,13,5.4,.12],[68,16,4.6,.085]];
  let out='';
  rings.forEach((r,ri)=>{
    for(let k=0;k<r[1];k++){
      const a=2*Math.PI*k/r[1]+(ri%2)*Math.PI/r[1]-Math.PI/2,x=50+r[0]*Math.cos(a),y=44+r[0]*Math.sin(a)*1.02,rot=((k*47+ri*23)%50)-25;
      out+='<g transform="translate('+x.toFixed(1)+' '+y.toFixed(1)+') rotate('+rot+') scale('+(r[2]/24).toFixed(3)+') translate(-12 -12)" opacity="'+r[3]+'"><path d="'+sym.d+'"'+(sym.e?' fill-rule="evenodd"':'')+' fill="#fff"/></g>';
    }
  });
  return out;
}
function patSvg(si){return '<svg class="ga-pat" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">'+patInner(si)+'</svg>';}
function bgCss(g){
  const up=g&&g.upgraded,b=up?PEPE_BGS[g.bg]:{a:'#3b414d',b:'#12151b'};
  return 'radial-gradient(circle at 50% 44%,'+b.a+' 0%,'+b.b+' 100%)';
}
function thumbLocal(g){
  const K=gk(g.k);if(K.gen)return BLANK_IMG;
  const f=g.upgraded?K.models[g.model].f:'original';
  return GIFTS_BASE+K.dir+'/thumbs/'+f+'.webp';
}
/* الصورة المصغّرة من مجلد png بالـ CDN؛ إذا ما انوجدت يرجع للمحلية تلقائياً */
function thumbUrl(g){
  if(!GIFTS_CDN)return thumbLocal(g);
  const K=gk(g.k);
  return GIFTS_CDN+encodeURIComponent(kindDir(K))+'/png/'+encodeURIComponent(modelName(K,g.upgraded?g.model:-1))+'.png';
}
function giftArt(g,opt){
  opt=opt||{};
  const el=document.createElement('div');el.className='ga'+(opt.cls?' '+opt.cls:'');
  el.style.background=bgCss(g);
  el.innerHTML=(g.upgraded?patSvg(g.sym):'')+'<div class="ga-pepe"'+(g.upgraded?'':' style="filter:grayscale(1) brightness(.78)"')+'></div>';
  const holder=el.querySelector('.ga-pepe'),mi=g.upgraded?g.model:-1;
  if(opt.still){
    /* مربعات الشبكة: صورة ثابتة خفيفة بدل أنيميشن Lottie؛ وإذا فشلت الصورة نرجع للأنيميشن */
    const im=new Image();im.alt='';im.decoding='async';im.loading='lazy';
    im.onerror=()=>mountPepeAnim(holder,mi,{still:true,kind:g.k});
    im.onerror=function(){im.onerror=null;im.src=thumbLocal(g);};im.src=thumbUrl(g);holder.appendChild(im);
  }else mountPepeAnim(holder,mi,{kind:g.k});
  return el;
}

/* ---------- شبكة الهدايا بالبروفايل ---------- */
const giftGridUnsub={};
function loadGiftsGrid(uid,gridId,wrapId){
  const grid=document.getElementById(gridId),wrap=document.getElementById(wrapId);if(!grid||!wrap)return;
  if(giftGridUnsub[gridId])giftGridUnsub[gridId]();
  const data={};
  const draw=()=>{
    const items=[].concat(...Object.values(data)).sort((a,b)=>(b.at||0)-(a.at||0));
    wrap.classList.toggle('hidden',!items.length);
    grid.innerHTML='';
    items.forEach(g=>{
      const t=giftArt(g,{still:true,cls:'gift-tile'});
      t.insertAdjacentHTML('beforeend','<div class="gt-n">#'+g.number+'</div>');
      t.onclick=()=>openGiftPage(uid,g.number,g.k);
      grid.appendChild(t);
    });
  };
  const unsubs=Object.values(GIFT_KINDS).filter(K=>!K.gen).map(K=>{
    data[K.key]=[];
    return db.collection('users').doc(uid).collection(K.coll).onSnapshot(snap=>{
      data[K.key]=snap.docs.map(d=>Object.assign({k:K.key},d.data()));draw();
    },()=>{data[K.key]=[];draw();});
  });
  /* الهدايا الإضافية كلها بمجموعة واحدة users/{uid}/gifts وكل وثيقة فيها k */
  data.__gen=[];
  unsubs.push(db.collection('users').doc(uid).collection('gifts').onSnapshot(snap=>{
    data.__gen=snap.docs.map(d=>d.data()).filter(g=>g.k&&GIFT_KINDS[g.k]);draw();
  },()=>{data.__gen=[];draw();}));
  giftGridUnsub[gridId]=()=>unsubs.forEach(u=>u());
}

/* ---------- صفحة تفاصيل الهدية (مثل تليجرام) ---------- */
let gpUnsub=null;
function closeGiftPage(){if(gpUnsub){gpUnsub();gpUnsub=null;}document.getElementById('giftPage')?.remove();document.getElementById('giftPageBackdrop')?.remove();}
const IC_BACK='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
const IC_X='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const IC_DOTS='<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
async function openGiftPage(uid,n,kind){
  const K=gk(kind);
  closeGiftPage();
  const bd=document.createElement('div');bd.id='giftPageBackdrop';bd.onclick=closeGiftPage;uiRoot().appendChild(bd);
  const ov=document.createElement('div');ov.id='giftPage';ov.className='gp-ov';uiRoot().appendChild(ov);
  ov.innerHTML='<div class="gp-hero" style="background:'+bgCss({})+'"><div class="gp-top"><button type="button" class="gp-round" id="gpBack" aria-label="إغلاق">'+IC_X+'</button></div></div>';
  /* سحب الورقة للأسفل لإغلاقها (فقط وهي بأعلى المحتوى) */
  let sy=null,dy=0;
  ov.addEventListener('touchstart',e=>{if(ov.scrollTop<=0&&e.touches.length===1){sy=e.touches[0].clientY;dy=0;ov.style.transition='none';}},{passive:true});
  ov.addEventListener('touchmove',e=>{if(sy==null)return;dy=e.touches[0].clientY-sy;if(dy>0)ov.style.transform='translateY('+dy+'px)';else{dy=0;ov.style.transform='';}},{passive:true});
  ov.addEventListener('touchend',()=>{if(sy==null)return;const d=dy;sy=null;ov.style.transition='transform .2s ease';if(d>110){ov.style.transform='translateY(100%)';setTimeout(closeGiftPage,180);}else ov.style.transform='';},{passive:true});
  ov.querySelector('#gpBack').onclick=closeGiftPage;
  const issuedP=salesQ(K).get().then(s=>s.size).catch(()=>null);
  await loadUsers([uid]);
  const issued=await issuedP;
  if(!document.getElementById('giftPage'))return;
  gpUnsub=db.collection('users').doc(uid).collection(K.coll).doc(gid(K,n)).onSnapshot(async doc=>{
    if(!doc.exists){closeGiftPage();showToast('هذه الهدية غير موجودة');return;}
    const g=Object.assign({k:K.key},doc.data());
    ov._ctx={uid,g,issued};
    let lst=null;
    try{const ld=await db.collection('giftListings').doc(listId(K,n)).get();if(ld.exists)lst=ld.data();}catch(e){}
    if(!document.getElementById('giftPage'))return;
    renderGiftPage(ov,uid,g,issued,false,lst);
  },()=>{closeGiftPage();});
}
/* نسبة ظهور النموذج الحقيقية = وزنه / مجموع الأوزان (Plush Pepe و Scared Cat مجموعها 1000، والهدايا الجديدة أوزانها متساوية) */
function rarePct(K,m){const t=K.models.reduce((a,x)=>a+(Number(x.p)||0),0)||1;return String(+((Number(m.p)||0)/t*100).toFixed(1));}
function gpRow(k,v){return '<div class="gp-row"><div class="gp-k">'+k+'</div><div class="gp-v">'+v+'</div></div>';}
function renderGiftPage(ov,uid,g,issued,reveal,lst){
  const K=gk(g.k);
  const up=!!g.upgraded,me=meId(),mine=uid===me,m=up?K.models[g.model]:null,b=up?PEPE_BGS[g.bg]:null,s=up?PEPE_SYMS[g.sym]:null;
  const u=GU[uid]||{};
  const ownerV='<div class="gp-owner" id="gpOwner">'+userAvHtml(uid,'gp-oav')+'<span>'+esc(u.displayName||'مستخدم')+(mine?' <em>(أنت)</em>':'')+'</span></div>';
  const lock='<span class="gp-lock">غير مُرقّاة</span>';
  ov.innerHTML='<div class="gp-hero'+(reveal?' reveal':'')+'" id="gpHero" style="background:'+bgCss(g)+'">'+(up?patSvg(g.sym):'')
    +'<div class="gp-top"><button type="button" class="gp-round" id="gpBack" aria-label="إغلاق">'+IC_X+'</button><button type="button" class="gp-round" id="gpMore" aria-label="المزيد">'+IC_DOTS+'</button></div>'
    +'<div class="gp-pepe"'+(up?'':' style="filter:grayscale(1) brightness(.8)"')+'></div>'
    +'<div class="gp-title">'+K.name+' <span>#'+g.number+'</span></div>'
    +'<div class="gp-chip" id="gpChip">'+(up?'نسخة '+g.number+' من '+K.max:'هدية بانتظار الترقية')+'</div></div>'
    +'<div class="gp-body"><div class="gp-table">'
    +gpRow('المالك',ownerV)
    +gpRow('النموذج',up?esc(m.n)+'<span class="gp-pill">'+rarePct(K,m)+'%</span>':lock)
    +gpRow('الرمز',up?esc(s.n)+'<span class="gp-pill">'+s.p+'%</span>':lock)
    +gpRow('الخلفية',up?esc(b.n)+'<span class="gp-pill">'+b.p+'%</span>':lock)
    +gpRow('الكمية',(issued!=null?issued:'—')+'/'+K.max+' صادرة')
    +(lst?gpRow('السعر','<span class="gp-price">⭐ '+fmtN(lst.price)+'</span>'):'')
    +'</div>'
    +(mine&&up&&!lst?'<button type="button" class="gp-cta" id="gpSell">🏷️ بيع بنجوم</button><div class="gp-note">حدّد سعراً وتنعرض للبيع بالمتجر. تگدر تلغي العرض أو تغيّر السعر بأي وقت.</div>':'')
    +(mine&&lst?'<div class="gp-listed">معروضة للبيع بـ ⭐ '+fmtN(lst.price)+'</div><div class="gp-btns"><button type="button" class="gp-cta alt" id="gpEdit">تعديل السعر</button><button type="button" class="gp-cta danger" id="gpUnlist">إلغاء العرض</button></div>':'')
    +(!mine&&lst?'<button type="button" class="gp-cta" id="gpBuy">🛒 شراء بـ ⭐ '+fmtN(lst.price)+'</button><div class="gp-note">النجوم تروح لصاحب الهدية وتنتقل الهدية إلك مباشرة.</div>':'')
    +(mine&&!up?'<button type="button" class="gp-cta" id="gpUp">✨ ترقية الهدية مجاناً</button><div class="gp-note">ستحصل على نموذج وخلفية ورمز عشوائي، وبعضها نادر جداً.</div>':'')
    +(!mine&&!lst?'<button type="button" class="gp-cta alt" id="gpOk">حسنًا</button>':'')
    +'</div>';
  ov.querySelector('#gpBack').onclick=closeGiftPage;
  const okb=ov.querySelector('#gpOk');if(okb)okb.onclick=closeGiftPage;
  const mb=ov.querySelector('#gpMore');if(mb)mb.onclick=ev=>{ev.stopPropagation();if(window.giftMoreMenu)window.giftMoreMenu(ov,g);};
  mountPepeAnim(ov.querySelector('.gp-pepe'),up?g.model:-1,{kind:g.k});
  ov.querySelector('#gpOwner').onclick=()=>{
    if(mine){closeGiftPage();openProfile();return;}
    db.collection('users').doc(uid).get().then(d=>{if(d.exists){closeGiftPage();openUserProfileDirect(Object.assign({id:uid},d.data()));}});
  };
  /* سجل المالكين محذوف بطلب المستخدم */
  const upb=ov.querySelector('#gpUp');if(upb)upb.onclick=()=>doUpgrade(ov,uid,g);
  const sb=ov.querySelector('#gpSell');if(sb)sb.onclick=()=>sellGift(ov,g,null);
  const eb=ov.querySelector('#gpEdit');if(eb)eb.onclick=()=>sellGift(ov,g,lst);
  const ub=ov.querySelector('#gpUnlist');if(ub)ub.onclick=()=>unlistGift(ov,g);
  const bb=ov.querySelector('#gpBuy');if(bb)bb.onclick=()=>buyListing(ov,lst);
}
let upgrading=false;
async function doUpgrade(ov,uid,g){
  if(upgrading)return;upgrading=true;
  const K=gk(g.k);
  const hero=ov.querySelector('#gpHero'),btn=ov.querySelector('#gpUp'),chip=ov.querySelector('#gpChip');
  if(btn){btn.disabled=true;btn.textContent='جاري الترقية…';}
  hero.classList.add('rolling');
  const apiP=giftApi('upgrade',{kind:K.key,number:g.number});apiP.catch(()=>{});
  let pat=hero.querySelector('.ga-pat');
  if(!pat){hero.insertAdjacentHTML('afterbegin',patSvg(0));pat=hero.querySelector('.ga-pat');}
  try{
    const steps=24;let res=null;
    for(let i=0;i<steps;i++){
      const last=i===steps-1;
      if(last)res=await apiP;   /* النتيجة تجي من الخادم (عشوائية حقيقية لا يتحكم بها المستخدم) */
      const bi=last?res.bg:Math.floor(Math.random()*5),si=last?res.sym:Math.floor(Math.random()*5);
      hero.style.background=bgCss({upgraded:true,bg:bi});
      pat.innerHTML=patInner(si);
      if(chip)chip.textContent=PEPE_BGS[bi].n+' · '+PEPE_SYMS[si].n;
      await sleep(60+i*i*0.55);
    }
    await sleep(250);
    showToast('✨ تمت الترقية: '+K.models[res.model].n);
    const doc=ov.querySelector('#gpHero');if(doc)doc.classList.add('reveal');
  }catch(e){console.error(e);showToast('تعذرت الترقية');hero.classList.remove('rolling');renderGiftPage(ov,uid,g,null);}
  upgrading=false;
}

/* ---------- متجر الهدايا ---------- */
let storeKind='pepe';
function closeStore(){document.getElementById('giftStore')?.remove();clearInterval(window.__storeTimer);}
async function openStoreGrid(){
  closeStore();
  const ov=document.createElement('div');ov.id='giftStore';ov.className='gp-ov st-ov';uiRoot().appendChild(ov);
  ov.innerHTML='<div class="gx-top"><button type="button" class="gx-ib" id="stBack" aria-label="رجوع">'+IC_BACK+'</button><div class="gx-title"><b>متجر الهدايا</b></div></div><div class="sg-sub">جاري التحميل…</div>';
  ov.querySelector('#stBack').onclick=closeStore;
  await GIFTS_READY;
  if(!document.getElementById('giftStore'))return;
  const kinds=Object.values(GIFT_KINDS);
  const art=K=>{
    const gen=!!K.gen;
    const src=GIFTS_CDN?GIFTS_CDN+encodeURIComponent(kindDir(K))+'/png/'+encodeURIComponent(modelName(K,-1))+'.png':(gen?BLANK_IMG:GIFTS_BASE+K.dir+'/thumbs/original.webp');
    const fb=gen?BLANK_IMG:GIFTS_BASE+K.dir+'/thumbs/original.webp';
    return {src,fb};
  };
  ov.innerHTML='<div class="gx-top"><button type="button" class="gx-ib" id="stBack" aria-label="رجوع">'+IC_BACK+'</button><div class="gx-title"><b>متجر الهدايا</b></div></div>'
    +'<div class="st-seg"><button type="button" class="on" id="stTabN">هدايا جديدة</button><button type="button" id="stTabR">هدايا مطورة</button></div>'
    +'<div id="stNew"><div class="sg-grid">'+kinds.map(K=>{const a=art(K);return '<div class="sg-card" data-k="'+K.key+'" data-n="'+K.name.toLowerCase()+'"><div class="sg-ribbon"></div><div class="sg-art"><img alt="" loading="lazy" decoding="async" src="'+a.src+'" data-fb="'+a.fb+'"></div><div class="sg-name">'+K.name+'</div><div class="sg-price">⭐ '+K.price+'</div><div class="sg-floor"></div></div>';}).join('')+'</div></div><div id="stResale" class="hidden"></div>';
  ov.querySelector('#stBack').onclick=closeStore;
  const tabN=ov.querySelector('#stTabN'),tabR=ov.querySelector('#stTabR'),boxN=ov.querySelector('#stNew'),boxR=ov.querySelector('#stResale');
  tabN.onclick=()=>{tabN.classList.add('on');tabR.classList.remove('on');boxN.classList.remove('hidden');boxR.classList.add('hidden');};
  tabR.onclick=()=>{tabR.classList.add('on');tabN.classList.remove('on');boxR.classList.remove('hidden');boxN.classList.add('hidden');loadResale(boxR);};
  ov.querySelectorAll('.sg-art img').forEach(im=>{im.onerror=()=>{im.onerror=null;im.src=im.dataset.fb;};});
  ov.querySelectorAll('.sg-card').forEach(c=>c.onclick=()=>openGiftStore(c.dataset.k));
  /* "نفدت" للهديتين القديمتين فقط (الباقي نعرفه من صفحة الهدية حتى ما نقرأ مبيعات الكل) */
  kinds.filter(K=>!K.gen).forEach(K=>db.collection(K.sales).get().then(s=>{
    if(K.max-s.size<=0){const c=ov.querySelector('.sg-card[data-k="'+K.key+'"]');if(c){c.classList.add('out');c.querySelector('.sg-ribbon').textContent='نفدت';}}
  }).catch(()=>{}));
  paintFloors(ov);
  syncCatalog();
}
/* المطوّر فقط: يكتب سعر وكمية كل هدية بـ giftCatalog حتى القواعد تتحقق منها عند الشراء */
let catalogSynced=false;
async function syncCatalog(){
  if(catalogSynced||!isDevUser())return;catalogSynced=true;
  try{
    const cur={};(await db.collection('giftCatalog').get()).forEach(d=>cur[d.id]=d.data());
    const todo=Object.values(GIFT_KINDS).filter(K=>K.gen&&(!cur[K.key]||cur[K.key].price!==K.price||cur[K.key].max!==K.max));
    for(let i=0;i<todo.length;i+=400){
      const b=db.batch();todo.slice(i,i+400).forEach(K=>b.set(db.collection('giftCatalog').doc(K.key),{name:K.name,price:K.price,max:K.max}));
      await b.commit();
    }
    if(todo.length)showToast('تم تحديث كتالوج الهدايا ('+todo.length+')');
  }catch(e){console.error(e);catalogSynced=false;}
}
async function openGiftStore(kind){
  if(typeof kind!=='string')return openStoreGrid();
  storeKind=kind;
  closeStore();
  const K=gk(storeKind);
  const ov=document.createElement('div');ov.id='giftStore';ov.className='gp-ov st-ov';uiRoot().appendChild(ov);
  ov.innerHTML='<div class="gx-top"><button type="button" class="gx-ib" id="stBack" aria-label="رجوع">'+IC_BACK+'</button><div class="gx-title"><b>متجر الهدايا</b></div></div>'
    +'<div class="st-body"><div class="st-hero" id="stHero"></div>'
    +'<div class="st-title">'+K.name+'</div><div class="st-sub" id="stSub">نسخ محدودة · '+K.max+' فقط</div>'
    +'<div class="gp-table st-table">'
    +gpRow('السعر',K.price+' ⭐')
    +gpRow('رصيدك','<b data-stars>'+starsLabel()+'</b> ⭐')
    +gpRow('الترقية','مجانية، نموذج وخلفية ورمز عشوائي')
    +'</div><button type="button" class="gp-cta" id="stBuy">شراء بـ '+K.price+' نجمة</button><div class="gp-note" id="stNote"></div></div>';
  ov.querySelector('#stBack').onclick=openStoreGrid;
  // عرض متنوع: يبدّل النموذج والخلفية والرمز كل كم ثانية
  const hero=ov.querySelector('#stHero');let i=0;
  const show=()=>{
    const g={k:K.key,upgraded:true,model:(i*7+3)%K.models.length,bg:(i*2+1)%5,sym:(i*3)%5};
    const el=giftArt(g,{cls:'st-art'});el.classList.add('fadein');
    hero.innerHTML='';hero.appendChild(el);i++;
  };
  show();window.__storeTimer=setInterval(()=>{if(!document.getElementById('giftStore')){clearInterval(window.__storeTimer);return;}show();},3200);
  refreshStore();
  ov.querySelector('#stBuy').onclick=()=>buyGift(K.key);
}
async function refreshStore(){
  const ov=document.getElementById('giftStore');if(!ov)return;
  const K=gk(storeKind);
  try{
    const s=await salesQ(K).get();
    const left=K.max-s.size,sub=ov.querySelector('#stSub'),btn=ov.querySelector('#stBuy');
    if(sub)sub.textContent='نسخة محدودة · المتبقي '+Math.max(0,left)+' من '+K.max;
    if(btn&&left<=0){btn.disabled=true;btn.textContent='نفدت الكمية';}
  }catch(e){}
}
let buying=false;
async function buyGift(kind){
  if(buying)return;
  const K=gk(kind),dev=isDevUser();
  if(!dev&&myStars<K.price)return showToast('رصيدك غير كافٍ ⭐');
  buying=true;
  const btn=document.getElementById('stBuy');if(btn){btn.disabled=true;btn.textContent='جاري الشراء…';}
  try{
    const r=await giftApi('buy',{kind:K.key});
    showToast('🎉 اشتريت '+K.name+' #'+r.number);
  }catch(e){
    console.error(e);
    showToast(e.code==='soldout'?'نفدت الكمية':e.code==='funds'?'رصيدك غير كافٍ ⭐':(e.code==='otp'||e.code==='auth')?'سجّل خروج وادخل من جديد':'ممكن أحد سبقك، حاول مرة ثانية');
  }
  const sb=document.getElementById('stBuy');if(sb){sb.disabled=false;sb.textContent='شراء بـ '+K.price+' نجمة';}
  refreshStore();
  buying=false;
}

/* ---------- سجل نجوم بابل ---------- */
let histUnsub=null;
function closeHistory(){if(histUnsub){histUnsub();histUnsub=null;}document.getElementById('starsHist')?.remove();}
function fmtWhen(t){const d=new Date(t);return d.toLocaleDateString('ar',{day:'numeric',month:'long'})+' · '+d.toLocaleTimeString('ar',{hour:'numeric',minute:'2-digit'});}
function openStarsHistory(){
  closeHistory();
  const dev=isDevUser();
  const ov=document.createElement('div');ov.id='starsHist';ov.className='gp-ov st-ov';uiRoot().appendChild(ov);
  const tabs=[['all','الكل'],['buy','المشتريات'],['sell','المبيعات'],['in','المستلمة'],['out','المُهداة']];
  ov.innerHTML='<div class="gx-top"><button type="button" class="gx-ib" id="shBack" aria-label="رجوع">'+IC_BACK+'</button><div class="gx-title"><b>نجوم بابل</b></div></div>'
    +'<div class="sh-bal"><div class="sh-lb">رصيدك</div><div class="sh-n"><span data-stars>'+starsLabel()+'</span><i>⭐</i></div>'+(dev?'<div class="sh-dev">حساب المطور · رصيد لا نهائي</div>':'')+'</div>'
    +'<div class="sh-tabs" id="shTabs">'+tabs.map((t,i)=>'<button type="button" class="'+(i?'':'on')+'" data-t="'+t[0]+'">'+t[1]+'</button>').join('')+'</div>'
    +'<div class="sh-list" id="shList"><div class="gx-empty">جاري التحميل…</div></div>';
  ov.querySelector('#shBack').onclick=closeHistory;
  let tab='all',rows=[];
  const draw=()=>{
    const list=ov.querySelector('#shList');
    const f=rows.filter(r=>tab==='all'||r.type===tab);
    if(!f.length){list.innerHTML='<div class="gx-empty">لا توجد عمليات بعد.</div>';return;}
    list.innerHTML=f.map(r=>{
      let ic='⭐',title='',amt='',cls='';
      if(r.type==='buy'){ic='🎁';title='اشتريت '+gk(r.kind).name+' #'+r.gift;amt='−'+fmtN(r.stars);cls='neg';}
      else if(r.type==='sell'){ic='💰';title='بعت '+gk(r.kind).name+' #'+r.gift+(r.buyerName?' إلى '+esc(r.buyerName):'');amt='+'+fmtN(r.stars);cls='pos';}
      else if(r.type==='in'){ic='⭐';title='هدية نجوم من '+esc(r.fromName||'المطور');amt='+'+fmtN(r.stars);cls='pos';}
      else if(r.type==='out'){ic='📤';title='أهديت '+esc(r.toName||'مستخدم')+(r.fee?' <small>(عمولة '+fmtN(r.fee)+')</small>':'');amt='−'+fmtN(r.stars);cls='neg';}
      return '<div class="sh-row" data-g="'+(r.type==='buy'?r.gift:'')+'" data-k="'+(r.kind||'pepe')+'"><div class="sh-ic">'+ic+'</div><div class="sh-t"><b>'+title+'</b><span>'+fmtWhen(r.at)+'</span></div><div class="sh-a '+cls+'">'+amt+' <i>⭐</i></div></div>';
    }).join('');
    list.querySelectorAll('.sh-row[data-g]').forEach(el=>{if(el.dataset.g)el.onclick=()=>{closeHistory();openGiftPage(meId(),Number(el.dataset.g),el.dataset.k);};});
  };
  ov.querySelectorAll('#shTabs button').forEach(b=>b.onclick=()=>{tab=b.dataset.t;ov.querySelectorAll('#shTabs button').forEach(x=>x.classList.toggle('on',x===b));draw();});
  histUnsub=db.collection('users').doc(meId()).collection('txs').orderBy('at','desc').limit(100).onSnapshot(s=>{rows=s.docs.map(d=>d.data());draw();},()=>{rows=[];draw();});
}



/* ===== إهداء هدية لمستخدم: تنتقل الملكية له وتوصله رسالة كارت بالمحادثة ===== */
function closeSend(){document.getElementById('giftSend')?.remove();}
async function transferGift(g,to){
  const K=gk(g.k),me=meId(),now=Date.now(),id=gid(K,g.number);
  const cref=db.collection('chats').doc([me,to].sort().join('__'));
  const cs=await cref.get();
  if(cs.exists)await cref.update({updatedAt:now});else await cref.set({participants:[me,to],updatedAt:now});
  const doc={number:g.number,upgraded:!!g.upgraded,at:g.at||now};
  if(K.gen)doc.k=K.key;
  const msg={senderId:me,type:'gift',k:K.key,number:g.number,upgraded:!!g.upgraded,to:to,text:'🎁 هدية '+K.name+' #'+g.number,createdAt:now,read:false};
  if(g.upgraded){doc.model=g.model;doc.bg=g.bg;doc.sym=g.sym;msg.model=g.model;msg.bg=g.bg;msg.sym=g.sym;}
  const b=db.batch();
  b.delete(db.collection('users').doc(me).collection(K.coll).doc(id));
  b.set(db.collection('users').doc(to).collection(K.coll).doc(id),doc);
  b.update(db.collection(K.gen?'giftSales':K.sales).doc(id),{ownerId:to});
  b.set(evRef(K,g.number),{k:K.key,number:g.number,coll:K.coll,type:'send',from:me,to:to,at:now});
  b.set(cref.collection('messages').doc(),msg);
  await b.commit();
}
async function openSendGift(){
  const to=currentChatOtherUserId,me=meId();
  if(!to||to===me)return showToast('افتح بروفايل المستخدم أولاً');
  const toName=String((document.getElementById('otherHeaderNameText')||{}).textContent||'مستخدم').trim();
  closeSend();
  const ov=document.createElement('div');ov.id='giftSend';ov.className='gp-ov';uiRoot().appendChild(ov);
  const top='<div class="gx-top"><button type="button" class="gx-ib" id="gsBack" aria-label="رجوع">'+IC_BACK+'</button><div class="gx-title"><b>إهداء هدية</b></div></div>';
  ov.innerHTML=top+'<div class="sg-sub">جاري التحميل…</div>';
  ov.querySelector('#gsBack').onclick=closeSend;
  await GIFTS_READY;
  if(!document.getElementById('giftSend'))return;
  const items=[];
  try{
    const kinds=Object.values(GIFT_KINDS),colls=[...new Set(kinds.map(K=>K.coll))];
    const snaps=await Promise.all(colls.map(c=>db.collection('users').doc(me).collection(c).get()));
    snaps.forEach((sn,i)=>{
      const c=colls[i],legacy=kinds.find(K=>K.coll===c&&!K.gen);
      sn.docs.forEach(d=>{const x=d.data(),key=c==='gifts'?x.k:(legacy&&legacy.key);if(key&&GIFT_KINDS[key])items.push(Object.assign({},x,{k:key}));});
    });
  }catch(e){console.error(e);}
  items.sort((a,b)=>(b.at||0)-(a.at||0));
  const listed=new Set();
  try{(await db.collection('giftListings').where('sellerId','==',me).get()).forEach(d=>listed.add(d.id));}catch(e){}
  ov.querySelector('#gsBack').onclick=closeSend;
  if(!items.length){ov.innerHTML=top+'<div class="sg-sub">ما عندك هدايا لتهديها. اشتر هدية من المتجر أولاً.</div>';ov.querySelector('#gsBack').onclick=closeSend;return;}
  ov.innerHTML=top+'<div class="sg-sub">اختر هدية لإرسالها إلى <b>'+esc(toName)+'</b></div><div id="gsGrid" class="posts-grid gifts-grid"></div><div class="gs-bar"><button type="button" class="gs-send" id="gsSend" disabled>اختر هدية</button></div>';
  ov.querySelector('#gsBack').onclick=closeSend;
  const grid=ov.querySelector('#gsGrid'),btn=ov.querySelector('#gsSend');let sel=null,sending=false;
  items.forEach(g=>{
    const t=giftArt(g,{still:true,cls:'gift-tile'});
    t.insertAdjacentHTML('beforeend','<div class="gt-n">#'+g.number+'</div>');
    if(listed.has(g.k+'_'+g.number)){
      t.classList.add('gs-listed');t.insertAdjacentHTML('beforeend','<div class="rs-mine">معروضة</div>');
      t.onclick=()=>showToast('هذه الهدية معروضة للبيع، ألغِ العرض أولاً');
      grid.appendChild(t);return;
    }
    t.onclick=()=>{
      grid.querySelectorAll('.gs-sel').forEach(x=>x.classList.remove('gs-sel'));
      t.classList.add('gs-sel');sel=g;btn.disabled=false;btn.textContent='إرسال '+gk(g.k).name+' #'+g.number;
    };
    grid.appendChild(t);
  });
  btn.onclick=async()=>{
    if(!sel||sending)return;
    const K=gk(sel.k);
    const r=await clAsk({title:'إرسال الهدية',icon:'gift',body:'إرسال <b>'+esc(K.name)+' #'+sel.number+'</b> إلى <b>'+esc(toName)+'</b>؟ تصير ملكه ولا ترجع إلك.',buttons:[{text:'إرسال'},{text:'إلغاء',cls:'cl-cancel'}]});
    if(!r||r.i!==0)return;
    sending=true;btn.disabled=true;btn.textContent='جاري الإرسال…';
    try{await transferGift(sel,to);showToast('🎁 وصلت الهدية إلى '+toName);closeSend();}
    catch(e){console.error(e);showToast('تعذر إرسال الهدية');sending=false;btn.disabled=false;btn.textContent='إرسال '+K.name+' #'+sel.number;}
  };
}
/* كارت الهدية داخل المحادثة */
function giftMsgNode(m,id,isMine){
  const K=GIFT_KINDS[m.k]||GIFT_KINDS.pepe;
  const other=String((document.getElementById('otherHeaderNameText')||{}).textContent||'').trim();
  const myName=(typeof currentUserData!=='undefined'&&currentUserData&&currentUserData.displayName)||'أنت';
  const from=isMine?myName:other;
  const who=other?(' <b>'+esc(other)+'</b>'):'';
  const line=isMine?('أنت أهديت'+who+' هدية'):('أهداك'+who+' هدية');
  const g={k:K.key,number:m.number,upgraded:!!m.upgraded,model:m.model,bg:m.bg,sym:m.sym};
  const up=g.upgraded&&K.models[g.model]&&PEPE_BGS[g.bg]&&PEPE_SYMS[g.sym];
  const w=document.createElement('div');w.className='gm-wrap';w.id='message_'+id;w.dataset.created=String(m.createdAt||0);
  const row=(a,b)=>'<div class="gg-row"><span>'+a+'</span><b>'+esc(b)+'</b></div>';
  w.innerHTML='<div class="sys-msg">'+line+'</div>'
    +'<div class="gg-card" style="background:'+bgCss(g)+'">'+(up?patSvg(g.sym):'')
    +'<div class="gg-art"><img alt="" src="'+thumbUrl(g)+'"></div>'
    +'<div class="gg-from">هدية من <b>'+esc(from||'مستخدم')+'</b></div>'
    +'<div class="gg-title">'+esc(K.name)+' #'+g.number+'</div>'
    +(up?row('النموذج',K.models[g.model].n)+row('الخلفية',PEPE_BGS[g.bg].n)+row('الرمز',PEPE_SYMS[g.sym].n):'')
    +'<button type="button" class="gg-btn">عرض</button></div>';
  const im=w.querySelector('.gg-art img');im.onerror=()=>{im.onerror=null;im.src=thumbLocal(g);};
  w.querySelector('.gg-btn').onclick=ev=>{ev.stopPropagation();openGiftPage(m.to||meId(),m.number,K.key);};
  return w;
}


/* ===== سوق الهدايا المُرقّاة: بيع وشراء بالنجوم ===== */
async function refreshGP(ov){
  const c=ov&&ov._ctx;if(!c||!document.getElementById('giftPage'))return;
  const K=gk(c.g.k);let lst=null;
  try{const ld=await db.collection('giftListings').doc(listId(K,c.g.number)).get();if(ld.exists)lst=ld.data();}catch(e){}
  renderGiftPage(ov,c.uid,c.g,c.issued,false,lst);
}
async function sellGift(ov,g,old){
  const K=gk(g.k),me=meId();
  const fl=await floorFor(K);
  const r=await clAsk({title:old?'تعديل السعر 🏷️':'بيع الهدية 🏷️',body:'اكتب السعر بالنجوم لـ <b>'+esc(K.name)+' #'+g.number+'</b><br><small>عمولة السوق '+FEE_PCT+'% · تستلم '+(100-FEE_PCT)+'% من السعر'+(fl!=null?'<br>أرخص عرض حالياً لهذا النوع: ⭐ '+fmtN(fl):'')+'</small>',input:{value:old?String(old.price):'',placeholder:'السعر بالنجوم',max:7},buttons:[{text:old?'حفظ':'عرض للبيع'},{text:'إلغاء',cls:'cl-cancel'}]});
  if(!r||r.i!==0)return;
  const price=parseInt(String(r.value).replace(/[^\d]/g,''),10);
  if(!price||price<1||price>1000000)return showToast('اكتب سعراً بين 1 و 1,000,000');
  try{
    const ref=db.collection('giftListings').doc(listId(K,g.number));
    if(old)await ref.update({price});
    else await ref.set({k:K.key,number:g.number,coll:K.coll,sellerId:me,price,at:Date.now(),giftAt:g.at||0,model:g.model,bg:g.bg,sym:g.sym,name:K.name});
    _lc.t=0;
    showToast(old?'تم تحديث السعر':'🏷️ انعرضت للبيع بـ '+fmtN(price)+' ⭐ · تستلم '+fmtN(netOf(price)));
    refreshGP(ov);
  }catch(e){console.error(e);showToast('تعذر عرض الهدية للبيع');}
}
async function unlistGift(ov,g){
  const K=gk(g.k);
  const r=await clAsk({title:'إلغاء العرض',body:'تريد تلغي بيع <b>'+esc(K.name)+' #'+g.number+'</b>؟',buttons:[{text:'إلغاء العرض'},{text:'رجوع',cls:'cl-cancel'}]});
  if(!r||r.i!==0)return;
  try{await db.collection('giftListings').doc(listId(K,g.number)).delete();_lc.t=0;showToast('تم إلغاء العرض');refreshGP(ov);}
  catch(e){console.error(e);showToast('تعذر إلغاء العرض');}
}
async function buyListing(ov,l){
  if(buying||!l)return;
  const K=gk(l.k),me=meId(),dev=isDevUser();
  if(l.sellerId===me)return;
  if(!dev&&myStars<l.price)return showToast('رصيدك غير كافٍ ⭐');
  const r=await clAsk({title:'شراء الهدية',icon:'cart',body:'شراء <b>'+esc(K.name)+' #'+l.number+'</b> بـ <b>'+fmtN(l.price)+' ⭐</b>؟ النجوم تروح لصاحبها وتصير الهدية إلك.',buttons:[{text:'شراء'},{text:'إلغاء',cls:'cl-cancel'}]});
  if(!r||r.i!==0)return;
  buying=true;
  const btn=document.getElementById('gpBuy');if(btn){btn.disabled=true;btn.textContent='جاري الشراء…';}
  try{
    await giftApi('buy-listing',{kind:K.key,number:l.number});
    _lc.t=0;
    showToast('🎉 مبروك! صارت '+K.name+' #'+l.number+' إلك');
    buying=false;
    closeGiftPage();closeStore();openGiftPage(me,l.number,K.key);
    return;
  }catch(e){
    console.error(e);
    showToast(e.code==='funds'?'رصيدك غير كافٍ ⭐':e.code==='gone'?'العرض تغيّر أو انباع':'ما تم الشراء، يمكن أحد سبقك');
    const b2=document.getElementById('gpBuy');if(b2){b2.disabled=false;b2.textContent='🛒 شراء بـ ⭐ '+fmtN(l.price);}
  }
  buying=false;
}
/* ===== سجل الهدية + أرخص سعر + فلتر النوع ===== */
async function loadGiftHistory(ov,K,g){
  const body=ov.querySelector('.gp-body');if(!body)return;
  const box=document.createElement('div');box.className='gp-hist';
  box.innerHTML='<div class="gp-hh">سجل الهدية</div><div class="gp-hl"><div class="gp-hn">جاري التحميل…</div></div>';
  body.appendChild(box);
  let evs=[];
  try{evs=(await db.collection('giftEvents').doc(listId(K,g.number)).collection('log').orderBy('at','desc').limit(20).get()).docs.map(d=>d.data());}catch(e){}
  const ids=[...new Set(evs.flatMap(e=>[e.from,e.to].filter(Boolean)))];
  try{if(ids.length)await loadUsers(ids);}catch(e){}
  if(!ov.contains(box))return;
  const nm=id=>'<b>'+esc((GU[id]&&GU[id].displayName)||'مستخدم')+'</b>';
  const list=box.querySelector('.gp-hl');
  if(!evs.length){list.innerHTML='<div class="gp-hn">ما كو سجل لهذه الهدية (قبل تفعيل السجل).</div>';return;}
  list.innerHTML=evs.map(e=>{
    let ic='🎁',t='';
    if(e.type==='mint'){t='اشتراها '+nm(e.to)+' من المتجر'+(e.price?' بـ ⭐ '+fmtN(e.price):'');}
    else if(e.type==='send'){ic='📤';t='أهداها '+nm(e.from)+' إلى '+nm(e.to);}
    else{ic='🛒';t='باعها '+nm(e.from)+' إلى '+nm(e.to)+' بـ ⭐ '+fmtN(e.price||0);}
    return '<div class="gp-he"><span class="gp-hi">'+ic+'</span><div><div>'+t+'</div><small>'+fmtWhen(e.at)+'</small></div></div>';
  }).join('');
}
async function floorFor(K){
  try{const s=await db.collection('giftListings').where('k','==',K.key).get();let m=null;s.forEach(d=>{const p=d.data().price;if(m===null||p<m)m=p;});return m;}catch(e){return null;}
}
let _lc={t:0,list:null,p:null};
async function getListings(){
  if(_lc.list&&Date.now()-_lc.t<45000)return _lc.list;
  if(_lc.p)return _lc.p;
  _lc.p=db.collection('giftListings').orderBy('at','desc').limit(200).get().then(sn=>{_lc.list=sn.docs.map(d=>d.data());_lc.t=Date.now();_lc.p=null;return _lc.list;}).catch(e=>{_lc.p=null;throw e;});
  return _lc.p;
}
/* أرخص سعر مطورة تحت كل كرت بتبويب "هدايا جديدة" */
async function paintFloors(ov){
  try{
    const list=await getListings(),fl={};
    list.forEach(l=>{if(fl[l.k]==null||l.price<fl[l.k])fl[l.k]=l.price;});
    ov.querySelectorAll('.sg-card').forEach(c=>{const f=fl[c.dataset.k],e=c.querySelector('.sg-floor');if(e&&f!=null)e.textContent='🏷️ مطورة من '+fmtN(f);});
  }catch(e){}
}
/* تبويب "هدايا مطورة" بالمتجر */
const resaleState={sort:'new',kind:''};
async function loadResale(box){
  box.innerHTML='<div class="sg-sub">جاري التحميل…</div>';
  let all=[];
  try{all=await getListings();}catch(e){console.error(e);box.innerHTML='<div class="sg-sub">تعذر تحميل العروض</div>';return;}
  const me=meId(),st=resaleState;
  const stat={};all.forEach(l=>{const o=stat[l.k]||(stat[l.k]={n:0,min:Infinity});o.n++;if(l.price<o.min)o.min=l.price;});
  if(st.kind&&!stat[st.kind])st.kind='';
  let list=all.filter(l=>!st.kind||l.k===st.kind);
  list=list.slice().sort((a,b)=>st.sort==='low'?a.price-b.price:st.sort==='high'?b.price-a.price:(b.at||0)-(a.at||0));
  const sorts=[['new','الأحدث'],['low','الأرخص'],['high','الأغلى']].map(x=>'<button type="button" class="rs-chip'+(x[0]===st.sort?' on':'')+'" data-s="'+x[0]+'">'+x[1]+'</button>').join('');
  const kinds=Object.keys(stat).sort((a,b)=>stat[b].n-stat[a].n).map(k=>'<button type="button" class="rs-chip'+(k===st.kind?' on':'')+'" data-k="'+k+'">'+esc(GIFT_KINDS[k]?GIFT_KINDS[k].name:k)+' · '+stat[k].n+'</button>').join('');
  const floor=st.kind?'<div class="rs-floor">أرخص سعر: ⭐ '+fmtN(stat[st.kind].min)+' · '+stat[st.kind].n+' معروضة</div>':'';
  box.innerHTML='<div class="rs-chips">'+sorts+'</div>'
    +(kinds?'<div class="rs-chips"><button type="button" class="rs-chip'+(st.kind?'':' on')+'" data-k="">الكل · '+all.length+'</button>'+kinds+'</div>':'')
    +floor
    +(list.length?'<div class="rs-grid"></div>':'<div class="sg-sub">ما كو هدايا مطورة معروضة هسه</div>');
  box.querySelectorAll('[data-s]').forEach(c=>c.onclick=()=>{st.sort=c.dataset.s;loadResale(box);});
  box.querySelectorAll('[data-k]').forEach(c=>c.onclick=()=>{st.kind=c.dataset.k;loadResale(box);});
  const grid=box.querySelector('.rs-grid');if(!grid)return;
  list.forEach(l=>{
    const K=GIFT_KINDS[l.k];if(!K)return;
    const g={k:K.key,number:l.number,upgraded:true,model:l.model,bg:l.bg,sym:l.sym};
    const card=document.createElement('div');card.className='rs-card';
    const t=giftArt(g,{still:true,cls:'gift-tile'});
    t.insertAdjacentHTML('beforeend','<div class="gt-n">#'+l.number+'</div>'+(l.sellerId===me?'<div class="rs-mine">عرضك</div>':''));
    card.appendChild(t);
    card.insertAdjacentHTML('beforeend','<div class="sg-name">'+esc(K.name)+'</div><div class="sg-price">⭐ '+fmtN(l.price)+'</div>');
    card.onclick=()=>openGiftPage(l.sellerId,l.number,K.key);
    grid.appendChild(card);
  });
}
/* رسالة "انباعت هديتك" بالمحادثة */
function soldMsgNode(m,id,isMine){
  const K=GIFT_KINDS[m.k]||GIFT_KINDS.pepe;
  const w=document.createElement('div');w.className='sys-msg';w.id='message_'+id;w.dataset.created=String(m.createdAt||0);
  w.innerHTML=isMine?('🛒 اشتريت <b>'+esc(K.name)+' #'+m.number+'</b> بـ ⭐ '+fmtN(m.price||0))
                   :('🛒 اشترى هديتك <b>'+esc(K.name)+' #'+m.number+'</b> بـ ⭐ '+fmtN(m.price||0)+' · استلمت ⭐ '+fmtN(m.net||0));
  return w;
}
