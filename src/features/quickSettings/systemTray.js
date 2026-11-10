import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Gettext from 'gettext';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {whenQuickSettingsReady} from '../../lib/shell.js';
import {SettingTweak} from '../../lib/tweak.js';
import {TrayHost, stripMnemonic} from '../../lib/statusNotifier.js';

const SHELL_DOMAIN = 'gnome-shell';
const MENU_MAX_HEIGHT = 360;
const TYPE_SUFFIX = GLib.uuid_string_random().replaceAll('-', '');

function arrow() {
    const icon = new St.Icon({
        icon_name: 'pan-end-symbolic',
        style_class: 'popup-menu-arrow',
        y_align: Clutter.ActorAlign.CENTER,
    });
    icon.set_pivot_point(0.5, 0.5);
    return icon;
}

function setExpanded(actor, arrowIcon, expanded) {
    actor.visible = expanded;
    arrowIcon.rotation_angle_z = expanded
        ? actor.text_direction === Clutter.TextDirection.RTL ? -90 : 90
        : 0;
}

const TrayAppItem = GObject.registerClass({
    GTypeName: `JhFixesTrayAppItem${TYPE_SUFFIX}`,
}, class TrayAppItem extends PopupMenu.PopupBaseMenuItem {
    _init(row) {
        super._init();
        this._row = row;
        this.add_style_class_name('background-app-item');

        this._icon = new St.Icon({style_class: 'popup-menu-icon'});
        this.add_child(this._icon);

        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.label = new St.Label({style_class: 'title', y_align: Clutter.ActorAlign.CENTER});
        this.subtitle = new St.Label({style_class: 'subtitle', y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this.label);
        box.add_child(this.subtitle);
        this.add_child(box);
        this.label_actor = this.label;

        this.set_child_above_sibling(this._ornamentIcon, null);

        this.arrow = arrow();
        this._menuButton = new St.Button({
            child: this.arrow,
            style_class: 'icon-button',
            can_focus: true,
            accessible_name: 'Open menu',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._menuButton.connect('clicked', () => row.toggleMenu());
        this.add_child(this._menuButton);
    }

    setIcon(gicon) {
        this._icon.gicon = gicon;
    }

    set hasMenu(hasMenu) {
        this._menuButton.visible = hasMenu;
    }

    activate(event) {
        if (this._row.clickOpensMenu) {
            this._row.toggleMenu();
            return;
        }
        super.activate(event);
    }
});

const SubmenuItem = GObject.registerClass({
    GTypeName: `JhFixesTraySubmenuItem${TYPE_SUFFIX}`,
}, class SubmenuItem extends PopupMenu.PopupBaseMenuItem {
    _init(label, onToggle) {
        super._init();
        this._onToggle = onToggle;
        this.label = new St.Label({text: label, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this.label);
        this.label_actor = this.label;
        this.arrow = arrow();
        this.add_child(this.arrow);
    }

    activate() {
        this._onToggle();
    }
});

function scrollingSection(maxHeight) {
    const section = new PopupMenu.PopupMenuSection();
    const scroll = new St.ScrollView({
        child: section.box,
        style: maxHeight ? `max-height: ${maxHeight}px;` : null,
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        overlay_scrollbars: true,
        visible: false,
    });
    scroll._delegate = section;
    section.actor = scroll;
    return section;
}

class TrayRow {
    constructor(item, onChanged) {
        this.item = item;
        this._onChanged = onChanged;
        this._expanded = false;
        this._loadToken = null;

        this.section = new PopupMenu.PopupMenuSection();
        this.header = new TrayAppItem(this);
        this.header.connect('activate', () => this._activate());
        this.section.addMenuItem(this.header);
        this._content = scrollingSection(MENU_MAX_HEIGHT);
        this.section.addMenuItem(this._content);

        item.connectObject('changed', () => this.sync(), this);
        this.sync();
    }

    destroy() {
        this.item.disconnectObject(this);
        this.item.menu?.disconnectObject(this);
        this._menu = null;
        this.section.destroy();
    }

    get app() {
        return this.item.app;
    }

    get visible() {
        return this.item.ready && this.item.status !== 'Passive';
    }

    get name() {
        return this.app?.get_name() || this.item.title || this.item.id || this.item.busName;
    }

    get clickOpensMenu() {
        return !!this.item.menu && this.item.itemIsMenu;
    }

    sync() {
        this.section.actor.visible = this.visible;
        if (!this.item.ready)
            return;
        const name = this.name;
        const subtitle = [this.item.tooltip, this.item.title]
            .find(t => t && t !== name) ?? '';
        this.header.label.text = name;
        this.header.subtitle.text = subtitle;
        this.header.subtitle.visible = !!subtitle;
        this.header.setIcon(this.app?.get_icon() ?? this.item.gicon);
        this.header.hasMenu = !!this.item.menu;

        if (this._menu !== this.item.menu) {
            this._menu?.disconnectObject(this);
            this._menu = this.item.menu;
            this._menu?.connectObject('changed', () => this._expanded && this._load(), this);
            if (this._expanded && this._menu)
                this._load(true);
            else if (this._expanded)
                this.collapse();
        }
        this._onChanged();
    }

    _activate() {
        Main.overview.hide();
        Main.panel.closeQuickSettings();
        this.item.activate().catch(() => {
            if (this.app)
                this.app.activate();
        });
    }

    toggleMenu() {
        if (this._expanded)
            this.collapse();
        else
            this._expand();
    }

    _expand() {
        if (!this.item.menu)
            return;
        this._expanded = true;
        this._onExpand?.(this);
        setExpanded(this._content.actor, this.header.arrow, true);
        this.item.menu.event(0, 'opened');
        this._load(true);
    }

    collapse() {
        if (!this._expanded)
            return;
        this._expanded = false;
        this._loadToken = null;
        setExpanded(this._content.actor, this.header.arrow, false);
        this.item.menu?.event(0, 'closed');
    }

    async _load(aboutToShow = false) {
        const menu = this.item.menu;
        const token = (this._loadToken = Symbol('load'));
        try {
            if (aboutToShow)
                await menu.aboutToShow(0);
            const root = await menu.layout(0);
            if (this._loadToken !== token)
                return;
            this._content.removeAll();
            this._build(this._content, root.children, menu);
            if (this._content.isEmpty())
                this._content.addMenuItem(new PopupMenu.PopupMenuItem('Empty menu', {reactive: false}));
        } catch (e) {
            if (this._loadToken === token)
                console.warn(`jh-fixes: loading tray menu of ${this.name} failed: ${e.message}`);
        }
    }

    _build(section, nodes, menu) {
        const isSeparator = node => node.props.type === 'separator';
        const shown = nodes.filter(node => node.props.visible !== false)
            .filter((node, i, all) => !isSeparator(node) ||
                (i > 0 && i < all.length - 1 && !isSeparator(all[i + 1])));
        for (const {id, props, children} of shown) {
            if (props.type === 'separator') {
                section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                continue;
            }

            const label = stripMnemonic(props.label ?? '');
            if (props['children-display'] === 'submenu' || children.length) {
                this._addSubmenu(section, id, label, children, menu, props.enabled !== false);
                continue;
            }

            const icon = props['icon-data']?.get_size()
                ? Gio.BytesIcon.new(props['icon-data'])
                : props['icon-name'] && Gio.ThemedIcon.new(props['icon-name']);
            const entry = icon
                ? new PopupMenu.PopupImageMenuItem(label, icon)
                : new PopupMenu.PopupMenuItem(label);
            const state = props['toggle-state'];
            if (props['toggle-type'] === 'checkmark')
                entry.setOrnament(state === 1 ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
            else if (props['toggle-type'] === 'radio')
                entry.setOrnament(state === 1 ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NO_DOT);
            entry.connect('activate', () => {
                menu.event(id, 'clicked');
                Main.panel.closeQuickSettings();
            });
            section.addMenuItem(entry);
            entry.setSensitive(props.enabled !== false);
        }
    }

    _addSubmenu(section, id, label, children, menu, enabled) {
        const nested = scrollingSection(0);
        nested.box.style = 'padding-left: 12px;';
        let open = false;
        const header = new SubmenuItem(label, async () => {
            open = !open;
            setExpanded(nested.actor, header.arrow, open);
            if (!open)
                return;
            const token = this._loadToken;
            if (await menu.aboutToShow(id) || !children.length) {
                try {
                    const node = await menu.layout(id);
                    if (this._loadToken !== token)
                        return;
                    nested.removeAll();
                    this._build(nested, node.children, menu);
                } catch {}
            }
        });
        section.addMenuItem(header);
        section.addMenuItem(nested);
        this._build(nested, children, menu);
        header.setSensitive(enabled);
    }
}

export class SystemTray extends SettingTweak {
    static KEY = 'quick-settings-systray';
    static DEFAULT = false;

    _apply() {
        this._rows = new Map();
        this._cancelWait = whenQuickSettingsReady(qs => this._attach(qs));
    }

    _revert() {
        this._cancelWait?.();
        this._cancelWait = null;
        this._host?.disconnectObject(this);
        this._host?.destroy();
        this._host = null;
        for (const row of this._rows.values())
            row.destroy();
        this._rows.clear();
        this._section?.destroy();
        this._section = null;

        const toggle = this._toggle;
        this._toggle = null;
        if (!toggle)
            return;
        toggle.menu.disconnectObject(this);
        this._injections.clear();
        for (const item of toggle._appsSection._getMenuItems())
            item.visible = true;
        toggle._sync();
    }

    _attach(qs) {
        const toggle = qs._backgroundApps.quickSettingsItems[0];
        if (!toggle?._appsSection)
            return;
        this._toggle = toggle;

        this._section = new PopupMenu.PopupMenuSection();
        const position = toggle.menu._getMenuItems().indexOf(toggle._appsSection) + 1;
        toggle.menu.addMenuItem(this._section, position);

        const self = this;
        this._injections.overrideMethod(toggle, '_sync', sync => function () {
            sync.call(this);
            self._decorate();
        });
        this._injections.overrideMethod(toggle, '_syncVisibility', () => function () {
            this.visible = !Main.sessionMode.isLocked && (this.menu.isOpen || self._count() > 0);
        });
        toggle.menu.connectObject('open-state-changed', (_menu, open) => {
            if (!open)
                this._rows.forEach(row => row.collapse());
        }, this);

        this._host = new TrayHost();
        this._host.connectObject(
            'item-added', (_host, item) => this._addRow(item),
            'item-removed', (_host, item) => this._removeRow(item),
            this);
        this._host.start();
        toggle._sync();
    }

    _addRow(item) {
        const row = new TrayRow(item, () => this._decorate());
        row._onExpand = expanded => this._rows.forEach(r => r !== expanded && r.collapse());
        this._rows.set(item, row);
        this._section.addMenuItem(row.section);
        this._decorate();
    }

    _removeRow(item) {
        this._rows.get(item)?.destroy();
        this._rows.delete(item);
        this._decorate();
    }

    _visibleRows() {
        return [...this._rows.values()].filter(row => row.visible);
    }

    _count() {
        const backgroundApps = this._toggle?._appsSection._getMenuItems()
            .filter(item => item.visible).length ?? 0;
        return backgroundApps + this._visibleRows().length;
    }

    _decorate() {
        const toggle = this._toggle;
        if (!toggle || this._decorating)
            return;
        this._decorating = true;
        try {
            const rows = this._visibleRows();
            const trayApps = new Set(rows.map(row => row.app).filter(Boolean));
            let backgroundApps = 0;
            for (const item of toggle._appsSection._getMenuItems()) {
                item.visible = !trayApps.has(item.app);
                if (item.visible)
                    backgroundApps++;
            }

            [...this._rows.values()]
                .sort((a, b) => a.name.localeCompare(b.name))
                .forEach((row, i) => this._section.moveMenuItem(row.section, i));

            const n = backgroundApps + rows.length;
            toggle.title = n === 0
                ? Gettext.dgettext(SHELL_DOMAIN, 'No Background Apps')
                : Gettext.dngettext(SHELL_DOMAIN, '%d Background App', '%d Background Apps', n).format(n);
            toggle._listTitle.visible = backgroundApps > 0;
            toggle._syncVisibility();
        } finally {
            this._decorating = false;
        }
    }
}
