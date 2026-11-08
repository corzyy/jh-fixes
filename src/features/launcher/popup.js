import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ensureActorVisibleInScrollView} from 'resource:///org/gnome/shell/misc/animationUtils.js';

import {SOURCES, commandItem, historyItem, webItem} from './sources.js';
import {fold} from './match.js';

const HISTORY_KEY = 'launcher-history';
const HISTORY_SIZE = 40;
const OPEN_TIME = 120;

const VERTICAL = {orientation: Clutter.Orientation.VERTICAL};

function readConfig(s) {
    return {
        width: s.get_int('launcher-width'),
        position: s.get_string('launcher-position'),
        monitor: s.get_string('launcher-monitor'),
        visibleRows: s.get_int('launcher-visible-rows'),
        maxResults: s.get_int('launcher-max-results'),
        grouped: s.get_boolean('launcher-group-results'),
        iconSize: s.get_int('launcher-icon-size'),
        subtitles: s.get_boolean('launcher-show-subtitles'),
        kinds: s.get_boolean('launcher-show-kind'),
        footer: s.get_boolean('launcher-show-footer'),
        escape: s.get_string('launcher-escape'),
        emptyState: s.get_string('launcher-empty-state'),
        history: s.get_boolean('launcher-remember-history'),
        byUsage: s.get_boolean('launcher-rank-by-usage'),
        windowScope: s.get_string('launcher-window-scope'),
        commands: s.get_boolean('launcher-commands'),
        commandPrefix: s.get_string('launcher-command-prefix') || '>',
        web: s.get_boolean('launcher-web-search'),
        webEngine: s.get_string('launcher-web-search-engine'),
        webUrl: s.get_string('launcher-web-search-url'),
        webWhen: s.get_string('launcher-web-search-when'),
    };
}

function key(label) {
    return new St.Label({text: label, style_class: 'jh-launcher-key', y_align: Clutter.ActorAlign.CENTER});
}

export class LauncherPopup {
    constructor(settings, {initialQuery = '', selectQuery = true, closeWhenEmpty = false, onClosed}) {
        this._closeWhenEmpty = closeWhenEmpty;
        this._settings = settings;
        this._onClosed = onClosed;
        this._cfg = readConfig(settings);
        this._sources = SOURCES
            .filter(S => settings.get_boolean(S.key))
            .map(S => ({section: S.section, impl: new S(this._cfg)}));
        this._historyIds = this._cfg.history ? settings.get_strv(HISTORY_KEY) : [];
        this._rows = [];
        this._selected = -1;
        this._pointerMoved = false;
        this._buildUi(initialQuery, selectQuery);
    }

    get query() {
        return this._finalQuery ?? this._entry.text;
    }

    _buildUi(initialQuery, selectQuery) {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;

        this._backdrop = new St.Widget({
            style_class: 'jh-launcher-backdrop',
            reactive: true,
            x: 0, y: 0,
            width: global.stage.width,
            height: global.stage.height,
        });
        this._backdrop.connect('button-press-event', (_a, event) => {
            if (global.stage.get_event_actor(event) === this._backdrop)
                this.close();
            return Clutter.EVENT_PROPAGATE;
        });
        this._backdrop.connect('motion-event', () => {
            this._pointerMoved = true;
            return Clutter.EVENT_PROPAGATE;
        });

        this._dialog = new St.BoxLayout({
            ...VERTICAL,
            style_class: 'jh-launcher',
            width: this._cfg.width * scale,
            reactive: true,
        });
        this._backdrop.add_child(this._dialog);

        const header = new St.BoxLayout({style_class: 'jh-launcher-header'});
        header.add_child(new St.Icon({
            icon_name: 'system-search-symbolic',
            icon_size: 18,
            style_class: 'jh-launcher-header-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._entry = new St.Entry({
            style_class: 'jh-launcher-entry',
            hint_text: this._hintText(),
            can_focus: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._entry);
        this._modeChip = new St.Label({
            style_class: 'jh-launcher-mode',
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        header.add_child(this._modeChip);
        this._dialog.add_child(header);

        this._separator = new St.Widget({style_class: 'jh-launcher-separator'});
        this._dialog.add_child(this._separator);

        this._list = new St.BoxLayout({...VERTICAL, style_class: 'jh-launcher-list', x_expand: true});
        this._scroll = new St.ScrollView({
            style_class: 'jh-launcher-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            child: this._list,
        });
        this._dialog.add_child(this._scroll);

        this._footer = new St.BoxLayout({style_class: 'jh-launcher-footer', visible: this._cfg.footer});
        this._status = new St.Label({
            style_class: 'jh-launcher-footer-status',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._footer.add_child(this._status);
        this._actionLabel = new St.Label({style_class: 'jh-launcher-footer-action', y_align: Clutter.ActorAlign.CENTER});
        this._actionKey = key('↵');
        this._altLabel = new St.Label({style_class: 'jh-launcher-footer-action', y_align: Clutter.ActorAlign.CENTER});
        this._altKey = key('⇧ ↵');
        [this._actionLabel, this._actionKey, this._altLabel, this._altKey]
            .forEach(w => this._footer.add_child(w));
        this._dialog.add_child(this._footer);

        const text = this._entry.clutter_text;
        if (initialQuery) {
            this._entry.text = initialQuery;
            if (selectQuery)
                text.set_selection(0, initialQuery.length);
            else
                text.set_cursor_position(-1);
        }
        text.connect('text-changed', () => {
            // Opened by typing in the Overview: deleting everything goes back to it, like GNOME's search.
            if (this._closeWhenEmpty && !this._entry.text) {
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    if (!this._entry.text)
                        this.close();
                    return GLib.SOURCE_REMOVE;
                });
                return;
            }
            this._update();
        });
        text.connect('key-press-event', (_a, event) => this._onKey(event));
        // With an input method (IBus) running, Enter usually arrives only as 'activate'.
        text.connect('activate', () => {
            const [, , mods] = global.get_pointer();
            this._activate(this._selected, (mods & Clutter.ModifierType.SHIFT_MASK) !== 0);
        });
        text.connect('key-release-event', (_a, event) => {
            const sym = event.get_key_symbol();
            if (sym === Clutter.KEY_Alt_L || sym === Clutter.KEY_Alt_R)
                this._showQuickHints(false);
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _hintText() {
        const parts = [];
        if (this._sources.some(s => s.section === 'Applications'))
            parts.push('apps');
        if (this._sources.some(s => s.section === 'Open Windows'))
            parts.push('windows');
        if (this._sources.some(s => s.section === 'Recent Files'))
            parts.push('files');
        if (!parts.length)
            return 'Search…';
        const last = parts.pop();
        return `Search ${parts.length ? `${parts.join(', ')} and ${last}` : last}…`;
    }

    open() {
        Main.layoutManager.modalDialogGroup.add_child(this._backdrop);
        this._grab = Main.pushModal(this._backdrop, {actionMode: Shell.ActionMode.POPUP});
        this._backdrop.connect('destroy', () => this._finish());

        this._update();
        this._place();
        this._entry.grab_key_focus();

        this._dialog.set_pivot_point(0.5, 0.5);
        this._dialog.opacity = 0;
        this._dialog.scale_x = this._dialog.scale_y = 0.97;
        this._backdrop.opacity = 0;
        this._backdrop.ease({opacity: 255, duration: OPEN_TIME, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._dialog.ease({
            opacity: 255, scale_x: 1, scale_y: 1,
            duration: OPEN_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        return true;
    }

    close() {
        if (this._closing || this._finished)
            return;
        this._closing = true;
        this._finalQuery = this._entry.text;
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this._backdrop.destroy();
    }

    _finish() {
        if (this._finished)
            return;
        this._finished = true;
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this._onClosed?.(this);
    }

    _monitor() {
        const lm = Main.layoutManager;
        switch (this._cfg.monitor) {
        case 'primary':
            return lm.primaryMonitor;
        case 'pointer':
            return lm.currentMonitor;
        default:
            return lm.focusMonitor ?? lm.currentMonitor;
        }
    }

    _place() {
        const m = this._monitor();
        if (!m)
            return;
        const width = Math.min(this._dialog.width, m.width - 32);
        this._dialog.width = width;
        const x = m.x + Math.round((m.width - width) / 2);
        let y;
        if (this._cfg.position === 'center') {
            const [, natural] = this._dialog.get_preferred_height(width);
            const [, list] = this._scroll.visible ? this._scroll.get_preferred_height(width) : [0, 0];
            const tallest = natural - list + this._listMaxHeight();
            y = m.y + Math.round((m.height - tallest) / 2);
        } else {
            y = m.y + Math.round(m.height * 0.2);
        }
        this._dialog.set_position(x, Math.max(m.y, y));
    }

    _rowHeight() {
        if (!this._measuredRow) {
            const probe = this._buildRow({title: 'Xy', subtitle: 'Xy', kind: '', icon: () => new St.Icon({icon_size: this._cfg.iconSize})}, -1);
            this._list.add_child(probe);
            this._measuredRow = probe.get_preferred_height(-1)[1];
            probe.destroy();
        }
        return this._measuredRow;
    }

    _listMaxHeight() {
        return Math.round(this._rowHeight() * this._cfg.visibleRows + 14 * St.ThemeContext.get_for_stage(global.stage).scale_factor);
    }

    // ---------- search ----------

    _historyBonus(id) {
        if (!id)
            return 0;
        const i = this._historyIds.indexOf(id);
        return i < 0 ? 0 : 120 - i * 2;
    }

    _collect() {
        const raw = this._entry.text;
        const cfg = this._cfg;

        if (cfg.commands && raw.startsWith(cfg.commandPrefix)) {
            const command = raw.slice(cfg.commandPrefix.length).trim();
            return {mode: 'Run', groups: [['Command', [commandItem(command)]]]};
        }

        const query = fold(raw.trim());
        if (!query)
            return {mode: null, groups: this._emptyGroups()};

        const groups = [];
        for (const {section, impl} of this._sources) {
            let items;
            try {
                items = impl.search(query, raw);
            } catch (e) {
                console.error(`jh-fixes: launcher source ${section} failed`, e);
                continue;
            }
            for (const item of items)
                item.score += this._historyBonus(item.id);
            items.sort((a, b) => b.score - a.score);
            if (items.length)
                groups.push([section, items]);
        }

        let result;
        if (cfg.grouped) {
            result = groups
                .map(([section, items]) => [section, items.slice(0, cfg.maxResults)])
                .sort((a, b) => b[1][0].score - a[1][0].score);
        } else {
            const all = groups.flatMap(([, items]) => items).sort((a, b) => b.score - a.score);
            result = all.length ? [['Results', all.slice(0, cfg.maxResults * 3)]] : [];
        }

        if (cfg.web && (cfg.webWhen === 'always' || !result.length))
            result.push(['Web', [webItem(raw, cfg.webEngine, cfg.webUrl)]]);
        return {mode: null, groups: result};
    }

    _emptyGroups() {
        const cfg = this._cfg;
        const limit = Math.max(cfg.visibleRows, cfg.maxResults);
        if (cfg.emptyState === 'none')
            return [];
        if (cfg.emptyState === 'recent' && this._historyIds.length) {
            const items = [];
            for (const id of this._historyIds) {
                try {
                    const item = historyItem(id);
                    if (item)
                        items.push(item);
                } catch {}
                if (items.length >= limit)
                    break;
            }
            if (items.length)
                return [['Recent', items]];
        }
        const apps = this._sources.find(s => s.section === 'Applications');
        const items = apps?.impl.empty().slice(0, limit) ?? [];
        return items.length ? [['Suggestions', items]] : [];
    }

    _update() {
        const {mode, groups} = this._collect();
        this._modeChip.visible = !!mode;
        this._modeChip.text = mode ?? '';

        this._list.destroy_all_children();
        this._rows = [];
        this._pointerMoved = false;

        const showHeaders = this._cfg.grouped || groups.length > 1;
        for (const [section, items] of groups) {
            if (showHeaders)
                this._list.add_child(new St.Label({text: section, style_class: 'jh-launcher-section'}));
            for (const item of items) {
                const index = this._rows.length;
                const actor = this._buildRow(item, index);
                this._list.add_child(actor);
                this._rows.push({item, actor});
            }
        }

        const hasRows = this._rows.length > 0;
        const query = this._entry.text.trim();
        if (!hasRows && query) {
            this._list.add_child(new St.Label({
                text: 'No results',
                style_class: 'jh-launcher-empty',
                x_align: Clutter.ActorAlign.CENTER,
            }));
        }
        const showList = hasRows || !!query;
        this._scroll.visible = showList;
        this._separator.visible = showList;
        this._scroll.style = `max-height: ${this._listMaxHeight()}px;`;

        this._status.text = mode === 'Run' ? 'Command mode' : hasRows
            ? `${this._rows.length} result${this._rows.length === 1 ? '' : 's'}`
            : '';
        this._select(hasRows ? 0 : -1);
    }

    _buildRow(item, index) {
        const cfg = this._cfg;
        const button = new St.Button({
            style_class: 'jh-launcher-row',
            reactive: index >= 0,
            can_focus: false,
            track_hover: true,
            x_expand: true,
        });
        const box = new St.BoxLayout({style_class: 'jh-launcher-row-box', x_expand: true});
        button.child = box;

        const icon = item.icon(cfg.iconSize);
        icon.y_align = Clutter.ActorAlign.CENTER;
        box.add_child(icon);

        const text = new St.BoxLayout({...VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        const title = new St.Label({text: item.title, style_class: 'jh-launcher-title'});
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        text.add_child(title);
        if (cfg.subtitles && item.subtitle) {
            const sub = new St.Label({text: item.subtitle, style_class: 'jh-launcher-subtitle'});
            sub.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            text.add_child(sub);
        }
        box.add_child(text);

        if (index >= 0 && index < 9) {
            const hint = new St.Label({
                text: `Alt ${index + 1}`,
                style_class: 'jh-launcher-shortcut-hint',
                y_align: Clutter.ActorAlign.CENTER,
                visible: false,
            });
            button._jhHint = hint;
            box.add_child(hint);
        }
        if (cfg.kinds && item.kind) {
            box.add_child(new St.Label({
                text: item.kind,
                style_class: 'jh-launcher-kind',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }

        if (index >= 0) {
            button.connect('notify::hover', () => {
                if (button.hover && this._pointerMoved)
                    this._select(index, false);
            });
            button.connect('clicked', () => {
                const [, , mods] = global.get_pointer();
                this._activate(index, (mods & Clutter.ModifierType.SHIFT_MASK) !== 0);
            });
        }
        return button;
    }

    _select(index, scroll = true) {
        const old = this._rows[this._selected];
        old?.actor.remove_style_class_name('selected');
        this._selected = index;
        const row = this._rows[index];
        row?.actor.add_style_class_name('selected');
        if (row && scroll)
            ensureActorVisibleInScrollView(this._scroll, row.actor);
        this._syncFooter(row?.item);
    }

    _syncFooter(item) {
        this._actionLabel.text = item?.action ?? '';
        this._actionLabel.visible = this._actionKey.visible = !!item && !item.disabled;
        this._altLabel.text = item?.altAction ?? '';
        this._altLabel.visible = this._altKey.visible = !!item?.altAction;
    }

    _move(delta, wrap = true) {
        const n = this._rows.length;
        if (!n)
            return;
        let next = this._selected + delta;
        if (wrap)
            next = ((next % n) + n) % n;
        else
            next = Math.max(0, Math.min(n - 1, next));
        this._select(next);
    }

    _showQuickHints(show) {
        for (const {actor} of this._rows)
            if (actor._jhHint)
                actor._jhHint.visible = show;
    }

    _onKey(event) {
        const sym = event.get_key_symbol();
        const state = event.get_state();
        const ctrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const alt = (state & Clutter.ModifierType.MOD1_MASK) !== 0;
        const shift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;
        const page = Math.max(1, this._cfg.visibleRows - 1);

        if (sym === Clutter.KEY_Alt_L || sym === Clutter.KEY_Alt_R) {
            this._showQuickHints(true);
            return Clutter.EVENT_PROPAGATE;
        }

        switch (sym) {
        case Clutter.KEY_Escape:
            if (this._cfg.escape === 'clear' && this._entry.text)
                this._entry.text = '';
            else
                this.close();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Up:
        case Clutter.KEY_ISO_Left_Tab:
            this._move(-1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Down:
            this._move(1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Tab:
            this._move(shift ? -1 : 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Up:
            this._move(-page, false);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Down:
            this._move(page, false);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
        case Clutter.KEY_ISO_Enter:
            this._activate(this._selected, shift);
            return Clutter.EVENT_STOP;
        }

        if (ctrl && !alt) {
            if (sym === Clutter.KEY_n || sym === Clutter.KEY_j) {
                this._move(1);
                return Clutter.EVENT_STOP;
            }
            if (sym === Clutter.KEY_p || sym === Clutter.KEY_k) {
                this._move(-1);
                return Clutter.EVENT_STOP;
            }
        }

        if (alt && sym >= Clutter.KEY_1 && sym <= Clutter.KEY_9) {
            const index = sym - Clutter.KEY_1;
            if (index < this._rows.length)
                this._activate(index, shift);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _remember(id) {
        if (!id || !this._cfg.history)
            return;
        const ids = this._settings.get_strv(HISTORY_KEY).filter(x => x !== id);
        ids.unshift(id);
        this._settings.set_strv(HISTORY_KEY, ids.slice(0, HISTORY_SIZE));
    }

    _activate(index, alt) {
        const row = this._rows[index];
        if (this._closing || !row || row.item.disabled)
            return;
        const {item} = row;
        this._remember(item.id);
        this._activated = true;
        this.close();

        const run = () => {
            try {
                item.activate(alt);
            } catch (e) {
                console.error(`jh-fixes: launcher could not open ${item.title}`, e);
                Main.notifyError('Launcher', `Could not open “${item.title}”: ${e.message}`);
            }
            if (Main.overview.visible && item.kind !== 'Calculator')
                Main.overview.hide();
        };
        if (item.deferred) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                run();
                return GLib.SOURCE_REMOVE;
            });
        } else {
            run();
        }
    }

    get activated() {
        return !!this._activated;
    }
}
