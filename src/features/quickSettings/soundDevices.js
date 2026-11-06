// Rename and hide entries in the Quick Settings "Sound Output" and "Sound
// Input" menus.
//
// GNOME Shell builds those menus in ui/status/volume.js (OutputStreamSlider,
// InputStreamSlider). Each device gets a PopupImageMenuItem stored in
// slider._deviceItems, keyed by a Gvc device id. Those ids are reassigned
// every session, so settings are keyed by the device's "description|origin"
// text instead.
//
// The slider calls this._sync() after every device change, so overriding it on
// the instance is enough to re-apply names and visibility at the right time.
//
// The input slider only shows up in Quick Settings while an app is recording,
// so its menu can only be seen then; the devices are tracked all the time.

import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {whenReady} from '../../lib/shell.js';

/**
 * @param {object} device - a Gvc.MixerUIDevice
 * @returns {string} the label GNOME itself shows for the device
 */
function defaultLabel(device) {
    const {description, origin} = device;
    return origin ? `${description} – ${origin}` : description;
}

/**
 * @param {object} device - a Gvc.MixerUIDevice
 * @returns {string} a key that stays the same across sessions
 */
function deviceKey(device) {
    return `${device.description}|${device.origin ?? ''}`;
}

/**
 * Shared code for both menus. Subclasses say which slider to use, which
 * settings keys hold their data (known-, -names, hidden-), and how to find
 * the active device.
 */
class DeviceMenuTweak {
    static KIND = '';            // 'output' or 'input', used in the key names
    static ACTIVE_SIGNAL = '';   // MixerControl signal for active device changes

    constructor(settings) {
        this._settings = settings;
        this._slider = null;
        this._cancelWait = null;

        const kind = this.constructor.KIND;
        this._knownKey = `known-${kind}-devices`;
        this._namesKey = `${kind}-device-names`;
        this._hiddenKey = `hidden-${kind}-devices`;
    }

    enable() {
        this._settings.connectObject(
            `changed::${this._namesKey}`, () => this._apply(),
            `changed::${this._hiddenKey}`, () => this._apply(),
            this);

        // QuickSettings creates its indicators asynchronously, so at login the
        // slider may not exist yet when the extension is enabled.
        this._cancelWait = whenReady(() => this._findSlider(),
            slider => this._attach(slider),
            `sound ${this.constructor.KIND} slider`);
    }

    disable() {
        this._cancelWait?.();
        this._cancelWait = null;
        this._settings.disconnectObject(this);
        this._detach();
    }

    _findSlider() {
        return null;
    }

    _activeStream(_control) {
        return null;
    }

    _attach(slider) {
        this._slider = slider;
        const self = this;
        const origSync = Object.getPrototypeOf(slider)._sync;
        slider._sync = function () {
            origSync.call(this);
            self._apply();
        };
        // Active device changes only move the check mark; re-apply so a hidden
        // device shows up while it is the active one.
        slider._control.connectObject(
            this.constructor.ACTIVE_SIGNAL, () => this._apply(),
            this);
        this._apply();
    }

    _detach() {
        const slider = this._slider;
        if (!slider)
            return;
        this._slider = null;

        slider._control.disconnectObject(this);
        delete slider._sync;

        for (const [id, item] of slider._deviceItems) {
            const device = slider._lookupDevice(id);
            if (device)
                item.label.text = defaultLabel(device);
            item.visible = true;
        }
        slider._sync();
    }

    _apply() {
        const slider = this._slider;
        if (!slider)
            return;

        const known = this._settings.get_value(this._knownKey).deepUnpack();
        const names = this._settings.get_value(this._namesKey).deepUnpack();
        const hidden = new Set(this._settings.get_strv(this._hiddenKey));

        const control = slider._control;
        const stream = this._activeStream(control);
        const activeId = stream ? control.lookup_device_from_stream(stream)?.get_id() : null;

        let knownChanged = false;
        let visibleCount = 0;
        for (const [id, item] of slider._deviceItems) {
            const device = slider._lookupDevice(id);
            if (!device)
                continue;

            const key = deviceKey(device);
            const label = defaultLabel(device);
            if (known[key] !== label) {
                known[key] = label;
                knownChanged = true;
            }

            item.label.text = names[key] || label;
            item.visible = !hidden.has(key) || id === activeId;
            if (item.visible)
                visibleCount++;
        }

        // GNOME only offers the menu with more than one device; count the
        // ones that are left after hiding.
        slider.menuEnabled = visibleCount > 1;

        if (knownChanged) {
            this._settings.set_value(this._knownKey,
                new GLib.Variant('a{ss}', known));
        }
    }
}

export class OutputDevices extends DeviceMenuTweak {
    static KIND = 'output';
    static ACTIVE_SIGNAL = 'active-output-update';

    _findSlider() {
        return Main.panel.statusArea.quickSettings?._volumeOutput?._output;
    }

    _activeStream(control) {
        return control.get_default_sink();
    }
}

export class InputDevices extends DeviceMenuTweak {
    static KIND = 'input';
    static ACTIVE_SIGNAL = 'active-input-update';

    _findSlider() {
        return Main.panel.statusArea.quickSettings?._volumeInput?._input;
    }

    _activeStream(control) {
        return control.get_default_source();
    }
}
