import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SettingTweak} from '../../lib/tweak.js';
import {PANEL_SOLID_CLASS} from '../appearance/theme/build.js';

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

export class ClockStyle {
    static KEY = 'clock-style';

    constructor(settings) {
        this._settings = settings;
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._label = null;
        this._format = '';
    }

    enable() {
        const sync = () => this._sync();
        this._settings.connectObject(`changed::${ClockStyle.KEY}`, sync, this);
        this._interface.connectObject(
            'changed::clock-format', sync,
            'changed::clock-show-seconds', sync,
            this);
        sync();
    }

    disable() {
        this._settings.disconnectObject(this);
        this._interface.disconnectObject(this);
        this._restore();
    }

    _sync() {
        const dateMenu = Main.panel.statusArea.dateMenu;
        if (this._settings.get_string(ClockStyle.KEY) !== 'time' || !dateMenu?._clockDisplay) {
            this._restore();
            return;
        }
        const seconds = this._interface.get_boolean('clock-show-seconds') ? '\u2236%S' : '';
        this._format = this._interface.get_string('clock-format') === '12h'
            ? `%l\u2236%M${seconds} %p`
            : `%H\u2236%M${seconds}`;
        if (!this._label) {
            const stock = dateMenu._clockDisplay;
            this._label = new St.Label({style_class: stock.style_class, y_align: stock.y_align});
            this._label.clutter_text.set({
                y_align: stock.clutter_text.y_align,
                ellipsize: stock.clutter_text.ellipsize,
            });
            stock.get_parent().insert_child_above(this._label, stock);
            stock.hide();
            dateMenu.label_actor = this._label;
            dateMenu._clock.connectObject('notify::clock', () => this._update(), this);
        }
        this._update();
    }

    _update() {
        this._label.text = GLib.DateTime.new_now_local().format(this._format).trim();
    }

    _restore() {
        if (!this._label)
            return;
        const dateMenu = Main.panel.statusArea.dateMenu;
        dateMenu?._clock?.disconnectObject(this);
        if (dateMenu?._clockDisplay) {
            dateMenu._clockDisplay.show();
            dateMenu.label_actor = dateMenu._clockDisplay;
        }
        this._label.destroy();
        this._label = null;
    }
}

const TOUCHING_TYPES = new Set([
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.UTILITY,
    Meta.WindowType.TOOLBAR,
    Meta.WindowType.SPLASHSCREEN,
]);

const TOUCH_MARGIN = 4;

export class DynamicPanel {
    constructor(settings) {
        this._settings = settings;
        this._active = false;
        this._idleId = 0;
        this._solid = false;
    }

    enable() {
        const sync = () => this._syncActive();
        this._settings.connectObject(
            'changed::shell-theme', sync,
            'changed::shell-theme-panel', sync,
            this);
        sync();
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
        const queue = () => this._queueUpdate();
        global.window_group.connectObject(
            'child-added', (_group, actor) => this._watch(actor),
            'child-removed', queue,
            this);
        global.get_window_actors().forEach(actor => this._watch(actor));
        global.workspace_manager.connectObject('active-workspace-changed', queue, this);
        global.display.connectObject(
            'restacked', queue,
            'window-entered-monitor', queue,
            'window-left-monitor', queue,
            this);
        Main.overview.connectObject('showing', queue, 'hidden', queue, this);
        Main.sessionMode.connectObject('updated', queue, this);
        Main.layoutManager.connectObject('monitors-changed', queue, this);
        this._update();
    }

    _stop() {
        this._active = false;
        if (this._idleId)
            GLib.source_remove(this._idleId);
        this._idleId = 0;
        for (const obj of [global.window_group, ...global.get_window_actors(),
            global.workspace_manager, global.display, Main.overview, Main.sessionMode,
            Main.layoutManager])
            obj.disconnectObject(this);
        Main.panel.remove_style_class_name(PANEL_SOLID_CLASS);
        this._solid = false;
    }

    _watch(actor) {
        if (!(actor instanceof Meta.WindowActor))
            return;
        const queue = () => this._queueUpdate();
        actor.connectObject('notify::allocation', queue, 'notify::visible', queue, this);
        queue();
    }

    _queueUpdate() {
        this._idleId ||= GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idleId = 0;
            this._update();
            return GLib.SOURCE_REMOVE;
        });
    }

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
