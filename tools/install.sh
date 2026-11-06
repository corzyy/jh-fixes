#!/bin/bash
# Installs the extension and, if it is running, reloads it in place.
#
# Layout of the installed folder:
#   metadata.json, extension.js, prefs.js, common.js   the loader (loader/)
#   schemas/                                           compiled settings
#   builds/<id>/                                       the real code (src/)
#   current-build                                      which <id> to run
#
# Usage: tools/install.sh SRC DEST UUID
set -euo pipefail

SRC=$1
DEST=$2
UUID=$3
ROOT=$(cd "$(dirname "$0")/.." && pwd)

BUILD=$(date +%Y%m%d-%H%M%S-%N)

# Writes a file next to its target, then renames it over the target. The
# running shell may have the old one open (gschemas.compiled is mmapped, and
# rewriting it in place can crash the shell); a rename leaves that copy alone.
put() {
    cp "$1" "$2.new"
    mv -f "$2.new" "$2"
}

mkdir -p "$DEST/builds" "$DEST/schemas"

# The real code, under a path never used before.
cp -r "$SRC" "$DEST/builds/$BUILD.tmp"
rm -rf "$DEST/builds/$BUILD.tmp/schemas"
mv "$DEST/builds/$BUILD.tmp" "$DEST/builds/$BUILD"

# Loader, metadata and settings.
for f in "$ROOT"/loader/*.js; do
    put "$f" "$DEST/$(basename "$f")"
done
put "$SRC/metadata.json" "$DEST/metadata.json"
put "$SRC/schemas/org.gnome.shell.extensions.jh-fixes.gschema.xml" \
    "$DEST/schemas/org.gnome.shell.extensions.jh-fixes.gschema.xml"
put "$SRC/schemas/gschemas.compiled" "$DEST/schemas/gschemas.compiled"

# Where this build came from, for the update banner in the preferences
# (src/prefs/update.js). Only for installs from a git clone.
if commit=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null); then
    printf '{"repo": "%s", "commit": "%s"}\n' "$ROOT" "$commit" > "$DEST/source.json.new"
    mv -f "$DEST/source.json.new" "$DEST/source.json"
fi

echo "$BUILD" > "$DEST/current-build.new"
mv -f "$DEST/current-build.new" "$DEST/current-build"

# Keep the current build and the one before it; older ones are not in use.
find "$DEST/builds" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' |
    sort | head -n -2 | while read -r old; do rm -rf "$DEST/builds/$old"; done

echo "Installed build $BUILD to $DEST"

# Reload if the shell is running it. The shell keeps the loader it started
# with; if that is not the loader yet (first install), a new login is needed.
if LC_ALL=C gnome-extensions info "$UUID" 2>/dev/null | grep -q 'State: ACTIVE'; then
    gnome-extensions disable "$UUID"
    gnome-extensions enable "$UUID"
    state=$(LC_ALL=C gnome-extensions info "$UUID" | sed -n 's/^ *State: //p')
    echo "Reloaded $UUID (state: $state)"
else
    echo "Not running; enable it with: gnome-extensions enable $UUID"
fi
