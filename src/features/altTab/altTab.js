// Alt+Tab tweaks: switch windows instead of apps, list windows of all workspaces,
// choose how windows are shown, and change the popup delay.
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as AltTab from 'resource:///org/gnome/shell/ui/altTab.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SwitcherPopup from 'resource:///org/gnome/shell/ui/switcherPopup.js';

// Setting keys.
const KEYS = {
    mode: 'alt-tab-mode',
    style: 'alt-tab-window-style',
    delay: 'alt-tab-popup-delay',
};

// GNOME's own popup delay in ms; it is left alone when the setting matches.
const GNOME_DELAY = 150;

// Values of GNOME's `app-icon-mode` setting.
const WINDOW_STYLES = {thumbnails: 1, icons: 2, both: 3};

// Keybindings that normally start the application switcher.
const APP_BINDINGS = ['switch-applications', 'switch-applications-backward'];

// Runs `build` with get_tab_list() returning windows from every workspace instead of
// only the active one, by temporarily shadowing the method on the display.
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

// Handler that opens the window switcher for the app-switcher shortcut.
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
        // Overrides below use `function` so `this` stays the original popup; `self` is us.
        const self = this;

        // The app switcher lists apps; make it include apps from all workspaces.
        this._injections.overrideMethod(AltTab.AppSwitcherPopup.prototype, '_init',
            original => function (...args) {
                return withAllWorkspaces(() => original.apply(this, args));
            });

        // Window switcher: all workspaces, and fake the `app-icon-mode` setting while the
        // list is built to get the chosen style.
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

        // When opened through the app-switcher shortcut, map the app actions to their window
        // equivalents so Tab/Shift+Tab keep cycling.
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

        // Adjust the delay before the popup appears (0 = immediately).
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

    // Rebind the app-switcher shortcuts to our handler, or back to the shell's.
    _setWindowsOnAltTab(on) {
        if (on === this._windowsOnAltTab)
            return;
        this._windowsOnAltTab = on;
        const handler = on ? startWindowSwitcher : Main.wm._startSwitcher.bind(Main.wm);
        for (const name of APP_BINDINGS)
            Main.wm.setCustomKeybindingHandler(name, Shell.ActionMode.NORMAL, handler);
    }
}
