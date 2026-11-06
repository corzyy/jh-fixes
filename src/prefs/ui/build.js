import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

export const toggle = (key, title, subtitle = '', extra = {}) =>
    ({type: 'toggle', key, title, subtitle, ...extra});

export const choice = (key, title, subtitle, choices, extra = {}) =>
    ({type: 'choice', key, title, subtitle, choices, ...extra});

export const toggles = (key, title, subtitle, choices, extra = {}) =>
    ({type: 'toggles', key, title, subtitle, choices, ...extra});

export const number = (key, title, subtitle = '', extra = {}) =>
    ({type: 'number', key, title, subtitle, ...extra});

export const slider = (key, title, subtitle = '', extra = {}) =>
    ({type: 'slider', key, title, subtitle, ...extra});

export const shortcut = (key, title, subtitle = '', extra = {}) =>
    ({type: 'shortcut', key, title, subtitle, ...extra});

export const link = (title, subtitle, page, extra = {}) =>
    ({type: 'link', title, subtitle, page, ...extra});

export const custom = (build, keys = [], extra = {}) =>
    ({type: 'custom', build, keys, ...extra});

export const group = (title, description, rows, extra = {}) =>
    ({type: 'group', title, description, rows, ...extra});

export const section = spec => ({type: 'section', ...spec});

export const customGroups = (build, keys = []) =>
    ({type: 'customGroups', build, keys});

export function onChanged(settings, keys, callback, widget) {
    const ids = [keys].flat().map(key => settings.connect(`changed::${key}`, () => callback()));
    widget.connect('destroy', () => ids.forEach(id => settings.disconnect(id)));
}

const isChanged = (settings, key) =>
    !settings.get_value(key).equal(settings.get_default_value(key));

const defaultOf = (settings, key) => settings.get_default_value(key).deepUnpack();

const typeOf = (settings, key) =>
    settings.settings_schema.get_key(key).get_value_type().dup_string();

function rangeOf(settings, key) {
    const [, range] = settings.settings_schema.get_key(key).get_range().deepUnpack();
    return range.deepUnpack();
}

export function bindNotInList(settings, key, id, obj, prop) {
    const sync = () => {
        const value = !settings.get_strv(key).includes(id);
        if (obj[prop] !== value)
            obj[prop] = value;
    };
    sync();
    onChanged(settings, key, sync, obj);
    obj.connect(`notify::${prop}`, () => {
        const list = new Set(settings.get_strv(key));
        if (obj[prop] === !list.has(id))
            return;
        if (obj[prop])
            list.delete(id);
        else
            list.add(id);
        settings.set_strv(key, [...list]);
    });
}

function conditionKeys(requires) {
    if (!requires)
        return [];
    if (Array.isArray(requires))
        return requires.flatMap(conditionKeys);
    return [typeof requires === 'string' ? requires : requires.key];
}

function holds(settings, requires) {
    if (!requires)
        return true;
    if (Array.isArray(requires))
        return requires.every(r => holds(settings, r));
    if (typeof requires === 'string')
        return settings.get_boolean(requires);
    const value = settings.get_value(requires.key).deepUnpack();
    if ('in' in requires)
        return requires.in.includes(value);
    return 'is' in requires ? value === requires.is : value !== requires.isNot;
}

const andAlso = (a, b) => [a, b].filter(Boolean).flat();

function bindRequires(widget, settings, requires, prop = 'sensitive') {
    if (!requires)
        return;
    const sync = () => (widget[prop] = holds(settings, requires));
    onChanged(settings, conditionKeys(requires), sync, widget);
    sync();
}

function addResetButton(row, settings, keys) {
    const button = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        tooltip_text: 'Back to the default',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat', 'circular', 'jh-reset'],
    });
    const sync = () => (button.visible = keys.some(k => isChanged(settings, k)));
    onChanged(settings, keys, sync, button);
    sync();
    button.connect('clicked', () => keys.forEach(k => settings.reset(k)));
    row.add_suffix(button);
}

function actionRow(d) {
    const row = new Adw.ActionRow({use_markup: false});
    row.set({title: d.title, subtitle: d.subtitle ?? ''});
    return row;
}

function keyRow(d, settings, ...suffixes) {
    const row = actionRow(d);
    addResetButton(row, settings, [d.key]);
    suffixes.forEach(w => row.add_suffix(w));
    return row;
}

function intControl(Widget, d, settings, props) {
    const [lower, upper] = rangeOf(settings, d.key);
    const step = d.step ?? 1;
    const control = new Widget({
        adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 5}),
        valign: Gtk.Align.CENTER,
        ...props,
    });
    const value = () => Math.round(control.get_value());
    const sync = () => {
        const saved = settings.get_int(d.key);
        if (value() !== saved)
            control.set_value(saved);
    };
    sync();
    onChanged(settings, d.key, sync, control);
    control.connect('value-changed', () => {
        if (value() !== settings.get_int(d.key))
            settings.set_int(d.key, value());
    });
    return control;
}

export function buildRow(d, ctx) {
    const row = ROW_BUILDERS[d.type](d, ctx);
    bindRequires(row, ctx.settings, d.requires);
    bindRequires(row, ctx.settings, d.showIf, 'visible');
    return row;
}

const ROW_BUILDERS = {
    toggle(d, ctx) {
        const {settings} = ctx;
        const control = new Gtk.Switch({valign: Gtk.Align.CENTER});
        settings.bind(d.key, control, 'active', 0);

        if (!d.options?.length) {
            const row = keyRow(d, settings, control);
            row.activatable_widget = control;
            return row;
        }

        const row = new Adw.ExpanderRow({title: d.title, subtitle: d.subtitle ?? ''});
        row.add_suffix(control);
        addResetButton(row, settings, [d.key]);
        for (const option of d.options)
            row.add_row(buildRow({...option, requires: andAlso(option.requires, d.key)}, ctx));
        row.expanded = settings.get_boolean(d.key);
        control.connect('notify::active', () => {
            if (control.active)
                row.expanded = true;
        });
        return row;
    },

    choice(d, {settings}) {
        const isInt = typeOf(settings, d.key) === 'i';
        const values = isInt ? d.choices : d.choices.map(([value]) => value);
        const format = d.format ?? (v => `${v}`);
        const fallback = defaultOf(settings, d.key);
        const labels = d.choices.map((c, i) => {
            const label = isInt ? format(c) : c[1];
            return values[i] === fallback ? `${label} (default)` : label;
        });

        const control = new Gtk.DropDown({
            model: Gtk.StringList.new(labels),
            valign: Gtk.Align.CENTER,
        });
        const sync = () => {
            const current = settings.get_value(d.key).deepUnpack();
            let index = values.indexOf(current);
            if (index < 0 && isInt)
                index = Math.max(0, values.findLastIndex(v => v <= current));
            if (index >= 0 && control.selected !== index)
                control.selected = index;
        };
        sync();
        onChanged(settings, d.key, sync, control);
        control.connect('notify::selected', () => {
            const value = values[control.selected];
            if (value === undefined || value === settings.get_value(d.key).deepUnpack())
                return;
            if (isInt)
                settings.set_int(d.key, value);
            else
                settings.set_string(d.key, value);
        });

        const row = keyRow(d, settings, control);
        row.activatable_widget = control;
        return row;
    },

    toggles(d, {settings}) {
        const fallback = defaultOf(settings, d.key);
        const control = new Adw.ToggleGroup({valign: Gtk.Align.CENTER});
        for (const [value, label] of d.choices)
            control.add(new Adw.Toggle({name: value, label, tooltip: value === fallback ? 'Default' : ''}));
        settings.bind(d.key, control, 'active-name', 0);
        return keyRow(d, settings, control);
    },

    number(d, {settings}) {
        const control = intControl(Gtk.SpinButton, d, settings, {numeric: true});
        return d.unit
            ? keyRow(d, settings, control, new Gtk.Label({label: d.unit, css_classes: ['dim-label']}))
            : keyRow(d, settings, control);
    },

    slider(d, {settings}) {
        const control = intControl(Gtk.Scale, d, settings, {
            digits: 0,
            draw_value: true,
            value_pos: Gtk.PositionType.LEFT,
            width_request: 220,
        });
        for (const mark of d.marks ?? [])
            control.add_mark(mark, Gtk.PositionType.BOTTOM, null);
        control.set_format_value_func((_s, v) => `${Math.round(v)}${d.unit ?? ''}`);
        return keyRow(d, settings, control);
    },

    shortcut(d, {settings}) {
        const label = new Gtk.ShortcutLabel({disabled_text: 'Off', valign: Gtk.Align.CENTER});
        const sync = () => (label.accelerator = settings.get_strv(d.key)[0] ?? '');
        sync();
        onChanged(settings, d.key, sync, label);

        const row = keyRow(d, settings, label);
        row.activatable = true;
        row.tooltip_text = 'Click to change';
        row.connect('activated', () => askForShortcut(row, d.title,
            accel => settings.set_strv(d.key, accel ? [accel] : [])));
        return row;
    },

    link(d, ctx) {
        const row = actionRow(d);
        row.activatable = true;
        row.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic'}));
        row.connect('activated', () =>
            ctx.window.push_subpage(buildSubpage(d.page(ctx), ctx)));
        return row;
    },

    custom(d, ctx) {
        return d.build(ctx);
    },
};

const BARE_KEYS = new Set([
    Gdk.KEY_F1, Gdk.KEY_F2, Gdk.KEY_F3, Gdk.KEY_F4, Gdk.KEY_F5, Gdk.KEY_F6,
    Gdk.KEY_F7, Gdk.KEY_F8, Gdk.KEY_F9, Gdk.KEY_F10, Gdk.KEY_F11, Gdk.KEY_F12,
    Gdk.KEY_Print, Gdk.KEY_Pause, Gdk.KEY_Scroll_Lock,
]);

function askForShortcut(parent, title, done) {
    const dialog = new Adw.AlertDialog({
        heading: title,
        body: 'Press the new shortcut.\nEscape cancels, Backspace turns it off.',
    });
    dialog.add_response('cancel', 'Cancel');

    const keys = new Gtk.EventControllerKey({propagation_phase: Gtk.PropagationPhase.CAPTURE});
    keys.connect('key-pressed', (_c, keyval, _keycode, state) => {
        const mods = state & Gtk.accelerator_get_default_mod_mask() & ~Gdk.ModifierType.LOCK_MASK;
        const key = Gdk.keyval_to_lower(keyval);
        if (!mods && key === Gdk.KEY_Escape) {
            dialog.close();
        } else if (!mods && key === Gdk.KEY_BackSpace) {
            done(null);
            dialog.close();
        } else if ((mods || BARE_KEYS.has(key)) && Gtk.accelerator_valid(key, mods)) {
            done(Gtk.accelerator_name(key, mods));
            dialog.close();
        }
        return Gdk.EVENT_STOP;
    });
    dialog.add_controller(keys);
    dialog.present(parent);
}

function keysOf(d) {
    switch (d.type) {
    case 'group':
        return d.rows.flatMap(keysOf);
    case 'section':
        return d.groups.flatMap(keysOf);
    case 'toggle':
        return [d.key, ...(d.options ?? []).flatMap(keysOf)];
    case 'custom':
    case 'customGroups':
        return d.keys;
    case 'link':
        return [];
    default:
        return d.key ? [d.key] : [];
    }
}

function buildGroups(d, ctx) {
    if (d.type === 'customGroups')
        return [d.build(ctx)].flat();
    if (d.type === 'section')
        return [buildSection(d, ctx)];
    const g = new Adw.PreferencesGroup({title: d.title ?? '', description: d.description ?? ''});
    for (const row of d.rows)
        g.add(buildRow(row, ctx));
    bindRequires(g, ctx.settings, d.requires);
    return [g];
}

function sectionNote(description) {
    return new Gtk.ListBoxRow({
        child: new Gtk.Label({
            label: description, xalign: 0, wrap: true,
            css_classes: ['dim-label', 'caption'],
        }),
        activatable: false, selectable: false, css_classes: ['jh-note'],
    });
}

function buildSection(d, ctx) {
    const {settings} = ctx;
    const row = new Adw.ExpanderRow({title: d.title, subtitle: d.description ?? ''});
    if (d.icon)
        row.add_prefix(new Gtk.Image({icon_name: d.icon}));

    for (const g of d.groups) {
        if (g.type !== 'group')
            throw new Error(`jh-fixes: ${g.type} can't go in section ${d.title}`);
        if (g.description) {
            const note = sectionNote(g.description);
            bindRequires(note, settings, g.requires);
            row.add_row(note);
        }
        for (const r of g.rows) {
            const requires = andAlso(r.requires, g.requires);
            row.add_row(buildRow({...r, options: undefined, requires}, ctx));
            for (const option of r.options ?? []) {
                const optionRow = buildRow({
                    ...option, requires: andAlso(option.requires, requires),
                    showIf: andAlso(option.showIf, r.key),
                }, ctx);
                optionRow.add_css_class('jh-option');
                row.add_row(optionRow);
            }
        }
    }

    const keys = [...new Set(keysOf(d))];
    const changed = new Gtk.Label({css_classes: ['dim-label', 'caption'], valign: Gtk.Align.CENTER});
    const sync = () => {
        const n = keys.filter(k => isChanged(settings, k)).length;
        changed.label = `${n} changed`;
        changed.visible = n > 0 && !row.expanded;
    };
    sync();
    onChanged(settings, keys, sync, changed);
    row.connect('notify::expanded', sync);
    row.add_suffix(changed);

    const g = new Adw.PreferencesGroup();
    g.add(row);
    return g;
}

function resetGroup(keys, {settings}) {
    const g = new Adw.PreferencesGroup();
    const button = new Adw.ButtonRow({css_classes: ['destructive-action']});
    const sync = () => {
        const changed = keys.filter(k => isChanged(settings, k)).length;
        button.title = `Reset ${changed} Changed Setting${changed === 1 ? '' : 's'} on This Page`;
        g.visible = changed > 0;
    };
    sync();
    onChanged(settings, keys, sync, button);
    button.connect('activated', () => keys.forEach(k => settings.reset(k)));
    g.add(button);
    return g;
}

function fillPage(page, spec, ctx) {
    for (const g of spec.groups)
        buildGroups(g, ctx).forEach(w => page.add(w));
    const keys = [...new Set(spec.groups.flatMap(keysOf))];
    if (keys.length)
        page.add(resetGroup(keys, ctx));
}

export function buildPage(spec, ctx) {
    addCss('base', CSS);
    const page = new Adw.PreferencesPage({
        title: spec.title,
        icon_name: spec.icon,
        description: spec.description ?? '',
    });
    fillPage(page, spec, ctx);
    return page;
}

function buildSubpage(spec, ctx) {
    const page = new Adw.PreferencesPage({description: spec.description ?? ''});
    fillPage(page, spec, ctx);
    const view = new Adw.ToolbarView({content: page});
    view.add_top_bar(new Adw.HeaderBar());
    return new Adw.NavigationPage({title: spec.title, child: view});
}

const CSS = `
.jh-reset { min-width: 24px; min-height: 24px; padding: 0; opacity: 0.7; }
.jh-reset:hover { opacity: 1; }
.jh-note { padding: 10px 12px; background: none; }
.jh-option { padding-left: 24px; }
`;

export function addCss(name, css) {
    const display = Gdk.Display.get_default();
    if (!display)
        return;
    display._jhFixesCss ??= {};
    let provider = display._jhFixesCss[name];
    if (!provider) {
        provider = display._jhFixesCss[name] = new Gtk.CssProvider();
        Gtk.StyleContext.add_provider_for_display(display, provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    }
    provider.load_from_string(css);
}
