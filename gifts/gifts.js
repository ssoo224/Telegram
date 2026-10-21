/* ===== gifts.js — هدايا Plush Pepe + المحفظة + المتجر ===== */
/* يُحمَّل بعد models.js وقبل star-gift.js. اقرأ gifts/README.md */
const PEPE_MAX=30, PEPE_PRICE=100, DEV_BIG=1000000000;
/* أنواع الهدايا: كل نوع له مجموعة بفايربيس + مبيعات + نماذج. نوع جديد = سطر هنا + قواعد firestore */
const GIFT_KINDS={
  pepe:{key:'pepe',name:'Plush Pepe',coll:'pepes',sales:'pepeSales',field:'lastBuy',max:30,price:100,dir:'models',models:PEPE_MODELS},
  cat:{key:'cat',name:'Scared Cat',coll:'cats',sales:'catSales',field:'lastBuyCat',max:30,price:100,dir:'cat-models',models:CAT_MODELS}
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
const _pepeTxt={};
async function pepeText(i,kind){
  const K=gk(kind),key=K.key+':'+i;
  if(_pepeTxt[key])return _pepeTxt[key];
  const f=i<0?'original':K.models[i].f;
  const r=await fetch(GIFTS_BASE+K.dir+'/'+f+'.tgs');
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
function thumbUrl(g){
  const K=gk(g.k),f=g.upgraded?K.models[g.model].f:'original';
  return GIFTS_BASE+K.dir+'/thumbs/'+f+'.webp';
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
    im.src=thumbUrl(g);holder.appendChild(im);
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
  const unsubs=Object.values(GIFT_KINDS).map(K=>{
    data[K.key]=[];
    return db.collection('users').doc(uid).collection(K.coll).onSnapshot(snap=>{
      data[K.key]=snap.docs.map(d=>Object.assign({k:K.key},d.data()));draw();
    },()=>{data[K.key]=[];draw();});
  });
  giftGridUnsub[gridId]=()=>unsubs.forEach(u=>u());
}

/* ---------- صفحة تفاصيل الهدية (مثل تليجرام) ---------- */
let gpUnsub=null;
function closeGiftPage(){if(gpUnsub){gpUnsub();gpUnsub=null;}document.getElementById('giftPage')?.remove();}
const IC_BACK='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';
async function openGiftPage(uid,n,kind){
  const K=gk(kind);
  closeGiftPage();
  const ov=document.createElement('div');ov.id='giftPage';ov.className='gp-ov';uiRoot().appendChild(ov);
  ov.innerHTML='<div class="gp-hero" style="background:'+bgCss({})+'"><div class="gp-top"><button type="button" class="gp-round" id="gpBack" aria-label="رجوع">'+IC_BACK+'</button></div></div>';
  ov.querySelector('#gpBack').onclick=closeGiftPage;
  const issuedP=db.collection(K.sales).get().then(s=>s.size).catch(()=>null);
  await loadUsers([uid]);
  const issued=await issuedP;
  if(!document.getElementById('giftPage'))return;
  gpUnsub=db.collection('users').doc(uid).collection(K.coll).doc(String(n)).onSnapshot(doc=>{
    if(!doc.exists){closeGiftPage();showToast('هذه الهدية غير موجودة');return;}
    renderGiftPage(ov,uid,Object.assign({k:K.key},doc.data()),issued);
  },()=>{closeGiftPage();});
}
function gpRow(k,v){return '<div class="gp-row"><div class="gp-k">'+k+'</div><div class="gp-v">'+v+'</div></div>';}
function renderGiftPage(ov,uid,g,issued,reveal){
  const K=gk(g.k);
  const up=!!g.upgraded,me=meId(),mine=uid===me,m=up?K.models[g.model]:null,b=up?PEPE_BGS[g.bg]:null,s=up?PEPE_SYMS[g.sym]:null;
  const u=GU[uid]||{};
  const ownerV='<div class="gp-owner" id="gpOwner">'+userAvHtml(uid,'gp-oav')+'<span>'+esc(u.displayName||'مستخدم')+(mine?' <em>(أنت)</em>':'')+'</span></div>';
  const lock='<span class="gp-lock">غير مُرقّاة</span>';
  ov.innerHTML='<div class="gp-hero'+(reveal?' reveal':'')+'" id="gpHero" style="background:'+bgCss(g)+'">'+(up?patSvg(g.sym):'')
    +'<div class="gp-top"><button type="button" class="gp-round" id="gpBack" aria-label="رجوع">'+IC_BACK+'</button></div>'
    +'<div class="gp-pepe"'+(up?'':' style="filter:grayscale(1) brightness(.8)"')+'></div>'
    +'<div class="gp-title">'+K.name+' <span>#'+g.number+'</span></div>'
    +'<div class="gp-chip" id="gpChip">'+(up?'نسخة '+g.number+' من '+K.max:'هدية بانتظار الترقية')+'</div></div>'
    +'<div class="gp-body"><div class="gp-table">'
    +gpRow('المالك',ownerV)
    +gpRow('النموذج',up?esc(m.n)+'<span class="gp-pill">'+(m.p/10)+'%</span>':lock)
    +gpRow('الرمز',up?esc(s.n)+'<span class="gp-pill">'+s.p+'%</span>':lock)
    +gpRow('الخلفية',up?esc(b.n)+'<span class="gp-pill">'+b.p+'%</span>':lock)
    +gpRow('الكمية',(issued!=null?issued:'—')+'/'+K.max+' صادرة')
    +'</div>'
    +(mine&&!up?'<button type="button" class="gp-cta" id="gpUp">✨ ترقية الهدية مجاناً</button><div class="gp-note">ستحصل على نموذج وخلفية ورمز عشوائي، وبعضها نادر جداً.</div>':'')
    +'</div>';
  ov.querySelector('#gpBack').onclick=closeGiftPage;
  mountPepeAnim(ov.querySelector('.gp-pepe'),up?g.model:-1,{kind:g.k});
  ov.querySelector('#gpOwner').onclick=()=>{
    if(mine){closeGiftPage();openProfile();return;}
    db.collection('users').doc(uid).get().then(d=>{if(d.exists){closeGiftPage();openUserProfileDirect(Object.assign({id:uid},d.data()));}});
  };
  const upb=ov.querySelector('#gpUp');if(upb)upb.onclick=()=>doUpgrade(ov,uid,g);
}
let upgrading=false;
async function doUpgrade(ov,uid,g){
  if(upgrading)return;upgrading=true;
  const K=gk(g.k);
  const res={model:wpick(K.models),bg:wpick(PEPE_BGS),sym:wpick(PEPE_SYMS)};
  const hero=ov.querySelector('#gpHero'),btn=ov.querySelector('#gpUp'),chip=ov.querySelector('#gpChip');
  if(btn){btn.disabled=true;btn.textContent='جاري الترقية…';}
  hero.classList.add('rolling');
  let pat=hero.querySelector('.ga-pat');
  if(!pat){hero.insertAdjacentHTML('afterbegin',patSvg(0));pat=hero.querySelector('.ga-pat');}
  const steps=24;
  for(let i=0;i<steps;i++){
    const last=i===steps-1,bi=last?res.bg:Math.floor(Math.random()*5),si=last?res.sym:Math.floor(Math.random()*5);
    hero.style.background=bgCss({upgraded:true,bg:bi});
    pat.innerHTML=patInner(si);
    if(chip)chip.textContent=PEPE_BGS[bi].n+' · '+PEPE_SYMS[si].n;
    await sleep(60+i*i*0.55);
  }
  await sleep(250);
  try{
    await db.collection('users').doc(uid).collection(K.coll).doc(String(g.number)).update({upgraded:true,model:res.model,bg:res.bg,sym:res.sym});
    showToast('✨ تمت الترقية: '+K.models[res.model].n);
    const doc=ov.querySelector('#gpHero');if(doc)doc.classList.add('reveal');
  }catch(e){console.error(e);showToast('تعذرت الترقية');hero.classList.remove('rolling');renderGiftPage(ov,uid,g,null);}
  upgrading=false;
}

/* ---------- متجر الهدايا ---------- */
let storeKind='pepe';
function closeStore(){document.getElementById('giftStore')?.remove();clearInterval(window.__storeTimer);}
async function openGiftStore(kind){
  if(typeof kind==='string')storeKind=kind;
  closeStore();
  const K=gk(storeKind);
  const ov=document.createElement('div');ov.id='giftStore';ov.className='gp-ov st-ov';uiRoot().appendChild(ov);
  ov.innerHTML='<div class="gx-top"><button type="button" class="gx-ib" id="stBack" aria-label="رجوع">'+IC_BACK+'</button><div class="gx-title"><b>متجر الهدايا</b></div></div>'
    +'<div class="sh-tabs st-kinds">'+Object.values(GIFT_KINDS).map(x=>'<button type="button" class="'+(x.key===K.key?'on':'')+'" data-k="'+x.key+'">'+x.name+'</button>').join('')+'</div>'
    +'<div class="st-body"><div class="st-hero" id="stHero"></div>'
    +'<div class="st-title">'+K.name+'</div><div class="st-sub" id="stSub">نسخ محدودة · '+K.max+' فقط</div>'
    +'<div class="gp-table st-table">'
    +gpRow('السعر',K.price+' ⭐')
    +gpRow('رصيدك','<b data-stars>'+starsLabel()+'</b> ⭐')
    +gpRow('الترقية','مجانية، نموذج وخلفية ورمز عشوائي')
    +'</div><button type="button" class="gp-cta" id="stBuy">شراء بـ '+K.price+' نجمة</button><div class="gp-note" id="stNote"></div></div>';
  ov.querySelector('#stBack').onclick=closeStore;
  ov.querySelectorAll('.st-kinds button').forEach(b=>b.onclick=()=>{if(b.dataset.k!==storeKind)openGiftStore(b.dataset.k);});
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
    const s=await db.collection(K.sales).get();
    const left=K.max-s.size,sub=ov.querySelector('#stSub'),btn=ov.querySelector('#stBuy');
    if(sub)sub.textContent='نسخة محدودة · المتبقي '+Math.max(0,left)+' من '+K.max;
    if(btn&&left<=0){btn.disabled=true;btn.textContent='نفدت الكمية';}
  }catch(e){}
}
let buying=false;
async function buyGift(kind){
  if(buying)return;
  const K=gk(kind),me=meId(),dev=isDevUser();
  if(!dev&&myStars<K.price)return showToast('رصيدك غير كافٍ ⭐');
  buying=true;
  const btn=document.getElementById('stBuy');if(btn){btn.disabled=true;btn.textContent='جاري الشراء…';}
  try{
    const snap=await db.collection(K.sales).get(),taken=new Set(snap.docs.map(d=>d.id));
    let n=0;for(let k=1;k<=K.max;k++)if(!taken.has(String(k))){n=k;break;}
    if(!n){showToast('نفدت الكمية');refreshStore();buying=false;return;}
    const wref=db.collection('wallets').doc(me),now=Date.now(),inc=firebase.firestore.FieldValue.increment;
    if(dev)await wref.set({stars:DEV_BIG},{merge:true});
    const b=db.batch();
    const wu={stars:inc(-K.price)};wu[K.field]=String(n);
    b.update(wref,wu);
    b.set(db.collection(K.sales).doc(String(n)),{ownerId:me,at:now});
    b.set(db.collection('users').doc(me).collection(K.coll).doc(String(n)),{number:n,upgraded:false,at:now});
    const tx={type:'buy',gift:n,stars:K.price,at:now};if(K.key!=='pepe')tx.kind=K.key;
    b.set(db.collection('users').doc(me).collection('txs').doc(),tx);
    await b.commit();
    if(dev)wref.set({stars:DEV_BIG},{merge:true}).catch(()=>{});
    showToast('🎉 اشتريت '+K.name+' #'+n);
    closeStore();openGiftPage(me,n,K.key);
  }catch(e){
    console.error(e);showToast('ممكن أحد سبقك، حاول مرة ثانية');refreshStore();
    const b2=document.getElementById('stBuy');if(b2){b2.disabled=false;b2.textContent='شراء بـ '+K.price+' نجمة';}
  }
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
  const tabs=[['all','الكل'],['buy','المشتريات'],['in','المستلمة']].concat(dev?[['out','المُهداة']]:[]);
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
      else if(r.type==='in'){ic='⭐';title='هدية نجوم من '+esc(r.fromName||'المطور');amt='+'+fmtN(r.stars);cls='pos';}
      else if(r.type==='out'){ic='📤';title='أهديت '+esc(r.toName||'مستخدم');amt=fmtN(r.stars);cls='out';}
      return '<div class="sh-row" data-g="'+(r.type==='buy'?r.gift:'')+'" data-k="'+(r.kind||'pepe')+'"><div class="sh-ic">'+ic+'</div><div class="sh-t"><b>'+title+'</b><span>'+fmtWhen(r.at)+'</span></div><div class="sh-a '+cls+'">'+amt+' <i>⭐</i></div></div>';
    }).join('');
    list.querySelectorAll('.sh-row[data-g]').forEach(el=>{if(el.dataset.g)el.onclick=()=>{closeHistory();openGiftPage(meId(),Number(el.dataset.g),el.dataset.k);};});
  };
  ov.querySelectorAll('#shTabs button').forEach(b=>b.onclick=()=>{tab=b.dataset.t;ov.querySelectorAll('#shTabs button').forEach(x=>x.classList.toggle('on',x===b));draw();});
  histUnsub=db.collection('users').doc(meId()).collection('txs').orderBy('at','desc').limit(100).onSnapshot(s=>{rows=s.docs.map(d=>d.data());draw();},()=>{rows=[];draw();});
}

