// A Show Desktop shortcut (Super+D by default, show-desktop-shortcut).
//
// The first press minimises every window on the active workspace; the next
// press, if nothing has been opened or restored since, brings them back,
// with the window that had focus on top again. Opening a window in between
// and pressing again minimises that one too, and the press after that
// brings back all of them. Each workspace remembers its own windows.
//
// The windows are really minimised (with GNOME's animation), rather than
// put in mutter's own show-desktop mode.

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SettingTweak} from '../../lib/tweak.js';

const SHORTCUT_KEY = 'show-desktop-shortcut';

export class ShowDesktop extends SettingTweak {
    static KEY = 'show-desktop';
    static DEFAULT = false;

    _apply() {
        this._minimized = new Map(); // workspace -> windows, most recent first
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

    _toggle() {
        if (Main.overview.visible)
            Main.overview.hide();

        const workspace = global.workspace_manager.get_active_workspace();
        // Ones the user restored by hand are theirs again.
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
            // Least recent first, so the stacking ends up as it was.
            for (const w of [...remembered].reverse()) {
                w.disconnectObject(this);
                w.unminimize();
            }
            remembered[0].activate(global.get_current_time());
        }
    }

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
