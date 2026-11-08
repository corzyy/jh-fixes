import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

import {ACCENT_HEX, PALETTES, paletteColours} from '../../features/appearance/theme/build.js';
import {addCss, bindNotInList, buildRow, number, onChanged, toggles} from '../ui/build.js';

const DISABLED_STYLES_KEY = 'shell-theme-disabled-styles';
export const PALETTE_KEY = 'shell-theme-palette';

const PALETTE_TITLES = {
    darker: 'Darker',
    catppuccin: 'Catppuccin Dark',
    'osaka-jade': 'Osaka Jade',
};
const PALETTE_COLUMNS = 3;

function paletteCss() {
    const rules = Object.keys(PALETTES).map(name => {
        const c = paletteColours(name);
        const p = `.jh-pv-${name}`;
        return `${p} { background-color: ${c.menu}; color: ${c.fg}; }
${p} .jh-pv-panel { background-color: ${c.panel}; }
${p} .jh-pv-tile { background-color: ${c.surface}; }
${p} .jh-pv-track { background-color: ${c.surface}; }
${p} .jh-pv-text { background-color: ${c.fg}; }
${p} .jh-pv-dim { background-color: ${c.overlay}; }${c.accent ? `
${p} .jh-pv-on, ${p} .jh-pv-fill { background-color: ${c.accent}; }` : ''}`;
    });
    return `
.jh-theme-card { padding: 10px; border-radius: 22px; }
.jh-theme-card:checked { box-shadow: inset 0 0 0 3px var(--accent-bg-color); background: none; }
.jh-pv { border-radius: 14px; min-height: 132px; }
.jh-pv-panel { min-height: 12px; border-radius: 14px 14px 0 0; }
.jh-pv-body { padding: 14px 16px 16px; }
.jh-pv-tile { min-height: 26px; border-radius: 13px; }
.jh-pv-tile.jh-pv-on { background-color: var(--accent-bg-color); }
.jh-pv-track { min-height: 8px; border-radius: 4px; }
.jh-pv-fill { min-height: 8px; border-radius: 4px; background-color: var(--accent-bg-color); }
.jh-pv-text { min-height: 5px; border-radius: 3px; opacity: 0.85; }
.jh-pv-dim { min-height: 5px; border-radius: 3px; }
${rules.join('\n')}
`;
}

function palettePreview(name) {
    const box = (props, children = []) => {
        const b = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, ...props});
        children.forEach(c => b.append(c));
        return b;
    };
    const bar = (cls, width = -1) => new Gtk.Box({css_classes: [cls], width_request: width});

    const tiles = new Gtk.Box({spacing: 8, homogeneous: true});
    tiles.append(bar('jh-pv-tile'));
    const on = bar('jh-pv-tile');
    on.add_css_class('jh-pv-on');
    tiles.append(on);

    const slider = new Gtk.Overlay({child: bar('jh-pv-track')});
    const fill = bar('jh-pv-fill');
    fill.halign = Gtk.Align.START;
    slider.add_overlay(fill);
    fill.width_request = 60;

    const text = bar('jh-pv-text');
    text.halign = Gtk.Align.START;
    text.width_request = 70;
    const dim = bar('jh-pv-dim');
    dim.halign = Gtk.Align.START;
    dim.width_request = 45;

    return box({css_classes: ['jh-pv', `jh-pv-${name}`], overflow: Gtk.Overflow.HIDDEN}, [
        bar('jh-pv-panel'),
        box({css_classes: ['jh-pv-body'], spacing: 10, vexpand: true}, [tiles, slider, text, dim]),
    ]);
}

const ACCENT_KEY = 'accent-color';

function accentRow() {
    const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    addCss('accents', `
.jh-accent { min-width: 28px; min-height: 28px; padding: 0; border-radius: 999px; }
.jh-accent image { opacity: 0; color: white; }
.jh-accent:checked image { opacity: 1; }
.jh-accent:checked { box-shadow: 0 0 0 2px var(--window-bg-color), 0 0 0 4px var(--accent-bg-color); }
${Object.entries(ACCENT_HEX).map(([name, hex]) =>
        `.jh-accent-${name}, .jh-accent-${name}:hover, .jh-accent-${name}:checked { background-color: ${hex}; }`).join('\n')}
`);
    const row = new Adw.ActionRow({title: 'Accent colour'});
    const box = new Gtk.Box({spacing: 12, valign: Gtk.Align.CENTER, margin_top: 10, margin_bottom: 10});
    const buttons = new Map();
    let first = null;
    for (const name of Object.keys(ACCENT_HEX)) {
        const button = new Gtk.ToggleButton({
            child: new Gtk.Image({icon_name: 'object-select-symbolic', pixel_size: 14}),
            css_classes: ['jh-accent', `jh-accent-${name}`],
            tooltip_text: name[0].toUpperCase() + name.slice(1),
            valign: Gtk.Align.CENTER,
        });
        if (first)
            button.set_group(first);
        else
            first = button;
        button.connect('toggled', () => {
            if (button.active && iface.get_string(ACCENT_KEY) !== name)
                iface.set_string(ACCENT_KEY, name);
        });
        buttons.set(name, button);
        box.append(button);
    }
    const sync = () => {
        const button = buttons.get(iface.get_string(ACCENT_KEY));
        if (button && !button.active)
            button.active = true;
    };
    sync();
    onChanged(iface, ACCENT_KEY, sync, row);
    row.add_suffix(box);
    return row;
}

export function paletteGrid({settings}) {
    addCss('palettes', paletteCss());
    const grid = new Gtk.Grid({
        column_spacing: 16, row_spacing: 16, column_homogeneous: true,
    });
    const fallback = settings.get_default_value(PALETTE_KEY).deepUnpack();
    const buttons = new Map();
    let first = null;
    Object.keys(PALETTES).forEach((name, i) => {
        const title = PALETTE_TITLES[name] ?? name;
        const content = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 10});
        content.append(palettePreview(name));
        content.append(new Gtk.Label({
            label: name === fallback ? `${title} (default)` : title,
            ellipsize: Pango.EllipsizeMode.END,
            margin_bottom: 2,
        }));
        const button = new Gtk.ToggleButton({
            child: content,
            css_classes: ['flat', 'jh-theme-card'],
            tooltip_text: title,
        });
        if (first)
            button.set_group(first);
        else
            first = button;
        button.connect('toggled', () => {
            if (button.active && settings.get_string(PALETTE_KEY) !== name)
                settings.set_string(PALETTE_KEY, name);
        });
        buttons.set(name, button);
        grid.attach(button, i % PALETTE_COLUMNS, Math.floor(i / PALETTE_COLUMNS), 1, 1);
    });
    const sync = () => {
        const button = buttons.get(settings.get_string(PALETTE_KEY)) ?? buttons.get(fallback);
        if (button && !button.active)
            button.active = true;
    };
    sync();
    onChanged(settings, PALETTE_KEY, sync, grid);

    const accents = new Gtk.ListBox({
        css_classes: ['boxed-list'],
        selection_mode: Gtk.SelectionMode.NONE,
    });
    accents.append(accentRow());
    const syncAccents = () => (accents.visible = settings.get_string(PALETTE_KEY) === 'darker');
    syncAccents();
    onChanged(settings, PALETTE_KEY, syncAccents, accents);

    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 18});
    box.append(grid);
    box.append(accents);
    return box;
}

export const STYLES = [
    {id: 'sliders', title: 'Sliders', options: [
        number('shell-theme-slider-height', 'Quick Settings slider thickness', {unit: 'px'}),
    ]},
    {id: 'menus', title: 'Popup menus', options: [
        number('shell-theme-menu-shadow', 'Shadow strength', {unit: '%', step: 5}),
    ]},
    {id: 'dash', title: 'Dash', options: [
        toggles('shell-theme-dash-style', 'Theme', [['umbra', 'Umbra'], ['gnome', 'GNOME']]),
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
