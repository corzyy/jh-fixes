UUID := jh-fixes@local
SRC := src
DEST := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: all schemas install uninstall pack clean

all: schemas

schemas: $(SRC)/schemas/gschemas.compiled

$(SRC)/schemas/gschemas.compiled: $(SRC)/schemas/*.gschema.xml
	glib-compile-schemas --strict $(SRC)/schemas

install: schemas
	tools/install.sh $(SRC) $(DEST) $(UUID)

uninstall:
	-gnome-extensions disable $(UUID)
	rm -rf $(DEST)

pack: schemas
	mkdir -p dist
	gnome-extensions pack $(SRC) --force --extra-source=features --extra-source=lib --extra-source=prefs --out-dir=dist

clean:
	rm -rf dist $(SRC)/schemas/gschemas.compiled
