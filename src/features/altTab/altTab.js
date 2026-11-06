import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as AltTab from 'resource:///org/gnome/shell/ui/altTab.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SwitcherPopup from 'resource:///org/gnome/shell/ui/switcherPopup.js';

const KEYS = {
    mode: 'alt-tab-mode',
    style: 'alt-tab-window-style',
    delay: 'alt-tab-popup-delay',
};

const GNOME_DELAY = 150;

const WINDOW_STYLES = {thumbnails: 1, icons: 2, both: 3};

const APP_BINDINGS = ['switch-applications', 'switch-applications-backward'];

function withAllWorkspaces(build) {
    const display = global.display;
    const getTabList = display.get_tab_list;
    display.get_tab_list = type => getTabList.call(display, type, null);
    try {
        return build();
    } finally {
        delete display.get_tab_list;
    }
}

function startWindowSwitcher(_display, _window, _event, binding) {
    Main.wm._workspaceSwitcherPopup?.destroy();
    const backward = binding.is_reversed();
    const popup = new AltTab.WindowSwitcherPopup();
    popup._jhFixesFromAltTab = true;
    if (!popup.show(backward, backward ? 'switch-windows-backward' : 'switch-windows', binding.get_mask()))
        popup.destroy();
}

export class AltTabSwitcher {
    constructor(settings) {
        this._settings = settings;
        this._injections = new InjectionManager();
        this._windowsOnAltTab = false;
    }

    enable() {
        this._settings.connectObject(`changed::${KEYS.mode}`, () => this._syncMode(), this);
        this._inject();
        this._syncMode();
    }

    disable() {
        this._settings.disconnectObject(this);
        this._setWindowsOnAltTab(false);
        this._injections.clear();
    }

    _inject() {
        const self = this;

        this._injections.overrideMethod(AltTab.AppSwitcherPopup.prototype, '_init',
            original => function (...args) {
                return withAllWorkspaces(() => original.apply(this, args));
            });

        this._injections.overrideMethod(AltTab.WindowSwitcherPopup.prototype, '_getWindowList',
            original => function (...args) {
                const style = WINDOW_STYLES[self._settings.get_string(KEYS.style)];
                if (style) {
                    const settings = this._settings;
                    const getEnum = settings.get_enum;
                    settings.get_enum = key =>
                        (key === 'app-icon-mode' ? style : getEnum.call(settings, key));
                }
                return withAllWorkspaces(() => original.apply(this, args));
            });

        this._injections.overrideMethod(AltTab.WindowSwitcherPopup.prototype, '_keyPressHandler',
            original => function (keysym, action) {
                if (this._jhFixesFromAltTab) {
                    if (action === Meta.KeyBindingAction.SWITCH_APPLICATIONS)
                        action = Meta.KeyBindingAction.SWITCH_WINDOWS;
                    else if (action === Meta.KeyBindingAction.SWITCH_APPLICATIONS_BACKWARD)
                        action = Meta.KeyBindingAction.SWITCH_WINDOWS_BACKWARD;
                }
                return original.call(this, keysym, action);
            });

        this._injections.overrideMethod(SwitcherPopup.SwitcherPopup.prototype, 'show',
            original => function (...args) {
                const shown = original.apply(this, args);
                const delay = self._settings.get_int(KEYS.delay);
                if (shown && this._initialDelayTimeoutId && delay !== GNOME_DELAY) {
                    if (delay <= 0) {
                        this._showImmediately();
                    } else {
                        GLib.source_remove(this._initialDelayTimeoutId);
                        this._initialDelayTimeoutId = GLib.timeout_add_once(
                            GLib.PRIORITY_DEFAULT, delay, () => this._showImmediately());
                    }
                }
                return shown;
            });
    }

    _syncMode() {
        this._setWindowsOnAltTab(this._settings.get_string(KEYS.mode) === 'windows');
    }

    _setWindowsOnAltTab(on) {
        if (on === this._windowsOnAltTab)
            return;
        this._windowsOnAltTab = on;
        const handler = on ? startWindowSwitcher : Main.wm._startSwitcher.bind(Main.wm);
        for (const name of APP_BINDINGS)
            Main.wm.setCustomKeybindingHandler(name, Shell.ActionMode.NORMAL, handler);
    }
}
