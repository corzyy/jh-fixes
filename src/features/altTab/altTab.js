// Alt+Tab tweaks (ui/altTab.js, ui/switcherPopup.js, ui/windowManager.js).
//
//   alt-tab-mode               'apps' (GNOME) or 'windows': Alt+Tab (the
//                              switch-applications shortcut) opens the
//                              window switcher instead.
//   alt-tab-window-style       what the window switcher shows per window:
//                              'gnome' (its own setting), 'thumbnails',
//                              'icons' or 'both'
//   alt-tab-popup-delay        ms before the popup appears; GNOME uses 150
//                              so quick presses don't flash it
//
// Both switchers always list the windows of every workspace, whatever
// GNOME's current-workspace-only settings say. They get their windows from
// global.display.get_tab_list() (through a private helper in altTab.js),
// asking for one workspace or for all of them; while the popup builds its
// list, that call is made to ask for all of them.

import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
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

const GNOME_DELAY = 150; // POPUP_DELAY_TIMEOUT in switcherPopup.js

// AppIconMode in altTab.js (the app-icon-mode enum's values).
const WINDOW_STYLES = {thumbnails: 1, icons: 2, both: 3};

const APP_BINDINGS = ['switch-applications', 'switch-applications-backward'];

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

    // The overrides read the settings each time a popup opens, and do
    // nothing while those are at GNOME's defaults.
    _inject() {
        const self = this;

        // Apps: AppSwitcher builds its list while the popup is made.
        this._injections.overrideMethod(AltTab.AppSwitcherPopup.prototype, '_init',
            original => function (...args) {
                return self._withFilteredTabList(() => original.apply(this, args));
            });

        // Windows: the list, and the icon mode query, which _init makes on
        // the popup's own settings right after this.
        this._injections.overrideMethod(AltTab.WindowSwitcherPopup.prototype, '_getWindowList',
            original => function (...args) {
                const style = WINDOW_STYLES[self._settings.get_string(KEYS.style)];
                if (style) {
                    const settings = this._settings;
                    const getEnum = settings.get_enum;
                    settings.get_enum = key =>
                        (key === 'app-icon-mode' ? style : getEnum.call(settings, key));
                }
                return self._withFilteredTabList(() => original.apply(this, args));
            });

        // Opened from Alt+Tab, the window switcher has to step on that key
        // too; it only knows the switch-windows actions.
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

        // The delay: show() starts GNOME's timeout; swap it for ours.
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

    // Runs build() with get_tab_list() answering for all workspaces. An own
    // property on the display shadows the method.
    _withFilteredTabList(build) {
        const display = global.display;
        const getTabList = display.get_tab_list;
        display.get_tab_list = type => getTabList.call(display, type, null);
        try {
            return build();
        } finally {
            delete display.get_tab_list;
        }
    }

    _syncMode() {
        this._setWindowsOnAltTab(this._settings.get_string(KEYS.mode) === 'windows');
    }

    _setWindowsOnAltTab(on) {
        if (on === this._windowsOnAltTab)
            return;
        this._windowsOnAltTab = on;
        const handler = on
            ? (...args) => this._startWindowSwitcher(...args)
            : Main.wm._startSwitcher.bind(Main.wm);
        for (const name of APP_BINDINGS)
            Main.wm.setCustomKeybindingHandler(name, Shell.ActionMode.NORMAL, handler);
    }

    // As WindowManager._startSwitcher does for switch-windows.
    _startWindowSwitcher(_display, _window, _event, binding) {
        Main.wm._workspaceSwitcherPopup?.destroy();
        const backward = binding.is_reversed();
        const popup = new AltTab.WindowSwitcherPopup();
        popup._jhFixesFromAltTab = true;
        const name = backward ? 'switch-windows-backward' : 'switch-windows';
        if (!popup.show(backward, name, binding.get_mask()))
            popup.destroy();
    }
}
