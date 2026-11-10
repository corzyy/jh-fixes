// Application launcher: a popup that searches apps, files, windows and more (see
// sources.js), plus an option to take over typing in the Overview search.
//
// This class owns the lifecycle: shortcut, Overview hook, shared state and the
// single popup instance. The UI is in popup.js.
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {whenReady} from '../../lib/shell.js';
import {SettingTweak} from '../../lib/tweak.js';
import {LauncherPopup} from './popup.js';
import {Sources} from './sources.js';
import {LauncherStyle} from './style.js';

// Settings: keybinding, "type in the Overview opens the launcher", and "launcher popup
// shortcut enabled".
const SHORTCUT_KEY = 'launcher-shortcut';
const OVERVIEW_KEY = 'launcher-overview-search';
const POPUP_KEY = 'launcher-popup';

export class Launcher extends SettingTweak {
    static KEY = 'launcher';
    static DEFAULT = false;

    _apply() {
        this._popup = null;
        this._style = new LauncherStyle(this._settings);
        // What the launcher searches is indexed once and shared by every popup.
        this._sources = new Sources();
        // Result rows already built, reused by later popups (see LauncherPopup._row).
        this._rowPool = new Map();
        // A separate owner, so SettingTweak's own disconnectObject(this) leaves the
        // feature's on/off handler alone and these go away on _revert().
        this._signals = {};
        this._settings.connectObject(
            `changed::${POPUP_KEY}`, () => this._syncShortcut(),
            `changed::${OVERVIEW_KEY}`, () => this._syncOverviewSearch(),
            this._signals);
        Main.sessionMode.connectObject('updated', () => {
            if (Main.sessionMode.isLocked)
                this._popup?.close();
        }, this._signals);

        // Pooled rows show app names and icons.
        Shell.AppSystem.get_default().connectObject('installed-changed', () => {
            if (!this._popup)
                this._dropRows();
        }, this._signals);
        // Showing the Overview usually means a search is about to be typed.
        Main.overview.connectObject('showing', () => this._warm(), this._signals);

        this._syncShortcut();
        this._syncOverviewSearch();

        this._warmId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
            this._warmId = 0;
            this._warm();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Does the slow parts of the first open ahead of time: loading the stylesheet
    // restyles the whole stage and the sources read every installed app.
    _warm() {
        try {
            this._style.load();
            this._sources.warm(this._settings);
        } catch (e) {
            console.error('jh-fixes: launcher failed to warm up', e);
        }
    }

    // Rows are built from app data, so they go stale when apps are installed or removed.
    _dropRows() {
        for (const row of this._rowPool.values())
            row.actor.destroy();
        this._rowPool.clear();
    }

    // Tear everything down in reverse order of setup.
    _revert() {
        if (this._warmId)
            GLib.source_remove(this._warmId);
        this._warmId = 0;
        Main.overview.disconnectObject(this._signals);
        Shell.AppSystem.get_default().disconnectObject(this._signals);
        this._settings.disconnectObject(this._signals);
        Main.sessionMode.disconnectObject(this._signals);
        this._signals = null;
        this._unhookOverviewSearch();
        this._removeShortcut();
        this._popup?.close();
        this._popup = null;
        this._dropRows();
        this._rowPool = null;
        this._sources.destroy();
        this._sources = null;
        this._style.unload();
        this._style = null;
    }

    _syncShortcut() {
        this._removeShortcut();
        if (!this._settings.get_boolean(POPUP_KEY)) {
            // Only close a popup opened by the shortcut; leave Overview search alone.
            if (this._popup && !this._popupFromOverview)
                this._popup.close();
            return;
        }
        Main.wm.addKeybinding(SHORTCUT_KEY, this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => this._toggle());
        this._shortcutBound = true;
    }

    _removeShortcut() {
        if (!this._shortcutBound)
            return;
        Main.wm.removeKeybinding(SHORTCUT_KEY);
        this._shortcutBound = false;
    }

    _syncOverviewSearch() {
        this._unhookOverviewSearch();
        if (!this._settings.get_boolean(OVERVIEW_KEY))
            return;
        this._cancelWait = whenReady(() => {
            try {
                return Main.overview.searchEntry?.clutter_text ?? null;
            } catch {
                return null;
            }
        }, text => {
            this._overviewText = text;
            // Runs after GNOME's own handler: take the text, clear GNOME's box (which
            // cancels its search before anything is drawn) and continue in the launcher.
            text.connectObject('text-changed', () => {
                const typed = text.text;
                if (!typed || this._takingOverviewText)
                    return;
                this._takingOverviewText = true;
                try {
                    text.text = '';
                } finally {
                    this._takingOverviewText = false;
                }
                if (!this._popup)
                    this._open(typed, {select: false, fromOverview: true});
            }, this);
        }, 'Overview search entry');
    }

    _unhookOverviewSearch() {
        this._cancelWait?.();
        this._cancelWait = null;
        this._overviewText?.disconnectObject(this);
        this._overviewText = null;
    }

    // The shortcut closes an open launcher, otherwise opens it with an empty query.
    _toggle() {
        if (this._popup) {
            this._popup.close();
            return;
        }
        this._open('', {select: true});
    }

    // Never open on the lock screen or login. The popup gets the shared sources and row
    // pool and tells us when it is closed. From the Overview it behaves as an overlay
    // that closes again when the query is emptied.
    _open(initialQuery, {select, fromOverview = false}) {
        if (Main.sessionMode.isLocked || Main.sessionMode.currentMode !== 'user')
            return;

        this._style.load();
        const popup = new LauncherPopup(this._settings, this._sources, this._rowPool, {
            initialQuery,
            selectQuery: select,
            closeWhenEmpty: fromOverview,
            overlay: fromOverview,
            onClosed: p => {
                if (this._popup === p)
                    this._popup = null;
            },
        });
        this._popup = popup;
        this._popupFromOverview = fromOverview;
        try {
            if (!popup.open())
                this._popup = null;
        } catch (e) {
            console.error('jh-fixes: launcher failed to open', e);
            popup.close();
            this._popup = null;
        }
    }
}
