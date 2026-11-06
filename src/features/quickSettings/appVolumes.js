// Per-application volume sliders in the Quick Settings "Sound Output" menu.
//
// Every app playing sound has a Gvc.MixerSinkInput stream on the shared
// MixerControl (ui/status/volume.js, getMixerControl). Each one gets a row
// with the app's icon (click to mute), its name and a slider, in a section
// below the device list.
//
// GNOME only enables the menu arrow with more than one output device, and
// OutputDevices (soundDevices.js) recomputes that after hiding devices. Rather
// than chain onto those, this watches menu-enabled and turns it back on
// while there are apps to show; once they are gone, slider._sync() lets the
// others decide again.
//
// Streams rarely carry a usable app id (PipeWire only passes on
// application.id, which most apps never set) and their icon names are often
// generic, so findApp() matches them to an installed app instead.
//
// No GObject subclasses here, so nothing needs a per-load GTypeName.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gvc from 'gi://Gvc';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {whenReady} from '../../lib/shell.js';
import {SettingTweak} from '../../lib/tweak.js';

// Mixer apps show up as playing while they show levels; leave them out, as
// GNOME does for the input slider.
const SKIPPED_APPS = new Set([
    'org.gnome.VolumeControl',
    'org.PulseAudio.pavucontrol',
    'com.saivert.pwvucontrol',
]);

const FALLBACK_ICON = 'application-x-executable';
const ICON_SIZE = 24;

/**
 * @param {string} text - an app name, id or binary
 * @returns {string} lower case letters and digits only, for loose matching
 */
function normalize(text) {
    return (text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * @param {Shell.App} app - an app
 * @returns {string[]} normalized names it can go by: its name, the last part
 *   of its id (org.vinegarhq.Sober -> sober) and its executable
 */
function appNames(app) {
    const info = app.get_app_info();
    const id = app.get_id()?.replace(/\.desktop$/, '') ?? '';
    const exec = info?.get_executable();
    return [
        app.get_name(),
        id,
        id.split('.').pop(),
        exec ? GLib.path_get_basename(exec) : '',
    ].map(normalize).filter(Boolean);
}

/**
 * Finds the installed app behind a playback stream: by its app id if it has
 * one, then by its app name against running apps (most likely the one
 * playing), then against all installed apps.
 *
 * @param {Gvc.MixerStream} stream - a sink input
 * @returns {Shell.App|null}
 */
function findApp(stream) {
    const appSystem = Shell.AppSystem.get_default();
    const id = stream.application_id;
    if (id) {
        const app = appSystem.lookup_app(`${id}.desktop`) ??
            appSystem.lookup_desktop_wmclass(id);
        if (app)
            return app;
    }

    const wanted = normalize(stream.name);
    if (!wanted)
        return null;
    const matches = app => appNames(app).includes(wanted);
    return appSystem.get_running().find(matches) ??
        appSystem.get_installed()
            .filter(info => info.should_show())
            .map(info => appSystem.lookup_app(info.get_id()))
            .find(app => app && matches(app)) ??
        null;
}

// findApp() walks every installed app, and players change a stream's
// description with each track or tab, so answers are kept per id and name
// until the installed apps change.
const appCache = new Map();

function findAppCached(stream) {
    const key = `${stream.application_id ?? ''}\n${stream.name ?? ''}`;
    if (!appCache.has(key))
        appCache.set(key, findApp(stream));
    return appCache.get(key);
}

const UNMUTE_DEFAULT_VOLUME = 0.25;   // same as GNOME's own sliders

export class AppVolumes extends SettingTweak {
    static KEY = 'sound-app-volumes';
    static DEFAULT = false;

    _apply() {
        this._cancelWait = whenReady(
            () => Main.panel.statusArea.quickSettings?._volumeOutput?._output,
            slider => this._attach(slider),
            'sound output slider');
    }

    _revert() {
        this._cancelWait?.();
        this._cancelWait = null;
        this._detach();
    }

    _attach(slider) {
        this._slider = slider;
        this._control = slider._control;
        this._rows = new Map();   // stream id -> {item, stream}
        Shell.AppSystem.get_default().connectObject('installed-changed',
            () => appCache.clear(), this);

        this._section = new PopupMenu.PopupMenuSection();
        this._separator = new PopupMenu.PopupSeparatorMenuItem('Applications');
        this._section.addMenuItem(this._separator);
        // Item 0 is GNOME's device section; go right after it, above the
        // separator and "Sound Settings".
        slider.menu.addMenuItem(this._section, 1);

        this._control.connectObject(
            'stream-added', (_c, id) => this._addStream(id),
            'stream-removed', (_c, id) => this._removeStream(id),
            'state-changed', () => this._addAll(),
            this);
        slider.connectObject('notify::menu-enabled',
            () => this._syncMenuEnabled(), this);

        this._addAll();
    }

    _detach() {
        const slider = this._slider;
        if (!slider)
            return;

        this._control.disconnectObject(this);
        slider.disconnectObject(this);
        Shell.AppSystem.get_default().disconnectObject(this);
        appCache.clear();
        for (const {stream} of this._rows.values())
            stream.disconnectObject(this);
        this._rows = null;
        this._section.destroy();
        this._section = this._separator = null;
        this._slider = this._control = null;

        slider._sync();
    }

    _addAll() {
        if (this._control.get_state() !== Gvc.MixerControlState.READY)
            return;
        for (const stream of this._control.get_sink_inputs())
            this._addStream(stream.id);
    }

    _addStream(id) {
        if (this._rows.has(id))
            return;
        const stream = this._control.lookup_stream_id(id);
        if (!(stream instanceof Gvc.MixerSinkInput) ||
            stream.is_event_stream || stream.is_virtual ||
            SKIPPED_APPS.has(stream.application_id))
            return;

        const item = this._makeRow(stream);
        this._section.addMenuItem(item);
        this._rows.set(id, {item, stream});
        this._syncRows();
    }

    _removeStream(id) {
        const row = this._rows.get(id);
        if (!row)
            return;
        row.stream.disconnectObject(this);
        row.item.destroy();
        this._rows.delete(id);
        this._syncRows();
    }

    _makeRow(stream) {
        const control = this._control;
        const item = new PopupMenu.PopupBaseMenuItem({
            activate: false,
            can_focus: false,
            style_class: 'jh-fixes-app-volume',
        });

        const icon = new St.Icon({icon_size: ICON_SIZE});
        const muteButton = new St.Button({
            child: icon,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'button flat',
            style: 'padding: 6px; border-radius: 99px;',
        });
        item.add_child(muteButton);

        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        const label = new St.Label({style: 'font-size: smaller;'});
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        const slider = new Slider(0);
        slider.accessible_name = stream.name;
        box.add_child(label);
        box.add_child(slider);
        item.add_child(box);

        // Follow GNOME's "Over-Amplification" setting like the main slider.
        this._slider.slider.bind_property('maximum-value',
            slider, 'maximum-value', GObject.BindingFlags.SYNC_CREATE);

        const updateInfo = () => {
            const app = findAppCached(stream);
            const name = app?.get_name() || stream.name;
            label.text = stream.description && stream.description !== stream.name
                ? `${name} – ${stream.description}`
                : name || stream.description || '';
            icon.gicon = app?.get_icon() ?? stream.get_gicon() ??
                Gio.ThemedIcon.new_with_default_fallbacks(stream.icon_name || FALLBACK_ICON);
        };

        const norm = () => control.get_vol_max_norm();
        const updateVolume = () => {
            slider.block_signal_handler(changedId);
            slider.value = stream.is_muted ? 0 : stream.volume / norm();
            slider.unblock_signal_handler(changedId);
            icon.opacity = stream.is_muted ? 128 : 255;
        };

        const changedId = slider.connect('notify::value', () => {
            const volume = slider.value * norm();
            const wasMuted = stream.is_muted;
            let changed;
            if (volume < 1) {
                changed = stream.set_volume(0);
                if (!wasMuted)
                    stream.change_is_muted(true);
            } else {
                changed = stream.set_volume(volume);
                if (wasMuted)
                    stream.change_is_muted(false);
            }
            if (changed)
                stream.push_volume();
        });

        muteButton.connect('clicked', () => {
            const {is_muted: muted} = stream;
            if (muted && stream.volume === 0) {
                stream.volume = UNMUTE_DEFAULT_VOLUME * norm();
                stream.push_volume();
            }
            stream.change_is_muted(!muted);
        });

        stream.connectObject(
            'notify::volume', updateVolume,
            'notify::is-muted', updateVolume,
            'notify::name', updateInfo,
            'notify::description', updateInfo,
            'notify::icon-name', updateInfo,
            this);
        updateInfo();
        updateVolume();
        return item;
    }

    _syncRows() {
        this._separator.visible = this._rows.size > 0;
        if (this._rows.size > 0)
            this._syncMenuEnabled();
        else
            this._slider._sync();   // let GNOME and OutputDevices decide again
    }

    _syncMenuEnabled() {
        if (this._rows?.size > 0 && !this._slider.menuEnabled)
            this._slider.menuEnabled = true;
    }
}
