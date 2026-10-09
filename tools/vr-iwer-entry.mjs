// NULLPUNKT — Einstieg für das Bündel des WebXR-Emulators IWER (Meta, MIT; nur Testwerkzeug, nie in assets/).
// tools/vr-test.mjs bündelt diese Datei mit esbuild nach tools/out/vr/iwer.iife.js und spritzt sie per
// page.addInitScript vor dem Spiel ein: navigator.xr meldet dann eine Meta Quest 3 mit Touch-Controllern.
// Steuerung im Test über window.__iwer (XRDevice): position/quaternion (Kopf), controllers.left/right
// (position, quaternion, updateButtonValue('trigger'|'squeeze'|'a-button'|'b-button'|'x-button'|'y-button'|'thumbstick', v),
// updateAxes('thumbstick', x, y)).
import { XRDevice, metaQuest3 } from 'iwer';

const device = new XRDevice(metaQuest3, { stereoEnabled: true });
// Chromium hat ein eigenes navigator.xr (ohne Gerät) – der Emulator ersetzt es
device.installRuntime({ forceInstall: true });
window.__iwer = device;
