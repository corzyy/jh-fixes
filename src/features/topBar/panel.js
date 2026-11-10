// Dynamic top bar: transparent while the desktop is visible, solid as soon as a
// window touches it. Only the PANEL_SOLID_CLASS style class is toggled here; the
// actual colors come from the generated theme (see appearance/theme).
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {PANEL_SOLID_CLASS} from '../appearance/theme/build.js';

// Window types that count as touching the panel (docks, desktop windows etc. do not).
const TOUCHING_TYPES = new Set([
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.UTILITY,
    Meta.WindowType.TOOLBAR,
    Meta.WindowType.SPLASHSCREEN,
]);

// Gap in logical pixels still counted as touching.
const TOUCH_MARGIN = 4;

export class DynamicPanel {
    constructor(settings) {
        this._settings = settings;
        this._active = false;
        this._idleId = 0;
        this._solid = false;
    }

    enable() {
        this._settings.connectObject('changed::shell-theme-panel', () => this._syncActive(), this);
        this._syncActive();
    }

    disable() {
        this._settings.disconnectObject(this);
        this._stop();
    }

    _syncActive() {
        const wanted = this._settings.get_string('shell-theme-panel') === 'dynamic';
        if (wanted && !this._active)
            this._start();
        else if (!wanted && this._active)
            this._stop();
    }

    // Re-evaluate whenever something that could change the answer happens.
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

    // Window actors announce movement and visibility through property notifications.
    _watch(actor) {
        if (!(actor instanceof Meta.WindowActor))
            return;
        const queue = () => this._queueUpdate();
        actor.connectObject('notify::allocation', queue, 'notify::visible', queue, this);
        queue();
    }

    // Coalesce bursts of events into a single update when the main loop is idle.
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

    // True if a normal window on the panel's monitor reaches the panel. Never solid in
    // the Overview, on the lock screen or in the greeter.
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
