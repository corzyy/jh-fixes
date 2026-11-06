import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {whenReady} from '../../lib/shell.js';

function defaultLabel(device) {
    const {description, origin} = device;
    return origin ? `${description} – ${origin}` : description;
}

function deviceKey(device) {
    return `${device.description}|${device.origin ?? ''}`;
}

class DeviceMenuTweak {
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
        const apply = () => this._apply();
        this._settings.connectObject(
            `changed::${this._namesKey}`, apply,
            `changed::${this._hiddenKey}`, apply,
            this);

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

    _attach(slider) {
        this._slider = slider;
        const self = this;
        const origSync = Object.getPrototypeOf(slider)._sync;
        slider._sync = function () {
            origSync.call(this);
            self._apply();
        };
        slider._control.connectObject(this.constructor.ACTIVE_SIGNAL, () => this._apply(), this);
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

        slider.menuEnabled = visibleCount > 1;

        if (knownChanged)
            this._settings.set_value(this._knownKey, new GLib.Variant('a{ss}', known));
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
