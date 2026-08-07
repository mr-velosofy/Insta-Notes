from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
W, H = 1536, 1024

GRAD = [(254, 218, 117), (250, 126, 30), (214, 41, 118), (150, 47, 191), (79, 91, 213)]


def font(size, italic=False):
    names = ["C:/Windows/Fonts/seguisb.ttf", "C:/Windows/Fonts/segoeuib.ttf",
             "C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/arial.ttf"]
    for n in names:
        p = Path(n)
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size)
            except OSError:
                continue
    return ImageFont.load_default()


def font_italic(size):
    for n in ["C:/Windows/Fonts/segoeuii.ttf", "C:/Windows/Fonts/segoeuib.ttf"]:
        p = Path(n)
        if p.exists():
            try:
                return ImageFont.truetype(str(p), size)
            except OSError:
                continue
    return ImageFont.load_default()


def gradient_fill(size, p1, p2):
    """Vertical gradient between two colors."""
    w, h = size
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / (h - 1)
        c = tuple(int(p1[i] + (p2[i] - p1[i]) * t) for i in range(3))
        d.line([(0, y), (w, y)], fill=c)
    return img


def insta_gradient(size):
    """Diagonal 5-stop Instagram gradient image."""
    w, h = size
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    stops = len(GRAD) - 1
    for y in range(h):
        for x in range(w):
            t = (x / (w - 1) + y / (h - 1)) / 2 * stops
            i = min(int(t), stops - 1)
            f = t - i
            c1, c2 = GRAD[i], GRAD[i + 1]
            c = tuple(int(c1[k] + (c2[k] - c1[k]) * f) for k in range(3))
            d.point((x, y), fill=c)
    return img


# --- base background ---
img = Image.new("RGB", (W, H), (12, 10, 26))
d = ImageDraw.Draw(img)
for y in range(H):
    t = y / (H - 1)
    c = (int(22 + 34 * t), int(16 + 28 * t), int(46 + 62 * t))
    d.line([(0, y), (W, y)], fill=c)

# soft brand blobs
blobs = Image.new("RGB", (W, H), (12, 10, 26))
bd = ImageDraw.Draw(blobs)
bd.ellipse([-180, -260, 420, 340], fill=(214, 41, 118))
bd.ellipse([880, 220, 1500, 780], fill=(79, 91, 213))
bd.ellipse([520, -160, 950, 300], fill=(150, 47, 191))
blobs = blobs.filter(ImageFilter.GaussianBlur(90))
img = Image.blend(img, blobs, 0.55)

# --- icon: rounded square with insta gradient + white waveform ---
icon_s = 132
grad = insta_gradient((icon_s, icon_s))
mask = Image.new("L", (icon_s, icon_s), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, icon_s - 1, icon_s - 1], radius=38, fill=255)
icon = Image.new("RGB", (icon_s, icon_s))
icon.paste(grad, (0, 0), mask)

icx, icy = (W - icon_s) // 2, 92
img.paste(icon, (icx, icy))

idr = ImageDraw.Draw(img)
wf = [(x, icy + 16 + (22 if x % 2 == 0 else 10)) for x in range(icx + 34, icx + icon_s - 34, 11)]
for x, y in wf:
    idr.line([(x, y), (x, icy + icon_s - 16)], fill=(255, 255, 255), width=7)

# --- text ---
def center_x(text, fnt, y, fill, spacing=0):
    tw = idr.textlength(text, font=fnt)
    idr.text(((W - tw) / 2, y), text, font=fnt, fill=fill)
    return y + fnt.size + spacing


y = 252
f_main = font(76)
y = center_x("Insta Notes", f_main, y, (255, 255, 255), 14)
f_tag = font(30)
center_x("Turn voice notes into beautiful animated videos", f_tag, y, (196, 196, 216), 10)
y2 = 252 + 76 + 14 + 30
f_by = font_italic(34)
center_x("by mr.velosofy", f_by, y2, (214, 41, 118))

# subtle border glow
bdr = Image.new("RGB", (W, H), (12, 10, 26))
ImageDraw.Draw(bdr).rectangle([3, 3, W - 4, H - 4], outline=(214, 41, 118), width=3)
img = Image.blend(img, bdr, 0.35)

img.save(HERE / "og-image.png", "PNG")
print("og-image.png", img.size)
