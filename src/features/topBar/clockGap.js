import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const KEY = 'panel-clock-gap';
const RIGHT_KEY = 'panel-clock-right-space';

// Drop the transparent border on the facing sides (see theme.css) so the hover
// highlight still reaches past the icons when the padding there is small.
const FLUSH_RIGHT = 'jh-fixes-flush-right';
const FLUSH_LEFT = 'jh-fixes-flush-left';

// The space between Quick Settings and the clock is the padding of both buttons on
// the sides that face each other. GNOME pads a panel button the same on both sides,
// so we shrink the padding and give the outer sides back as margin. That only works
// when the two buttons sit next to each other in a row, as dash-to-panel can do.
function* panels() {
    yield Main.panel;
    for (const p of global.dashToPanel?.panels ?? []) {
        if (p.panel && p.panel !== Main.panel)
            yield p.panel;
    }
}

function horizontalOrder(a, b) {
    const boxA = a.get_allocation_box();
    const boxB = b.get_allocation_box();
    if (boxA.get_width() === 0 || boxB.get_width() === 0)
        return null;
    if (boxA.x2 <= boxB.x1 + 1)
        return [a, b];
    if (boxB.x2 <= boxA.x1 + 1)
        return [b, a];
    return null;
}

function adjacent(left, right) {
    const parent = left.get_parent();
    if (!parent || parent !== right.get_parent())
        return false;
    const x1 = left.get_allocation_box().x2;
    const x2 = right.get_allocation_box().x1;
    return !parent.get_children().some(c => {
        if (c === left || c === right || !c.visible)
            return false;
        const box = c.get_allocation_box();
        return box.get_width() > 0 && box.x1 < x2 && box.x2 > x1;
    });
}

class Pair {
    constructor(quickSettings, dateMenu, options) {
        this._buttons = [quickSettings, dateMenu];
        this._options = options;
        this._order = null;
        this._idleId = 0;
        this._margins = new Map(this._buttons.map(b =>
            [b, [b.container.margin_left, b.container.margin_right]]));

        for (const button of this._buttons) {
            button.connectObject(
                'style-changed', () => this._apply(),
                'destroy', () => this.destroy(button),
                this);
            button.container.connectObject('notify::allocation', () => this._queueCheck(), this);
        }
        this._queueCheck();
    }

    get alive() {
        return this._buttons !== null;
    }

    owns(quickSettings, dateMenu) {
        return this._buttons?.[0] === quickSettings && this._buttons?.[1] === dateMenu;
    }

    setOptions(options) {
        this._options = options;
        this._apply();
    }

    destroy(gone = null) {
        if (!this._buttons)
            return;
        if (this._idleId)
            GLib.source_remove(this._idleId);
        this._idleId = 0;
        for (const button of this._buttons) {
            button.disconnectObject(this);
            button.container.disconnectObject(this);
            if (button !== gone) {
                button.remove_style_class_name(FLUSH_RIGHT);
                button.remove_style_class_name(FLUSH_LEFT);
                this._restore(button);
            }
        }
        this._order = null;
        this._buttons = null;
    }

    _queueCheck() {
        this._idleId ||= GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idleId = 0;
            this._check();
            return GLib.SOURCE_REMOVE;
        });
    }

    _check() {
        const [a, b] = this._buttons.map(button => button.container);
        const order = horizontalOrder(a, b);
        const next = order && adjacent(...order) ? order.map(c => c.child) : null;
        if (next?.[0] === this._order?.[0] && next?.[1] === this._order?.[1])
            return;
        this._order = next;
        this._syncClasses();
        this._apply();
    }

    // Only called when the order changes: a class change emits style-changed,
    // which lands in _apply, so _apply itself must not touch the classes.
    _syncClasses() {
        const [left, right] = this._order ?? [];
        for (const button of this._buttons) {
            button[button === left ? 'add_style_class_name' : 'remove_style_class_name'](FLUSH_RIGHT);
            button[button === right ? 'add_style_class_name' : 'remove_style_class_name'](FLUSH_LEFT);
        }
    }

    _restore(button) {
        button._onStyleChanged(button);
        const [left, right] = this._margins.get(button);
        button.container.margin_left = left;
        button.container.margin_right = right;
        button.queue_relayout();
    }

    _apply() {
        // Back to what the theme says, then adjust from there.
        this._buttons.forEach(b => this._restore(b));

        if (!this._order)
            return;
        const {gap, clockRightSpace} = this._options;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const facing = (gap * scale) / 2;
        const [left] = this._order;
        const [, dateMenu] = this._buttons;
        for (const button of this._order) {
            // The space wanted on each side; the smaller part stays padding (and so
            // gets highlighted), the rest becomes margin.
            const natural = button._natHPadding;
            const toward = Math.min(facing, natural);
            const sides = button === left ? [natural, toward] : [toward, natural];
            if (button === dateMenu && !clockRightSpace)
                sides[1] = 0;
            const padding = Math.min(...sides);
            button._natHPadding = padding;
            button._minHPadding = Math.min(button._minHPadding, padding);
            button.container.margin_left += sides[0] - padding;
            button.container.margin_right += sides[1] - padding;
        }
    }
}

export class PanelClockGap {
    constructor(settings) {
        this._settings = settings;
        this._pairs = [];
        this._active = false;
        this._idleId = 0;
        this._dtpId = 0;
        this._dtp = null;
    }

    enable() {
        this._settings.connectObject(
            `changed::${KEY}`, () => this._sync(),
            `changed::${RIGHT_KEY}`, () => this._sync(),
            this);
        this._sync();
    }

    disable() {
        this._settings.disconnectObject(this);
        this._stop();
    }

    get _options() {
        return {
            gap: this._settings.get_int(KEY),
            clockRightSpace: this._settings.get_boolean(RIGHT_KEY),
        };
    }

    _sync() {
        // Left at their defaults, the panel stays exactly as GNOME draws it.
        const wanted = [KEY, RIGHT_KEY].some(k => this._settings.get_user_value(k) !== null);
        if (wanted && !this._active)
            this._start();
        else if (!wanted && this._active)
            this._stop();
        else if (wanted)
            this._pairs.forEach(p => p.setOptions(this._options));
    }

    _start() {
        this._active = true;
        const queue = () => this._queueScan();
        Main.layoutManager.connectObject('monitors-changed', queue, this);
        Main.extensionManager.connectObject('extension-state-changed', queue, this);
        this._scan();
    }

    _stop() {
        this._active = false;
        if (this._idleId)
            GLib.source_remove(this._idleId);
        this._idleId = 0;
        Main.layoutManager.disconnectObject(this);
        Main.extensionManager.disconnectObject(this);
        this._watchDashToPanel(null);
        this._pairs.forEach(p => p.destroy());
        this._pairs = [];
    }

    _watchDashToPanel(dtp) {
        if (dtp === this._dtp)
            return;
        if (this._dtpId)
            this._dtp.disconnect(this._dtpId);
        this._dtp = dtp;
        this._dtpId = dtp?.connect('panels-created', () => this._queueScan()) ?? 0;
    }

    _queueScan() {
        this._idleId ||= GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idleId = 0;
            this._scan();
            return GLib.SOURCE_REMOVE;
        });
    }

    _scan() {
        this._watchDashToPanel(global.dashToPanel ?? null);
        const found = [];
        for (const panel of panels()) {
            const {quickSettings, dateMenu} = panel.statusArea ?? {};
            if (quickSettings?.container && dateMenu?.container)
                found.push([quickSettings, dateMenu]);
        }
        const keep = [];
        for (const pair of this._pairs) {
            if (pair.alive && found.some(([q, d]) => pair.owns(q, d)))
                keep.push(pair);
            else
                pair.destroy();
        }
        for (const [q, d] of found) {
            if (!keep.some(p => p.owns(q, d)))
                keep.push(new Pair(q, d, this._options));
        }
        this._pairs = keep;
    }
}
