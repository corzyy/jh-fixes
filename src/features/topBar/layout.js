import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

import {BOXES, KEYS, STOCK_ITEMS, arrangeBoxes, isStock} from '../../lib/panelCatalog.js';

const panelBoxes = () => ({
    left: Main.panel._leftBox,
    center: Main.panel._centerBox,
    right: Main.panel._rightBox,
});

function boxNameOf(actor) {
    const [name] = Object.entries(panelBoxes()).find(([, box]) => box === actor) ?? [];
    return name ?? null;
}

function findIcon(actor) {
    if (actor instanceof St.Icon) {
        if (actor.icon_name)
            return actor.icon_name;
        if (actor.gicon instanceof Gio.ThemedIcon)
            return actor.gicon.get_names()[0] ?? '';
    }
    for (const child of actor.get_children()) {
        const icon = findIcon(child);
        if (icon)
            return icon;
    }
    return '';
}

function move(container, box, index) {
    if (container.get_parent() === box && box.get_child_at_index(index) === container)
        return;
    container.get_parent()?.remove_child(container);
    box.insert_child_at_index(container, Math.min(index, box.get_n_children()));
}

const userMode = () => !Main.sessionMode.isLocked && !Main.sessionMode.isGreeter;

export class PanelLayout {
    constructor(settings) {
        this._settings = settings;
        this._injections = new InjectionManager();
        this._origins = new Map();
        this._hidden = new Set();
        this._idleId = 0;
    }

    enable() {
        const queue = () => this._queue();
        this._injections.overrideMethod(Main.panel, '_addToPanelBox', original =>
            function (...args) {
                original.call(this, ...args);
                queue();
            });
        Main.sessionMode.connectObject('updated', queue, this);
        this._settings.connectObject(
            `changed::${KEYS.layout}`, queue,
            `changed::${KEYS.hidden}`, queue, this);
        this._sync();
    }

    disable() {
        if (this._idleId)
            GLib.source_remove(this._idleId);
        this._idleId = 0;
        this._injections.clear();
        Main.sessionMode.disconnectObject(this);
        this._settings.disconnectObject(this);
        this._showHidden(new Set());
        this._restore();
    }

    _queue() {
        this._idleId ||= GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idleId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _roles() {
        return Object.entries(Main.panel.statusArea)
            .filter(([, indicator]) => indicator?.container && boxNameOf(indicator.container.get_parent()))
            .map(([role]) => role);
    }

    _sync() {
        const roles = this._roles();
        const known = this._record(roles);

        const stored = this._settings.get_value(KEYS.layout).deepUnpack();
        if (!userMode())
            return;
        this._hide(roles);
        if (!Object.keys(stored).length) {
            this._restore();
            return;
        }

        const items = new Map(roles.map(role => [role, {
            box: STOCK_ITEMS[role]?.box ?? known[role]?.[2] ?? 'right',
        }]));
        const layout = arrangeBoxes(stored, items);
        const boxes = panelBoxes();
        for (const name of BOXES) {
            layout[name].forEach((role, index) => {
                const {container} = Main.panel.statusArea[role];
                if (!this._origins.has(role)) {
                    const parent = container.get_parent();
                    this._origins.set(role, {parent, index: parent.get_children().indexOf(container)});
                }
                move(container, boxes[name], index);
            });
        }
    }

    _hide(roles) {
        const wanted = new Set(this._settings.get_strv(KEYS.hidden)
            .filter(role => role !== 'activities' && roles.includes(role)));
        this._showHidden(wanted);
        for (const role of wanted) {
            Main.panel.statusArea[role].container.hide();
            this._hidden.add(role);
        }
    }

    _showHidden(keep) {
        const {statusArea} = Main.panel;
        const stock = Object.values(Main.sessionMode.panel).flat();
        for (const role of [...this._hidden]) {
            if (keep.has(role))
                continue;
            this._hidden.delete(role);
            const container = statusArea[role]?.container;
            if (container && (!isStock(role) || stock.includes(role)))
                container.show();
        }
    }

    _record(roles) {
        const old = this._settings.get_value(KEYS.known).deepUnpack();
        const known = {...old};
        for (const role of roles) {
            if (isStock(role))
                continue;
            const indicator = Main.panel.statusArea[role];
            const box = old[role]?.[2] ?? boxNameOf(indicator.container.get_parent()) ?? 'right';
            const title = indicator.accessible_name || old[role]?.[0] || role;
            const icon = findIcon(indicator) || old[role]?.[1] || '';
            known[role] = [title, icon, box];
        }
        if (JSON.stringify(known) !== JSON.stringify(old))
            this._settings.set_value(KEYS.known, new GLib.Variant('a{sas}', known));

        const present = roles.filter(role => Main.panel.statusArea[role].visible);
        if (JSON.stringify(present) !== JSON.stringify(this._settings.get_strv(KEYS.present)))
            this._settings.set_strv(KEYS.present, present);
        return known;
    }

    _restore() {
        if (!this._origins.size)
            return;
        const {statusArea} = Main.panel;
        const boxes = panelBoxes();
        const stock = Main.sessionMode.panel;
        for (const name of BOXES) {
            stock[name].filter(role => statusArea[role]?.container)
                .forEach((role, index) => move(statusArea[role].container, boxes[name], index));
        }
        [...this._origins]
            .filter(([role]) => !isStock(role) && statusArea[role]?.container)
            .sort(([, a], [, b]) => a.index - b.index)
            .forEach(([role, {parent, index}]) => move(statusArea[role].container, parent, index));
        this._origins.clear();
    }
}
