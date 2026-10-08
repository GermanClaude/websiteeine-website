// NULLPUNKT – Mehrspieler: direkte Verbindung zwischen zwei Browsern (WebRTC-Datenkanäle).
// Zwei Kanäle je Verbindung:
//   „rel“  – geordnet und zuverlässig: Lobby, Treffer, Abschüsse, Chat, Einstellungen (JSON)
//   „fast“ – ungeordnet, ohne Wiederholung: Positionen/Eingaben (Binär), alte Pakete sind wertlos
// Verbindungsdaten werden ohne „Trickle“ übertragen: erst Kandidaten sammeln (höchstens ICE_WAIT ms), dann ein
// einziges Angebot/Antwort – so reicht eine Nachricht je Richtung über die Relays.

export const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
const ICE_WAIT = 2500;
const OPEN_TIMEOUT = 15000;

function gathered(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(done, ICE_WAIT);
    function done() { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', check); resolve(); }
    function check() { if (pc.iceGatheringState === 'complete') done(); }
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/** Zählt die gefundenen Kandidatentypen (host/srflx/relay) – für Fehlerhinweise bei NAT-Problemen. */
export function candidateTypes(sdp) {
  const types = { host: 0, srflx: 0, relay: 0, prflx: 0 };
  for (const m of String(sdp).matchAll(/a=candidate:.* typ (\w+)/g)) types[m[1]] = (types[m[1]] || 0) + 1;
  return types;
}

export class PeerLink {
  constructor(pc, role, iceServers) {
    this.pc = pc;
    this.role = role;
    this.iceServers = iceServers;
    this.rel = null;
    this.fast = null;
    this.open = false;
    this.closed = false;
    this.rtt = 0;
    this.handlers = { open: [], message: [], close: [] };
    this._pingSeq = 0;
    this._pings = new Map();
    this._timer = null;
    this._openTimer = setTimeout(() => { if (!this.open) this.close('zeitueberschreitung'); }, OPEN_TIMEOUT);
    pc.addEventListener('connectionstatechange', () => {
      const st = pc.connectionState;
      if (st === 'failed' || st === 'closed') this.close(st === 'failed' ? 'verbindung-fehlgeschlagen' : 'geschlossen');
      else if (st === 'disconnected') {
        // Kurze Aussetzer (WLAN-Wechsel) überbrücken; erst nach 8 s aufgeben.
        clearTimeout(this._dcTimer);
        this._dcTimer = setTimeout(() => { if (pc.connectionState === 'disconnected') this.close('getrennt'); }, 8000);
      }
    });
  }

  on(name, fn) { this.handlers[name].push(fn); return () => { this.handlers[name] = this.handlers[name].filter((f) => f !== fn); }; }
  emit(name, ...args) { for (const fn of this.handlers[name]) { try { fn(...args); } catch (err) { console.warn('[net] Fehler in PeerLink-Handler', name, err); } } }

  _attach(ch) {
    ch.binaryType = 'arraybuffer';
    if (ch.label === 'rel') this.rel = ch; else if (ch.label === 'fast') this.fast = ch; else return;
    ch.onopen = () => this._checkOpen();
    ch.onclose = () => this.close('kanal-geschlossen');
    ch.onmessage = (e) => this._onMessage(ch, e.data);
    if (ch.readyState === 'open') this._checkOpen();
  }

  _checkOpen() {
    if (this.open || !this.rel || !this.fast || this.rel.readyState !== 'open' || this.fast.readyState !== 'open') return;
    this.open = true;
    clearTimeout(this._openTimer);
    this._timer = setInterval(() => this.ping(), 1000);
    this.ping();
    this.emit('open');
  }

  _onMessage(ch, data) {
    if (typeof data === 'string') {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (msg && msg.t === '_ping') { this.sendRel({ t: '_pong', s: msg.s }); return; }
      if (msg && msg.t === '_pong') {
        const t0 = this._pings.get(msg.s);
        if (t0 != null) {
          this._pings.delete(msg.s);
          const sample = performance.now() - t0;
          this.rtt = this.rtt ? this.rtt * 0.8 + sample * 0.2 : sample;
        }
        return;
      }
      this.emit('message', msg, ch.label);
    } else {
      this.emit('message', data, ch.label);
    }
  }

  ping() {
    if (!this.open) return;
    const s = ++this._pingSeq;
    this._pings.set(s, performance.now());
    if (this._pings.size > 20) this._pings.delete(this._pings.keys().next().value);
    this.sendRel({ t: '_ping', s });
  }

  /** Zuverlässig + geordnet (JSON). */
  sendRel(obj) {
    if (!this.rel || this.rel.readyState !== 'open') return false;
    try { this.rel.send(JSON.stringify(obj)); return true; } catch { return false; }
  }

  /** Schnell, ohne Wiederholung (ArrayBuffer). Überlaufender Puffer → Paket verwerfen statt stauen. */
  sendFast(buf) {
    if (!this.fast || this.fast.readyState !== 'open') return false;
    if (this.fast.bufferedAmount > 256 * 1024) return false;
    try { this.fast.send(buf); return true; } catch { return false; }
  }

  /** Noch nicht gesendete Bytes (Maß für Überlastung der Leitung). */
  get buffered() {
    return (this.rel ? this.rel.bufferedAmount : 0) + (this.fast ? this.fast.bufferedAmount : 0);
  }

  close(reason = 'geschlossen') {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    clearTimeout(this._openTimer);
    clearTimeout(this._dcTimer);
    clearInterval(this._timer);
    try { this.pc.close(); } catch { /* egal */ }
    this.emit('close', reason);
  }

  /** Verbindungsaufbau als Anrufer (Client → Host). Liefert {link, sdp} – sdp geht über die Vermittlung zum Host. */
  static async offer(iceServers = ICE_SERVERS) {
    const pc = new RTCPeerConnection({ iceServers });
    const link = new PeerLink(pc, 'client', iceServers);
    link._attach(pc.createDataChannel('rel', { ordered: true }));
    link._attach(pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 }));
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    return { link, sdp: pc.localDescription.sdp };
  }

  /** Antwort des Hosts auf ein Angebot. Liefert {link, sdp}. */
  static async answer(offerSdp, iceServers = ICE_SERVERS) {
    const pc = new RTCPeerConnection({ iceServers });
    const link = new PeerLink(pc, 'host', iceServers);
    pc.ondatachannel = (e) => link._attach(e.channel);
    await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc);
    return { link, sdp: pc.localDescription.sdp };
  }

  /** Anrufer übernimmt die Antwort des Hosts. */
  async accept(answerSdp) {
    await this.pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  }
}
