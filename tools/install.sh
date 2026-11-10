#!/bin/bash
# Installs a build of the extension.
# Usage: install.sh <src-dir> <install-dir> <uuid>
#
# Every install goes into its own builds/<id> directory and the loader switches to
# it via the `current-build` file. A running shell can therefore never see a
# half-copied tree, and the previous build stays available.
set -euo pipefail

SRC=$1
DEST=$2
UUID=$3
ROOT=$(cd "$(dirname "$0")/.." && pwd)

# Unique, sortable build id (timestamp with nanoseconds).
BUILD=$(date +%Y%m%d-%H%M%S-%N)

# Copy via a temp file + rename so the destination is replaced atomically.
put() {
    cp "$1" "$2.new"
    mv -f "$2.new" "$2"
}

mkdir -p "$DEST/builds" "$DEST/schemas"

# Stage the build under a .tmp name and rename once complete. Schemas are not
# included: they live once in the install root, not per build.
cp -r "$SRC" "$DEST/builds/$BUILD.tmp"
rm -rf "$DEST/builds/$BUILD.tmp/schemas"
mv "$DEST/builds/$BUILD.tmp" "$DEST/builds/$BUILD"

# The loaders and metadata live in the install root. They are tiny and stable;
# everything else is imported from the current build.
for f in "$ROOT"/loader/*.js; do
    put "$f" "$DEST/$(basename "$f")"
done
put "$SRC/metadata.json" "$DEST/metadata.json"
put "$SRC/schemas/org.gnome.shell.extensions.jh-fixes.gschema.xml" \
    "$DEST/schemas/org.gnome.shell.extensions.jh-fixes.gschema.xml"
put "$SRC/schemas/gschemas.compiled" "$DEST/schemas/gschemas.compiled"

# Record where this install came from so the prefs update banner can compare
# it against the upstream repo.
if commit=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null); then
    printf '{"repo": "%s", "commit": "%s"}\n' "$ROOT" "$commit" > "$DEST/source.json.new"
    mv -f "$DEST/source.json.new" "$DEST/source.json"
fi

# Switch to the new build last, after all files are in place.
echo "$BUILD" > "$DEST/current-build.new"
mv -f "$DEST/current-build.new" "$DEST/current-build"

# Keep only the two newest builds (a running shell may still import from the old one).
find "$DEST/builds" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' |
    sort | head -n -2 | while read -r old; do rm -rf "$DEST/builds/$old"; done

echo "Installed build $BUILD to $DEST"

# Reload the extension if it is active so the new build takes effect immediately.
if LC_ALL=C gnome-extensions info "$UUID" 2>/dev/null | grep -q 'State: ACTIVE'; then
    gnome-extensions disable "$UUID"
    gnome-extensions enable "$UUID"
    state=$(LC_ALL=C gnome-extensions info "$UUID" | sed -n 's/^ *State: //p')
    echo "Reloaded $UUID (state: $state)"
else
    echo "Not running; enable it with: gnome-extensions enable $UUID"
fi
