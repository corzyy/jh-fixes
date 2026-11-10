// Keyboard shortcut that minimizes all windows of the current workspace, and
// restores exactly those windows when pressed again.
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SettingTweak} from '../../lib/tweak.js';

const SHORTCUT_KEY = 'show-desktop-shortcut';

export class ShowDesktop extends SettingTweak {
    static KEY = 'show-desktop';
    // Off by default, unlike most tweaks.
    static DEFAULT = false;

    // `_minimized` maps each workspace to the windows we minimized there.
    _apply() {
        this._minimized = new Map();
        Main.wm.addKeybinding(SHORTCUT_KEY, this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._toggle());
    }

    _revert() {
        Main.wm.removeKeybinding(SHORTCUT_KEY);
        for (const windows of this._minimized.values())
            windows.forEach(w => w.disconnectObject(this));
        this._minimized = null;
    }

    // First press: minimize everything still shown. Second press (nothing left to
    // minimize): bring back the remembered windows in reverse order.
    _toggle() {
        if (Main.overview.visible)
            Main.overview.hide();

        const workspace = global.workspace_manager.get_active_workspace();
        // Forget windows the user has restored in the meantime.
        const remembered = (this._minimized.get(workspace) ?? []).filter(w => {
            if (w.minimized)
                return true;
            w.disconnectObject(this);
            return false;
        });

        const shown = global.display.get_tab_list(Meta.TabList.NORMAL, workspace)
            .filter(w => !w.minimized && w.can_minimize());

        if (shown.length > 0) {
            for (const w of shown) {
                w.connectObject('unmanaged', () => this._forget(w), this);
                w.minimize();
            }
            this._minimized.set(workspace, [...shown, ...remembered]);
        } else if (remembered.length > 0) {
            this._minimized.delete(workspace);
            for (const w of [...remembered].reverse()) {
                w.disconnectObject(this);
                w.unminimize();
            }
            remembered[0].activate(global.get_current_time());
        }
    }

    // A remembered window was closed; drop it everywhere.
    _forget(win) {
        win.disconnectObject(this);
        for (const [workspace, windows] of this._minimized) {
            const left = windows.filter(w => w !== win);
            if (left.length > 0)
                this._minimized.set(workspace, left);
            else
                this._minimized.delete(workspace);
        }
    }
}
