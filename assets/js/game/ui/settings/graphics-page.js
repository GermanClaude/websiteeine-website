// NULLPUNKT — Reiter „Erweitert“ (Realismus-Plan S9, §4.4 Nr. 8): jede Grafikoption einzeln wie in PC-Spielen,
// mit Live-Anzeige des Grafikspeichers (renderer.memoryEstimate(): Texturen, Geometrie, Bildpuffer, Schatten,
// Umgebung) gegen das Budget der Stufe (Plan §4.1). „Automatisch“ = Wert der Qualitätsstufe (shared/graphics.data.js);
// die Optionen wirken sofort (Renderer baut Kette/Schatten neu auf).
// In der Lobby ist noch keine Karte geladen: Karteninhalt dann aus der letzten Messung dieser Stufe bzw. dem Modell
// des Plans (§4.2), Bildpuffer immer gemessen.

import { esc, num } from '../dom.js';
import { ICON } from '../icons.js';
import { QUALITY_PRESETS } from '../../engine/renderer.js';
import { GPU_BUDGET_MB, CONTENT_MODEL_MB, GFX_KEYS, presetValue, modelCost, applyGraphics } from '../../../shared/graphics.data.js';
import { rowHtml, headHtml, bindRows, syncRows, setRowDisabled, setRowCost } from './rows.js';
import { HINTS } from './schema-page.js';

const MB = 1024 * 1024;
const MEM_KEY = 'nullpunkt:gfxmem';
const TIER_LABEL = { low: 'Niedrig', medium: 'Mittel', high: 'Hoch', ultra: 'Ultra' };
const SECTIONS = [
  ['Qualitätsstufe', ['quality']],
  ['Auflösung', ['renderScale', 'gfxPixelRatio', 'upscaler', 'sharpness']],
  ['Bildrate', ['fpsLimit', 'showFps']],
  ['Licht und Schatten', ['gfxShadows', 'gfxAO', 'autoExposure']],
  ['Nachbearbeitung', ['gfxPost', 'gfxAA', 'gfxBloom', 'lensStyle', 'lensStrength', 'grain', 'lensArtifacts', 'lensBorder']],
  ['Effekte', ['gfxEffects']],
];
const LOCAL_HINTS = {
  quality: 'Grundlage aller Optionen mit „Automatisch“.',
  renderScale: 'Dynamisch: regelt bei Ruckeln die interne Auflösung herunter. Fest: immer diese Auflösung.',
  gfxPixelRatio: 'Obergrenze für hochauflösende Bildschirme (Retina). Mehr = schärfer, kostet viel Leistung.',
  fpsLimit: 'Spart Akku und hält Telefone kühler. 30 ist auf Handys ruhiger als schwankende 40–60.',
  gfxShadows: 'Auflösung und Reichweite der Sonnenschatten, Schatten der Figuren.',
  gfxAO: 'Verdeckung in Ecken und Fugen. Rendert die Szene ein zweites Mal – teuer.',
  gfxPost: 'Einfach: alles in einem Durchgang (Handys). Voll: Leuchten, Kantenglättung, Lichtstrahlen.',
  gfxAA: 'FXAA ist billig, SMAA schärfer und ruhiger.',
  gfxBloom: 'Leuchten heller Lichter, mit Linsenschmutz im Bodycam-Stil.',
  gfxEffects: 'Partikelmenge, Rauch, Funken, Hülsen und Zahl der Einschusslöcher.',
};
const SEGS = [
  ['textures', 'Texturen'], ['geometry', 'Geometrie'], ['buffers', 'Bildpuffer'], ['shadows', 'Schatten'], ['environment', 'Umgebung'],
];

function readCache() {
  try { return JSON.parse(localStorage.getItem(MEM_KEY) || '{}') || {}; } catch { return {}; }
}
function writeCache(c) {
  try { localStorage.setItem(MEM_KEY, JSON.stringify(c)); } catch { /* gesperrt */ }
}
const mb = (b) => (b >= 10 * MB ? num(b / MB, 0) : num(b / MB, 1));

export function graphicsPage(P) {
  const G = P.G;
  const S = P.settings;
  let host = null;
  let off = null;
  let memT = 0;
  let memRaf = 0;
  const KEYS = SECTIONS.flatMap(([, k]) => k);

  const R = () => G.renderer;
  const basePreset = () => QUALITY_PRESETS[(R() && R().quality) || 'high'] || QUALITY_PRESETS.high;
  const effPreset = () => (R() && R().preset) || applyGraphics(basePreset(), S);

  /** „Automatisch (Hoch)“ – Wert, den die Stufe ohne Abweichung hätte. */
  const labels = (key) => {
    if (!GFX_KEYS.includes(key)) {
      if (key === 'renderScale') {
        const r = R();
        return r && r.resolutionScale < 0.999 ? { auto: `Dynamisch (${Math.round(r.resolutionScale * 100)} %)` } : null;
      }
      return null;
    }
    const v = presetValue(key, basePreset());
    const d = S.schema[key];
    const t = d && d.labels && d.labels[v];
    return t ? { auto: `Automatisch (${t})` } : null;
  };
  const ctx = { ...P, labels };

  function sizes() {
    const r = R();
    const p = r && r.pipeline;
    const ow = p && p.out ? p.out.w : Math.round((r ? r.width : 1280) * (r ? r.outputPixelRatio : 1));
    const oh = p && p.out ? p.out.h : Math.round((r ? r.height : 720) * (r ? r.outputPixelRatio : 1));
    const w = p && p.active && p.inner ? p.inner.w : ow;
    const h = p && p.active && p.inner ? p.inner.h : oh;
    return { w, h, ow, oh, hdrBpp: p && p.fmt ? p.fmt.bpp : 4 };
  }

  /** Grafikspeicher: gemessen (Karte geladen) bzw. Bildpuffer gemessen + Karteninhalt geschätzt. */
  function measure() {
    const r = R();
    if (!r || typeof r.memoryEstimate !== 'function') return null;
    let est = null;
    try { est = r.memoryEstimate(); } catch { est = null; }
    if (!est) return null;
    const st = G.match && G.match.state;
    const inMatch = !!G.world && (st === 'playing' || st === 'paused' || st === 'countdown' || st === 'ended');
    const q = r.quality;
    const buffers = est.targets + est.backbuffer;
    let textures, geometry, environment, shadows, measured;
    let fromCache = false;
    if (inMatch) {
      ({ textures, geometry, environment, shadows } = est);
      measured = true;
      // Nur echte Karten merken (Prüfseiten mit Testszene würden die Lobby-Schätzung verfälschen)
      if (G.world.id && textures > MB) {
        const c = readCache();
        c[q] = { textures, geometry, environment, at: Date.now() };
        writeCache(c);
      }
    } else {
      const c = readCache()[q];
      if (c && c.textures > 0) ({ textures, geometry, environment } = c);
      else {
        const m = CONTENT_MODEL_MB[q] * MB;
        textures = m * 0.62; geometry = m * 0.3; environment = m * 0.08;
      }
      shadows = modelCost('gfxShadows', effPreset(), sizes());
      measured = false;
      fromCache = !!(c && c.textures > 0);
    }
    const parts = { textures, geometry, buffers, shadows, environment };
    const total = Object.values(parts).reduce((s, v) => s + (v || 0), 0);
    return { parts, total, measured, fromCache, quality: q, info: r.info ? r.info() : null };
  }

  function renderMeter() {
    if (!host) return;
    const box = host.querySelector('[data-mem]');
    if (!box) return;
    const m = measure();
    if (!m) { box.hidden = true; return; }
    box.hidden = false;
    const budget = GPU_BUDGET_MB[m.quality] * MB;
    const ratio = m.total / budget;
    box.dataset.level = ratio > 1 ? 'over' : ratio > 0.75 ? 'warn' : 'ok';
    box.querySelector('[data-mem-total]').textContent = `≈ ${mb(m.total)} MB`;
    box.querySelector('[data-mem-budget]').textContent = `von ${num(GPU_BUDGET_MB[m.quality])} MB · Budget „${TIER_LABEL[m.quality]}“`;
    const bar = box.querySelector('.gm-bar');
    let x = 0;
    for (const [k] of SEGS) {
      const seg = bar.querySelector(`[data-seg="${k}"]`);
      const w = Math.max(0, Math.min(100 - x, ((m.parts[k] || 0) / budget) * 100));
      seg.style.left = `${x.toFixed(2)}%`;
      seg.style.width = `${w.toFixed(2)}%`;
      x += w;
      const l = box.querySelector(`[data-leg="${k}"] b`);
      if (l) l.textContent = `${mb(m.parts[k] || 0)} MB`;
    }
    bar.classList.toggle('is-over', ratio > 1);
    const i = m.info;
    const post = i && i.post;
    const res = post && post.internal ? `Intern ${post.internal.replace('×', ' × ')} → Bild ${post.output.replace('×', ' × ')}${post.upscaler && post.upscaler !== 'nativ' ? ` (${post.upscaler === 'fsr1' ? 'FSR 1.0' : post.upscaler === 'lite' ? 'Schnell' : 'Bilinear'})` : ''}` : i ? `${i.width} × ${i.height} @ ${num(i.pixelRatio, 2)}` : '';
    const p = effPreset();
    const shadow = p.shadows ? `Schatten ${p.shadowMapSize}²` : 'Ohne Schatten';
    box.querySelector('[data-mem-res]').textContent = [res, shadow, post && post.mode === 'lite' ? 'Nachbearbeitung einfach' : post && post.mode === 'full' ? 'Nachbearbeitung voll' : ''].filter(Boolean).join(' · ');
    box.querySelector('[data-mem-note]').textContent = m.measured
      ? 'Gemessen in dieser Karte (ohne Treiber-Reserve).'
      : m.fromCache ? 'Karteninhalt aus dem letzten Match dieser Stufe, Bildpuffer gemessen.'
        : 'Schätzung für eine Karte – genau gemessen wird im Match (Pause → Einstellungen).';
  }

  /** Nach Änderungen: Renderer baut beim nächsten Bild Ziele/Schattenkarten → zweimal messen. */
  function scheduleMeter() {
    clearTimeout(memT);
    cancelAnimationFrame(memRaf);
    memRaf = requestAnimationFrame(() => { renderMeter(); memT = setTimeout(renderMeter, 450); });
  }

  function refreshRows() {
    if (!host) return;
    const p = effPreset();
    const lite = !p.post;
    for (const k of ['gfxAA', 'gfxBloom', 'gfxAO']) setRowDisabled(host, k, lite, 'Nur mit voller Nachbearbeitung.');
    const style = S.get('lensStyle');
    for (const k of ['lensStrength', 'grain', 'lensArtifacts', 'lensBorder']) setRowDisabled(host, k, style !== 'bodycam', 'Nur im Bildstil „Bodycam“.');
    setRowDisabled(host, 'sharpness', style === 'klassisch', 'Im Stil „Klassisch“ ohne Nachschärfen.');
    const sz = sizes();
    const cost = (k) => { const b = modelCost(k, p, sz); return b > 0 ? `≈ ${mb(b)} MB` : ''; };
    setRowCost(host, 'gfxShadows', p.shadows ? `${p.shadowMapSize}² · ${cost('gfxShadows')}` : '');
    setRowCost(host, 'gfxAO', cost('gfxAO'));
    setRowCost(host, 'gfxAA', cost('gfxAA'));
    setRowCost(host, 'gfxBloom', cost('gfxBloom'));
    setRowCost(host, 'renderScale', `${sz.w} × ${sz.h}`);
    setRowCost(host, 'gfxPixelRatio', `${sz.ow} × ${sz.oh}`);
    for (const k of [...GFX_KEYS, 'renderScale']) syncRows(host, ctx, k); // „Automatisch (…)“ folgt der Stufe
  }

  return {
    keys: [...GFX_KEYS, 'renderScale', 'fpsLimit'],
    resetLabel: 'Erweitert',
    mount(h) {
      host = h;
      host.innerHTML = `
        <section class="gm" data-mem data-level="ok" aria-live="polite">
          <div class="gm-top">${ICON.chip}<div class="gm-num"><b data-mem-total>–</b><span data-mem-budget></span></div><small class="gm-label">Grafikspeicher</small></div>
          <div class="gm-bar" role="img" aria-label="Aufteilung des Grafikspeichers">${SEGS.map(([k]) => `<i data-seg="${k}"></i>`).join('')}<s class="gm-mark" style="left:75%"></s></div>
          <ul class="gm-leg">${SEGS.map(([k, l]) => `<li data-leg="${k}"><i></i>${esc(l)} <b>–</b></li>`).join('')}</ul>
          <p class="gm-res" data-mem-res></p>
          <p class="gm-note" data-mem-note></p>
        </section>
        ${SECTIONS.map(([title, keys]) => headHtml(title) + keys.map((k) => rowHtml(ctx, k, { hint: LOCAL_HINTS[k] || HINTS[k], control: k === 'quality' ? 'seg' : undefined, wide: k === 'quality' })).join('')).join('')}`;
      off = bindRows(host, { ...ctx, after: () => { refreshRows(); scheduleMeter(); } });
      refreshRows();
      renderMeter();
      scheduleMeter();
      this._offQ = R() && R().onQualityChange ? R().onQualityChange(() => { refreshRows(); scheduleMeter(); }) : null;
    },
    unmount() {
      clearTimeout(memT);
      cancelAnimationFrame(memRaf);
      if (this._offQ) this._offQ();
      this._offQ = null;
      if (off) off();
      host = null;
    },
    sync(key) {
      if (!host) return;
      if (KEYS.includes(key)) syncRows(host, ctx, key);
      refreshRows();
      scheduleMeter();
    },
    reset() {
      const patch = {};
      for (const k of [...GFX_KEYS, 'renderScale', 'fpsLimit']) patch[k] = S.defaults[k];
      S.patch(patch);
    },
  };
}
