// Reiner Taktgeber für die Vitrine: Kadenz, Feuerarten, Magazin, Nachladen, Repetieren, Anschlag.
// Alle Zeiten aus den Waffendaten. Keine DOM-Zugriffe.
//
// createFire(def, cb) → { press(), release(), reload(), ads(on), update(dt), state, setDef(def) }
// cb: onShot(i) onCycle(ms) onReload(ms, empty) onReloadStep(mag) onReloadEnd(mag) onAds(on, ms) onAmmo(mag, reserve)

export function createFire(def, cb = {}) {
  const call = (name, ...a) => { try { cb[name]?.(...a); } catch (err) { console.error(err); } };
  let d = def;
  let t = 0;
  const st = {
    mag: 0, reserve: 0, held: false, next: 0, shotIndex: 0, lastShot: -1e9,
    reload: null, cycle: null, burstLeft: 0, ads: false, melee: false,
  };

  function setDef(nd) {
    d = nd;
    st.melee = d.cls === 'melee' || !(d.mag > 0);
    st.mag = d.mag || 0;
    st.reserve = d.reserve || 0;
    st.held = false;
    st.next = 0;
    st.shotIndex = 0;
    st.reload = null;
    st.cycle = null;
    st.burstLeft = 0;
    t = 0;
    call('onAmmo', st.mag, st.reserve);
  }
  setDef(def);

  const interval = () => (d.rpm > 0 ? 60 / d.rpm : 0.5);

  function shoot() {
    if (st.reload || st.cycle) return false;
    if (!st.melee && st.mag <= 0) { startReload(true); return false; }
    if (t - st.lastShot > interval() * 2 + 0.25) st.shotIndex = 0;
    if (!st.melee) st.mag -= 1;
    const i = st.shotIndex++;
    st.lastShot = t;
    call('onShot', i);
    call('onAmmo', st.mag, st.reserve);
    if (d.fireMode === 'bolt' || d.fireMode === 'pump') {
      const ms = interval() * 1000;
      st.cycle = { end: t + interval() };
      call('onCycle', ms);
    }
    if (!st.melee && st.mag <= 0) {
      // nach dem letzten Schuss (und ggf. Repetieren) automatisch nachladen
      st.autoReloadAt = t + (st.cycle ? interval() : 0.12);
    }
    return true;
  }

  function startReload(empty) {
    if (st.melee || st.reload) return;
    if (st.mag >= d.mag) return;
    if (st.reserve <= 0) st.reserve = (d.reserve || d.mag * 4); // Vitrine: Reserve füllt sich still nach
    const missing = d.mag - st.mag;
    if (d.perShellReload) {
      const total = (d.reloadEmptyTime || 3) * (missing / d.mag);
      st.reload = { t0: t, dur: total, empty, steps: missing, done: 0, perShell: true };
      call('onReload', total * 1000, empty);
    } else {
      const dur = empty || st.mag === 0 ? d.reloadEmptyTime : d.reloadTime;
      st.reload = { t0: t, dur, empty: empty || st.mag === 0, perShell: false };
      call('onReload', dur * 1000, st.reload.empty);
    }
    st.held = false;
    st.autoReloadAt = null;
  }

  function finishReload() {
    const r = st.reload;
    st.reload = null;
    if (!r.perShell) {
      const take = Math.min(d.mag - st.mag, st.reserve);
      st.mag += take;
      st.reserve -= take;
    }
    if (st.reserve <= 0) st.reserve = d.reserve || d.mag * 4;
    call('onAmmo', st.mag, st.reserve);
    call('onReloadEnd', st.mag);
  }

  return {
    get state() { return st; },
    get def() { return d; },
    setDef,

    press() {
      if (st.held) return;
      st.held = true;
      if (st.reload && st.reload.perShell && st.mag > 0) { st.reload = null; call('onReloadEnd', st.mag); }
      if (t < st.next) return;
      if (d.fireMode === 'burst' && d.burstCount > 1) {
        st.burstLeft = d.burstCount;
        if (shoot()) { st.burstLeft--; st.next = t + interval(); }
        return;
      }
      if (shoot()) st.next = t + interval();
    },

    release() { st.held = false; },

    reload() { if (!st.reload && !st.melee && st.mag < d.mag) startReload(st.mag === 0); },

    ads(on) {
      if (st.ads === on) return;
      st.ads = on;
      call('onAds', on, (d.adsTime || 0.2) * 1000);
    },

    update(dt) {
      t += dt;
      if (st.cycle && t >= st.cycle.end) st.cycle = null;
      if (st.autoReloadAt && t >= st.autoReloadAt && !st.cycle) { st.autoReloadAt = null; startReload(true); }
      if (st.reload) {
        const r = st.reload;
        if (r.perShell) {
          const per = r.dur / r.steps;
          while (r.done < r.steps && t - r.t0 >= per * (r.done + 1)) {
            r.done++;
            st.mag = Math.min(d.mag, st.mag + 1);
            st.reserve = Math.max(0, st.reserve - 1);
            call('onReloadStep', st.mag);
            call('onAmmo', st.mag, st.reserve);
          }
          if (r.done >= r.steps) finishReload();
        } else if (t - r.t0 >= r.dur) finishReload();
        return;
      }
      if (st.burstLeft > 0 && t >= st.next) {
        if (shoot()) { st.burstLeft--; st.next = st.burstLeft > 0 ? t + interval() : t + (d.burstDelay || interval()); }
        else st.burstLeft = 0;
        return;
      }
      if (d.fireMode === 'auto' && st.held && !st.melee) {
        let guard = 0;
        while (st.held && t >= st.next && guard++ < 4) {
          if (!shoot()) break;
          st.next = Math.max(st.next + interval(), t - interval());
        }
      }
    },

    /** Läuft noch etwas (Nachladen, Repetieren, Halten)? */
    get busy() { return !!(st.reload || st.cycle || st.held || st.burstLeft || st.autoReloadAt); },
  };
}
