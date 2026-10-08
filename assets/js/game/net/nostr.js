// NULLPUNKT – Mehrspieler: Verbindung zu mehreren öffentlichen Nostr-Relays (NIP-01).
// Die Relays dienen nur der Vermittlung (Host finden, Verbindungsangebote austauschen, öffentliche Spiele listen);
// das eigentliche Spiel läuft danach direkt zwischen den Browsern (WebRTC).
// Mehrere Relays gleichzeitig: Fällt eines aus, laufen die anderen weiter. Ereignisse werden über ihre ID entdoppelt
// und vor der Weitergabe auf eine gültige Signatur geprüft.
import { verifyEvent } from './crypto.js';

const RETRY_MIN = 1000;
const RETRY_MAX = 30000;
const PUBLISH_TIMEOUT = 6000;

class Relay {
  constructor(url, pool) {
    this.url = url;
    this.pool = pool;
    this.ws = null;
    this.state = 'getrennt';
    this.retry = RETRY_MIN;
    this.queue = [];
    this.closed = false;
    this.connect();
  }

  connect() {
    if (this.closed) return;
    this.state = 'verbinde';
    let ws;
    try { ws = new WebSocket(this.url); } catch { this.scheduleRetry(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.state = 'offen';
      this.retry = RETRY_MIN;
      for (const [id, sub] of this.pool.subs) this.send(['REQ', id, ...sub.filters]);
      const q = this.queue; this.queue = [];
      for (const msg of q) this.send(msg);
      this.pool.status();
    };
    ws.onmessage = (e) => this.pool.onMessage(this, e.data);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.state = 'getrennt';
      this.pool.status();
      this.scheduleRetry();
    };
    ws.onerror = () => { /* onclose folgt */ };
  }

  scheduleRetry() {
    if (this.closed) return;
    const wait = this.retry;
    this.retry = Math.min(RETRY_MAX, this.retry * 2);
    setTimeout(() => this.connect(), wait + Math.random() * 400);
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(msg)); return true; } catch { /* fällt in die Warteschlange */ }
    }
    if (msg[0] === 'EVENT' && this.queue.length < 50) this.queue.push(msg);
    return false;
  }

  close() {
    this.closed = true;
    if (this.ws) { try { this.ws.close(); } catch { /* egal */ } }
    this.ws = null;
  }
}

export class RelayPool {
  /**
   * @param {string[]} urls wss://-Adressen
   * @param {{onStatus?: (open:number,total:number)=>void}} [opts]
   */
  constructor(urls, opts = {}) {
    this.opts = opts;
    this.subs = new Map();
    this.seen = new Set();
    this.seenOrder = [];
    this.verifying = new Set();
    this.pendingOk = new Map();
    this.nextSub = 1;
    this.relays = [...new Set(urls)].map((u) => new Relay(u, this));
  }

  /** Anzahl der aktuell offenen Relays. */
  get openCount() {
    return this.relays.filter((r) => r.state === 'offen').length;
  }

  status() {
    if (this.opts.onStatus) this.opts.onStatus(this.openCount, this.relays.length);
  }

  /** Wartet, bis mindestens ein Relay offen ist (oder Zeitüberschreitung → false). */
  waitOpen(timeout = 8000) {
    if (this.openCount) return Promise.resolve(true);
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = setInterval(() => {
        if (this.openCount) { clearInterval(tick); resolve(true); }
        else if (Date.now() - t0 > timeout) { clearInterval(tick); resolve(false); }
      }, 100);
    });
  }

  /** Veröffentlicht ein signiertes Ereignis auf allen Relays. Ergebnis: Anzahl der Bestätigungen (≥1 = angekommen). */
  publish(ev) {
    return new Promise((resolve) => {
      let oks = 0;
      let left = this.relays.length;
      const done = () => { this.pendingOk.delete(ev.id); clearTimeout(timer); resolve(oks); };
      const timer = setTimeout(done, PUBLISH_TIMEOUT);
      this.pendingOk.set(ev.id, (ok) => {
        if (ok) oks++;
        left--;
        if (oks >= 2 || left <= 0) done();
      });
      for (const r of this.relays) r.send(['EVENT', ev]);
    });
  }

  /**
   * Abonniert Ereignisse. onEvent erhält nur geprüfte, noch nicht gesehene Ereignisse.
   * @returns {{close: () => void}}
   */
  subscribe(filters, onEvent) {
    const id = 'np' + (this.nextSub++).toString(36) + Math.random().toString(36).slice(2, 6);
    this.subs.set(id, { filters, onEvent });
    for (const r of this.relays) if (r.state === 'offen') r.send(['REQ', id, ...filters]);
    return {
      close: () => {
        if (!this.subs.delete(id)) return;
        for (const r of this.relays) if (r.state === 'offen') r.send(['CLOSE', id]);
      },
    };
  }

  markSeen(id) {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > 4000) this.seen.delete(this.seenOrder.shift());
    return true;
  }

  onMessage(relay, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!Array.isArray(msg)) return;
    if (msg[0] === 'EVENT') {
      const sub = this.subs.get(msg[1]);
      const ev = msg[2];
      if (!sub || !ev || typeof ev.id !== 'string') return;
      // Entdoppelt je Abo (dasselbe Ereignis kommt von mehreren Relays). Erst nach erfolgreicher Prüfung als
      // gesehen markieren – sonst könnte eine gefälschte Kopie mit derselben ID das echte Ereignis verdrängen.
      const key = msg[1] + ':' + ev.id;
      if (this.seen.has(key) || this.verifying.has(key)) return;
      this.verifying.add(key);
      verifyEvent(ev).then((ok) => {
        this.verifying.delete(key);
        if (!ok || !this.markSeen(key)) return;
        if (this.subs.get(msg[1]) === sub) {
          try { sub.onEvent(ev); } catch (err) { console.warn('[net] Fehler im Relay-Abo:', err); }
        }
      });
    } else if (msg[0] === 'OK') {
      const cb = this.pendingOk.get(msg[1]);
      if (cb) cb(msg[2] === true);
    } else if (msg[0] === 'NOTICE' || msg[0] === 'CLOSED') {
      console.info('[net] Relay', relay.url, msg[0], msg[2] || msg[1]);
    }
  }

  close() {
    for (const [id] of this.subs) for (const r of this.relays) if (r.state === 'offen') r.send(['CLOSE', id]);
    this.subs.clear();
    for (const r of this.relays) r.close();
  }
}
