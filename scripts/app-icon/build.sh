#!/bin/bash
# Rebuilds the icon of Sentiq.app (Assets.car + Sentiq.icns, next to this script) from the Icon Composer project
# src/web/public/Sentiq.icon. Needs Xcode (actool). Then run `scripts/sentiq.sh app` to put it on the app.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$(cd "$HERE/../.." && pwd -P)"
SRC="$ROOT/src/web/public/Sentiq.icon"
[ -d "$SRC" ] || { echo "Lipsește $SRC" >&2; exit 1; }
OUT="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/sentiq-icon.XXXXXX")"
trap '/bin/rm -rf "$OUT"' EXIT
/usr/bin/xcrun actool "$SRC" --compile "$OUT" --app-icon Sentiq --enable-on-demand-resources NO --development-region en \
  --target-device mac --platform macosx --minimum-deployment-target 12.0 --output-partial-info-plist "$OUT/partial.plist" >/dev/null
/bin/cp "$OUT/Assets.car" "$OUT/Sentiq.icns" "$HERE/"
echo "Iconița a fost reconstruită în $HERE. Rulează scripts/sentiq.sh app ca s-o pui pe Sentiq.app."
