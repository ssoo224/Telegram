/* ===== star-gift.js — هدية النجوم (المطور يهدي) + كارتها بالمحادثة ===== */
/* يعتمد على gifts.js (fmtN, openStarsHistory, isDevUser, meId) */

/* إهداء نجوم: لكل المستخدمين. الرصيد يتحقق منه الخادم، والمستلم ياخذ 95% (عمولة 5%) */
async function devGiftStars(target){
  const to=(typeof target==='string'&&target)?target:currentChatOtherUserId,me=meId();
  if(!to||!me||to===me)return;
  const dev=isDevUser();
  const toName=(typeof GU!=='undefined'&&GU[to]&&GU[to].displayName)||(document.getElementById('otherHeaderNameText')||{}).textContent||'مستخدم';
  const body=dev?('كم نجمة تريد إهداءها إلى <b>'+esc(toName)+'</b>؟')
    :('رصيدك: <b>'+fmtN(myStars)+'</b> ⭐<br>كم نجمة تريد إهداءها إلى <b>'+esc(toName)+'</b>؟<br><small>ينخصم المبلغ من رصيدك، ويستلم 95% منه (عمولة '+FEE_PCT+'%).</small>');
  const r=await clAsk({title:'إهداء نجوم ⭐',body:body,input:{value:'',placeholder:dev?'عدد النجوم':('حتى '+fmtN(myStars)),max:9},buttons:[{text:'إهداء'},{text:'إلغاء',cls:'cl-cancel'}]});
  if(!r||r.i!==0)return;
  const n=parseInt(String(r.value).replace(/[^\d]/g,''),10);
  if(!n||n<2||n>1000000)return showToast('اكتب عدداً بين 2 و 1,000,000');
  if(!dev&&n>myStars)return showToast('رصيدك لا يكفي (رصيدك '+fmtN(myStars)+' ⭐)');
  try{
    const res=await giftApi('send-stars',{to:to,amount:n});
    showToast(dev?('تم إهداء '+fmtN(n)+' ⭐ إلى '+toName):('تم الإهداء ✅ وصل '+fmtN(res&&res.net!=null?res.net:n)+' ⭐ إلى '+toName+' بعد العمولة'));
  }catch(e){
    console.error(e);
    const m={funds:'رصيدك لا يكفي',blocked:'ما تكدر تهدي هذا المستخدم',nouser:'المستخدم غير موجود',rate:'انتظر شوي وحاول مرة ثانية',bad:'المبلغ غير صحيح'};
    showToast(m[e.code]||'تعذر إهداء النجوم');
  }
}

/* رسم الكارت البابلي: نجمة عشتار ذهبية داخل ميدالية لازورد */
function _gmDefs(){
  if(document.getElementById('gmDefs'))return;
  const d=document.createElement('div');d.id='gmDefs';d.style.cssText='position:absolute;width:0;height:0;overflow:hidden';
  d.innerHTML='<svg width="0" height="0"><defs>'
   +'<radialGradient id="gmGold" cx="50%" cy="40%" r="65%"><stop offset="0" stop-color="#fff6c2"/><stop offset=".5" stop-color="#f2c84e"/><stop offset="1" stop-color="#a8741a"/></radialGradient>'
   +'<radialGradient id="gmLapis" cx="50%" cy="40%" r="65%"><stop offset="0" stop-color="#2d63c9"/><stop offset="1" stop-color="#0c2158"/></radialGradient>'
   +'<radialGradient id="gmHalo" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffe9a0" stop-opacity=".75"/><stop offset="1" stop-color="#ffe9a0" stop-opacity="0"/></radialGradient>'
   +'</defs></svg>';
  document.body.appendChild(d);
}
function _gmStarPts(cx,cy,rLong,rShort,rIn){
  /* 16 رأس: 4 أشعة طويلة (عمودية) + 4 متوسطة (قطرية) بينها فجوات داخلية = نجمة عشتار ثمانية */
  const p=[];
  for(let k=0;k<8;k++){
    const a=Math.PI*k/4-Math.PI/2,b=a+Math.PI/8,r=(k%2===0)?rLong:rShort;
    p.push([cx+r*Math.cos(a),cy+r*Math.sin(a)]);
    p.push([cx+rIn*Math.cos(b),cy+rIn*Math.sin(b)]);
  }
  return p.map(q=>q[0].toFixed(1)+','+q[1].toFixed(1)).join(' ');
}
function starGiftArt(){
  _gmDefs();
  let ros='';
  for(let k=0;k<16;k++){
    const a=2*Math.PI*k/16,x=100+58*Math.cos(a),y=76+58*Math.sin(a);
    ros+='<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="'+(k%2?1.7:2.6)+'" fill="'+(k%2?'#7fb2ff':'#f2c84e')+'"/>';
  }
  const sp=[[34,34],[168,40],[28,112],[174,112]].map((q,i)=>'<path class="gm-sp" d="M'+q[0]+' '+(q[1]-6)+'L'+(q[0]+1.8)+' '+(q[1]-1.8)+'L'+(q[0]+6)+' '+q[1]+'L'+(q[0]+1.8)+' '+(q[1]+1.8)+'L'+q[0]+' '+(q[1]+6)+'L'+(q[0]-1.8)+' '+(q[1]+1.8)+'L'+(q[0]-6)+' '+q[1]+'L'+(q[0]-1.8)+' '+(q[1]-1.8)+'Z" fill="#ffe9a0"/>').join('');
  return '<svg class="gm-art" viewBox="0 0 200 152" aria-hidden="true">'
    +'<circle class="gm-glow" cx="100" cy="76" r="74" fill="url(#gmHalo)"/>'
    +'<circle cx="100" cy="76" r="63" fill="url(#gmLapis)" stroke="#d9a93a" stroke-width="2.4"/>'
    +'<circle cx="100" cy="76" r="53" fill="none" stroke="#d9a93a" stroke-opacity=".55" stroke-width="1"/>'+ros
    +'<g class="gm-star"><polygon points="'+_gmStarPts(100,76,48,36,15)+'" fill="url(#gmGold)" stroke="#8a5d10" stroke-width=".8" stroke-linejoin="round"/>'
    +'<circle cx="100" cy="76" r="10.5" fill="url(#gmLapis)" stroke="#fff1b0" stroke-width="1.6"/><circle cx="100" cy="76" r="3.6" fill="#ffe9a0"/></g>'
    +sp+'</svg>';
}
/* عنصر الرسالة: شريط "أنت أهديت / أهداك" + الكارت */
function starGiftNode(m,id,isMine){
  const nm=String((document.getElementById('otherHeaderNameText')||{}).textContent||'').trim();
  const who=nm?(' <b>'+esc(nm)+'</b>'):'';
  const line=isMine?('أنت أهديت'+who+' هدية'):('أهداك'+who+' هدية');
  const w=document.createElement('div');w.className='gm-wrap';w.id='message_'+id;w.dataset.created=String(m.createdAt||0);
  const pill='<div class="sys-msg">'+line+'</div>';
  w.innerHTML=pill
    +'<div class="gm-card"><div class="gm-frieze"></div>'+starGiftArt()
    +'<div class="gm-amt">'+fmtN((isMine&&m.gross)?m.gross:(m.stars||0))+' نجمة</div>'
    +'<div class="gm-sub">'+((isMine&&m.fee>0)?('وصل '+fmtN(m.stars||0)+' ⭐ بعد عمولة '+fmtN(m.fee)+' ⭐'):'بالنجوم تفتح المحتوى والخدمات داخل بابل.')+'</div>'
    +'<button type="button" class="gm-btn">عرض</button><div class="gm-frieze bot"></div></div>';
  /* sys-msg عادةً نص عادي؛ نخلي الاسم غامق */
  w.querySelector('.gm-btn').onclick=ev=>{ev.stopPropagation();try{openStarsHistory();}catch(e){}};
  return w;
}
/* احتياط للأماكن القديمة اللي تستدعي starGiftHtml */
function starGiftHtml(m){return '<div class="msg-text">🎁 '+fmtN(m.stars||0)+' نجمة</div>';}
