import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickSlider} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import * as Ddc from '../../lib/ddc.js';
import {whenQuickSettingsReady} from '../../lib/shell.js';
import {SettingTweak} from '../../lib/tweak.js';

const REDETECT_DELAY_MS = 3000;

const READ_BACK_INTERVAL_US = 15 * GLib.USEC_PER_SEC;
const RETRY_DETECT_INTERVAL_US = 60 * GLib.USEC_PER_SEC;

const TITLE = 'Monitor Brightness';

const clamp01 = v => Math.min(1, Math.max(0, v));

function modelOf(name) {
    const parts = name.split(':');
    return (parts.length >= 2 && parts[1].trim()) || name || '';
}

export class DdcBrightness extends SettingTweak {
    static KEY = 'ddc-brightness';
    static DEFAULT = false;

    _apply() {
        this._cancellable = new Gio.Cancellable();
        this._displays = [];
        this._mainBase = null;
        this._redetectId = 0;
        this._detecting = null;
        this._lastWarning = null;
        this._updating = false;
        this._lastRead = 0;

        this._cancelWait = whenQuickSettingsReady(qs => this._attach(qs));
    }

    _revert() {
        this._cancelWait?.();
        this._cancelWait = null;
        this._cancellable?.cancel();
        this._cancellable = null;
        if (this._redetectId)
            GLib.source_remove(this._redetectId);
        this._redetectId = 0;
        global.backend.get_monitor_manager().disconnectObject(this);
        this._qs?.menu.disconnectObject(this);
        this._qs = null;
        // GNOME doesn't destroy an item's menu with it; it would stay in the overlay.
        this._item?.menu.close(false);
        this._item?.menu.destroy();
        this._item?.destroy();
        this._item = null;
        this._section = null;
        this._displays = [];
        this._mainBase = null;
        this._detecting = null;
    }

    _attach(qs) {
        this._qs = qs;
        this._item = new QuickSlider({
            iconName: 'display-brightness-symbolic',
            menuButtonAccessibleName: 'Open monitor brightness menu',
            visible: false,
        });
        this._item.slider.accessible_name = 'External Monitor Brightness';
        this._item._jhFixesId = 'ddc-brightness';
        this._item.slider.connect('notify::value', () => {
            if (!this._updating)
                this._onMainMoved(this._item.slider.value);
        });
        this._item.slider.connect('drag-begin', () => (this._mainBase = null));

        this._item.menu.setHeader('display-brightness-symbolic', TITLE);
        this._section = new PopupMenu.PopupMenuSection();
        this._item.menu.addMenuItem(this._section);

        const own = qs._brightness?.quickSettingsItems[0];
        const sibling = own?.get_parent() === qs.menu._grid ? own.get_next_sibling() : null;
        qs.menu.insertItemBefore(this._item, sibling, 2);

        qs.menu.connectObject('open-state-changed', (_menu, open) => {
            if (!open)
                return;
            const age = GLib.get_monotonic_time() - this._lastRead;
            if (this._displays.length > 0) {
                if (age >= READ_BACK_INTERVAL_US)
                    this._readBack();
            } else if (age >= RETRY_DETECT_INTERVAL_US) {
                this._detect();
            }
        }, this);
        global.backend.get_monitor_manager().connectObject('monitors-changed',
            () => this._scheduleDetect(), this);

        this._detect();
    }

    _scheduleDetect() {
        if (this._redetectId)
            GLib.source_remove(this._redetectId);
        this._redetectId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REDETECT_DELAY_MS, () => {
            this._redetectId = 0;
            this._detect();
            return GLib.SOURCE_REMOVE;
        });
    }

    _detect() {
        if (this._detecting)
            return;
        if (!Ddc.haveDdcutil()) {
            this._warnOnce('ddcutil is not installed, DDC brightness slider hidden');
            return;
        }
        const run = this._detectOnce(this._cancellable)
            .catch(e => console.error('jh-fixes: DDC detection failed', e))
            .finally(() => {
                if (this._detecting === run)
                    this._detecting = null;
            });
        this._detecting = run;
    }

    async _detectOnce(cancellable) {
        this._lastRead = GLib.get_monotonic_time();
        let found;
        try {
            found = await Ddc.detect(cancellable);
        } catch (e) {
            if (!cancellable.is_cancelled())
                this._warnOnce(`ddcutil detect failed: ${e.message}`);
            return;
        }

        const results = await Promise.all(found.map(async d => {
            try {
                return {...d, ...await Ddc.getBrightness(d.bus, cancellable)};
            } catch (e) {
                if (!cancellable.is_cancelled())
                    console.warn(`jh-fixes: ${d.name || `i2c-${d.bus}`} has no DDC brightness: ${e.message}`);
                return null;
            }
        }));
        if (cancellable.is_cancelled())
            return;

        const old = new Map(this._displays.map(d => [d.bus, d]));
        this._displays = results.filter(r => r && r.max > 0).map(({bus, name, connector, current, max}) => {
            const display = old.get(bus);
            if (display?.max === max) {
                Object.assign(display, {name, connector});
                return display;
            }
            return {bus, name, connector, max, sent: current, target: null, running: false, slider: null};
        });
        this._mainBase = null;
        this._buildMenu();

        this._item.visible = this._displays.length > 0;
        if (this._displays.length === 0) {
            this._warnOnce('no monitor with DDC/CI brightness found. Check `ddcutil detect`; ' +
                'without access to /dev/i2c-* it reports none.');
            return;
        }
        this._lastWarning = null;
        this._showValues();
    }

    _buildMenu() {
        this._section.removeAll();
        const models = this._displays.map(d => modelOf(d.name));
        this._displays.forEach((display, i) => {
            const twin = models.some((m, j) => j !== i && m === models[i]);
            const label = models[i]
                ? (twin && display.connector ? `${models[i]} (${display.connector})` : models[i])
                : display.connector || `Monitor ${i + 1}`;

            this._section.addMenuItem(new PopupMenu.PopupMenuItem(label, {reactive: false}));
            const slider = new Slider(0);
            slider.accessible_name = `${label} Brightness`;
            slider.connect('notify::value', () => {
                if (!this._updating)
                    this._onMonitorMoved(display, slider.value);
            });
            const item = new PopupMenu.PopupBaseMenuItem({reactive: false});
            item.add_child(new St.Bin({
                style_class: 'slider-bin',
                child: slider,
                reactive: true,
                can_focus: true,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            this._section.addMenuItem(item);
            display.slider = slider;
        });
        this._item.menuEnabled = this._displays.length > 1;
        if (this._displays.length < 2)
            this._item.menu.close();
    }

    _warnOnce(message) {
        if (message !== this._lastWarning)
            console.warn(`jh-fixes: ${message}`);
        this._lastWarning = message;
    }

    async _readBack() {
        const cancellable = this._cancellable;
        this._lastRead = GLib.get_monotonic_time();
        await Promise.all(this._displays.map(async display => {
            if (display.running)
                return;
            try {
                const {current} = await Ddc.getBrightness(display.bus, cancellable);
                if (display.running || cancellable.is_cancelled())
                    return;
                display.sent = current;
                display.target = null;
            } catch (e) {
                if (!cancellable.is_cancelled())
                    console.warn(`jh-fixes: reading brightness of ${display.name} failed: ${e.message}`);
            }
        }));
        if (cancellable.is_cancelled())
            return;
        this._mainBase = null;
        this._showValues();
    }

    _levelOf(display) {
        return display.target ?? display.sent / display.max;
    }

    _average() {
        return this._displays.reduce((sum, d) => sum + this._levelOf(d), 0) / this._displays.length;
    }

    _showValues(skipMain = false) {
        this._updating = true;
        try {
            for (const display of this._displays) {
                if (display.slider)
                    display.slider.value = this._levelOf(display);
            }
            if (!skipMain && this._displays.length > 0)
                this._item.slider.value = this._average();
        } finally {
            this._updating = false;
        }
    }

    _onMainMoved(value) {
        if (!this._mainBase) {
            this._mainBase = {
                value: this._displays.length ? this._average() : value,
                targets: new Map(this._displays.map(d => [d, this._levelOf(d)])),
            };
        }
        const delta = value - this._mainBase.value;
        for (const display of this._displays) {
            const base = this._mainBase.targets.get(display) ?? value;
            display.target = value <= 0 || value >= 1 ? value : clamp01(base + delta);
            this._pump(display);
        }
        this._showValues(true);
    }

    _onMonitorMoved(display, value) {
        display.target = value;
        this._mainBase = null;
        this._pump(display);
        this._showValues();
    }

    async _pump(display) {
        if (display.running || display.target === null)
            return;
        const cancellable = this._cancellable;
        display.running = true;
        try {
            for (;;) {
                if (cancellable.is_cancelled() || !this._displays.includes(display))
                    break;
                const raw = Math.round(display.target * display.max);
                if (raw === display.sent)
                    break;
                try {
                    await Ddc.setBrightness(display.bus, raw, cancellable);
                    display.sent = raw;
                    this._lastRead = GLib.get_monotonic_time();
                } catch (e) {
                    if (!cancellable.is_cancelled())
                        console.warn(`jh-fixes: setting brightness on ${display.name} failed: ${e.message}`);
                    break;
                }
            }
        } finally {
            display.running = false;
        }
    }
}
