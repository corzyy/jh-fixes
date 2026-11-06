#!/bin/bash
set -euo pipefail

SRC=$1
DEST=$2
UUID=$3
ROOT=$(cd "$(dirname "$0")/.." && pwd)

BUILD=$(date +%Y%m%d-%H%M%S-%N)

put() {
    cp "$1" "$2.new"
    mv -f "$2.new" "$2"
}

mkdir -p "$DEST/builds" "$DEST/schemas"

cp -r "$SRC" "$DEST/builds/$BUILD.tmp"
rm -rf "$DEST/builds/$BUILD.tmp/schemas"
mv "$DEST/builds/$BUILD.tmp" "$DEST/builds/$BUILD"

for f in "$ROOT"/loader/*.js; do
    put "$f" "$DEST/$(basename "$f")"
done
put "$SRC/metadata.json" "$DEST/metadata.json"
put "$SRC/schemas/org.gnome.shell.extensions.jh-fixes.gschema.xml" \
    "$DEST/schemas/org.gnome.shell.extensions.jh-fixes.gschema.xml"
put "$SRC/schemas/gschemas.compiled" "$DEST/schemas/gschemas.compiled"

if commit=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null); then
    printf '{"repo": "%s", "commit": "%s"}\n' "$ROOT" "$commit" > "$DEST/source.json.new"
    mv -f "$DEST/source.json.new" "$DEST/source.json"
fi

echo "$BUILD" > "$DEST/current-build.new"
mv -f "$DEST/current-build.new" "$DEST/current-build"

find "$DEST/builds" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' |
    sort | head -n -2 | while read -r old; do rm -rf "$DEST/builds/$old"; done

echo "Installed build $BUILD to $DEST"

if LC_ALL=C gnome-extensions info "$UUID" 2>/dev/null | grep -q 'State: ACTIVE'; then
    gnome-extensions disable "$UUID"
    gnome-extensions enable "$UUID"
    state=$(LC_ALL=C gnome-extensions info "$UUID" | sed -n 's/^ *State: //p')
    echo "Reloaded $UUID (state: $state)"
else
    echo "Not running; enable it with: gnome-extensions enable $UUID"
fi
