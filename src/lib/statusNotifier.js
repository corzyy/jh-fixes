import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

Gio._promisify(Gio.DBusConnection.prototype, 'call');

const WATCHER_NAME = 'org.kde.StatusNotifierWatcher';
const WATCHER_PATH = '/StatusNotifierWatcher';
const ITEM_IFACE = 'org.kde.StatusNotifierItem';
const MENU_IFACE = 'com.canonical.dbusmenu';
const DEFAULT_ITEM_PATH = '/StatusNotifierItem';

const REFRESH_DELAY_MS = 100;
const PIXMAP_SIZE = 32;

const WATCHER_XML = `<node>
  <interface name="${WATCHER_NAME}">
    <method name="RegisterStatusNotifierItem"><arg name="service" type="s" direction="in"/></method>
    <method name="RegisterStatusNotifierHost"><arg name="service" type="s" direction="in"/></method>
    <property name="RegisteredStatusNotifierItems" type="as" access="read"/>
    <property name="IsStatusNotifierHostRegistered" type="b" access="read"/>
    <property name="ProtocolVersion" type="i" access="read"/>
    <signal name="StatusNotifierItemRegistered"><arg type="s"/></signal>
    <signal name="StatusNotifierItemUnregistered"><arg type="s"/></signal>
    <signal name="StatusNotifierHostRegistered"/>
    <signal name="StatusNotifierHostUnregistered"/>
  </interface>
</node>`;

const isCancelled = e => e instanceof GLib.Error &&
    e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);

function call(conn, name, path, iface, method, params, replyType, cancellable = null) {
    return conn.call(name, path, iface, method, params ?? null,
        replyType ? new GLib.VariantType(replyType) : null,
        Gio.DBusCallFlags.NONE, -1, cancellable);
}

async function busCall(conn, method, params, replyType, cancellable) {
    const reply = await call(conn, 'org.freedesktop.DBus', '/org/freedesktop/DBus',
        'org.freedesktop.DBus', method, params, replyType, cancellable);
    return reply.deepUnpack()[0];
}

const uniqueName = (conn, name, cancellable) => name.startsWith(':')
    ? Promise.resolve(name)
    : busCall(conn, 'GetNameOwner', new GLib.Variant('(s)', [name]), '(s)', cancellable);

function splitId(id) {
    const slash = id.indexOf('/');
    return slash < 0 ? [id, DEFAULT_ITEM_PATH] : [id.slice(0, slash), id.slice(slash)];
}

class Watcher {
    constructor(conn, onAdded, onRemoved) {
        this._conn = conn;
        this._onAdded = onAdded;
        this._onRemoved = onRemoved;
        this._items = new Map();
        this._impl = Gio.DBusExportedObject.wrapJSObject(WATCHER_XML, this);
        this._impl.export(conn, WATCHER_PATH);
    }

    get RegisteredStatusNotifierItems() {
        return [...this._items.keys()];
    }

    get IsStatusNotifierHostRegistered() {
        return true;
    }

    get ProtocolVersion() {
        return 0;
    }

    RegisterStatusNotifierHostAsync(_params, invocation) {
        invocation.return_value(null);
    }

    async RegisterStatusNotifierItemAsync([service], invocation) {
        const byPath = service.startsWith('/');
        let name = byPath ? invocation.get_sender() : service;
        const path = byPath ? service : DEFAULT_ITEM_PATH;
        try {
            name = await uniqueName(this._conn, name);
        } catch {
            invocation.return_dbus_error('org.freedesktop.DBus.Error.InvalidArgs',
                `${service} is not on the bus`);
            return;
        }
        invocation.return_value(null);
        if (!this._impl)
            return;

        const id = `${name}${path}`;
        if (this._items.has(id))
            return;
        const watchId = Gio.bus_watch_name_on_connection(this._conn, name,
            Gio.BusNameWatcherFlags.NONE, null, () => this._remove(id));
        this._items.set(id, watchId);
        this._changed('StatusNotifierItemRegistered', id);
        this._onAdded(id);
    }

    _remove(id) {
        const watchId = this._items.get(id);
        if (watchId === undefined)
            return;
        Gio.bus_unwatch_name(watchId);
        this._items.delete(id);
        this._changed('StatusNotifierItemUnregistered', id);
        this._onRemoved(id);
    }

    _changed(signal, id) {
        this._impl.emit_signal(signal, new GLib.Variant('(s)', [id]));
        this._impl.emit_property_changed('RegisteredStatusNotifierItems',
            new GLib.Variant('as', this.RegisteredStatusNotifierItems));
    }

    destroy() {
        for (const watchId of this._items.values())
            Gio.bus_unwatch_name(watchId);
        this._items.clear();
        this._impl.unexport();
        this._impl = null;
    }
}

export class TrayHost extends Signals.EventEmitter {
    constructor() {
        super();
        this._conn = Gio.DBus.session;
        this._cancellable = new Gio.Cancellable();
        this._items = new Map();
        this._watcher = null;
        this._ownId = 0;
        this._externalSignal = 0;
        this._nameWatch = 0;
    }

    start() {
        this._nameWatch = Gio.bus_watch_name_on_connection(this._conn, WATCHER_NAME,
            Gio.BusNameWatcherFlags.NONE,
            (_c, _name, owner) => {
                if (!this._watcher)
                    this._useExternal(owner);
            },
            () => {
                this._dropExternal();
                this._becomeWatcher();
            });
    }

    destroy() {
        this._cancellable.cancel();
        if (this._nameWatch)
            Gio.bus_unwatch_name(this._nameWatch);
        this._nameWatch = 0;
        this._dropExternal();
        this._dropWatcher();
        for (const id of [...this._items.keys()])
            this._removeItem(id);
    }

    _becomeWatcher() {
        if (this._watcher)
            return;
        try {
            this._watcher = new Watcher(this._conn,
                id => this._addItem(id), id => this._removeItem(id));
        } catch (e) {
            console.warn(`jh-fixes: cannot provide ${WATCHER_NAME}: ${e.message}`);
            return;
        }
        this._ownId = Gio.bus_own_name_on_connection(this._conn, WATCHER_NAME,
            Gio.BusNameOwnerFlags.NONE, null, () => {
                this._dropWatcher();
                uniqueName(this._conn, WATCHER_NAME, this._cancellable)
                    .then(owner => !this._watcher && this._useExternal(owner))
                    .catch(() => {});
            });
    }

    _dropWatcher() {
        if (this._ownId)
            Gio.bus_unown_name(this._ownId);
        this._ownId = 0;
        this._watcher?.destroy();
        this._watcher = null;
    }

    async _useExternal(owner) {
        this._dropExternal();
        this._externalSignal = this._conn.signal_subscribe(owner, WATCHER_NAME, null,
            WATCHER_PATH, null, Gio.DBusSignalFlags.NONE,
            (_c, _sender, _path, _iface, signal, params) => {
                const [id] = params.deepUnpack();
                if (signal === 'StatusNotifierItemRegistered')
                    this._addItem(id);
                else if (signal === 'StatusNotifierItemUnregistered')
                    this._removeItem(id);
            });
        try {
            const reply = await call(this._conn, owner, WATCHER_PATH,
                'org.freedesktop.DBus.Properties', 'Get',
                new GLib.Variant('(ss)', [WATCHER_NAME, 'RegisteredStatusNotifierItems']),
                '(v)', this._cancellable);
            for (const id of reply.deepUnpack()[0].deepUnpack())
                this._addItem(id);
        } catch (e) {
            if (!isCancelled(e))
                console.warn(`jh-fixes: reading tray items failed: ${e.message}`);
        }
    }

    _dropExternal() {
        if (this._externalSignal)
            this._conn.signal_unsubscribe(this._externalSignal);
        this._externalSignal = 0;
    }

    _addItem(id) {
        if (this._items.has(id))
            return;
        const item = new TrayItem(this._conn, id);
        this._items.set(id, item);
        item.connect('vanished', () => this._removeItem(id));
        item.start();
        this.emit('item-added', item);
    }

    _removeItem(id) {
        const item = this._items.get(id);
        if (!item)
            return;
        this._items.delete(id);
        this.emit('item-removed', item);
        item.destroy();
    }
}

class TrayItem extends Signals.EventEmitter {
    constructor(conn, id) {
        super();
        this._conn = conn;
        [this.busName, this.path] = splitId(id);
        this._cancellable = new Gio.Cancellable();
        this._props = {};
        this.ready = false;
        this.app = null;
        this.menu = null;
        this._watchId = 0;
        this._signalId = 0;
        this._refreshId = 0;
    }

    async start() {
        try {
            this.busName = await uniqueName(this._conn, this.busName, this._cancellable);
        } catch (e) {
            if (!isCancelled(e))
                this.emit('vanished');
            return;
        }
        this._watchId = Gio.bus_watch_name_on_connection(this._conn, this.busName,
            Gio.BusNameWatcherFlags.NONE, null, () => this.emit('vanished'));
        this._signalId = this._conn.signal_subscribe(this.busName, null, null,
            this.path, null, Gio.DBusSignalFlags.NONE, () => this._queueRefresh());
        await this._refresh();
        if (!this._cancellable.is_cancelled())
            this.app = await findApp(this, this._cancellable);
        if (!this._cancellable.is_cancelled()) {
            this.ready = true;
            this.emit('changed');
        }
    }

    destroy() {
        this._cancellable.cancel();
        if (this._refreshId)
            GLib.source_remove(this._refreshId);
        this._refreshId = 0;
        if (this._signalId)
            this._conn.signal_unsubscribe(this._signalId);
        this._signalId = 0;
        if (this._watchId)
            Gio.bus_unwatch_name(this._watchId);
        this._watchId = 0;
        this.menu?.destroy();
        this.menu = null;
    }

    _prop(name) {
        try {
            return this._props[name]?.deepUnpack();
        } catch {
            return undefined;
        }
    }

    get id() {
        return this._prop('Id') ?? '';
    }

    get title() {
        return this._prop('Title') ?? '';
    }

    get status() {
        return this._prop('Status') ?? 'Active';
    }

    get iconThemePath() {
        return this._prop('IconThemePath') ?? '';
    }

    get itemIsMenu() {
        return !!this._prop('ItemIsMenu');
    }

    get tooltip() {
        const tip = this._props.ToolTip;
        if (!tip?.get_type_string().startsWith('('))
            return '';
        const [, , title, body] = tip.deepUnpack();
        return [title, body].map(t => stripMarkup(t ?? '')).find(t => t) ?? '';
    }

    get gicon() {
        const attention = this.status === 'NeedsAttention';
        const name = (attention && this._prop('AttentionIconName')) || this._prop('IconName');
        const pixmap = (attention && this._props.AttentionIconPixmap?.n_children()
            ? this._props.AttentionIconPixmap : null) ?? this._props.IconPixmap;
        if (name) {
            if (name.startsWith('/'))
                return Gio.FileIcon.new(Gio.File.new_for_path(name));
            const themePath = this.iconThemePath;
            const file = themePath && findIconFile(themePath, name);
            if (file)
                return Gio.FileIcon.new(file);
            if (!pixmap?.n_children())
                return Gio.ThemedIcon.new_with_default_fallbacks(name);
        }
        return pixmapIcon(pixmap) ??
            (name ? Gio.ThemedIcon.new(name) : Gio.ThemedIcon.new('application-x-executable-symbolic'));
    }

    activate(method = 'Activate') {
        const [x, y] = global.get_pointer();
        return call(this._conn, this.busName, this.path, ITEM_IFACE, method,
            new GLib.Variant('(ii)', [x, y]), null, this._cancellable);
    }

    async pid(cancellable) {
        return busCall(this._conn, 'GetConnectionUnixProcessID',
            new GLib.Variant('(s)', [this.busName]), '(u)', cancellable);
    }

    _queueRefresh() {
        if (this._refreshId)
            return;
        this._refreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REFRESH_DELAY_MS, () => {
            this._refreshId = 0;
            this._refresh().then(() => this.ready && this.emit('changed'));
            return GLib.SOURCE_REMOVE;
        });
    }

    async _refresh() {
        try {
            const reply = await call(this._conn, this.busName, this.path,
                'org.freedesktop.DBus.Properties', 'GetAll',
                new GLib.Variant('(s)', [ITEM_IFACE]), '(a{sv})', this._cancellable);
            this._props = reply.deepUnpack()[0];
        } catch (e) {
            if (!isCancelled(e))
                console.warn(`jh-fixes: reading tray item ${this.busName}${this.path} failed: ${e.message}`);
            return;
        }
        const menuPath = this._prop('Menu');
        if (menuPath && menuPath !== '/' && menuPath !== this.menu?.path) {
            this.menu?.destroy();
            this.menu = new DBusMenu(this._conn, this.busName, menuPath);
        } else if (!menuPath || menuPath === '/') {
            this.menu?.destroy();
            this.menu = null;
        }
    }
}

class DBusMenu extends Signals.EventEmitter {
    constructor(conn, busName, path) {
        super();
        this._conn = conn;
        this._busName = busName;
        this.path = path;
        this._cancellable = new Gio.Cancellable();
        this._changedId = 0;
        this._signalId = conn.signal_subscribe(busName, MENU_IFACE, null, path, null,
            Gio.DBusSignalFlags.NONE, (_c, _s, _p, _i, signal) => {
                if (signal === 'LayoutUpdated' || signal === 'ItemsPropertiesUpdated')
                    this._queueChanged();
            });
    }

    destroy() {
        this._cancellable.cancel();
        if (this._changedId)
            GLib.source_remove(this._changedId);
        this._changedId = 0;
        this._conn.signal_unsubscribe(this._signalId);
    }

    _queueChanged() {
        if (this._changedId)
            return;
        this._changedId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REFRESH_DELAY_MS, () => {
            this._changedId = 0;
            this.emit('changed');
            return GLib.SOURCE_REMOVE;
        });
    }

    _call(method, params, replyType) {
        return call(this._conn, this._busName, this.path, MENU_IFACE, method,
            params, replyType, this._cancellable);
    }

    async layout(parentId = 0) {
        const reply = await this._call('GetLayout',
            new GLib.Variant('(iias)', [parentId, -1, []]), '(u(ia{sv}av))');
        return parseNode(reply.get_child_value(1));
    }

    async aboutToShow(id = 0) {
        try {
            const reply = await this._call('AboutToShow', new GLib.Variant('(i)', [id]), '(b)');
            return reply.deepUnpack()[0];
        } catch {
            return false;
        }
    }

    event(id, type) {
        const data = type === 'clicked' ? new GLib.Variant('i', 0) : new GLib.Variant('s', '');
        this._call('Event',
            new GLib.Variant('(isvu)', [id, type, data, global.get_current_time()]), null)
            .catch(e => {
                if (!isCancelled(e))
                    console.warn(`jh-fixes: tray menu event failed: ${e.message}`);
            });
    }
}

function parseNode(variant) {
    const id = variant.get_child_value(0).get_int32();
    const rawProps = variant.get_child_value(1).deepUnpack();
    const props = {};
    for (const [key, value] of Object.entries(rawProps))
        props[key] = key === 'icon-data' ? value.get_data_as_bytes() : value.recursiveUnpack();
    const childrenVariant = variant.get_child_value(2);
    const children = [];
    for (let i = 0; i < childrenVariant.n_children(); i++)
        children.push(parseNode(childrenVariant.get_child_value(i).get_variant()));
    return {id, props, children};
}

const stripMarkup = text => text.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();

export const stripMnemonic = label => label.replace(/__/g, '\0').replace(/_/g, '')
    .replace(/\0/g, '_');

const iconFileCache = new Map();

function findIconFile(root, name) {
    const key = `${root}\0${name}`;
    if (!iconFileCache.has(key)) {
        if (iconFileCache.size > 64)
            iconFileCache.clear();
        iconFileCache.set(key, searchIconFile(root, name));
    }
    return iconFileCache.get(key);
}

function searchIconFile(root, name) {
    const found = [];
    const walk = (dir, depth) => {
        let children;
        try {
            children = dir.enumerate_children('standard::name,standard::type,standard::size',
                Gio.FileQueryInfoFlags.NONE, null);
        } catch {
            return;
        }
        let info;
        while ((info = children.next_file(null))) {
            const child = dir.get_child(info.get_name());
            if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                if (depth < 4)
                    walk(child, depth + 1);
            } else if (/\.(png|svg|xpm)$/.test(info.get_name()) &&
                       info.get_name().replace(/\.[^.]+$/, '') === name) {
                found.push({file: child, svg: info.get_name().endsWith('.svg'), size: info.get_size()});
            }
        }
        children.close(null);
    };
    walk(Gio.File.new_for_path(root), 0);
    found.sort((a, b) => b.svg - a.svg || b.size - a.size);
    return found[0]?.file ?? null;
}

function pixmapIcon(pixmaps) {
    const n = pixmaps?.n_children() ?? 0;
    const entries = [];
    for (let i = 0; i < n; i++) {
        const entry = pixmaps.get_child_value(i);
        const width = entry.get_child_value(0).get_int32();
        const height = entry.get_child_value(1).get_int32();
        if (width > 0 && height > 0)
            entries.push({entry, width, height});
    }
    if (!entries.length)
        return null;
    entries.sort((a, b) => a.width * a.height - b.width * b.height);
    const {entry, width, height} = entries.find(e => e.width >= PIXMAP_SIZE) ?? entries.at(-1);

    const argb = entry.get_child_value(2).get_data_as_bytes().toArray();
    if (argb.length < width * height * 4)
        return null;
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < rgba.length; i += 4) {
        rgba[i] = argb[i + 1];
        rgba[i + 1] = argb[i + 2];
        rgba[i + 2] = argb[i + 3];
        rgba[i + 3] = argb[i];
    }
    try {
        const pixbuf = GdkPixbuf.Pixbuf.new_from_bytes(new GLib.Bytes(rgba),
            GdkPixbuf.Colorspace.RGB, true, 8, width, height, width * 4);
        const [, png] = pixbuf.save_to_bufferv('png', [], []);
        return Gio.BytesIcon.new(new GLib.Bytes(png));
    } catch {
        return null;
    }
}

function appFromCgroup(pid) {
    let text;
    try {
        const [, bytes] = GLib.file_get_contents(`/proc/${pid}/cgroup`);
        text = new TextDecoder().decode(bytes);
    } catch {
        return null;
    }
    const unit = text.trim().split('\n')[0].split('/').pop();
    let name;
    if (unit.endsWith('.scope'))
        name = unit.slice(0, -'.scope'.length).replace(/-[^-]+$/, '');
    else if (unit.endsWith('.service'))
        name = unit.slice(0, -'.service'.length).replace(/@.*$/, '');
    if (!name?.startsWith('app-'))
        return null;
    const appId = name.slice(4).split('-').pop()
        .replace(/\\x([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    return Shell.AppSystem.get_default().lookup_app(`${appId}.desktop`);
}

async function findApp(item, cancellable) {
    const appSystem = Shell.AppSystem.get_default();
    try {
        const pid = await item.pid(cancellable);
        const app = appFromCgroup(pid) ??
            Shell.WindowTracker.get_default().get_app_from_pid(pid);
        if (app && !app.is_window_backed())
            return app;
    } catch {}

    const flatpakId = item.iconThemePath.match(/\/\.var\/app\/([^/]+)\//)?.[1];
    const flatpakApp = flatpakId && appSystem.lookup_app(`${flatpakId}.desktop`);
    if (flatpakApp)
        return flatpakApp;

    const keys = [item.id, item.id.replace(/_status_icon_\d+$/, ''), item.title, item.tooltip];
    for (const key of keys) {
        if (!key)
            continue;
        const app = appSystem.lookup_desktop_wmclass(key) ?? appSystem.lookup_startup_wmclass(key);
        if (app)
            return app;
    }
    return null;
}
