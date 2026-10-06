#!/bin/sh
# Überträgt die veröffentlichte Fassung (ohne dev/, tools/, docs/) in das Pages-Repository FreeGames-Website
# und stellt die absoluten Vorschau-Adressen um. Aufruf: sh tools/publish.sh [Zielordner]
set -e
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DST="${1:-$SRC/../freegames-website}"
URL_OLD='https://germanclaude.github.io/websiteeine-website/'
URL_NEW='https://germanclaude.github.io/FreeGames-Website/'
[ -d "$DST/.git" ] || { echo "Zielordner $DST ist kein Git-Repository"; exit 1; }
cp -a "$SRC/index.html" "$SRC/spielen.html" "$SRC/404.html" "$SRC/manifest.webmanifest" "$SRC/.nojekyll" "$DST/"
rm -rf "$DST/assets" && cp -a "$SRC/assets" "$DST/assets"
# Asset-Bibliothek nur mitnehmen, wenn das Spiel sie lädt (PUBLISH_LIB=1); die Tonaufnahmen (assets/lib/audio,
# 3 MB) lädt das Spiel immer (Hybrid-Klang, audio) → bleiben auch ohne PUBLISH_LIB
[ "${PUBLISH_LIB:-0}" = 1 ] || find "$DST/assets/lib" -mindepth 1 -maxdepth 1 ! -name audio -exec rm -rf {} +
sed -i "s#$URL_OLD#$URL_NEW#g" "$DST/index.html"
# Fassungskennung: Spiel vergleicht shared/build.js mit version.json und bietet nach Updates „Jetzt aktualisieren“ an
BUILD="$(date -u +%Y%m%d%H%M%S)"
printf "// NULLPUNKT — Fassungskennung (von tools/publish.sh geschrieben).\nexport const BUILD = '%s';\n" "$BUILD" > "$DST/assets/js/shared/build.js"
printf '{"build":"%s"}\n' "$BUILD" > "$DST/version.json"
# alle eigenen Moduladressen mit ?v=<Fassung> versehen (kein Mischen alter und neuer Module aus dem Browser-Cache)
node "$SRC/tools/stamp.mjs" "$DST" "$BUILD"
echo "Fassung $BUILD"
echo "Übertragen nach $DST – jetzt dort prüfen, committen und pushen (README.md dort wird nicht überschrieben)."
