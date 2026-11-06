// Speed up or slow down all shell animations.
//
// Every ease() and most other shell animations scale their duration by
// St.Settings.slow_down_factor (ui/environment.js, adjustAnimationTime). The
// same knob is behind GNOME_SHELL_SLOWDOWN_FACTOR and Looking Glass's
// slow-motion toggle. Turning animations off entirely is a stock setting
// (Settings > Accessibility > Reduce Animation).

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
        // 100 % means "leave it alone", so a factor set from outside (the
        // environment variable) keeps working.
        St.Settings.get().slow_down_factor =
            percent === 100 ? this._original : percent / 100;
    }
}
