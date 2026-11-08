import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

import {
    EXTERNAL_PREFIX, FULL_WIDTH, GRID_ITEMS, KEYS, TOP_ROW_BUTTONS, arrange, rankOf, spanFor,
} from '../../lib/quickSettingsCatalog.js';
import {addCss, addDropTarget, bindNotInList, clear, onChanged, showPopover} from '../ui/build.js';

const KIND_LABELS = {
    row: 'Row',
    slider: 'Slider',
    tile: 'Tile',
    button: 'Top row button',
};

const kindLabel = item => (item.external
    ? `${KIND_LABELS[item.kind]} from another extension`
    : KIND_LABELS[item.kind]);

const FALLBACK_ICON = 'application-x-addon-symbolic';

const JH_FIXES_BUTTON = 'button-jh-fixes';
const JH_FIXES_TITLE = 'jh-fixes Settings';
const TOP_ROW = [
    ...TOP_ROW_BUTTONS.slice(0, 3),
    {id: JH_FIXES_BUTTON, title: JH_FIXES_TITLE, icon: FALLBACK_ICON},
    ...TOP_ROW_BUTTONS.slice(3),
].map(b => ({...b, kind: 'button'}));
const RIGHT_BUTTONS = new Set(['button-lock', 'button-power']);
const SPACING = 10;

const CSS = `
.jh-qs-menu {
  background-color: alpha(@view_fg_color, 0.05);
  border-radius: 30px;
  padding: 14px;
}
.jh-qs-tile, .jh-qs-row {
  background-color: alpha(@view_fg_color, 0.1);
  border-radius: 999px;
  min-height: 52px;
  padding: 0 18px;
}
.jh-qs-slider, .jh-qs-toprow {
  border-radius: 999px;
  min-height: 46px;
  padding: 0 10px;
}
.jh-qs-tile:hover, .jh-qs-row:hover { background-color: alpha(@view_fg_color, 0.16); }
.jh-qs-slider:hover, .jh-qs-toprow:hover { background-color: alpha(@view_fg_color, 0.07); }
.jh-qs-track trough, .jh-qs-track progress { min-height: 8px; border-radius: 999px; }
.jh-qs-button {
  background-color: alpha(@view_fg_color, 0.1);
  border-radius: 999px;
  min-width: 38px;
  min-height: 38px;
}
.jh-qs-cell { transition: opacity 150ms; }
.jh-qs-cell:focus-visible { outline: 2px solid @accent_color; outline-offset: 2px; }
.jh-absent { opacity: 0.4; }
.jh-dragged { opacity: 0.3; }
.jh-placeholder {
  opacity: 0.6;
  outline: 2px dashed @accent_color;
  outline-offset: -2px;
}
.jh-drop-target { box-shadow: inset 0 0 0 2px @accent_bg_color; }
.jh-hidden-area {
  border: 2px dashed alpha(@view_fg_color, 0.18);
  border-radius: 24px;
  padding: 12px;
  min-height: 44px;
  transition: border-color 150ms, background-color 150ms;
}
.jh-hidden-area.jh-drop-hover {
  border-color: @accent_bg_color;
  background-color: alpha(@accent_bg_color, 0.08);
}
.jh-chip {
  background-color: alpha(@view_fg_color, 0.08);
  border-radius: 999px;
  min-height: 36px;
  padding: 0 14px;
}
.jh-chip:hover { background-color: alpha(@view_fg_color, 0.14); }
`;

function arrangedItems(settings) {
    const entries = new Map();
    for (const item of GRID_ITEMS)
        entries.set(item.id, {...item, stockFull: item.kind !== 'tile'});

    const known = settings.get_value(KEYS.known).deepUnpack();
    const icons = settings.get_value(KEYS.knownIcons).deepUnpack();
    const kinds = settings.get_value(KEYS.knownKinds).deepUnpack();
    for (const [id, title] of Object.entries(known)) {
        if (!id.startsWith(EXTERNAL_PREFIX))
            continue;
        const kind = kinds[id] ?? 'tile';
        entries.set(id, {
            id, title, kind, external: true,
            icon: icons[id] || FALLBACK_ICON,
            stockFull: kind !== 'tile',
        });
    }

    const stock = [...entries.keys()].sort((a, b) => rankOf(a) - rankOf(b));
    return arrange(stock, settings.get_strv(KEYS.order)).map(id => entries.get(id));
}

export function quickSettingsLayout({settings}) {
    addCss('quick-settings-layout', CSS);
    const layout = new Layout(settings);
    return [layout.menuGroup, layout.hiddenGroup];
}

export const LAYOUT_KEYS = [KEYS.hidden, KEYS.order, KEYS.widths, KEYS.prefsButton];

function gridPositions(spans, columns) {
    let row = -1, column = 0;
    return spans.map(span => {
        if (column === 0 || column + span > columns) {
            row++;
            column = 0;
        }
        const at = {column, row};
        column = (column + span) % columns;
        return at;
    });
}

const SCROLL_EDGE = 64;
const SCROLL_MAX_STEP = 18;

const icon = (name, params = {}) => new Gtk.Image({icon_name: name || FALLBACK_ICON, ...params});

class Layout {
    constructor(settings) {
        this._settings = settings;
        this._rebuildId = 0;
        this._showAbsent = false;
        this._reopen = null;
        this._cells = [];
        this._drag = null;
        this._scrollId = 0;
        this._scrollStep = 0;
        this._scrolled = null;
        this._popover = null;
        this._rebuildPending = false;
        this._destroyed = false;
        this._topRow = null;
        this._hidden = new Set();
        this._present = new Set();

        this._buildMenu();
        this._buildHidden();

        onChanged(settings, [KEYS.order, KEYS.widths, KEYS.columns, KEYS.known, KEYS.knownIcons,
            KEYS.knownKinds, KEYS.present, KEYS.hidden, KEYS.prefsButton],
        () => this._queueRebuild(), this.menuGroup);
        this._rebuild();

        this.menuGroup.connect('map', () => this._watchPageScrolling());
        this.menuGroup.connect('destroy', () => {
            if (this._rebuildId)
                GLib.source_remove(this._rebuildId);
            this._rebuildId = 0;
            this._stopScrolling();
            this._destroyed = true;
        });
    }

    _buildMenu() {
        const reveal = new Gtk.ToggleButton({
            icon_name: 'view-reveal-symbolic',
            tooltip_text: 'Also show items GNOME has nothing to show for right now',
            css_classes: ['flat'],
            valign: Gtk.Align.CENTER,
        });
        reveal.connect('toggled', () => {
            this._showAbsent = reveal.active;
            this._rebuild();
        });

        this.menuGroup = new Adw.PreferencesGroup({
            title: 'Menu Layout',
            header_suffix: reveal,
        });

        this._grid = new Gtk.Grid({
            column_homogeneous: true,
            row_spacing: SPACING,
            column_spacing: SPACING,
            hexpand: true,
        });
        this._frame = new Gtk.Box({css_classes: ['jh-qs-menu']});
        this._frame.append(this._grid);

        addDropTarget(this._frame, {
            motion: (x, y) => {
                if (!this._drag)
                    return false;
                if (this._drag.isButton)
                    this._topRow?.add_css_class('jh-drop-target');
                else
                    this._dragOver(x, y);
                return true;
            },
            leave: () => {
                this._topRow?.remove_css_class('jh-drop-target');
                this._dragLeft();
            },
            drop: id => {
                this._topRow?.remove_css_class('jh-drop-target');
                this._dropInMenu(id);
            },
        });

        this.menuGroup.add(this._frame);
    }

    _buildHidden() {
        this.hiddenGroup = new Adw.PreferencesGroup({
            title: 'Hidden Items',
        });
        this._chips = new Adw.WrapBox({child_spacing: 8, line_spacing: 8, hexpand: true});
        const area = new Gtk.Box({css_classes: ['jh-hidden-area']});
        area.append(this._chips);

        addDropTarget(area, {drop: id => this._place(id, {hide: true})});

        this.hiddenGroup.add(area);
    }

    _queueRebuild() {
        if (this._popover) {
            this._rebuildPending = true;
            return;
        }
        if (this._rebuildId || this._destroyed)
            return;
        this._rebuildId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._rebuildId = 0;
            this._rebuild();
            return GLib.SOURCE_REMOVE;
        });
    }

    _rebuild() {
        const items = arrangedItems(this._settings);
        const columns = this._settings.get_int(KEYS.columns);
        const widths = this._settings.get_value(KEYS.widths).deepUnpack();
        const hidden = this._hidden = new Set(this._settings.get_strv(KEYS.hidden));
        const present = this._present = new Set(this._settings.get_strv(KEYS.present));
        const isPresent = id => !present.size || present.has(id);
        const byId = new Map();

        clear(this._grid);
        this._topRow = null;
        this._cells = [];
        for (const item of items) {
            if (hidden.has(item.id) || (!isPresent(item.id) && !this._showAbsent))
                continue;
            const span = spanFor(widths[item.id], item.stockFull, 1, columns);
            const cell = this._menuCell(item, isPresent(item.id));
            this._cells.push({cell, id: item.id, item, span});
            byId.set(item.id, cell);
        }
        const positions = gridPositions(this._cells.map(c => c.span), columns);
        this._cells.forEach(({cell, span}, i) =>
            this._grid.attach(cell, positions[i].column, positions[i].row, span, 1));
        if (this._cells.length === 0) {
            this._grid.attach(new Gtk.Label({
                label: 'Nothing is shown',
                css_classes: ['dim-label'],
                height_request: 52,
            }), 0, 0, 1, 1);
        }

        clear(this._chips);
        const hiddenItems = [
            ...items.filter(item => hidden.has(item.id)),
            ...TOP_ROW.filter(button => this._isButtonHidden(button.id)),
        ];
        for (const item of hiddenItems) {
            const there = item.kind === 'button' && item.id !== 'button-battery' ? true : isPresent(item.id);
            const chip = this._chip(item, there);
            this._chips.append(chip);
            byId.set(item.id, chip);
        }
        if (hiddenItems.length === 0) {
            this._chips.append(new Gtk.Label({
                label: 'No hidden items',
                css_classes: ['dim-label'],
                hexpand: true,
                height_request: 36,
            }));
        }

        if (this._reopen) {
            const cell = byId.get(this._reopen);
            this._reopen = null;
            if (cell) {
                cell.grab_focus();
                this._openPopover(cell);
            }
        }
    }

    _menuCell(item, isPresentNow) {
        let cell;
        if (item.id === 'system')
            cell = this._topRowCell();
        else if (item.kind === 'slider')
            cell = this._sliderCell(item);
        else
            cell = this._tileCell(item);

        cell.add_css_class('jh-qs-cell');
        if (!isPresentNow)
            cell.add_css_class('jh-absent');
        cell.tooltip_text = [
            item.title,
            kindLabel(item),
            isPresentNow ? '' : 'GNOME has nothing to show for it right now',
        ].filter(Boolean).join(' · ');
        this._makeInteractive(cell, item, false);
        return cell;
    }

    _tileCell(item) {
        const cell = new Gtk.Box({
            spacing: 12,
            css_classes: [item.kind === 'row' ? 'jh-qs-row' : 'jh-qs-tile'],
        });
        cell.append(icon(item.icon));
        cell.append(new Gtk.Label({
            label: item.title,
            ellipsize: Pango.EllipsizeMode.END,
            xalign: 0,
            hexpand: true,
            css_classes: ['heading'],
        }));
        return cell;
    }

    _sliderCell(item) {
        const cell = new Gtk.Box({spacing: 12, css_classes: ['jh-qs-slider']});
        cell.append(icon(item.icon));
        cell.append(new Gtk.ProgressBar({
            fraction: 0.6,
            hexpand: true,
            valign: Gtk.Align.CENTER,
            css_classes: ['jh-qs-track'],
        }));
        cell.append(new Gtk.Label({
            label: item.title,
            ellipsize: Pango.EllipsizeMode.END,
            max_width_chars: 14,
            css_classes: ['caption', 'dim-label'],
        }));
        return cell;
    }

    _topRowCell() {
        const cell = new Gtk.Box({spacing: 8, css_classes: ['jh-qs-toprow']});
        const present = this._present;
        let spacer = false;
        for (const button of TOP_ROW) {
            if (RIGHT_BUTTONS.has(button.id) && !spacer) {
                cell.append(new Gtk.Box({hexpand: true}));
                spacer = true;
            }
            if (this._isButtonHidden(button.id))
                continue;
            const absent = button.id === 'button-battery' && present.size && !present.has(button.id);
            if (absent && !this._showAbsent)
                continue;

            const b = new Gtk.Box({
                css_classes: ['jh-qs-button', 'jh-qs-cell'],
                tooltip_text: `${button.title} · drag to Hidden to hide it`,
            });
            if (absent)
                b.add_css_class('jh-absent');
            b.append(icon(button.icon, {hexpand: true, halign: Gtk.Align.CENTER}));
            this._addDragSource(b, button.id);
            cell.append(b);
        }
        this._topRow = cell;
        return cell;
    }

    _isButtonHidden(id) {
        if (id === JH_FIXES_BUTTON)
            return !this._settings.get_boolean(KEYS.prefsButton);
        return this._hidden.has(id);
    }

    _chip(item, isPresentNow) {
        const chip = new Gtk.Box({spacing: 8, css_classes: ['jh-chip', 'jh-qs-cell']});
        chip.append(icon(item.icon));
        chip.append(new Gtk.Label({label: item.title, valign: Gtk.Align.CENTER}));
        if (!isPresentNow)
            chip.add_css_class('jh-absent');
        chip.tooltip_text = [
            kindLabel(item),
            isPresentNow ? '' : 'GNOME has nothing to show for it right now',
        ].filter(Boolean).join(' · ');
        this._makeInteractive(chip, item, true);
        return chip;
    }

    _makeInteractive(cell, item, isHidden) {
        cell.focusable = true;
        cell.cursor = Gdk.Cursor.new_from_name('pointer', null);
        cell._item = item;
        cell._isHidden = isHidden;

        const click = new Gtk.GestureClick();
        click.connect('released', () => {
            cell.grab_focus();
            this._openPopover(cell);
        });
        cell.add_controller(click);

        const keys = new Gtk.EventControllerKey();
        keys.connect('key-pressed', (_c, keyval) => {
            if (![Gdk.KEY_Return, Gdk.KEY_KP_Enter, Gdk.KEY_space, Gdk.KEY_Menu].includes(keyval))
                return false;
            this._openPopover(cell);
            return true;
        });
        cell.add_controller(keys);

        this._addDragSource(cell, item.id);
    }

    _addDragSource(cell, id) {
        const source = new Gtk.DragSource({actions: Gdk.DragAction.MOVE});
        cell._jhDragId = id;
        let hotX = 0, hotY = 0;
        source.connect('prepare', (_s, x, y) => {
            for (let w = cell.pick(x, y, Gtk.PickFlags.DEFAULT); w && w !== cell; w = w.get_parent()) {
                if (w._jhDragId)
                    return null;
            }
            [hotX, hotY] = [x, y];
            return Gdk.ContentProvider.new_for_value(id);
        });
        source.connect('drag-begin', src => {
            src.set_icon(Gtk.WidgetPaintable.new(cell).get_current_image(), hotX, hotY);
            this._startDrag(id, cell);
        });
        source.connect('drag-end', () => this._endDrag());
        cell.add_controller(source);
    }

    _startDrag(id, sourceCell) {
        const entry = this._cells.find(c => c.id === id) ?? null;
        this._drag = {
            id,
            isButton: id.startsWith('button-'),
            entry,
            fromMenu: entry !== null,
            inMenu: entry !== null,
            order: [...this._cells],
            lastMove: null,
        };
        if (entry)
            entry.cell.add_css_class('jh-placeholder');
        else
            sourceCell.add_css_class('jh-dragged');
        const [, bounds] = this._frame.compute_bounds(this._frame);
        this._frame.height_request = Math.ceil(bounds.get_height());
    }

    _endDrag() {
        this._drag = null;
        this._frame.height_request = -1;
        this._stopScrolling();
        this._queueRebuild();
    }

    _dragOver(x, y) {
        const drag = this._drag;
        if (!drag.entry && !this._addPlaceholder())
            return;
        drag.entry.cell.visible = true;
        drag.inMenu = true;

        const boxes = drag.order.filter(e => e.cell.visible).map(e => {
            const [ok, rect] = e.cell.compute_bounds(this._frame);
            return ok ? {e, x: rect.get_x(), y: rect.get_y(), w: rect.get_width(), h: rect.get_height()} : null;
        }).filter(Boolean);
        const hit = boxes.find(b => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);

        let target, after;
        if (hit) {
            if (hit.e === drag.entry)
                return;
            const columns = this._settings.get_int(KEYS.columns);
            after = hit.e.span >= columns ? y > hit.y + hit.h / 2 : x > hit.x + hit.w / 2;
            target = hit.e;
        } else {
            const last = boxes.filter(b => b.e !== drag.entry).at(-1);
            if (!last || !(y > last.y + last.h || (y >= last.y && x > last.x + last.w)))
                return;
            target = last.e;
            after = true;
        }
        if (drag.lastMove?.target === target && drag.lastMove.after === after)
            return;
        drag.lastMove = {target, after};

        const order = drag.order.filter(e => e !== drag.entry);
        order.splice(order.indexOf(target) + (after ? 1 : 0), 0, drag.entry);
        if (order.every((e, i) => e === drag.order[i]))
            return;
        drag.order = order;
        this._reflow();
    }

    _addPlaceholder() {
        const drag = this._drag;
        const item = arrangedItems(this._settings).find(i => i.id === drag.id);
        if (!item)
            return false;
        const columns = this._settings.get_int(KEYS.columns);
        const widths = this._settings.get_value(KEYS.widths).deepUnpack();
        const span = spanFor(widths[item.id], item.stockFull, 1, columns);
        const cell = this._menuCell(item, true);
        cell.add_css_class('jh-placeholder');
        cell.can_target = false;
        drag.entry = {cell, id: item.id, item, span};
        drag.order = [...drag.order, drag.entry];
        drag.lastMove = null;
        this._grid.attach(cell, 0, 0, span, 1);
        this._reflow();
        return true;
    }

    _dragLeft() {
        const drag = this._drag;
        if (!drag?.entry || drag.isButton || !drag.inMenu)
            return;
        drag.inMenu = false;
        drag.lastMove = null;
        if (drag.fromMenu) {
            drag.entry.cell.visible = false;
        } else {
            this._grid.remove(drag.entry.cell);
            drag.order = drag.order.filter(e => e !== drag.entry);
            drag.entry = null;
        }
        this._reflow();
    }

    _reflow() {
        const shown = this._drag.order.filter(e => e.cell.visible);
        const columns = this._settings.get_int(KEYS.columns);
        gridPositions(shown.map(e => e.span), columns).forEach((at, i) => {
            const child = this._grid.layout_manager.get_layout_child(shown[i].cell);
            if (child.column !== at.column)
                child.column = at.column;
            if (child.row !== at.row)
                child.row = at.row;
        });
    }

    _dropInMenu(id) {
        const drag = this._drag;
        if (!drag || drag.isButton || !drag.entry) {
            this._place(id, {hide: false});
            return;
        }
        const ids = drag.order.filter(e => e.cell.visible).map(e => e.id);
        const i = ids.indexOf(id);
        const [before, next] = [ids[i - 1], ids[i + 1]];
        this._place(id, {target: before ?? next ?? null, after: before !== undefined, hide: false});
    }

    _watchPageScrolling() {
        const scrolled = this.menuGroup.get_ancestor(Gtk.ScrolledWindow.$gtype);
        if (!scrolled || this._scrolled === scrolled)
            return;
        this._scrolled = scrolled;
        const motion = new Gtk.DropControllerMotion();
        motion.connect('motion', (_m, x, y) => {
            if (!this._drag)
                return;
            if (this._drag.inMenu && !this._isOverMenu(scrolled, x, y))
                this._dragLeft();
            const height = scrolled.get_height();
            const into = y < SCROLL_EDGE ? y - SCROLL_EDGE
                : y > height - SCROLL_EDGE ? y - (height - SCROLL_EDGE) : 0;
            this._scrollStep = Math.round(into / SCROLL_EDGE * SCROLL_MAX_STEP);
            if (this._scrollStep && !this._scrollId)
                this._scrollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => this._scrollTick());
        });
        motion.connect('leave', () => this._stopScrolling());
        scrolled.add_controller(motion);
        this.menuGroup.connect('destroy', () => scrolled.remove_controller(motion));
    }

    _isOverMenu(widget, x, y) {
        const [ok, point] = widget.compute_point(this._frame, new Graphene.Point({x, y}));
        const [hasBounds, bounds] = this._frame.compute_bounds(this._frame);
        return ok && hasBounds && bounds.contains_point(point);
    }

    _scrollTick() {
        const adjustment = this._scrolled?.vadjustment;
        if (!this._drag || !this._scrollStep || !adjustment) {
            this._scrollId = 0;
            return GLib.SOURCE_REMOVE;
        }
        const max = adjustment.upper - adjustment.page_size;
        adjustment.value = Math.max(0, Math.min(max, adjustment.value + this._scrollStep));
        return GLib.SOURCE_CONTINUE;
    }

    _stopScrolling() {
        this._scrollStep = 0;
        if (this._scrollId)
            GLib.source_remove(this._scrollId);
        this._scrollId = 0;
    }

    _openPopover(cell) {
        const {_item: item, _isHidden: isHidden} = cell;
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
            margin_top: 8,
            margin_bottom: 8,
            margin_start: 8,
            margin_end: 8,
            width_request: 240,
        });
        const popover = new Gtk.Popover({child: box});
        this._popover = popover;
        const popup = () => showPopover(popover, cell, () => {
            if (this._popover === popover)
                this._popover = null;
            if (this._rebuildPending) {
                this._rebuildPending = false;
                this._queueRebuild();
            }
        });

        const header = new Gtk.Box({spacing: 8, margin_bottom: 4});
        header.append(icon(item.icon));
        header.append(new Gtk.Label({label: item.title, css_classes: ['heading'], xalign: 0}));
        box.append(header);

        const act = (f, reopen = false) => () => {
            popover.popdown();
            if (reopen)
                this._reopen = item.id;
            f();
        };

        if (isHidden) {
            const show = new Gtk.Button({
                label: item.kind === 'button' ? 'Show in Top Row' : 'Show in Menu',
                css_classes: ['suggested-action'],
            });
            show.connect('clicked', act(() => this._place(item.id, {hide: false})));
            box.append(show);
            popup();
            return;
        }

        if (item.id === 'system')
            box.append(this._topRowSwitches());

        const width = new Gtk.Box({spacing: 12});
        width.append(new Gtk.Label({label: 'Width', hexpand: true, xalign: 0}));
        width.append(this._widthDropDown(item, () => {
            popover.popdown();
            this._reopen = item.id;
        }));
        box.append(width);

        const shownIds = this._cells.map(c => c.id);
        const index = shownIds.indexOf(item.id);
        const moves = new Gtk.Box({css_classes: ['linked'], homogeneous: true});
        const earlier = new Gtk.Button({
            icon_name: 'go-previous-symbolic', tooltip_text: 'Move Earlier', sensitive: index > 0,
        });
        const later = new Gtk.Button({
            icon_name: 'go-next-symbolic', tooltip_text: 'Move Later', sensitive: index < shownIds.length - 1,
        });
        earlier.connect('clicked', act(() =>
            this._place(item.id, {target: shownIds[index - 1], after: false}), true));
        later.connect('clicked', act(() =>
            this._place(item.id, {target: shownIds[index + 1], after: true}), true));
        moves.append(earlier);
        moves.append(later);
        const moveRow = new Gtk.Box({spacing: 12});
        moveRow.append(new Gtk.Label({label: 'Position', hexpand: true, xalign: 0}));
        moveRow.append(moves);
        box.append(moveRow);

        const hide = new Gtk.Button({label: 'Hide', css_classes: ['destructive-action'], margin_top: 4});
        hide.connect('clicked', act(() => this._place(item.id, {hide: true})));
        box.append(hide);
        popup();
    }

    _topRowSwitches() {
        const list = new Gtk.ListBox({css_classes: ['boxed-list'], selection_mode: Gtk.SelectionMode.NONE});
        const add = (title, bind) => {
            const row = new Adw.SwitchRow({title});
            bind(row);
            list.append(row);
        };
        for (const {id, title} of TOP_ROW_BUTTONS)
            add(title, row => bindNotInList(this._settings, KEYS.hidden, id, row, 'active'));
        add(JH_FIXES_TITLE, row => this._settings.bind(KEYS.prefsButton, row, 'active', 0));
        return list;
    }

    _widthDropDown(item, beforeChange) {
        const columns = this._settings.get_int(KEYS.columns);
        const widths = this._settings.get_value(KEYS.widths).deepUnpack();
        const columnsLabel = n => (n === 1 ? '1 Column' : `${n} Columns`);

        const stockSpan = spanFor(undefined, item.stockFull, 1, columns);
        const choices = [[undefined, `Default (${item.stockFull ? 'Full' : columnsLabel(stockSpan)})`]];
        for (let n = 1; n < columns; n++)
            choices.push([n, columnsLabel(n)]);
        choices.push([FULL_WIDTH, 'Full Width']);

        const stored = widths[item.id];
        let selected = choices.findIndex(([value]) => value === stored);
        if (selected < 0)
            selected = stored >= columns ? choices.length - 1 : 0;

        const dropDown = new Gtk.DropDown({
            model: Gtk.StringList.new(choices.map(([, label]) => label)),
            selected,
        });
        dropDown.connect('notify::selected', () => {
            const value = choices[dropDown.selected]?.[0];
            const current = this._settings.get_value(KEYS.widths).deepUnpack();
            if (current[item.id] === value)
                return;
            if (value === undefined)
                delete current[item.id];
            else
                current[item.id] = value;
            beforeChange();
            this._settings.set_value(KEYS.widths, new GLib.Variant('a{si}', current));
        });
        return dropDown;
    }

    _place(id, {target = null, after = false, hide} = {}) {
        if (id === JH_FIXES_BUTTON) {
            if (hide !== undefined && this._settings.get_boolean(KEYS.prefsButton) === hide)
                this._settings.set_boolean(KEYS.prefsButton, !hide);
            return;
        }

        if (target && target !== id && !id.startsWith('button-')) {
            const ids = arrangedItems(this._settings).map(item => item.id);
            if (ids.includes(id) && ids.includes(target)) {
                ids.splice(ids.indexOf(id), 1);
                const at = ids.indexOf(target);
                ids.splice(after ? at + 1 : at, 0, id);
                this._settings.set_strv(KEYS.order, ids);
            }
        }

        if (hide !== undefined) {
            const hidden = new Set(this._settings.get_strv(KEYS.hidden));
            if (hidden.has(id) !== hide) {
                if (hide)
                    hidden.add(id);
                else
                    hidden.delete(id);
                this._settings.set_strv(KEYS.hidden, [...hidden]);
            }
        }
    }
}
