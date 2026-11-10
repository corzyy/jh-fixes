// Row to clear the launcher history.
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {onChanged} from '../ui/build.js';

const HISTORY_KEY = 'launcher-history';

export function launcherHistory({settings}) {
    const row = new Adw.ActionRow({title: 'History'});
    const button = new Gtk.Button({
        label: 'Clear',
        valign: Gtk.Align.CENTER,
        css_classes: ['destructive-action'],
    });
    const sync = () => {
        const n = settings.get_strv(HISTORY_KEY).length;
        row.subtitle = n ? `${n} recently opened item${n === 1 ? '' : 's'}` : 'Empty';
        button.sensitive = n > 0;
    };
    sync();
    onChanged(settings, HISTORY_KEY, sync, row);
    button.connect('clicked', () => settings.reset(HISTORY_KEY));
    row.add_suffix(button);
    return row;
}
