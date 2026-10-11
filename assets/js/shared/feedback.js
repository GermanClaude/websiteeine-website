// NULLPUNKT — Feedback an den Entwickler (Nutzer 11.10.): ab 20 Minuten Spielzeit (laufende Runden, sichtbarer Tab)
// freigeschaltet. Bewertung (Sterne), Ankreuzfragen, Fehlerbericht → per E-Mail (öffnet das eigene Mailprogramm mit
// fertigem Text) oder als Text für Discord (wird kopiert). Automatisch verschickt wird nichts.
// Nach jedem abgeschickten Feedback (auch bei schlechter Bewertung): Freischaltung „Wie NULLPUNKT entstanden ist“ auf der Startseite
// (Experiment: Merkt man einem Spiel an, dass es mit KI entstanden ist?).
// Gemeinsam für Spiel (spielen.html) und Startseite (index.html): nur DOM + lokaler Speicher, eigene Stile.
import { BUILD } from './build.js';

export const FEEDBACK_MIN_SEC = 20 * 60;
export const REVEAL_MIN_STARS = 1; // jede Bewertung schaltet frei (Nutzer 11.10.: auch wer das Spiel eher negativ sieht)
export const CONTACT = Object.freeze({ email: 'legendgerman749@gmail.com', discord: 'German_Legend_26201' });
const KEY = 'nullpunkt:feedback';
const ASK_PAUSE_MS = 30 * 60 * 1000; // nach „Später“ frühestens nach 30 Minuten wieder (außer beim Verlassen)

/* ------------------------------------------------------------------ Zustand (lokaler Speicher) */

let S = null, dirty = 0, askedThisPage = false;
function load() {
  if (S) return S;
  let o = {};
  try { o = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { o = {}; }
  S = {
    play: Math.max(0, Number(o.play) || 0),     // Sekunden in laufenden Runden
    sent: Math.max(0, Number(o.sent) || 0),     // abgeschickte Rückmeldungen
    stars: Math.max(0, Number(o.stars) || 0),   // letzte Bewertung
    reveal: o.reveal === true,                  // „Wie NULLPUNKT entstanden ist“ freigeschaltet
    guess: typeof o.guess === 'string' ? o.guess : '', // Vermutung zur Entstehung (aus dem Fragebogen)
    never: o.never === true,                    // „Nicht mehr fragen“
    lastAsk: Number(o.lastAsk) || 0,
  };
  testParam(S);
  return S;
}
/** Test-Abkürzung über die Adresse: ?fbtest=1 = 20 Minuten gutschreiben, ?fbtest=reset = alles zurücksetzen. */
function testParam(s) {
  let v = null;
  try { v = new URLSearchParams(location.search).get('fbtest'); } catch { v = null; }
  if (v === 'reset') Object.assign(s, { play: 0, sent: 0, stars: 0, reveal: false, guess: '', never: false, lastAsk: 0 });
  else if (v === '1') { s.play = Math.max(s.play, FEEDBACK_MIN_SEC); s.lastAsk = 0; s.never = false; }
  else return;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* */ }
}
function save() {
  dirty = 0;
  try { localStorage.setItem(KEY, JSON.stringify(load())); } catch { /* privater Modus: nur für diese Seite */ }
}

export function feedbackState() { return { ...load() }; }
export function eligible() { return load().play >= FEEDBACK_MIN_SEC; }
export function revealUnlocked() { return load().reveal; }

/** Spielzeit addieren (Sekunden). → true genau in dem Moment, in dem das Feedback freigeschaltet wird. */
export function addPlayTime(sec) {
  const s = load();
  if (!(sec > 0)) return false;
  const before = s.play >= FEEDBACK_MIN_SEC;
  s.play += sec;
  dirty += sec;
  const now = s.play >= FEEDBACK_MIN_SEC;
  if (dirty >= 10 || now !== before) save();
  return !before && now;
}
/** Restliche Spielzeit sichern (Seitenwechsel). */
export function flushPlayTime() { if (dirty > 0) save(); }

/** Hinweis „Feedback senden?“ zeigen? context 'exit' (Spiel verlassen) fragt auch, wenn vorhin „Später“ gewählt wurde. */
export function shouldPrompt(context = '') {
  const s = load();
  if (!eligible() || s.sent > 0 || s.never) return false;
  if (context === 'exit') return true;
  return !askedThisPage && Date.now() - s.lastAsk > ASK_PAUSE_MS;
}

/* ------------------------------------------------------------------ Fragebogen */

const PARTS = ['Grafik', 'Waffengefühl', 'Karten', 'Spielmodi', 'Fahrzeuge & Panzer', 'Bots', 'Mehrspieler', 'Klang', 'Steuerung', 'Menüs', 'Leistung'];
export const QUESTIONS = [
  { id: 'how', label: 'Wie hast du gespielt?', type: 'multi', options: ['Allein gegen Bots', 'Online mit anderen', 'In VR'] },
  { id: 'device', label: 'Auf welchem Gerät?', type: 'one', options: ['PC', 'Laptop', 'Handy / Tablet', 'VR-Brille'] },
  { id: 'perf', label: 'Wie lief das Spiel?', type: 'one', options: ['Flüssig', 'Meistens flüssig', 'Ruckelig', 'Kaum spielbar'] },
  { id: 'like', label: 'Was gefällt dir am meisten?', type: 'multi', options: PARTS.slice(0, 8) },
  { id: 'better', label: 'Was sollte besser werden?', type: 'multi', options: PARTS },
  { id: 'recommend', label: 'Würdest du NULLPUNKT Freunden empfehlen?', type: 'one', options: ['Ja', 'Vielleicht', 'Nein'] },
  { id: 'origin', label: 'Was glaubst du: Wie ist NULLPUNKT entstanden?', type: 'one', options: ['Großes Studio', 'Kleines Team', 'Eine Person allein', 'Mit Hilfe von KI', 'Weiß nicht'] },
];

function minutes(sec) { return Math.round(sec / 60); }

/** Fertiger Text der Rückmeldung (für E-Mail und Discord). data: { stars, answers: {id: [..]}, bug, other, contact, page } */
export function composeFeedback(data) {
  const st = Math.max(1, Math.min(5, data.stars | 0));
  const lines = ['NULLPUNKT – Feedback', `Bewertung: ${'★'.repeat(st)}${'☆'.repeat(5 - st)} (${st}/5)`];
  for (const q of QUESTIONS) {
    const a = (data.answers && data.answers[q.id]) || [];
    lines.push(`${q.label} ${a.length ? a.join(', ') : '–'}`);
  }
  if (data.bug) lines.push('', 'Fehler / Bugs:', data.bug);
  if (data.other) lines.push('', 'Sonstiges:', data.other);
  if (data.contact) lines.push('', `Kontakt für Rückfragen: ${data.contact}`);
  lines.push('', `— Fassung ${BUILD}, Spielzeit ${minutes(load().play)} min, gesendet von ${data.page || 'Spiel'}`);
  return lines.join('\n');
}
export function mailtoFor(text, stars) {
  return `mailto:${CONTACT.email}?subject=${encodeURIComponent(`NULLPUNKT Feedback (${stars}/5)`)}&body=${encodeURIComponent(text)}`;
}

/* ------------------------------------------------------------------ Stile (eigenständig, für beide Seiten) */

const CSS = `
.npfb-back{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:16px;background:rgba(5,6,8,.72);backdrop-filter:blur(4px);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e9e6df}
.npfb{width:min(640px,100%);max-height:calc(100dvh - 32px);overflow:auto;background:#121416;border:1px solid rgba(255,255,255,.14);border-radius:6px;box-shadow:0 20px 60px rgba(0,0,0,.6);padding:22px 22px 18px}
.npfb h2{margin:0 0 6px;font-size:21px;letter-spacing:.02em}
.npfb p{margin:6px 0}
.npfb .npfb-dim{color:#9a968d;font-size:13px}
.npfb fieldset{border:0;margin:14px 0 0;padding:0}
.npfb legend{font-weight:600;margin-bottom:6px;padding:0}
.npfb-opts{display:flex;flex-wrap:wrap;gap:6px}
.npfb-opts label{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid rgba(255,255,255,.16);border-radius:4px;cursor:pointer;user-select:none}
.npfb-opts label:has(input:checked){border-color:#ff5a1f;background:rgba(255,90,31,.14)}
.npfb-opts input{accent-color:#ff5a1f;margin:0}
.npfb-stars{display:flex;gap:4px}
.npfb-stars button{all:unset;cursor:pointer;font-size:30px;line-height:1;color:#4a4740;padding:2px}
.npfb-stars button[aria-checked="true"],.npfb-stars button.on{color:#ffb21f}
.npfb-stars button:focus-visible{outline:2px solid #ff5a1f;outline-offset:2px}
.npfb textarea,.npfb input[type=text]{width:100%;box-sizing:border-box;background:#0b0c0d;color:#e9e6df;border:1px solid rgba(255,255,255,.18);border-radius:4px;padding:8px 10px;font:inherit}
.npfb textarea{min-height:70px;resize:vertical}
.npfb-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.npfb-btn{all:unset;box-sizing:border-box;cursor:pointer;padding:10px 16px;border-radius:4px;border:1px solid rgba(255,255,255,.22);font-weight:600;min-height:44px;display:inline-flex;align-items:center}
.npfb-btn.pri{background:#ff5a1f;border-color:#ff5a1f;color:#120a06}
.npfb-btn:hover{filter:brightness(1.12)}
.npfb-btn:focus-visible{outline:2px solid #ffb21f;outline-offset:2px}
.npfb-err{color:#ff6b5e;font-weight:600}
.npfb a{color:#ffb21f}
.npfb code{font-family:ui-monospace,"JetBrains Mono",monospace;font-size:.95em}
`;
function ensureCss() {
  if (document.getElementById('npfb-css')) return;
  const st = document.createElement('style');
  st.id = 'npfb-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let open = null; // { back, close }
function overlay(html, onClose) {
  closeFeedback();
  ensureCss();
  const back = document.createElement('div');
  back.className = 'npfb-back';
  back.innerHTML = `<div class="npfb" role="dialog" aria-modal="true" aria-labelledby="npfb-h">${html}</div>`;
  // Tastatur bleibt im Dialog (Spiel reagiert nicht auf Tippen im Textfeld)
  for (const t of ['keydown', 'keyup', 'keypress']) back.addEventListener(t, (e) => { e.stopPropagation(); if (t === 'keydown' && e.key === 'Escape') close(); });
  for (const t of ['pointerdown', 'mousedown', 'wheel', 'contextmenu']) back.addEventListener(t, (e) => e.stopPropagation());
  try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* */ }
  document.body.appendChild(back);
  const close = (why = 'close') => {
    if (!back.isConnected) return;
    back.remove();
    if (open && open.back === back) open = null;
    if (onClose) onClose(why);
  };
  open = { back, close };
  const first = back.querySelector('[autofocus], button, input, textarea');
  if (first) setTimeout(() => first.focus(), 30);
  return { back, close };
}
export function closeFeedback() { if (open) open.close('extern'); }
export function isFeedbackOpen() { return !!(open && open.back.isConnected); }

/* ------------------------------------------------------------------ Hinweis „Feedback senden?“ */

/** Kleiner Hinweis. context 'exit': Knöpfe „Feedback geben“ / „Ohne Feedback verlassen“; onDone wird danach immer gerufen. */
export function promptFeedback({ context = '', onDone = null, page = 'Spiel' } = {}) {
  const s = load();
  askedThisPage = true;
  s.lastAsk = Date.now();
  save();
  const exit = context === 'exit';
  const { back, close } = overlay(`
    <h2 id="npfb-h">Feedback an den Entwickler?</h2>
    <p>Du hast NULLPUNKT schon über ${minutes(s.play)} Minuten gespielt. Magst du kurz sagen, wie es dir gefällt, oder einen Fehler melden?
    Dauert etwa zwei Minuten.</p>
    <div class="npfb-row">
      <button type="button" class="npfb-btn pri" data-a="yes" autofocus>Feedback geben</button>
      <button type="button" class="npfb-btn" data-a="later">${exit ? 'Ohne Feedback verlassen' : 'Später'}</button>
      <button type="button" class="npfb-btn" data-a="never">Nicht mehr fragen</button>
    </div>`, (why) => { if (why !== 'form' && onDone) onDone(); });
  back.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    if (a.dataset.a === 'yes') { close('form'); openFeedback({ page, onDone }); return; }
    if (a.dataset.a === 'never') { load().never = true; save(); }
    close(a.dataset.a);
  });
}

/* ------------------------------------------------------------------ Formular */

/** Feedback-Formular. onDone(result) nach Schließen; result = { sent, stars, revealed } */
export function openFeedback({ page = 'Spiel', onDone = null, onRevealed = null } = {}) {
  let result = { sent: false, stars: 0, revealed: false };
  const q = QUESTIONS.map((x) => `
    <fieldset data-q="${x.id}"><legend>${esc(x.label)}</legend><div class="npfb-opts">
      ${x.options.map((o, i) => `<label><input type="${x.type === 'multi' ? 'checkbox' : 'radio'}" name="npfb-${x.id}" value="${esc(o)}" id="npfb-${x.id}-${i}">${esc(o)}</label>`).join('')}
    </div></fieldset>`).join('');
  const { back, close } = overlay(`
    <h2 id="npfb-h">Feedback an den Entwickler</h2>
    <p class="npfb-dim">Deine Rückmeldung geht an German Legend, aber nur, wenn du sie unten selbst abschickst. Alle Fragen außer den Sternen sind freiwillig.</p>
    <fieldset><legend>Wie gefällt dir NULLPUNKT insgesamt?</legend>
      <div class="npfb-stars" role="radiogroup" aria-label="Bewertung in Sternen">
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="false" data-star="${n}" aria-label="${n} ${n === 1 ? 'Stern' : 'Sterne'}">★</button>`).join('')}
      </div>
    </fieldset>
    ${q}
    <fieldset><legend>Fehler gefunden? Was ist passiert, wo (Karte, Modus)?</legend><textarea data-f="bug" maxlength="1500" placeholder="z. B. Auf Hafen bleibt man an der Treppe hängen …"></textarea></fieldset>
    <fieldset><legend>Sonst noch etwas?</legend><textarea data-f="other" maxlength="1500" placeholder="Wünsche, Lob, Kritik …"></textarea></fieldset>
    <fieldset><legend>Kontakt für Rückfragen (freiwillig)</legend><input type="text" data-f="contact" maxlength="120" placeholder="z. B. dein Discord-Name"></fieldset>
    <p class="npfb-err" data-err hidden>Bitte vergib zuerst Sterne.</p>
    <div class="npfb-row">
      <button type="button" class="npfb-btn pri" data-send="mail">Per E-Mail senden</button>
      <button type="button" class="npfb-btn" data-send="discord">Für Discord kopieren</button>
      <button type="button" class="npfb-btn" data-a="cancel">Abbrechen</button>
    </div>
    <p class="npfb-dim">E-Mail öffnet dein Mailprogramm mit fertigem Text an <code>${CONTACT.email}</code>. Für Discord wird der Text kopiert; schick ihn dann an <code>${CONTACT.discord}</code>.</p>`,
  () => { if (onDone) onDone(result); });
  let stars = 0;
  const paint = () => back.querySelectorAll('[data-star]').forEach((b) => { const n = +b.dataset.star; b.classList.toggle('on', n <= stars); b.setAttribute('aria-checked', String(n === stars)); });
  const collect = () => {
    const answers = {};
    for (const x of QUESTIONS) answers[x.id] = [...back.querySelectorAll(`[data-q="${x.id}"] input:checked`)].map((i) => i.value);
    const f = (k) => (back.querySelector(`[data-f="${k}"]`).value || '').trim();
    return { stars, answers, bug: f('bug'), other: f('other'), contact: f('contact'), page };
  };
  const finish = (data, how, copied) => {
    const s = load();
    s.sent += 1;
    s.stars = data.stars;
    s.guess = (data.answers.origin && data.answers.origin[0]) || s.guess;
    const newly = !s.reveal && data.stars >= REVEAL_MIN_STARS;
    if (data.stars >= REVEAL_MIN_STARS) s.reveal = true;
    save();
    result = { sent: true, stars: data.stars, revealed: s.reveal, newly };
    const box = back.querySelector('.npfb');
    const onSite = page === 'Startseite';
    const sentLine = how === 'mail'
      ? '<p>Dein Mailprogramm sollte sich mit dem fertigen Text geöffnet haben. Falls nicht, kopiere ihn hier:</p>'
      : copied ? `<p>Der Text ist kopiert. Öffne Discord und schick ihn an <code>${CONTACT.discord}</code>.</p>` : '<p>Kopieren hat nicht geklappt, markiere den Text hier und kopiere ihn selbst:</p>';
    box.innerHTML = `
      <h2 id="npfb-h">Danke!</h2>
      ${sentLine}
      <textarea readonly rows="6" data-out>${esc(composeFeedback(data))}</textarea>
      ${newly ? `<p><strong>Du hast etwas freigeschaltet:</strong> Auf der Startseite unter „Über“ erfährst du jetzt, wie NULLPUNKT entstanden ist.</p>
        ${onSite ? '' : '<p><a href="index.html#ueber" target="_blank" rel="noopener">Startseite in neuem Tab öffnen</a></p>'}` : ''}
      ${data.stars <= 2 ? '<p>Danke für deine ehrliche Bewertung, gerade Kritik hilft, das Spiel besser zu machen.</p>' : ''}
      <div class="npfb-row"><button type="button" class="npfb-btn pri" data-a="ok" autofocus>Schließen</button>
      ${how === 'discord' ? '<a class="npfb-btn" href="https://discord.com/app" target="_blank" rel="noopener">Discord öffnen</a>' : ''}</div>`;
    const ok = box.querySelector('[data-a="ok"]');
    if (ok) ok.focus();
    if (newly && onRevealed) onRevealed();
  };
  back.addEventListener('click', async (e) => {
    const st = e.target.closest('[data-star]');
    if (st) { stars = +st.dataset.star; paint(); back.querySelector('[data-err]').hidden = true; return; }
    const a = e.target.closest('[data-a]');
    if (a && (a.dataset.a === 'cancel' || a.dataset.a === 'ok')) { close(a.dataset.a); return; }
    const snd = e.target.closest('[data-send]');
    if (!snd) return;
    if (!stars) { const er = back.querySelector('[data-err]'); er.hidden = false; er.scrollIntoView({ block: 'nearest' }); return; }
    const data = collect();
    const text = composeFeedback(data);
    if (snd.dataset.send === 'mail') {
      try { window.location.href = mailtoFor(text, data.stars); } catch { /* kein Mailprogramm */ }
      finish(data, 'mail', false);
    } else {
      let copied = false;
      try { await navigator.clipboard.writeText(text); copied = true; } catch {
        try { const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select(); copied = document.execCommand('copy'); t.remove(); } catch { copied = false; }
      }
      finish(data, 'discord', copied);
    }
  });
}

/* ------------------------------------------------------------------ Freischaltung auf der Startseite */

const GUESS_REPLY = {
  'Mit Hilfe von KI': 'Gut erkannt!',
  'Eine Person allein': 'Fast: eine Person mit einer KI.',
  'Kleines Team': 'Eher nicht: ein Mensch und eine KI.',
  'Großes Studio': 'Weit gefehlt, und genau das ist das Spannende.',
  'Weiß nicht': 'Jetzt weißt du es.',
};
/** HTML des freigeschalteten Abschnitts (Startseite, §08 Über). */
export function revealHtml() {
  const g = load().guess;
  const guess = g ? `<p class="reveal-guess">Deine Vermutung im Feedback: <strong>${esc(g)}</strong>. ${esc(GUESS_REPLY[g] || '')}</p>` : '';
  return `
    <p class="reveal-tag">Freigeschaltet · Danke für dein Feedback</p>
    <h3 class="mono-h" id="h-entstehung">Wie NULLPUNKT entstanden ist</h3>
    <p>NULLPUNKT ist ein Experiment. Die Idee, das Konzept, die Spielmodi, die Wünsche zu Karten, Waffen und Fahrzeugen, die
    Geschichten dahinter, das Testen mit der Community und jede Entscheidung, wie das Spiel sein soll, kommen von
    <strong>German Legend</strong>.</p>
    <p>Den Code hat eine künstliche Intelligenz geschrieben: <strong>Claude</strong> von Anthropic. Weil in NULLPUNKT fast alles
    aus Code entsteht, gilt das auch für Modelle, Karten, Klänge und Effekte. Sie wurden nach seinen Vorgaben gebaut und so
    lange überarbeitet, bis es passte. Dazu kommen freie Texturen und Umgebungslicht von Poly Haven und ambientCG.</p>
    ${guess}
    <p><strong>Die erste Frage hinter dem Experiment:</strong> Merkt man einem Spiel heute noch an, ob es mit KI entstanden ist?</p>
    <p><strong>Die zweite:</strong> Kann KI etwas Gutes sein? NULLPUNKT soll zeigen, dass sie kleinen Entwicklern ohne Studio und
    Budget die schwere Arbeit abnehmen kann, damit aus einer Idee ein Spiel wird. Die Ideen und die Richtung bleiben beim
    Menschen.</p>
    <h4 class="reveal-h">Die Geschichte</h4>
    <ol class="reveal-time">
      ${HISTORY.map(([when, title, text]) => `<li><span class="reveal-when">${when}</span><strong>${title}</strong> ${text}</li>`).join('')}
    </ol>`;
}

/** Zeitleiste der Entstehung (aus der Projektgeschichte, Stand 11.10.2026). */
const HISTORY = [
  ['4. Oktober 2026', 'Ein Missverständnis.', 'German Legend wollte eigentlich eine Seite mit vielen kleinen Browserspielen bauen, wie es sie in der Corona-Zeit überall gab. Die KI hat den Auftrag anders verstanden und einen einzigen großen 3D-Shooter angefangen. Das gefiel so gut, dass daraus NULLPUNKT wurde. Am ersten Abend entstanden das Grundgerüst, die Klang-Engine, die Altstadt und die ersten Waffen. (Bei GTA war es übrigens ähnlich: Es sollte zuerst ein Rennspiel werden.)'],
  ['5. Oktober', 'Die Welt wächst.', 'Hafen und Werk kommen dazu, Bots mit eigener Taktik, freie Texturen und echte Tonaufnahmen, dazu die große Karte Grenzland mit Fahrzeugen.'],
  ['6. Oktober', 'Die ersten Tester.', 'Spieler aus der SCP:SL-Community schicken eine lange Fehlerliste. Die Karten werden größer, Bots lernen von Spielern und kämpfen 32 gegen 32, Grafik und Waffen bekommen eine Realismus-Runde.'],
  ['7. und 8. Oktober', 'Der Plan für den Mehrspieler.', 'Ohne eigenen Spielserver: Die Browser der Spieler verbinden sich direkt miteinander. Dazu kommt ein VR-Modus für die Meta Quest 3.'],
  ['9. Oktober', 'Live.', 'Die Mehrspieler-Beta geht online, am Abend spielen die ersten acht Leute zusammen. Noch am selben Abend kommen der Modus „Nur Messer“ und eine steuerbare Drohne.'],
  ['10. Oktober', 'Mehr Modi, mehr Karten.', 'Infiziert und Waffenspiel online, Klassen-Fähigkeiten, Munition von Gefallenen im Realismus-Modus und die Zauberbibliothek als neue Karte.'],
  ['11. Oktober', 'Der große Test.', 'Zehn Spieler aus der UGN-Community spielen gleichzeitig: ein voller Erfolg. Am selben Tag folgen Verletzungen und Nahkampfwaffen, zerstörbare Fassaden und verformbare Autos, die Stellungskriegskarte Niemandsland mit Gräben und Panzer aus drei Epochen nach echten Vorbildern, mit Innenraum und Ladeschützen.'],
  ['Bis heute', 'In Zahlen.', 'Eine Woche, fast 300 gespeicherte Arbeitsschritte, rund 140.000 Zeilen Code in über 400 Dateien. Die Ideen kamen von einer Person, den Code schrieb eine KI.'],
];
