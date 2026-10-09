// Online „Nur Messer“: Host öffnet Raum im Modus messer (normaler Weg über net.host), Client tritt bei, Match startet,
// beide tragen nur das Messer.
import { chromium, BASE, GL_ARGS } from './pw.mjs';
const RELAY = 'ws://localhost:7777';
const browser = await chromium.launch({ args: GL_ARGS });
let fail = 0;
const check = (ok, t) => { console.log((ok ? 'OK   ' : 'FEHL ') + t); if (!ok) fail++; };
const errors = [];
async function open(name) {
  const p = await (await browser.newContext({ viewport: { width: 800, height: 450 } })).newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await p.goto(`${BASE}spielen.html?relays=${encodeURIComponent(RELAY)}&quality=low`);
  await p.waitForFunction(() => window.__game && window.__game.net, null, { timeout: 300000 });
  return p;
}
const until = async (p, fn, ms) => { const t0 = Date.now(); for (;;) { if (await p.evaluate(fn).catch(() => false)) return true; if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 1000)); } };
const host = await open('Host');
const cl = await open('Client');
const code = await host.evaluate(() => window.__game.net.host({ name: 'Messer', mode: 'messer', map: 'werk', maxPlayers: 4, teamSize: 2, pvp: 'pvp', botFill: true, difficulty: 'rekrut', weather: 'standard', time: 'standard', style: 'arcade' }).then((r) => r.code, (e) => 'FEHLER:' + e.code));
const mode = await host.evaluate(() => window.__game.net.room && window.__game.net.room.settings.mode);
check(/^[A-Z2-9]{6}$/.test(code) && mode === 'messer', `Raum ${code}, Modus ${mode}`);
const j = await cl.evaluate((c) => window.__game.net.join(c, { name: 'Bert' }).then((r) => ({ ok: true, id: r.id }), (e) => ({ ok: false, code: e.code })), code);
check(j.ok, `Client tritt bei (${j.id || j.code})`);
await host.evaluate(() => window.__game.net.startMatch());
const ok = await Promise.all([host, cl].map((p) => until(p, () => window.__game.match.state === 'playing' && window.__game.player.alive, 900000)));
check(ok.every(Boolean), 'Host + Client im Match');
const knifeOnly = (p) => p.evaluate(() => { const w = window.__game.player.weapon; return { slots: w.slots.map((s) => s.def.id), mode: window.__game.mode && window.__game.mode.def && window.__game.mode.def.id }; });
const h = await knifeOnly(host); const c = await knifeOnly(cl);
check(h.mode === 'messer' && c.mode === 'messer', `Modus bei beiden messer (${h.mode}/${c.mode})`);
check(h.slots.join() === 'knife' && c.slots.join() === 'knife', `nur Messer: Host ${h.slots} | Client ${c.slots}`);
check(errors.length === 0, `keine Seitenfehler ${errors.slice(0, 3).join(' | ')}`);
await browser.close();
console.log(fail ? `${fail} Fehler` : 'Alle Prüfungen bestanden');
process.exit(fail ? 1 : 0);
