import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {FIXED_PARTS, OPTIONS, PALETTES, STYLE_PARTS, buildCss} from './build.js';

const KEY = 'shell-theme';
const optionKey = name => `shell-theme-${name}`;
const KEYS = [
    KEY,
    'shell-theme-palette',
    'shell-theme-disabled-styles',
    ...Object.keys(OPTIONS).map(optionKey),
];

const STOCK_CSS = '/org/gnome/shell/theme/gnome-shell-dark.css';
const OUTPUT = GLib.build_filenamev([GLib.get_user_cache_dir(), 'jh-fixes', 'gnome-shell.css']);

const REBUILD_DELAY = 100;

const decoder = new TextDecoder();

const parts = new Map();

function readStock() {
    return decoder.decode(
        Gio.resources_lookup_data(STOCK_CSS, Gio.ResourceLookupFlags.NONE).toArray());
}

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
        this._previous = null;
        this._loadedKey = null;
    }

    enable() {
        for (const key of KEYS)
            this._settings.connectObject(`changed::${key}`, () => this._queueSync(), this);
        this._settings.connectObject(
            'changed::shell-theme-palette', () => this._applyAccent(),
            `changed::${KEY}`, () => this._applyAccent(), this);
        Main.extensionManager.connectObject('extension-state-changed', () => {
            if (this._settings.get_boolean(KEY) && currentStylesheet() !== OUTPUT)
                this._queueSync();
        }, this);
        this._sync();
        this._applyAccent();
    }

    disable() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;
        this._settings.disconnectObject(this);
        Main.extensionManager.disconnectObject(this);
        this._remove();
    }

    _applyAccent() {
        const accent = PALETTES[this._settings.get_string('shell-theme-palette')]?.accent;
        if (!accent || !this._settings.get_boolean(KEY))
            return;
        const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        if (iface.get_string('accent-color') !== accent)
            iface.set_string('accent-color', accent);
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
            palette: this._settings.get_string('shell-theme-palette'),
            parts: STYLE_PARTS.filter(id => FIXED_PARTS.includes(id) || !disabled.includes(id)),
            options: this._readOptions(),
        };

        const key = JSON.stringify(inputs);
        const current = currentStylesheet();
        if (current === OUTPUT && key === this._loadedKey)
            return;
        if (current !== OUTPUT)
            this._previous = current;

        const css = buildCss({
            stockCss: readStock(),
            palette: inputs.palette,
            parts: new Map(inputs.parts.map(id => [id, readPart(id)])),
            options: inputs.options,
        });

        if (fileHolds(OUTPUT, css)) {
            if (current === OUTPUT && this._loadedKey !== null) {
                this._loadedKey = key;
                return;
            }
        } else {
            GLib.mkdir_with_parents(GLib.path_get_dirname(OUTPUT), 0o755);
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

    _remove() {
        this._loadedKey = null;
        if (currentStylesheet() !== OUTPUT)
            return;
        Main.setThemeStylesheet(this._previous);
        this._previous = null;
        Main.loadTheme();
    }
}
