# jh-fixes

A GNOME Shell 51 extension with small personal tweaks to the top bar, Quick Settings, dash, Overview, windows, Alt+Tab and shell theme.

## Install

**Requirements:** GNOME Shell 51, `git` and `make`.

    git clone git@github.com:corzyy/jh-fixes.git   # private repo: needs access
    cd jh-fixes
    make install

The extension goes to `~/.local/share/gnome-shell/extensions/jh-fixes@local`.

The first time, **log out and back in** so GNOME Shell picks it up, then:

    gnome-extensions enable jh-fixes@local

Open the preferences with `gnome-extensions prefs jh-fixes@local`, or the
jh-fixes button in Quick Settings.
