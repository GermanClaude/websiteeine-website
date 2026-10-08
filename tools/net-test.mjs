// NULLPUNKT – Prüft die Mehrspieler-Grundschicht mit mehreren Headless-Browsern über ein lokales Test-Relay:
// Host + N Clients (Raumcode), Nachrichten zuverlässig/schnell, Laufzeit (RTT), öffentliche Spieleliste.
// Voraussetzung: Server auf 8765 und node tools/nostr-relay.mjs 7777.
// Aufruf: node tools/net-test.mjs [clients=3]
import { chromium, BASE } from './pw.mjs';
const N = Number(process.argv[2] || 3);
const RELAY = 'ws://127.0.0.1:7777';
const code = 'TEST' + 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)] + '2';
const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
const page = async (qs) => { const c = await browser.newContext(); const p = await c.newPage(); p.on('pageerror', (e) => console.log('Seitenfehler:', e.message)); await p.goto(`${BASE}dev/net.html?${qs}&relays=${RELAY}`); return p; };
let fail = 0;
const check = (ok, text) => { console.log((ok ? 'OK   ' : 'FEHL ') + text); if (!ok) fail++; };
const host = await page(`role=host&code=${code}&public=1`);
await host.waitForFunction(() => window.__net && window.__net.ready, null, { timeout: 10000 });
check(await host.evaluate(() => window.__net.ready), 'Host mit Relay verbunden');
const lobby = await page('role=lobby');
const clients = [];
for (let i = 0; i < N; i++) clients.push(await page(`role=client&code=${code.toLowerCase()}&name=Spieler${i + 1}`));
const t0 = Date.now();
for (const [i, c] of clients.entries()) {
  const ok = await c.waitForFunction(() => window.__net.open || window.__net.errors.length, null, { timeout: 30000 }).then(() => c.evaluate(() => !!window.__net.open)).catch(() => false);
  check(ok, `Client ${i + 1} verbunden` + (ok ? '' : ': ' + await c.evaluate(() => window.__net.errors.join(','))));
}
console.log(`     Verbindungsaufbau aller Clients: ${Date.now() - t0} ms`);
for (const c of clients) await c.evaluate(() => { window.__net.link.sendRel({ t: 'echo', x: 42 }); const b = new ArrayBuffer(64); window.__net.link.sendFast(b); });
await new Promise((r) => setTimeout(r, 1500));
for (const [i, c] of clients.entries()) {
  const got = await c.evaluate(() => window.__net.got.map((g) => (g.m && g.m.t) || g.m));
  check(got.includes('welcome') && got.includes('echo-back') && got.some((g) => String(g).startsWith('[bin')), `Client ${i + 1} empfängt zuverlässig + schnell (${got.join(', ')})`);
  const rtt = await c.evaluate(() => window.__net.link.rtt);
  check(rtt > 0 && rtt < 200, `Client ${i + 1} RTT ${rtt.toFixed(1)} ms`);
}
check(await host.evaluate(() => window.__net.peers.length) === N, `Host sieht ${N} Clients`);
const list = await lobby.waitForFunction((c) => window.__net.lobby.some((g) => g.code === c), code, { timeout: 20000 }).then(() => true).catch(() => false);
check(list, 'Öffentliche Spieleliste zeigt den Raum');
const bad = await page(`role=client&code=ZZZZZZ&name=Falsch`);
const badErr = await bad.waitForFunction(() => window.__net.errors.length, null, { timeout: 30000 }).then(() => bad.evaluate(() => window.__net.errors[0])).catch(() => 'kein Fehler');
check(badErr === 'kein-host', `Falscher Code → Fehler „${badErr}“`);
await browser.close();
console.log(fail ? `${fail} Prüfung(en) fehlgeschlagen` : 'Alle Prüfungen bestanden');
process.exit(fail ? 1 : 0);
