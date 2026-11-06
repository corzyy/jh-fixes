import St from 'gi://St';

const KEY = 'animation-duration';

export class AnimationDuration {
    constructor(settings) {
        this._settings = settings;
        this._original = null;
    }

    enable() {
        this._original = St.Settings.get().slow_down_factor;
        this._settings.connectObject(`changed::${KEY}`, () => this._sync(), this);
        this._sync();
    }

    disable() {
        this._settings.disconnectObject(this);
        if (this._original !== null)
            St.Settings.get().slow_down_factor = this._original;
        this._original = null;
    }

    _sync() {
        const percent = this._settings.get_int(KEY);
        St.Settings.get().slow_down_factor =
            percent === 100 ? this._original : percent / 100;
    }
}
