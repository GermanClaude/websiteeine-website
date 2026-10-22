// NULLPUNKT — Geräteprofil für „Grafikqualität: Automatisch“ (21.10., Nutzer: „extremes Ruckeln, teils nur ~10 FPS“).
//
// Bisher entschied 'auto' nur nach Touch, Speicher und Kernen: jeder Desktop mit > 4 GB – auch Laptops mit Intel-HD-
// Grafik oder ein Browser ohne GPU-Beschleunigung – startete auf „hoch“ (GTAO, SMAA, Bloom, 2048er-Schatten,
// Pixelverhältnis 1,5) und blieb das ganze erste Match dort, weil Stufen nur zwischen Matches sinken. Jetzt:
//  1. GPU-Name (WEBGL_debug_renderer_info, sonst RENDERER) → Klasse mit Obergrenze: Software/VM → niedrig,
//     Intel HD/UHD → niedrig, Iris/Radeon-APU → mittel, Mobil-GPUs nach Generation, sonst wie bisher. Firefox meldet
//     nur Stellvertreter-Namen („…, or similar“) – dort zählen nur eindeutige Gruppen. Telefone/Tablets starten nie
//     über der bisherigen Regel nach Speicher/Kernen; die GPU-Klasse ist dort nur die Obergrenze fürs Hochstufen.
//  2. Kurzer GPU-Test beim ersten Start (unsichtbar, im Ladebildschirm „Prüfe Grafik …“): ein Vollbild-Shader mit
//     16 Texturzugriffen je Pixel in ein 512er-Ziel, Zeit bis readPixels → ms je Megapixel; daraus die geschätzte
//     Bildzeit je Stufe bei der Bildschirmauflösung dieses Geräts. Der Test senkt nur die Startstufe – er ist keine
//     Obergrenze (eine einzelne Messung im Leerlauftakt, im Akkubetrieb oder unter Last darf ein starkes Gerät nicht
//     dauerhaft deckeln) und wird nach 14 Tagen wiederholt, solange keine Stufe aus Matches gelernt ist.
//  3. Was die Matches lernen (Stufe runter bei Dauerlast, einmal hoch bei Reserve), wird gemerkt
//     (localStorage 'nullpunkt:geraet') und gilt vor dem GPU-Test – der nächste Besuch startet gleich auf der passenden
//     Stufe, höchstens auf der Obergrenze.
// Alles bleibt lokal im Browser (kein Versand); „Lokale Daten löschen“ auf der Website entfernt es mit.
import * as THREE from 'three';

const KEY = 'nullpunkt:geraet';
const VERSION = 1;
export const TIERS = ['low', 'medium', 'high', 'ultra'];
const idx = (t) => Math.max(0, TIERS.indexOf(t));
const minTier = (a, b) => (idx(a) <= idx(b) ? a : b);

/* ------------------------------------------------------------ Speicher */

function store() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export function loadProfile() {
  const s = store();
  if (!s) return null;
  try {
    const p = JSON.parse(s.getItem(KEY) || 'null');
    return p && p.v === VERSION ? p : null;
  } catch { return null; }
}

function saveProfile(p) {
  const s = store();
  if (!s) return;
  try { s.setItem(KEY, JSON.stringify({ ...p, v: VERSION })); } catch { /* voll/gesperrt: nur diese Sitzung */ }
}

/* ------------------------------------------------------------ Gerät */

/** Touch/Speicher/Kerne/Bildschirm (ohne GPU). */
export function deviceInfo() {
  if (typeof window === 'undefined') return { touch: false, mem: 0, cores: 0, short: 0, long: 0, dpr: 1 };
  const mm = (q) => !!(window.matchMedia && window.matchMedia(q).matches);
  const coarse = mm('(pointer: coarse)');
  const fine = mm('(pointer: fine)');
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const sw = (window.screen && window.screen.width) || window.innerWidth || 0;
  const sh = (window.screen && window.screen.height) || window.innerHeight || 0;
  return {
    touch: coarse || (nav.maxTouchPoints > 0 && !fine),
    mem: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : 0,
    cores: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 0,
    short: Math.min(sw, sh), long: Math.max(sw, sh),
    dpr: window.devicePixelRatio || 1,
  };
}

/**
 * Bisherige Regel (nur Gerätewerte): Telefone/Tablets low (Spitzengeräte mit ≥ 8 GB/8 Kernen und große Tablets mit
 * ≥ 8 Kernen medium), schwache Desktops medium, sonst high.
 */
export function heuristicTier(d = deviceInfo()) {
  if (d.touch) {
    if (d.mem >= 8 && d.cores >= 8) return 'medium';
    // textures-2: Tablets mit großer, dichter Anzeige (kurze Seite ≥ 700 CSS-px, DPR ≥ 2) und ≥ 8 Kernen – auch iPadOS
    // (kein deviceMemory) bzw. 6-GB-Android (meldet 4) – starten auf medium. Telefone bleiben low.
    if (d.short >= 700 && d.dpr >= 2 && d.cores >= 8 && (d.mem === 0 || d.mem >= 4)) return 'medium';
    return 'low';
  }
  if ((d.mem && d.mem <= 4) || (d.cores && d.cores <= 2)) return 'medium';
  return 'high';
}

/** GPU-Name aus dem Kontext (leer, wenn der Browser ihn verbirgt). */
export function gpuName(gl) {
  if (!gl) return '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return String(r || '').slice(0, 160);
  } catch { return ''; }
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|lavapipe|mesa offscreen|svga3d|vmware|virtualbox|parallels|virgl/;

/**
 * GPU-Klasse → Obergrenze der Stufe (null = unbekannt, dann gilt heuristicTier). touch: Telefon/Tablet.
 * Bewusst grob: der GPU-Test und das Lernen aus den Matches korrigieren im Einzelfall.
 */
export function classifyGpu(name, { touch = false, short = 0 } = {}) {
  const s = String(name || '').toLowerCase();
  if (!s || s === 'webkit webgl' || s === 'mozilla' || s === 'generic renderer') return { cls: 'unbekannt', cap: null };
  if (SOFTWARE.test(s)) return { cls: 'software', cap: 'low' };
  if (/, or similar$/.test(s)) return classifySanitized(s, { touch, short });
  // Mobil. Adreno 6xx–8xx: die hinteren Ziffern sind die Klasse innerhalb der Generation (702/710 Einstieg, 740/750
  // Spitze; 610/618 schwächer als 540) – die Nummer steigt nicht einfach mit der Leistung
  let m = s.match(/adreno[^0-9]*(\d)(\d{2})/);
  if (m) { const gen = +m[1], sub = +m[2]; return { cls: 'adreno', cap: (gen >= 7 ? sub >= 20 : gen === 6 && sub >= 40) ? 'medium' : 'low' }; }
  if (/immortalis|xclipse/.test(s)) return { cls: 'mobil-hoch', cap: 'medium' };
  m = s.match(/mali-?g(\d{2,3})/);
  if (m) { const n = +m[1]; return { cls: 'mali', cap: n >= 610 || (n >= 76 && n < 100) ? 'medium' : 'low' }; }
  if (/mali|powervr|img |vivante|tegra|videocore/.test(s)) return { cls: 'mobil-schwach', cap: 'low' };
  if (/apple/.test(s)) {
    if (touch) return { cls: 'apple-mobil', cap: short >= 700 ? 'medium' : 'low' };
    return { cls: 'apple', cap: 'high' };
  }
  // Intel
  if (/intel/.test(s)) {
    if (/\barc\b/.test(s)) return { cls: 'intel-arc', cap: 'high' };
    if (/iris|xe graphics|\(adl|\(rpl|\(mtl|\(lnl|\(tgl/.test(s)) return { cls: 'intel-iris', cap: 'medium' };
    if (/hd graphics|uhd graphics|hd \d{3,4}|gma|bay ?trail|cherry ?trail|\(hsw|\(bdw|\(skl|\(kbl|\(cfl|\(cml|\(glk|\(jsl|\(ehl|\(icl/.test(s)) return { cls: 'intel-hd', cap: 'low' };
    return { cls: 'intel', cap: 'medium' };
  }
  // AMD (R9 2xx/3xx sind eigene Grafikkarten, keine APU)
  if (/radeon|amd/.test(s)) {
    if ((/rx ?\d{3,4}|radeon pro|radeon vii|\br9 (\d{3}|fury|nano)|vega (56|64)|frontier/.test(s)) && !/rx ?(5[0-6]\d|4[0-6]\d)\b/.test(s)) return { cls: 'amd', cap: 'high' };
    if (/\b(680m|780m|880m|890m|8060s)\b/.test(s)) return { cls: 'amd-apu-hoch', cap: 'high' };
    return { cls: 'amd-apu', cap: 'medium' }; // Radeon(TM) Graphics, Vega 3–11, ältere HD/R5–R7
  }
  // NVIDIA
  if (/nvidia|geforce|quadro|rtx|gtx|tesla/.test(s)) {
    if (/geforce (mx|gt \d|9\d0m|8\d\dm|7\d\dm|6\d\dm)|geforce \d{3}m\b|quadro (k|m|p)\d{3,4}m?\b|nvs /.test(s)) return { cls: 'nvidia-schwach', cap: 'medium' };
    return { cls: 'nvidia', cap: 'high' };
  }
  return { cls: 'unbekannt', cap: null };
}

/**
 * Firefox (dom/canvas/SanitizeRenderer.cpp) meldet statt des echten Namens einen Stellvertreter seiner Gruppe mit dem
 * Zusatz „, or similar“: jede moderne Radeon (RX, Vega, Rembrandt/Renoir-APU, 780M) → „Radeon R9 200 Series“, Ryzen-APUs
 * mit „Radeon(TM) Graphics“ → „Radeon HD 3200 Graphics“, GeForce ab 900/RTX → „GeForce GTX 980“, Iris Xe und HD 2000–4600
 * → „Intel(R) HD Graphics“, HD/UHD/Iris Plus 5xx–7xx → „Intel(R) HD Graphics 400“, jede Adreno ab 600 → „Adreno (TM) 650“,
 * Mali nach Ziffern vermengt (G78 → „Mali-G51“, G710 → „Mali-T760“). Nur eindeutige Gruppen werden übernommen; bei
 * vermengten gilt keine (null: Gerätewerte + GPU-Test) bzw. eine vorsichtige Obergrenze.
 */
function classifySanitized(s, { touch, short }) {
  if (/apple/.test(s)) return touch ? { cls: 'apple-mobil', cap: short >= 700 ? 'medium' : 'low' } : { cls: 'apple', cap: 'high' };
  if (/\barc\b|arc\(tm\)/.test(s)) return { cls: 'intel-arc', cap: 'high' };
  if (/intel/.test(s)) return { cls: 'intel-ff', cap: 'medium' }; // Iris Xe bis HD 4000 bzw. UHD 620 bis Iris Plus
  if (/radeon r9 200 series/.test(s)) return { cls: 'amd-ff', cap: null }; // RX 6800 XT ebenso wie Vega-8-APU
  if (/radeon|amd/.test(s)) return { cls: 'amd-apu', cap: 'medium' }; // „HD 3200“ (Radeon(TM) Graphics, sehr alt), „HD 5850“
  if (/tegra/.test(s)) return { cls: 'mobil-schwach', cap: 'low' };
  if (/gtx 980/.test(s)) return { cls: 'nvidia', cap: 'high' }; // GeForce ab 900, RTX, Quadro M/P/T
  if (/gtx 480|8800/.test(s)) return { cls: 'nvidia-schwach', cap: 'medium' }; // Fermi/Kepler, MX 1xx–5xx, unbekannt
  if (/adreno \(tm\) (540|430|330|225)\b/.test(s)) return { cls: 'adreno', cap: 'low' };
  if (/mali-400/.test(s)) return { cls: 'mali', cap: 'low' };
  if (/powervr|vivante|videocore/.test(s)) return { cls: 'mobil-schwach', cap: 'low' };
  if (/xclipse/.test(s)) return { cls: 'mobil-hoch', cap: 'medium' };
  return { cls: touch ? 'mobil-ff' : 'unbekannt-ff', cap: null }; // Adreno 6xx–7xx, Mali-G…, X1-45
}

/* ------------------------------------------------------------ GPU-Test */

const BENCH_VS = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
// ≈ ein beleuchteter, texturierter Pixel der Welt × 4: 16 abhängige Texturzugriffe, Normalen, Glanzlicht
const BENCH_FS = /* glsl */ `
precision highp float;
uniform sampler2D uTex;
uniform float uT;
in vec2 vUv;
out vec4 oColor;
void main() {
  vec3 c = vec3(0.0);
  vec2 uv = vUv;
  vec3 L = normalize(vec3(0.3, 0.8, 0.5)), H = normalize(vec3(-0.2, 0.6, 0.7));
  for (int i = 0; i < 16; i++) {
    vec4 t = texture(uTex, uv * (1.0 + float(i) * 0.37) + uT);
    vec3 n = normalize(t.xyz * 2.0 - 1.0 + vec3(0.0, 0.0, 1.0));
    float d = max(dot(n, L), 0.0);
    float s = pow(max(dot(reflect(-n, vec3(0.0, 0.0, 1.0)), H), 0.0), 16.0 + t.w * 32.0);
    c += t.rgb * d + s * 0.1;
    uv += n.xy * 0.013;
  }
  oColor = vec4(c * 0.0625, 1.0);
}`;

/**
 * GPU-Test mit dem vorhandenen Renderer (kein zweiter Kontext). → { msPerMpix, ms, passes } | null
 * Dauer ≈ 30–150 ms; Zustand des Renderers (Ziel, autoClear) bleibt erhalten. Ablauf: zwei Pässe zum Übersetzen und
 * Aufwärmen (GPU aus dem Leerlauftakt), dann höchstens drei Messungen mit je einer Synchronisierung (readPixels) am
 * Ende – die Passzahl richtet sich nach der ersten Messung (≈ 25 ms GPU-Arbeit je Messung, im Rahmen von maxMs); eine
 * sehr langsame GPU bricht nach der ersten Messung ab. Bester Wert zählt.
 */
export function measureGpu(renderer, { size = 512, maxMs = 400 } = {}) {
  if (!renderer || typeof renderer.readRenderTargetPixels !== 'function') return null;
  const t00 = performance.now();
  const noise = new Uint8Array(64 * 64 * 4);
  let seed = 7;
  for (let i = 0; i < noise.length; i++) { seed = (seed * 1103515245 + 12345) >>> 0; noise[i] = seed >>> 24; }
  const tex = new THREE.DataTexture(noise, 64, 64, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const target = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false, stencilBuffer: false });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: BENCH_VS, fragmentShader: BENCH_FS,
    uniforms: { uTex: { value: tex }, uT: { value: 0 } }, depthTest: false, depthWrite: false,
    blending: THREE.AdditiveBlending, transparent: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  const cam = new THREE.Camera();
  const px = new Uint8Array(4);
  const prevTarget = renderer.getRenderTarget();
  const prevAuto = renderer.autoClear;
  let result = null;
  try {
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    let k = 0;
    const draw = (n) => { for (let i = 0; i < n; i++) { mat.uniforms.uT.value = (k++ * 0.173) % 1; renderer.render(mesh, cam); } };
    const sync = () => renderer.readRenderTargetPixels(target, 0, 0, 1, 1, px); // wartet, bis die GPU fertig ist
    draw(2); sync(); // Übersetzen, Hochladen, Aufwärmen
    let n = 4, best = Infinity, passes = 0;
    for (let round = 0; round < 3; round++) {
      const used = performance.now() - t00;
      if (round > 0 && used > maxMs) break;
      const t0 = performance.now();
      draw(n); sync();
      const ms = performance.now() - t0;
      const per = Math.max(1e-3, ms / n);
      if (per < best) { best = per; passes = n; }
      if (per > 8) break; // ≥ 30 ms/MPx: eindeutig schwach, weitere Runden kosten hier nur Ladezeit
      const left = maxMs - (performance.now() - t00);
      n = Math.max(2, Math.min(96, Math.round(25 / per), Math.floor(left / per)));
    }
    if (Number.isFinite(best) && best > 0) result = { msPerMpix: Math.round((best / ((size * size) / 1e6)) * 1000) / 1000, passes, ms: Math.round(performance.now() - t00) };
  } catch {
    result = null;
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAuto;
    target.dispose(); geo.dispose(); mat.dispose(); tex.dispose();
  }
  return result;
}

/**
 * Geschätzte Kosten einer Stufe je Megapixel Ausgabe in „Testpässen“ (16 Texturzugriffe) – Szene samt Überzeichnung,
 * Schatten und Nachbearbeitung. Grob (± Faktor 2): Verhältnis der Stufen aus SwiftShader (Hafen: niedrig : hoch ≈ 1 : 2–3,
 * dort überwiegt die Eckenarbeit), Absolutwert aus der Rechenleistung bekannter GPUs (Testpass ≈ 500 FLOP/Pixel): eine
 * GTX 1060 (≈ 0,2 ms/MPx) schafft „hoch“ in 1080p, Intel UHD 620 (≈ 1,7) nur „niedrig“. Genügt, um deutlich zu
 * schwache GPUs zu erkennen; den Rest regeln dynamische Auflösung, Entlastung und das Lernen aus den Matches.
 */
export const TIER_COST = Object.freeze({ low: 5, medium: 10, high: 14, ultra: 22 });
const TIER_PR = { low: 1.5, medium: 1.25, high: 1.5, ultra: 2 };

/** Höchste Stufe, deren geschätzte GPU-Zeit ins Bildbudget passt (Touch 30 FPS, sonst 60 FPS; dynamische Auflösung fängt ≈ 30 % ab). */
export function benchTier(msPerMpix, d = deviceInfo(), { width = 0, height = 0 } = {}) {
  if (!(msPerMpix > 0)) return null;
  const w = width || (typeof window !== 'undefined' ? window.innerWidth : 1280) || 1280;
  const h = height || (typeof window !== 'undefined' ? window.innerHeight : 720) || 720;
  const budget = (d.touch ? 33.3 : 16.7) * 1.3;
  let tier = 'low';
  for (const t of ['medium', 'high']) {
    const pr = Math.min(d.dpr || 1, TIER_PR[t]);
    const mpix = (w * h * pr * pr) / 1e6;
    if (msPerMpix * mpix * TIER_COST[t] <= budget) tier = t;
  }
  return tier;
}

/* ------------------------------------------------------------ Entscheidung */

let decided = null; // { tier, reason, gpu, cls, bench } – gilt für diese Sitzung (resolveQuality('auto'))

/** Zuletzt getroffene Entscheidung (oder null vor createRenderer). */
export function autoDecision() { return decided; }

/** Vorläufige Stufe vor dem Kontext (gemerktes Profil, sonst Gerätewerte) – für Kontext-Optionen wie MSAA. */
export function provisionalTier() {
  if (decided) return decided.tier;
  const p = loadProfile();
  const h = heuristicTier();
  return p && p.tier ? minTier(p.tier, h) : h;
}

const BENCH_MAX_AGE = 14 * 864e5; // GPU-Test nach 14 Tagen wiederholen (solange keine Stufe gelernt ist)

/**
 * Stufe für 'auto' mit dem echten Kontext festlegen: GPU-Klasse (→ Obergrenze), Gerätewerte, ggf. GPU-Test (nur
 * ohne gelernte Stufe und ohne frischen Wert), gelernte Stufe. bench: false = Test überspringen (Prüfseiten, Start mit
 * fester Stufe – `pending` meldet dann, dass er bei „Automatisch“ nachzuholen ist).
 */
export function decideAuto(renderer, { bench = true } = {}) {
  const d = deviceInfo();
  const gl = renderer && typeof renderer.getContext === 'function' ? renderer.getContext() : null;
  const gpu = gpuName(gl);
  const { cls, cap } = classifyGpu(gpu, d);
  let p = loadProfile();
  if (!p || p.gpu !== gpu) p = { gpu, bench: null, learned: null };
  const reasons = [];
  const heur = heuristicTier(d);
  // Obergrenze (auch fürs Hochstufen nach Matches mit Reserve): bekannte GPU-Klasse, sonst die Gerätewerte; Telefone/
  // Tablets höchstens medium. Speicher und Kerne begrenzen unabhängig von der GPU (Android meldet 6 GB als 4 – daher
  // dort erst ab ≤ 2 GB). Der GPU-Test zählt hier bewusst nicht mit.
  let ceiling = cap ? (d.touch ? minTier(cap, 'medium') : cap) : heur;
  if (d.mem && d.mem <= 2) ceiling = 'low';
  else if (!d.touch && ((d.mem && d.mem <= 4) || (d.cores && d.cores <= 2))) ceiling = minTier(ceiling, 'medium');
  if (ceiling === 'ultra') ceiling = 'high'; // ultra nie automatisch
  // Startstufe: Desktop = Obergrenze. Telefone/Tablets zusätzlich nach Speicher/Kernen wie bisher – eine neuere GPU-
  // Generation allein hebt ein 4-GB-Telefon nicht auf „mittel“, erst ein Match mit Reserve
  let tier = d.touch ? minTier(ceiling, heur) : ceiling;
  if (cap && idx(cap) < idx(heur)) reasons.push(`GPU ${cls}`);
  if (cls === 'software') reasons.push('ohne GPU-Beschleunigung');
  const learned = TIERS.includes(p.learned) ? p.learned : null;
  const fresh = !!(p.bench && p.bench.msPerMpix > 0 && Date.now() - (p.bench.at || 0) < BENCH_MAX_AGE);
  const wantBench = cls !== 'software' && !learned && !fresh;
  if (bench && wantBench) {
    const m = measureGpu(renderer);
    if (m) p.bench = { msPerMpix: m.msPerMpix, at: Date.now() };
  }
  // GPU-Test: senkt nur die Startstufe (Schätzung) – solange die Matches noch nichts gelernt haben
  if (!learned && p.bench && p.bench.msPerMpix > 0) {
    const bt = benchTier(p.bench.msPerMpix, d);
    if (bt && idx(bt) < idx(tier)) { tier = bt; reasons.push(`GPU-Test ${p.bench.msPerMpix} ms/MPx`); }
  }
  // In Matches gelernte Stufe (echte Last) gilt vor Klasse und Test – nach unten immer, nach oben bis zur Obergrenze
  if (learned) {
    const l = minTier(learned, ceiling);
    if (l !== tier) { tier = l; reasons.push('gelernt'); }
  }
  p.tier = tier;
  saveProfile(p);
  decided = {
    tier, ceiling, reason: reasons.join(', ') || 'Gerät', gpu, cls, bench: p.bench ? p.bench.msPerMpix : null,
    software: cls === 'software', pending: !bench && wantBench,
  };
  return decided;
}

/**
 * Ergebnis eines Matches merken (main.js applyAutoTier): Stufe wegen Dauerlast gesenkt bzw. mit Reserve angehoben.
 * Die gelernte Stufe bestimmt künftige Starts mit derselben GPU (höchstens bis zur Obergrenze, vor dem GPU-Test).
 */
export function learnTier(tier) {
  if (!TIERS.includes(tier)) return;
  const p = loadProfile() || { gpu: decided ? decided.gpu : '', bench: null };
  p.learned = tier;
  p.tier = tier;
  saveProfile(p);
  if (decided) decided = { ...decided, tier };
}
