// NULLPUNKT — TDM Ultimate: Team-Deathmatch in Runden mit einem Leben. Wer fällt, bleibt bis zur nächsten Runde
// draußen; eine Runde gewinnt das Team, das als letztes noch jemanden stehen hat (nach Ablauf der Rundenzeit das Team
// mit mehr Lebenden, bei Gleichstand niemand). Höchstens fünf Runden, wer zuerst drei gewinnt, gewinnt das Match
// (scoreLimit 3 = Rundensiege). Zu Rundenbeginn setzt der Modus alle Akteure an den Startbereichen neu ein.
// Online rechnet der Host (Rundenstand über netExtra an die Clients, Wiedereinstiege über die normalen 'spawn').
import { TdmMode } from './tdm.js';

const ROUND_TIME = 120;
const PAUSE = 5;
const ROUNDS = 5;

export class UltimateMode extends TdmMode {
  constructor(G, modeId, opts) {
    super(G, modeId, opts);
    this.round = 1;
    this.phase = 'kampf'; // 'kampf' | 'pause'
    this._nextAt = 0;
    this._spawning = false;
  }

  onKillScored() {} // Punkte sind gewonnene Runden

  allowOvertime() { return false; }

  /** Wiedereinstieg nur beim Rundenwechsel (der Modus setzt dann alle neu ein). */
  canRespawn() { return !this.isOver && this._spawning; }

  onStart() {
    this.timeLeft = ROUND_TIME;
    this._notice(`Runde 1 von ${ROUNDS} – ein Leben, das letzte Team gewinnt.`, 'gold');
  }

  _alive(team) {
    let n = 0;
    for (const a of this.G.actors) if (a.alive && a.team === team && !a.isStreakEntity) n++;
    return n;
  }

  tick(dt, playing) {
    if (!playing || this.isOver) return;
    const G = this.G;
    if (this.phase === 'pause') {
      if (G.time.elapsed >= this._nextAt) this._beginRound();
      return;
    }
    const a = this._alive('A'), b = this._alive('B');
    if (a === 0 || b === 0) this._endRound(a > b ? 'A' : b > a ? 'B' : null);
  }

  /** Rundenzeit abgelaufen: mehr Lebende gewinnen die Runde. */
  _onTimeUp() {
    if (this.phase !== 'kampf') return;
    const a = this._alive('A'), b = this._alive('B');
    this._endRound(a > b ? 'A' : b > a ? 'B' : null);
  }

  _endRound(winner) {
    const G = this.G;
    this.phase = 'pause';
    this._nextAt = G.time.elapsed + PAUSE;
    this.timeLeft = PAUSE;
    const name = (t) => (G.data && G.data.TEAM_NAMES && G.data.TEAM_NAMES[t]) || `Team ${t}`;
    this._notice(winner ? `Runde ${this.round} an ${name(winner)}!` : `Runde ${this.round}: unentschieden.`, winner && G.player && G.player.team === winner ? 'gold' : 'signal');
    G.events.emit('ult:round', { mode: this, round: this.round, winner, phase: 'end' });
    if (winner) this.addTeamScore(winner, 1); // drei Rundensiege beenden das Match (_afterScore)
    if (!this.isOver && this.round >= ROUNDS) this.end('score');
  }

  _beginRound() {
    const G = this.G;
    this.round += 1;
    this.phase = 'kampf';
    this.timeLeft = ROUND_TIME;
    this._spawning = true;
    try {
      for (const a of [...G.actors]) {
        if (a.isStreakEntity || typeof G.spawnActor !== 'function') continue;
        if (a.vehicle && G.vehicles && typeof G.vehicles.exit === 'function') { try { G.vehicles.exit(a); } catch { /* */ } }
        G.spawnActor(a);
      }
    } finally { this._spawning = false; }
    this._notice(`Runde ${this.round} von ${ROUNDS} – los!`, 'gold');
    G.events.emit('ult:round', { mode: this, round: this.round, phase: 'start' });
  }

  _notice(text, tone) { this.G.events.emit('mode:notice', { text, tone }); }

  netExtra(s) { s.ur = [this.round, this.phase === 'pause' ? 1 : 0]; }

  applyNetExtra(s) {
    if (!Array.isArray(s.ur)) return;
    const [r, p] = s.ur;
    const phase = p ? 'pause' : 'kampf';
    if (r !== this.round || phase !== this.phase) {
      if (phase === 'kampf' && r > this.round) this._notice(`Runde ${r} von ${ROUNDS} – los!`, 'gold');
      else if (phase === 'pause' && this.phase === 'kampf') this._notice(`Runde ${r} vorbei.`, 'signal');
      this.round = r;
      this.phase = phase;
    }
  }
}
