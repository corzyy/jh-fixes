import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import {bindNotInList, buildRow, number, onChanged, toggles} from '../ui/build.js';

const DISABLED_STYLES_KEY = 'shell-theme-disabled-styles';

export const STYLES = [
    {id: 'sliders', title: 'Sliders', options: [
        number('shell-theme-slider-height', 'Quick Settings slider thickness', '', {unit: 'px'}),
    ]},
    {id: 'menus', title: 'Popup menus', options: [
        number('shell-theme-menu-shadow', 'Shadow strength', '', {unit: '%', step: 5}),
    ]},
    {id: 'dash', title: 'Dash', options: [
        toggles('shell-theme-dash-style', 'Theme', '', [['umbra', 'Umbra'], ['gnome', 'GNOME']]),
    ]},
];

export const STYLE_KEYS = [
    DISABLED_STYLES_KEY,
    ...STYLES.flatMap(s => s.options.map(o => o.key)),
];

export function styleRow(style, ctx) {
    const {settings} = ctx;
    const control = new Gtk.Switch({valign: Gtk.Align.CENTER});
    bindNotInList(settings, DISABLED_STYLES_KEY, style.id, control, 'active');

    if (!style.options.length) {
        const row = new Adw.ActionRow({title: style.title});
        row.add_suffix(control);
        row.activatable_widget = control;
        return row;
    }
    const row = new Adw.ExpanderRow({title: style.title});
    row.add_suffix(control);
    for (const option of style.options) {
        const optionRow = buildRow(option, ctx);
        control.bind_property('active', optionRow, 'sensitive', GObject.BindingFlags.SYNC_CREATE);
        row.add_row(optionRow);
    }
    return row;
}

const USER_THEMES = 'user-theme@gnome-shell-extensions.gcampax.github.com';

export function userThemesWarning() {
    const shellSettings = new Gio.Settings({schema_id: 'org.gnome.shell'});
    const row = new Adw.ActionRow({
        title: 'The User Themes extension is on',
    });
    row.add_prefix(new Gtk.Image({icon_name: 'dialog-warning-symbolic'}));
    const button = new Gtk.Button({label: 'Turn It Off', valign: Gtk.Align.CENTER});
    button.connect('clicked', () => {
        Gio.DBus.session.call('org.gnome.Shell.Extensions', '/org/gnome/Shell/Extensions',
            'org.gnome.Shell.Extensions', 'DisableExtension',
            new GLib.Variant('(s)', [USER_THEMES]), null, Gio.DBusCallFlags.NONE, -1, null)
            .catch(logError);
    });
    row.add_suffix(button);

    const sync = () => {
        row.visible = shellSettings.get_strv('enabled-extensions').includes(USER_THEMES);
    };
    onChanged(shellSettings, 'enabled-extensions', sync, row);
    sync();
    return row;
}
