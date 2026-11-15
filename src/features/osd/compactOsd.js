import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {OsdWindow, OsdWindowManager} from 'resource:///org/gnome/shell/ui/osdWindow.js';

import {SettingTweak} from '../../lib/tweak.js';

const STYLE_CLASS = 'jh-osd-compact';
const CSS = Gio.File.new_for_uri(
    GLib.uri_resolve_relative(import.meta.url, 'osd.css', GLib.UriFlags.NONE));

// Windows slides its OSD up a little while it fades in, and back down on the way out.
const SLIDE_DISTANCE = 12;
const SLIDE_TIME = 160;

const theme = () => St.ThemeContext.get_for_stage(global.stage).get_theme();
const scaleFactor = () => St.ThemeContext.get_for_stage(global.stage).scale_factor;
const osdWindows = () => (Main.osdWindowManager?._osdWindows ?? []).filter(Boolean);

// A Windows 11 style OSD: one slim pill with the icon, an accent coloured bar and
// the value as a number. Messages without a level (Caps Lock, airplane mode, ...)
// keep their label, so they become a pill with an icon and some text.
export class CompactOsd extends SettingTweak {
    static KEY = 'osd-style';
    static DEFAULT = 'gnome';

    _sync() {
        const wanted = this._settings.get_string(this.constructor.KEY) !== this.constructor.DEFAULT;
        if (wanted !== this._applied)
            this._setApplied(wanted);
    }

    _apply() {
        theme().load_stylesheet(CSS);

        const decorate = win => this._decorate(win);
        const sync = win => this._syncWindow(win);

        this._injections.overrideMethod(OsdWindowManager.prototype, '_monitorsChanged', original =>
            function (...args) {
                original.apply(this, args);
                this._osdWindows.filter(Boolean).forEach(decorate);
            });
        this._injections.overrideMethod(OsdWindow.prototype, 'setLabel', original =>
            function (label) {
                this._jhHasLabel = label != null;
                original.call(this, label);
                sync(this);
            });
        this._injections.overrideMethod(OsdWindow.prototype, 'setLevel', original =>
            function (value) {
                original.call(this, value);
                sync(this);
            });
        this._injections.overrideMethod(OsdWindow.prototype, 'show', original =>
            function () {
                const appearing = !this.visible && this._icon.gicon;
                original.call(this);
                if (!appearing || !this._jhValue)
                    return;
                this.translation_y = SLIDE_DISTANCE * scaleFactor();
                this.ease_property('translation-y', 0, {
                    duration: SLIDE_TIME,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
            });
        this._injections.overrideMethod(OsdWindow.prototype, '_hide', original =>
            function () {
                original.call(this);
                if (!this._jhValue)
                    return;
                this.ease_property('translation-y', SLIDE_DISTANCE * scaleFactor(), {
                    duration: SLIDE_TIME,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                });
            });

        osdWindows().forEach(decorate);
    }

    _revert() {
        osdWindows().forEach(win => this._undecorate(win));
        try {
            theme().unload_stylesheet(CSS);
        } catch {}
    }

    _decorate(win) {
        if (win._jhValue)
            return;
        win._jhHasLabel ??= win._label.visible;
        win._hbox.add_style_class_name(STYLE_CLASS);

        const value = new St.Label({
            style_class: 'jh-osd-value',
            y_align: Clutter.ActorAlign.CENTER,
        });
        win._hbox.add_child(value);
        win._jhValue = value;

        // The bar eases to its new value, so follow it to count along.
        win._level.connectObject('notify::value', () => this._syncValue(win), this);
        this._syncWindow(win);
    }

    _undecorate(win) {
        if (!win._jhValue)
            return;
        win._level.disconnectObject(this);
        win._jhValue.destroy();
        win._jhValue = null;
        win._hbox.remove_style_class_name(STYLE_CLASS);
        win.translation_y = 0;
        win._label.visible = win._jhHasLabel;
        win._updateBoxVisibility();
    }

    _syncWindow(win) {
        if (!win._jhValue)
            return;
        // Windows names neither the device nor the setting next to a level.
        const hasLevel = win._level.visible;
        win._label.visible = win._jhHasLabel && !hasLevel;
        win._jhValue.visible = hasLevel;
        win._updateBoxVisibility();
        this._syncValue(win);
    }

    _syncValue(win) {
        if (win._jhValue?.visible)
            win._jhValue.text = `${Math.round(win._level.value * 100)}`;
    }
}
