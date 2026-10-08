// NULLPUNKT – kleines Nostr-Relay (NIP-01) nur für lokale Mehrspieler-Tests, ohne Abhängigkeiten.
// Das echte Spiel nutzt öffentliche Relays; dieses hier ersetzt sie in der Testumgebung (?relays=ws://127.0.0.1:7777).
// Unterstützt: EVENT, REQ (ids, authors, kinds, #<tag>, since, until, limit), CLOSE, EOSE, OK.
// Kurzlebige Ereignisse (Kind 20000–29999) werden nur weitergereicht, ersetzbare (10000–19999, 30000–39999) ersetzt.
// Signaturen werden hier NICHT geprüft (Testumgebung); das Spiel prüft sie selbst.
// Aufruf: node tools/nostr-relay.mjs [port]   (Standard 7777)
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const PORT = Number(process.argv[2] || process.env.NP_RELAY_PORT || 7777);
const MAX_STORED = 5000;
const stored = [];
const clients = new Set();

const isEphemeral = (k) => k >= 20000 && k < 30000;
const isReplaceable = (k) => (k >= 10000 && k < 20000) || k === 0 || k === 3;
const isParamReplaceable = (k) => k >= 30000 && k < 40000;
const dTag = (ev) => (ev.tags.find((t) => t[0] === 'd') || [])[1] || '';

function matches(ev, f) {
  if (f.ids && !f.ids.some((p) => ev.id.startsWith(p))) return false;
  if (f.authors && !f.authors.some((p) => ev.pubkey.startsWith(p))) return false;
  if (f.kinds && !f.kinds.includes(ev.kind)) return false;
  if (f.since != null && ev.created_at < f.since) return false;
  if (f.until != null && ev.created_at > f.until) return false;
  for (const key of Object.keys(f)) {
    if (key[0] !== '#' || key.length !== 2) continue;
    const want = f[key];
    if (!ev.tags.some((t) => t[0] === key[1] && want.includes(t[1]))) return false;
  }
  return true;
}

function store(ev) {
  if (isEphemeral(ev.kind)) return;
  for (let i = stored.length - 1; i >= 0; i--) {
    const o = stored[i];
    const same = o.pubkey === ev.pubkey && o.kind === ev.kind &&
      (isReplaceable(ev.kind) || (isParamReplaceable(ev.kind) && dTag(o) === dTag(ev)));
    if (same) stored.splice(i, 1);
  }
  stored.push(ev);
  if (stored.length > MAX_STORED) stored.splice(0, stored.length - MAX_STORED);
}

// --- minimaler WebSocket-Server (RFC 6455, nur Textnachrichten) ---
function frame(text) {
  const data = Buffer.from(text);
  const len = data.length;
  const head = len < 126 ? Buffer.from([0x81, len])
    : len < 65536 ? Buffer.from([0x81, 126, len >> 8, len & 255])
    : Buffer.concat([Buffer.from([0x81, 127, 0, 0, 0, 0]), Buffer.from([(len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255])]);
  return Buffer.concat([head, data]);
}

function attach(socket) {
  const client = { socket, subs: new Map(), send: (msg) => { if (!socket.destroyed) socket.write(frame(JSON.stringify(msg))); } };
  clients.add(client);
  let buf = Buffer.alloc(0);
  let parts = [];
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let payload = buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = buf.subarray(off, off + 4);
        payload = Buffer.from(payload.map((b, i) => b ^ mask[i & 3]));
      }
      buf = buf.subarray(need);
      if (op === 0x8) { socket.end(Buffer.from([0x88, 0])); return; }
      if (op === 0x9) { socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; }
      if (op === 0x1 || op === 0x0) {
        parts.push(payload);
        if (fin) { const text = Buffer.concat(parts).toString('utf8'); parts = []; onMessage(client, text); }
      }
    }
  });
  const drop = () => clients.delete(client);
  socket.on('close', drop);
  socket.on('error', drop);
}

function onMessage(client, text) {
  let msg;
  try { msg = JSON.parse(text); } catch { return; }
  if (!Array.isArray(msg)) return;
  const [type, ...rest] = msg;
  if (type === 'EVENT') {
    const ev = rest[0];
    if (!ev || typeof ev.id !== 'string' || !Array.isArray(ev.tags)) { client.send(['OK', ev && ev.id, false, 'invalid: Format']); return; }
    store(ev);
    client.send(['OK', ev.id, true, '']);
    for (const c of clients) for (const [subId, filters] of c.subs) if (filters.some((f) => matches(ev, f))) c.send(['EVENT', subId, ev]);
  } else if (type === 'REQ') {
    const [subId, ...filters] = rest;
    client.subs.set(subId, filters);
    const limit = Math.min(...filters.map((f) => f.limit ?? Infinity));
    const hits = stored.filter((ev) => filters.some((f) => matches(ev, f))).sort((a, b) => b.created_at - a.created_at);
    for (const ev of hits.slice(0, Number.isFinite(limit) ? limit : hits.length)) client.send(['EVENT', subId, ev]);
    client.send(['EOSE', subId]);
  } else if (type === 'CLOSE') {
    client.subs.delete(rest[0]);
  }
}

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/nostr+json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify({ name: 'nullpunkt-test-relay', supported_nips: [1, 40] }));
});
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  attach(socket);
});
server.listen(PORT, '127.0.0.1', () => console.log(`Test-Relay läuft auf ws://127.0.0.1:${PORT}`));
