#!/bin/bash
# Build (unless --no-build), install Write_On.app to /Applications/Write_On.app,
# and register it as the default macOS handler for .md files.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD=1
SET_DEFAULT=1
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=0 ;;
    --no-default) SET_DEFAULT=0 ;;
  esac
done

if [ "$BUILD" -eq 1 ]; then
  "$ROOT/scripts/build-app.sh"
fi

SRC="$ROOT/build/Write_On.app"
DEST="/Applications/Write_On.app"
[ -d "$SRC" ] || { echo "install-app: $SRC not found; run scripts/build-app.sh first" >&2; exit 1; }

# Quit running instance cleanly if open
osascript -e 'tell application id "com.thesimhons.writeon" to quit' 2>/dev/null || true
sleep 0.5

rm -rf "$DEST"
ditto "$SRC" "$DEST"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$SRC" 2>/dev/null || true
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST"
echo "installed $DEST"

if [ "$SET_DEFAULT" -eq 1 ]; then
  swift -e '
import CoreServices
import Foundation
let bundleId = "com.thesimhons.writeon" as CFString
for uti in ["net.daringfireball.markdown", "public.markdown", "com.unknown.md"] {
    let status = LSSetDefaultRoleHandlerForContentType(uti as CFString, .all, bundleId)
    print("default handler \(uti): status=\(status)")
}
'
fi
