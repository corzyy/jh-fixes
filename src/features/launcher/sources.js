import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import {calculate, fold, scoreFields} from './match.js';

export const WEB_ENGINES = {
    duckduckgo: ['DuckDuckGo', 'https://duckduckgo.com/?q=%s'],
    google: ['Google', 'https://www.google.com/search?q=%s'],
    bing: ['Bing', 'https://www.bing.com/search?q=%s'],
    startpage: ['Startpage', 'https://www.startpage.com/do/search?q=%s'],
    brave: ['Brave Search', 'https://search.brave.com/search?q=%s'],
    ecosia: ['Ecosia', 'https://www.ecosia.org/search?q=%s'],
};

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

class Apps {
    static key = 'launcher-apps';
    static section = 'Applications';

    constructor(ctx) {
        this._ctx = ctx;
        this._entries = null;
    }

    _load() {
        const appSys = Shell.AppSystem.get_default();
        const usage = Shell.AppUsage.get_default();
        const ranked = usage.get_most_used().map(a => a.get_id());
        this._entries = [];
        for (const info of appSys.get_installed()) {
            const categories = info.get_categories?.() ?? '';
            if (!info.should_show() || categories.split(';').includes(SETTINGS_CATEGORY))
                continue;
            const app = appSys.lookup_app(info.get_id());
            if (!app)
                continue;
            const rank = ranked.indexOf(app.get_id());
            this._entries.push({app, fields: appFields(info), usage: rank < 0 ? 0 : Math.max(0, 60 - rank * 3)});
        }
    }

    search(query) {
        if (!this._entries)
            this._load();
        const results = [];
        for (const {app, fields, usage} of this._entries) {
            const s = scoreFields(query, fields);
            if (s !== null)
                results.push(appItem(app, s + (this._ctx.byUsage ? usage : 0)));
        }
        return results;
    }

    empty() {
        return Shell.AppUsage.get_default().get_most_used()
            .filter(app => app.app_info?.should_show())
            .map((app, i) => appItem(app, 1000 - i));
    }
}

class SettingsPanels {
    static key = 'launcher-settings-panels';
    static section = 'Settings';

    constructor() {
        this._entries = null;
    }

    search(query) {
        const appSys = Shell.AppSystem.get_default();
        this._entries ??= appSys.get_installed()
            .filter(info => (info.get_categories?.() ?? '').split(';').includes(SETTINGS_CATEGORY))
            .map(info => ({app: appSys.lookup_app(info.get_id()), fields: appFields(info)}))
            .filter(e => e.app);
        const results = [];
        for (const {app, fields} of this._entries) {
            const s = scoreFields(query, fields);
            if (s !== null)
                results.push(appItem(app, s * 0.9, {kind: 'Settings', key: 'settings'}));
        }
        return results;
    }
}

class Windows {
    static key = 'launcher-windows';
    static section = 'Open Windows';

    constructor(ctx) {
        this._ctx = ctx;
    }

    _windows() {
        const workspace = this._ctx.windowScope === 'workspace'
            ? global.workspace_manager.get_active_workspace() : null;
        return global.display.get_tab_list(Meta.TabList.NORMAL, workspace)
            .filter(w => !w.skip_taskbar);
    }

    _item(win, score) {
        const app = Shell.WindowTracker.get_default().get_window_app(win);
        const ws = win.get_workspace();
        const wsName = ws && global.workspace_manager.n_workspaces > 1
            ? ` · Workspace ${ws.index() + 1}` : '';
        return {
            id: null,
            title: win.get_title() ?? app?.get_name() ?? 'Window',
            subtitle: `${app?.get_name() ?? ''}${wsName}${win.minimized ? ' · Minimised' : ''}`,
            kind: 'Window',
            icon: appIcon(app),
            score,
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
        const tracker = Shell.WindowTracker.get_default();
        const results = [];
        for (const win of this._windows()) {
            const app = tracker.get_window_app(win);
            const s = scoreFields(query, [[win.get_title(), 1], [app?.get_name(), 0.9]]);
            if (s !== null)
                results.push(this._item(win, s * 0.95));
        }
        return results;
    }

    empty() {
        return this._windows().slice(1).map((w, i) => this._item(w, 500 - i));
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

    search(query) {
        const results = [];
        for (const item of System.all()) {
            const s = scoreFields(query, item.fields);
            if (s !== null)
                results.push({...item, score: s * 0.9});
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

function unescapeXml(s) {
    return s.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (_, e) => ({
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    })[e] ?? String.fromCodePoint(parseInt(e.slice(1), 10)));
}

class RecentFiles {
    static key = 'launcher-files';
    static section = 'Recent Files';

    constructor() {
        this._files = null;
    }

    _load() {
        this._files = [];
        let text;
        try {
            text = new TextDecoder().decode(GLib.file_get_contents(XBEL)[1]);
        } catch {
            return;
        }
        const re = /<bookmark href="([^"]+)"[^>]*?modified="([^"]+)"[^>]*>[\s\S]*?<mime:mime-type type="([^"]+)"/g;
        const seen = new Map();
        for (const m of text.matchAll(re)) {
            const uri = unescapeXml(m[1]);
            if (!uri.startsWith('file://'))
                continue;
            seen.set(uri, {uri, modified: Date.parse(m[2]) || 0, mime: m[3]});
        }
        this._files = [...seen.values()].sort((a, b) => b.modified - a.modified).slice(0, MAX_FILES);
        for (const f of this._files) {
            const file = Gio.File.new_for_uri(f.uri);
            f.file = file;
            f.name = file.get_basename();
            const parent = file.get_parent()?.get_path() ?? '';
            f.dir = tildify(parent);
        }
    }

    _item(f, score) {
        return {
            id: `file:${f.uri}`,
            title: f.name,
            subtitle: f.dir,
            kind: 'File',
            icon: giconIcon(Gio.content_type_get_icon(f.mime)),
            score,
            action: f.mime === 'inode/directory' ? 'Open Folder' : 'Open File',
            altAction: 'Show in Folder',
            activate: alt => {
                const uri = alt ? f.file.get_parent()?.get_uri() : f.uri;
                if (uri)
                    Gio.AppInfo.launch_default_for_uri_async(uri, global.create_app_launch_context(0, -1), null, null);
            },
        };
    }

    search(query) {
        if (!this._files)
            this._load();
        const results = [];
        for (const f of this._files) {
            const s = scoreFields(query, [[f.name, 1], [f.dir, 0.5]]);
            if (s !== null && f.file.query_exists(null))
                results.push(this._item(f, s * 0.8));
            if (results.length >= 30)
                break;
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
            title: value,
            subtitle: raw.trim(),
            kind: 'Calculator',
            icon: themedIcon('accessories-calculator-symbolic'),
            score: 5000,
            action: 'Copy Result',
            keepOrder: true,
            activate: () => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, value),
        }];
    }
}

export const SOURCES = [Calculator, Apps, Windows, SettingsPanels, System, RecentFiles];

export function commandItem(command) {
    return {
        id: `command:${command}`,
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

export function webItem(raw, engine, customUrl) {
    const [name, defaultUrl] = WEB_ENGINES[engine] ?? ['the web', customUrl];
    const url = (engine === 'custom' ? customUrl : defaultUrl) || WEB_ENGINES.duckduckgo[1];
    const host = engine === 'custom' ? (GLib.Uri.peek_scheme(url) ? url.split('/')[2] : url) : name;
    return {
        id: null,
        title: `Search for “${raw.trim()}”`,
        subtitle: host,
        kind: 'Web',
        icon: themedIcon('web-browser-symbolic'),
        score: -1,
        action: 'Search the Web',
        activate: () => {
            const target = url.includes('%s')
                ? url.replace('%s', encodeURIComponent(raw.trim()))
                : url + encodeURIComponent(raw.trim());
            Gio.AppInfo.launch_default_for_uri_async(target, global.create_app_launch_context(0, -1), null, null);
        },
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
        return new RecentFiles()._item({uri: value, file, name: file.get_basename(), dir, mime}, 0);
    }
    case 'command':
        return commandItem(value);
    default:
        return null;
    }
}
