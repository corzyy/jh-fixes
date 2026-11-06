// Top bar tweaks (ui/panel.js).

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SettingTweak} from '../../lib/tweak.js';
import {PANEL_SOLID_CLASS} from '../appearance/theme/build.js';

// The panel box the session mode puts an item in, or null if the mode has
// no place for it (the lock screen has no Activities button, for example).
function stockBox(role) {
    const {left, center, right} = Main.sessionMode.panel;
    if (left.includes(role))
        return Main.panel._leftBox;
    if (center.includes(role))
        return Main.panel._centerBox;
    if (right.includes(role))
        return Main.panel._rightBox;
    return null;
}

/**
 * Hides the Activities button (the workspace dots) on the left of the top
 * bar. Panel._updatePanel shows it again on every session mode change, so it
 * is hidden again after that; showing it again only happens where the
 * session mode has it (not on the lock screen).
 */
export class ActivitiesButton extends SettingTweak {
    static KEY = 'panel-activities-button';

    _apply() {
        Main.sessionMode.connectObject('updated', () => this._hide(), this);
        this._hide();
    }

    _revert() {
        Main.sessionMode.disconnectObject(this);
        Main.panel.statusArea.activities?.container.set({
            visible: stockBox('activities') !== null,
        });
    }

    _hide() {
        Main.panel.statusArea.activities?.container.hide();
    }
}

// GNOME's clock settings (org.gnome.desktop.interface), which the time-only
// clock follows for 12/24 hours and seconds.
const INTERFACE_KEYS = ['clock-format', 'clock-show-seconds'];

/**
 * Shows only the time in the top bar clock, without the date and weekday
 * ("time"; "default" is GNOME's clock). GNOME binds its WallClock straight
 * to the clock label (DateMenuButton), so that label is hidden and a label
 * of ours shown in its place. Ours is redrawn on GNOME's own ticks (every
 * minute, or second with seconds on; also on time zone changes and resume)
 * and, when the format shows seconds, on a timer of its own. It looks like
 * GNOME's time, with the same ratio sign (∶) between the numbers.
 */
export class ClockStyle {
    static KEY = 'clock-style';

    constructor(settings) {
        this._settings = settings;
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._label = null;
        this._timerId = 0;
        this._lastError = null;
    }

    enable() {
        this._settings.connectObject(`changed::${ClockStyle.KEY}`,
            () => this._sync(), this);
        this._interface.connectObject(
            ...INTERFACE_KEYS.flatMap(k => [`changed::${k}`, () => this._sync()]), this);
        this._sync();
    }

    disable() {
        this._settings.disconnectObject(this);
        this._interface.disconnectObject(this);
        this._restore();
    }

    // The format for the chosen style; empty for GNOME's own clock.
    _formatFor(style) {
        if (style !== 'time')
            return '';
        const seconds = this._interface.get_boolean('clock-show-seconds') ? '\u2236%S' : '';
        return this._interface.get_string('clock-format') === '12h'
            ? `%l\u2236%M${seconds} %p`
            : `%H\u2236%M${seconds}`;
    }

    _sync() {
        const format = this._formatFor(this._settings.get_string(ClockStyle.KEY));
        const dateMenu = Main.panel.statusArea.dateMenu;
        if (!format || !dateMenu?._clockDisplay) {
            this._restore();
            return;
        }
        this._format = format;
        if (!this._label) {
            const stock = dateMenu._clockDisplay;
            this._label = new St.Label({style_class: stock.style_class, y_align: stock.y_align});
            this._label.clutter_text.y_align = stock.clutter_text.y_align;
            this._label.clutter_text.ellipsize = stock.clutter_text.ellipsize;
            stock.get_parent().insert_child_above(this._label, stock);
            stock.hide();
            dateMenu.label_actor = this._label;
            // Ticks every minute (or second), and on time zone changes.
            dateMenu._clock.connectObject('notify::clock', () => this._update(), this);
        }
        this._update();
        this._schedule();
    }

    _update() {
        const stock = Main.panel.statusArea.dateMenu?._clockDisplay;
        if (!this._label || !stock)
            return;
        const text = GLib.DateTime.new_now_local().format(this._format);
        if (text === null) {
            // Not a valid format: GNOME's own text, and one warning.
            if (this._lastError !== this._format)
                console.warn(`jh-fixes: invalid clock format "${this._format}"`);
            this._lastError = this._format;
            this._label.text = stock.text;
            return;
        }
        this._label.text = text.trim();
    }

    // GNOME only ticks every second with clock-show-seconds on, so a
    // format with seconds gets its own timer, at the start of each second.
    _schedule() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
        if (!/%[-_0^#]*[ScrsTX+]/.test(this._format))
            return;
        const tick = () => {
            this._update();
            const ms = 1000 - Math.floor(GLib.get_real_time() / 1000) % 1000;
            this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                this._timerId = 0;
                tick();
                return GLib.SOURCE_REMOVE;
            });
        };
        tick();
    }

    _restore() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
        const dateMenu = Main.panel.statusArea.dateMenu;
        dateMenu?._clock?.disconnectObject(this);
        if (this._label) {
            if (dateMenu?._clockDisplay) {
                dateMenu._clockDisplay.show();
                dateMenu.label_actor = dateMenu._clockDisplay;
            }
            this._label.destroy();
            this._label = null;
        }
    }
}

// Windows that count as touching the bar; not the desktop, docks or popups.
const TOUCHING_TYPES = new Set([
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.UTILITY,
    Meta.WindowType.TOOLBAR,
    Meta.WindowType.SPLASHSCREEN,
]);

// How close below the bar a window may stay and still count as touching it.
const TOUCH_MARGIN = 4;   // logical px

/**
 * The "dynamic" top bar background of the Umbra theme: the bar is
 * transparent, and solid (theme grey or black, see build.js) while a window
 * on the bar's monitor and the current workspace reaches up to it. This
 * sets PANEL_SOLID_CLASS on the bar; the theme's CSS does the colours and
 * GNOME's own transition on #panel fades between them. Not in the
 * Overview or on the lock screen, which always show the wallpaper.
 */
export class DynamicPanel {
    static KEYS = ['shell-theme', 'shell-theme-panel'];

    constructor(settings) {
        this._settings = settings;
        this._active = false;
        this._idleId = 0;
        this._solid = false;
    }

    enable() {
        for (const key of DynamicPanel.KEYS)
            this._settings.connectObject(`changed::${key}`, () => this._syncActive(), this);
        this._syncActive();
    }

    disable() {
        this._settings.disconnectObject(this);
        this._stop();
    }

    _syncActive() {
        const wanted = this._settings.get_boolean('shell-theme') &&
            this._settings.get_string('shell-theme-panel') === 'dynamic';
        if (wanted && !this._active)
            this._start();
        else if (!wanted && this._active)
            this._stop();
    }

    _start() {
        this._active = true;
        // Window actors come and go with their windows; each one says when
        // it moves, resizes or is shown and hidden (minimised).
        global.window_group.connectObject(
            'child-added', (_group, actor) => this._watch(actor),
            'child-removed', () => this._queueUpdate(),
            this);
        for (const actor of global.get_window_actors())
            this._watch(actor);
        global.workspace_manager.connectObject(
            'active-workspace-changed', () => this._queueUpdate(), this);
        global.display.connectObject(
            'restacked', () => this._queueUpdate(),
            'window-entered-monitor', () => this._queueUpdate(),
            'window-left-monitor', () => this._queueUpdate(),
            this);
        Main.overview.connectObject(
            'showing', () => this._queueUpdate(),
            'hidden', () => this._queueUpdate(),
            this);
        Main.sessionMode.connectObject('updated', () => this._queueUpdate(), this);
        Main.layoutManager.connectObject('monitors-changed', () => this._queueUpdate(), this);
        this._update();
    }

    _stop() {
        this._active = false;
        if (this._idleId)
            GLib.source_remove(this._idleId);
        this._idleId = 0;
        global.window_group.disconnectObject(this);
        for (const actor of global.get_window_actors())
            actor.disconnectObject(this);
        global.workspace_manager.disconnectObject(this);
        global.display.disconnectObject(this);
        Main.overview.disconnectObject(this);
        Main.sessionMode.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        Main.panel.remove_style_class_name(PANEL_SOLID_CLASS);
        this._solid = false;
    }

    _watch(actor) {
        // The window group also holds actors that are not windows.
        if (!(actor instanceof Meta.WindowActor))
            return;
        actor.connectObject(
            'notify::allocation', () => this._queueUpdate(),
            'notify::visible', () => this._queueUpdate(),
            this);
        this._queueUpdate();
    }

    // Allocations change on every frame of a move; check once per batch.
    _queueUpdate() {
        if (this._idleId)
            return;
        this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idleId = 0;
            this._update();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Restyling the bar restyles all of its buttons; only on a real change.
    _update() {
        const solid = this._touched();
        if (solid === this._solid)
            return;
        this._solid = solid;
        if (solid)
            Main.panel.add_style_class_name(PANEL_SOLID_CLASS);
        else
            Main.panel.remove_style_class_name(PANEL_SOLID_CLASS);
    }

    _touched() {
        if (Main.overview.visibleTarget || Main.sessionMode.isLocked ||
            Main.sessionMode.isGreeter)
            return false;
        const monitor = Main.layoutManager.findIndexForActor(Main.panel);
        const [, panelY] = Main.panel.get_transformed_position();
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const limit = panelY + Main.panel.height + TOUCH_MARGIN * scale;
        const workspace = global.workspace_manager.get_active_workspace();
        return workspace.list_windows().some(w =>
            TOUCHING_TYPES.has(w.get_window_type()) &&
            w.get_monitor() === monitor &&
            w.showing_on_its_workspace() &&
            !w.is_hidden() &&
            w.get_frame_rect().y < limit);
    }
}
