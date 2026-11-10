// Rearranges the Quick Settings menu: hide items, reorder them, change their width and
// the number of columns.
//
// Everything works by first restoring the stock layout (_restoreStock) and then
// applying the saved configuration on top (_arrange, _hideItems, _hideButtons), so
// the result never depends on what a previous pass did. Items added by other
// extensions are found in the grid and published to the prefs window.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {whenQuickSettingsReady} from '../../lib/shell.js';
import {
    EXTERNAL_PREFIX, KEYS, arrange, rankOf, spanFor,
} from '../../lib/quickSettingsCatalog.js';

// The preferences window runs in a separate process. Its D-Bus name tells us whether
// it is open, so the (comparatively expensive) list of present items is only
// published while someone is looking at it.
const PREFS_BUS_NAME = 'org.gnome.Shell.Extensions';

// Where the shell keeps each built-in item. A finder may return one item, an array
// or nothing (when the item does not exist on this machine).
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

// Buttons of the top row, identified by the class name of the shell's widget.
const BUTTON_CLASSES = {
    'button-battery': 'PowerToggle',
    'button-screenshot': 'ScreenshotItem',
    'button-settings': 'SettingsItem',
    'button-lock': 'LockItem',
    'button-power': 'ShutdownItem',
};

// Best-effort icon name of an arbitrary Quick Settings item; empty if none is found.
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

// Best-effort display title of an arbitrary item; falls back to its class name.
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

// Narrower than the full grid means tile; otherwise slider or row.
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

        // Per item: {id, seen, span}. `seen` is the order in which we first saw it and
        // `span` is its stock column span, recorded before we change anything.
        this._info = new Map();
        this._seenCount = 0;
        this._stockColumns = 2;

        // What _hideItems/_hideButtons took out, kept so _restoreStock can put it back.
        this._removedItems = new Map();
        this._removedButtons = [];
        this._spacer = null;
    }

    // Any change to the layout settings re-runs the whole arrangement.
    enable() {
        const queue = () => this._queueSync();
        this._settings.connectObject(
            `changed::${KEYS.hidden}`, queue,
            `changed::${KEYS.order}`, queue,
            `changed::${KEYS.widths}`, queue,
            `changed::${KEYS.columns}`, queue,
            this);

        // Start publishing the present items when the prefs window appears on the bus.
        this._prefsWatchId = Gio.bus_watch_name(Gio.BusType.SESSION, PREFS_BUS_NAME,
            Gio.BusNameWatcherFlags.NONE,
            () => {
                this._prefsOpen = true;
                this._publishPresent();
            },
            () => (this._prefsOpen = false));

        // The menu is filled in after login; wait until it is complete.
        this._cancelWait = whenQuickSettingsReady(qs => {
            this._qs = qs;
            this._grid = qs.menu._grid;
            this._stockColumns = this._grid.layout_manager.n_columns;
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

    // Coalesce several triggers (settings, grid changes) into one sync on idle.
    _queueSync() {
        if (this._busy || this._syncId || !this._grid)
            return;
        this._syncId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._syncId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Visibility of items changes often (e.g. Bluetooth); debounce publishing it.
    _queuePresent() {
        if (this._presentId || !this._prefsOpen)
            return;
        this._presentId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._presentId = 0;
            this._publishPresent();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Ignore removals we caused ourselves (`_busy`); otherwise the item is gone for good.
    _onChildRemoved(child) {
        if (this._busy)
            return;
        child.disconnectObject(this);
        this._info.delete(child);
        this._queueSync();
    }

    // Full re-layout: stock first, then the user configuration.
    _sync() {
        if (!this._grid)
            return;
        this._busy = true;
        try {
            this._restoreStock();
            const hidden = new Set(this._settings.get_strv(KEYS.hidden));
            this._arrange();
            this._hideItems(hidden);
            this._hideButtons(hidden);
            this._publishExternal();
            this._publishPresent();
        } catch (e) {
            console.error('jh-fixes: arranging Quick Settings failed', e);
        } finally {
            this._busy = false;
        }
    }

    // The grid's children without the drag-and-drop placeholder overlay.
    _gridItems() {
        const placeholder = this._grid.layout_manager._overlay;
        return this._grid.get_children().filter(c => c !== placeholder);
    }

    _setSpan(item, span) {
        this._grid.layout_manager.child_set_property(this._grid, item, 'column-span', span);
    }

    // Gives every grid item a stable id and returns the items.
    // 1. Built-in items via FINDERS.
    // 2. Items we tagged or identified earlier.
    // 3. Anything else is from another extension: `ext:<ClassName>`, numbered if repeated.
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
        for (const item of items) {
            const id = this._info.get(item)?.id;
            if (!ids.has(item) && id?.startsWith(EXTERNAL_PREFIX))
                ids.set(item, id);
        }
        const used = new Set(ids.values());
        for (const item of items) {
            if (ids.has(item))
                continue;
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
                item.connectObject('notify::visible', () => this._queuePresent(), this);
            }
            info.id = ids.get(item);
        }
        return items;
    }

    // Items in the order GNOME would place them: by catalog rank, then by first sight.
    _stockOrder(items) {
        return [...items].sort((a, b) => {
            const ia = this._info.get(a), ib = this._info.get(b);
            return rankOf(ia.id) - rankOf(ib.id) || ia.seen - ib.seen;
        });
    }

    // Undo everything we did: reinsert removed buttons at their old position, put hidden
    // items back and restore the stock order, spans and column count.
    _restoreStock() {
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

    // Apply column count, saved order and widths. Items not in the saved order (e.g. newly
    // installed extensions) are slotted in by arrange().
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

    // Hidden items are removed from the grid rather than made invisible, so they leave
    // no gap. If one is destroyed while removed, forget it.
    _hideItems(hidden) {
        for (const item of this._gridItems()) {
            if (!hidden.has(this._info.get(item)?.id))
                continue;
            item.menu?.close(false);
            this._grid.remove_child(item);
            this._removedItems.set(item, item.connect('destroy', () => {
                this._removedItems.delete(item);
                this._info.delete(item);
            }));
        }
    }

    // Same for the buttons in the top row. The shell has no list of them, so they are
    // matched by class name; each removal records a snapshot of the sibling order for
    // _restoreStock.
    _hideButtons(hidden) {
        const systemItem = this._qs._system?._systemItem;
        const box = systemItem?.child;
        if (!box)
            return;

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

        // Without the battery indicator the stock spacer would leave the buttons off-center;
        // replace it with a flexible spacer of our own.
        const {_laptopSpacer: laptopSpacer, _desktopSpacer: desktopSpacer} = systemItem;
        const battery = byClass.get('PowerToggle');
        if (!hidden.has('button-battery') || !battery?.visible ||
            laptopSpacer?.get_parent() !== box || desktopSpacer?.get_parent() !== box)
            return;
        const snapshot = {parent: box, children: box.get_children()};
        box.remove_child(laptopSpacer);
        this._removedButtons.push({item: laptopSpacer, snapshot});
        this._spacer = new Clutter.Actor({x_expand: true});
        box.insert_child_above(this._spacer, desktopSpacer);
    }

    // Tells the prefs window about items from other extensions (title, icon, kind), so
    // they can be configured too. Entries are kept even when the extension is not
    // loaded right now.
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

        if (iconsChanged)
            this._settings.set_value(KEYS.knownIcons, new GLib.Variant('a{ss}', icons));
        if (kindsChanged)
            this._settings.set_value(KEYS.knownKinds, new GLib.Variant('a{ss}', kinds));
        if (JSON.stringify(Object.entries(known)) !== JSON.stringify(Object.entries(old)))
            this._settings.set_value(KEYS.known, new GLib.Variant('a{ss}', known));
    }

    // Publishes which items are currently visible so prefs can hide options that do not
    // apply to this machine.
    _publishPresent() {
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
