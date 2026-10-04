#!/bin/sh
# Syntaxprüfung aller ES-Module (ohne Vendor). Aufruf: sh tools/check.sh [dateien...]
cd "$(dirname "$0")/.." || exit 1
files="$*"
[ -z "$files" ] && files=$(find assets/js dev -name '*.js' 2>/dev/null)
fail=0
for f in $files; do
  out=$(node --input-type=module --check < "$f" 2>&1) || { echo "FEHLER $f"; echo "$out" | sed -n '1,4p'; fail=1; }
done
[ $fail = 0 ] && echo "Syntax ok ($(echo $files | wc -w) Dateien)"
exit $fail
