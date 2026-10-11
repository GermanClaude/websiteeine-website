// NULLPUNKT – Feedback an den Entwickler (Nutzer 11.10.): Spielzeit-Zähler (ab 20 Minuten), Hinweis beim Verlassen,
// Formular (Sterne, Ankreuzfragen, Fehlerbericht), Discord-Kopie/E-Mail-Text, Freischaltung „Wie NULLPUNKT entstanden ist“
// auf der Startseite nur ab 3 Sternen. Aufruf: node tools/feedback-test.mjs   (Exit-Code ≠ 0 bei Fehlern)
import { chromium, BASE, GL_ARGS } from './pw.mjs';

let fail = 0, count = 0;
const check = (ok, text, val = '') => { count++; if (!ok) fail++; console.log(`${ok ? 'OK  ' : 'FEHL'} ${text}${val !== '' ? ` → ${val}` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const browser = await chromium.launch({ args: GL_ARGS });
const ctxOpts = { viewport: { width: 1280, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] };
const watch = (p) => { p.on('pageerror', (e) => errors.push(e.message)); return p; };
const fbState = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('nullpunkt:feedback') || '{}'));

try {
  // 1) Neu: nichts freigeschaltet
  let ctx = await browser.newContext({ ...ctxOpts, baseURL: BASE });
  let p = watch(await ctx.newPage());
  await p.goto(BASE + 'spielen.html', { waitUntil: 'load', timeout: 180000 });
  await p.waitForSelector('.lb-foot', { timeout: 180000 });
  check(await p.evaluate(() => document.querySelector('[data-act="feedback"]').hidden), 'Lobby ohne Spielzeit: kein Feedback-Knopf');

  // 2) Spielzeit läuft nur in Runden: 1199,5 s vorgeben, Runde starten → Freischaltung
  await p.evaluate(() => localStorage.setItem('nullpunkt:feedback', JSON.stringify({ play: 1199.5 })));
  await p.goto(BASE + 'spielen.html?autostart=1&mode=tdm&map=hafen&quality=low&allies=0&enemies=1', { waitUntil: 'load', timeout: 180000 });
  let st = null;
  for (let i = 0; i < 120; i++) { st = await fbState(p); if (st.play >= 1200) break; await sleep(1000); }
  check(st && st.play >= 1200, 'In der Runde gezählt, 20 Minuten erreicht', st ? `${st.play.toFixed(1)} s` : 'kein Zustand');

  // 3) Lobby: Knopf da; Verlassen → Hinweis → Formular → Discord → Freischaltung → Startseite
  await p.goto(BASE + 'spielen.html', { waitUntil: 'load', timeout: 180000 });
  await p.waitForSelector('.lb-foot', { timeout: 180000 });
  check(await p.evaluate(() => !document.querySelector('[data-act="feedback"]').hidden), 'Lobby nach 20 Minuten: Feedback-Knopf sichtbar');
  await p.click('.lb-tools [data-act="exit"]');
  await p.waitForSelector('.npfb-back', { timeout: 10000 });
  const promptText = await p.textContent('.npfb');
  check(/Feedback an den Entwickler\?/.test(promptText) && /Ohne Feedback verlassen/.test(promptText), 'Beim Verlassen: Hinweis „Feedback an den Entwickler?“');
  await p.click('.npfb [data-a="yes"]');
  await p.waitForSelector('.npfb [data-send="discord"]', { timeout: 10000 });
  await p.click('.npfb [data-send="discord"]');
  check(await p.evaluate(() => !document.querySelector('.npfb [data-err]').hidden), 'Ohne Sterne: Hinweis „Bitte vergib zuerst Sterne“');
  await p.click('.npfb [data-star="4"]');
  await p.click('.npfb label:has(input[value="Allein gegen Bots"])');
  await p.click('.npfb label:has(input[value="PC"])');
  await p.click('.npfb label:has(input[value="Grafik"])');
  await p.click('.npfb label:has(input[value="Mit Hilfe von KI"])');
  await p.fill('.npfb [data-f="bug"]', 'Testfehler: Treppe auf Hafen');
  await p.click('.npfb [data-send="discord"]');
  await p.waitForSelector('.npfb [data-a="ok"]', { timeout: 10000 });
  const thanks = await p.textContent('.npfb');
  const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  check(/freigeschaltet/.test(thanks), 'Nach 4 Sternen: Freischaltung angekündigt');
  check(/Bewertung: ★★★★☆ \(4\/5\)/.test(clip) && /Allein gegen Bots/.test(clip) && /Mit Hilfe von KI/.test(clip) && /Testfehler/.test(clip) && /Spielzeit 20 min/.test(clip), 'Text für Discord kopiert (Sterne, Antworten, Fehler, Spielzeit)', clip.split('\n')[1] || '(leer)');
  st = await fbState(p);
  check(st.sent === 1 && st.stars === 4 && st.reveal === true && st.guess === 'Mit Hilfe von KI', 'Zustand: gesendet, 4 Sterne, freigeschaltet, Vermutung gemerkt');
  await Promise.all([p.waitForURL(/index\.html/, { timeout: 20000 }), p.click('.npfb [data-a="ok"]')]);
  check(true, 'Nach dem Schließen weiter zur Startseite');
  await p.goto(BASE + 'index.html#ueber', { waitUntil: 'load' });
  await p.waitForTimeout(2500);
  const rev = await p.evaluate(() => { const b = document.getElementById('entstehung'); return { hidden: b.hidden, text: b.textContent }; });
  check(!rev.hidden && /Claude/.test(rev.text) && /German Legend/.test(rev.text) && /Gut erkannt/.test(rev.text), 'Startseite: „Wie NULLPUNKT entstanden ist“ sichtbar, mit Vermutung');
  check(await p.evaluate(() => !document.getElementById('fb-cta').hidden), 'Startseite: Feedback-Knopf sichtbar');
  await p.evaluate(() => document.getElementById('entstehung').scrollIntoView({ block: 'start' }));
  await p.waitForTimeout(500);
  await p.screenshot({ path: 'tools/out/feedback-reveal.png' });
  await ctx.close();

  // 4) Unter 3 Sternen: gesendet, aber keine Freischaltung; E-Mail-Adresse und Betreff stimmen
  ctx = await browser.newContext({ ...ctxOpts });
  p = watch(await ctx.newPage());
  await p.goto(BASE + 'index.html', { waitUntil: 'load' });
  await p.evaluate(() => localStorage.setItem('nullpunkt:feedback', JSON.stringify({ play: 1500 })));
  await p.goto(BASE + 'index.html#ueber', { waitUntil: 'load' });
  await p.waitForTimeout(2500);
  check(await p.evaluate(() => document.getElementById('entstehung').hidden), 'Startseite vor dem Feedback: Abschnitt noch verborgen');
  await p.click('#fb-open');
  await p.waitForSelector('.npfb [data-send="mail"]');
  await p.screenshot({ path: 'tools/out/feedback-form.png' });
  const mail = await p.evaluate(async () => { const F = await import('./assets/js/shared/feedback.js'); return F.mailtoFor('Hallo Welt', 2); });
  check(mail.startsWith('mailto:legendgerman749@gmail.com?subject=NULLPUNKT%20Feedback%20(2%2F5)&body=Hallo%20Welt'), 'E-Mail-Link: Adresse, Betreff, Text', mail.slice(0, 60));
  await p.click('.npfb [data-star="2"]');
  await p.click('.npfb [data-send="discord"]');
  await p.waitForSelector('.npfb [data-a="ok"]', { timeout: 10000 });
  const t2 = await p.textContent('.npfb');
  st = await fbState(p);
  check(st.sent === 1 && st.reveal === false && !/freigeschaltet/.test(t2) && /ehrliche Bewertung/.test(t2), '2 Sterne: gesendet, keine Freischaltung');
  await p.click('.npfb [data-a="ok"]');
  check(await p.evaluate(() => document.getElementById('entstehung').hidden), 'Startseite nach 2 Sternen: Abschnitt bleibt verborgen');
  await ctx.close();
  check(errors.length === 0, `keine Seitenfehler${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} catch (err) {
  check(false, `Ausnahme: ${err.message}`);
} finally {
  await browser.close();
  console.log(fail ? `${fail} von ${count} Prüfung(en) fehlgeschlagen` : `Alle ${count} Prüfungen bestanden`);
  process.exit(fail ? 1 : 0);
}
