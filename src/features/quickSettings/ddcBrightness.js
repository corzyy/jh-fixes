// A Quick Settings brightness slider for external monitors, through
// DDC/CI with ddcutil (lib/ddc.js).
//
// GNOME 51's own brightness slider (ui/status/brightness.js) only covers
// backlights Mutter knows: laptop panels through sysfs. It hides itself when
// there are none, so on a desktop with external monitors this one takes its
// place, right below where it would be.
//
// With more than one monitor, the arrow next to the slider opens a menu with
// a slider per monitor, like GNOME's own item. The main slider shows the
// average and moves every monitor by the same amount, so differences set in
// the menu are kept (until a monitor hits 0 or 100 %).
//
// DDC/CI is slow (around 50-200 ms per write) and monitors dislike being
// flooded, so writes are coalesced: each monitor has at most one ddcutil
// call running, and when it finishes the latest target for that monitor is
// sent if it changed meanwhile. All monitors are written in parallel.

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

// Monitors that were just switched on or plugged in need a moment before
// they answer DDC/CI.
const REDETECT_DELAY_MS = 3000;

// Opening Quick Settings checks the monitors again, but every check runs a
// ddcutil process per monitor (and a full scan of all I2C buses when none
// was found), so not more often than this.
const READ_BACK_INTERVAL_US = 15 * GLib.USEC_PER_SEC;
const RETRY_DETECT_INTERVAL_US = 60 * GLib.USEC_PER_SEC;

const TITLE = 'Monitor Brightness';

const clamp01 = v => Math.min(1, Math.max(0, v));

// "ACI:VS248:H7LMQS121034" (maker:model:serial) -> "VS248".
function modelOf(name) {
    const parts = name.split(':');
    return (parts.length >= 2 && parts[1].trim()) || name || '';
}

export class DdcBrightness extends SettingTweak {
    static KEY = 'ddc-brightness';
    static DEFAULT = false;

    _apply() {
        this._cancellable = new Gio.Cancellable();
        // {bus, name, connector, max, sent, target, running, slider}
        // target is 0..1 or null (nothing to send).
        this._displays = [];
        // Where each monitor was when the main slider started moving, so
        // a drag keeps their differences even past 0 or 100 % and back.
        this._mainBase = null;    // {value, targets: Map<display, number>}
        this._redetectId = 0;
        this._detecting = null;   // the running detection, if any
        this._lastWarning = null;
        this._updating = false;   // set while we move sliders ourselves
        this._lastRead = 0;       // monotonic µs of the last read or detection

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
        // Destroys the item's menu, and the per-monitor sliders with it.
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
        // Lets the Quick Settings arrangement (items.js) recognise it.
        this._item._jhFixesId = 'ddc-brightness';
        this._item.slider.connect('notify::value', () => {
            if (!this._updating)
                this._onMainMoved(this._item.slider.value);
        });
        // A new drag or scroll measures from where the monitors are then.
        this._item.slider.connect('drag-begin', () => (this._mainBase = null));

        this._item.menu.setHeader('display-brightness-symbolic', TITLE);
        this._section = new PopupMenu.PopupMenuSection();
        this._item.menu.addMenuItem(this._section);

        // Right after GNOME's own brightness slider.
        const own = qs._brightness?.quickSettingsItems[0];
        const sibling = own?.get_parent() === qs.menu._grid ? own.get_next_sibling() : null;
        qs.menu.insertItemBefore(this._item, sibling, 2);

        // Another tool may have changed the brightness; check when the menu
        // opens (at most every READ_BACK_INTERVAL_US). With no monitors yet
        // (ddcutil installed or i2c access granted after login, monitor still
        // waking up), look for them again instead, at most every
        // RETRY_DETECT_INTERVAL_US.
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
                // A later _apply() may have started a detection of its own.
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

        // Each monitor is on its own I2C bus, so they can be read at once.
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

        // Monitors that were already known keep their state, so a write
        // that is still running is not started a second time.
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

    // One labelled slider per monitor, in the item's menu. Only offered
    // with more than one monitor, as in GNOME's own item.
    _buildMenu() {
        this._section.removeAll();
        const models = this._displays.map(d => modelOf(d.name));
        this._displays.forEach((display, i) => {
            // Two of the same model: tell them apart by their port.
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

    // Detection is retried on every menu open, so don't repeat the same
    // warning each time.
    _warnOnce(message) {
        if (message !== this._lastWarning)
            console.warn(`jh-fixes: ${message}`);
        this._lastWarning = message;
    }

    // Re-reads every monitor that has no change of ours on the way.
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

    // Where a monitor is, or is about to be: 0..1.
    _levelOf(display) {
        return display.target ?? display.sent / display.max;
    }

    // Puts every slider where its monitor is; the main one on the average.
    _showValues(skipMain = false) {
        this._updating = true;
        try {
            for (const display of this._displays) {
                if (display.slider)
                    display.slider.value = this._levelOf(display);
            }
            if (!skipMain && this._displays.length > 0) {
                const sum = this._displays.reduce((s, d) => s + this._levelOf(d), 0);
                this._item.slider.value = sum / this._displays.length;
            }
        } finally {
            this._updating = false;
        }
    }

    // The main slider: every monitor moves by the same amount, measured
    // from where they were when it started moving.
    _onMainMoved(value) {
        if (!this._mainBase) {
            const sum = this._displays.reduce((s, d) => s + this._levelOf(d), 0);
            this._mainBase = {
                value: this._displays.length ? sum / this._displays.length : value,
                targets: new Map(this._displays.map(d => [d, this._levelOf(d)])),
            };
        }
        const delta = value - this._mainBase.value;
        for (const display of this._displays) {
            const base = this._mainBase.targets.get(display) ?? value;
            // At the ends the main slider wins, so 0 % and 100 % reach
            // every monitor.
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

    // Sends the latest target to one monitor, one call at a time. Stops if
    // the monitor is gone (no longer in this._displays).
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
                    // eslint-disable-next-line no-await-in-loop
                    await Ddc.setBrightness(display.bus, raw, cancellable);
                    display.sent = raw;
                    // Just set, so no need to read it back soon.
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
