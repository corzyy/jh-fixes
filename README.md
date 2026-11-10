# jh-fixes

Small personal tweaks for GNOME Shell.

## Install

Needs GNOME Shell 51, `git` and `make`.

    git clone git@github.com:corzyy/jh-fixes.git
    cd jh-fixes
    make install

Log out and back in the first time, then:

    gnome-extensions enable jh-fixes@local

Settings: `gnome-extensions prefs jh-fixes@local` or the button in Quick Settings.

## Layout

    loader/   thin entry points installed next to metadata.json; they import the
              real code from builds/<id>/ so that updates load without a re-login
    src/      the extension itself
      features/  one directory per feature (topBar, quickSettings, overview, windows,
                 altTab, appearance, launcher)
      lib/       helpers shared by the features
      prefs/     the preferences window (pages are declarative specs, see prefs/ui/build.js)
      schemas/   GSettings schema
    tools/    install.sh, called by `make install`

`make install` copies `src/` into a new build directory and switches to it, `make pack`
creates a zip for distribution.
