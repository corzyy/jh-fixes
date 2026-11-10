import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ensureActorVisibleInScrollView} from 'resource:///org/gnome/shell/misc/animationUtils.js';

import {commandItem, historyItem, webItem} from './sources.js';
import {fold} from './match.js';

const HISTORY_KEY = 'launcher-history';
const HISTORY_SIZE = 40;
const OPEN_TIME = 120;

const VERTICAL = {orientation: Clutter.Orientation.VERTICAL};

// GNOME's "Search as Overlay" mockup (os-mockups/search/search-overlay.png).
const OVERLAY_OPEN_TIME = 220;
const OVERLAY_CLOSE_TIME = 140;
const OVERLAY_GAP = 18;
const OVERLAY_MARGIN = 32;
const TILE_ICON = 64;
const TILE_WIDTH = 116; // tile width + spacing, keep in sync with style.js
const LIST_ICON = 40;
const ROW_ACTION_ICONS = {
    Application: 'window-new-symbolic',
    File: 'folder-open-symbolic',
    Window: 'window-close-symbolic',
};

const WIDTH = 700;
const VISIBLE_ROWS = 7;
const MAX_RESULTS = 5;
const ICON_SIZE = 32;
const COMMAND_PREFIX = '>';
const POOL_SIZE = 200; // result actors kept around, see _row()

const byScore = (a, b) => b.score - a.score;

function key(label) {
    return new St.Label({text: label, style_class: 'jh-launcher-key', y_align: Clutter.ActorAlign.CENTER});
}

// The first `count` items that are still there (files are only checked when shown).
function take(items, count) {
    const taken = [];
    for (const item of items) {
        if (item.valid && !item.valid())
            continue;
        taken.push(item);
        if (taken.length >= count)
            break;
    }
    return taken;
}

let BUILDERS;

export class LauncherPopup {
    constructor(settings, sources, rowPool, {initialQuery = '', selectQuery = true, closeWhenEmpty = false, overlay = false, onClosed}) {
        this._closeWhenEmpty = closeWhenEmpty;
        this._overlay = overlay;
        this._settings = settings;
        this._onClosed = onClosed;
        this._commands = settings.get_boolean('launcher-commands');
        this._web = settings.get_boolean('launcher-web-search');
        sources.refresh();
        this._sources = sources.enabled(settings);
        this._historyIds = settings.get_strv(HISTORY_KEY);
        this._historyBonus = new Map(this._historyIds.map((id, i) => [id, 120 - i * 2]));
        this._rows = [];
        this._pool = rowPool;
        this._sections = new Map();
        this._sectionLabels = new Map();
        this._selected = -1;
        this._selectedRow = null;
        this._laterId = 0;
        this._pointerMoved = false;
        this._buildUi(initialQuery, selectQuery);
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
        this._backdrop.connect('destroy', () => {
            this._release();
            this._finish();
        });
        this._backdrop.connect('motion-event', () => {
            this._pointerMoved = true;
            return Clutter.EVENT_PROPAGATE;
        });

        this._dialog = new St.BoxLayout({
            ...VERTICAL,
            style_class: this._overlay ? 'jh-launcher jh-launcher-overlay' : 'jh-launcher',
            width: WIDTH * scale,
            reactive: true,
        });
        this._backdrop.add_child(this._dialog);
        // Result actors that aren't on screen right now, see _sync().
        this._attic = new Clutter.Actor({visible: false});
        this._backdrop.add_child(this._attic);

        // Overlay: the entry is a separate pill sitting where the Overview's entry is.
        const header = new St.BoxLayout({
            style_class: this._overlay ? 'jh-launcher-pill' : 'jh-launcher-header',
            reactive: true,
        });
        header.add_child(new St.Icon({
            icon_name: 'system-search-symbolic',
            icon_size: 18,
            style_class: 'jh-launcher-header-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._entry = new St.Entry({
            style_class: 'jh-launcher-entry',
            hint_text: this._overlay ? 'Type to search' : this._hintText(),
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
        this._header = header;
        if (this._overlay)
            this._backdrop.add_child(header);
        else
            this._dialog.add_child(header);

        this._separator = new St.Widget({style_class: 'jh-launcher-separator', visible: !this._overlay});
        if (!this._overlay)
            this._dialog.add_child(this._separator);

        this._list = new St.BoxLayout({
            ...VERTICAL,
            style_class: this._overlay ? 'jh-launcher-overlay-content' : 'jh-launcher-list',
            x_expand: true,
        });
        this._scroll = new St.ScrollView({
            style_class: 'jh-launcher-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
            child: this._list,
        });
        this._dialog.add_child(this._scroll);

        this._footer = new St.BoxLayout({style_class: 'jh-launcher-footer', visible: !this._overlay});
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
                this._emptyIdleId ||= GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this._emptyIdleId = 0;
                    if (!this._entry.text)
                        this.close();
                    return GLib.SOURCE_REMOVE;
                });
                return;
            }
            this._queueUpdate();
        });
        text.connect('key-press-event', (_a, event) => this._onKey(event));
        // With an input method (IBus) running, Enter usually arrives only as 'activate'.
        text.connect('activate', () => {
            this._flush();
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
        // The backdrop and placement are sized for the current monitors.
        Main.layoutManager.connectObject('monitors-changed', () => this.close(), this);

        this._update();
        this._place();
        this._entry.grab_key_focus();
        if (this._overlay) {
            // Stay on top of the Overview's entry if it moves or resizes.
            Main.overview.searchEntry?.connectObject('notify::allocation', () => {
                const box = this._overviewEntryBox();
                if (box && (box.w !== this._header.width || box.h !== this._header.height ||
                    box.x !== this._header.x || box.y !== this._header.y))
                    this._placeOverlay();
            }, this);
        }

        if (this._overlay) {
            this._animateOverlayIn();
            return true;
        }

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

    _animateOverlayIn() {
        // The results spring out of the search entry.
        const mode = Clutter.AnimationMode.EASE_OUT_QUINT;
        this._backdrop.opacity = 0;
        this._backdrop.ease({opacity: 255, duration: OPEN_TIME, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        this._dialog.set_pivot_point(0.5, 0);
        this._dialog.opacity = 0;
        this._dialog.scale_x = 0.92;
        this._dialog.scale_y = 0.85;
        this._dialog.translation_y = -this._header.height / 2;
        this._dialog.ease({
            opacity: 255, scale_x: 1, scale_y: 1, translation_y: 0,
            duration: OVERLAY_OPEN_TIME,
            mode,
        });
    }

    close() {
        if (this._closing || this._finished)
            return;
        this._closing = true;
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        if (!this._overlay) {
            this._backdrop.destroy();
            return;
        }
        // Hand control back right away; the fade-out is only cosmetic.
        this._finish();
        this._backdrop.reactive = false;
        this._dialog.remove_all_transitions();
        this._dialog.ease({
            opacity: 0, scale_y: 0.9, translation_y: -8,
            duration: OVERLAY_CLOSE_TIME,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        });
        this._backdrop.ease({
            opacity: 0,
            duration: OVERLAY_CLOSE_TIME,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: () => this._backdrop.destroy(),
        });
    }

    _finish() {
        if (this._finished)
            return;
        this._finished = true;
        if (this._emptyIdleId)
            GLib.source_remove(this._emptyIdleId);
        this._emptyIdleId = 0;
        if (this._laterId)
            global.compositor.get_laters().remove(this._laterId);
        this._laterId = 0;
        Main.layoutManager.disconnectObject(this);
        try {
            Main.overview.searchEntry?.disconnectObject(this);
        } catch {}
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this._onClosed?.(this);
    }

    _monitor() {
        const lm = Main.layoutManager;
        return lm.focusMonitor ?? lm.currentMonitor;
    }

    _overviewEntryBox() {
        try {
            const entry = Main.overview.searchEntry;
            if (!entry?.mapped)
                return null;
            const [x, y] = entry.get_transformed_position();
            // Not get_transformed_size(): the character that opened us has queued a
            // relayout of the entry, and until that runs it reports the preferred size,
            // which is taller than the entry ever gets.
            let [w, h] = entry.get_allocation_box().get_size();
            if (!(w > 0 && h > 0))
                [w, h] = entry.get_transformed_size();
            return w > 0 && h > 0 ? {x, y, w, h} : null;
        } catch {
            return null;
        }
    }

    _placeOverlay() {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const m = Main.layoutManager.primaryMonitor ?? this._monitor();
        if (!m)
            return;
        const box = this._overviewEntryBox();
        const [, natH] = this._header.get_preferred_height(-1);
        const pill = box ?? {
            w: Math.round(Math.min(360 * scale, m.width - 32)),
            h: natH,
            x: 0,
            y: m.y + Math.round(m.height * 0.08),
        };
        pill.x = box ? pill.x : m.x + Math.round((m.width - pill.w) / 2);
        // Exactly over the Overview's entry, which it stands in for.
        this._header.set_size(pill.w, pill.h);
        this._header.set_position(pill.x, pill.y);

        const width = Math.min(WIDTH * scale, m.width - 32);
        this._dialog.width = width;
        const top = pill.y + this._header.height + OVERLAY_GAP * scale;
        this._dialog.set_position(m.x + Math.round((m.width - width) / 2), top);
        this._overlayMaxHeight = Math.max(160 * scale, m.y + m.height - top - OVERLAY_MARGIN * scale);
        this._scroll.style = `max-height: ${this._overlayMaxHeight}px;`;
    }

    _place() {
        if (this._overlay) {
            this._placeOverlay();
            return;
        }
        const m = this._monitor();
        if (!m)
            return;
        const width = Math.min(this._dialog.width, m.width - 32);
        this._dialog.width = width;
        const x = m.x + Math.round((m.width - width) / 2);
        // Centred for the tallest the list can get, so it doesn't jump while typing.
        const [, natural] = this._dialog.get_preferred_height(width);
        const [, list] = this._scroll.visible ? this._scroll.get_preferred_height(width) : [0, 0];
        const tallest = natural - list + this._listMaxHeight();
        const y = m.y + Math.round((m.height - tallest) / 2);
        this._dialog.set_position(x, Math.max(m.y, y));
    }

    _rowHeight() {
        if (!this._measuredRow) {
            // Only measured, never shown or selectable.
            const probe = this._buildRowFor('row', {
                title: 'Xy', subtitle: 'Xy', kind: '',
                icon: size => new St.Icon({icon_size: size}),
            }).actor;
            this._list.add_child(probe);
            this._measuredRow = probe.get_preferred_height(-1)[1];
            probe.destroy();
        }
        return this._measuredRow;
    }

    _listMaxHeight() {
        return Math.round(this._rowHeight() * VISIBLE_ROWS + 14 * St.ThemeContext.get_for_stage(global.stage).scale_factor);
    }

    // ---------- search ----------

    _collect() {
        const raw = this._entry.text;

        if (this._commands && raw.startsWith(COMMAND_PREFIX)) {
            const command = raw.slice(COMMAND_PREFIX.length).trim();
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
            for (const item of items) {
                const bonus = this._historyBonus.get(item.id);
                if (bonus)
                    item.score += bonus;
            }
            const limit = this._overlay && section === 'Applications'
                ? Math.max(MAX_RESULTS, this._tilesPerRow()) : MAX_RESULTS;
            const top = take(items.sort(byScore), limit);
            if (top.length)
                groups.push([section, top]);
        }
        groups.sort((a, b) => b[1][0].score - a[1][0].score);

        if (this._web)
            groups.push(['Web', [webItem(raw)]]);
        return {mode: null, groups};
    }

    _emptyGroups() {
        const limit = Math.max(VISIBLE_ROWS, MAX_RESULTS);
        if (this._historyIds.length) {
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

    // Text changes are coalesced into one search per frame.
    _queueUpdate() {
        if (this._laterId)
            return;
        this._laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._laterId = 0;
            this._update();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Anything that acts on the results runs the pending search first.
    _flush() {
        if (!this._laterId)
            return;
        global.compositor.get_laters().remove(this._laterId);
        this._laterId = 0;
        this._update();
    }

    _update() {
        const {mode, groups} = this._collect();
        this._modeChip.visible = !!mode;
        this._modeChip.text = mode ?? '';

        for (const row of this._rows)
            row.index = -1;
        this._rows = [];
        this._pointerMoved = false;

        const children = this._overlay ? this._layoutOverlay(groups) : this._layoutList(groups);
        const hasRows = this._rows.length > 0;
        const query = this._entry.text.trim();
        if (!hasRows && query)
            children.push(this._emptyState());
        this._sync(this._list, children);

        if (this._selectedRow && this._selectedRow.index < 0) {
            this._selectedRow.actor.remove_style_class_name('selected');
            this._selectedRow = null;
        }
        this._trimCache();

        const show = hasRows || !!query;
        if (this._overlay) {
            this._dialog.visible = show;
        } else {
            this._scroll.visible = show;
            this._separator.visible = show;
            const maxHeight = this._listMaxHeight();
            if (maxHeight !== this._maxHeight) {
                this._maxHeight = maxHeight;
                this._scroll.style = `max-height: ${maxHeight}px;`;
            }
            this._status.text = mode === 'Run' ? 'Command mode' : hasRows
                ? `${this._rows.length} result${this._rows.length === 1 ? '' : 's'}`
                : '';
        }

        // New results start at the top; kept rows still have last frame's allocation,
        // so scrolling to the selection here would aim at where it used to be.
        const {vadjustment} = this._scroll;
        vadjustment.remove_transition('value');
        vadjustment.value = vadjustment.lower;
        this._select(hasRows ? 0 : -1, false);
    }

    // ---------- rendering ----------
    //
    // Building a result's actors is what costs time, so they are built once and then
    // only moved around: a keystroke that narrows the results builds nothing, and
    // neither does searching for the same thing in a later popup (see _release()).

    // Makes `actors` the children of `container`, touching only what differs.
    // Dropped children are parked in the attic rather than destroyed.
    _sync(container, actors) {
        const keep = new Set(actors);
        for (const child of container.get_children()) {
            if (keep.has(child))
                continue;
            container.remove_child(child);
            if (child.hover)
                child.hover = false;
            this._attic.add_child(child);
        }
        actors.forEach((actor, i) => {
            if (container.get_child_at_index(i) === actor)
                return;
            actor.get_parent()?.remove_child(actor);
            container.insert_child_at_index(actor, i);
        });
    }

    _trimCache() {
        if (this._pool.size <= POOL_SIZE)
            return;
        for (const [key, row] of this._pool) {
            if (row.index >= 0)
                continue;
            row.actor.destroy();
            this._pool.delete(key);
        }
    }

    static _resetRow(row) {
        const {actor} = row;
        actor.remove_style_class_name('selected');
        if (actor.hover)
            actor.hover = false;
        row.hint.visible = false;
    }

    // Hands this popup's rows back to the pool before its actors are destroyed.
    _release() {
        for (const row of this._pool.values()) {
            if (row.owner !== this)
                continue;
            row.owner = null;
            row.index = -1;
            row.actor.get_parent()?.remove_child(row.actor);
            LauncherPopup._resetRow(row);
        }
    }

    _onRowHover(row) {
        if (this._pointerMoved && row.index >= 0)
            this._select(row.index, false);
    }

    _onRowClicked(row, alt) {
        if (row.index < 0)
            return;
        const [, , mods] = global.get_pointer();
        this._activate(row.index, alt || (mods & Clutter.ModifierType.SHIFT_MASK) !== 0);
    }

    // The actor for a result, registered for keyboard selection, hover and click.
    _row(variant, item) {
        const key = `${variant}:${item.key ?? item.id ?? item.title}:${item.subtitle ? 1 : 0}${item.altAction ? 1 : 0}`;
        let row = this._pool.get(key);
        if (row && row.owner === this && row.index >= 0) {
            // Same result twice in one list: the second one gets its own actor.
            row = this._buildRowFor(variant, item);
        } else if (!row) {
            row = this._buildRowFor(variant, item);
            this._pool.set(key, row);
        } else {
            // Still in a popup that is fading out: take it, we need it more.
            if (row.owner && row.owner !== this)
                LauncherPopup._resetRow(row);
            if (row.item.title !== item.title)
                row.title.text = item.title;
            if (row.subtitle && row.item.subtitle !== item.subtitle)
                row.subtitle.text = row.subtitleText(item);
        }
        row.owner = this;
        row.item = item;
        row.index = this._rows.length;
        this._rows.push(row);
        if (row.index < 9 && row.hintIndex !== row.index) {
            row.hintIndex = row.index;
            row.hint.text = `Alt ${row.index + 1}`;
        }
        return row.actor;
    }

    _buildRowFor(variant, item) {
        const row = {
            owner: null, item, index: -1, hintIndex: -1,
            actor: null, title: null, subtitle: null,
            subtitleText: i => i.subtitle,
            hint: new St.Label({style_class: 'jh-launcher-shortcut-hint', visible: false}),
        };
        BUILDERS[variant].call(this, row, item);
        const {actor} = row;
        // Rows outlive the popup that built them, so they talk to their current one.
        actor.connect('notify::hover', () => {
            if (actor.hover)
                row.owner?._onRowHover(row);
        });
        actor.connect('clicked', () => row.owner?._onRowClicked(row, false));
        return row;
    }

    _label(text, style_class, props = {}) {
        const label = new St.Label({text, style_class, ...props});
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        return label;
    }

    _layoutList(groups) {
        const children = [];
        for (const [section, items] of groups) {
            let label = this._sectionLabels.get(section);
            if (!label) {
                label = new St.Label({text: section, style_class: 'jh-launcher-section'});
                this._sectionLabels.set(section, label);
            }
            children.push(label);
            for (const item of items)
                children.push(this._row('row', item));
        }
        return children;
    }

    _emptyState() {
        if (this._empty)
            return this._empty;
        if (!this._overlay) {
            this._empty = new St.Label({
                text: 'No results',
                style_class: 'jh-launcher-empty',
                x_align: Clutter.ActorAlign.CENTER,
            });
            return this._empty;
        }
        const empty = new St.BoxLayout({...VERTICAL, style_class: 'jh-launcher-status', x_expand: true});
        empty.add_child(new St.Icon({
            icon_name: 'system-search-symbolic',
            icon_size: 64,
            style_class: 'jh-launcher-status-icon',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        empty.add_child(new St.Label({
            text: 'No Results',
            style_class: 'jh-launcher-status-title',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        empty.add_child(new St.Label({
            text: 'Try a different search',
            style_class: 'jh-launcher-status-description',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        this._empty = empty;
        return empty;
    }

    // ---------- overlay layout ----------

    _overlayOrder(groups) {
        // Like the mockup: app tiles first, then the calculator, then the lists.
        const rank = ([section]) => section === 'Applications' ? 0 : section === 'Calculator' ? 1 : 2;
        return groups
            .map((g, i) => [g, i])
            .sort(([a, i], [b, j]) => rank(a) - rank(b) || i - j)
            .map(([g]) => g);
    }

    _tilesPerRow() {
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const inner = this._dialog.width - 48 * scale;
        return Math.max(3, Math.floor(inner / (TILE_WIDTH * scale)));
    }

    _layoutOverlay(groups) {
        const children = [];
        for (const [section, items] of this._overlayOrder(groups)) {
            if (section === 'Applications' || section === 'Suggestions') {
                this._tiles ??= new St.BoxLayout({
                    style_class: 'jh-launcher-tiles',
                    x_align: Clutter.ActorAlign.CENTER,
                });
                this._sync(this._tiles,
                    items.slice(0, this._tilesPerRow()).map(item => this._row('tile', item)));
                children.push(this._tiles);
            } else if (section === 'Calculator') {
                for (const item of items)
                    children.push(this._row('card', item));
            } else {
                children.push(this._section(section, items));
            }
        }
        return children;
    }

    _buildTile(row, item) {
        const tile = new St.Button({
            style_class: 'jh-launcher-tile',
            can_focus: false,
            track_hover: true,
        });
        const box = new St.BoxLayout({...VERTICAL, style_class: 'jh-launcher-tile-box'});
        const icon = item.icon(TILE_ICON);
        icon.x_align = Clutter.ActorAlign.CENTER;
        box.add_child(icon);
        row.title = this._label(item.title, 'jh-launcher-tile-label', {x_align: Clutter.ActorAlign.CENTER});
        box.add_child(row.title);
        row.hint.x_align = Clutter.ActorAlign.CENTER;
        box.add_child(row.hint);
        tile.child = box;
        row.actor = tile;
    }

    _buildCard(row, item) {
        const card = new St.Button({
            style_class: 'jh-launcher-card',
            can_focus: false,
            track_hover: true,
            x_expand: true,
        });
        const layout = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true});
        const text = new St.BoxLayout({...VERTICAL, x_align: Clutter.ActorAlign.CENTER, x_expand: true});
        if (item.subtitle) {
            row.subtitleText = i => `${i.subtitle} =`;
            row.subtitle = new St.Label({
                text: row.subtitleText(item),
                style_class: 'jh-launcher-card-subtitle',
                x_align: Clutter.ActorAlign.CENTER,
            });
            text.add_child(row.subtitle);
        }
        row.title = this._label(item.title, 'jh-launcher-card-title', {x_align: Clutter.ActorAlign.CENTER});
        text.add_child(row.title);
        layout.add_child(text);
        const icon = item.icon(16);
        icon.x_align = Clutter.ActorAlign.END;
        icon.y_align = Clutter.ActorAlign.CENTER;
        icon.add_style_class_name('jh-launcher-card-icon');
        layout.add_child(icon);
        card.child = layout;
        row.actor = card;
    }

    _sectionAction(section) {
        if (section === 'Recent Files')
            return ['Show in Files', 'recent:///'];
        return null;
    }

    _section(section, items) {
        let group = this._sections.get(section);
        if (!group) {
            group = this._buildSection(section);
            this._sections.set(section, group);
        }
        this._sync(group.list, items.map(item => this._row('listRow', item)));
        return group.box;
    }

    _buildSection(section) {
        const box = new St.BoxLayout({...VERTICAL, style_class: 'jh-launcher-group', x_expand: true});
        const head = new St.BoxLayout({style_class: 'jh-launcher-group-header', x_expand: true});
        head.add_child(new St.Label({
            text: section,
            style_class: 'jh-launcher-group-title',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        const action = this._sectionAction(section);
        if (action) {
            const [label, uri] = action;
            const button = new St.Button({
                label,
                style_class: 'jh-launcher-group-button',
                can_focus: false,
                y_align: Clutter.ActorAlign.CENTER,
            });
            button.connect('clicked', () => {
                this.close();
                Gio.AppInfo.launch_default_for_uri_async(uri, global.create_app_launch_context(0, -1), null, null);
                Main.overview.hide();
            });
            head.add_child(button);
        }
        box.add_child(head);

        const list = new St.BoxLayout({...VERTICAL, style_class: 'jh-launcher-boxed-list', x_expand: true});
        box.add_child(list);
        return {box, list};
    }

    _buildText(row, item) {
        const text = new St.BoxLayout({...VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        row.title = this._label(item.title, 'jh-launcher-title');
        text.add_child(row.title);
        if (item.subtitle) {
            row.subtitle = this._label(item.subtitle, 'jh-launcher-subtitle');
            text.add_child(row.subtitle);
        }
        return text;
    }

    _buildListRow(row, item) {
        const button = new St.Button({
            style_class: 'jh-launcher-boxed-row',
            can_focus: false,
            track_hover: true,
            x_expand: true,
        });
        const box = new St.BoxLayout({style_class: 'jh-launcher-row-box', x_expand: true});
        button.child = box;

        // Apps get their full-colour icon; everything else a small icon on a tile.
        const plain = ['File', 'System', 'Web', 'Command'].includes(item.kind);
        const frame = new St.Bin({
            style_class: plain ? 'jh-launcher-thumb symbolic' : 'jh-launcher-thumb',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const icon = item.icon(plain ? 20 : LIST_ICON);
        icon.x_align = icon.y_align = Clutter.ActorAlign.CENTER;
        frame.child = icon;
        box.add_child(frame);
        box.add_child(this._buildText(row, item));

        row.hint.y_align = Clutter.ActorAlign.CENTER;
        box.add_child(row.hint);

        const altIcon = item.altAction && ROW_ACTION_ICONS[item.kind];
        if (altIcon) {
            const alt = new St.Button({
                style_class: 'jh-launcher-row-action',
                can_focus: false,
                accessible_name: item.altAction,
                y_align: Clutter.ActorAlign.CENTER,
                child: new St.Icon({icon_name: altIcon, icon_size: 16}),
            });
            alt.connect('clicked', () => row.owner?._onRowClicked(row, true));
            box.add_child(alt);
        }
        row.actor = button;
    }

    _buildRow(row, item) {
        const button = new St.Button({
            style_class: 'jh-launcher-row',
            can_focus: false,
            track_hover: true,
            x_expand: true,
        });
        const box = new St.BoxLayout({style_class: 'jh-launcher-row-box', x_expand: true});
        button.child = box;

        const icon = item.icon(ICON_SIZE);
        icon.y_align = Clutter.ActorAlign.CENTER;
        box.add_child(icon);
        box.add_child(this._buildText(row, item));

        row.hint.y_align = Clutter.ActorAlign.CENTER;
        box.add_child(row.hint);
        if (item.kind) {
            box.add_child(new St.Label({
                text: item.kind,
                style_class: 'jh-launcher-kind',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        row.actor = button;
    }

    _select(index, scroll = true) {
        const row = this._rows[index] ?? null;
        if (row !== this._selectedRow) {
            this._selectedRow?.actor.remove_style_class_name('selected');
            row?.actor.add_style_class_name('selected');
            this._selectedRow = row;
        }
        this._selected = row ? index : -1;
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
        this._flush();
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
        // Hiding covers parked rows too, so none comes back with its hint showing.
        for (const row of show ? this._rows : this._pool.values())
            row.hint.visible = show && row.index >= 0 && row.index < 9;
    }

    _onKey(event) {
        const sym = event.get_key_symbol();
        const state = event.get_state();
        const ctrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const alt = (state & Clutter.ModifierType.MOD1_MASK) !== 0;
        const shift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;
        const page = VISIBLE_ROWS - 1;

        if (sym === Clutter.KEY_Alt_L || sym === Clutter.KEY_Alt_R) {
            this._showQuickHints(true);
            return Clutter.EVENT_PROPAGATE;
        }

        switch (sym) {
        case Clutter.KEY_Escape:
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
            this._flush();
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
            this._flush();
            const index = sym - Clutter.KEY_1;
            if (index < this._rows.length)
                this._activate(index, shift);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _remember(id) {
        if (!id)
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
}

BUILDERS = {
    row: LauncherPopup.prototype._buildRow,
    listRow: LauncherPopup.prototype._buildListRow,
    tile: LauncherPopup.prototype._buildTile,
    card: LauncherPopup.prototype._buildCard,
};
