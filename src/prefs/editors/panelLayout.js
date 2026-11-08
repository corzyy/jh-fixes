import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ACTIVITIES_KEY, BOXES, KEYS, STOCK_ITEMS, arrangeBoxes, isFollower, withFollowers} from '../../lib/panelCatalog.js';
import {addCss, addDropTarget, clear, onChanged, showPopover} from '../ui/build.js';

const FALLBACK_ICON = 'application-x-addon-symbolic';
const QUICK_SETTINGS_ICONS = [
    'network-wireless-signal-excellent-symbolic',
    'audio-volume-high-symbolic',
    'battery-good-symbolic',
];
const BOX_TITLES = {left: 'Left', center: 'Centre', right: 'Right'};

const CSS = `
.jh-pb-bar {
  background-color: #000000;
  color: #ffffff;
  border-radius: 14px;
  padding: 5px 6px;
}
.jh-pb-zone {
  min-width: 56px;
  min-height: 34px;
  border-radius: 10px;
  transition: background-color 150ms, box-shadow 150ms;
}
.jh-pb-dragging .jh-pb-zone { box-shadow: inset 0 0 0 1px alpha(#ffffff, 0.25); }
.jh-pb-dragging .jh-pb-zone.jh-drop-hover {
  box-shadow: inset 0 0 0 2px var(--accent-bg-color);
  background-color: alpha(#ffffff, 0.06);
}
.jh-pb-item {
  padding: 0 10px;
  border-radius: 999px;
  min-height: 34px;
  transition: opacity 150ms, background-color 150ms;
}
.jh-pb-item:hover { background-color: alpha(#ffffff, 0.15); }
.jh-pb-item label { font-weight: bold; }
.jh-pb-menu-hint { opacity: 0.55; margin-left: -2px; }
.jh-pb-has-menu:hover .jh-pb-menu-hint { opacity: 1; }
.jh-pb-pill { min-width: 26px; min-height: 8px; border-radius: 4px; background-color: #ffffff; }
.jh-pb-dot { min-width: 8px; min-height: 8px; border-radius: 4px; background-color: alpha(#ffffff, 0.6); }
.jh-pb-marker {
  min-width: 3px;
  margin: 6px 2px;
  border-radius: 2px;
  background-color: var(--accent-bg-color);
}
.jh-pb-captions label { font-size: smaller; }
.jh-pb-item.jh-absent { opacity: 0.4; }
.jh-pb-item.jh-dragged, .jh-chip.jh-dragged { opacity: 0.2; }
.jh-pb-hidden {
  border: 2px dashed alpha(@view_fg_color, 0.18);
  border-radius: 16px;
  padding: 5px 8px;
  transition: border-color 150ms, background-color 150ms;
}
.jh-pb-hidden.jh-drop-hover {
  border-color: var(--accent-bg-color);
  background-color: alpha(var(--accent-bg-color), 0.08);
}
.jh-pb-hidden .jh-chip {
  background-color: alpha(@view_fg_color, 0.08);
  border-radius: 999px;
  min-height: 28px;
  padding: 0 12px;
}
.jh-pb-hidden .jh-chip:hover { background-color: alpha(@view_fg_color, 0.14); }
`;

function itemsOf(settings) {
    const items = new Map();
    for (const [role, item] of Object.entries(STOCK_ITEMS))
        items.set(role, {...item, external: false});
    const known = settings.get_value(KEYS.known).deepUnpack();
    for (const [role, [title, icon, box]] of Object.entries(known))
        items.set(role, {title: title || role, icon: icon || FALLBACK_ICON, box: box || 'right', external: true});
    return items;
}

export function panelLayout({settings}) {
    addCss('panel-layout', CSS);
    return new PanelPreview(settings).widget;
}

class PanelPreview {
    constructor(settings) {
        this._settings = settings;
        this._dragging = null;
        this._rebuildId = 0;
        this._popover = null;
        this._rebuildPending = false;
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._marker = new Gtk.Box({css_classes: ['jh-pb-marker'], can_target: false});

        this._zones = {};
        for (const name of BOXES)
            this._zones[name] = this._zone(name);

        this._bar = new Gtk.CenterBox({
            css_classes: ['jh-pb-bar'],
            start_widget: this._zones.left,
            center_widget: this._zones.center,
            end_widget: this._zones.right,
        });

        const captions = new Gtk.CenterBox({css_classes: ['jh-pb-captions', 'dim-label'], margin_start: 10, margin_end: 10});
        captions.start_widget = new Gtk.Label({label: BOX_TITLES.left});
        captions.center_widget = new Gtk.Label({label: BOX_TITLES.center});
        captions.end_widget = new Gtk.Label({label: BOX_TITLES.right});

        this._chips = new Adw.WrapBox({child_spacing: 8, line_spacing: 8, hexpand: true});
        const hiddenArea = new Gtk.Box({css_classes: ['jh-pb-hidden'], margin_top: 12});
        hiddenArea.append(this._chips);
        addDropTarget(hiddenArea, {drop: role => this._setHidden(role, true)});

        this.widget = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8});
        this.widget.append(this._bar);
        this.widget.append(captions);
        this.widget.append(hiddenArea);

        onChanged(this._interface, 'clock-format', () => this._queueRebuild(), this.widget);
        onChanged(settings, [KEYS.layout, KEYS.known, KEYS.present, KEYS.hidden, KEYS.clock, ACTIVITIES_KEY],
            () => this._queueRebuild(), this.widget);
        this.widget.connect('destroy', () => {
            if (this._rebuildId)
                GLib.source_remove(this._rebuildId);
            this._rebuildId = 0;
        });
        this._rebuild();
    }

    _arranged() {
        const items = itemsOf(this._settings);
        const stored = this._settings.get_value(KEYS.layout).deepUnpack();
        return {items, layout: arrangeBoxes(stored, items)};
    }

    _queueRebuild() {
        if (this._popover) {
            this._rebuildPending = true;
            return;
        }
        if (this._dragging || this._rebuildId)
            return;
        this._rebuildId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._rebuildId = 0;
            this._rebuild();
            return GLib.SOURCE_REMOVE;
        });
    }

    _rebuild() {
        const {items, layout} = this._arranged();
        const present = new Set(this._settings.get_strv(KEYS.present));
        const hidden = this._hiddenRoles();
        const note = role => (present.size && role !== 'activities' &&
            !withFollowers(role).some(r => present.has(r)) ? 'Not showing right now' : '');
        for (const name of BOXES) {
            const zone = this._zones[name];
            clear(zone);
            for (const role of layout[name].filter(r => !hidden.has(r) && !isFollower(r)))
                zone.append(this._item(role, items.get(role), note(role)));
        }

        clear(this._chips);
        const hiddenRoles = BOXES.flatMap(name => layout[name]).filter(r => hidden.has(r) && !isFollower(r));
        for (const role of hiddenRoles)
            this._chips.append(this._chip(role, items.get(role), note(role)));
        if (!hiddenRoles.length) {
            this._chips.append(new Gtk.Label({
                label: 'Drag items here to hide them', css_classes: ['dim-label'],
                hexpand: true, height_request: 28,
            }));
        }
    }

    _hiddenRoles() {
        const hidden = new Set(this._settings.get_strv(KEYS.hidden));
        if (this._settings.get_boolean(ACTIVITIES_KEY))
            hidden.delete('activities');
        else
            hidden.add('activities');
        return hidden;
    }

    _setHidden(role, hide) {
        if (role === 'activities') {
            if (this._settings.get_boolean(ACTIVITIES_KEY) === hide)
                this._settings.set_boolean(ACTIVITIES_KEY, !hide);
            return;
        }
        const old = this._settings.get_strv(KEYS.hidden);
        const hidden = new Set(old);
        for (const r of withFollowers(role)) {
            if (hide)
                hidden.add(r);
            else
                hidden.delete(r);
        }
        if (hidden.size !== old.length || old.some(r => !hidden.has(r)))
            this._settings.set_strv(KEYS.hidden, [...hidden]);
    }

    _chip(role, item, note) {
        const chip = new Gtk.Box({
            spacing: 8,
            css_classes: ['jh-chip'],
            tooltip_text: [note, 'Drag onto the bar to show it'].filter(Boolean).join(' · '),
            cursor: Gdk.Cursor.new_from_name('grab', null),
        });
        chip._role = role;
        if (note)
            chip.add_css_class('jh-absent');
        chip.append(new Gtk.Image({icon_name: item.icon || FALLBACK_ICON}));
        chip.append(new Gtk.Label({label: item.title, valign: Gtk.Align.CENTER}));
        this._addDragSource(chip, role);
        return chip;
    }

    _item(role, item, note) {
        const cell = new Gtk.Box({
            spacing: 6,
            css_classes: ['jh-pb-item'],
            tooltip_text: [item.title, note, 'Drag to move'].filter(Boolean).join(' · '),
            cursor: Gdk.Cursor.new_from_name('grab', null),
        });
        cell._role = role;
        if (note)
            cell.add_css_class('jh-absent');

        if (role === 'activities') {
            const dots = new Gtk.Box({spacing: 5, valign: Gtk.Align.CENTER});
            dots.append(new Gtk.Box({css_classes: ['jh-pb-pill']}));
            dots.append(new Gtk.Box({css_classes: ['jh-pb-dot']}));
            dots.append(new Gtk.Box({css_classes: ['jh-pb-dot']}));
            cell.append(dots);
        } else if (role === 'dateMenu') {
            cell.append(new Gtk.Label({label: this._clockText()}));
        } else if (role === 'quickSettings') {
            for (const icon of QUICK_SETTINGS_ICONS)
                cell.append(new Gtk.Image({icon_name: icon}));
        } else {
            cell.append(new Gtk.Image({icon_name: item.icon || FALLBACK_ICON}));
        }

        const openMenu = this._menus()[role];
        if (openMenu)
            this._addMenu(cell, openMenu);

        this._addDragSource(cell, role);
        return cell;
    }

    _menus() {
        return {
            dateMenu: cell => this._openChoiceMenu(cell, KEYS.clock, 'Clock shows',
                [['default', 'Date and time'], ['time', 'Time only']]),
        };
    }

    _addMenu(cell, open) {
        cell.add_css_class('jh-pb-has-menu');
        cell.append(new Gtk.Image({
            icon_name: 'pan-down-symbolic', pixel_size: 10, css_classes: ['jh-pb-menu-hint'],
        }));
        cell.tooltip_text = `${cell.tooltip_text} · Click for options`;
        const click = new Gtk.GestureClick();
        click.connect('released', () => open(cell));
        cell.add_controller(click);
    }

    _clockText() {
        const time = this._interface.get_string('clock-format') === '12h' ? '%l∶%M %p' : '%H∶%M';
        const format = this._settings.get_string(KEYS.clock) === 'time' ? time : `%a %e %b  ${time}`;
        return GLib.DateTime.new_now_local().format(format).trim();
    }

    _openChoiceMenu(cell, key, title, choices) {
        const fallback = this._settings.get_default_value(key).deepUnpack();
        const dropDown = new Gtk.DropDown({
            model: Gtk.StringList.new(choices.map(([value, label]) =>
                value === fallback ? `${label} (default)` : label)),
            selected: Math.max(0, choices.findIndex(([value]) => value === this._settings.get_string(key))),
        });
        dropDown.connect('notify::selected', () => {
            const value = choices[dropDown.selected]?.[0];
            if (value && value !== this._settings.get_string(key))
                this._settings.set_string(key, value);
        });

        const box = new Gtk.Box({
            spacing: 12, margin_top: 8, margin_bottom: 8, margin_start: 10, margin_end: 8,
        });
        box.append(new Gtk.Label({label: title, hexpand: true, xalign: 0}));
        box.append(dropDown);

        const [, bounds] = cell.compute_bounds(this._bar);
        const popover = new Gtk.Popover({
            child: box,
            pointing_to: new Gdk.Rectangle({
                x: Math.round(bounds.get_x()), y: Math.round(bounds.get_y()),
                width: Math.round(bounds.get_width()), height: Math.round(bounds.get_height()),
            }),
        });
        this._popover = popover;
        showPopover(popover, this._bar, () => {
            this._popover = null;
            if (this._rebuildPending) {
                this._rebuildPending = false;
                this._queueRebuild();
            }
        });
    }

    _addDragSource(cell, role) {
        const source = new Gtk.DragSource({actions: Gdk.DragAction.MOVE});
        let hot = [0, 0];
        source.connect('prepare', (_s, x, y) => {
            hot = [x, y];
            return Gdk.ContentProvider.new_for_value(role);
        });
        source.connect('drag-begin', src => {
            src.set_icon(Gtk.WidgetPaintable.new(cell).get_current_image(), ...hot);
            this._dragging = role;
            cell.add_css_class('jh-dragged');
            this._bar.add_css_class('jh-pb-dragging');
        });
        source.connect('drag-end', () => {
            this._dragging = null;
            this._removeMarker();
            this._bar.remove_css_class('jh-pb-dragging');
            this._rebuild();
        });
        cell.add_controller(source);
    }

    _zone(name) {
        const zone = new Gtk.Box({spacing: 2, css_classes: ['jh-pb-zone']});
        zone._name = name;
        addDropTarget(zone, {
            motion: x => this._placeMarker(zone, x),
            leave: () => {
                if (this._marker.get_parent() === zone)
                    this._removeMarker();
            },
            drop: role => this._drop(zone, role),
        });
        return zone;
    }

    _cells(zone) {
        const cells = [];
        for (let c = zone.get_first_child(); c; c = c.get_next_sibling()) {
            if (c !== this._marker && c._role !== this._dragging)
                cells.push(c);
        }
        return cells;
    }

    _placeMarker(zone, x) {
        let before = null;
        for (const cell of this._cells(zone)) {
            const [ok, rect] = cell.compute_bounds(zone);
            if (!ok || x < rect.get_x() + rect.get_width() / 2)
                break;
            before = cell;
        }
        if (this._marker.get_parent() !== zone) {
            this._removeMarker();
            zone.insert_child_after(this._marker, before);
        } else if (this._marker.get_prev_sibling() !== before) {
            zone.reorder_child_after(this._marker, before);
        }
    }

    _removeMarker() {
        this._marker.get_parent()?.remove(this._marker);
    }

    _drop(zone, role) {
        const {layout} = this._arranged();
        const cells = this._cells(zone);
        const markerAt = this._marker.get_parent() === zone
            ? cells.filter(c => {
                const [, a] = c.compute_bounds(zone);
                const [, m] = this._marker.compute_bounds(zone);
                return a.get_x() < m.get_x();
            }).length
            : cells.length;
        const moving = withFollowers(role);
        for (const name of BOXES)
            layout[name] = layout[name].filter(r => !moving.includes(r));
        const list = layout[zone._name];
        const before = cells[markerAt - 1]?._role;
        const after = cells[markerAt]?._role;
        const index = before ? list.indexOf(before) + 1 : after ? list.indexOf(after) : list.length;
        list.splice(index, 0, ...moving);
        this._removeMarker();
        this._settings.set_value(KEYS.layout, new GLib.Variant('a{sas}', layout));
        this._setHidden(role, false);
    }
}
