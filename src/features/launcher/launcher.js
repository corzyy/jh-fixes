import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {whenReady} from '../../lib/shell.js';
import {SettingTweak} from '../../lib/tweak.js';
import {LauncherPopup} from './popup.js';
import {LauncherStyle, STYLE_KEYS} from './style.js';

const SHORTCUT_KEY = 'launcher-shortcut';
const OVERVIEW_KEY = 'launcher-overview-search';

export class Launcher extends SettingTweak {
    static KEY = 'launcher';
    static DEFAULT = false;

    _apply() {
        this._popup = null;
        this._lastQuery = '';
        this._style = new LauncherStyle(this._settings);
        this._style.load();
        this._styleSignals = STYLE_KEYS.map(key =>
            this._settings.connect(`changed::${key}`, () => this._style.load()));

        Main.wm.addKeybinding(SHORTCUT_KEY, this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
            () => this._toggle());
        Main.sessionMode.connectObject('updated', () => {
            if (Main.sessionMode.isLocked)
                this._popup?.close();
        }, this);

        this._overviewSignal = this._settings.connect(`changed::${OVERVIEW_KEY}`,
            () => this._syncOverviewSearch());
        this._syncOverviewSearch();
    }

    _revert() {
        this._settings.disconnect(this._overviewSignal);
        this._unhookOverviewSearch();
        Main.wm.removeKeybinding(SHORTCUT_KEY);
        Main.sessionMode.disconnectObject(this);
        this._styleSignals.forEach(id => this._settings.disconnect(id));
        this._styleSignals = null;
        this._popup?.close();
        this._popup = null;
        this._style.unload();
        this._style = null;
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

    _toggle() {
        if (this._popup) {
            this._popup.close();
            return;
        }
        const remember = this._settings.get_boolean('launcher-remember-query');
        this._open(remember ? this._lastQuery : '', {select: true});
    }

    _open(initialQuery, {select, fromOverview = false}) {
        if (Main.sessionMode.isLocked || Main.sessionMode.currentMode !== 'user')
            return;

        this._style.load();
        const popup = new LauncherPopup(this._settings, {
            initialQuery,
            selectQuery: select,
            closeWhenEmpty: fromOverview,
            onClosed: p => {
                this._lastQuery = p.activated ? '' : p.query;
                if (this._popup === p)
                    this._popup = null;
            },
        });
        this._popup = popup;
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
