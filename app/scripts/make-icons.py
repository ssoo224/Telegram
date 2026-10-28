# يولّد أيقونة أندرويد Adaptive تملأ الدائرة بدل ما تطلع صغيرة
from PIL import Image
import numpy as np, os

S = 1024          # حجم الكانفاس
FG = 0.70         # حجم الأيقونة داخل الكانفاس (المنطقة الآمنة ~ 0.66، ارفعه/نزّله حسب رغبتك)

im = Image.open('../icon-512.png').convert('RGBA')
bbox = im.getchannel('A').getbbox()
if bbox:
    im = im.crop(bbox)          # نشيل أي فراغ شفاف حول الأيقونة
os.makedirs('assets', exist_ok=True)

# 1) الأيقونة القديمة (legacy) ملء كامل
im.resize((S, S), Image.LANCZOS).save('assets/icon-only.png')

# 2) الـ foreground: الأيقونة بالنص بحجم FG
n = int(S * FG)
fg = Image.new('RGBA', (S, S), (0, 0, 0, 0))
fg.alpha_composite(im.resize((n, n), Image.LANCZOS), ((S - n) // 2, (S - n) // 2))
fg.save('assets/icon-foreground.png')

# 3) الـ background: تدرّج ذهبي مأخوذ من ألوان زوايا الأيقونة نفسها
a = np.asarray(im.convert('RGB').resize((100, 100), Image.LANCZOS)).astype(float)
c = lambda y, x: a[y-2:y+3, x-2:x+3].mean((0, 1))
tl, tr, bl, br = c(8, 8), c(8, 91), c(91, 8), c(91, 91)
p = np.linspace(0, 1, S)
w = np.clip(((p - (1 - FG) / 2) / FG - 0.08) / 0.84, 0, 1)
u = w[None, :, None]; v = w[:, None, None]
bg = (tl*(1-u) + tr*u)*(1-v) + (bl*(1-u) + br*u)*v
Image.fromarray(bg.astype('uint8'), 'RGB').save('assets/icon-background.png')
