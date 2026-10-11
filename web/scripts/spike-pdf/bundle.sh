#!/bin/sh
# Spike S4: browser bundle sizes for each route (esbuild, ESM, minified).
# Run from web/:  sh scripts/spike-pdf/bundle.sh ../build/s34/bundle
set -eu
out="$1"; mkdir -p "$out"
B="node_modules/.bin/esbuild --bundle --format=esm --platform=browser --minify --log-level=warning"
$B scripts/spike-pdf/entryLib.ts --outfile="$out/route-pdflib.js"
$B scripts/spike-pdf/entryLib.ts --external:pdf-lib --outfile="$out/route-pdflib-marginal.js"
$B scripts/spike-pdf/entryLibFk2.ts --outfile="$out/route-pdflib-fontkit2.js"
$B scripts/spike-pdf/entryLibFk2.ts --external:pdf-lib --outfile="$out/route-pdflib-fontkit2-marginal.js"
$B scripts/spike-pdf/entryKit.ts --outfile="$out/route-pdfkit-esm.js"
$B scripts/spike-pdf/entryKitStandalone.ts --outfile="$out/route-pdfkit-standalone.js"
for f in "$out"/*.js; do
  printf '%s raw=%s gzip=%s\n' "$(basename "$f")" "$(wc -c < "$f" | tr -d ' ')" "$(gzip -9 -c "$f" | wc -c | tr -d ' ')"
done
