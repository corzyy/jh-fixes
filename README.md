# jh-fixes

A GNOME Shell extension that bundles a set of small personal tweaks to
GNOME Shell 51: the top bar, Quick Settings, the dash, the Overview, windows,
Alt+Tab and a darker shell theme (Umbra), all in one place with a single
preferences window.

Every option starts at GNOME's own behaviour (except the dash icon cap,
48 px, and the Quick Settings button that opens these preferences), so
nothing changes until you change it.

## Install

**Requirements:** GNOME Shell 51, `git`, `make` and `glib-compile-schemas`
(part of `glib2`). Optional: `ddcutil` for external monitor brightness.

    sudo dnf install git make ddcutil    # Fedora; ddcutil is optional
    git clone git@github.com:corzyy/jh-fixes.git   # private repo: needs access
    cd jh-fixes
    make install

The extension goes to `~/.local/share/gnome-shell/extensions/jh-fixes@local`.
The first time, **log out and back in** so GNOME Shell picks it up, then:

    gnome-extensions enable jh-fixes@local

Open the preferences with `gnome-extensions prefs jh-fixes@local`, or the
jh-fixes button in Quick Settings.

**Update:** `git pull && make install`. The running extension is reloaded
right away; no new login needed (except when `loader/` or `metadata.json`
changed, see [Development](#development)).

**Uninstall:** `make uninstall`.

## How it is organised

Everything is sorted by the part of the screen it changes, and the code
has one folder per part. The preferences window has three pages: **Shell**,
where each part of the shell is a section that folds open, **Quick
Settings** and **Appearance**:

| Page › Section       | What it changes                                         | Code                       |
|----------------------|---------------------------------------------------------|----------------------------|
| Shell › Top Bar      | Activities button, clock, bar background                | `src/features/topBar/`     |
| Shell › Dash         | the Overview's dash                                     | `src/features/dock/`       |
| Shell › Overview     | window names, app grid layout                           | `src/features/overview/`   |
| Shell › Windows      | rounded corners, Show Desktop                           | `src/features/windows/`    |
| Shell › Alt+Tab      | apps or windows, window style, popup delay              | `src/features/altTab/`     |
| Quick Settings       | the system menu: layout, extra controls, sound menus    | `src/features/quickSettings/` |
| Appearance           | the Umbra shell theme, animation speed                  | `src/features/appearance/` |

In the preferences:

- Settings show only their names; what each one does is described below.
- A ↺ button next to a setting means it differs from the default; click it
  to go back. Drop-downs mark the default choice with "(default)".
- Settings that only work together with another one are greyed out until
  that one is on (the dash icon size needs the dash, the bar background
  needs the theme, ...). Options of an on/off feature sit inside its row.
- A folded section on the Shell page says how many of its settings are
  changed.
- The search button finds any setting on any page.
- Each page ends with a button that resets what was changed on it.

## Features

### Top Bar

- **Activities button**: hide it.
- **Clock shows**: date and time as GNOME has it, or the time only.
- **Background** (with the Umbra theme): black, theme grey, transparent, or
  dynamic: transparent until a window on the bar's monitor touches the bar,
  then theme grey or black (your choice). Text shadow while transparent.

### Quick Settings

- **Menu layout**: a preview drawn like the real menu. Drag items (sliders,
  tiles, the top row, Background Apps and other extensions' tiles) to
  reorder them: the item moves through the preview as a dashed placeholder
  and the others make room, exactly as the menu will look. Drag them into
  Hidden Items to hide them (their top bar icons stay) and back; the page
  scrolls when you drag near its top or bottom edge. The top row's buttons can be hidden one by one too.
  Click an item for its width and keyboard moves. The eye button also shows
  items GNOME has nothing to show for right now. Set the number of columns
  (1–4). Items that turn up later go where GNOME would put them.
- **Extra controls**:
  - Brightness of external monitors: one slider for every DDC/CI monitor,
    through `ddcutil` (`sudo dnf install ddcutil`; its udev rule gives the
    logged-in user access to `/dev/i2c-*`). With several monitors, the arrow
    next to it opens a slider per monitor; the main slider shows their
    average and moves them all by the same amount, keeping the differences.
    Monitors are found again a few seconds after the monitor setup changes.
  - Volume for each app: a slider per app playing sound in the sound output
    menu, with the app's icon and name; click the icon to mute. Follows
    GNOME's Over-Amplification setting.
  - A button next to GNOME's Settings button that opens these preferences.
- **Sound menus**: rename and hide speakers and microphones (on their own
  pages). The device in use is always shown; with one device left, the
  menu arrow goes away as in GNOME.

### Dash

- **Dash**: hide it, cap its icon size, hide the Show Apps button.

### Overview

- **Window names**: hide the title (or app name) that appears under a
  window when you point at it.
- **App grid**: set columns and rows per page (set one and
  the other follows the screen's shape). Apps keep their
  order; your saved app layout is only rewritten when you drag an app.

### Windows

- **Rounded corners** with a matching shadow (radius from Appearance ›
  Corner radius), after
  [rounded-window-corners](https://github.com/flexagoon/rounded-window-corners).
  Maximised and fullscreen windows and libadwaita apps are left alone, and
  windows stay sharp in the Overview.
- **Show Desktop**: a shortcut (Super+D by default) that minimises every
  window on the workspace; pressing it again brings them back.

### Alt+Tab

- Windows from all workspaces, in both switchers.
- **Switches between**: windows instead of apps.
- **Window style**: previews, app icons or both.
- **Delay before it appears**: so a quick Alt+Tab doesn't flash the popup.

### Appearance

- **Umbra shell theme**: GNOME's own dark stylesheet with darker greys, plus
  restyled sliders, switches, menus, Quick Settings, dash and calendar.
  Built at runtime from the installed shell's stylesheet, so it follows
  GNOME updates, and written to `~/.cache/jh-fixes/gnome-shell.css`.
  Replaces the User Themes extension (the page offers to turn it off).
  Darkness from GNOME's greys (0 %) to Umbra (100 %). Sliders, menus
  and the dash can each be switched off and tuned (menu shadow, slider
  size, and the dash's look: Umbra's pill or GNOME's own dash, both in
  the colour of a Quick Settings tile that is off).
- **Corner radius**: one slider (0–40 px, the popup menus' radius) for
  every rounded corner: the theme's (Quick Settings, dash, calendar, cards)
  and the rounded windows' (15 px at the default 20). Works without Umbra.
- **Animation duration**: all shell animations faster or slower (25–200 %).

### Lock screen

jh-fixes keeps running while the screen is locked, so the theme stays,
Quick Settings keeps its arrangement, the jh-fixes Settings button is hidden
there, and the Activities button stays hidden.

## Development

`make install` installs a new build and reloads the running extension in
place, including new settings keys.

How: the installed folder holds a small, stable loader (`loader/`) and the
real code under `builds/<id>/`, a fresh path on every install. GJS caches
modules by path, so a fresh path means the new code is really loaded when
`make install` disables and enables the extension. Changes to `loader/`
itself and to `metadata.json` (read once at login) still need a new login.
Details in `loader/common.js` and `tools/install.sh`.

`make pack` builds a zip in `dist/` for `gnome-extensions install`.

### Code layout

    loader/                 stable entry point that loads the current build
    tools/install.sh        installs a new build and reloads the extension
    src/
      extension.js          turns every feature on and off
      features/<area>/      shell side, one folder per preferences page;
        index.js            lists the area's features
      lib/                  shared shell helpers: tweak.js (SettingTweak),
                            shell.js (actors, waiting for Quick Settings),
                            ddc.js (ddcutil), lazy.js (loads default-off
                            features only once turned on),
                            quickSettingsCatalog.js (item ids, shared
                            with the preferences)
      prefs.js              builds the preferences window
      prefs/pages/          shell.js gathers the Shell page's sections;
        <area>.js           one description per area: groups and rows
      prefs/ui/build.js     turns those descriptions into widgets
      prefs/editors/        hand-made parts: the Quick Settings layout
                            editor, sound device lists, theme rows
      schemas/              settings, grouped like the pages

### Adding a fix

1. **Shell side**: put a class with `enable()`/`disable()` in the matching
   `src/features/<area>/` folder and add it to that folder's `index.js`.
   For an on/off tweak, subclass `SettingTweak` (`lib/tweak.js`): set `KEY`,
   implement `_apply()`/`_revert()`, and use `this._injections` for method
   overrides so they are undone for you.
   A bigger feature that is off by default can be listed in `index.js` as
   `lazyFeature('its-key', async () => (await import('./file.js')).Class)`
   so its code is only loaded once it is turned on.
2. **Setting**: add the key to the schema, in the area's section, with
   GNOME's behaviour as the default.
3. **Preferences**: add one line to `src/prefs/pages/<area>.js` (the
   Shell page's sections and the Quick Settings and Appearance pages), e.g.

       toggle('my-key', 'What it is'),

   The ↺ button, the default marker and the page reset come with it. Use
   `requires: 'other-key'` if it only works with another setting on.

GObject classes need a `GTypeName` that is new on every load (see
`features/windows/roundedCorners.js`): `make install` loads the code again
in the same process, and a type name can only be registered once.
