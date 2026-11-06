import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

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
