import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Overview} from 'resource:///org/gnome/shell/ui/overview.js';

import {SettingTweak} from '../../lib/tweak.js';

const LAUNCHER_KEYS = ['launcher', 'launcher-overview-search'];

// Removes the search entry and type-to-search from the Overview.
//
// The entry stays mapped, just collapsed and invisible: GNOME makes typing land in
// it through an input interceptor on the stage, and the launcher's "Replace the
// Overview search" reads the typed text from there. So while that is on, typing
// keeps going to the (invisible) entry and the launcher takes it from there;
// otherwise the interceptor is dropped and typing does nothing.
export class HideSearch extends SettingTweak {
    static KEY = 'overview-search';
    static DEFAULT = true;

    _apply() {
        const controls = Main.overview._overview._controls;
        const bin = controls._searchEntryBin;
        const entry = controls._searchEntry;
        this._saved = {opacity: bin.opacity, canFocus: entry.can_focus, reactive: entry.reactive};

        bin.opacity = 0;
        bin.height = 0;
        entry.can_focus = false;
        entry.reactive = false;

        const typing = () => this._launcherTakesTyping();
        this._injections.overrideMethod(Overview.prototype, 'focusSearch', original =>
            function () {
                if (typing())
                    original.call(this);
                else
                    this.show();
            });

        // Connected after GNOME's own handler, so this runs once it has set the
        // interceptor up.
        this._signals = {};
        Main.overview.connectObject('showing',
            () => this._setTyping(this._launcherTakesTyping()), this._signals);
        for (const key of LAUNCHER_KEYS) {
            this._settings.connectObject(`changed::${key}`,
                () => this._syncTyping(), this._signals);
        }
        this._syncTyping();
    }

    _revert() {
        Main.overview.disconnectObject(this._signals);
        this._settings.disconnectObject(this._signals);
        this._signals = null;

        const controls = Main.overview._overview._controls;
        const bin = controls._searchEntryBin;
        const entry = controls._searchEntry;
        bin.opacity = this._saved.opacity;
        bin.height = -1;
        entry.can_focus = this._saved.canFocus;
        entry.reactive = this._saved.reactive;
        this._saved = null;
        if (Main.overview.visible)
            this._setTyping(true);
    }

    _launcherTakesTyping() {
        return LAUNCHER_KEYS.every(k => this._settings.get_boolean(k));
    }

    // Only touch the interceptor while the Overview is open; GNOME sets it on
    // 'showing' and clears it on 'hiding' itself.
    _syncTyping() {
        if (Main.overview.visible)
            this._setTyping(this._launcherTakesTyping());
    }

    _setTyping(enabled) {
        Main.overview.searchEntry.clutter_text.set_input_interceptor(
            enabled ? global.stage : null);
    }
}
