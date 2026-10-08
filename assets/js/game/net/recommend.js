// NULLPUNKT – Mehrspieler: Empfehlung für die maximale Spielerzahl eines Hosts (Vertrag §9).
// Grundlage: Kerne (navigator.hardwareConcurrency), Speicher (navigator.deviceMemory, falls vorhanden), gemessene
// Bildrate und gemessener Upload (gesendete Bytes/s vs. Stau im Sendepuffer). Vor der ersten Upload-Messung
// konservativ 8. Bandbreite pro Spielerzahl n ≈ 20 Hz × (n − 1) × n × 40 Byte (Snapshots an n − 1 Clients).
// Reine Logik – UpdateMeter misst, recommend() rechnet; beides ohne DOM prüfbar.

export const SNAPSHOT_HZ = 20;
export const BYTES_PER_ENTITY = 40;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 32;
/** Ohne Messung: vorsichtiger Wert (Vertrag §9). */
export const UNMEASURED_MAX = 8;
/** Anteil des gemessenen Uploads, den das Spiel höchstens belegen soll (Rest: Zuverlässiges, Schwankungen). */
const HEADROOM = 0.8;

/** Benötigter Upload des Hosts (Byte/s) bei n Spielern (entities = Akteure je Snapshot, Standard n). */
export function bandwidthFor(n, { hz = SNAPSHOT_HZ, bytes = BYTES_PER_ENTITY, entities = n } = {}) {
  return hz * Math.max(0, n - 1) * Math.max(0, entities) * bytes;
}

/** Größte Spielerzahl, deren Bandbreite in `bytesPerSec` passt (mindestens 2). */
export function maxPlayersForUpload(bytesPerSec, { headroom = HEADROOM, entitiesFor = null } = {}) {
  const budget = Math.max(0, bytesPerSec) * headroom;
  let n = MIN_PLAYERS;
  for (let k = MIN_PLAYERS + 1; k <= MAX_PLAYERS; k++) {
    if (bandwidthFor(k, { entities: entitiesFor ? entitiesFor(k) : k }) <= budget) n = k; else break;
  }
  return n;
}

/** Gerätegrenze aus Kernen, Speicher und Bildrate → {max, why}. */
export function maxPlayersForDevice({ cores = null, memory = null, fps = null } = {}) {
  let max = MAX_PLAYERS;
  let why = null;
  const cap = (n, text) => { if (n < max) { max = n; why = text; } };
  if (Number.isFinite(cores) && cores > 0) {
    if (cores <= 2) cap(6, `nur ${cores} Prozessorkerne`);
    else if (cores <= 4) cap(12, `${cores} Prozessorkerne`);
    else if (cores <= 6) cap(16, `${cores} Prozessorkerne`);
    else if (cores <= 8) cap(24, `${cores} Prozessorkerne`);
  }
  if (Number.isFinite(memory) && memory > 0) {
    if (memory <= 2) cap(8, `${memory} GB Arbeitsspeicher`);
    else if (memory <= 4) cap(16, `${memory} GB Arbeitsspeicher`);
  }
  if (Number.isFinite(fps) && fps > 0) {
    if (fps < 30) cap(8, `Bildrate ${Math.round(fps)} FPS`);
    else if (fps < 45) cap(12, `Bildrate ${Math.round(fps)} FPS`);
    else if (fps < 55) cap(20, `Bildrate ${Math.round(fps)} FPS`);
  }
  return { max, why };
}

/**
 * Empfehlung. upload: {rate (Byte/s, gemessen gesendet), congested (Stau im Sendepuffer), measured, players
 * (Spieler während der Messung)} · connection: navigator.connection-Hinweise {effectiveType, saveData}.
 * → {max, reason, upload (Byte/s|null), fps, cores, memory, measured}
 */
export function recommend({ cores = null, memory = null, fps = null, upload = null, connection = null } = {}) {
  const dev = maxPlayersForDevice({ cores, memory, fps });
  let max = dev.max;
  let reason = dev.why ? `Begrenzt durch ${dev.why}` : 'Gerät leistungsstark genug';
  const measured = !!(upload && upload.measured);
  let up = null;
  if (!measured) {
    if (UNMEASURED_MAX < max) { max = UNMEASURED_MAX; reason = 'Upload noch nicht gemessen – vorsichtig 8'; }
  } else {
    up = Math.round(upload.rate);
    // Kein Stau: die Leitung trägt mindestens das Gemessene – vorsichtig hochrechnen (×2); Stau: das Gemessene ist
    // die Grenze. Nie unter die Spielerzahl, die ohne Stau lief.
    const capacity = upload.congested ? upload.rate : upload.rate * 2;
    let net = maxPlayersForUpload(capacity);
    if (!upload.congested && Number.isFinite(upload.players)) net = Math.max(net, upload.players);
    if (net < max) {
      max = net;
      const kbit = Math.round((upload.rate * 8) / 1000);
      reason = upload.congested ? `Upload ausgelastet (≈ ${kbit} kbit/s)` : `Upload gemessen ≈ ${kbit} kbit/s`;
    }
  }
  const et = connection && connection.effectiveType;
  if ((et === 'slow-2g' || et === '2g' || et === '3g') && max > 4) { max = 4; reason = 'langsame Mobilfunkverbindung'; }
  else if (connection && connection.saveData && max > 6) { max = 6; reason = 'Datensparmodus aktiv'; }
  max = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, max));
  return { max, reason, upload: up, fps: Number.isFinite(fps) ? Math.round(fps) : null, cores, memory, measured };
}

/**
 * Upload-Messung des Hosts: add(bytes) bei jedem Senden, sample(buffered, now) einmal pro Sekunde mit der Summe der
 * noch nicht gesendeten Bytes aller Kanäle. Gemessen gilt der Upload nach `minSamples` Sekunden mit nennenswertem
 * Verkehr (≥ minRate Byte/s, also z. B. während eines Matches); Stau = Sendepuffer wächst mehrfach hintereinander.
 */
export class UploadMeter {
  constructor({ minRate = 3000, minSamples = 5, congestBytes = 64 * 1024 } = {}) {
    this.minRate = minRate;
    this.minSamples = minSamples;
    this.congestBytes = congestBytes;
    this.bytes = 0;
    this.total = 0;
    this.rate = 0; // geglättet (Byte/s)
    this.peak = 0;
    this.samples = 0;
    this.lastAt = null;
    this.lastBuffered = 0;
    this.growing = 0;
    this.congested = false;
    this.players = null;
  }

  add(bytes) {
    this.bytes += bytes;
    this.total += bytes;
  }

  /** @returns {boolean} true, wenn sich Messstand/Stau geändert hat */
  sample(buffered, now, players = null) {
    if (this.lastAt == null) { this.lastAt = now; this.bytes = 0; this.lastBuffered = buffered; return false; }
    const dt = now - this.lastAt;
    if (dt < 0.25) return false;
    const sent = this.bytes;
    this.bytes = 0;
    this.lastAt = now;
    const growth = buffered - this.lastBuffered;
    this.lastBuffered = buffered;
    const before = this.measured + ':' + this.congested;
    // Stau: Sendepuffer über der Schwelle und wachsend (zweimal hintereinander)
    if (buffered > this.congestBytes && growth > 0) this.growing++;
    else if (buffered < this.congestBytes / 2) this.growing = 0;
    if (this.growing >= 2) this.congested = true;
    else if (this.growing === 0) this.congested = false;
    if (sent / dt >= this.minRate) {
      // tatsächlich abgeflossen = gesendet − Pufferzuwachs
      const drained = Math.max(0, sent - Math.max(0, growth)) / dt;
      this.rate = this.rate ? this.rate * 0.7 + drained * 0.3 : drained;
      this.peak = Math.max(this.peak, drained);
      this.samples++;
      if (Number.isFinite(players)) this.players = Math.max(this.players || 0, players);
    }
    return before !== this.measured + ':' + this.congested;
  }

  get measured() { return this.samples >= this.minSamples; }

  /** Stand für recommend(): {rate, congested, measured, players}. Ohne Stau zählt der beste gemessene Wert. */
  state() {
    return { rate: this.congested ? this.rate : Math.max(this.rate, this.peak * 0.8), congested: this.congested, measured: this.measured, players: this.players };
  }
}
