// Arrange the Quick Settings menu (ui/panel.js QuickSettings,
// ui/quickSettings.js QuickSettingsMenu): the order of its items, how many
// columns each one spans, how many columns the grid has, and which items and
// top row buttons are shown. Covers items added by other extensions too.
//
// The grid lays its children out in child order, so moving an item is just
// moving the child. The items manage their own `visible` (Bluetooth hides
// itself without an adapter, the microphone slider shows only while
// recording, and that also drives the microphone privacy icon), so a hidden
// item is not set invisible but taken out of the grid, and put back later.
// Its top bar icon, if it has one, stays.
//
// Every change starts from GNOME's own arrangement, rebuilt from what was
// recorded when each item was first seen, so the result only depends on the
// settings and disabling restores the stock menu exactly.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {whenQuickSettingsReady} from '../../lib/shell.js';
import {
    EXTERNAL_PREFIX, arrange, rankOf, spanFor,
} from '../../lib/quickSettingsCatalog.js';

const KEYS = {
    hidden: 'hidden-quick-settings',
    order: 'quick-settings-order',
    widths: 'quick-settings-widths',
    columns: 'quick-settings-columns',
    known: 'known-quick-settings-items',
    knownIcons: 'known-quick-settings-icons',
    knownKinds: 'known-quick-settings-kinds',
    present: 'present-quick-settings-items',
};

// Owned by the process that shows extension preferences, only while it runs
// (it quits a few seconds after the window closes).
const PREFS_BUS_NAME = 'org.gnome.Shell.Extensions';

/**
 * How to find the built-in grid items on the QuickSettings object. Items of
 * jh-fixes itself carry their id in `_jhFixesId` instead.
 */
const FINDERS = {
    'system': qs => qs._system?.quickSettingsItems,
    'volume-output': qs => qs._volumeOutput?._output,
    'volume-input': qs => qs._volumeInput?._input,
    'brightness': qs => qs._brightness?.quickSettingsItems,
    'wired': qs => qs._network?._wiredToggle,
    'wifi': qs => qs._network?._wirelessToggle,
    'mobile-broadband': qs => qs._network?._modemToggle,
    'bluetooth-tethering': qs => qs._network?._btToggle,
    'vpn': qs => qs._network?._vpnToggle,
    'bluetooth': qs => qs._bluetooth?.quickSettingsItems,
    'power-mode': qs => qs._powerProfiles?.quickSettingsItems,
    'night-light': qs => qs._nightLight?.quickSettingsItems,
    'dark-style': qs => qs._darkMode?.quickSettingsItems,
    'do-not-disturb': qs => qs._doNotDisturb?.quickSettingsItems,
    'keyboard-brightness': qs => qs._backlight?.quickSettingsItems,
    'airplane-mode': qs => qs._rfkill?.quickSettingsItems,
    'auto-rotate': qs => qs._autoRotate?.quickSettingsItems,
    'background-apps': qs => qs._backgroundApps?.quickSettingsItems,
};

/** Top row buttons (ui/status/system.js SystemItem), by class name. */
const BUTTON_CLASSES = {
    'button-battery': 'PowerToggle',
    'button-screenshot': 'ScreenshotItem',
    'button-settings': 'SettingsItem',
    'button-lock': 'LockItem',
    'button-power': 'ShutdownItem',
};

/**
 * The icon name of an item from another extension, or ''.
 *
 * @param {Clutter.Actor} item - the grid item
 * @returns {string}
 */
function iconOf(item) {
    const candidates = [
        item.gicon?.get_names?.()?.[0],
        item.iconName,
        item.icon_name,
        item._icon?.icon_name,
        item.slider ? null : item.child?.icon_name,
    ];
    return candidates.find(c => typeof c === 'string' && c) ?? '';
}

/**
 * A readable name for an item from another extension.
 *
 * @param {Clutter.Actor} item - the grid item
 * @returns {string}
 */
function titleOf(item) {
    const candidates = [
        item.title,
        item.label?.text,
        item.accessible_name,
        item.slider?.accessible_name,
        item.iconName ?? item.icon_name,
    ];
    return candidates.find(c => typeof c === 'string' && c.trim())?.trim() ??
        item.constructor.name;
}

/**
 * What an item from another extension looks like, for the preview. As in
 * the catalog, sliders and rows span all columns and tiles share a row.
 *
 * @param {Clutter.Actor} item - the grid item
 * @param {number} span - GNOME's column span for it
 * @param {number} columns - GNOME's number of columns
 * @returns {string} 'slider', 'row' or 'tile'
 */
function kindOf(item, span, columns) {
    if (span < columns)
        return 'tile';
    return item.slider ? 'slider' : 'row';
}

export class QuickSettingsItems {
    constructor(settings) {
        this._settings = settings;
        this._qs = null;
        this._grid = null;
        this._cancelWait = null;
        this._syncId = 0;
        this._presentId = 0;
        this._busy = false;
        this._prefsWatchId = 0;
        this._prefsOpen = false;

        // Every grid item seen so far: item -> {id, seen, span}, where `seen`
        // orders items of equal rank and `span` is GNOME's column span.
        this._info = new Map();
        this._seenCount = 0;
        this._stockColumns = 2;

        // Grid items taken out because they are hidden, with the id of their
        // destroy handler (their owner may destroy them meanwhile).
        this._removedItems = new Map();
        // Top row buttons taken out: {item, snapshot} with the row's
        // children at that time, to find the place again.
        this._removedButtons = [];
        this._spacer = null;
    }

    enable() {
        for (const key of [KEYS.hidden, KEYS.order, KEYS.widths, KEYS.columns])
            this._settings.connectObject(`changed::${key}`, () => this._queueSync(), this);

        // Which items are present only matters to the preferences preview,
        // and items come and go all the time (the microphone slider with
        // every recording, network tiles), each change a dconf write. So
        // it is only written while the preferences are open.
        this._prefsWatchId = Gio.bus_watch_name(Gio.BusType.SESSION, PREFS_BUS_NAME,
            Gio.BusNameWatcherFlags.NONE,
            () => {
                this._prefsOpen = true;
                this._publishPresent();
            },
            () => (this._prefsOpen = false));

        this._cancelWait = whenQuickSettingsReady(qs => {
            this._qs = qs;
            this._grid = qs.menu._grid;
            this._stockColumns = this._grid.layout_manager.n_columns;
            // Others add items with insertItemBefore(), which sets the column
            // span right after adding; wait for that before looking.
            this._grid.connectObject(
                'child-added', () => this._queueSync(),
                'child-removed', (_grid, child) => this._onChildRemoved(child),
                this);
            this._sync();
        });
    }

    disable() {
        this._cancelWait?.();
        this._cancelWait = null;
        if (this._syncId)
            GLib.source_remove(this._syncId);
        this._syncId = 0;
        if (this._presentId)
            GLib.source_remove(this._presentId);
        this._presentId = 0;
        this._settings.disconnectObject(this);
        this._grid?.disconnectObject(this);
        if (this._prefsWatchId)
            Gio.bus_unwatch_name(this._prefsWatchId);
        this._prefsWatchId = 0;
        this._prefsOpen = false;

        if (this._grid)
            this._restoreStock();

        for (const item of this._info.keys())
            item.disconnectObject(this);
        this._info.clear();
        this._qs = null;
        this._grid = null;
    }

    _queueSync() {
        if (this._busy || this._syncId || !this._grid)
            return;
        this._syncId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._syncId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _queuePresent() {
        if (this._presentId || !this._prefsOpen)
            return;
        this._presentId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._presentId = 0;
            this._publishPresent();
            return GLib.SOURCE_REMOVE;
        });
    }

    _onChildRemoved(child) {
        if (this._busy)
            return;
        child.disconnectObject(this);
        // Removed by its owner, e.g. another extension being disabled.
        this._info.delete(child);
        this._queueSync();
    }

    _sync() {
        if (!this._grid)
            return;
        this._busy = true;
        try {
            this._restoreStock();
            this._arrange();
            this._hideItems();
            this._hideButtons();
            this._publishExternal();
            this._publishPresent();
        } catch (e) {
            console.error('jh-fixes: arranging Quick Settings failed', e);
        } finally {
            this._busy = false;
        }
    }

    // The grid's items, without the placeholder for open submenus.
    _gridItems() {
        const placeholder = this._grid.layout_manager._overlay;
        return this._grid.get_children().filter(c => c !== placeholder);
    }

    _setSpan(item, span) {
        this._grid.layout_manager.child_set_property(this._grid, item, 'column-span', span);
    }

    // Gives every grid item an id and records new ones as GNOME made them.
    _identify() {
        const ids = new Map();
        for (const [id, find] of Object.entries(FINDERS)) {
            const found = find(this._qs);
            for (const item of [found ?? []].flat())
                ids.set(item, id);
        }

        const items = this._gridItems();
        for (const item of items) {
            if (!ids.has(item) && item._jhFixesId)
                ids.set(item, item._jhFixesId);
        }
        // Other extensions' items keep the id they got when first seen, so
        // two of the same class never swap ids (and settings) when the grid
        // is rearranged.
        for (const item of items) {
            const id = this._info.get(item)?.id;
            if (!ids.has(item) && id?.startsWith(EXTERNAL_PREFIX))
                ids.set(item, id);
        }
        const used = new Set(ids.values());
        for (const item of items) {
            if (ids.has(item))
                continue;
            // A new item of another extension; number repeats of a class.
            const base = `${EXTERNAL_PREFIX}${item.constructor.name}`;
            let id = base;
            for (let n = 2; used.has(id); n++)
                id = `${base}#${n}`;
            used.add(id);
            ids.set(item, id);
        }

        for (const item of items) {
            let info = this._info.get(item);
            if (!info) {
                const meta = this._grid.layout_manager.get_child_meta(this._grid, item);
                info = {seen: this._seenCount++, span: meta?.column_span ?? 1};
                this._info.set(item, info);
                // Visibility decides what the preferences preview shows.
                item.connectObject('notify::visible', () => this._queuePresent(), this);
            }
            info.id = ids.get(item);
        }
        return items;
    }

    // GNOME's order: by catalog position, others before Background Apps.
    _stockOrder(items) {
        return [...items].sort((a, b) => {
            const ia = this._info.get(a), ib = this._info.get(b);
            return rankOf(ia.id) - rankOf(ib.id) || ia.seen - ib.seen;
        });
    }

    _restoreStock() {
        // Top row first: the buttons go back next to their old neighbours.
        for (const {item, snapshot} of this._removedButtons.reverse()) {
            const box = snapshot.parent;
            const index = snapshot.children.indexOf(item);
            const next = snapshot.children.slice(index + 1).find(c => c.get_parent() === box);
            if (next)
                box.insert_child_below(item, next);
            else
                box.add_child(item);
        }
        this._removedButtons = [];
        this._spacer?.destroy();
        this._spacer = null;

        for (const [item, destroyId] of this._removedItems) {
            item.disconnect(destroyId);
            this._grid.add_child(item);
        }
        this._removedItems.clear();

        const items = this._identify();
        this._stockOrder(items).forEach((item, i) => {
            this._grid.set_child_at_index(item, i);
            this._setSpan(item, this._info.get(item).span);
        });
        this._grid.layout_manager.n_columns = this._stockColumns;
    }

    _arrange() {
        const columns = this._settings.get_int(KEYS.columns);
        const order = this._settings.get_strv(KEYS.order);
        const widths = this._settings.get_value(KEYS.widths).deepUnpack();

        const byId = new Map();
        for (const item of this._stockOrder(this._gridItems()))
            byId.set(this._info.get(item).id, item);

        this._grid.layout_manager.n_columns = columns;
        arrange([...byId.keys()], order).forEach((id, i) => {
            const item = byId.get(id);
            const {span} = this._info.get(item);
            this._grid.set_child_at_index(item, i);
            this._setSpan(item,
                spanFor(widths[id], span >= this._stockColumns, span, columns));
        });
    }

    _hideItems() {
        const hidden = new Set(this._settings.get_strv(KEYS.hidden));
        for (const item of this._gridItems()) {
            if (!hidden.has(this._info.get(item)?.id))
                continue;
            // Close its submenu first, so the menu is not left dimmed.
            item.menu?.close(false);
            this._grid.remove_child(item);
            this._removedItems.set(item, item.connect('destroy', () => {
                this._removedItems.delete(item);
                this._info.delete(item);
            }));
        }
    }

    _hideButtons() {
        const systemItem = this._qs._system?._systemItem;
        const box = systemItem?.child;
        if (!box)
            return;

        const hidden = new Set(this._settings.get_strv(KEYS.hidden));
        const byClass = new Map(box.get_children().map(c => [c.constructor.name, c]));
        for (const [id, className] of Object.entries(BUTTON_CLASSES)) {
            const item = byClass.get(className);
            if (!item || !hidden.has(id))
                continue;
            item.menu?.close(false);
            const snapshot = {parent: box, children: box.get_children()};
            box.remove_child(item);
            this._removedButtons.push({item, snapshot});
        }

        // Without the battery, GNOME's spacer still sits where it was (its
        // visibility follows the battery's) and pushes every button to the
        // right. Take it out and space the buttons like on a desktop.
        // Only matters on computers with a battery: elsewhere the battery
        // button is invisible and GNOME already uses the desktop spacing.
        const {_laptopSpacer: laptopSpacer, _desktopSpacer: desktopSpacer} = systemItem;
        const battery = byClass.get('PowerToggle');
        if (!hidden.has('button-battery') || !battery?.visible ||
            laptopSpacer?.get_parent() !== box || desktopSpacer?.get_parent() !== box)
            return;
        const snapshot = {parent: box, children: box.get_children()};
        box.remove_child(laptopSpacer);
        this._removedButtons.push({item: laptopSpacer, snapshot});
        // After GNOME's (hidden) desktop spacer, so the jh-fixes Settings
        // button, which goes right before that, stays on the left.
        this._spacer = new Clutter.Actor({x_expand: true});
        box.insert_child_above(this._spacer, desktopSpacer);
    }

    // Lets the preferences list other extensions' items, also while they
    // are not there: name, icon and shape. `known` is kept in GNOME's order
    // (the ones here now in the order they were added, then the others), so
    // the preview puts them where the menu does. Only written on changes.
    _publishExternal() {
        const old = this._settings.get_value(KEYS.known).deepUnpack();
        const icons = this._settings.get_value(KEYS.knownIcons).deepUnpack();
        const kinds = this._settings.get_value(KEYS.knownKinds).deepUnpack();

        const known = {};
        let iconsChanged = false, kindsChanged = false;
        const here = [...this._info].filter(([, {id}]) => id.startsWith(EXTERNAL_PREFIX))
            .sort(([, a], [, b]) => a.seen - b.seen);
        for (const [item, {id, span}] of here) {
            known[id] = titleOf(item);
            const icon = iconOf(item);
            if ((icons[id] ?? '') !== icon) {
                icons[id] = icon;
                iconsChanged = true;
            }
            const kind = kindOf(item, span, this._stockColumns);
            if (kinds[id] !== kind) {
                kinds[id] = kind;
                kindsChanged = true;
            }
        }
        for (const [id, title] of Object.entries(old))
            known[id] ??= title;

        // Icons and kinds first: the preferences redraw on `known`.
        if (iconsChanged)
            this._settings.set_value(KEYS.knownIcons, new GLib.Variant('a{ss}', icons));
        if (kindsChanged)
            this._settings.set_value(KEYS.knownKinds, new GLib.Variant('a{ss}', kinds));
        if (JSON.stringify(Object.entries(known)) !== JSON.stringify(Object.entries(old)))
            this._settings.set_value(KEYS.known, new GLib.Variant('a{ss}', known));
    }

    // Which items GNOME shows right now (hidden ones count, as they would
    // be shown), so the preferences preview can leave out the others.
    _publishPresent() {
        // Before the grid is known the list would be empty, which the
        // preview reads as "show everything".
        if (!this._prefsOpen || !this._grid)
            return;
        const present = [];
        for (const [item, {id}] of this._info) {
            if (item.visible)
                present.push(id);
        }
        if (this._qs?._system?._systemItem?.powerToggle?.visible)
            present.push('button-battery');
        present.sort();

        const old = this._settings.get_strv(KEYS.present);
        if (old.join() !== present.join())
            this._settings.set_strv(KEYS.present, present);
    }
}
