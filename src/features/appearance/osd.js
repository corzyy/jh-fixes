import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const POSITION_KEY = 'osd-position';
const SIZE_KEY = 'osd-size';

const {START, CENTER, END} = Clutter.ActorAlign;
const ALIGN = {
    'top-left': [START, START],
    'top': [CENTER, START],
    'top-right': [END, START],
    'left': [START, CENTER],
    'center': [CENTER, CENTER],
    'right': [END, CENTER],
    'bottom-left': [START, END],
    'bottom': [CENTER, END],
    'bottom-right': [END, END],
};

const px = (value, scale) => `${Math.round(value * scale)}px`;

export class OsdLayout {
    constructor(settings) {
        this._settings = settings;
    }

    enable() {
        this._settings.connectObject(
            `changed::${POSITION_KEY}`, () => this._sync(),
            `changed::${SIZE_KEY}`, () => this._sync(),
            this);
        Main.layoutManager.connectObject('monitors-changed', () => this._sync(), this);
        this._sync();
    }

    disable() {
        this._settings.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        this._windows().forEach(w => this._style(w, 'bottom', 1));
    }

    _windows() {
        return (Main.osdWindowManager?._osdWindows ?? []).filter(Boolean);
    }

    _sync() {
        const position = this._settings.get_string(POSITION_KEY);
        const scale = this._settings.get_int(SIZE_KEY) / 100;
        this._windows().forEach(w => this._style(w, position, scale));
    }

    _style(win, position, scale) {
        const [xAlign, yAlign] = ALIGN[position] ?? ALIGN.bottom;
        const stock = position === 'bottom';
        win.x_align = xAlign;
        win.y_align = yAlign;

        const constraint = win.get_constraints()
            .find(c => 'work_area' in c && 'index' in c);
        if (constraint)
            constraint.work_area = !stock;

        const resized = scale !== 1;
        const margin = stock ? '' : 'margin: 2em;';
        const box = resized
            ? `padding: ${px(12, scale)} ${px(18, scale)}; spacing: ${px(12, scale)}; font-size: ${scale}em;`
            : '';
        win._hbox.style = margin + box || null;
        win._vbox.style = resized ? `spacing: ${px(8, scale)};` : null;
        win._icon.style = resized ? `icon-size: ${px(32, scale)};` : null;
        win._level.style = resized
            ? `min-width: ${px(160, scale)}; -barlevel-height: ${px(6, scale)}; margin-bottom: ${px(4, scale)};`
            : null;
    }
}
