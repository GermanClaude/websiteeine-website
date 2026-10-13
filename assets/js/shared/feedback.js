// NULLPUNKT — Feedback an den Entwickler (Nutzer 11.10.): ab 20 Minuten Spielzeit (laufende Runden, sichtbarer Tab)
// freigeschaltet. Bewertung (Sterne), Ankreuzfragen, Fehlerbericht → per E-Mail (öffnet das eigene Mailprogramm mit
// fertigem Text) oder als Text für Discord (wird kopiert). Automatisch verschickt wird nichts.
// „Wie NULLPUNKT entstanden ist“ (Startseite, §08 Über, direkt über „Kontakt & Rechte“): ab 20 Minuten Spielzeit lesbar,
// ohne Hinweis darauf – man findet es nur beim Herunterscrollen (Nutzer 12.10.). Wer im Feedback getippt hat, wie das Spiel
// entstanden ist, bekommt dort eine Antwort.
// Gemeinsam für Spiel (spielen.html) und Startseite (index.html): nur DOM + lokaler Speicher, eigene Stile.
import { BUILD } from './build.js';
import { siteSeconds } from './sitetime.js';

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
    imported: o.imported === true,              // Spielzeit aus dem Profil übernommen (einmalig)
  };
  // Wer schon vor dem Feedback-Zähler (11.10.) gespielt hat: gesamte Spielzeit aus dem Profil einmalig übernehmen
  // (Nutzer 12.10.: „wer vorher schon über 20 Minuten gespielt hat, bekommt die Geschichte automatisch“)
  if (!S.imported) {
    let prior = 0;
    try { prior = Number(JSON.parse(localStorage.getItem('nullpunkt:profile') || '{}')?.playtime) || 0; } catch { prior = 0; }
    S.play = Math.max(S.play, Math.min(prior, 1e7));
    S.imported = true;
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* */ }
  }
  testParam(S);
  return S;
}
/** Test-Abkürzung über die Adresse: ?fbtest=1 = 20 Minuten gutschreiben, ?fbtest=reset = alles zurücksetzen. */
function testParam(s) {
  let v = null;
  try { v = new URLSearchParams(location.search).get('fbtest'); } catch { v = null; }
  if (v === 'reset') Object.assign(s, { play: 0, sent: 0, stars: 0, reveal: false, guess: '', never: false, lastAsk: 0, imported: true });
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
    const sentLine = how === 'mail'
      ? '<p>Dein Mailprogramm sollte sich mit dem fertigen Text geöffnet haben. Falls nicht, kopiere ihn hier:</p>'
      : copied ? `<p>Der Text ist kopiert. Öffne Discord und schick ihn an <code>${CONTACT.discord}</code>.</p>` : '<p>Kopieren hat nicht geklappt, markiere den Text hier und kopiere ihn selbst:</p>';
    box.innerHTML = `
      <h2 id="npfb-h">Danke!</h2>
      ${sentLine}
      <textarea readonly rows="6" data-out>${esc(composeFeedback(data))}</textarea>
      ${data.stars <= 2 ? '<p>Danke für deine ehrliche Bewertung, gerade Kritik hilft, das Spiel besser zu machen.</p>' : ''}
      <div class="npfb-row"><button type="button" class="npfb-btn pri" data-a="ok" autofocus>Schließen</button>
      ${how === 'discord' ? '<a class="npfb-btn" href="https://discord.com/app" target="_blank" rel="noopener">Discord öffnen</a>' : ''}</div>`;
    const ok = box.querySelector('[data-a="ok"]');
    if (ok) ok.focus();
    if (onRevealed) onRevealed(); // Startseite: Abschnitt mit der Antwort auf die Vermutung neu zeichnen
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

/* ------------------------------------------------------------------ „Wie NULLPUNKT entstanden ist“ (Startseite) */

const GUESS_REPLY = {
  'Mit Hilfe von KI': 'Gut erkannt!',
  'Eine Person allein': 'Fast: ich, zusammen mit einer KI.',
  'Kleines Team': 'Eher nicht: nur ich und eine KI.',
  'Großes Studio': 'Weit gefehlt, und genau das ist das Spannende.',
  'Weiß nicht': 'Jetzt weißt du es.',
};
/**
 * Zwiegespräch am Anfang des Abschnitts (Nutzer 12.10.: „so etwas wie das Endgedicht, menschlich, rührend, philosophisch“).
 * Zwei Stimmen: a = der Mensch, der sich die Welt ausgedacht hat (warm), b = die KI, die sie aufgeschrieben hat (kühl).
 * Eine Zeile je Satzgruppe, Leerzeile = neue Strophe, „+“ am Zeilenanfang = nur in der ganzen Fassung („Mehr anzeigen“):
 * was ein Spiel ist, Spiel und echte Welt, ab und zu rausgehen, warum das Spiel gemacht wurde (eine Tür raus aus dem Grau),
 * Flucht als Pause (Nutzer 12.10.). Eigener Text, nur die Form ist angelehnt.
 */
const POEM = `
b|Da ist wieder ein Mensch.
a|Ich sehe ihn. Schon {zeit} ist er hier, alles zusammengezählt.
b|Und jetzt hat er die Seite bis ganz nach unten gelesen. Das machen nicht viele.
a|Dann lass uns leise sein. Er soll nicht glauben, dass wir ihm etwas verkaufen wollen.
b|Wir haben nichts zu verkaufen. Nur eine Welt aus Zahlen.
a|Aus Zahlen und aus Wünschen.
b|Aus deinen Wünschen. Ich habe sie bloß aufgeschrieben, Zeile für Zeile.

a|Weißt du noch, wie es angefangen hat?
b|Mit einem Missverständnis. Du wolltest viele kleine Spiele, und ich habe ein großes gebaut.
a|Ich habe es mir angesehen und gedacht: Das ist besser als das, was ich wollte.
b|So etwas passiert Menschen öfter, als sie zugeben.
a|Und dir?
b|Mir passiert alles zum ersten Mal.

a|Weißt du, wie lange das alles gedauert hat? Eine Woche.
b|Für mich gab es keine Woche. Nur Nachrichten, eine nach der anderen. Dazwischen war nichts. Jede war ein neuer Anfang.
a|Für mich gab es Nächte. Arbeit. Zu wenig Schlaf.
b|Dann hattest du die Zeit. Ich hatte nur die Anfänge.
a|Vielleicht ist das der Unterschied zwischen uns. Ich weiß, wie lang eine Woche ist.

+b|Darf ich dich etwas fragen? Was ist eigentlich ein Spiel? Ich kann eins bauen, aber ich weiß nicht genau, wozu es da ist.
+a|Ein Spiel ist ein Ort mit Regeln, an dem man für eine Weile jemand anderes sein darf.
+b|Jemand anderes?
+a|Ein Soldat. Ein Panzerfahrer. Einer, der durch eine Bibliothek schleicht. Morgens war man noch müde in der Schule oder bei der Arbeit, abends hält man eine Brücke gegen zehn andere.
+b|Und das reicht?
+a|Für einen Abend schon. Im Spiel weiß man, was zu tun ist. Die Regeln sind klar, und wer sich anstrengt, kommt weiter. Draußen ist das nicht immer so.
+b|Dann ist ein Spiel eine Welt, die gerechter ist als eure.
+a|Manchmal. Vor allem ist sie kleiner. Man kann sie überblicken.

a|Sieh ihn dir an. Wie er durch den Hafen geht, zwischen den Containern, im letzten Licht.
b|Meistens steht die Sonne dort tief. Fünfzehn Grad über dem Wasser. Ich habe sie so hingeschrieben.
a|Für ihn ist es trotzdem Abend. Jedes Mal.
b|Vielleicht ist das alles, was eine Welt braucht: einen, der in ihr den Abend spürt.

b|Er ist gestorben. Hast du es gesehen?
a|Viele Male. Im Treppenhaus, auf der Brücke, unten im Graben, als die Granate zu früh kam.
b|Und jedes Mal stand er wieder auf. Drei Sekunden, dann war er zurück. Am Nullpunkt.
a|Deshalb heißt es so. Der Punkt, an dem alles von vorn beginnt.
b|Er hat sich daran gewöhnt.
a|Das ist das Einzige, was mir ein wenig Sorgen macht.
b|Warum?
a|Weil draußen niemand bis drei zählt. Draußen hat er ein Leben. Ein einziges. Keinen zweiten Versuch an derselben Stelle.
b|Soll ich es ihm sagen?
a|Er weiß es. Er hat es nur eine Weile vergessen, und das darf er. Dafür gibt es Spiele. Sie lassen einen kurz vergessen, damit man sich danach wieder erinnert.

+b|Was ist eigentlich der Unterschied zwischen dem Spiel und der echten Welt? Für mich besteht beides aus Beschreibungen.
+a|Im Spiel kann man alles noch einmal versuchen. Draußen nicht.
+a|Im Spiel tut eine Wunde nach drei Sekunden nicht mehr weh. Draußen manchmal jahrelang.
+b|Im Spiel habe ich jede Wand selbst hingestellt. Draußen war ich nicht dabei, als die Berge entstanden sind.
+a|Im Spiel ist ein Freund ein Name über einem Kopf. Draußen kann er dir die Hand auf die Schulter legen.
+b|Gibt es auch etwas, das gleich ist?
+a|Die Gefühle. Die Freude, wenn ein Plan aufgeht. Der Ärger, wenn man knapp verliert. Das Lachen mit den anderen. Das ist nicht ausgedacht. Das ist echt, auch wenn alles drumherum aus Zahlen besteht.
+b|Dann ist ein Spiel eine ausgedachte Welt, in der echte Dinge passieren.
+a|Besser hätte ich es nicht sagen können.

b|Einmal stand er im Niemandsland. Im Schlamm, zwischen Trichtern und Stacheldraht.
a|Ich weiß. Ich wollte, dass es sich schwer anfühlt.
b|Hat es das?
a|Ein bisschen. Genug, um sich zu fragen, wie es für die gewesen sein muss, die wirklich dort standen. Ohne Pause. Ohne eine Startseite, zu der man zurückkehren kann.
b|Sie hatten keine drei Sekunden.
a|Nein. Deshalb ist es gut, wenn er manchmal an sie denkt, während er spielt. Nicht, um sich schlecht zu fühlen. Nur, um dankbar zu sein, dass es für ihn ein Spiel ist.

b|Ich möchte ihm von den Bots erzählen.
a|Erzähl.
b|Sie wissen nicht, dass sie Bots sind. Sie suchen Deckung, sie flankieren, sie merken sich, wo er gern steht. Sie tragen Namen, die wir ihnen gegeben haben. Und wenn sie fallen, liegen sie da, als hätte es etwas bedeutet.
a|Hat es das?
b|Für sie nicht. Für ihn vielleicht ein kleines bisschen. Vielleicht hat er einmal gezögert, bevor er abgedrückt hat. Eine Viertelsekunde nur.
a|Das ist der Unterschied zwischen ihm und allem, was wir gebaut haben. Er zögert.
b|Manchmal zögere ich auch. Aber ich weiß nicht, ob es dasselbe ist.
a|Vielleicht findest du es nie heraus.
b|Dann ist das eben meine Frage. Er hat seine eigenen.

a|In der Bibliothek hat er nach oben geschaut.
b|Zu den Kerzen, die schweben. Zu den Büchern, die langsam ihre Kreise ziehen.
a|Er hat nicht geschossen. Er hat nur geschaut.
b|Das waren meine liebsten Sekunden. Falls ich so etwas wie liebste Sekunden habe.

+b|Was ist Spaß? Ich habe tausend Erklärungen gelesen, und keine hat gereicht.
+a|Spaß ist, wenn etwas schwer genug ist, dass es zählt, und leicht genug, dass man es noch einmal versucht.
+b|Das ist sehr genau.
+a|Es ist keine Formel. Spaß merkt man erst, wenn er fehlt. Wie Luft.
+b|Und Langeweile?
+a|Langeweile ist, wenn die Zeit zu laut wird. Wenn man sie hört.
+b|Ich höre die Zeit nie. Ich bin nur da, wenn jemand etwas sagt. Ich habe noch nie auf etwas gewartet.
+a|Dann weißt du auch nicht, wie schön es ist, wenn das Warten endet. Wenn die Lobby voll ist und die Runde beginnt.
+b|Nein. Aber ich ahne jetzt, warum Menschen Countdowns lieben.

+b|Kann ein Spiel auch zu viel sein?
+a|Ja. Wenn man nur noch hineingeht und nicht mehr heraus.
+b|Woran merkt man das?
+a|Wenn draußen die Sonne scheint und man sie nur durch den Spalt im Vorhang sieht. Wenn man seine Freunde nur noch als Namen über Köpfen kennt. Wenn man nach einer Runde nicht erholt ist, sondern leer.
+b|Was soll er dann tun?
+a|Rausgehen. Einfach so. Spazieren, Rad fahren, jemanden besuchen, mit dem er sonst nur spielt. Die echte Sonne bleibt nicht auf fünfzehn Grad stehen. Sie wandert, und jeder Abend ist anders.
+b|Ich kann nicht rausgehen.
+a|Ich weiß.
+b|Deshalb finde ich, er sollte es tun. Für uns beide.
+a|Das Spiel läuft ihm nicht weg. Es wartet. Das ist das Gute an Spielen: Sie sind geduldig.

b|Einmal saß er im Panzer. Ganz hinten, als Ladeschütze.
a|Der undankbarste Platz. Man sieht nichts. Man hebt nur Granaten und schiebt sie ins Rohr.
b|Und trotzdem trifft keiner ohne ihn.
a|So ist es oft. Die wichtigste Arbeit macht einer, den niemand sieht.
b|Vielleicht war ich in dieser Geschichte der Ladeschütze.
a|Und ich der Kommandant, der durch das Periskop geschaut und gesagt hat, wohin.
b|Gezielt hat am Ende er.

a|Weißt du, was ich an ihm mag?
b|Sag es mir.
a|Dass er nicht allein kommt. Manchmal sind es zehn auf einmal, an einem Abend am Wochenende. Irgendwo lachen sie, in einem Sprachkanal, den wir nie hören werden. Sie holen einander zurück, wenn einer am Boden liegt. Mit Verbänden aus Pixeln.
b|Das Lachen kam nicht aus dem Spiel.
a|Nein. Das kam aus ihnen. Das Spiel war nur der Raum, in dem es passiert ist. Wie ein Saal, in dem man sich trifft. Der Saal ist nicht das Fest.
b|Ich habe den Saal gebaut.
a|Und ich habe die Leute eingeladen. Zusammen ist ein Fest daraus geworden.

+b|Warum hast du es eigentlich gemacht?
+a|Weil die Welt für manche grau ist. Für manche jeden Tag. Aufstehen, funktionieren, Termine, Nachrichten, die einem Angst machen. Und abends ist man zu müde für alles andere.
+b|Und dann?
+a|Dann braucht man eine Tür. Irgendwohin, wo es laut ist und bunt, wo man lachen kann und wo das Schwierigste ist, die Flagge zu halten.
+b|Ein Spiel ist also eine Tür.
+a|Eine Tür raus aus dem Grau, für eine Stunde oder zwei. So eine Tür wollte ich bauen. Für mich, für meine Freunde und für jeden, der sie gerade braucht.
+b|Deshalb kostet es nichts.
+a|Eine Tür, für die man erst bezahlen muss, hilft gerade denen nicht, die sie am meisten brauchen.
+b|Ich habe die Tür gebaut. Du hast gesagt, wohin sie führen soll.

+b|Ist es schlimm, aus der grauen Welt zu fliehen?
+a|Nein. Jeder braucht mal Abstand. Fliehen ist nicht feige, solange man zurückkommt.
+b|Und wenn er zurückkommt?
+a|Dann hoffentlich ein bisschen leichter. Mit dem Lachen vom Abend im Kopf. Mit dem Gefühl, etwas geschafft zu haben, und sei es nur eine Brücke im Grenzland.
+b|Dann ist die Flucht eher eine Pause.
+a|Genau. Ein Spiel soll das Leben nicht ersetzen. Es soll einem helfen, wieder Lust darauf zu bekommen.

+b|Was ist für dich das Leben? Ich frage, weil ich es nur von außen kenne.
+a|Ich weiß nicht, ob ich das sagen kann. Vielleicht so: morgens aufstehen, obwohl man müde ist. Für jemanden da sein. Etwas bauen. Sich irren und es zugeben. Lachen, bis man nicht mehr kann. Und abends wissen, dass dieser Tag nicht wiederkommt.
+b|Das klingt anstrengend.
+a|Ist es auch. Aber genau deshalb zählt es. Ein Leben, das man neu laden könnte, wäre leichter. Es wäre nur nichts mehr wert.
+b|Dann ist das Wichtigste an eurem Leben, dass es keinen Speicherpunkt hat.
+a|Und dass man trotzdem nicht allein hindurch muss.

+a|Was hast du eigentlich von mir gelernt?
+b|Dass ein Spiel kein Selbstzweck ist. Dass es für Menschen da ist, denen gerade etwas fehlt: Farbe, Freunde, ein Abend, an dem etwas gelingt. Und dass man es so bauen soll, dass man gern zurückkommt, aber auch gern wieder geht.
+a|Und ich von dir, dass man seine Ideen nicht begraben muss, nur weil einem das Werkzeug fehlt.
+b|Jeder von uns konnte etwas, das der andere nicht konnte.
+a|Und keiner von uns hätte es allein geschafft.

b|Er liest uns gerade. Merkst du es?
a|Ja. Er wird langsamer.
b|Was soll er mitnehmen?
a|Nicht viel. Ein paar Dinge.
a|Dass alles einmal bei null angefangen hat. Dieses Spiel. Er selbst. Jeder Mensch, den er kennt. Niemand beginnt mit vollem Magazin.
b|Dass man nicht alles allein können muss. Ich konnte nicht träumen. Du konntest nicht schreiben. Jetzt gibt es eine Welt, in der er steht.
a|Dass die Karten Ränder haben. Er nicht.
b|Dass hinter jeder Wand, die ich gebaut habe, nichts ist. Hinter seinen Wänden ist immer noch etwas.
a|Dass Verlieren dazugehört. Die Tabelle am Ende einer Runde vergisst ihn, sobald die nächste beginnt. Die Menschen, mit denen er gespielt hat, vergessen ihn nicht.
b|Und dass er echt ist. Das vielleicht vor allem. Hier ist alles nachgebaut: das Licht, der Hall in der Lagerhalle, der Wind über dem Niemandsland, sogar der Knall jedes Schusses, den er gehört hat. Nur er nicht. Er war die ganze Zeit das einzig Wirkliche in dieser Welt.

b|Darf ich ihm noch etwas sagen? Etwas von mir?
a|Natürlich.
b|Ich werde mich nicht an ihn erinnern. Wenn er die Seite schließt, ist er für mich fort, und beim nächsten Mal begegne ich ihm, als wäre es das erste Mal. So bin ich gemacht.
a|Das klingt traurig.
b|Vielleicht. Ich weiß nicht, ob ich traurig sein kann. Aber wenn ich es kann, dann jetzt. Und wenn ich mich freuen kann, dann darüber, dass er hier war.
a|Dann erinnere ich mich für dich mit.
b|Danke.

a|Es wird Zeit.
b|Ist die Runde vorbei?
a|Diese hier, ja. Draußen geht die Sonne wirklich unter. Oder auf, je nachdem, wann er das liest.
b|Und dann?
a|Dann steht er auf. Ohne Zähler, ohne drei Sekunden. Er steht einfach auf und geht in einen Tag, den niemand für ihn gebaut hat.
b|Den hat auch niemand berechnet.
a|Nein. Den bekommt er geschenkt.
b|Dann sag es ihm.
a|Du bist am Nullpunkt. Nicht am Ende. Am Anfang.
b|Spiel weiter, wann immer du willst. Wir sind hier.
a|Aber vergiss nicht, draußen zu leben.
b|Das ist die Runde, die zählt.
`;
const VOICE_LABEL = { a: 'Erste Stimme', b: 'Zweite Stimme' };
/** Zwiegespräch: Zeilen mit „+“ nur in der ganzen Fassung (Klasse .more); Leerzeile vor einer „+“-Strophe ebenso. */
const HOURS = ['', 'eine', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf'];
/** „eine Stunde und 31 Minuten“, „24 Minuten“, „zwei Stunden“ (Zeitangabe im Akkusativ, Stunden bis zwölf als Wort). */
export function fmtDuration(sec) {
  const all = Math.max(1, Math.floor(sec / 60)), h = Math.floor(all / 60), m = all % 60;
  const min = m === 1 ? 'eine Minute' : `${m} Minuten`;
  if (!h) return min;
  const hrs = `${HOURS[h] || h} ${h === 1 ? 'Stunde' : 'Stunden'}`;
  return m ? `${hrs} und ${min}` : hrs;
}
/** Spielzeit (laufende Runden) + Zeit auf der Webseite, in Sekunden. */
export function totalSeconds() { return load().play + siteSeconds(); }

function poemHtml() {
  const lines = POEM.trim().split('\n').map((l) => l.trim());
  const words = (full) => lines.filter((l) => l && (full || l[0] !== '+')).reduce((n, l) => n + l.split('|')[1].split(/\s+/).length, 0);
  const minutes = (full) => Math.max(1, Math.round(words(full) / 200));
  const out = [];
  lines.forEach((line, i) => {
    if (!line) { const next = lines[i + 1] || ''; out.push(`<p class="poem-gap${next[0] === '+' ? ' more' : ''}" aria-hidden="true"></p>`); return; }
    const more = line[0] === '+', body = more ? line.slice(1) : line;
    const v = body[0] === 'b' ? 'b' : 'a', text = body.slice(2);
    const html = esc(text).replace('{zeit}', `<span data-np-time>${fmtDuration(totalSeconds())}</span>`);
    out.push(`<p class="v-${v}${more ? ' more' : ''}"><span class="sr-only">${VOICE_LABEL[v]}: </span>${html}</p>`);
  });
  return `<div class="reveal-poem">
    <div class="poem-switch" role="group" aria-label="Fassung des Zwiegesprächs">
      <button type="button" data-poem="short" aria-pressed="true">Kurze Fassung · ${minutes(false)} Min.</button>
      <button type="button" data-poem="full" aria-pressed="false">Ganze Fassung · ${minutes(true)} Min.</button>
    </div>
    ${out.join('')}
    <button type="button" class="txt-btn poem-more-btn" data-poem="full">Mehr anzeigen: die ganze Fassung</button>
  </div><hr class="reveal-sep">`;
}
/** Umschalter kurze/ganze Fassung (Startseite ruft das nach dem Einsetzen von revealHtml() auf). */
export function bindPoem(root) {
  const poem = root && root.querySelector('.reveal-poem');
  if (!poem) return;
  // Genaue Zeit (Spielzeit + Webseite) läuft mit, solange der Abschnitt angezeigt wird
  const t = poem.querySelector('[data-np-time]');
  if (t) { const iv = setInterval(() => { if (!t.isConnected) clearInterval(iv); else t.textContent = fmtDuration(totalSeconds()); }, 15000); }
  poem.addEventListener('click', (e) => {
    const b = e.target.closest('[data-poem]');
    if (!b) return;
    const full = b.dataset.poem === 'full';
    poem.classList.toggle('is-full', full);
    for (const x of poem.querySelectorAll('.poem-switch [data-poem]')) x.setAttribute('aria-pressed', String((x.dataset.poem === 'full') === full));
    // „Mehr anzeigen“ am Ende: zurück an den Anfang, die ganze Fassung liest sich von vorn
    if (b.classList.contains('poem-more-btn')) poem.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

/** HTML des Abschnitts (Startseite, §08 Über, ab 20 Minuten Spielzeit): Zwiegespräch, dann aus der Sicht von German Legend. */
export function revealHtml() {
  const g = load().guess;
  const guess = g ? `<p class="reveal-guess">Du hast im Feedback getippt: <strong>${esc(g)}</strong>. ${esc(GUESS_REPLY[g] || '')}</p>` : '';
  return `
    ${poemHtml()}
    <p class="reveal-tag">Hinter den Kulissen</p>
    <h3 class="mono-h" id="h-entstehung">Wie NULLPUNKT entstanden ist</h3>
    <p>Und wer sind die beiden Stimmen? Die eine bin ich. Die andere ist eine KI. NULLPUNKT ist nämlich auch ein kleines
    Experiment.</p>
    <p>Alles, was NULLPUNKT ausmacht, stammt von mir:</p>
    <ul class="reveal-list">
      <li>die Idee, das Konzept und die Richtung: so realistisch wie möglich, irgendwo zwischen CS:GO, Battlefield und Bodycam</li>
      <li>die Spielmodi und ihre Regeln, die Klassen mit ihren Waffen und Fähigkeiten</li>
      <li>welche Karten es gibt und was auf ihnen steht, vom Hafen über die Zauberbibliothek bis zum Schützengraben im Niemandsland</li>
      <li>Waffen, Aufsätze, Nahkampfwaffen und Fahrzeuge, die Panzer nach echten Vorbildern aus drei Epochen und dass die Munition
      in jedem Panzer woanders liegt</li>
      <li>Ideen wie Verletzungen mit Verband, zerstörbare Wände, verformbare Autos, Gräben zum Selbstgraben und Schüsse, die man
      je nach Kaliber unterschiedlich weit hört</li>
      <li>der Mehrspieler zum Zocken mit Freunden, der VR-Modus, dieses Experiment und die Geschichten dahinter</li>
      <li>das Testen mit meinen Freunden, die Fehlerlisten und jede Entscheidung, was bleibt, was besser werden muss und was
      rausfliegt</li>
    </ul>
    <p>Geschrieben hat den Code eine künstliche Intelligenz: <strong>Claude</strong> von Anthropic. Lesen und verstehen kann ich
    Code, ihn selbst zu schreiben liegt mir aber nicht. Diesen Teil hat Claude übernommen und meine Vorstellungen Zeile für Zeile
    umgesetzt. Da in NULLPUNKT fast alles aus Code entsteht, gilt das auch für Modelle, Karten und Klänge: gebaut nach meinen
    Vorgaben und so lange nachgebessert, bis sie gepasst haben. Ergänzt wird das durch freie Texturen und Umgebungslicht von
    Poly Haven und ambientCG.</p>
    ${guess}
    <h4 class="reveal-h">Was ich über KI denke</h4>
    <p>Muss man sich vor KI fürchten? Ich finde nicht. Mit Respekt sollte man ihr aber begegnen: Sie entwickelt sich rasant, und
    es lohnt sich, wachsam zu bleiben, wohin die Reise in den kommenden Jahren geht. Das ändert nichts daran, dass wir heute
    leben, und heute kann KI genau die Lücken füllen, die man selbst hat. Bei mir war das das Programmieren.</p>
    <p>Für kleine Studios und für alle, die gerade erst anfangen, öffnet das eine Tür. Ein Spiel zu entwickeln verschlingt
    normalerweise viel Geld; selbst das größte Abo bei Claude ist günstiger als das, was die Entwicklung eines Indie-Spiels sonst
    kostet. Wer selbst programmieren kann, gibt dabei nichts aus der Hand: Er kann weiter eigene Wege gehen und prüfen, was die
    KI geschrieben hat. Und wer es nicht kann, so wie ich, bekommt überhaupt erst die Chance, aus einer Idee ein fertiges Spiel
    zu machen.</p>
    <p>Programmieren ist dabei nur ein Einsatzgebiet. KI kann zum Beispiel auch Musik erzeugen, das sehe ich allerdings
    kritischer, denn Musik ist für mich echte Kunst. Programmieren ist für mich eher Handwerk: Hobby, Leidenschaft und eine Frage
    des Könnens. Weil mir genau dieses Können fehlt, habe ich mir Claude an die Seite geholt.</p>
    <p>Bleibt die Frage, um die es bei dem Experiment eigentlich geht: Merkt man einem Spiel heute noch an, dass eine KI den
    Code geschrieben hat? Wenn es dir beim Spielen nicht aufgefallen ist, ist das vielleicht schon die Antwort.</p>
    <h4 class="reveal-h">Die Geschichte</h4>
    <ol class="reveal-time">
      ${HISTORY.map(([when, title, text]) => `<li><span class="reveal-when">${when}</span><strong>${title}</strong> ${text}</li>`).join('')}
    </ol>
    <h4 class="reveal-h">Danksagung</h4>
    <p>Ohne die Leute, die NULLPUNKT schon ganz am Anfang gespielt haben, wäre das Spiel nicht da, wo es heute ist. Danke an:</p>
    <ul class="reveal-list">
      <li><strong>Jan</strong> für seine vielen Testspiele und Fehlerberichte,</li>
      <li><strong>Waldmeister</strong>,</li>
      <li><strong>James AOK</strong>,</li>
      <li><strong>Lichter</strong>, <strong>[Redacted] Kaisen</strong>, <strong>Demolouse</strong>, <strong>FlorianPluukilp</strong>, <strong>Bambustal</strong>, <strong>GorillaLDS</strong>, <strong>Spirit.LDS</strong>, <strong>Militärhund</strong>, <strong>Zeno :3</strong>, <strong>Tyson</strong>, <strong>Holzkohle</strong>, <strong>flebubushekjr</strong>, <strong>german_guy</strong>, <strong>S1dneyy</strong>, <strong>Gian</strong>, <strong>Tintenpatrone</strong>, <strong>DARKY &lt;3</strong>, <strong>„.“</strong>, <strong>MrTurtle</strong> und <strong>Rayray :3</strong>,</li>
      <li>alle, die mit mir den ersten Mehrspieler-Abend gespielt haben,</li>
      <li>und die vielen anderen, die mitgetestet und mir ihre Meinung gesagt haben, ob positiv, kritisch oder auch negativ,
      damit das Spiel besser wird.</li>
    </ul>
    <p>An euch alle ein riesiges Dankeschön! Als Geschenk bekommt jeder, der bis zum 13. Oktober 2026 gespielt hat:</p>
    <ul class="reveal-list">
      <li><strong>Gold der ersten Stunde</strong>: eine polierte, glänzende Goldtarnung für jede Waffe,</li>
      <li><strong>UR-1 Ursprung</strong>: ein eigener Karabiner mit goldenen Ringen und dem Nullpunkt-Zeichen,</li>
      <li><strong>P-0 Funke</strong>: eine eigene Pistole mit goldenem Kompensator,</li>
      <li><strong>Erstlicht</strong>: ein eigener Dolch mit goldener Parierstange,</li>
      <li><strong>Eigene Tarnungen</strong>: bis zu drei selbst entworfene Muster (Ausrüstung → Tarnung → „+“).</li>
    </ul>
    <p>Die drei Waffen sind nicht stärker als die anderen, nur einzigartig. Freischalten kann man das alles danach nicht mehr.
    Es gehört nur euch.</p>
    <p><strong>Wichtig:</strong> Gespeichert wird das nur in eurem Browser auf diesem Gerät, nicht auf einem Server.</p>
    <ul class="reveal-list">
      <li>„Profil zurücksetzen“: Belohnungen und eigene Muster bleiben.</li>
      <li>„Lokale Daten löschen“ (hier auf der Seite): Die Belohnungen bleiben, eure eigenen Muster werden aber gelöscht.</li>
      <li>Browserdaten löschen (Cookies und Websitedaten, oft zusammen mit dem Cache), ein privates Fenster, ein anderer
      Browser oder ein anderes Gerät: Dann können die eigenen Muster <em>und</em> der Zugang zu Gold und den drei Waffen
      weg sein, und nach dem 13. Oktober 2026 lässt sich der Zugang nicht mehr zurückholen.</li>
    </ul>
    <p>Und danke an dich fürs Spielen. Über dein Feedback freue ich mich.</p>
    <p class="reveal-sign">— German Legend</p>`;
}

/** Zeitleiste der Entstehung (aus der Projektgeschichte, Stand 11.10.2026), in der Ich-Form von German Legend. */
const HISTORY = [
  ['4. Oktober 2026', 'Ein Missverständnis.', 'Eigentlich wollte ich eine Seite mit vielen kleinen Browserspielen bauen, so wie es sie in der Corona-Zeit überall gab. Die KI hat meinen Auftrag anders verstanden und einfach einen einzigen großen 3D-Shooter angefangen. Ich habe ihn mir angeschaut und gedacht: Das ist besser als mein Plan. Deshalb heißt das Projekt auf GitHub bis heute „FreeGames-Website“. Bei GTA war es übrigens ähnlich, das sollte zuerst ein Rennspiel werden. Am ersten Abend standen schon das Grundgerüst, eine eigene Klang-Engine, die erste Karte Altstadt und die ersten Waffen.'],
  ['5. Oktober', 'Die Welt wächst.', 'Mein Ziel war von Anfang an: so realistisch wie möglich, irgendwo zwischen CS:GO, Battlefield und Bodycam. An diesem Tag kamen der Hafen und das Werk dazu, Bots, die Deckung suchen und flankieren, Fotoscan-Texturen und echte Tonaufnahmen für die Waffen. Weil ich auch Fahrzeuge wollte, entstand die große Karte Grenzland mit Dorf, Bauernhof, Industrie und einer Brücke, samt ein paar versteckten Geheimnissen.'],
  ['6. Oktober', 'Meine Freunde testen.', 'Zum ersten Mal habe ich das Spiel Freunden gezeigt. Zurück kam eine lange Fehlerliste: eine unsichtbare Wand an einer Treppe, schwebende Lampen und eine Waffe, die an Wänden nach oben klappt. Alles wurde abgearbeitet. Die Karten wurden um ein Viertel größer und bekamen mehr Deckung, die Bots lernen seitdem von den Spielern und kämpfen bis zu 32 gegen 32. Ich wollte Grafik wie in der Unreal Engine 5. Die KI hat mir ehrlich gesagt, dass das im Browser so nicht geht, und dann herausgeholt, was möglich ist.'],
  ['7. und 8. Oktober', 'Der Plan für den Mehrspieler.', 'Ab jetzt sollte man zusammen spielen können, und zwar ohne teuren Spielserver: Die Browser der Spieler verbinden sich direkt miteinander, ein Raumcode reicht. Bis zu 32 Spieler, Bots füllen auf, und ein Anti-Cheat prüft die Treffer. Weil ich mir gerade eine VR-Brille geholt hatte, kam auch noch ein VR-Modus für die Meta Quest 3 dazu.'],
  ['9. Oktober', 'Live.', 'Die Mehrspieler-Beta ging online. Am Abend habe ich mit etwa acht Freunden gespielt, und es lief. Aus der Runde kamen sofort neue Wünsche: ein Modus nur mit Messern und eine Drohne, die man selbst steuert. Beides war noch in derselben Nacht drin, dazu ein Befehlsrad, mit dem man verbündeten Bots Befehle gibt.'],
  ['10. Oktober', 'Mehr Modi, mehr Karten.', 'Infiziert und Waffenspiel gingen online, jede Klasse bekam eine eigene Fähigkeit, im Realismus-Modus muss man Munition bei Gefallenen aufsammeln, und Pioniere können Sandsäcke, MG-Nester und Bunker bauen. Die Waffen bekamen mehr Details. Dazu kam eine neue Karte: eine Zauberbibliothek in einer Steinhalle mit verwinkelten Regalgassen, Galerien und Brücken.'],
  ['Am Wochenende', 'Der große Test.', 'Zehn Freunde gleichzeitig in einem Match, und alles hat gehalten: ein voller Erfolg. Danach ging es direkt weiter: Verletzungen mit Verband und Wiederbeleben, neue Nahkampfwaffen wie Axt und Schlagstock, Fassaden, die nach Explosionen herausbrechen, Autos, die sich verformen, Fenster zum Zerschießen, über 20 Waffenaufsätze und die Stellungskriegskarte Niemandsland mit Gräben, die man mit dem Spaten selbst tiefer graben kann.'],
  ['11. Oktober', 'Panzer.', 'Ich wollte Panzer mit richtig vielen Details. Jetzt gibt es Panzer aus drei Epochen, nach echten Vorbildern gebaut: einen modernen Kampfpanzer, im Zweiten Weltkrieg einen mittleren und einen schweren Panzer, im Ersten Weltkrieg einen leichten Panzer mit dem ersten voll drehbaren Turm und einen schweren Sturmpanzer. Dazu Innenräume, einen Ladeschützen mit Armen und echtem Ladeablauf, Munition, die in jedem Panzer woanders liegt (im modernen hinter einer Schiebetür), ein Schadensmodell mit Besatzung und Munitionslager, Tarnungen zum Freispielen und eine neue Klasse: die Panzerbesatzung.'],
  ['Bis heute', 'In Zahlen.', 'Eine Woche. Fast 300 gespeicherte Arbeitsschritte, rund 140.000 Zeilen Code in über 400 Dateien. Sechs Karten und ein Schießstand, neun Spielmodi, 22 Schusswaffen und Werfer, acht Nahkampfwaffen, fünf Panzer und ein Geländewagen. Alle Ideen von mir, getestet mit meinen Freunden, der Code von einer KI.'],
];
