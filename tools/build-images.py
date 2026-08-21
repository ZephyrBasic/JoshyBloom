"""Derivative image build: EXIF-baked, metadata-stripped, AVIF/WebP/JPEG at several widths.
Run: python tools/build-images.py    Output: assets/img/opt/ + assets/img/manifest.json
"""
import base64, glob, io, json, os, re
from PIL import Image, ImageOps, ImageFilter

SRC = "assets/img"                 # originals — never published
OUT = "public/assets/img/opt"      # derivatives — inside the Pages output dir
WIDTHS = [480, 800, 1200, 1800, 2400]

SLUGS = {
    "4 cermaic pots light background": "vessels-four",
    "alchemic circle full 7 ceramics installation with a crowd": "tower-of-dreams",
    "ceramic in sunlight": "vessel-sunlight",
    "child joshy cozy hiphop": "archive-child",
    "fired sculpture": "sculpture-fired",
    "joshy at beach moulding clay": "process-beach",
    "joshy ceramic with smoke": "smoke-totem",
    "joshy fashion icon portrait": "portrait-profile",
    "joshy full frontal fashion icon": "portrait-full",
    "joshy guitar live on stage": "live-guitar",
    "joshy headphones keyboard": "studio-keys",
    "joshy in balaclava with ceramic": "portrait-balaclava",
    "joshy selfie urban vibe": "portrait-urban",
    "organic ceramic dark background untitled 2026 sold": "vessel-untitled-2026",
    "Protected Spirits 2026 ceramic mask": "protected-spirits",
    "toddler joshy outdoors mic": "archive-toddler",
    "unfired sculpture": "sculpture-unfired",
}

def slugify(stem):
    return SLUGS.get(stem, re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-"))

def lqip(im):
    """Tiny blurred base64 WebP for a zero-CLS placeholder."""
    t = im.copy()
    t.thumbnail((20, 20))
    t = t.filter(ImageFilter.GaussianBlur(0.6))
    buf = io.BytesIO()
    t.save(buf, "WEBP", quality=40)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()

def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {}
    files = [f for f in sorted(glob.glob(os.path.join(SRC, "*")))
             if os.path.isfile(f) and f.lower().endswith((".jpg", ".jpeg", ".png"))]
    for f in files:
        stem = os.path.splitext(os.path.basename(f))[0]
        slug = slugify(stem)
        im = ImageOps.exif_transpose(Image.open(f)).convert("RGB")  # bake rotation, drop EXIF
        w0, h0 = im.size
        widths = [w for w in WIDTHS if w < w0] + [min(w0, WIDTHS[-1])]
        widths = sorted(set(widths))
        entry = {"slug": slug, "source": os.path.basename(f), "width": w0, "height": h0,
                 "ratio": round(w0 / h0, 4), "lqip": lqip(im), "widths": widths}
        for w in widths:
            h = round(h0 * w / w0)
            r = im.resize((w, h), Image.LANCZOS)
            r.save(f"{OUT}/{slug}-{w}.avif", quality=54, speed=5)
            r.save(f"{OUT}/{slug}-{w}.webp", quality=76, method=5)
            r.save(f"{OUT}/{slug}-{w}.jpg", quality=80, optimize=True, progressive=True)
        manifest[slug] = entry
        print(f"{slug:<22} {w0}x{h0} -> {widths}", flush=True)
    with open(os.path.join(SRC, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    total = sum(os.path.getsize(p) for p in glob.glob(f"{OUT}/*"))
    print(f"\ndone: {len(files)} sources, {len(glob.glob(f'{OUT}/*'))} files, {total/1048576:.1f} MB total")

if __name__ == "__main__":
    main()
