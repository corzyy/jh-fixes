// Builds the preferences from plain descriptions.
//
// A page (src/prefs/pages/) is an object: a title, an icon, a sentence
// about it, and groups of rows. Rows are made with the small functions
// below, toggle(), choice(), number() and so on, each naming its settings
// key, a title and a subtitle. This file turns that into libadwaita widgets
// bound to the settings, so the pages only say *what* there is.
//
// Every row that has a key gets, for free:
//   - a reset button (↺) that shows up once the value is not the default;
//   - "(default)" next to the default choice in drop-downs;
//   - `requires`: greyed out until another setting allows it, e.g.
//     requires: 'dash-visible', or {key: 'x', isNot: 'never'}, or
//     {key: 'x', in: ['a', 'b']};
//   - `showIf`: the same kind of condition, but the row is hidden rather
//     than greyed out while it doesn't hold;
//   - a place in the page's "Reset" button at the bottom.
//
// A toggle with `options` becomes an expandable row: its options sit
// inside, and only apply while it is on.
//
// A page can also hold sections (section()): whole areas described like
// pages, shown as rows that fold open, with the area's groups inside under
// a note where a group has a description.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

// ---- Descriptions ----

/**
 * An on/off switch for a boolean key.
 *
 * @param {string} key - boolean key
 * @param {string} title - what it is
 * @param {string} [subtitle] - what it does
 * @param {object} [extra] - options: rows inside, only active while on;
 *   requires: see the top of the file
 * @returns {object}
 */
export const toggle = (key, title, subtitle = '', extra = {}) =>
    ({type: 'toggle', key, title, subtitle, ...extra});

/**
 * A drop-down for a string key (choices are [value, label]) or an int key
 * (choices are numbers, labelled by extra.format).
 *
 * @returns {object}
 */
export const choice = (key, title, subtitle, choices, extra = {}) =>
    ({type: 'choice', key, title, subtitle, choices, ...extra});

/**
 * Buttons next to each other, one per choice, for a string key with a few
 * choices ([value, label] pairs). The default one is marked in its tooltip.
 *
 * @returns {object}
 */
export const toggles = (key, title, subtitle, choices, extra = {}) =>
    ({type: 'toggles', key, title, subtitle, choices, ...extra});

/**
 * A number entry with +/- for an int key, within the key's range.
 * extra.unit is shown after it, extra.step is the +/- step.
 *
 * @returns {object}
 */
export const number = (key, title, subtitle = '', extra = {}) =>
    ({type: 'number', key, title, subtitle, ...extra});

/**
 * A slider for an int key, within the key's range. extra.marks are values
 * to mark below it, extra.unit is shown after the value.
 *
 * @returns {object}
 */
export const slider = (key, title, subtitle = '', extra = {}) =>
    ({type: 'slider', key, title, subtitle, ...extra});

/**
 * A text entry for a string key, saved with Enter or the ✓ button.
 * extra.preview(text) returns a line shown next to it while typing (null
 * hides it); extra.presets are [value, label] pairs to pick from.
 *
 * @returns {object}
 */
export const text = (key, title, extra = {}) =>
    ({type: 'text', key, title, ...extra});

/**
 * A keyboard shortcut, for a string list key read by the window manager.
 *
 * @returns {object}
 */
export const shortcut = (key, title, subtitle = '', extra = {}) =>
    ({type: 'shortcut', key, title, subtitle, ...extra});

/**
 * A row that opens a page of its own, described like a page.
 *
 * @param {string} title - row and page title
 * @param {string} subtitle - what is on that page
 * @param {(ctx: object) => object} page - returns the page's description
 * @param {object} [extra] - requires
 * @returns {object}
 */
export const link = (title, subtitle, page, extra = {}) =>
    ({type: 'link', title, subtitle, page, ...extra});

/**
 * A row made by hand. build(ctx) returns the row; keys are the settings it
 * changes, for the page's reset button.
 *
 * @returns {object}
 */
export const custom = (build, keys = [], extra = {}) =>
    ({type: 'custom', build, keys, ...extra});

/**
 * A group of rows under a heading.
 *
 * @param {string} title - heading, may be empty
 * @param {string} description - a line under the heading, may be empty
 * @param {object[]} rows - row descriptions
 * @param {object} [extra] - requires
 * @returns {object}
 */
export const group = (title, description, rows, extra = {}) =>
    ({type: 'group', title, description, rows, ...extra});

/**
 * A fold-open section of a page holding a whole area, described like a page
 * ({title, icon, description, groups}). Its groups' rows follow each other
 * without the group titles; a group's description stays as a note above
 * its rows. Groups made by hand (customGroups) can't go in a section.
 *
 * @param {object} spec - the area
 * @returns {object}
 */
export const section = spec => ({type: 'section', ...spec});

/**
 * Whole groups made by hand. build(ctx) returns Adw.PreferencesGroups.
 *
 * @returns {object}
 */
export const customGroups = (build, keys = []) =>
    ({type: 'customGroups', build, keys});

// ---- Settings helpers ----

/**
 * Calls callback whenever one of the keys changes, until widget is
 * destroyed. Prefs windows come and go while the settings object (and the
 * prefs process) lives on, so handlers must not outlive their widgets.
 *
 * @param {Gio.Settings} settings - the settings
 * @param {string|string[]} keys - the key(s) to watch
 * @param {() => void} callback - called on every change
 * @param {Gtk.Widget} widget - the widget the handler belongs to
 */
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

/**
 * Binds a boolean property of obj to "id is NOT in the string list key",
 * for lists of hidden or switched-off things.
 *
 * @param {Gio.Settings} settings - the settings
 * @param {string} key - string list key
 * @param {string} id - the entry obj controls
 * @param {GObject.Object} obj - the widget
 * @param {string} prop - its boolean property, e.g. 'active'
 */
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

// ---- Conditions ----

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

// A row inside a toggle's options also needs the toggle to be on.
const andAlso = (a, b) => [a, b].filter(Boolean).flat();

function bindRequires(widget, settings, requires, prop = 'sensitive') {
    if (!requires)
        return;
    const sync = () => (widget[prop] = holds(settings, requires));
    onChanged(settings, conditionKeys(requires), sync, widget);
    sync();
}

// ---- Rows ----

// The ↺ button, shown while any of the keys is not at its default.
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
    // Markup off before the text goes in, so "&" and "<" show as they are.
    const row = new Adw.ActionRow({use_markup: false});
    row.set({title: d.title, subtitle: d.subtitle ?? ''});
    return row;
}

/**
 * Builds one row from its description.
 *
 * @param {object} d - row description
 * @param {object} ctx - {settings, window}
 * @returns {Gtk.Widget}
 */
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
            const row = actionRow(d);
            addResetButton(row, settings, [d.key]);
            row.add_suffix(control);
            row.activatable_widget = control;
            return row;
        }

        // On/off, with its options inside. They only apply while it is on.
        // An expander row stacks its suffixes the other way round, so the
        // switch goes in first to end up right of the reset button.
        const row = new Adw.ExpanderRow({title: d.title, subtitle: d.subtitle ?? ''});
        row.add_suffix(control);
        addResetButton(row, settings, [d.key]);
        for (const option of d.options)
            row.add_row(buildRow({...option, requires: andAlso(option.requires, d.key)}, ctx));
        // Opens with its options showing while it is on, and turning it on
        // shows them.
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
        const labels = isInt
            ? d.choices.map(v => format(v))
            : d.choices.map(([, label]) => label);
        const marked = labels.map((label, i) =>
            (values[i] === fallback ? `${label} (default)` : label));

        const control = new Gtk.DropDown({
            model: Gtk.StringList.new(marked),
            valign: Gtk.Align.CENTER,
        });
        const sync = () => {
            const current = settings.get_value(d.key).deepUnpack();
            let index = values.indexOf(current);
            // An int that is not a choice: the largest choice below it.
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

        const row = actionRow(d);
        addResetButton(row, settings, [d.key]);
        row.add_suffix(control);
        row.activatable_widget = control;
        return row;
    },

    toggles(d, {settings}) {
        const fallback = defaultOf(settings, d.key);
        const control = new Adw.ToggleGroup({valign: Gtk.Align.CENTER});
        for (const [value, label] of d.choices) {
            control.add(new Adw.Toggle({
                name: value, label,
                tooltip: value === fallback ? 'Default' : '',
            }));
        }
        settings.bind(d.key, control, 'active-name', 0);

        const row = actionRow(d);
        addResetButton(row, settings, [d.key]);
        row.add_suffix(control);
        return row;
    },

    number(d, {settings}) {
        const [lower, upper] = rangeOf(settings, d.key);
        const step = d.step ?? 1;
        const control = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower, upper, step_increment: step, page_increment: step * 5,
            }),
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        const sync = () => {
            const value = settings.get_int(d.key);
            if (control.get_value_as_int() !== value)
                control.value = value;
        };
        sync();
        onChanged(settings, d.key, sync, control);
        control.connect('value-changed', () => {
            const value = control.get_value_as_int();
            if (value !== settings.get_int(d.key))
                settings.set_int(d.key, value);
        });

        const row = actionRow(d);
        addResetButton(row, settings, [d.key]);
        row.add_suffix(control);
        if (d.unit)
            row.add_suffix(new Gtk.Label({label: d.unit, css_classes: ['dim-label']}));
        return row;
    },

    slider(d, {settings}) {
        const [lower, upper] = rangeOf(settings, d.key);
        const step = d.step ?? 1;
        const control = new Gtk.Scale({
            adjustment: new Gtk.Adjustment({
                lower, upper, step_increment: step, page_increment: step * 5,
            }),
            digits: 0,
            draw_value: true,
            value_pos: Gtk.PositionType.LEFT,
            width_request: 220,
            valign: Gtk.Align.CENTER,
        });
        for (const mark of d.marks ?? [])
            control.add_mark(mark, Gtk.PositionType.BOTTOM, null);
        control.set_format_value_func((_s, v) => `${Math.round(v)}${d.unit ?? ''}`);
        const sync = () => {
            const value = settings.get_int(d.key);
            if (Math.round(control.get_value()) !== value)
                control.set_value(value);
        };
        sync();
        onChanged(settings, d.key, sync, control);
        control.connect('value-changed', () => {
            const value = Math.round(control.get_value());
            if (value !== settings.get_int(d.key))
                settings.set_int(d.key, value);
        });

        const row = actionRow(d);
        addResetButton(row, settings, [d.key]);
        row.add_suffix(control);
        return row;
    },

    text(d, {settings}) {
        const row = new Adw.EntryRow({title: d.title, show_apply_button: true});
        const sync = () => {
            const value = settings.get_string(d.key);
            if (row.text !== value)
                row.text = value;
        };
        sync();
        onChanged(settings, d.key, sync, row);
        row.connect('apply', () => {
            if (row.text !== settings.get_string(d.key))
                settings.set_string(d.key, row.text);
        });

        if (d.preview) {
            const preview = new Gtk.Label({css_classes: ['dim-label'], valign: Gtk.Align.CENTER});
            const update = () => {
                const shown = d.preview(row.text);
                preview.label = shown ?? '';
                preview.visible = Boolean(shown);
            };
            update();
            row.connect('changed', update);
            row.add_suffix(preview);
        }

        if (d.presets?.length) {
            const list = new Gtk.ListBox({
                selection_mode: Gtk.SelectionMode.NONE,
                css_classes: ['boxed-list'],
            });
            const popover = new Gtk.Popover({child: list});
            for (const [value, label] of d.presets) {
                const item = new Adw.ActionRow({
                    title: label, subtitle: value || 'GNOME default',
                    activatable: true, use_markup: false,
                });
                item.connect('activated', () => {
                    settings.set_string(d.key, value);
                    popover.popdown();
                });
                list.append(item);
            }
            row.add_suffix(new Gtk.MenuButton({
                icon_name: 'view-more-symbolic',
                tooltip_text: 'Examples',
                popover,
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
            }));
        }

        addResetButton(row, settings, [d.key]);
        return row;
    },

    shortcut(d, {settings}) {
        const label = new Gtk.ShortcutLabel({disabled_text: 'Off', valign: Gtk.Align.CENTER});
        const sync = () => (label.accelerator = settings.get_strv(d.key)[0] ?? '');
        sync();
        onChanged(settings, d.key, sync, label);

        const row = actionRow(d);
        row.activatable = true;
        row.tooltip_text = 'Click to change';
        addResetButton(row, settings, [d.key]);
        row.add_suffix(label);
        row.connect('activated', () => askForShortcut(row, d.title, accel => {
            settings.set_strv(d.key, accel ? [accel] : []);
        }));
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

// Keys that make a shortcut without a modifier.
const BARE_KEYS = new Set([
    Gdk.KEY_F1, Gdk.KEY_F2, Gdk.KEY_F3, Gdk.KEY_F4, Gdk.KEY_F5, Gdk.KEY_F6,
    Gdk.KEY_F7, Gdk.KEY_F8, Gdk.KEY_F9, Gdk.KEY_F10, Gdk.KEY_F11, Gdk.KEY_F12,
    Gdk.KEY_Print, Gdk.KEY_Pause, Gdk.KEY_Scroll_Lock,
]);

// A dialog that waits for a key combination. Escape cancels, Backspace
// gives null (no shortcut).
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
        // Anything else (a modifier on its own, a bare letter): keep waiting.
        return Gdk.EVENT_STOP;
    });
    dialog.add_controller(keys);
    dialog.present(parent);
}

// ---- Groups and pages ----

// Every settings key a description touches, for the reset button.
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

// A group's description inside a section, as a small note. A plain list
// row, so the window's search doesn't list it as a setting.
function sectionNote(description) {
    return new Gtk.ListBoxRow({
        child: new Gtk.Label({
            label: description, xalign: 0, wrap: true,
            css_classes: ['dim-label', 'caption'],
        }),
        activatable: false, selectable: false, css_classes: ['jh-note'],
    });
}

// A section: one row that folds open, with every group of the area inside.
// While folded, it says how many of its settings differ from the default.
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
        // The group's condition goes on each of its rows. A toggle's options
        // follow it as indented rows rather than folding out of it: GTK
        // passes an open row's state to every row inside it, so a folding
        // row inside a section would always look open. They are only shown
        // while the toggle is on.
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

// "Reset N Changed Settings" at the bottom of a page, for the settings it
// shows; only there while some of them are changed.
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

/**
 * Builds a page of the preferences window.
 *
 * @param {object} spec - {title, icon, description, groups}
 * @param {object} ctx - {settings, window}
 * @returns {Adw.PreferencesPage}
 */
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

// A page opened from a link row, with a back button.
function buildSubpage(spec, ctx) {
    const page = new Adw.PreferencesPage({description: spec.description ?? ''});
    fillPage(page, spec, ctx);
    const view = new Adw.ToolbarView({content: page});
    view.add_top_bar(new Adw.HeaderBar());
    return new Adw.NavigationPage({title: spec.title, child: view});
}

// ---- Style ----

const CSS = `
.jh-reset { min-width: 24px; min-height: 24px; padding: 0; opacity: 0.7; }
.jh-reset:hover { opacity: 1; }
.jh-note { padding: 10px 12px; background: none; }
.jh-option { padding-left: 24px; }
`;

/**
 * Loads CSS for the preferences. The prefs process outlives the window and,
 * with `make install`, several builds of this code, so each name keeps one
 * provider on the display and gets the current build's CSS every time.
 *
 * @param {string} name - which CSS this is
 * @param {string} css - the CSS
 */
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

