let resendCooldown = false;
function resendVerification() {
  const u = auth.currentUser, btn = document.getElementById('resendBtn');
  if (!u || resendCooldown) return;
  resendCooldown = true;
  
  sendVerification(u).then(() => {
    showToast('أرسلنا الرابط من جديد');
  }).catch(e => {
    if (e && e.code === 'auth/too-many-requests') {
      showToast('محاولات كثيرة، يرجى الانتظار قليلاً');
    } else {
      showToast('تعذر الإرسال');
    }
  });

  let n = 60; // تحديد وقت الانتظار بـ 60 ثانية
  const t = setInterval(() => {
    btn.textContent = 'إعادة الإرسال (' + n + ')';
    if (--n < 0) {
      clearInterval(t);
      resendCooldown = false;
      btn.textContent = 'إعادة إرسال الرابط';
    }
  }, 1000);
}
