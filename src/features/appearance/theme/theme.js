// Replaces the shell stylesheet with a generated one (see build.js) and reverts to
// the previous one when disabled.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {buildCss} from './build.js';

// Settings that change the generated stylesheet.
const KEYS = ['shell-theme-panel', 'shell-theme-panel-solid', 'shell-theme-panel-shadow'];

const STOCK_CSS = '/org/gnome/shell/theme/gnome-shell-dark.css';
const EXTRA_CSS = GLib.uri_resolve_relative(import.meta.url, 'theme.css', GLib.UriFlags.NONE);
// The generated stylesheet is cached on disk; STAMP records what it was built from.
const OUTPUT = GLib.build_filenamev([GLib.get_user_cache_dir(), 'jh-fixes', 'gnome-shell.css']);
const STAMP = `${OUTPUT}.stamp`;

// Debounce for rapid setting changes (e.g. dragging a slider), in ms.
const REBUILD_DELAY = 100;

// File contents as a string, or null if unreadable.
function readText(path) {
    try {
        return new TextDecoder().decode(GLib.file_get_contents(path)[1]);
    } catch {
        return null;
    }
}

// Combine GNOME's own stylesheet (read from the shell's resources) with ours.
function build(options) {
    const stock = new TextDecoder().decode(
        Gio.resources_lookup_data(STOCK_CSS, Gio.ResourceLookupFlags.NONE).toArray());
    const [, extra] = Gio.File.new_for_uri(EXTRA_CSS).load_contents(null);
    return buildCss(stock, new TextDecoder().decode(extra), options);
}

// Path of the stylesheet currently in use.
const currentStylesheet = () => Main.getThemeStylesheet()?.get_path() ?? null;

export class ShellTheme {
    constructor(settings) {
        this._settings = settings;
        this._timeoutId = 0;
        this._previous = null;
        this._loadedKey = null;
    }

    // Other extensions can also replace the stylesheet, so re-check when any extension
    // changes state.
    enable() {
        for (const key of KEYS)
            this._settings.connectObject(`changed::${key}`, () => this._queueSync(), this);
        Main.extensionManager.connectObject('extension-state-changed', () => {
            if (currentStylesheet() !== OUTPUT)
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
        try {
            this._apply();
        } catch (e) {
            console.error('jh-fixes: could not build the shell theme', e);
        }
    }

    _apply() {
        const options = {
            panel: this._settings.get_string(KEYS[0]),
            solid: this._settings.get_string(KEYS[1]),
            shadow: this._settings.get_int(KEYS[2]),
        };
        // Everything the stylesheet is built from: the options, GNOME's own
        // stylesheet and this build of the extension. While it matches the
        // stamp, the cached file is loaded as it is.
        const key = [JSON.stringify(options),
            Gio.resources_get_info(STOCK_CSS, Gio.ResourceLookupFlags.NONE), EXTRA_CSS].join('\n');
        const current = currentStylesheet();
        if (current === OUTPUT && key === this._loadedKey)
            return;
        if (current !== OUTPUT)
            this._previous = current;

        if (readText(STAMP) !== key || !GLib.file_test(OUTPUT, GLib.FileTest.EXISTS)) {
            GLib.mkdir_with_parents(GLib.path_get_dirname(OUTPUT), 0o755);
            GLib.file_set_contents(OUTPUT, build(options));
            GLib.file_set_contents(STAMP, key);
        }

        Main.setThemeStylesheet(OUTPUT);
        Main.loadTheme();
        this._loadedKey = key;
    }

    // Only revert if our stylesheet is still the active one.
    _remove() {
        this._loadedKey = null;
        if (currentStylesheet() !== OUTPUT)
            return;
        Main.setThemeStylesheet(this._previous);
        this._previous = null;
        Main.loadTheme();
    }
}
