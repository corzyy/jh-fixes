import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {bindNotInList, onChanged} from '../ui/build.js';

const deviceKeys = kind => ({
    known: `known-${kind}-devices`,
    names: `${kind}-device-names`,
    hidden: `hidden-${kind}-devices`,
});

export function deviceGroup(settings, kind) {
    const keys = deviceKeys(kind);
    const group = new Adw.PreferencesGroup({
        title: 'Devices',
    });

    let rows = [];
    const rebuild = () => {
        rows.forEach(row => group.remove(row));
        rows = [];

        const known = Object.entries(settings.get_value(keys.known).deepUnpack())
            .sort(([, a], [, b]) => a.localeCompare(b));
        if (known.length === 0) {
            rows.push(new Adw.ActionRow({
                title: 'No devices seen yet',
                subtitle: 'They show up here once jh-fixes has been running with them plugged in.',
            }));
        }
        for (const [key, label] of known)
            rows.push(deviceRow(settings, keys, key, label));
        rows.forEach(row => group.add(row));
    };
    onChanged(settings, keys.known, rebuild, group);
    rebuild();
    return group;
}

function deviceRow(settings, keys, key, label) {
    const getMap = k => settings.get_value(k).deepUnpack();
    const setMap = (k, map) => settings.set_value(k, new GLib.Variant('a{ss}', map));

    const row = new Adw.EntryRow({
        title: label,
        text: getMap(keys.names)[key] ?? '',
        show_apply_button: true,
    });
    onChanged(settings, keys.names, () => {
        if (!row.get_focus_child())
            row.text = getMap(keys.names)[key] ?? '';
    }, row);
    row.connect('apply', () => {
        const names = getMap(keys.names);
        const text = row.text.trim();
        if (text)
            names[key] = text;
        else
            delete names[key];
        setMap(keys.names, names);
    });

    const shown = new Gtk.Switch({valign: Gtk.Align.CENTER, tooltip_text: 'Show in the menu'});
    bindNotInList(settings, keys.hidden, key, shown, 'active');
    row.add_suffix(shown);

    const forget = new Gtk.Button({
        icon_name: 'user-trash-symbolic',
        valign: Gtk.Align.CENTER,
        tooltip_text: 'Forget this device and its name',
        css_classes: ['flat'],
    });
    forget.connect('clicked', () => {
        const names = getMap(keys.names);
        delete names[key];
        setMap(keys.names, names);
        settings.set_strv(keys.hidden, settings.get_strv(keys.hidden).filter(k => k !== key));
        const known = getMap(keys.known);
        delete known[key];
        setMap(keys.known, known);
    });
    row.add_suffix(forget);
    return row;
}
