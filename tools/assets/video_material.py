#!/usr/bin/env python3
"""Video-Ausschnitt (tools/assets/video_tex.py) → kachelbarer PBR-Satz für tools/assets/textures.mjs (source 'video').

Je Satz: Ausschnitt aus der entzerrten Fläche, Schatten/Lichtverlauf herausrechnen (nur großräumig – Flecken, Risse,
Rost, Fugen bleiben 1:1 aus dem Video), kachelbar machen (Nahtschnitt mit geringster Abweichung statt Überblenden →
keine doppelten Risse), Relief (Normalen) und Rauheit/Umgebungsverdeckung aus dem Bild ableiten.

Aufruf: python3 tools/assets/video_material.py <spec.json> [ids…]
  spec: [{ id, src (Name in tools/out/video/rect), crop: [x0, y0, x1, y1] (px der Entzerrung), size: [m, m] (Kachel),
           out (px, Standard 1024), mode: 'random' | 'ribs-x' | 'fit', rib: { period (px der Entzerrung, 0 = messen),
           depth }, delight (Radius m, 0 = aus), shadow: true (harte Schatten ausgleichen), height: Stärke,
           rough: [Mittel, Spanne], metal, ao, gain: [r,g,b] (Farbabgleich) }]
Ausgabe: tools/assets/video-src/<id>/{albedo,normal,orm}.png + meta.json
"""
import json
import os
import sys

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RECT = os.path.join(ROOT, 'tools/out/video/rect')
DST = os.path.join(ROOT, 'tools/assets/video-src')


def to_srgb8(x):
    x = np.clip(x, 0, 1)
    y = np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)
    return np.clip(np.round(y * 255), 0, 255).astype(np.uint8)


def lum(img):
    return 0.2126 * img[..., 0] + 0.7152 * img[..., 1] + 0.0722 * img[..., 2]


def blur(img, sigma):
    k = int(sigma * 3) * 2 + 1
    return cv2.GaussianBlur(img, (k, k), sigma, borderType=cv2.BORDER_REFLECT)


def delight(img, sigma, shadow=False):
    """Großräumige Helligkeit (Licht, Vignette, Schatten) herausteilen; Farbe/Detail bleiben."""
    L = np.maximum(lum(img), 1e-4)
    if shadow:
        # harte Schatten: Maske aus stark geglätteter Helligkeit (zwei Gruppen), Schattenbereich auf Licht-Mittel heben
        Ls = blur(L, max(2.0, sigma / 6))
        t = cv2.threshold((np.clip(Ls / Ls.max(), 0, 1) * 255).astype(np.uint8), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[0] / 255 * Ls.max()
        sh = (Ls < t).astype(np.float32)
        if 0.05 < sh.mean() < 0.95:
            # je Farbkanal (Sonne warm, Himmelslicht im Schatten blau): Schattenbereich auf die Farbe der Sonnenseite
            lit, shd = sh < 0.5, sh > 0.5
            ratio = np.array([np.median(img[..., c][lit]) / max(1e-4, np.median(img[..., c][shd])) for c in range(3)], np.float32)
            m = blur(sh, 3.0)[..., None]
            img = img * (1 + (ratio[None, None, :] - 1) * m)
            L = np.maximum(lum(img), 1e-4)
    if sigma > 0:
        low = blur(L, sigma)
        img = img * (L.mean() / np.maximum(low, 1e-4))[..., None]
    return img


def seam_cut(err):
    """Senkrechter Schnitt geringster Summe durch err (h × w) → Spaltenindex je Zeile."""
    h, w = err.shape
    E = err.copy()
    for y in range(1, h):
        prev = E[y - 1]
        left = np.r_[np.inf, prev[:-1]]
        right = np.r_[prev[1:], np.inf]
        E[y] += np.minimum(np.minimum(left, prev), right)
    path = np.zeros(h, np.int32)
    path[-1] = int(np.argmin(E[-1]))
    for y in range(h - 2, -1, -1):
        x = path[y + 1]
        lo, hi = max(0, x - 1), min(w, x + 2)
        path[y] = lo + int(np.argmin(E[y, lo:hi]))
    return path


def tile_x(img, t, o):
    """Kachelbar in x: Bild der Breite t + o; der rechte Überstand ersetzt links bis zum Nahtschnitt."""
    a = img[:, :o]          # Anfang
    b = img[:, t:t + o]     # Überstand (gehört an den Anfang der nächsten Kachel)
    err = ((a - b) ** 2).sum(axis=2)
    cut = seam_cut(err)
    out = img[:, :t].copy()
    for y in range(img.shape[0]):
        c = cut[y]
        out[y, :c] = b[y, :c]
        # weicher Übergang über 2 px
        if 0 < c < o:
            out[y, c] = 0.5 * (b[y, c] + a[y, c])
    return out


def make_tileable(img, ox=0.15, oy=0.15, axes='xy'):
    h, w = img.shape[:2]
    if 'x' in axes:
        o = max(4, int(w * ox))
        img = tile_x(img, w - o, o)
    if 'y' in axes:
        h = img.shape[0]
        o = max(4, int(h * oy))
        img = np.transpose(tile_x(np.transpose(img, (1, 0, 2)), h - o, o), (1, 0, 2))
    return img


def quilt(ex, valid, out, patch=64, ov=16, seed=1, tol=1.25):
    """Bild-Quilting (Efros/Freeman) auf einem Torus: aus dem Video-Vorbild ex (nur gültige Pixel) eine kachelbare
    Fläche out × out weben – Flicken mit passendem Rand aus dem Vorbild, Nähte entlang geringster Abweichung."""
    rng = np.random.default_rng(seed)
    step = patch - ov
    n = int(np.ceil(out / step))
    out = n * step
    res = np.zeros((out, out, 3), np.float32)
    filled = np.zeros((out, out), np.uint8)
    # gültige Flicken-Positionen im Vorbild
    vk = cv2.erode(valid.astype(np.uint8), np.ones((patch, patch), np.uint8), anchor=(0, 0))
    vk = vk[: ex.shape[0] - patch + 1, : ex.shape[1] - patch + 1]
    exu = ex.astype(np.float32)
    srcpos = {}
    for bi in range(n):
        for bj in range(n):
            y, x = bi * step, bj * step
            ys = (np.arange(patch) + y) % out
            xs = (np.arange(patch) + x) % out
            T = res[np.ix_(ys, xs)]
            M = filled[np.ix_(ys, xs)].astype(np.float32)
            if M.sum() == 0:
                cand = np.argwhere(vk > 0)
                py, px = cand[rng.integers(len(cand))]
            else:
                Mm = np.repeat(M[..., None], 3, axis=2)
                D = cv2.matchTemplate(exu, T, cv2.TM_SQDIFF, mask=Mm)
                D = D[: vk.shape[0], : vk.shape[1]]
                D[vk == 0] = np.inf
                # keine wörtliche Fortsetzung des Nachbarflickens (sonst kopiert das Weben ganze Bildstücke)
                for (ny, nx) in ((bi, bj - 1), (bi - 1, bj)):
                    if (ny, nx) in srcpos:
                        sy, sx = srcpos[(ny, nx)]
                        ey, ex_ = sy + (bi - ny) * step, sx + (bj - nx) * step
                        D[max(0, ey - patch // 2):ey + patch // 2, max(0, ex_ - patch // 2):ex_ + patch // 2] = np.inf
                fin = np.isfinite(D)
                lo = np.min(D[fin])
                cand = np.argwhere(D <= lo * tol + 1e-6)
                py, px = cand[rng.integers(len(cand))]
            srcpos[(bi, bj)] = (int(py), int(px))
            P = exu[py:py + patch, px:px + patch]
            # Nahtmaske: links/oben Schnitt geringster Abweichung, sonst weich
            mask = np.ones((patch, patch), np.float32)
            if M.sum() > 0:
                err = ((P - T) ** 2).sum(axis=2)
                if M[:, :ov].mean() > 0.99:
                    cut = seam_cut(err[:, :ov])
                    for r in range(patch):
                        mask[r, :cut[r]] = 0
                if M[:ov, :].mean() > 0.99:
                    cut = seam_cut(err[:ov, :].T)
                    for c in range(patch):
                        mask[:cut[c], c] = np.minimum(mask[:cut[c], c], 0)
                # rechts/unten bereits gefüllt (Torus-Schluss): weich überblenden
                if M[:, -ov:].mean() > 0.99:
                    mask[:, -ov:] *= np.linspace(1, 0, ov)[None, :]
                if M[-ov:, :].mean() > 0.99:
                    mask[-ov:, :] *= np.linspace(1, 0, ov)[:, None]
                mask = cv2.GaussianBlur(mask, (3, 3), 0.8)
                mask = np.where(M > 0, mask, 1.0)
            res[np.ix_(ys, xs)] = T * (1 - mask[..., None]) + P * mask[..., None]
            filled[np.ix_(ys, xs)] = 1
    return res


def crack_paths(img, valid, kernel=15, thresh=0.05, min_len=25):
    """Risse aus dem Video-Vorbild: dunkle, schmale Linien (Black-Hat) → Skelett → Linienzüge (px des Vorbilds)."""
    from skimage.morphology import skeletonize
    L = lum(img)
    L = L / max(1e-4, np.median(L[valid]))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel, kernel))
    bh = cv2.morphologyEx(L.astype(np.float32), cv2.MORPH_BLACKHAT, k)
    # Schattenkanten/Gegenstandsränder ausschließen (starker großräumiger Helligkeitssprung)
    Lb = blur(L.astype(np.float32), 6)
    gm = np.hypot(cv2.Sobel(Lb, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(Lb, cv2.CV_32F, 0, 1, ksize=3))
    edge = cv2.dilate((gm > np.percentile(gm, 95)).astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
    m = (bh > thresh) & ~edge & cv2.erode(valid.astype(np.uint8), np.ones((15, 15), np.uint8)).astype(bool)
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    sk = skeletonize(m > 0).astype(np.uint8)
    cs, _ = cv2.findContours(sk, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    paths = []
    for c in cs:
        if len(c) < min_len:
            continue
        c = c.reshape(-1, 2).astype(np.float32)
        # Kontur eines 1-px-Skeletts läuft hin und zurück: erste Hälfte reicht
        c = c[: max(2, len(c) // 2 + 1)]
        # Stärke je Punkt aus dem Black-Hat-Wert (breite Risse dunkler)
        s = np.array([bh[int(y), int(x)] for x, y in c], np.float32)
        paths.append((c, s))
    return paths


def crack_tile(sp, img, valid, ppm):
    """Betonkachel: Grundfläche mit der großen Fleckung des Videos (gewebt) + Risse aus dem Video, scharf gezeichnet."""
    out = sp.get('out', 1024)
    size = sp['size'][0]
    opm = out / size
    # Grundfläche: Fleckung aus dem Vorbild, grob gewebt (¼ Auflösung, große Flicken) → weich hochskaliert
    sm = cv2.resize(img, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)
    vsm = cv2.resize(valid.astype(np.uint8), (sm.shape[1], sm.shape[0]), interpolation=cv2.INTER_NEAREST) > 0
    base = quilt(sm, vsm, int(round(size * ppm * 0.25)), patch=sp.get('patch', 24), ov=sp.get('ov', 8), seed=sp.get('seed', 1), tol=1.4)
    base = cv2.resize(base, (out, out), interpolation=cv2.INTER_CUBIC)
    # nur Helligkeitsfleckung (Farbe kommt aus 'color'), Kontrast gedämpft, weich
    Lb = blur(lum(base), out / 64)
    Lb = Lb / max(1e-4, Lb.mean())
    Lb = 1 + (Lb - 1) * sp.get('mottle', 0.35)
    base = np.repeat(Lb[..., None], 3, axis=2)
    # Feinkorn (Video ist weich): leichtes Rauschen in zwei Maßstäben
    rng = np.random.default_rng(sp.get('seed', 1) + 7)
    g1 = cv2.GaussianBlur(rng.normal(0, 1, (out, out)).astype(np.float32), (0, 0), 1.2)
    g2 = cv2.GaussianBlur(rng.normal(0, 1, (out, out)).astype(np.float32), (0, 0), 6)
    grain = 1 + 0.035 * g1 / max(1e-4, g1.std()) + 0.04 * g2 / max(1e-4, g2.std())
    base = base * grain[..., None]
    # Risse
    paths = crack_paths(img, valid, sp.get('crackKernel', 15), sp.get('crackThresh', 0.05))
    crack = np.zeros((out * 3, out * 3), np.float32)
    k = opm / ppm
    copies = sp.get('crackCopies', [(0, 0.0, 0.0), (2, 0.5, 0.35)])
    for rot, ox, oy in copies:
        for c, s in paths:
            p = c * k
            ex_w, ex_h = img.shape[1] * k, img.shape[0] * k
            if rot == 1:
                p = np.stack([ex_h - p[:, 1], p[:, 0]], 1)
            elif rot == 2:
                p = np.stack([ex_w - p[:, 0], ex_h - p[:, 1]], 1)
            elif rot == 3:
                p = np.stack([p[:, 1], ex_w - p[:, 0]], 1)
            p = p + np.array([ox * out, oy * out])
            w = float(np.clip(np.median(s) * sp.get('crackWidth', 18), 1.0, 3.5)) * (out / 1024)
            for dx in (-out, 0, out):
                for dy in (-out, 0, out):
                    q = (p + np.array([dx + out, dy + out])).astype(np.int32).reshape(-1, 1, 2)
                    cv2.polylines(crack, [q], False, 1.0, thickness=max(1, int(round(w))), lineType=cv2.LINE_AA)
    crack = crack[out:2 * out, out:2 * out]
    crack = np.clip(crack, 0, 1)
    # Plattenfugen (Video: Schnittfugen im Kaibeton) am Kachelrand, leicht ausgebrochen
    jw = sp.get('slabJoint', 0)
    if jw:
        jm = np.zeros((out, out), np.float32)
        w = max(1, int(round(jw * opm)))
        cv2.line(jm, (0, 0), (0, out - 1), 1.0, w); cv2.line(jm, (out - 1, 0), (out - 1, out - 1), 1.0, w)
        cv2.line(jm, (0, 0), (out - 1, 0), 1.0, w); cv2.line(jm, (0, out - 1), (out - 1, out - 1), 1.0, w)
        chip = cv2.GaussianBlur((rng.random((out, out)) > 0.985).astype(np.float32), (0, 0), 2.0)
        edge = cv2.GaussianBlur(jm, (0, 0), w * 1.5)
        jm = np.clip(jm + (edge > 0.05) * chip * 2.0, 0, 1)
        crack = np.maximum(crack, jm * sp.get('slabJointDark', 0.8) / max(1e-4, sp.get('crackDark', 0.6)))
    # Flecken (Öl, Wasser, Abrieb): große weiche dunkle Flächen, gering
    st = sp.get('stains', 0)
    if st:
        sn = cv2.GaussianBlur(rng.random((out // 16, out // 16)).astype(np.float32), (0, 0), 1.5)
        sn = cv2.resize(sn, (out, out), interpolation=cv2.INTER_CUBIC)
        sn = (sn - sn.mean()) / max(1e-4, sn.std())
        base = base * (1 - st * np.clip(sn - 0.8, 0, 2)[..., None] * 0.5)
    soft = cv2.GaussianBlur(crack, (0, 0), 2.0 * out / 1024)
    shade = 1 - sp.get('crackDark', 0.6) * np.clip(crack, 0, 1) - 0.12 * soft
    alb = base * shade[..., None]
    # Höhe: Risse + Korn (grainH; Video-Beton ist glatt) + weiche Wellung (waveH)
    hgt = -(crack * 1.0 + soft * 0.6) + sp.get('grainH', 0.15) * (g1 / max(1e-4, g1.std())) + sp.get('waveH', 0) * (g2 / max(1e-4, g2.std()))
    return alb, hgt


def lattice_tile(sp, img, valid):
    """Pflaster/Platten aus echten Video-Steinen: Gitter (Gittervektoren a, b in px der Entzerrung) gerade richten,
    jeden ganzen Stein als Zelle ausschneiden und zufällig zu einer kachelbaren Fläche zusammensetzen (keine Wiederholung
    von Nachbarn, Fugen liegen auf den Zellrändern → keine Kreuz-/X-Fugen)."""
    s = int(sp.get('cell', 96))
    a = np.array(sp['a'], np.float64)
    b = np.array(sp['b'], np.float64)
    B = np.column_stack([a, b])
    A = np.array([[s, 0], [0, s]], np.float64) @ np.linalg.inv(B)
    # Bildmitte bleibt Mitte; Leinwand groß genug für die ganze Entzerrung
    corners = np.array([[0, 0], [img.shape[1], 0], [img.shape[1], img.shape[0]], [0, img.shape[0]]], np.float64)
    tc = corners @ A.T
    off = -tc.min(axis=0)
    W, H = (tc.max(axis=0) - tc.min(axis=0)).astype(int) + 2
    M = np.hstack([A, off.reshape(2, 1)])
    w = cv2.warpAffine(img, M, (int(W), int(H)), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
    vw = cv2.warpAffine(valid.astype(np.uint8), M, (int(W), int(H)), flags=cv2.INTER_NEAREST, borderValue=0) > 0
    L = lum(w)
    # Phase: Fugen = dunkelste Zeile/Spalte des modulo-s gefalteten Bildes
    fold = np.zeros((s, s)); cnt = np.zeros((s, s)) + 1e-6
    ys, xs = np.nonzero(vw)
    np.add.at(fold, (ys % s, xs % s), L[ys, xs]); np.add.at(cnt, (ys % s, xs % s), 1)
    fold /= cnt
    ox = int(np.argmin(fold.mean(axis=0)))
    oy = int(np.argmin(fold.mean(axis=1)))
    # ganze Zellen (komplett gültig) sammeln, Helligkeit je Zelle an den Gesamtmittelwert angleichen (Lichtverlauf raus)
    cells = []
    for y0 in range(oy, int(H) - s, s):
        for x0 in range(ox, int(W) - s, s):
            if vw[y0:y0 + s, x0:x0 + s].all():
                cells.append(w[y0:y0 + s, x0:x0 + s].copy())
    if not cells:
        raise RuntimeError('keine ganzen Steine im Vorbild')
    lm = np.array([lum(c).mean() for c in cells])
    tgt = np.median(lm)
    keep = sp.get('cellVar', 0.35)  # Anteil der Helligkeitsunterschiede zwischen Steinen, der bleibt
    cells = [c * ((tgt + (m - tgt) * keep) / max(1e-4, m)) for c, m in zip(cells, lm)]
    n = int(sp.get('grid', 12))
    rng = np.random.default_rng(sp.get('seed', 1))
    pick = np.full((n, n), -1)
    out = np.zeros((n * s, n * s, 3), np.float32)
    for i in range(n):
        for j in range(n):
            for _ in range(20):
                k = int(rng.integers(len(cells)))
                if k not in (pick[i - 1, j], pick[i, j - 1], pick[(i + 1) % n, j], pick[i, (j + 1) % n]):
                    break
            pick[i, j] = k
            c = cells[k]
            if rng.random() < 0.5 and sp.get('flip', True):
                c = c[:, ::-1]
            out[i * s:(i + 1) * s, j * s:(j + 1) * s] = c
    print(f"    {len(cells)} Steine aus dem Video, Kachel {n}×{n}")
    return out


def stones_tile(sp, img, valid):
    """Pflaster aus echten Video-Steinen: Steine im Vorbild finden (hell zwischen dunklen Fugen), jeden Stein
    ausschneiden und im Läuferverband neu verlegen (versetzte Reihen → nur T-Fugen, keine Kreuz-/X-Fugen)."""
    L = lum(img)
    L = L / max(1e-4, np.median(L[valid]))
    hp = L - blur(L.astype(np.float32), sp.get('stoneBlur', 14))
    if sp.get('stoneDark'):
        hp = -hp  # Steine dunkler als die Fugen (Ziegel mit hellem Mörtel)
    m = ((hp > sp.get('stoneThresh', -0.01)) & valid).astype(np.uint8)
    m = cv2.erode(m, np.ones((3, 3), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m, connectivity=4)
    areas = st[1:, cv2.CC_STAT_AREA]
    med = np.median(areas[areas > 50]) if (areas > 50).any() else 0
    stones = []
    for i in range(1, n):
        x, y, w, h, ar = st[i]
        if not (0.45 * med < ar < 2.0 * med) or w < 8 or h < 8:
            continue
        crop = img[y:y + h, x:x + w]
        mk = (lab[y:y + h, x:x + w] == i).astype(np.float32)
        if mk.mean() < 0.55:
            continue
        stones.append((crop, mk))
    if not stones:
        raise RuntimeError('keine Steine gefunden')
    # Fugenfarbe aus dem Video (dunkle Zwischenräume)
    jm = (hp < -0.06) & valid
    joint = (np.median(img[jm], axis=0) if jm.sum() > 50 else np.array([0.08, 0.08, 0.07])) * sp.get('jointDark', 0.6)
    cw, ch, jw = int(sp.get('cellW', 88)), int(sp.get('cellH', 72)), int(sp.get('joint', 7))
    nx, ny = int(sp.get('cols', 12)), int(sp.get('rows', 14))
    W, H = nx * cw, ny * ch
    out = np.ones((H, W, 3), np.float32) * joint[None, None, :]
    hmap = np.zeros((H, W), np.float32)
    rng = np.random.default_rng(sp.get('seed', 1))
    lm = np.array([lum(c)[k > 0.5].mean() for c, k in stones])
    tgt = np.median(lm)
    keep = sp.get('cellVar', 0.5)
    # Verband wie im Video: Reihen mit ungleich langen Steinen (Faktor widthVar), Reihenhöhen leicht verschieden;
    # Stoßfugen benachbarter Reihen liegen mindestens minStagger × Steinbreite auseinander (keine Kreuz-/X-Fugen)
    wv, hv, ms = sp.get('widthVar', 0.0), sp.get('heightVar', 0.0), sp.get('minStagger', 0.25)
    rh = np.ones(ny) if hv <= 0 else 1 + (rng.random(ny) - 0.5) * 2 * hv
    rh = np.round(rh / rh.sum() * H).astype(int)
    rh[-1] += H - rh.sum()
    rows_x, prev = [], None
    for r in range(ny):
        for _ in range(200):
            if wv <= 0:
                xs = [((cw // 2) if r % 2 else 0) + c * cw for c in range(nx)]
                widths = [cw] * nx
            else:
                ws = []
                while sum(ws) < W - cw * 0.5:
                    ws.append(cw * (1 + (rng.random() - 0.5) * 2 * wv))
                ws = np.array(ws) * (W / sum(ws))
                off = rng.random() * W
                xs = list((off + np.concatenate([[0], np.cumsum(ws)[:-1]])) % W)
                widths = list(ws)
            if prev is None or wv <= 0:
                break
            d = np.abs(((np.array(xs)[:, None] - np.array(prev)[None, :]) + W / 2) % W - W / 2)
            if d.min() >= ms * cw:
                break
        rows_x.append((xs, widths))
        prev = xs
    y_acc = 0
    for r in range(ny):
        xs, widths = rows_x[r]
        for x_left, wcell in zip(xs, widths):
            k = int(rng.integers(len(stones)))
            crop, mk = stones[k]
            if rng.random() < 0.5:
                crop, mk = crop[:, ::-1], mk[:, ::-1]
            if rng.random() < 0.5:
                crop, mk = crop[::-1], mk[::-1]
            jx = jw * (1 + (rng.random() - 0.5) * sp.get('jointVar', 0.0))
            jy = jw * (1 + (rng.random() - 0.5) * sp.get('jointVar', 0.0))
            sw, sh = max(8, int(round(wcell - jx))), max(8, int(round(rh[r] - jy)))
            cr = cv2.resize(crop, (sw, sh), interpolation=cv2.INTER_CUBIC)
            mm = cv2.resize(mk, (sw, sh), interpolation=cv2.INTER_LINEAR)
            # Steinform: abgerundetes Rechteck, Rand mit leichter Unregelmäßigkeit (behauene Kanten)
            yy, xx = np.mgrid[0:sh, 0:sw]
            rad = min(sw, sh) * (0.14 + rng.random() * 0.12)
            dx = np.maximum(0, np.maximum(rad - xx, xx - (sw - 1 - rad)))
            dy = np.maximum(0, np.maximum(rad - yy, yy - (sh - 1 - rad)))
            ir = sp.get('edgeNoise', 0.0)
            if ir > 0:
                nz = cv2.resize(rng.random((4, 4)).astype(np.float32), (sw, sh), interpolation=cv2.INTER_CUBIC)
                edge = np.minimum(np.minimum(xx, sw - 1 - xx), np.minimum(yy, sh - 1 - yy)).astype(np.float32)
                shape = np.clip((edge - (nz - 0.3) * ir * min(sw, sh) * 0.12) / 2.0, 0, 1) * np.clip(1.2 - np.hypot(dx, dy) / rad, 0, 1)
            else:
                shape = np.clip(1.2 - np.hypot(dx, dy) / rad, 0, 1)
            g = (tgt + (lm[k] - tgt) * keep) / max(1e-4, lm[k]) * (1 + (rng.random() - 0.5) * sp.get('stoneJitter', 0.25))
            cr = cr * g
            mean = (cr * mm[..., None]).sum(axis=(0, 1)) / max(1e-4, mm.sum())
            cr = cr * mm[..., None] + mean[None, None, :] * (1 - mm[..., None])
            # Wölbung: Mitte hoch, Kanten fallen ab (Steine leicht schief: Kippung)
            tilt = (rng.random(2) - 0.5) * sp.get('tilt', 0.0)
            dome = np.clip(1 - (np.hypot((xx - sw / 2) / (sw / 2), (yy - sh / 2) / (sh / 2)) ** 4) * 0.5
                           + tilt[0] * (xx / sw - 0.5) + tilt[1] * (yy / sh - 0.5), 0, 1) * shape
            x0 = int(round(x_left + jx / 2)) % W
            y0 = y_acc + int(round(jy / 2))
            sh_eff = min(sh, H - y0)
            for (xa, xb, sa) in ((x0, min(W, x0 + sw), 0), (0, max(0, x0 + sw - W), W - x0)):
                if xb <= xa:
                    continue
                wv_ = xb - xa
                seg = slice(sa, sa + wv_)
                region = out[y0:y0 + sh_eff, xa:xb]
                shp = shape[:sh_eff, seg, None]
                out[y0:y0 + sh_eff, xa:xb] = region * (1 - shp) + cr[:sh_eff, seg] * shp
                hmap[y0:y0 + sh_eff, xa:xb] = np.maximum(hmap[y0:y0 + sh_eff, xa:xb], dome[:sh_eff, seg])
        y_acc += rh[r]
    print(f"    {len(stones)} Steine aus dem Video, Verband {nx}×{ny}")
    return out, hmap


def rib_period(img):
    """Rippenabstand in px (Autokorrelation des Spaltenmittels)."""
    p = lum(img).mean(axis=0)
    p = p - blur(p.reshape(1, -1), max(20, len(p) / 4)).ravel()
    ac = np.correlate(p, p, 'full')[len(p) - 1:]
    ac /= ac[0]
    for i in range(4, int(len(ac) * 0.6)):
        if ac[i] > ac[i - 1] and ac[i] >= ac[i + 1] and ac[i] > 0.2:
            # Unterpixel: Parabel
            y0, y1, y2 = ac[i - 1], ac[i], ac[i + 1]
            return i + 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2)
    return 0


def height_from(img, sp):
    """Relief aus der Helligkeit: Hochpass (dunkel = tiefer: Risse, Fugen, Rippen-Täler)."""
    L = lum(img)
    L = L / max(1e-4, L.mean())
    hp = L - blur(L, sp.get('heightRadius', 6))
    return hp


def normals(hgt, strength):
    """Normalen aus dem Höhenfeld, kachelbar (Ableitung über den Rand hinweg)."""
    gx = (np.roll(hgt, -1, axis=1) - np.roll(hgt, 1, axis=1)) * 0.5
    gy = (np.roll(hgt, -1, axis=0) - np.roll(hgt, 1, axis=0)) * 0.5
    # OpenGL-Konvention (y nach oben): Bildzeilen laufen nach unten → gy umkehren
    n = np.dstack([-gx * strength * 4, gy * strength * 4, np.ones_like(hgt)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return ((n * 0.5 + 0.5) * 255).round().clip(0, 255).astype(np.uint8)


def ribs(width_px, period, depth, out_w, shape='trapez'):
    """Trapez-/Wellprofil als Höhenfeld (eine Zeile) – scharf statt verwaschen aus dem Video."""
    x = np.arange(out_w) * (width_px / out_w)
    ph = (x / period) % 1.0
    if shape == 'sinus':
        # Wellblech (Hafenhalle im Video: weiche, runde Wellen)
        prof = 0.5 - 0.5 * np.cos(2 * np.pi * ph)
    else:
        # Trapezblech: flacher Gurt, schräge Stege, schmale Sicke
        prof = np.clip(np.abs(ph - 0.5) * 4 - 0.6, 0, 1)
    return (prof - prof.mean()) * depth


def build(sp):
    src = np.load(os.path.join(RECT, sp['src'] + '.npy'))
    x0, y0, x1, y1 = sp.get('crop', [0, 0, src.shape[1], src.shape[0]])
    img = src[y0:y1, x0:x1].astype(np.float32)
    valid = np.isfinite(img[..., 0]) & (img.sum(axis=2) > 1e-5)
    img = np.nan_to_num(img)
    if sp.get('flipY'):
        img = img[::-1]
        valid = valid[::-1]
    mode = sp.get('mode', 'random')
    # Pixel je Meter der Quelle: bei 'quilt' aus srcPpm (Entzerrung), sonst aus Ausschnittbreite / Kachelbreite
    ppm = sp.get('srcPpm') or img.shape[1] / sp['size'][0]
    dl = sp.get('delight', 1.0)
    if valid.mean() < 0.999:
        # ungültige Pixel für die Lichtschätzung mit dem Mittel füllen
        fill = img[valid].mean(axis=0)
        img[~valid] = fill
    img = delight(img, dl * ppm if dl else 0, sp.get('shadow', False))
    period = 0
    if mode == 'stones':
        img, hm = stones_tile(sp, img, valid)
        out = sp.get('out', 1024)
        alb = cv2.resize(img, (out, out), interpolation=cv2.INTER_AREA if img.shape[0] > out else cv2.INTER_CUBIC)
        hgt = cv2.resize(hm, (out, out), interpolation=cv2.INTER_LINEAR)
        tgt = sp.get('color')
        if tgt:
            h = tgt.lstrip('#')
            t = np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)
            t = np.where(t <= 0.04045, t / 12.92, ((t + 0.055) / 1.055) ** 2.4)
            alb = alb / np.maximum(alb.reshape(-1, 3).mean(axis=0), 1e-4)[None, None, :] * t[None, None, :]
        alb = np.clip(alb, 0, 1)
        hgt = hgt * sp.get('height', 3.0) + height_from(alb, {'heightRadius': 4}) * 0.3
        return write_set(sp, alb, hgt, 0)
    if mode == 'lattice':
        img = lattice_tile(sp, img, valid)
        out = sp.get('out', 1024)
        alb = cv2.resize(img, (out, out), interpolation=cv2.INTER_CUBIC)
        if sp.get('sharpen', 0.5):
            alb = alb + sp.get('sharpen', 0.5) * (alb - blur(alb, out / 512))
        tgt = sp.get('color')
        if tgt:
            h = tgt.lstrip('#')
            t = np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)
            t = np.where(t <= 0.04045, t / 12.92, ((t + 0.055) / 1.055) ** 2.4)
            alb = alb / np.maximum(alb.reshape(-1, 3).mean(axis=0), 1e-4)[None, None, :] * t[None, None, :]
        alb = np.clip(alb, 0, 1)
        hgt = height_from(alb, {'heightRadius': out / (sp.get('grid', 12) * 2.5)}) * sp.get('height', 1.0)
        return write_set(sp, alb, hgt, 0)
    if mode == 'cracks':
        alb, hgt = crack_tile(sp, img, valid, ppm)
        tgt = sp.get('color')
        if tgt:
            h = tgt.lstrip('#')
            t = np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)
            t = np.where(t <= 0.04045, t / 12.92, ((t + 0.055) / 1.055) ** 2.4)
            alb = alb / max(1e-4, lum(alb).mean()) * t[None, None, :]
        return write_set(sp, np.clip(alb, 0, 1), hgt, 0)
    if mode == 'brick':
        # Mauerwerk: Schichthöhe messen, quadratische Kachel aus n ganzen Schichten (Schnitt auf Fugenmitte),
        # waagerecht über eine Naht kachelbar (Stoßfugen bleiben, wie sie im Video liegen)
        prof = lum(img).mean(axis=1)
        prof = prof - blur(prof.reshape(-1, 1), 10).ravel()
        ac = np.correlate(prof, prof, 'full')[len(prof) - 1:]
        ac /= max(1e-6, ac[0])
        lo, hi = sp.get('course', [6, 60])
        p = float(lo + np.argmax(ac[lo:hi]))
        sgn = 1 if sp.get('mortarLight', True) else -1
        comb = [np.mean([prof[int(round(k + j * p))] for j in range(int((len(prof) - k - 1) // p))]) * sgn for k in range(int(p))]
        ph = int(np.argmax(comb))
        ox = sp.get('overlap', 0.12)
        n = int(min((img.shape[0] - ph) / p, img.shape[1] / (1 + ox) / p))
        side = int(round(n * p))
        o = int(round(side * ox))
        img = img[ph:ph + side, :side + o]
        img = make_tileable(img, o / (side + o), 0, axes='x')
        sp['size'] = [round(side / ppm, 3), round(side / ppm, 3)]
        print(f"    Schicht {p:.1f} px = {p / ppm * 100:.1f} cm, {n} Schichten → Kachel {sp['size'][0]} m")
    if mode == 'quilt':
        tile_px = int(round(sp['size'][0] * ppm))
        img = quilt(img, valid, tile_px, patch=sp.get('patch', 64), ov=sp.get('ov', 16), seed=sp.get('seed', 1), tol=sp.get('tol', 1.25))
    elif mode == 'ribs-x':
        period = sp.get('rib', {}).get('period') or rib_period(img)
        n = max(1, int((img.shape[1] * 0.85) // period))
        t = int(round(n * period))
        img = img[:, :t]
        # Rippen aus der Albedo nehmen (die Normalen zeichnen sie scharf und lichtabhängig): Spaltenprofil herausteilen
        prof = lum(img).mean(axis=0)
        sm = blur(prof.reshape(1, -1), period).ravel()
        k = sp.get('rib', {}).get('keep', 0.35)
        img = img * ((sm / np.maximum(prof, 1e-4)) ** (1 - k))[None, :, None]
        img = make_tileable(img, oy=0.2, axes='y')
        if sp.get('hreps'):
            img = np.concatenate([img] * int(sp['hreps']), axis=1)
        if sp.get('panel'):
            # Paneel: Breite = Wiederholungen × Periode; Höhe auf dieselbe Metergröße zuschneiden (quadratische Kachel)
            w_m = img.shape[1] / (img.shape[1] / (sp['size'][0] * int(sp.get('hreps', 1))) if False else 1)
            ppm_x = (x1 - x0) / sp['size'][0] if not sp.get('srcPpm') else sp['srcPpm']
            side_m = img.shape[1] / ppm_x
            hpx = int(round(side_m * ppm_x))
            if img.shape[0] >= hpx:
                img = img[:hpx]
            else:
                img = np.concatenate([img] * int(np.ceil(hpx / img.shape[0])), axis=0)[:hpx]
            period_m = period / ppm_x
            print(f"    Paneel {side_m:.2f} m, Periode {period_m * 100:.1f} cm")
        if sp.get('square'):
            # Band senkrecht wiederholen, bis die Kachel quadratisch ist (Wandblech ist senkrecht gleichförmig)
            reps = max(1, int(round(sp['size'][0] / (sp['size'][1] * img.shape[0] / (y1 - y0)))))
            img = np.concatenate([img] * reps, axis=0)
    elif mode == 'random':
        img = make_tileable(img, sp.get('overlap', 0.18), sp.get('overlap', 0.18))
    if sp.get('recolor'):
        # Umfärben (gleiche Struktur, andere Lackfarbe): Helligkeitsdetail × Zielfarbe; Rost/Flecken behalten ihren Anteil
        h = sp['recolor'].lstrip('#')
        tgt = np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)
        tgt = np.where(tgt <= 0.04045, tgt / 12.92, ((tgt + 0.055) / 1.055) ** 2.4)
        L = lum(img)
        Lm = L.mean()
        mean = img.reshape(-1, 3).mean(axis=0)
        # Abweichung vom Lackton (Rost, Schmutz, Aufkleber) als Farbrest erhalten
        rest = img / np.maximum(mean, 1e-4)[None, None, :] - (L / Lm)[..., None]
        k = sp.get('recolorKeep', 0.6)
        img = tgt[None, None, :] * ((L / Lm)[..., None] + k * rest)
        img = np.clip(img, 0, None)
    # Farbabgleich / Helligkeit
    g = np.array(sp.get('gain', [1, 1, 1]), np.float32)
    img = img * g
    if sp.get('albedo'):
        # Ziel-Albedo (linear, Mittel) – Helligkeit des Videos ist Licht × Albedo × Belichtung
        target = sp['albedo']
        img = img * (target / max(1e-4, lum(img).mean()))
    out = sp.get('out', 1024)
    oh = out  # 'fit'-Sätze werden über UV 0..1 auf die Fläche gelegt → quadratisch speichern
    alb = cv2.resize(img, (out, oh), interpolation=cv2.INTER_CUBIC)
    # Detail-Schärfung (das Video ist weich): leichte Unschärfemaske
    if sp.get('sharpen', 0.6):
        alb = alb + sp.get('sharpen', 0.6) * (alb - blur(alb, out / 512))
    alb = np.clip(alb, 0, 1)
    hgt = height_from(alb, sp) * sp.get('height', 1.0) * sp.get('heightSign', 1)
    if mode == 'ribs-x':
        w_px = img.shape[1]
        hrow = ribs(w_px, period, sp.get('rib', {}).get('depth', 6.0), out, sp.get('rib', {}).get('shape', 'trapez'))
        hgt = hgt * 0.4 + hrow[None, :]
    return write_set(sp, alb, hgt, period)


def write_set(sp, alb, hgt, period):
    mode = sp.get('mode', 'random')
    nrm = normals(hgt, sp.get('normal', 2.0))
    # ORM: Verdeckung aus Vertiefungen, Rauheit aus Grundwert ± Helligkeit, Metall fest
    cav = np.clip(-blur(hgt, 1.0) * sp.get('ao', 1.5), 0, 0.6)
    ao = 1 - cav
    rm, rs = sp.get('rough', [0.8, 0.1])
    Ln = lum(alb) / max(1e-4, lum(alb).mean())
    rough = np.clip(rm - (Ln - 1) * rs, 0.05, 1)
    metal = np.full_like(ao, sp.get('metal', 0.0))
    orm = np.dstack([ao, rough, metal])
    d = os.path.join(DST, sp['id'])
    os.makedirs(d, exist_ok=True)
    cv2.imwrite(os.path.join(d, 'albedo.png'), cv2.cvtColor(to_srgb8(alb), cv2.COLOR_RGB2BGR))
    cv2.imwrite(os.path.join(d, 'normal.png'), cv2.cvtColor(nrm, cv2.COLOR_RGB2BGR))
    cv2.imwrite(os.path.join(d, 'orm.png'), cv2.cvtColor((orm * 255).round().clip(0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR))
    meta = {'id': sp['id'], 'src': sp['src'], 'sizeM': sp['size'], 'mode': mode, 'ribPeriodPx': round(float(period), 2) if period else None,
            'avgLinear': [round(float(v), 4) for v in alb.reshape(-1, 3).mean(axis=0)]}
    json.dump(meta, open(os.path.join(d, 'meta.json'), 'w'), indent=1)
    print(f"  {sp['id']}: {alb.shape[1]}×{alb.shape[0]}, Mittel linear {meta['avgLinear']}" + (f", Rippen {period:.1f} px" if period else ''))


if __name__ == '__main__':
    specs = json.load(open(sys.argv[1]))
    only = set(sys.argv[2:])
    for sp in specs:
        if only and sp['id'] not in only:
            continue
        build(sp)
