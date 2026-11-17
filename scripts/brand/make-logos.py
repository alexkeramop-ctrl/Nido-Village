"""Λογότυπα του PDA από το επίσημο φύλλο λογοτύπων (scripts/brand/nido-village-logo-sheet.png).

Παίρνει την ανοιχτόχρωμη εκδοχή (κάτω αριστερά: πράσινη καμάρα, σκούρο πράσινο NIDO VILLAGE),
αφαιρεί το φόντο κρατώντας τα αυθεντικά χρώματα και φτιάχνει:
  public/brand/logo.webp, public/brand/mark.webp, src/app/icon.png, src/app/apple-icon.png,
  src/server/printing/assets/logo-bitmap.json (ασπρόμαυρο για θερμικό εκτυπωτή, 384 dots).
"""
import base64, json, os, sys
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sheet = Image.open(os.path.join(ROOT, "scripts/brand/nido-village-logo-sheet.png")).convert("RGB")
a = np.array(sheet).astype(float)

# ανοιχτόχρωμο πλακίδιο (κάτω αριστερά), χωρίς τα περιθώρια/πλαίσια των πλακιδίων
tx, ty = 40, 630
tile = a[ty:ty + 520, tx:tx + 520]
bg = np.median(tile[5:40, 5:40].reshape(-1, 3), axis=0)

def color_to_alpha(rgb, bg):
    """GIMP-style: το φόντο γίνεται διάφανο, τα σκούρα κρατούν το αυθεντικό χρώμα."""
    d = np.maximum((bg - rgb) / np.maximum(bg, 1), 0)  # μόνο σκουρότερα από το φόντο
    alpha = np.clip(d.max(axis=2) * 1.0, 0, 1)
    alpha = np.clip((alpha - 0.03) / 0.97, 0, 1)
    safe = np.maximum(alpha, 1e-3)[..., None]
    col = np.clip(bg - (bg - rgb) / safe, 0, 255)
    return np.dstack([col, alpha * 255]).astype(np.uint8)

def content_box(alpha, pad=6):
    ys, xs = np.where(alpha > 20)
    return xs.min() - pad, ys.min() - pad, xs.max() + pad + 1, ys.max() + pad + 1

rgba = color_to_alpha(tile, bg)
x0, y0, x1, y1 = content_box(rgba[..., 3])
logo = Image.fromarray(rgba[y0:y1, x0:x1], "RGBA")

# σήμα = μόνο η καμάρα (η πρώτη ομάδα γραμμών πάνω από το NIDO)
rows = (rgba[y0:y1, x0:x1, 3] > 20).any(axis=1)
gap = next(i for i in range(10, len(rows)) if not rows[i] and rows[:i].any() and not rows[i:i + 8].any())
mark = Image.fromarray(rgba[y0:y0 + gap + 4, x0:x1], "RGBA")
mb = mark.getbbox()
mark = mark.crop((mb[0] - 4, 0, mb[2] + 4, mark.height))

def up(im, k=3):
    return im.resize((im.width * k, im.height * k), Image.LANCZOS)

up(logo).save(os.path.join(ROOT, "public/brand/logo.webp"), quality=95, method=6)
up(mark).save(os.path.join(ROOT, "public/brand/mark.webp"), quality=95, method=6)
# κρεμ εκδοχή του σήματος για σκούρα (glass) φόντα: ίδιο σχήμα, χρώμα #f3eee2
ml = np.array(up(mark)).copy()
ml[..., 0], ml[..., 1], ml[..., 2] = 243, 238, 226
Image.fromarray(ml, "RGBA").save(os.path.join(ROOT, "public/brand/mark-light.webp"), quality=95, method=6)
print("logo", up(logo).size, "mark", up(mark).size)

# εικονίδια: καμάρα σε κρεμ τετράγωνο
def icon(size):
    canvas = Image.new("RGBA", (size, size), (248, 247, 242, 255))
    m = up(mark, 4)
    m.thumbnail((int(size * 0.66), int(size * 0.66)), Image.LANCZOS)
    canvas.alpha_composite(m, ((size - m.width) // 2, (size - m.height) // 2))
    return canvas
icon(256).save(os.path.join(ROOT, "src/app/icon.png"))
icon(180).save(os.path.join(ROOT, "src/app/apple-icon.png"))

# θερμικός εκτυπωτής: 384 dots πλάτος, 1 = μαύρη κουκκίδα
W = 384
lg = up(logo, 3)
target_w = 300
lg = lg.resize((target_w, round(lg.height * target_w / lg.width)), Image.LANCZOS)
al = np.array(lg)[..., 3]
bmp = np.zeros((lg.height, W), dtype=np.uint8)
off = (W - target_w) // 2
bmp[:, off:off + target_w] = (al > 110).astype(np.uint8)
packed = np.packbits(bmp, axis=1)
json.dump({"width": W, "height": int(lg.height), "data": base64.b64encode(packed.tobytes()).decode()},
          open(os.path.join(ROOT, "src/server/printing/assets/logo-bitmap.json"), "w"))
print("bitmap", W, lg.height)
