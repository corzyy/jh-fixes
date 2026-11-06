import St from 'gi://St';

import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Dash from 'resource:///org/gnome/shell/ui/dash.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {setShownInLayout} from '../../lib/shell.js';
import {SettingTweak} from '../../lib/tweak.js';

export class DashVisible extends SettingTweak {
    static KEY = 'dash-visible';

    _apply() {
        setShownInLayout(Main.overview.dash, false);
    }

    _revert() {
        setShownInLayout(Main.overview.dash, true);
    }
}

export class DashShowAppsButton extends SettingTweak {
    static KEY = 'dash-show-apps-button';

    _apply() {
        Main.overview.dash._showAppsIcon.visible = false;
    }

    _revert() {
        Main.overview.dash._showAppsIcon.visible = true;
    }
}

export class DashIconSize {
    static KEY = 'dash-max-icon-size';

    constructor(settings) {
        this._settings = settings;
        this._injections = new InjectionManager();
    }

    enable() {
        const dash = Main.overview.dash;
        if (typeof dash?._adjustIconSize !== 'function')
            throw new Error('Overview dash not found');

        const maxHeightFor = d => this._maxHeightFor(d);
        this._injections.overrideMethod(Dash.Dash.prototype, '_adjustIconSize',
            original => function () {
                if (this._maxWidth === -1 || this._maxHeight === -1)
                    return original.call(this);

                const realMax = this._maxHeight;
                this._maxHeight = Math.min(realMax, maxHeightFor(this));
                try {
                    return original.call(this);
                } finally {
                    this._maxHeight = realMax;
                }
            });

        this._settings.connectObject(`changed::${DashIconSize.KEY}`,
            () => dash._adjustIconSize(), this);
        dash._adjustIconSize();
    }

    disable() {
        this._settings.disconnectObject(this);
        this._injections.clear();
        Main.overview.dash?._adjustIconSize();
    }

    _maxHeightFor(dash) {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const cap = this._settings.get_int(DashIconSize.KEY) * scale;

        const iconChild = dash._box.get_children().find(actor =>
            actor.child?._delegate?.icon && !actor.animatingOut) ?? dash._showAppsIcon;
        const button = iconChild.child;
        const icon = button._delegate.icon.icon;

        icon.ensure_style();
        const [, , , iconHeight] = icon.get_preferred_size();
        const [, , , buttonHeight] = button.get_preferred_size();

        return cap +
            dash.margin_top + dash.margin_bottom +
            dash._background.get_theme_node().get_vertical_padding() +
            dash.get_theme_node().get_vertical_padding() +
            (buttonHeight - iconHeight);
    }
}
