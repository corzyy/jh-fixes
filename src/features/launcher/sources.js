import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import {calculate, scoreFields} from './match.js';

const WEB_SEARCH = 'https://duckduckgo.com/?q=';

const themedIcon = name => size => new St.Icon({icon_name: name, icon_size: size});
const giconIcon = gicon => size => new St.Icon({gicon, icon_size: size});
const appIcon = app => size => app?.create_icon_texture(size) ??
    new St.Icon({icon_name: 'application-x-executable', icon_size: size});

const SETTINGS_CATEGORY = 'X-GNOME-Settings-Panel';

function appFields(info) {
    const fields = [[info.get_display_name() ?? info.get_name(), 1]];
    const generic = info.get_generic_name?.();
    if (generic)
        fields.push([generic, 0.8]);
    for (const k of info.get_keywords?.() ?? [])
        fields.push([k, 0.75]);
    const exe = info.get_executable?.();
    if (exe)
        fields.push([GLib.path_get_basename(exe), 0.7]);
    return fields;
}

function appItem(app, score, {kind = 'Application', key = 'app'} = {}) {
    const info = app.app_info;
    return {
        id: `${key}:${app.get_id()}`,
        title: app.get_name(),
        subtitle: info?.get_description?.() ?? '',
        kind,
        icon: appIcon(app),
        score,
        action: kind === 'Settings' ? 'Open Settings' : 'Open Application',
        altAction: app.can_open_new_window() && kind !== 'Settings' ? 'New Window' : null,
        activate: alt => {
            if (alt && app.can_open_new_window())
                app.open_new_window(-1);
            else
                app.activate();
        },
    };
}

// Sources live as long as the launcher is enabled and are shared by every popup:
//   warm()     load whatever can be loaded ahead of the first search
//   refresh()  a popup is opening; drop what may have changed since the last one
//   search()   runs on every keystroke, so it only scores what warm() prepared.
//              Items are reused between calls, with `score` set by each search.

// Installed apps, split into Settings panels and everything else.
class AppSource {
    static panels = false;
    static itemOptions = {};

    constructor() {
        this._entries = null;
        this._appSys = Shell.AppSystem.get_default();
        this._appSys.connectObject('installed-changed', () => (this._entries = null), this);
    }

    destroy() {
        this._appSys.disconnectObject(this);
    }

    warm() {
        this._entries ??= this._load();
    }

    // What an app offers (a new window, say) depends on whether it's running.
    refresh() {
        for (const entry of this._entries ?? [])
            entry.item = null;
    }

    _load() {
        const {panels} = this.constructor;
        const entries = [];
        for (const info of this._appSys.get_installed()) {
            const panel = (info.get_categories?.() ?? '').split(';').includes(SETTINGS_CATEGORY);
            if (panel !== panels || (!panels && !info.should_show()))
                continue;
            const app = this._appSys.lookup_app(info.get_id());
            if (app)
                entries.push({app, id: app.get_id(), fields: appFields(info), item: null});
        }
        return entries;
    }

    _score(s) {
        return s;
    }

    search(query) {
        this.warm();
        const results = [];
        for (const entry of this._entries) {
            const s = scoreFields(query, entry.fields);
            if (s === null)
                continue;
            const item = entry.item ??= appItem(entry.app, 0, this.constructor.itemOptions);
            item.score = this._score(s, entry);
            results.push(item);
        }
        return results;
    }
}

class Apps extends AppSource {
    static key = 'launcher-apps';
    static section = 'Applications';

    refresh() {
        super.refresh();
        this._usage = null;
    }

    _score(s, entry) {
        this._usage ??= new Map(Shell.AppUsage.get_default().get_most_used()
            .map((app, rank) => [app.get_id(), Math.max(0, 60 - rank * 3)]));
        return s + (this._usage.get(entry.id) ?? 0);
    }

    empty() {
        return Shell.AppUsage.get_default().get_most_used()
            .filter(app => app.app_info?.should_show())
            .map((app, i) => appItem(app, 1000 - i));
    }
}

class SettingsPanels extends AppSource {
    static key = 'launcher-settings-panels';
    static section = 'Settings';
    static panels = true;
    static itemOptions = {kind: 'Settings', key: 'settings'};

    _score(s) {
        return s * 0.9;
    }
}

class Windows {
    static key = 'launcher-windows';
    static section = 'Open Windows';

    refresh() {
        this._entries = null;
    }

    _load() {
        const tracker = Shell.WindowTracker.get_default();
        return global.display.get_tab_list(Meta.TabList.NORMAL, null)
            .filter(win => !win.skip_taskbar)
            .map(win => {
                const app = tracker.get_window_app(win);
                return {win, app, fields: [[win.get_title(), 1], [app?.get_name(), 0.9]], item: null};
            });
    }

    _item(win, app) {
        const ws = win.get_workspace();
        const wsName = ws && global.workspace_manager.n_workspaces > 1
            ? ` · Workspace ${ws.index() + 1}` : '';
        return {
            id: null,
            key: `window:${win.get_id()}`,
            title: win.get_title() || app?.get_name() || 'Window',
            subtitle: `${app?.get_name() ?? ''}${wsName}${win.minimized ? ' · Minimised' : ''}`,
            kind: 'Window',
            icon: appIcon(app),
            score: 0,
            action: 'Switch to Window',
            altAction: win.can_close() ? 'Close Window' : null,
            activate: alt => {
                if (alt)
                    win.delete(global.get_current_time());
                else
                    Main.activateWindow(win);
            },
        };
    }

    search(query) {
        this._entries ??= this._load();
        const results = [];
        for (const entry of this._entries) {
            const s = scoreFields(query, entry.fields);
            if (s === null)
                continue;
            const item = entry.item ??= this._item(entry.win, entry.app);
            item.score = s * 0.95;
            results.push(item);
        }
        return results;
    }
}

class System {
    static key = 'launcher-system-actions';
    static section = 'System';

    static all() {
        const actions = SystemActions.getDefault();
        const items = [];
        for (const [id, action] of actions._actions ?? []) {
            if (!action.available || !action.name)
                continue;
            items.push({
                id: `system:${id}`,
                title: action.name,
                subtitle: '',
                kind: 'System',
                icon: themedIcon(action.iconName),
                score: 0,
                fields: [[action.name, 1], [id.replace(/-/g, ' '), 0.85], ...action.keywords.map(k => [k, 0.8])],
                action: 'Run',
                deferred: true,
                activate: () => actions.activateAction(id),
            });
        }
        return items;
    }

    // Which actions are available can change between popups.
    refresh() {
        this._items = null;
    }

    search(query) {
        this._items ??= System.all();
        const results = [];
        for (const item of this._items) {
            const s = scoreFields(query, item.fields);
            if (s === null)
                continue;
            item.score = s * 0.9;
            results.push(item);
        }
        return results;
    }
}

function tildify(path) {
    const home = GLib.get_home_dir();
    return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

const XBEL = GLib.build_filenamev([GLib.get_user_data_dir(), 'recently-used.xbel']);
const MAX_FILES = 300;

const XML_ENTITIES = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};

function unescapeXml(s) {
    return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) =>
        XML_ENTITIES[e] ?? String.fromCodePoint(e[1] === 'x' || e[1] === 'X'
            ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
}

// The newest MAX_FILES local files of a recently-used.xbel.
function parseRecentFiles(text) {
    const re = /<bookmark href="([^"]+)"[^>]*?modified="([^"]+)"[^>]*>[\s\S]*?<mime:mime-type type="([^"]+)"/g;
    const seen = new Map();
    for (const m of text.matchAll(re)) {
        const uri = unescapeXml(m[1]);
        if (!uri.startsWith('file://'))
            continue;
        seen.set(uri, {uri, modified: Date.parse(m[2]) || 0, mime: m[3]});
    }
    const files = [...seen.values()].sort((a, b) => b.modified - a.modified).slice(0, MAX_FILES);
    for (const f of files) {
        const file = Gio.File.new_for_uri(f.uri);
        f.file = file;
        f.name = file.get_basename();
        f.dir = tildify(file.get_parent()?.get_path() ?? '');
        f.fields = [[f.name, 1], [f.dir, 0.5]];
        f.item = null;
    }
    return files;
}

function fileItem(f) {
    return {
        id: `file:${f.uri}`,
        title: f.name,
        subtitle: f.dir,
        kind: 'File',
        icon: giconIcon(Gio.content_type_get_icon(f.mime)),
        score: 0,
        action: f.mime === 'inode/directory' ? 'Open Folder' : 'Open File',
        altAction: 'Show in Folder',
        // Blocking I/O, so only asked of results that are about to be shown, and
        // once per popup.
        valid: () => (f.exists ??= f.file.query_exists(null)),
        activate: alt => {
            const uri = alt ? f.file.get_parent()?.get_uri() : f.uri;
            if (uri)
                Gio.AppInfo.launch_default_for_uri_async(uri, global.create_app_launch_context(0, -1), null, null);
        },
    };
}

class RecentFiles {
    static key = 'launcher-files';
    static section = 'Recent Files';

    constructor() {
        this._files = null;
        this._xbel = Gio.File.new_for_path(XBEL);
        try {
            this._monitor = this._xbel.monitor_file(Gio.FileMonitorFlags.NONE, null);
            this._monitor.connect('changed', () => this._reload());
        } catch {
            this._monitor = null;
        }
    }

    destroy() {
        this._destroyed = true;
        this._monitor?.cancel();
        this._monitor = null;
    }

    warm() {
        if (!this._files)
            this._reload();
    }

    refresh() {
        for (const f of this._files ?? [])
            f.exists = undefined;
        // Without a monitor there's no telling whether the list is still current.
        if (!this._monitor)
            this._reload();
    }

    // Read in the background; searches keep using the old list until it's in.
    _reload() {
        if (this._loading) {
            this._stale = true;
            return;
        }
        this._loading = true;
        this._xbel.load_contents_async(null, (file, res) => {
            this._loading = false;
            let text = '';
            try {
                text = new TextDecoder().decode(file.load_contents_finish(res)[1]);
            } catch {}
            if (this._destroyed)
                return;
            this._files = parseRecentFiles(text);
            if (this._stale) {
                this._stale = false;
                this._reload();
            }
        });
    }

    _loadNow() {
        try {
            return parseRecentFiles(new TextDecoder().decode(GLib.file_get_contents(XBEL)[1]));
        } catch {
            return [];
        }
    }

    search(query) {
        // Only when a search beats the background load.
        this._files ??= this._loadNow();
        const results = [];
        for (const f of this._files) {
            const s = scoreFields(query, f.fields);
            if (s === null)
                continue;
            const item = f.item ??= fileItem(f);
            item.score = s * 0.8;
            results.push(item);
        }
        return results;
    }
}

class Calculator {
    static key = 'launcher-calculator';
    static section = 'Calculator';

    search(query, raw) {
        const value = calculate(raw);
        if (value === null)
            return [];
        return [{
            id: null,
            key: 'calculator',
            title: value,
            subtitle: raw.trim(),
            kind: 'Calculator',
            icon: themedIcon('accessories-calculator-symbolic'),
            score: 5000,
            action: 'Copy Result',
            activate: () => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, value),
        }];
    }
}

const SOURCES = [Calculator, Apps, Windows, SettingsPanels, System, RecentFiles];

export class Sources {
    constructor() {
        this._sources = SOURCES.map(S => ({key: S.key, section: S.section, impl: new S()}));
    }

    enabled(settings) {
        return this._sources.filter(s => settings.get_boolean(s.key));
    }

    warm(settings) {
        for (const {impl} of this.enabled(settings))
            impl.warm?.();
    }

    refresh() {
        for (const {impl} of this._sources)
            impl.refresh?.();
    }

    destroy() {
        for (const {impl} of this._sources)
            impl.destroy?.();
    }
}

export function commandItem(command) {
    return {
        id: `command:${command}`,
        key: 'command',
        title: command || 'Type a command…',
        subtitle: 'Shell command',
        kind: 'Command',
        icon: themedIcon('utilities-terminal-symbolic'),
        score: 0,
        action: 'Run Command',
        disabled: !command,
        activate: () => Util.trySpawnCommandLine(command),
    };
}

export function webItem(raw) {
    const query = raw.trim();
    return {
        id: null,
        key: 'web',
        title: `Search for “${query}”`,
        subtitle: 'DuckDuckGo',
        kind: 'Web',
        icon: themedIcon('web-browser-symbolic'),
        score: -1,
        action: 'Search the Web',
        activate: () => Gio.AppInfo.launch_default_for_uri_async(WEB_SEARCH + encodeURIComponent(query),
            global.create_app_launch_context(0, -1), null, null),
    };
}

export function historyItem(id) {
    const sep = id.indexOf(':');
    const [key, value] = [id.slice(0, sep), id.slice(sep + 1)];
    switch (key) {
    case 'app':
    case 'settings': {
        const app = Shell.AppSystem.get_default().lookup_app(value);
        return app ? appItem(app, 0, key === 'settings' ? {kind: 'Settings', key} : {}) : null;
    }
    case 'system':
        return System.all().find(i => i.id === id) ?? null;
    case 'file': {
        const file = Gio.File.new_for_uri(value);
        if (!file.query_exists(null))
            return null;
        let mime = 'application/octet-stream';
        try {
            mime = file.query_info('standard::content-type', 0, null).get_content_type();
        } catch {}
        const dir = tildify(file.get_parent()?.get_path() ?? '');
        return fileItem({uri: value, file, name: file.get_basename(), dir, mime});
    }
    case 'command':
        return commandItem(value);
    default:
        return null;
    }
}
