import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import {SettingTweak} from '../../lib/tweak.js';

const MOUSE_SCHEMA = 'org.gnome.desktop.peripherals.mouse';
const THRESHOLD_KEY = 'drag-threshold';
const BACKUP_KEY = 'drag-threshold-backup';

const POINTER_MOVES = [Meta.GrabOp.MOVING, Meta.GrabOp.MOVING_UNCONSTRAINED];

// Mutter only lets go of a maximized or tiled window once it has been dragged
// 6 × drag-threshold pixels (48 by default), see update_move() in
// meta-window-drag.c. That factor is compiled in, but the threshold is read live,
// so it drops to 0 while such a window is grabbed and comes back the moment the
// window is loose: mutter sizes its edge tiling zones with the same number.
export class LooseMaximized extends SettingTweak {
    static KEY = 'loose-maximized-windows';
    static DEFAULT = false;

    constructor(settings) {
        super(settings);
        this._mouse = new Gio.Settings({schema_id: MOUSE_SCHEMA});
        this._window = null;
        this._idleId = 0;
    }

    enable() {
        // A crash while a drag was going on would have left the threshold at 0.
        this._restore();
        super.enable();
    }

    _apply() {
        global.display.connectObject(
            'grab-op-begin', (_display, window, op) => this._begin(window, op),
            'grab-op-end', () => this._end(),
            this);
    }

    _revert() {
        global.display.disconnectObject(this);
        this._end();
    }

    _begin(window, op) {
        this._end();
        if (!window || !POINTER_MOVES.includes(op) || !window.maximized_vertically)
            return;

        this._window = window;
        window.connectObject(
            'notify::maximized-vertically', () => this._queueEnd(),
            'unmanaged', () => this._end(),
            this);
        this._settings.set_int(BACKUP_KEY, this._mouse.get_int(THRESHOLD_KEY));
        this._mouse.set_int(THRESHOLD_KEY, 0);
    }

    // This fires from inside mutter's motion handling, so change the
    // preference after it has finished.
    _queueEnd() {
        this._idleId ||= GLib.idle_add(GLib.PRIORITY_HIGH_IDLE, () => {
            this._idleId = 0;
            this._end();
            return GLib.SOURCE_REMOVE;
        });
    }

    _end() {
        if (this._idleId)
            GLib.source_remove(this._idleId);
        this._idleId = 0;
        this._window?.disconnectObject(this);
        this._window = null;
        this._restore();
    }

    _restore() {
        const saved = this._settings.get_int(BACKUP_KEY);
        if (saved < 0)
            return;
        this._mouse.set_int(THRESHOLD_KEY, saved);
        this._settings.set_int(BACKUP_KEY, -1);
    }
}
