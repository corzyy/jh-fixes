// Per-application volume sliders in the sound output menu of Quick Settings, one row
// per app that is currently playing audio.
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

// Volume control apps; they would only list themselves.
const SKIPPED_APPS = new Set([
    'org.gnome.VolumeControl',
    'org.PulseAudio.pavucontrol',
    'com.saivert.pwvucontrol',
]);

const FALLBACK_ICON = 'application-x-executable';
const ICON_SIZE = 24;

// Lowercase alphanumerics only, so "Google Chrome" and "google-chrome" compare equal.
function normalize(text) {
    return (text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Names an app may go by in a stream: display name, desktop id and executable.
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

// Finds the desktop app behind an audio stream: first by the application id the
// stream reports, then by comparing its name with running and installed apps.
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

// The lookup scans every installed app, so remember the result per stream identity.
const appCache = new Map();

function findAppCached(stream) {
    const key = `${stream.application_id ?? ''}\n${stream.name ?? ''}`;
    if (!appCache.has(key))
        appCache.set(key, findApp(stream));
    return appCache.get(key);
}

// Volume (fraction of 100%) used when unmuting a stream whose volume is 0.
const UNMUTE_DEFAULT_VOLUME = 0.25;

export class AppVolumes extends SettingTweak {
    static KEY = 'sound-app-volumes';
    static DEFAULT = false;

    // The sound slider is created lazily after login.
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

    // Insert an "Applications" section into the output slider's menu, below the device list.
    _attach(slider) {
        this._slider = slider;
        this._control = slider._control;
        this._rows = new Map();
        Shell.AppSystem.get_default().connectObject('installed-changed',
            () => appCache.clear(), this);

        this._section = new PopupMenu.PopupMenuSection();
        this._separator = new PopupMenu.PopupSeparatorMenuItem('Applications');
        this._section.addMenuItem(this._separator);
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

    // Remove the section and let the shell recompute whether the menu is enabled.
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

    // Pick up streams that already exist when the mixer becomes ready.
    _addAll() {
        if (this._control.get_state() !== Gvc.MixerControlState.READY)
            return;
        for (const stream of this._control.get_sink_inputs())
            this._addStream(stream.id);
    }

    // Only real application playback streams get a row: no event sounds (system beeps),
    // no virtual streams, no volume control apps.
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

    // A row: mute button with the app icon, and the name above a volume slider.
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

        // Follow the main slider's maximum, so allowing over-amplification applies here too.
        this._slider.slider.bind_property('maximum-value',
            slider, 'maximum-value', GObject.BindingFlags.SYNC_CREATE);

        // Name and icon come from the desktop app when we can find it, else from the stream.
        const updateInfo = () => {
            const app = findAppCached(stream);
            const name = app?.get_name() || stream.name;
            label.text = stream.description && stream.description !== stream.name
                ? `${name} – ${stream.description}`
                : name || stream.description || '';
            icon.gicon = app?.get_icon() ?? stream.get_gicon() ??
                Gio.ThemedIcon.new_with_default_fallbacks(stream.icon_name || FALLBACK_ICON);
        };

        // Volume is shown relative to the "100%" level, not the raw PulseAudio maximum.
        const norm = () => control.get_vol_max_norm();
        const updateVolume = () => {
            slider.block_signal_handler(changedId);
            slider.value = stream.is_muted ? 0 : stream.volume / norm();
            slider.unblock_signal_handler(changedId);
            icon.opacity = stream.is_muted ? 128 : 255;
        };

        // Dragging to zero mutes, dragging up from zero unmutes.
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

        // Unmuting a stream that sits at zero would stay silent; give it a default volume.
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

    // Show the separator only with at least one row; without rows the stock logic decides
    // whether the menu is enabled.
    _syncRows() {
        this._separator.visible = this._rows.size > 0;
        if (this._rows.size > 0)
            this._syncMenuEnabled();
        else
            this._slider._sync();
    }

    // The menu is normally disabled with a single device; with app rows it is useful.
    _syncMenuEnabled() {
        if (this._rows?.size > 0 && !this._slider.menuEnabled)
            this._slider.menuEnabled = true;
    }
}
