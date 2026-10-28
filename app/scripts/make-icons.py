# يولّد أيقونة أندرويد Adaptive: خلفية ذهبية متدرجة + قلعة بيضاء بحجم مناسب
from PIL import Image
import numpy as np, os

S = 1024     # حجم الكانفاس
FG = 0.70    # حجم الأيقونة داخل الكانفاس (المنطقة الآمنة ~0.66)
 
# التدرج: من أعلى اليسار (فاتح) إلى أسفل اليمين (برونزي)
STOPS = [
    (0.00, '#FFE78D'),  # ذهبي فاتح
    (0.20, '#F6D468'),  # ذهبي كريمي
    (0.40, '#EBC151'),  # ذهبي ملكي
    (0.60, '#D09D30'),  # ذهبي متوسط
    (0.80, '#C28D25'),  # ذهبي داكن
    (1.00, '#A66E17'),  # ذهبي برونزي
]

def gradient(size):
    pos = [p for p, _ in STOPS]
    cols = np.array([[int(h[i:i+2], 16) for i in (1, 3, 5)] for _, h in STOPS], float)
    ax = np.linspace(0, 1, size)
    t = (ax[None, :] + ax[:, None]) / 2          # قطري: يسار-أعلى -> يمين-أسفل
    out = np.stack([np.interp(t, pos, cols[:, k]) for k in range(3)], -1)
    return Image.fromarray(out.astype('uint8'), 'RGB').convert('RGBA')

# استخراج القلعة البيضاء من icon-512.png (البكسلات الفاتحة جداً)
im = Image.open('../icon-512.png').convert('RGBA')
bbox = im.getchannel('A').getbbox()
if bbox:
    im = im.crop(bbox)
rgb = np.asarray(im.convert('RGB')).astype(float)
alpha = np.clip((rgb.min(-1) - 185) / 50, 0, 1) * (np.asarray(im.getchannel('A')) / 255)
castle = np.zeros((*alpha.shape, 4), 'uint8')
castle[..., :3] = 255
castle[..., 3] = (alpha * 255).astype('uint8')
castle = Image.fromarray(castle, 'RGBA')

os.makedirs('assets', exist_ok=True)
n = int(S * FG)
castle_big = castle.resize((n, n), Image.LANCZOS)
off = ((S - n) // 2, (S - n) // 2)

# foreground: القلعة فقط، شفافة الخلفية
fg = Image.new('RGBA', (S, S), (0, 0, 0, 0))
fg.alpha_composite(castle_big, off)
fg.save('assets/icon-foreground.png')

# background: التدرج الذهبي
bg = gradient(S)
bg.convert('RGB').save('assets/icon-background.png')

# legacy / icon-only: التدرج + القلعة
legacy = bg.copy()
legacy.alpha_composite(castle_big, off)
legacy.convert('RGB').save('assets/icon-only.png')
