// Adds a button for this extension's settings next to the buttons in the Quick
// Settings top row.
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickSettingsItem} from 'resource:///org/gnome/shell/ui/quickSettings.js';

import {whenReady} from '../../lib/shell.js';
import {SettingTweak} from '../../lib/tweak.js';

export class PrefsButton extends SettingTweak {
    static KEY = 'quick-settings-prefs-button';
    static DEFAULT = false;

    constructor(settings, extension) {
        super(settings);
        this._extension = extension;
    }

    // The system row is created lazily after login, so wait for it.
    _apply() {
        this._cancelWait = whenReady(
            () => Main.panel.statusArea.quickSettings?._system?._systemItem,
            systemItem => this._addButton(systemItem),
            'Quick Settings system row');
    }

    _revert() {
        this._cancelWait?.();
        this._cancelWait = null;
        Main.sessionMode.disconnectObject(this);
        this._button?.destroy();
        this._button = null;
    }

    _addButton(systemItem) {
        this._button = new QuickSettingsItem({
            style_class: 'icon-button',
            can_focus: true,
            accessible_name: 'jh-fixes Settings',
            child: new St.Icon({icon_name: 'application-x-addon-symbolic'}),
        });
        this._button.connect('clicked', () => {
            Main.overview.hide();
            Main.panel.closeQuickSettings();
            this._extension.openPreferences();
        });

        // Place it before the spacer so it sits with the other buttons, not at the far end.
        const box = systemItem.child;
        const spacer = systemItem._desktopSpacer;
        if (spacer?.get_parent() === box)
            box.insert_child_below(this._button, spacer);
        else
            box.add_child(this._button);

        // Hide it where settings are not allowed (lock screen, greeter).
        const sync = () => (this._button.visible = Main.sessionMode.allowSettings);
        Main.sessionMode.connectObject('updated', sync, this);
        sync();
    }
}
