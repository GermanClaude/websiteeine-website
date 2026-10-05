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
# Asset-Bibliothek nur mitnehmen, wenn das Spiel sie lädt (PUBLISH_LIB=1)
[ "${PUBLISH_LIB:-0}" = 1 ] || rm -rf "$DST/assets/lib"
sed -i "s#$URL_OLD#$URL_NEW#g" "$DST/index.html"
echo "Übertragen nach $DST – jetzt dort prüfen, committen und pushen (README.md dort wird nicht überschrieben)."
