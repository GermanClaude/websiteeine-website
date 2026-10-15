#!/usr/bin/env python3
"""Texturen 1:1 aus der Video-Vorlage (Nutzer 15.10.: „die Texturen, die du siehst, 1:1 übernehmen“ – das Video und
seine Texturen gehören dem Nutzer).

Eine ebene Fläche (Wand, Boden, Containerseite) wird in einem Bezugsbild über vier Ecken markiert. Das Werkzeug verfolgt
sie über alle Bilder der Einstellung (SIFT-Merkmale nur auf der Fläche, Homographie, Bild für Bild weitergereicht),
entzerrt jedes Bild auf die Fläche und legt die Bilder übereinander (Median in linearem Licht): Kompressionsrauschen
und Verdecker (Waffe, Soldat, Mündungsfeuer) fallen heraus, Unterpixel-Versatz der Kamerafahrt schärft nach.

Aufruf: python3 tools/assets/video_tex.py <spec.json> [ids…]
  spec: [{ id, shot: [von, bis], ref, quad: [[x,y] ×4 (oben links, oben rechts, unten rechts, unten links)],
           size: [Breite m, Höhe m], ppm (Pixel je m), exclude: [[[x,y]…] …] (Bildbereiche ohne Fläche, z. B. Waffe) }]
Ausgabe: tools/out/video/rect/<id>.png (entzerrt, Licht wie im Video) + <id>_n.png (Anzahl Bilder je Pixel)
"""
import json
import os
import sys

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRAMES = os.path.join(ROOT, 'tools/out/video/f/f%03d.png')
OUT = os.path.join(ROOT, 'tools/out/video/rect')


def to_lin(img8):
    x = img8.astype(np.float32) / 255.0
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def to_srgb8(x):
    x = np.clip(x, 0, 1)
    y = np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)
    return np.clip(np.round(y * 255), 0, 255).astype(np.uint8)


_cache = {}


def frame(i):
    if i not in _cache:
        _cache[i] = cv2.imread(FRAMES % i, cv2.IMREAD_COLOR)
    return _cache[i]


SIFT = cv2.SIFT_create(nfeatures=6000, contrastThreshold=0.02)


def features(img, mask):
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    g = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(g)
    return SIFT.detectAndCompute(g, mask)


def match_h(fa, fb, guess=None):
    """Homographie a → b aus SIFT-Paaren (Lowe-Test, RANSAC). guess: erwartete Homographie (Paare nahe der Vorhersage)."""
    ka, da = fa
    kb, db = fb
    if da is None or db is None or len(ka) < 8 or len(kb) < 8:
        return None, 0
    m = cv2.BFMatcher(cv2.NORM_L2).knnMatch(da, db, k=2)
    good = [p[0] for p in m if len(p) == 2 and p[0].distance < 0.78 * p[1].distance]
    if len(good) < 12:
        return None, len(good)
    pa = np.float32([ka[g.queryIdx].pt for g in good])
    pb = np.float32([kb[g.trainIdx].pt for g in good])
    if guess is not None:
        pr = cv2.perspectiveTransform(pa.reshape(-1, 1, 2), guess).reshape(-1, 2)
        keep = np.linalg.norm(pr - pb, axis=1) < 40
        pa, pb = pa[keep], pb[keep]
        if len(pa) < 12:
            return None, len(pa)
    H, inl = cv2.findHomography(pa, pb, cv2.RANSAC, 2.5, maxIters=5000, confidence=0.999)
    return H, int(inl.sum()) if inl is not None else 0


def poly_mask(shape, polys, inside=True):
    m = np.zeros(shape[:2], np.uint8)
    for p in polys:
        cv2.fillPoly(m, [np.int32(p)], 255)
    return m if inside else 255 - m


def track(spec, log=True):
    """Homographie Bezugsbild → Bild k für alle Bilder der Einstellung (vom Bezugsbild aus in beide Richtungen)."""
    a, b = spec['shot']
    ref = spec['ref']
    quad = np.float32(spec['quad'])
    img0 = frame(ref)
    excl = spec.get('exclude', [])
    # Merkmale nur auf der Fläche (leicht verkleinert, damit Kanten/Nachbarflächen nicht mitzählen)
    c = quad.mean(axis=0)
    inner = c + (quad - c) * 0.94
    m0 = cv2.bitwise_and(poly_mask(img0.shape, [inner]), poly_mask(img0.shape, excl, inside=False) if excl else 255)
    f0 = features(img0, m0)
    Hs = {ref: np.eye(3)}
    for direction in (1, -1):
        prev = ref
        k = ref + direction
        while a <= k <= b:
            Hp = Hs[prev]
            q = cv2.perspectiveTransform(inner.reshape(-1, 1, 2), Hp).reshape(-1, 2)
            img = frame(k)
            mk = poly_mask(img.shape, [q])
            if excl:
                mk = cv2.bitwise_and(mk, poly_mask(img.shape, excl, inside=False))
            if cv2.countNonZero(mk) < 2000:
                break
            fk = features(img, cv2.dilate(mk, np.ones((25, 25), np.uint8)))
            # direkt zum Bezugsbild (driftfrei), Vorhersage aus dem Nachbarbild
            H, n = match_h(f0, fk, guess=Hp)
            if H is None or n < 20:
                # Ausweichen: über das Nachbarbild verketten
                mp = poly_mask(img.shape, [cv2.perspectiveTransform(inner.reshape(-1, 1, 2), Hp).reshape(-1, 2)])
                fp = features(frame(prev), mp)
                Hpk, n2 = match_h(fp, fk, guess=np.eye(3))
                if Hpk is None or n2 < 20:
                    if log:
                        print(f'  Bild {k}: verloren ({n}/{n2})')
                    break
                H = Hpk @ Hp
                n = n2
            Hs[k] = H
            prev = k
            k += direction
    if log:
        print(f"  {spec['id']}: {len(Hs)} Bilder verfolgt ({min(Hs)}–{max(Hs)})")
    return Hs


def rectify(spec, Hs, scale=1.0):
    """Jedes verfolgte Bild auf die Fläche entzerren → Stapel (linear), Gültigkeitsmasken."""
    w_m, h_m = spec['size']
    ppm = spec.get('ppm', 128) * scale
    W, H = int(round(w_m * ppm)), int(round(h_m * ppm))
    tex = np.float32([[0, 0], [W, 0], [W, H], [0, H]])
    Hq = cv2.getPerspectiveTransform(tex, np.float32(spec['quad']))
    excl = spec.get('exclude', [])
    # nur Bilder, in denen die Fläche groß (scharf) erscheint: Maßstab Textur → Bild in der Flächenmitte ≥ minRes × bester
    cen = np.float32([[[W / 2, H / 2]], [[W / 2 + 1, H / 2]], [[W / 2, H / 2 + 1]]])
    def res(Hk):
        p = cv2.perspectiveTransform(cen, Hk @ Hq).reshape(-1, 2)
        return abs(np.cross(p[1] - p[0], p[2] - p[0]))
    rs = {k: res(Hk) for k, Hk in Hs.items()}
    # Abdeckung: Anteil der Fläche, der im Bild liegt und nicht verdeckt ist (grob, 64 × 64)
    excl0 = spec.get('exclude', [])
    okimg = poly_mask(frame(min(Hs)).shape, excl0, inside=False) if excl0 else np.full(frame(min(Hs)).shape[:2], 255, np.uint8)
    S = np.diag([W / 64, H / 64, 1.0])
    cov = {}
    for k, Hk in Hs.items():
        v = cv2.warpPerspective(okimg, Hk @ Hq @ S, (64, 64), flags=cv2.INTER_NEAREST | cv2.WARP_INVERSE_MAP, borderValue=0)
        cov[k] = (v > 0).mean()
    cmax = max(cov.values())
    cand = [k for k in Hs if cov[k] >= spec.get('minCover', 0.9) * cmax]
    best = max(rs[k] for k in cand)
    keep = [k for k in sorted(cand) if rs[k] >= spec.get('minRes', 0.75) * best]
    keep = keep[: spec.get('maxFrames', 999)] if spec.get('maxFrames') else keep
    print(f"  Bilder für den Stapel: {len(keep)} von {len(Hs)} ({keep[0]}–{keep[-1]})")
    stack, valid = [], []
    for k in keep:
        Hk = Hs[k]
        M = Hk @ Hq
        img = frame(k)
        lin = to_lin(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        r = cv2.warpPerspective(lin, M, (W, H), flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_CONSTANT, borderValue=(-1, -1, -1))
        ok = np.full(img.shape[:2], 255, np.uint8)
        if excl:
            ok = poly_mask(img.shape, excl, inside=False)
        ok = cv2.erode(ok, np.ones((5, 5), np.uint8))
        v = cv2.warpPerspective(ok, M, (W, H), flags=cv2.INTER_NEAREST | cv2.WARP_INVERSE_MAP, borderValue=0)
        # Auflösung im Bild: Pixel der Quelle je Texturpixel (Jacobi-Determinante) – stark gestauchte Ansichten zählen weniger
        stack.append(r)
        valid.append((v > 0) & (r[..., 0] >= 0))
    return np.stack(stack), np.stack(valid), (W, H)


def fuse(stack, valid):
    """Median je Pixel über gültige Bilder (Helligkeit je Bild vorher angeglichen)."""
    s = stack.copy()
    s[~valid] = np.nan
    # Belichtung je Bild an den Median angleichen (Video-Belichtung schwankt leicht)
    lum = 0.2126 * s[..., 0] + 0.7152 * s[..., 1] + 0.0722 * s[..., 2]
    med = np.nanmedian(lum, axis=0)
    for i in range(len(s)):
        ok = valid[i] & np.isfinite(med) & (med > 1e-4)
        if ok.sum() > 500:
            g = np.nanmedian(lum[i][ok] / med[ok])
            if np.isfinite(g) and g > 0:
                s[i] /= g
    out = np.nanmedian(s, axis=0)
    n = valid.sum(axis=0)
    return out, n


def ground_quad(g):
    """Bodenrechteck aus Kameramodell: Augenhöhe h, Brennweite f, Bildmitte cx, Horizont yh; X (rechts), Z (Tiefe) in m."""
    f, h, cx, yh = g.get('f', 772), g.get('h', 1.7), g.get('cx', 640), g.get('yh', 355)
    (x0, x1), (z0, z1) = g['X'], g['Z']
    P = lambda x, z: [cx + x * f / z, yh + h * f / z]
    return [P(x0, z1), P(x1, z1), P(x1, z0), P(x0, z0)], [x1 - x0, z1 - z0]


def run(spec, scale=1.0):
    os.makedirs(OUT, exist_ok=True)
    if 'ground' in spec:
        spec['quad'], spec['size'] = ground_quad(spec['ground'])
        print('  Boden-Viereck', [[round(a), round(b)] for a, b in spec['quad']], 'Größe', spec['size'])
    Hs = track(spec)
    st, va, size = rectify(spec, Hs, scale)
    out, n = fuse(st, va)
    good = np.isfinite(out[..., 0])
    out[~good] = 0
    cv2.imwrite(os.path.join(OUT, spec['id'] + '.png'), cv2.cvtColor(to_srgb8(out), cv2.COLOR_RGB2BGR))
    nn = (np.clip(n / max(1, n.max()), 0, 1) * 255).astype(np.uint8)
    cv2.imwrite(os.path.join(OUT, spec['id'] + '_n.png'), nn)
    np.save(os.path.join(OUT, spec['id'] + '.npy'), out.astype(np.float32))
    print(f"  → {spec['id']}.png {size[0]}×{size[1]}, Bilder je Pixel max {n.max()}, Mittel {n[good].mean():.1f}")
    return out


if __name__ == '__main__':
    specs = json.load(open(sys.argv[1]))
    only = set(sys.argv[2:])
    for sp in specs:
        if only and sp['id'] not in only:
            continue
        print(sp['id'])
        run(sp)
