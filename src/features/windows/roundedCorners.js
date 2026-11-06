import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

const KEY = 'window-corners';
const RADIUS_KEY = 'shell-theme-radius';
const windowRadius = settings => Math.round(settings.get_int(RADIUS_KEY) * 15 / 20);
const EFFECT_NAME = 'jh-fixes-rounded-corners';

const SHADOW_PADDING = 80;
const SHADOW_FOCUSED = '0 4px 28px 4px rgba(0, 0, 0, 0.6)';
const SHADOW_UNFOCUSED = '0 2px 12px -1px rgba(0, 0, 0, 0.65)';

const WINDOW_TYPES = new Set([
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
]);

const TYPE_SUFFIX = GLib.uuid_string_random().replaceAll('-', '');

const CORNERS_DECLARATIONS = `
uniform vec4 bounds;
uniform float radius;
uniform vec2 size;
float corner_alpha(vec2 p) {
    if (p.x < bounds.x || p.x > bounds.z || p.y < bounds.y || p.y > bounds.w)
        return 0.0;
    vec2 center = clamp(p, bounds.xy + radius, bounds.zw - radius);
    return clamp(radius + 0.5 - distance(p, center), 0.0, 1.0);
}`;
const CORNERS_CODE = 'cogl_color_out *= corner_alpha(cogl_tex_coord_in[0].xy * size);';

let RoundedCornersEffect = null;
let ClipShadowEffect = null;

function registerTypes() {
    RoundedCornersEffect ??= GObject.registerClass({
        GTypeName: `JhFixesRoundedCornersEffect${TYPE_SUFFIX}`,
    }, class RoundedCornersEffect extends Clutter.ShaderEffect {
        vfunc_get_static_snippet() {
            return Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT,
                CORNERS_DECLARATIONS, CORNERS_CODE);
        }

        vfunc_paint_target(node, paintContext) {
            if (this.actor.is_in_clone_paint()) {
                this.get_pipeline()?.set_layer_filters(0,
                    Cogl.PipelineFilter.LINEAR_MIPMAP_NEAREST,
                    Cogl.PipelineFilter.LINEAR);
            }
            super.vfunc_paint_target(node, paintContext);
        }

        setGeometry(bounds, radius, width, height) {
            const geometry = [...bounds, radius, width, height];
            if (this._geometry?.every((v, i) => v === geometry[i]))
                return;
            this._geometry = geometry;
            this.set_uniform_float('bounds', 4, bounds);
            this.set_uniform_float('radius', 1, [radius]);
            this.set_uniform_float('size', 2, [width, height]);
            this.queue_repaint();
        }
    });

    ClipShadowEffect ??= GObject.registerClass({
        GTypeName: `JhFixesClipShadowEffect${TYPE_SUFFIX}`,
    }, class ClipShadowEffect extends Clutter.ShaderEffect {
        vfunc_get_static_snippet() {
            return Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, null, `
                float gray = (cogl_color_out.r + cogl_color_out.g + cogl_color_out.b) / 3.0;
                cogl_color_out *= (1.0 - smoothstep(0.4, 1.0, gray)) * cogl_color_out.a;`);
        }
    });
}

function usesLibadwaita(pid) {
    if (!(pid > 0))
        return Promise.resolve(false);
    return new Promise(resolve => {
        Gio.File.new_for_path(`/proc/${pid}/maps`)
            .load_contents_async(null, (file, res) => {
                try {
                    const [, bytes] = file.load_contents_finish(res);
                    resolve(new TextDecoder().decode(bytes).includes('/libadwaita-1.so'));
                } catch {
                    resolve(false);
                }
            });
    });
}

export class RoundedCorners {
    constructor(settings) {
        this._settings = settings;
        this._windows = null;
        this._adwaita = new Map();
        this._radius = 0;
    }

    enable() {
        this._settings.connectObject(
            `changed::${KEY}`, () => this._sync(),
            `changed::${RADIUS_KEY}`, () => {
                this._radius = windowRadius(this._settings);
                this._updateAll();
            },
            this);
        this._sync();
    }

    disable() {
        this._settings.disconnectObject(this);
        this._stop();
    }

    _sync() {
        if (this._settings.get_boolean(KEY))
            this._start();
        else
            this._stop();
    }

    _start() {
        if (this._windows)
            return;
        registerTypes();
        this._radius = windowRadius(this._settings);
        this._windows = new Map();
        global.display.connectObject(
            'window-created', (_d, win) => this._track(win.get_compositor_private()),
            'restacked', () => this._restack(),
            this);
        for (const actor of global.get_window_actors())
            this._track(actor);
    }

    _stop() {
        if (!this._windows)
            return;
        global.display.disconnectObject(this);
        for (const actor of [...this._windows.keys()])
            this._untrack(actor);
        this._windows = null;
        this._adwaita.clear();
    }

    _track(actor) {
        const win = actor?.meta_window;
        if (!win || this._windows.has(actor) || !WINDOW_TYPES.has(win.window_type))
            return;
        const entry = {adwaita: null, effect: null, shadow: null, constraints: [], bindings: [], style: null};
        this._windows.set(actor, entry);

        const update = () => this._update(actor);
        actor.connectObject(
            'notify::size', update,
            'notify::first-child', update,
            'destroy', () => this._untrack(actor),
            this);
        win.connectObject(
            'unmanaged', () => this._forgetPid(win),
            'size-changed', update,
            'notify::maximized-horizontally', update,
            'notify::maximized-vertically', update,
            'notify::fullscreen', update,
            'notify::appears-focused', update,
            this);

        const pid = win.get_pid();
        if (!this._adwaita.has(pid))
            this._adwaita.set(pid, usesLibadwaita(pid));
        this._adwaita.get(pid).then(adwaita => {
            if (this._windows?.get(actor) !== entry)
                return;
            entry.adwaita = adwaita;
            update();
        });
    }

    _forgetPid(win) {
        const pid = win.get_pid();
        for (const actor of this._windows?.keys() ?? []) {
            const other = actor.meta_window;
            if (other && other !== win && other.get_pid() === pid)
                return;
        }
        this._adwaita.delete(pid);
    }

    _untrack(actor) {
        const entry = this._windows?.get(actor);
        if (!entry)
            return;
        this._removeEffect(actor, entry);
        actor.disconnectObject(this);
        actor.meta_window?.disconnectObject(this);
        this._windows.delete(actor);
    }

    _updateAll() {
        for (const actor of this._windows?.keys() ?? [])
            this._update(actor);
    }

    _target(actor) {
        return actor.meta_window.get_client_type() === Meta.WindowClientType.X11
            ? actor.get_first_child() : actor;
    }

    _update(actor) {
        const entry = this._windows?.get(actor);
        const win = actor.meta_window;
        if (!entry || !win || entry.adwaita === null)
            return;

        const target = this._target(actor);
        const wanted = entry.adwaita === false && target &&
            !win.maximized_horizontally && !win.maximized_vertically && !win.fullscreen;
        if (!wanted) {
            this._removeEffect(actor, entry);
            return;
        }
        if (!entry.effect)
            this._addEffect(actor, target, entry);

        const buffer = win.get_buffer_rect();
        const frame = win.get_frame_rect();
        const x = frame.x - buffer.x;
        const y = frame.y - buffer.y;
        const radius = Math.min(this._radius, frame.width / 2, frame.height / 2);
        entry.effect.setGeometry([x, y, x + frame.width, y + frame.height],
            radius, buffer.width, buffer.height);

        const offsets = [
            x - SHADOW_PADDING,
            y - SHADOW_PADDING,
            frame.width - buffer.width + 2 * SHADOW_PADDING,
            frame.height - buffer.height + 2 * SHADOW_PADDING,
        ];
        entry.constraints.forEach((c, i) => {
            if (c.offset !== offsets[i])
                c.offset = offsets[i];
        });
        const style = `background: white; border-radius: ${radius}px; ` +
            `box-shadow: ${win.appears_focused ? SHADOW_FOCUSED : SHADOW_UNFOCUSED};`;
        if (style !== entry.style) {
            entry.style = style;
            entry.shadow.child.style = style;
        }
    }

    _addEffect(actor, target, entry) {
        entry.effect = new RoundedCornersEffect();
        target.add_effect_with_name(EFFECT_NAME, entry.effect);

        const shadow = new St.Bin({
            style: `padding: ${SHADOW_PADDING}px;`,
            child: new St.Bin({x_expand: true, y_expand: true}),
        });
        shadow.add_effect(new ClipShadowEffect());
        entry.constraints = [Clutter.BindCoordinate.X, Clutter.BindCoordinate.Y,
            Clutter.BindCoordinate.WIDTH, Clutter.BindCoordinate.HEIGHT].map(coordinate => {
            const constraint = new Clutter.BindConstraint({source: actor, coordinate});
            shadow.add_constraint(constraint);
            return constraint;
        });
        entry.bindings = ['pivot-point', 'translation-x', 'translation-y',
            'scale-x', 'scale-y', 'opacity', 'visible'].map(prop =>
            actor.bind_property(prop, shadow, prop, GObject.BindingFlags.SYNC_CREATE));
        global.window_group.insert_child_below(shadow, actor);
        entry.shadow = shadow;
    }

    _removeEffect(actor, entry) {
        if (!entry.effect)
            return;
        entry.effect.actor?.remove_effect(entry.effect);
        entry.bindings.forEach(b => b.unbind());
        entry.shadow.destroy();
        Object.assign(entry, {effect: null, shadow: null, constraints: [], bindings: [], style: null});
    }

    _restack() {
        for (const [actor, {shadow}] of this._windows) {
            if (shadow && shadow.get_next_sibling() !== actor)
                global.window_group.set_child_below_sibling(shadow, actor);
        }
    }
}
