// Base class for on/off features.

import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

/**
 * A feature that changes the shell while one boolean setting differs from
 * GNOME's own behaviour (DEFAULT). Subclasses set KEY and implement
 * _apply() and _revert(). Method overrides made with this._injections are
 * undone automatically after _revert().
 *
 * The schema defaults match stock GNOME, so a tweak does nothing until the
 * user flips its switch.
 */
export class SettingTweak {
    static KEY = '';
    static DEFAULT = true;

    constructor(settings) {
        this._settings = settings;
        this._injections = new InjectionManager();
        this._applied = false;
    }

    enable() {
        this._settings.connectObject(`changed::${this.constructor.KEY}`,
            () => this._sync(), this);
        this._sync();
    }

    disable() {
        this._settings.disconnectObject(this);
        if (this._applied)
            this._setApplied(false);
    }

    _sync() {
        const {KEY, DEFAULT} = this.constructor;
        const wanted = this._settings.get_boolean(KEY) !== DEFAULT;
        if (wanted !== this._applied)
            this._setApplied(wanted);
    }

    _setApplied(applied) {
        // Flip first, so a half-done _apply() still gets reverted on disable.
        this._applied = applied;
        if (applied) {
            this._apply();
        } else {
            try {
                this._revert();
            } finally {
                this._injections.clear();
            }
        }
    }

    _apply() {}

    _revert() {}
}
