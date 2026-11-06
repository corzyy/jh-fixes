// The Umbra shell theme, built in place of the User Themes extension.
//
// The stylesheet is generated from the running shell's own dark stylesheet
// (see build.js), written to ~/.cache/jh-fixes/, and loaded the same way the
// User Themes extension does it (Main.setThemeStylesheet + Main.loadTheme).
// Any change to the theme settings rebuilds and reloads it.
//
// Turning it off puts back whatever stylesheet was set before (User Themes,
// or GNOME's default). The extension also runs on the lock screen, so the
// theme stays loaded there.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {FIXED_PARTS, OPTIONS, STYLE_PARTS, buildCss} from './build.js';

const KEY = 'shell-theme';
const optionKey = name => `shell-theme-${name}`;
const KEYS = [
    KEY,
    'shell-theme-darkness',
    'shell-theme-disabled-styles',
    ...Object.keys(OPTIONS).map(optionKey),
];

const STOCK_CSS = '/org/gnome/shell/theme/gnome-shell-dark.css';
const OUTPUT = GLib.build_filenamev([GLib.get_user_cache_dir(), 'jh-fixes', 'gnome-shell.css']);

// A reset of the whole page changes several keys at once; build only once.
const REBUILD_DELAY = 100;   // ms

const decoder = new TextDecoder();

// The stock stylesheet is a few hundred KB; it is read only while building
// (rarely) instead of being kept in the shell's memory. The style parts are
// small and kept.
const parts = new Map();

function readStock() {
    return decoder.decode(
        Gio.resources_lookup_data(STOCK_CSS, Gio.ResourceLookupFlags.NONE).toArray());
}

// Whether the file already holds exactly this CSS (normally so at login).
function fileHolds(path, css) {
    try {
        const [, bytes] = GLib.file_get_contents(path);
        return bytes.length > 0 && decoder.decode(bytes) === css;
    } catch {
        return false;
    }
}

function readPart(id) {
    if (!parts.has(id)) {
        const file = Gio.File.new_for_uri(
            GLib.uri_resolve_relative(import.meta.url, `css/${id}.css`, GLib.UriFlags.NONE));
        const [, bytes] = file.load_contents(null);
        parts.set(id, decoder.decode(bytes));
    }
    return parts.get(id);
}

const currentStylesheet = () => Main.getThemeStylesheet()?.get_path() ?? null;

export class ShellTheme {
    constructor(settings) {
        this._settings = settings;
        this._timeoutId = 0;
        // The stylesheet that was set before ours (normally none), put back
        // by _remove(), and the settings the loaded CSS was built from.
        this._previous = null;
        this._loadedKey = null;
    }

    enable() {
        for (const key of KEYS)
            this._settings.connectObject(`changed::${key}`, () => this._queueSync(), this);
        // User Themes sets the stylesheet when enabled and clears it when
        // disabled, whoever set it. While Umbra is on, take it back.
        Main.extensionManager.connectObject('extension-state-changed', () => {
            if (this._settings.get_boolean(KEY) && currentStylesheet() !== OUTPUT)
                this._queueSync();
        }, this);
        this._sync();
    }

    disable() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;
        this._settings.disconnectObject(this);
        Main.extensionManager.disconnectObject(this);
        this._remove();
    }

    _queueSync() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REBUILD_DELAY, () => {
            this._timeoutId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _sync() {
        if (!this._settings.get_boolean(KEY)) {
            this._remove();
            return;
        }
        try {
            this._apply();
        } catch (e) {
            console.error('jh-fixes: could not build the shell theme', e);
        }
    }

    _apply() {
        const disabled = this._settings.get_strv('shell-theme-disabled-styles');
        const inputs = {
            darkness: this._settings.get_int('shell-theme-darkness'),
            parts: STYLE_PARTS.filter(id => FIXED_PARTS.includes(id) || !disabled.includes(id)),
            options: this._readOptions(),
        };

        // Same settings and still loaded (a setting changed and back): nothing
        // to do. Reloading the theme restyles the whole shell, so it is worth
        // skipping; the stock stylesheet can't change while the shell runs.
        const key = JSON.stringify(inputs);
        const current = currentStylesheet();
        if (current === OUTPUT && key === this._loadedKey)
            return;
        if (current !== OUTPUT)
            this._previous = current;

        const css = buildCss({
            stockCss: readStock(),
            darkness: inputs.darkness,
            parts: new Map(inputs.parts.map(id => [id, readPart(id)])),
            options: inputs.options,
            source: `GNOME Shell ${Config.PACKAGE_VERSION}`,
        });

        if (fileHolds(OUTPUT, css)) {
            // Same CSS as we loaded (an option of a style part that is
            // off changed): no reload needed.
            if (current === OUTPUT && this._loadedKey !== null) {
                this._loadedKey = key;
                return;
            }
        } else {
            GLib.mkdir_with_parents(GLib.path_get_dirname(OUTPUT), 0o755);
            // Writes a temporary file and renames it over the old one.
            GLib.file_set_contents(OUTPUT, css);
        }

        Main.setThemeStylesheet(OUTPUT);
        Main.loadTheme();
        this._loadedKey = key;
    }

    _readOptions() {
        const options = {};
        for (const [name, fallback] of Object.entries(OPTIONS)) {
            options[name] = typeof fallback === 'string'
                ? this._settings.get_string(optionKey(name))
                : this._settings.get_int(optionKey(name));
        }
        return options;
    }

    // Puts back the stylesheet from before. If another extension (User Themes)
    // set one in the meantime, that one is left alone.
    _remove() {
        this._loadedKey = null;
        if (currentStylesheet() !== OUTPUT)
            return;
        Main.setThemeStylesheet(this._previous);
        this._previous = null;
        Main.loadTheme();
    }
}
