# Build, install and package the extension.
# `make install` builds and installs it; `make pack` creates a zip in dist/.
UUID := jh-fixes@local
SRC := src
DEST := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: all schemas install uninstall pack clean

all: schemas

# GSettings schemas must be compiled before the extension can load them.
schemas: $(SRC)/schemas/gschemas.compiled

$(SRC)/schemas/gschemas.compiled: $(SRC)/schemas/*.gschema.xml
	glib-compile-schemas --strict $(SRC)/schemas

# tools/install.sh copies the sources into a fresh build directory and flips `current-build`.
install: schemas
	tools/install.sh $(SRC) $(DEST) $(UUID)

# The leading "-" ignores errors when the extension is not enabled.
uninstall:
	-gnome-extensions disable $(UUID)
	rm -rf $(DEST)

# src/ is the extension root; the extra sources are the directories gnome-extensions does not pick up on its own.
pack: schemas
	mkdir -p dist
	gnome-extensions pack $(SRC) --force --extra-source=features --extra-source=lib --extra-source=prefs --out-dir=dist

clean:
	rm -rf dist $(SRC)/schemas/gschemas.compiled
