#!/usr/bin/env python3
# NULLPUNKT — eigener Himmelsgenerator (Nutzer 16.10.: alles selbst machen statt Fotos von Open-Source-Seiten).
# Erzeugt HDR-Rundumbilder (equirect, linear, RGBE .hdr) für jede Tageszeit × Wetterlage:
#   • Atmosphäre: Einfachstreuung nach Nishita (Rayleigh + Mie, Erdkrümmung), Trübung je Wetter
#   • Wolken: Volumen-Raymarching durch eine Wolkenschicht (Perlin-Worley-Rauschen, Beer-Lambert, Henyey-Greenstein,
#     „Powder“-Term, Licht über Schattenproben zur Sonne, Umgebungslicht von oben/unten), Luftperspektive zum Horizont
#   • dünne Federwolken (Dunst) als hohe 2D-Schicht, Bodennebel am Horizont (Morgennebel)
#   • Sonnenscheibe mit Randverdunklung, Boden unter dem Horizont (die Laufzeit ersetzt ihn durch die Kartenfarbe)
# Bildkonvention wie tools/assets/lib/hdr.mjs pixelToDir: dir = (cos θ cos φ, sin θ, cos θ sin φ), φ = (u − ½)·2π.
# Aufruf: python3 tools/assets/skygen.py [ids…] [--preview]   (ohne ids: alle aus SKIES)
# Ausgabe: tools/assets/sky-src/<id>_1k.hdr, <id>_2k.hdr (+ Vorschau-PNG mit --preview)
import os, sys, math, time
import numpy as np
from scipy.ndimage import map_coordinates, zoom

OUT = os.path.join(os.path.dirname(__file__), 'sky-src')

# ------------------------------------------------------------------ Tageszeiten / Wetter (wie world/weather.js)
TIMES = {
    'morgen':     dict(el=10, sunTint=(1.0, 0.86, 0.72)),
    'vormittag':  dict(el=36, sunTint=(1.0, 0.97, 0.92)),
    'mittag':     dict(el=58, sunTint=(1.0, 0.985, 0.96)),
    'nachmittag': dict(el=30, sunTint=(1.0, 0.95, 0.88)),
    'abend':      dict(el=12, sunTint=(1.0, 0.8, 0.6)),
}
# turb: Mie-Faktor (Dunst), cov: Bedeckung, dens: Dichte, base/top: Wolkenschicht (m), cirrus: Federwolken,
# fog: Bodennebel am Horizont (0..1), sky: mittlere Leuchtdichte der oberen Halbkugel (Normierung), seed
WEATHERS = {
    'klar':        dict(turb=1.0, cov=0.3, dens=0.05, base=1300, top=3200, cirrus=0.07, fog=0.0, sky=1.0, seed=3),
    'dunst':       dict(turb=3.2, cov=0.30, dens=0.045, base=1500, top=3000, cirrus=0.55, fog=0.25, sky=0.95, seed=7),
    'morgennebel': dict(turb=4.5, cov=0.2, dens=0.04, base=1700, top=3000, cirrus=0.3, fog=0.75, sky=0.85, seed=11),
    'bewoelkt':    dict(turb=2.2, cov=0.97, dens=0.06, base=700, top=2300, cirrus=0.0, fog=0.15, sky=0.62, seed=5),
}
SKIES = {f'np_sky_{t}_{w}': (t, w) for t in TIMES for w in WEATHERS}

# ------------------------------------------------------------------ Atmosphäre (Nishita, Einfachstreuung)
R_E, R_A = 6360e3, 6420e3
H_R, H_M = 8000.0, 1200.0
BETA_R = np.array([5.8e-6, 13.5e-6, 33.1e-6])
BETA_M0 = 21e-6
G_M = 0.76


def ray_sphere_far(o_y, d, R):
    """Abstand bis zum Austritt aus einer Kugel (Mittelpunkt (0, −R_E, 0)); o = (0, R_E + o_y, 0) relativ zur Mitte."""
    oy = R_E + o_y
    b = oy * d[..., 1]
    c = oy * oy - R * R
    disc = b * b - c
    return -b + np.sqrt(np.maximum(disc, 0.0))


def ray_ground(o_y, d):
    oy = R_E + o_y
    b = oy * d[..., 1]
    c = oy * oy - R_E * R_E
    disc = b * b - c
    t = -b - np.sqrt(np.maximum(disc, 0.0))
    return np.where((disc > 0) & (t > 0), t, np.inf)


def optical_depth_to_sun(pos_h, sun, n=6):
    """pos_h: Höhe (…), Richtung sun (3,) → (…, 2) optische Dicke (Rayleigh, Mie) bis zum Atmosphärenrand."""
    # Position als (0, R_E + h, 0) gedreht – Sonnenwinkel relativ zur lokalen Senkrechten genügt
    mu = sun[1]
    shape = pos_h.shape
    h = pos_h.reshape(-1)
    oy = R_E + h
    b = oy * mu
    c = oy * oy - R_A * R_A
    L = -b + np.sqrt(np.maximum(b * b - c, 0.0))
    ds = L / n
    acc_r = np.zeros_like(h); acc_m = np.zeros_like(h)
    for i in range(n):
        t = (i + 0.5) * ds
        # Höhe entlang des Strahls (Kreisgeometrie)
        hh = np.sqrt(oy * oy + t * t + 2 * oy * t * mu) - R_E
        acc_r += np.exp(-hh / H_R) * ds
        acc_m += np.exp(-hh / H_M) * ds
    # Sonne unter dem Horizont des Punktes → stark gedämpft
    blocked = (mu < 0) & (b * b - (oy * oy - R_E * R_E) > 0)
    acc_r = np.where(blocked, acc_r * 50, acc_r)
    acc_m = np.where(blocked, acc_m * 50, acc_m)
    return np.stack([acc_r, acc_m], -1).reshape(shape + (2,))


def atmosphere(dirs, sun, turb, n=20):
    """dirs (N,3) → Streulicht (N,3) und Durchlässigkeit bis zum Ende des Strahls (N,3); Kamera 2 m über Grund."""
    beta_m = BETA_M0 * turb
    cam_h = 2.0
    t_atm = ray_sphere_far(cam_h, dirs, R_A)
    t_gnd = ray_ground(cam_h, dirs)
    t_max = np.minimum(t_atm, np.minimum(t_gnd, 400e3))
    ds = t_max / n
    oy = R_E + cam_h
    mu_v = dirs[:, 1]
    cos_t = dirs @ sun
    phase_r = 3.0 / (16 * math.pi) * (1 + cos_t ** 2)
    g = G_M
    phase_m = 3.0 / (8 * math.pi) * ((1 - g * g) * (1 + cos_t ** 2)) / ((2 + g * g) * np.power(1 + g * g - 2 * g * cos_t, 1.5))
    sum_r = np.zeros((len(dirs), 3)); sum_m = np.zeros((len(dirs), 3))
    od_r = np.zeros(len(dirs)); od_m = np.zeros(len(dirs))
    for i in range(n):
        t = (i + 0.5) * ds
        h = np.sqrt(oy * oy + t * t + 2 * oy * t * mu_v) - R_E
        hr = np.exp(-h / H_R) * ds
        hm = np.exp(-h / H_M) * ds
        od_r += hr; od_m += hm
        # lokale Sonnenhöhe ≈ wie an der Kamera (Strahlen < 400 km, Krümmungsfehler gering für die Optik)
        ls = optical_depth_to_sun(h, sun)
        tau = BETA_R[None, :] * (od_r[:, None] + ls[:, 0:1]) + beta_m * 1.1 * (od_m[:, None] + ls[:, 1:2])
        att = np.exp(-tau)
        sum_r += att * hr[:, None]
        sum_m += att * hm[:, None]
    L = 22.0 * (sum_r * BETA_R[None, :] * phase_r[:, None] + sum_m * beta_m * phase_m[:, None])
    T = np.exp(-(BETA_R[None, :] * od_r[:, None] + beta_m * 1.1 * od_m[:, None]))
    return L, T


def sun_transmittance(sun, turb, h=2.0):
    od = optical_depth_to_sun(np.array([h]), sun)[0]
    return np.exp(-(BETA_R * od[0] + BETA_M0 * turb * 1.1 * od[1]))


# ------------------------------------------------------------------ Rauschen (kachelbar, 3D)
def worley3(n, cells, rng):
    pts = rng.random((cells, cells, cells, 3))
    g = (np.arange(n) + 0.5) / n * cells
    X, Y, Z = np.meshgrid(g, g, g, indexing='ij')
    ci = np.floor(X).astype(int); cj = np.floor(Y).astype(int); ck = np.floor(Z).astype(int)
    fx = X - ci; fy = Y - cj; fz = Z - ck
    best = np.full(X.shape, 9.0)
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            for dk in (-1, 0, 1):
                p = pts[(ci + di) % cells, (cj + dj) % cells, (ck + dk) % cells]
                dx = di + p[..., 0] - fx; dy = dj + p[..., 1] - fy; dz = dk + p[..., 2] - fz
                best = np.minimum(best, dx * dx + dy * dy + dz * dz)
    return 1.0 - np.clip(np.sqrt(best), 0, 1)


def perlin3(n, cells, rng):
    ang = rng.random((cells, cells, cells, 2)) * 2 * math.pi
    grad = np.stack([np.cos(ang[..., 0]) * np.sin(ang[..., 1] * 0.5 + 0.3), np.sin(ang[..., 0]) * np.sin(ang[..., 1] * 0.5 + 0.3), np.cos(ang[..., 1] * 0.5 + 0.3)], -1)
    g = (np.arange(n) + 0.5) / n * cells
    X, Y, Z = np.meshgrid(g, g, g, indexing='ij')
    i0 = np.floor(X).astype(int); j0 = np.floor(Y).astype(int); k0 = np.floor(Z).astype(int)
    fx = X - i0; fy = Y - j0; fz = Z - k0
    fade = lambda t: t * t * t * (t * (t * 6 - 15) + 10)
    u, v, w = fade(fx), fade(fy), fade(fz)
    out = 0
    for di in (0, 1):
        for dj in (0, 1):
            for dk in (0, 1):
                gr = grad[(i0 + di) % cells, (j0 + dj) % cells, (k0 + dk) % cells]
                dot = gr[..., 0] * (fx - di) + gr[..., 1] * (fy - dj) + gr[..., 2] * (fz - dk)
                wt = (u if di else 1 - u) * (v if dj else 1 - v) * (w if dk else 1 - w)
                out = out + dot * wt
    return out * 0.5 + 0.5


def remap(x, a, b, c, d):
    return c + (x - a) / (b - a) * (d - c)


def cloud_textures(seed):
    cache = os.path.join(OUT, f'_noise2_{seed}.npz')
    if os.path.exists(cache):
        z = np.load(cache)
        return z['base'], z['detail']
    rng = np.random.default_rng(seed)
    n = 128
    pf = perlin3(n, 4, rng) * 0.5 + perlin3(n, 8, rng) * 0.3 + perlin3(n, 16, rng) * 0.2
    wf = worley3(n, 6, rng) * 0.625 + worley3(n, 12, rng) * 0.25 + worley3(n, 24, rng) * 0.125
    base = np.clip(remap(pf, wf - 1.0, 1.0, 0.0, 1.0), 0, 1)  # Perlin-Worley
    nd = 64
    detail = worley3(nd, 4, rng) * 0.625 + worley3(nd, 8, rng) * 0.25 + worley3(nd, 16, rng) * 0.125
    os.makedirs(OUT, exist_ok=True)
    np.savez_compressed(cache, base=base.astype(np.float32), detail=detail.astype(np.float32))
    return base.astype(np.float32), detail.astype(np.float32)


def sample(tex, p, period):
    n = tex.shape[0]
    c = (p / period) * n
    return map_coordinates(tex, [c[..., 0].ravel(), c[..., 1].ravel(), c[..., 2].ravel()], order=1, mode='grid-wrap').reshape(p.shape[:-1])


# ------------------------------------------------------------------ Wolken
def clouds(dirs, sun, W, T, sky_up, sky_hz, sun_col, rng, off):
    """dirs (N,3) mit dirs.y > 0 → (Streulicht (N,3), Durchlässigkeit (N,), mittlere Entfernung (N,))."""
    base_tex, det_tex = cloud_textures(W['seed'])
    hb, ht = W['base'], W['top']
    cov, dens = W['cov'], W['dens']
    PER_B, PER_D = 14000.0, 3200.0  # Wiederholung der Rauschkacheln (m)
    dy = np.maximum(dirs[:, 1], 0.012)
    t0 = hb / dy
    t1 = ht / dy
    t1 = np.minimum(t1, t0 + 9000.0)  # flache Strahlen: nicht endlos durch die Schicht
    steps = 30
    ds = (t1 - t0) / steps
    T_acc = np.ones(len(dirs))
    S = np.zeros((len(dirs), 3))
    dist_w = np.zeros(len(dirs)); w_sum = np.zeros(len(dirs))
    jitter = rng.random(len(dirs))
    g1, g2 = 0.6, -0.25
    cos_t = dirs @ sun
    hg = lambda g: (1 - g * g) / (4 * math.pi * np.power(1 + g * g - 2 * g * cos_t, 1.5))
    phase = 0.7 * hg(g1) + 0.3 * hg(g2)
    ext_k = 1.0
    for i in range(steps):
        t = t0 + (i + jitter) * ds
        p = dirs * t[:, None] + off
        hn = np.clip((p[:, 1] - off[1] - hb) / (ht - hb), 0, 1)
        if cov > 0.9:
            prof = np.clip(hn / 0.08, 0, 1) * np.clip((1 - hn) / 0.5, 0, 1)  # Schichtwolke: oben weich
        else:
            prof = np.clip(hn / 0.07, 0, 1) * np.clip((1 - hn) / 0.55, 0, 1) ** 1.3  # Haufenwolke: flacher Boden
        pp = np.stack([p[:, 0], p[:, 1] * 1.6, p[:, 2]], -1)
        b = sample(base_tex, pp, PER_B)
        # steile Rampe → knackige Wolkenränder statt Schleier
        d = np.clip(remap(b * prof, 1 - cov, 1 - cov + 0.3 * max(cov, 0.25), 0.0, 1.0), 0, 1)
        live = d > 0.001
        if live.any():
            det = sample(det_tex, pp[live], PER_D) * 0.65 + sample(det_tex, pp[live] + 911.0, 760.0) * 0.35
            d[live] = np.clip(remap(d[live], det * (0.2 if cov > 0.9 else 0.5), 1.0, 0.0, 1.0), 0, 1)
        sigma = d * dens * ext_k
        if not (sigma > 1e-6).any():
            continue
        # Schatten zur Sonne: drei Proben
        tau_s = np.zeros(len(dirs))
        for k, dd in enumerate((120.0, 380.0, 900.0)):
            q = pp + np.array([sun[0], sun[1] * 1.6, sun[2]]) * dd
            hq = np.clip((q[:, 1] / 1.6 - off[1] - hb) / (ht - hb), 0, 1)
            prof_q = np.clip(hq / 0.08, 0, 1) * np.clip((1 - hq) / 0.55, 0, 1)
            dq = np.clip(remap(sample(base_tex, q, PER_B) * prof_q, 1 - cov, 1.0, 0.0, 1.0), 0, 1)
            tau_s += dq * dens * (dd if k == 0 else (260.0 if k == 1 else 520.0))
        beer = np.exp(-tau_s) * 0.75 + np.exp(-tau_s * 0.25) * 0.25  # Vielfachstreuung (Mehrfach-Oktave)
        powder = 1 - np.exp(-2 * sigma * ds * 0.5)
        Ls = sun_col[None, :] * (beer * phase * (0.6 + 0.4 * powder))[:, None] * 2.4
        amb = (sky_up[None, :] * (0.55 + 0.45 * hn)[:, None] + sky_hz[None, :] * 0.35 * (1 - hn)[:, None]) * (0.42 + 0.3 * hn)[:, None]
        if cov > 0.9:
            # Schichtwolke: Licht dringt diffus durch die ganze Decke – Helligkeit der Unterseite folgt der Säulendichte
            # darüber (dünne Stellen hell, dicke dunkel) statt der Vorwärtsstreuung um die Sonne
            col = np.zeros(len(dirs))
            for fr in (0.3, 0.55, 0.8):
                qy = off[1] + hb + fr * (ht - hb)
                qq = np.stack([pp[:, 0], np.full(len(dirs), qy * 1.6), pp[:, 2]], -1)
                col += sample(base_tex, qq, PER_B)
            thin = np.exp(-np.clip(col / 3 - 0.3, 0, 1) * 4.5)
            Ld = sun_col[None, :] * (0.06 + 0.62 * thin)[:, None] * (0.35 + 0.65 * hn)[:, None]
            Lc = Ld + amb * 1.25 + Ls * 0.15
        else:
            Lc = Ls + amb
        a = np.exp(-sigma * ds)
        S += (T_acc * (1 - a))[:, None] * Lc
        dist_w += T_acc * (1 - a) * t; w_sum += T_acc * (1 - a)
        T_acc *= a
    dist = np.where(w_sum > 1e-4, dist_w / np.maximum(w_sum, 1e-6), t0)
    return S, T_acc, dist


def cirrus(dirs, rng, amount, seed):
    """Hohe Federwolken: 2D-Schicht bei 8 km, gestrecktes Rauschen → Deckungsgrad (N,)."""
    if amount <= 0:
        return np.zeros(len(dirs))
    r2 = np.random.default_rng(seed + 100)
    n = 256
    tex = np.zeros((n, n))
    for oct_, w in ((4, 0.5), (8, 0.3), (16, 0.2)):
        g = r2.random((oct_, oct_))
        tex += zoom(np.tile(g, (3, 3)), n / oct_, order=3)[n:2 * n, n:2 * n] * w
    dy = np.maximum(dirs[:, 1], 0.02)
    t = 8000.0 / dy
    x = dirs[:, 0] * t / 30000.0; z = dirs[:, 2] * t / 9000.0  # gestreckt
    v = map_coordinates(tex, [(x * n) % n, (z * n) % n], order=1, mode='grid-wrap')
    c = np.clip((v - 0.52) / 0.2, 0, 1) * amount
    return c * np.clip((dirs[:, 1] - 0.02) / 0.15, 0, 1)


# ------------------------------------------------------------------ Bild bauen
def build(tid, wid, W_px=2048):
    t0 = time.time()
    T = TIMES[tid]; Wd = WEATHERS[wid]
    rng = np.random.default_rng(Wd['seed'] * 31 + list(TIMES).index(tid))
    H_px = W_px // 2
    el = math.radians(T['el'])
    sun = np.array([math.cos(el), math.sin(el), 0.0])  # φ = 0 (Bildmitte)
    # 1) Atmosphäre auf grobem Raster, dann hochskaliert (glatt)
    ga, ha = 256, 128
    u = (np.arange(ga) + 0.5) / ga; v = 1 - (np.arange(ha) + 0.5) / ha
    phi = (u - 0.5) * 2 * math.pi; th = (v - 0.5) * math.pi
    PH, TH = np.meshgrid(phi, th)
    D = np.stack([np.cos(TH) * np.cos(PH), np.sin(TH), np.cos(TH) * np.sin(PH)], -1).reshape(-1, 3)
    La, Ta = atmosphere(D, sun, Wd['turb'])
    La = La.reshape(ha, ga, 3)
    sky = np.stack([zoom(La[..., c], (H_px / ha, W_px / ga), order=1) for c in range(3)], -1)
    # 2) Richtungen in voller Auflösung
    u = (np.arange(W_px) + 0.5) / W_px; v = 1 - (np.arange(H_px) + 0.5) / H_px
    phi = (u - 0.5) * 2 * math.pi; th = (v - 0.5) * math.pi
    PH, TH = np.meshgrid(phi, th)
    dirs = np.stack([np.cos(TH) * np.cos(PH), np.sin(TH), np.cos(TH) * np.sin(PH)], -1)
    # Sonnenfarbe (durch die Atmosphäre), Himmelsfarben für das Wolken-Umgebungslicht
    sun_T = sun_transmittance(sun, Wd['turb'])
    sun_col = sun_T * np.array(T['sunTint']) * 9.0
    up = sky[: H_px // 6].reshape(-1, 3).mean(0)
    hz = sky[H_px // 2 - H_px // 30: H_px // 2].reshape(-1, 3).mean(0)
    # 3) Wolken (nur über dem Horizont), blockweise
    img = sky.copy()
    upper = dirs[..., 1] > 0.0
    idx = np.argwhere(upper)
    flat = dirs[upper]
    Sc = np.zeros((len(flat), 3)); Tc = np.ones(len(flat)); Dc = np.zeros(len(flat))
    CH = 120000
    off = np.array([3170.0, 0.0, -1210.0]) + rng.random(3) * 5000  # Rauschversatz einmal je Himmel (nicht je Block)
    for s in range(0, len(flat), CH):
        e = min(len(flat), s + CH)
        a, b, c = clouds(flat[s:e], sun, Wd, T, up, hz, sun_col, rng, off)
        Sc[s:e], Tc[s:e], Dc[s:e] = a, b, c
    # Luftperspektive: ferne Wolken verschwimmen im Horizontdunst
    fade = np.exp(-Dc / (38000.0 / max(0.6, Wd['turb'] ** 0.5)))
    base_sky = img[upper]
    cl = base_sky * Tc[:, None] + Sc
    cl = base_sky + (cl - base_sky) * fade[:, None]
    # Federwolken
    ci = cirrus(flat, rng, Wd['cirrus'], Wd['seed'])
    cir_col = sun_col * 0.11 + up * 0.9
    cl = cl * (1 - ci[:, None] * 0.6) + cir_col[None, :] * ci[:, None] * 0.6
    img[upper] = cl
    # Rauschen der Schrittverteilung an den Wolkenrändern glätten (nur über dem Horizont, vor der Sonnenscheibe)
    import cv2
    top = img[: H_px // 2].astype(np.float32)
    img[: H_px // 2] = cv2.GaussianBlur(top, (0, 0), 0.9 * W_px / 2048, borderType=cv2.BORDER_REFLECT)
    # 4) Sonnenscheibe (Randverdunklung), durch Wolken gedämpft
    cos_s = (dirs.reshape(-1, 3) @ sun).reshape(H_px, W_px)
    ang = np.arccos(np.clip(cos_s, -1, 1))
    R_SUN = math.radians(0.27)
    disk = np.clip(1 - (ang / R_SUN) ** 2, 0, 1)
    limb = np.sqrt(disk) * 0.7 + 0.3
    Tsun = np.ones((H_px, W_px)); Tsun[upper] = Tc
    sun_rad = sun_T * np.array(T['sunTint']) * 9000.0
    img += (disk > 0)[..., None] * (limb * Tsun)[..., None] * sun_rad[None, None, :]
    # 5) Bodennebel/Dunstband am Horizont
    if Wd['fog'] > 0:
        f = np.exp(-np.maximum(dirs[..., 1], 0) / 0.05) * Wd['fog']
        fog_col = hz * 1.05 + sun_col * 0.02 * np.clip(cos_s, 0, 1)[..., None] ** 4
        img = img * (1 - f[..., None]) + fog_col * f[..., None]
    # 6) Boden (unter dem Horizont): neutral, sonnenbeschienen, weicher Übergang
    gnd = (sun_col * max(0.0, math.sin(el)) * 0.12 + up * 0.25) * np.array([0.95, 0.93, 0.88])
    below = np.clip(-dirs[..., 1] / 0.03, 0, 1)
    img = img * (1 - below[..., None]) + gnd[None, None, :] * below[..., None]
    # 7) Normieren: mittlere Leuchtdichte der oberen Halbkugel (Raumwinkel-gewichtet, ohne Sonnenscheibe)
    Lm = img[..., 0] * 0.2126 + img[..., 1] * 0.7152 + img[..., 2] * 0.0722
    wgt = np.cos(th)[:, None] * np.ones((1, W_px))
    mask = (dirs[..., 1] > 0) & (disk <= 0)
    k = Wd['sky'] * (0.55 + 0.45 * min(1.0, math.sin(el) / math.sin(math.radians(36)))) / (np.sum(Lm * wgt * mask) / np.sum(wgt * mask))
    img *= k
    print(f'  {tid}/{wid}: {time.time() - t0:.0f}s, Sonne {T["el"]}°, Faktor {k:.3f}', flush=True)
    return img.astype(np.float32)


def write_hdr(path, img):
    import cv2
    cv2.imwrite(path, img[..., ::-1].astype(np.float32))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    preview = '--preview' in sys.argv
    ids = args or list(SKIES)
    os.makedirs(OUT, exist_ok=True)
    for sid in ids:
        tid, wid = SKIES[sid]
        img2 = build(tid, wid, 2048)
        write_hdr(os.path.join(OUT, f'{sid}_2k.hdr'), img2)
        img1 = cv2_resize(img2, 1024, 512)
        write_hdr(os.path.join(OUT, f'{sid}_1k.hdr'), img1)
        if preview:
            from PIL import Image
            x = img1 * 0.9 / 0.6
            x = x / (1 + x)  # einfache Kurve für die Vorschau
            Image.fromarray((np.clip(x, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)).save(os.path.join(OUT, f'{sid}_preview.png'))


def cv2_resize(img, w, h):
    import cv2
    return cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)


if __name__ == '__main__':
    main()
