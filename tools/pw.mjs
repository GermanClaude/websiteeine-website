// Gemeinsame Basis der Prüfwerkzeuge: Playwright laden und Server-Adresse bestimmen.
//
// Playwright: Umgebungsvariable NP_PLAYWRIGHT (Pfad oder Paketname), sonst das Paket „playwright“
// (npm i -D playwright), sonst die vorinstallierte Kopie der Entwicklungsumgebung.
// Server: NP_BASE (Standard http://localhost:8765/ – starten mit: npx http-server -p 8765 -s -c-1 .)

const CANDIDATES = [process.env.NP_PLAYWRIGHT, 'playwright', '/opt/node-tools/node_modules/playwright/index.mjs'].filter(Boolean);

let pw = null;
for (const spec of CANDIDATES) {
  try {
    pw = await import(spec);
    break;
  } catch { /* nächsten Kandidaten versuchen */ }
}
if (!pw) throw new Error('Playwright nicht gefunden – „npm i -D playwright“ ausführen oder NP_PLAYWRIGHT=/pfad/zu/playwright/index.mjs setzen.');

export const chromium = pw.chromium || (pw.default && pw.default.chromium);
export const devices = pw.devices || (pw.default && pw.default.devices);

/** Basis-URL des statischen Servers (mit abschließendem /). */
export const BASE = String(process.env.NP_BASE || 'http://localhost:8765/').replace(/\/?$/, '/');

/** Chromium-Argumente für WebGL über SwiftShader (Headless ohne GPU). */
export const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'];
