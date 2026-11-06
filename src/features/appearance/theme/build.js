// Builds the Umbra shell stylesheet as a string. No shell imports, so it can
// be run under plain gjs for testing.
//
// Umbra is GNOME's own dark stylesheet with its greys swapped for darker ones
// (GREYS below), followed by style parts from css/*.css and the rules for
// the options (OPTIONS). Generating it at runtime from the installed shell's
// stylesheet means it follows GNOME upgrades without a rebuild.

// Stock dark grey -> Umbra grey. Taken from the old Umbra build.sh. No output
// is also an input, so replacing them all in one pass is the same as running
// the replacements one after another.
const GREYS = {
    '#222226': '#0e0e10',
    '#2e2e33': '#151517',
    '#36363a': '#18181b',
    '#38383b': '#1a1a1d',
    '#424247': '#222225',
    '#47474c': '#26262a',
    '#4a4a4f': '#28282c',
    '#4d4d4d': '#2a2a2d',
    '#4f4f54': '#2c2c30',
    '#48484c': '#28282c',
    '#414146': '#232327',
    '#404045': '#232326',
    '#56565c': '#34343a',
    '#333333': '#1c1c1e',
    '#3a3a3e': '#1f1f22',
    '#39393d': '#1e1e21',
    '#3d3d42': '#202024',
    '#414144': '#232326',
    '#44444c': '#26262c',
    '#45454a': '#27272b',
    '#46464e': '#28282e',
    '#4a4a50': '#2a2a2f',
    '#4b4b51': '#2b2b30',
    '#525256': '#303034',
    '#54545a': '#323237',
    '#5b5b62': '#38383e',
    '#606067': '#3c3c42',
};

// The same for rgba() colours, as "r, g, b" of the stock and Umbra colour.
const RGBA_GREYS = {
    '56, 56, 59': '26, 26, 29',
    '54, 54, 58': '24, 24, 27',
    '46, 46, 51': '21, 21, 23',
    '34, 34, 38': '14, 14, 16',
};

/**
 * Style parts, in the order they are added. Ids match the file names in
 * css/ and the "shell-theme-disabled-styles" key. All but FIXED_PARTS can be
 * switched off. Keep in sync with STYLES in src/prefs/editors/theme.js.
 */
export const STYLE_PARTS = [
    'sliders',
    'switches',
    'menus',
    'quick-settings',
    'dash',
    'calendar',
];

// Parts that are always on while the theme is: no switch in the preferences,
// and an id left in the disabled key from before is ignored.
export const FIXED_PARTS = ['switches', 'quick-settings', 'calendar'];

/**
 * Theme options with their defaults, which are Umbra as it is. Each one is the
 * key "shell-theme-<name>" in the settings; strings are string keys, numbers
 * integer keys. Most belong to a style part and only apply while it is on.
 */
export const OPTIONS = {
    'panel': 'black',               // top bar: black, theme, transparent or dynamic
    'panel-solid': 'theme',         // dynamic top bar while a window touches it
    'panel-shadow': 50,             // text and icon shadow on a transparent top bar, %
    'slider-height': 12,            // Quick Settings slider track, px
    'radius': 20,                   // popup menus, px; all other radii scale with it
    'menu-shadow': 35,              // popup menu shadow opacity, %
    'dash-style': 'umbra',          // dash: umbra (css/dash.css) or gnome (GNOME's dash, Umbra's colour)
};

// The dash's background: the colour a Quick Settings tile that is off has
// (css/quick-settings.css: white at 6 % over the menu grey), made solid
// because the dash sits on the wallpaper rather than on the menu. Follows the
// darkness like the menu does. Fills in @dash-bg@ in css/dash.css.
const MENU_GREY = '#36363a';
const dashBackground = greys => rgbToHex(mix(hexToRgb(greys[MENU_GREY]), [255, 255, 255], 0.06));

// The dash part with dash-style "gnome": GNOME's own dash, only with the
// background colour above. GNOME paints the icon tiles in the dash's own
// colour so they blend in, and their hover, pressed and focus states as
// shades of it; those follow the new colour here.
const DASH_ICON = ['show-apps', 'overview-tile', 'grid-search-result']
    .map(c => `#dash .dash-item-container .${c}`);
const dashIcons = (state = '', iconState = '') =>
    DASH_ICON.map(s => `${s}${state} .overview-icon${iconState}`).join(',\n');
const FOCUS = 'st-mix(-st-accent-color, #ffffff, 60%)';
const GNOME_DASH_CSS = [
    "/* ---- Dash: GNOME's look, Umbra's colour ---- */",
    '#dash .dash-background {\n  background-color: @dash-bg@; }',
    `${dashIcons()} {\n  background-color: transparent; }`,
    `${dashIcons(':hover')} {\n  background-color: st-lighten(@dash-bg@, 7%); }`,
    `${dashIcons(':focus')} {\n  background-color: st-mix(${FOCUS}, @dash-bg@, 5%); }`,
    `${dashIcons(':focus', ':hover')} {\n  background-color: st-mix(${FOCUS}, st-lighten(@dash-bg@, 7%), 5%); }`,
    `${dashIcons(':active')} {\n  background-color: st-lighten(@dash-bg@, 9%); }`,
    `${dashIcons(':active', ':hover')} {\n  background-color: st-lighten(st-lighten(@dash-bg@, 9%), 7%); }`,
    `${dashIcons(':active', ':focus')} {\n  background-color: st-mix(${FOCUS}, st-lighten(@dash-bg@, 9%), 5%); }`,
    `${dashIcons(':checked')} {\n  background-color: st-lighten(@dash-bg@, 8%); }`,
    `${dashIcons(':checked', ':hover')} {\n  background-color: st-lighten(st-lighten(@dash-bg@, 8%), 7%); }`,
    `${dashIcons(':checked', ':active')} {\n  background-color: st-lighten(st-lighten(@dash-bg@, 8%), 9%); }`,
].join('\n') + '\n';

// Set on the top bar while a window touches it, with a dynamic background.
export const PANEL_SOLID_CLASS = 'jh-fixes-panel-solid';

const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const rgbToHex = rgb => `#${rgb.map(c => c.toString(16).padStart(2, '0')).join('')}`;
const parseTriple = s => s.split(',').map(Number);

// Moves each channel the fraction t of the way from `from` to `to`.
const mix = (from, to, t) => from.map((c, i) =>
    Math.min(255, Math.max(0, Math.round(c + (to[i] - c) * t))));

// CSS for the options, added after the style parts. Empty when everything
// is at its default, so the defaults give exactly Umbra.
function optionsCss(options, enabled, greys) {
    const o = {...OPTIONS, ...options};
    if (Object.keys(OPTIONS).every(k => o[k] === OPTIONS[k]))
        return '';

    // Every rounded corner of the theme, as Umbra has it at the default
    // radius (OPTIONS.radius); they all scale with the radius option.
    const scale = o.radius / OPTIONS.radius;
    const radius = base => Math.round(base * scale);

    const rules = [];
    // Dynamic: transparent, and solid while features/topBar/panel.js
    // (DynamicPanel) sets PANEL_SOLID_CLASS because a window touches the bar.
    const transparent = o.panel === 'transparent' || o.panel === 'dynamic';
    if (o.panel === 'theme' || transparent) {
        const bg = o.panel === 'theme' ? greys['#222226'] : 'transparent';
        rules.push(`#panel { background-color: ${bg}; }`);
        if (o.panel === 'dynamic') {
            const solid = o['panel-solid'] === 'black' ? 'black' : greys['#222226'];
            rules.push(`#panel.${PANEL_SOLID_CLASS} { background-color: ${solid}; }`);
        }
        // After the solid rule, which has the same specificity.
        rules.push('#panel:overview, #panel.unlock-screen, #panel.login-screen {\n' +
            '  background-color: transparent; }');
    }
    // Keeps text and icons readable on a light wallpaper.
    if (transparent && o['panel-shadow'] > 0) {
        const shadow = `0 1px 3px rgba(0, 0, 0, ${o['panel-shadow'] / 100})`;
        rules.push(`#panel .panel-button {\n  text-shadow: ${shadow}; }`,
            `#panel .panel-button StIcon {\n  icon-shadow: ${shadow}; }`,
            // The workspace indicator's dots are plain widgets, not text, so
            // they get the same shadow as a box-shadow (St follows the radius).
            `#panel .panel-button#panelActivities .workspace-dot {\n  box-shadow: ${shadow}; }`);
        if (o.panel === 'dynamic')
            rules.push(`#panel.${PANEL_SOLID_CLASS} .panel-button {\n  text-shadow: none; }`,
                `#panel.${PANEL_SOLID_CLASS} .panel-button StIcon {\n  icon-shadow: none; }`,
                `#panel.${PANEL_SOLID_CLASS} .panel-button#panelActivities .workspace-dot {\n  box-shadow: none; }`);
    }
    if (enabled.has('sliders')) {
        const h = o['slider-height'];
        rules.push(`.quick-slider .slider {\n  -barlevel-height: ${h}px;\n` +
            `  -slider-handle-radius: ${Math.round(h / 2) + 3}px; }`);
    }
    // The Quick Settings panel and the calendar are popup menus too, so their
    // radius comes after the menus' one.
    if (enabled.has('menus'))
        rules.push(`.popup-menu-content, .candidate-popup-content {\n` +
            `  border-radius: ${radius(20)}px;\n` +
            `  box-shadow: 0 2px 6px rgba(0, 0, 0, ${o['menu-shadow'] / 100}); }`);
    if (enabled.has('quick-settings'))
        rules.push(`.quick-settings { border-radius: ${radius(28)}px; }`,
            `.quick-toggle-menu { border-radius: ${radius(20)}px; }`,
            `.quick-toggle-menu .popup-menu-item { border-radius: ${radius(10)}px; }`);
    if (enabled.has('dash') && o['dash-style'] === 'umbra' && o.radius !== OPTIONS.radius) {
        rules.push(`#dash .dash-background { border-radius: ${radius(18)}px; }`,
            '#dash .dash-item-container .show-apps .overview-icon,\n' +
            '#dash .dash-item-container .overview-tile .overview-icon,\n' +
            '#dash .dash-item-container .grid-search-result .overview-icon {\n' +
            `  border-radius: ${radius(12)}px; }`);
    }
    if (enabled.has('calendar'))
        rules.push(`.datemenu-popover { border-radius: ${radius(28)}px; }`,
            '.message, .events-button, .world-clocks-button, .weather-button,\n' +
            `.message-view .message { border-radius: ${radius(16)}px; }`);

    if (!rules.length)
        return '';
    return `\n/* ================= Options ================= */\n${rules.join('\n')}\n`;
}

/**
 * @param {object} params - what to build
 * @param {string} params.stockCss - GNOME's gnome-shell-dark.css
 * @param {number} params.darkness - 0 keeps GNOME's greys, 100 is Umbra
 * @param {Map<string, string>} params.parts - id -> CSS of the enabled
 *     style parts, in STYLE_PARTS order
 * @param {object} [params.options] - values for OPTIONS, missing ones default
 * @param {string} [params.source] - shown in the header comment
 * @returns {string} the stylesheet
 */
export function buildCss({stockCss, darkness, parts, options = {}, source = ''}) {
    const t = darkness / 100;

    const greys = {};
    for (const [from, to] of Object.entries(GREYS))
        greys[from] = rgbToHex(mix(hexToRgb(from), hexToRgb(to), t));

    if (parts.has('dash')) {
        const css = options['dash-style'] === 'gnome' ? GNOME_DASH_CSS : parts.get('dash');
        parts = new Map(parts).set('dash', css.replaceAll('@dash-bg@', dashBackground(greys)));
    }
    const rgbaGreys = {};
    for (const [from, to] of Object.entries(RGBA_GREYS))
        rgbaGreys[from] = mix(parseTriple(from), parseTriple(to), t).join(', ');

    const hexRe = new RegExp(Object.keys(GREYS).join('|'), 'g');
    const rgbaRe = new RegExp(`rgba\\((${Object.keys(RGBA_GREYS).join('|')}),`, 'g');
    const recoloured = stockCss
        .replace(hexRe, m => greys[m])
        .replace(rgbaRe, (_m, rgb) => `rgba(${rgbaGreys[rgb]},`);

    const out = [
        `/* Umbra — generated by jh-fixes${source ? ` from ${source}` : ''}. ` +
        'Do not edit; change it in the jh-fixes preferences. */\n',
        recoloured,
        '\n',
        ...parts.values(),
        optionsCss(options, new Set(parts.keys()), greys),
    ];
    return out.join('');
}
