// NULLPUNKT – prüft die öffentlichen Nostr-Relays (Annahme + Auslieferung unserer Ereignisarten). Braucht 'undici' (npm i undici) wegen Proxy.
// Aufruf: node tools/relay-check.mjs [wss://… …]
// Prüft öffentliche Relays: nehmen sie unsere Ereignisarten (25050 kurzlebig, 30650 ersetzbar mit Ablauf) an und liefern sie aus?
import { WebSocket, EnvHttpProxyAgent } from 'undici';
import { newKeys, signEvent } from '../assets/js/game/net/crypto.js';
import { DEFAULT_RELAYS, KIND_SIGNAL, KIND_LOBBY, LOBBY_TOPIC } from '../assets/js/game/net/signal.js';
const agent = new EnvHttpProxyAgent();
const keys = newKeys();
const now = () => Math.floor(Date.now() / 1000);
const topic = 'np1-selbsttest-' + Math.random().toString(36).slice(2, 8);
async function test(url) {
  return new Promise((resolve) => {
    const res = { url, open: false, okSignal: null, okLobby: null, echoSignal: false, echoLobby: false, notes: [] };
    let ws;
    const done = () => { try { ws.close(); } catch {} resolve(res); };
    const timer = setTimeout(done, 12000);
    try { ws = new WebSocket(url, { dispatcher: agent }); } catch (e) { res.notes.push(String(e)); clearTimeout(timer); return resolve(res); }
    let evS, evL;
    ws.onopen = async () => {
      res.open = true;
      ws.send(JSON.stringify(['REQ', 's1', { kinds: [KIND_SIGNAL], '#t': [topic], since: now() - 30 }, { kinds: [KIND_LOBBY], '#t': [LOBBY_TOPIC], authors: [keys.pk] }]));
      await new Promise((r) => setTimeout(r, 500));
      evS = await signEvent(keys, KIND_SIGNAL, [['t', topic]], 'x');
      evL = await signEvent(keys, KIND_LOBBY, [['d', 'selbsttest'], ['t', LOBBY_TOPIC], ['expiration', String(now() + 30)]], JSON.stringify({ v: 0, test: true, ended: true }));
      ws.send(JSON.stringify(['EVENT', evS]));
      ws.send(JSON.stringify(['EVENT', evL]));
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m[0] === 'OK') { if (evS && m[1] === evS.id) res.okSignal = m[2] + (m[3] ? ' ' + m[3] : ''); if (evL && m[1] === evL.id) res.okLobby = m[2] + (m[3] ? ' ' + m[3] : ''); }
      if (m[0] === 'EVENT') { if (evS && m[2].id === evS.id) res.echoSignal = true; if (evL && m[2].id === evL.id) res.echoLobby = true; }
      if (m[0] === 'NOTICE' || m[0] === 'CLOSED') res.notes.push(m.join(' ').slice(0, 120));
      if (res.okSignal !== null && res.okLobby !== null && res.echoSignal && res.echoLobby) { clearTimeout(timer); done(); }
    };
    ws.onerror = (e) => res.notes.push('Fehler ' + (e.message || e.type));
  });
}
const LIST = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_RELAYS;
for (const r of await Promise.all(LIST.map(test))) console.log(JSON.stringify(r));
process.exit(0);
