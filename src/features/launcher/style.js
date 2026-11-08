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

/* Overview search: GNOME's "Search as Overlay" design */
.jh-launcher-pill {
  background-color: ${rgba(c.surface, 0.95)}; color: ${c.fg};
  border-radius: 999px; padding: 0 14px; spacing: 8px;
  box-shadow: inset 0 0 0 2px ${accent}; }
.jh-launcher-pill .jh-launcher-header-icon { color: ${c.fg}; }
.jh-launcher-pill .jh-launcher-entry { font-size: ${size}pt; }
.jh-launcher-pill .jh-launcher-mode { border-radius: 999px; }
.jh-launcher-overlay {
  background-color: ${rgba(c.surface, opacity)};
  border: none; border-radius: 28px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45); }
.jh-launcher-overlay-content { padding: 24px; spacing: 24px; }
.jh-launcher-tiles { spacing: 6px; }
.jh-launcher-tile {
  width: 110px; padding: 10px 0 8px 0; border-radius: 16px; color: ${c.fg}; }
.jh-launcher-tile-box { spacing: 8px; }
.jh-launcher-tile-label { font-size: ${size - 1}pt; padding: 0 6px; }
.jh-launcher-tile:hover { background-color: ${rgba(c.fg, 0.06)}; }
.jh-launcher-tile.selected, .jh-launcher-tile.selected:hover {
  background-color: st-transparentize(${accent}, 0.7); }
.jh-launcher-card {
  border-radius: 14px; padding: 18px 24px; color: ${c.fg};
  background-color: ${rgba(c.fg, 0.06)}; }
.jh-launcher-card:hover { background-color: ${rgba(c.fg, 0.09)}; }
.jh-launcher-card.selected, .jh-launcher-card.selected:hover {
  background-color: st-transparentize(${accent}, 0.7); }
.jh-launcher-card-subtitle { color: ${rgba(c.fg, 0.6)}; font-size: ${size}pt; }
.jh-launcher-card-title { font-size: ${Math.round(size * 1.9)}pt; font-weight: 800; padding-top: 2px; }
.jh-launcher-card-icon { color: ${rgba(c.fg, 0.8)}; }
.jh-launcher-group { spacing: 10px; }
.jh-launcher-group-header { padding: 0 6px; }
.jh-launcher-group-title { font-weight: bold; color: ${c.fg}; }
.jh-launcher-group-button {
  color: ${c.fg}; background-color: ${rgba(c.fg, 0.08)};
  border-radius: 10px; padding: 6px 14px; font-weight: 500; }
.jh-launcher-group-button:hover { background-color: ${rgba(c.fg, 0.13)}; }
.jh-launcher-group-button:active { background-color: ${rgba(c.fg, 0.18)}; }
.jh-launcher-boxed-list { border-radius: 14px; background-color: ${rgba(c.fg, 0.06)}; }
.jh-launcher-boxed-row {
  padding: 10px 14px 10px 16px; color: ${c.fg};
  border-top: 1px solid ${rgba(c.fg, 0.07)}; }
.jh-launcher-boxed-row:first-child { border-top-width: 0; border-radius: 14px 14px 0 0; }
.jh-launcher-boxed-row:last-child { border-radius: 0 0 14px 14px; }
.jh-launcher-boxed-row:first-child:last-child { border-radius: 14px; }
.jh-launcher-boxed-row:hover { background-color: ${rgba(c.fg, 0.04)}; }
.jh-launcher-boxed-row.selected, .jh-launcher-boxed-row.selected:hover {
  background-color: st-transparentize(${accent}, 0.75); }
.jh-launcher-boxed-row .jh-launcher-row-box { spacing: 14px; }
.jh-launcher-thumb { width: 44px; height: 44px; }
.jh-launcher-thumb.symbolic {
  border-radius: 10px; background-color: ${rgba('#000000', 0.25)}; color: ${c.fg}; }
.jh-launcher-row-action {
  border-radius: 999px; padding: 8px; color: ${rgba(c.fg, 0.8)}; }
.jh-launcher-row-action:hover { background-color: ${rgba(c.fg, 0.1)}; color: ${c.fg}; }
.jh-launcher-status { padding: 28px 0; spacing: 6px; }
.jh-launcher-status-icon { color: ${rgba(c.fg, 0.4)}; padding-bottom: 12px; }
.jh-launcher-status-title { font-size: ${Math.round(size * 1.5)}pt; font-weight: 800; }
.jh-launcher-status-description { color: ${rgba(c.fg, 0.6)}; }
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
