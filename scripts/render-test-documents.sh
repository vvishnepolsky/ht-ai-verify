#!/usr/bin/env bash
# Render every generated test document (docs/test-documents/*.html) to a PDF
# and a PNG next to it with headless Chrome, so the same document can be
# tested as a file upload (PDF) and as a photo (PNG).
# --no-pdf-header-footer matters: Chrome's default header stamps today's date
# and the file URL onto the page, and a stray date is exactly what the
# document-currency check reads for.
set -euo pipefail
cd "$(dirname "$0")/../docs/test-documents"

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [ ! -x "$CHROME" ]; then
  for c in google-chrome chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1; then CHROME="$(command -v "$c")"; break; fi
  done
fi
if [ ! -x "$CHROME" ]; then
  echo "Chrome not found. Set CHROME=/path/to/chrome and re-run." >&2
  exit 1
fi

for html in *.html; do
  base="${html%.html}"
  size="816,1056"
  case "$base" in *photo-id*) size="760,560";; esac
  "$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="$PWD/$base.pdf" "file://$PWD/$html" >/dev/null 2>&1
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size="$size" --screenshot="$PWD/$base.png" "file://$PWD/$html" >/dev/null 2>&1
  echo "rendered $base"
done
