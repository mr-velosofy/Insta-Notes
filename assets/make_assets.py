from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent


def font(size, weight=700):
    for name in (f"C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/arial.ttf"):
        p = Path(name)
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def make_avatar(path):
    S = 512
    img = Image.new("RGB", (S, S), (18, 16, 32))
    d = ImageDraw.Draw(img)

    # soft radial-ish background
    for i in range(180, 0, -1):
        a = int(90 * (i / 180))
        c = (60 + i // 3, 42 + i // 3, 110 + i // 3)
        d.ellipse([S / 2 - i, S / 2 - i, S / 2 + i, S / 2 + i], outline=c, width=2)

    # simple stylized face
    d.ellipse([160, 120, 352, 312], fill=(214, 172, 140))  # face
    d.ellipse([205, 235, 255, 285], fill=(255, 255, 255))  # eye L
    d.ellipse([257, 235, 307, 285], fill=(255, 255, 255))  # eye R
    d.ellipse([222, 252, 240, 270], fill=(30, 24, 44))     # pupil L
    d.ellipse([272, 252, 290, 270], fill=(30, 24, 44))     # pupil R
    d.rounded_rectangle([220, 300, 292, 318], radius=9, fill=(150, 80, 90))  # mouth
    d.polygon([(120, 150), (392, 150), (256, 60)], fill=(24, 18, 38))        # hair
    d.rounded_rectangle([118, 150, 394, 240], radius=40, fill=(24, 18, 38))  # hair top

    img = img.filter(ImageFilter.SMOOTH_MORE)
    img.save(path, "PNG")
    print("avatar ->", path)


def make_background(path):
    W, H = 1080, 1920
    img = Image.new("RGB", (W, H), (12, 10, 26))
    d = ImageDraw.Draw(img)

    # vertical gradient
    for y in range(H):
        t = y / H
        c = (
            int(30 + 60 * (1 - t)),
            int(20 + 50 * (1 - t)),
            int(60 + 90 * (1 - t)),
        )
        d.line([(0, y), (W, y)], fill=c)

    # decorative blobs
    d.ellipse([-200, -260, 500, 500], fill=(248, 87, 166), outline=None)
    d.ellipse([700, 300, 1400, 900], fill=(90, 60, 200))
    d.ellipse([-300, 1300, 350, 1950], fill=(40, 110, 255))
    img = img.filter(ImageFilter.GaussianBlur(60))

    # noise speckles
    import random
    random.seed(7)
    px = img.load()
    for _ in range(4000):
        x, y = random.randrange(W), random.randrange(H)
        v = random.randint(-12, 12)
        r, g, b = px[x, y]
        px[x, y] = (max(0, min(255, r + v)), max(0, min(255, g + v)), max(0, min(255, b + v)))

    img.save(path, "JPEG", quality=88)
    print("background ->", path)


if __name__ == "__main__":
    make_avatar(HERE / "avatar.png")
    make_background(HERE / "background.jpg")
