import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {paletteColours} from '../appearance/theme/build.js';

const DIR = GLib.build_filenamev([GLib.get_user_cache_dir(), 'jh-fixes']);

const STOCK = {menu: '#2e2e33', surface: '#3a3a3e', overlay: '#55555b', fg: '#fafafb'};

function rgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function buildCss(settings) {
    const themed = settings.get_boolean('shell-theme');
    const c = themed ? paletteColours(settings.get_string('shell-theme-palette')) : STOCK;
    const radius = Math.min(settings.get_int('shell-theme-radius'), 28);
    const inner = Math.max(radius - 8, 0);
    const opacity = settings.get_int('launcher-opacity') / 100;
    const dim = settings.get_int('launcher-dim');
    const size = settings.get_int('launcher-font-size');
    const accent = '-st-accent-color';

    return `
.jh-launcher-backdrop { background-color: rgba(0, 0, 0, ${dim / 100}); }
.jh-launcher {
  background-color: ${rgba(c.menu, opacity)};
  color: ${c.fg};
  border-radius: ${radius}px;
  border: 1px solid ${rgba(c.fg, 0.08)};
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  font-size: ${size}pt; }
.jh-launcher-header { padding: 14px 18px; spacing: 12px; }
.jh-launcher-header-icon { color: ${rgba(c.fg, 0.55)}; }
.jh-launcher-entry, .jh-launcher-entry:focus, .jh-launcher-entry:hover {
  background: none; border: none; box-shadow: none; padding: 0; margin: 0;
  color: ${c.fg}; font-size: ${Math.round(size * 1.3)}pt;
  caret-color: ${c.fg}; selection-background-color: ${accent}; }
.jh-launcher-entry StLabel.hint-text { color: ${rgba(c.fg, 0.4)}; }
.jh-launcher-mode {
  background-color: ${accent}; color: #ffffff; border-radius: 6px;
  padding: 2px 8px; font-size: ${size - 1}pt; font-weight: bold; }
.jh-launcher-separator { height: 1px; background-color: ${rgba(c.fg, 0.08)}; }
.jh-launcher-list { padding: 6px; spacing: 1px; }
.jh-launcher-section {
  color: ${rgba(c.fg, 0.5)}; font-size: ${size - 1}pt; font-weight: bold;
  padding: 8px 10px 4px 10px; }
.jh-launcher-row { border-radius: ${inner}px; padding: 7px 10px; color: ${c.fg}; }
.jh-launcher-row:hover { background-color: ${rgba(c.fg, 0.05)}; }
.jh-launcher-row.selected, .jh-launcher-row.selected:hover {
  background-color: st-transparentize(${accent}, 0.75); }
.jh-launcher-row-box { spacing: 12px; }
.jh-launcher-title { font-weight: 500; }
.jh-launcher-subtitle { color: ${rgba(c.fg, 0.5)}; font-size: ${size - 1}pt; }
.jh-launcher-kind { color: ${rgba(c.fg, 0.45)}; font-size: ${size - 1}pt; }
.jh-launcher-shortcut-hint {
  color: ${rgba(c.fg, 0.45)}; font-size: ${size - 2}pt;
  background-color: ${rgba(c.fg, 0.06)}; border-radius: 5px; padding: 1px 6px; }
.jh-launcher-empty { color: ${rgba(c.fg, 0.45)}; padding: 22px; }
.jh-launcher-footer {
  padding: 8px 14px; spacing: 10px; font-size: ${size - 1}pt;
  background-color: ${rgba(c.fg, 0.03)};
  border-radius: 0 0 ${radius}px ${radius}px; }
.jh-launcher-footer-status { color: ${rgba(c.fg, 0.5)}; }
.jh-launcher-footer-action { color: ${rgba(c.fg, 0.85)}; }
.jh-launcher-key {
  color: ${rgba(c.fg, 0.7)}; background-color: ${rgba(c.fg, 0.08)};
  border-radius: 5px; padding: 1px 6px; font-size: ${size - 2}pt; }
`;
}

export const STYLE_KEYS = [
    'shell-theme', 'shell-theme-palette', 'shell-theme-radius',
    'launcher-opacity', 'launcher-dim', 'launcher-font-size',
];

export class LauncherStyle {
    constructor(settings) {
        this._settings = settings;
        this._file = null;
        this._count = 0;
    }

    load() {
        const css = buildCss(this._settings);
        if (css === this._css && this._file)
            return;
        this.unload();
        this._css = css;
        GLib.mkdir_with_parents(DIR, 0o755);
        // A fresh name each time so St doesn't reuse a cached parse.
        const path = GLib.build_filenamev([DIR, `launcher-${GLib.get_monotonic_time()}-${this._count++}.css`]);
        GLib.file_set_contents(path, css);
        this._file = Gio.File.new_for_path(path);
        St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(this._file);
    }

    unload() {
        if (!this._file)
            return;
        try {
            St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(this._file);
        } catch {}
        try {
            this._file.delete(null);
        } catch {}
        this._file = null;
        this._css = null;
    }
}
