// NULLPUNKT — Gitterrost ohne Flimmern (26.10., Etappe K0 „Sofort-Fehler“ W4) (Owner: world).
//
// Der Rost-Satz metal_grate (Stege + Löcher im Alphakanal, Deckung ≈ 45 %) wird mit alphaTest 0,5 gezeichnet. In den
// kleinen Mip-Stufen mittelt sich der Alphakanal auf ≈ 0,45 – knapp unter der Schwelle: jedes Pixel entscheidet
// zufällig zwischen Steg und Loch, und Laufstege/Gitterwände flimmerten als blaugraues Rauschen (Moiré). Dieser Haken
// blendet nach der Maschengröße im Bild (Bildschirmableitungen der UV, ungünstigere Richtung) zu einem festen
// Bildschirm-Schachbrett über: jedes zweite Pixel Steg, dazwischen Durchsicht – so liest sich ein Rost aus der Ferne
// (halb durchsichtig, Stege leicht abgedunkelt), ohne zu flimmern, und Gitterzäune/-wände verdecken dahinter niemanden.
// Nah bleibt der echte Durchblick. Gilt auf allen Stufen (auch Telefon) und für den prozeduralen Ersatzsatz; ein
// zusätzlicher Programm-Schlüssel ('gitter'), den das Vorkompilieren der Welt (main.js, Szene) abdeckt.
// Nachbesserung 26.10.: Überblenden erst unterhalb von 2,5 Pixeln je Masche (vorher ab 8 Pixeln, voll bei 3 → der
// Laufsteg wurde 2–3 m vor dem Spieler zur geschlossenen Platte); fern Schachbrett statt geschlossener Fläche.
// Bildschirmbezogen ist das mit Absicht: Moiré entsteht, sobald eine Masche kleiner als zwei Bildpunkte wird – bei
// geringerer Auflösung (Telefon) also früher, und genau dort muss auch das Überblenden früher greifen.
import { addShaderPatch } from './shading.js';

/** Stegfarbe in der Fernansicht (das Schachbrett zeigt die Löcher schon als Durchsicht). */
const FAR_SHADE = 0.85;

/** Maschen je Texturkachel (texgen „grate“: 8 quer × 24 längs; der Bibliothekssatz ist daraus gebacken). */
const CELLS = [8, 24];

/** Maschen je Bildpunkt: Beginn (≈ 2,5 px je Masche) und Ende (≈ 1,25 px) des Überblendens. */
const FADE = [0.4, 0.8];

function gratePatch(shader) {
  shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `
    #ifdef USE_MAP
    {
      // Maschen je Bildpunkt in der ungünstigeren Bildrichtung (unabhängig von der Texturgröße 512/1024)
      vec2 npGc = vec2( ${CELLS[0].toFixed(1)}, ${CELLS[1].toFixed(1)} );
      float npGp = max( length( dFdx( vMapUv ) * npGc ), length( dFdy( vMapUv ) * npGc ) );
      float npGf = smoothstep( ${FADE[0].toFixed(2)}, ${FADE[1].toFixed(2)}, npGp );
      if ( npGf > 0.0 ) {
        // Bildschirmfestes Schachbrett (50 % Steg); im Übergang wählt ein 2×2-Ordnungsmuster je Pixel zwischen Textur
        // und Schachbrett, damit keine harte Kante über den Steg wandert
        vec2 npQ = floor( gl_FragCoord.xy );
        float npChk = mod( npQ.x + npQ.y, 2.0 );
        float npOrd = ( mod( npQ.x, 2.0 ) * 2.0 + mod( npQ.y, 2.0 ) + 0.5 ) * 0.25;
        diffuseColor.a = npOrd < npGf ? npChk : diffuseColor.a;
        diffuseColor.rgb *= mix( 1.0, ${FAR_SHADE.toFixed(2)}, npGf );
      }
    }
    #endif
    #include <alphatest_fragment>`);
}

/** Haken auf ein Gitterrost-Material setzen (idempotent; bleibt beim Nachfüllen der Bibliothekstexturen erhalten). */
export function applyGrateFade(material) {
  if (material) addShaderPatch(material, 'gitter', gratePatch);
  return material;
}
