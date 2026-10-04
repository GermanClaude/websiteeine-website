// NULLPUNKT — EventBus (§3 des Vertrags).
// Synchron, Copy-on-Write-Listenerlisten (emit iteriert ohne Kopie), Fehler eines
// Listeners brechen die Kette nicht ab. Zusätzlich: onAny() für Debug/Tests und
// scope() für das attach/detach-Muster der Subsysteme.

export class EventBus {
  constructor() {
    /** @type {Map<string, Function[]>} */
    this._map = new Map();
    /** @type {Function[]} */
    this._any = [];
    this._errorsLogged = new Set();
  }

  /** Abonniert `name`. Gibt eine Abmeldefunktion zurück. */
  on(name, fn) {
    if (typeof fn !== 'function') throw new TypeError(`EventBus.on(${name}): Listener ist keine Funktion`);
    const list = this._map.get(name);
    this._map.set(name, list ? [...list, fn] : [fn]);
    return () => this.off(name, fn);
  }

  /** Wie on(), aber nur für das nächste Ereignis. */
  once(name, fn) {
    const wrapper = (payload) => { this.off(name, wrapper); fn(payload); };
    wrapper._orig = fn;
    return this.on(name, wrapper);
  }

  off(name, fn) {
    const list = this._map.get(name);
    if (!list) return;
    const next = list.filter((f) => f !== fn && f._orig !== fn);
    if (next.length) this._map.set(name, next); else this._map.delete(name);
  }

  emit(name, payload) {
    const list = this._map.get(name);
    if (list) {
      for (let i = 0; i < list.length; i++) {
        try { list[i](payload); } catch (err) { this._report(name, err); }
      }
    }
    const any = this._any;
    for (let i = 0; i < any.length; i++) {
      try { any[i](name, payload); } catch (err) { this._report('*', err); }
    }
  }

  /** Listener für alle Ereignisse: fn(name, payload). Gibt Abmeldefunktion zurück. */
  onAny(fn) {
    this._any = [...this._any, fn];
    return () => { this._any = this._any.filter((f) => f !== fn); };
  }

  /** Anzahl Listener (Leck-Diagnose). */
  count(name) {
    if (name) return (this._map.get(name) || []).length;
    let n = this._any.length;
    for (const list of this._map.values()) n += list.length;
    return n;
  }

  /**
   * Gruppe von Abos, die gemeinsam gelöst werden – ideal für attach()/detach():
   *   this._subs = G.events.scope(); this._subs.on('kill', fn); … this._subs.dispose();
   */
  scope() {
    const offs = [];
    return {
      on: (name, fn) => { const off = this.on(name, fn); offs.push(off); return off; },
      once: (name, fn) => { const off = this.once(name, fn); offs.push(off); return off; },
      dispose: () => { while (offs.length) offs.pop()(); },
    };
  }

  clear() {
    this._map.clear();
    this._any = [];
  }

  _report(name, err) {
    // Jeden Fehler pro Ereignis + Meldung nur einmal loggen (kein Konsolen-Spam im Spielloop).
    const key = `${name}:${err && err.message}`;
    if (this._errorsLogged.has(key)) return;
    this._errorsLogged.add(key);
    console.error(`[NULLPUNKT] Fehler in Listener für „${name}“:`, err);
  }
}
