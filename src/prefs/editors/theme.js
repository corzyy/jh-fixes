import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {onChanged} from '../ui/build.js';

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
