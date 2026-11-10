import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {bindNotInList, onChanged} from '../ui/build.js';
import {EXTERNAL_PREFIX, GRID_ITEMS, KEYS, TOP_ROW_BUTTONS} from '../../lib/quickSettingsCatalog.js';

const FALLBACK_ICON = 'application-x-addon-symbolic';
const BACKGROUND_APPS = 'background-apps';
const SYSTRAY_KEY = 'quick-settings-systray';

function switchRow({title, subtitle = '', icon}) {
    const row = new Adw.SwitchRow({title, subtitle, use_markup: false});
    row.add_prefix(new Gtk.Image({icon_name: icon || FALLBACK_ICON}));
    return row;
}

function listGroup(settings, title, keys, items) {
    const group = new Adw.PreferencesGroup({title});
    let rows = [];
    const rebuild = () => {
        rows.forEach(row => group.remove(row));
        const present = new Set(settings.get_strv(KEYS.present));
        const hidden = new Set(settings.get_strv(KEYS.hidden));
        rows = items().filter(item => item.always || present.has(item.id) || hidden.has(item.id))
            .map(item => {
                const row = switchRow(item);
                bindNotInList(settings, KEYS.hidden, item.id, row, 'active');
                return row;
            });
        rows.forEach(row => group.add(row));
    };
    onChanged(settings, [KEYS.present, ...keys], rebuild, group);
    rebuild();
    return group;
}

export function menuItemsGroup(settings) {
    const unpack = key => settings.get_value(key).deepUnpack();
    return listGroup(settings, 'Show in the Menu', [KEYS.known, KEYS.knownIcons], () => {
        const icons = unpack(KEYS.knownIcons);
        const external = Object.entries(unpack(KEYS.known))
            .filter(([id]) => id.startsWith(EXTERNAL_PREFIX))
            .map(([id, title]) => ({id, title, icon: icons[id]}));
        return [...GRID_ITEMS.filter(item => item.id !== BACKGROUND_APPS), ...external];
    });
}

export function topRowGroup(settings) {
    const group = listGroup(settings, 'Show in the Top Row', [], () =>
        TOP_ROW_BUTTONS.map(button => ({...button, always: button.id !== 'button-battery'})));
    const prefs = switchRow({title: 'jh-fixes Settings', icon: FALLBACK_ICON});
    settings.bind(KEYS.prefsButton, prefs, 'active', 0);
    const footer = new Adw.PreferencesGroup();
    footer.add(prefs);
    return [group, footer];
}

const BACKGROUND_MODES = [
    ['off', 'Off'],
    ['gnome', 'GNOME'],
    ['tray', 'jh-fixes'],
];
const BACKGROUND_SUBTITLES = {
    off: 'Hidden from Quick Settings',
    gnome: 'GNOME\'s own list, without tray icons',
    tray: 'jh-fixes list: GNOME\'s apps plus system tray icons',
};

export function backgroundAppsRow({settings}) {
    const row = new Adw.ComboRow({
        title: 'Background apps',
        model: Gtk.StringList.new(BACKGROUND_MODES.map(([, label]) => label)),
    });
    const current = () => {
        if (settings.get_strv(KEYS.hidden).includes(BACKGROUND_APPS))
            return 'off';
        return settings.get_boolean(SYSTRAY_KEY) ? 'tray' : 'gnome';
    };
    const sync = () => {
        const mode = current();
        const index = BACKGROUND_MODES.findIndex(([id]) => id === mode);
        if (row.selected !== index)
            row.selected = index;
        row.subtitle = BACKGROUND_SUBTITLES[mode];
    };
    sync();
    onChanged(settings, [KEYS.hidden, SYSTRAY_KEY], sync, row);
    row.connect('notify::selected', () => {
        const mode = BACKGROUND_MODES[row.selected]?.[0];
        if (!mode || mode === current())
            return;
        const hidden = settings.get_strv(KEYS.hidden).filter(id => id !== BACKGROUND_APPS);
        if (mode === 'off')
            hidden.push(BACKGROUND_APPS);
        settings.set_boolean(SYSTRAY_KEY, mode === 'tray');
        settings.set_strv(KEYS.hidden, hidden);
    });
    return row;
}
