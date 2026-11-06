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

const RGBA_GREYS = {
    '56, 56, 59': '26, 26, 29',
    '54, 54, 58': '24, 24, 27',
    '46, 46, 51': '21, 21, 23',
    '34, 34, 38': '14, 14, 16',
};

export const STYLE_PARTS = [
    'sliders',
    'switches',
    'menus',
    'quick-settings',
    'dash',
    'calendar',
];

export const FIXED_PARTS = ['switches', 'quick-settings', 'calendar'];

export const OPTIONS = {
    'panel': 'black',
    'panel-solid': 'theme',
    'panel-shadow': 50,
    'slider-height': 12,
    'radius': 20,
    'menu-shadow': 35,
    'dash-style': 'umbra',
};

const MENU_GREY = '#36363a';
const dashBackground = greys => rgbToHex(mix(hexToRgb(greys[MENU_GREY]), [255, 255, 255], 0.06));

const DASH_ICON = ['show-apps', 'overview-tile', 'grid-search-result']
    .map(c => `#dash .dash-item-container .${c}`);
const dashIcons = (state = '', iconState = '') =>
    DASH_ICON.map(s => `${s}${state} .overview-icon${iconState}`).join(',\n');
const FOCUS = 'st-mix(-st-accent-color, #ffffff, 60%)';
const GNOME_DASH_CSS = [
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

const GREY_RE = new RegExp(
    `${Object.keys(GREYS).join('|')}|rgba\\((${Object.keys(RGBA_GREYS).join('|')}),`, 'g');

export const PANEL_SOLID_CLASS = 'jh-fixes-panel-solid';

const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const rgbToHex = rgb => `#${rgb.map(c => c.toString(16).padStart(2, '0')).join('')}`;
const parseTriple = s => s.split(',').map(Number);

const mix = (from, to, t) => from.map((c, i) =>
    Math.min(255, Math.max(0, Math.round(c + (to[i] - c) * t))));

function optionsCss(options, enabled, greys) {
    const o = {...OPTIONS, ...options};
    if (Object.keys(OPTIONS).every(k => o[k] === OPTIONS[k]))
        return '';

    const scale = o.radius / OPTIONS.radius;
    const radius = base => Math.round(base * scale);

    const rules = [];
    const transparent = o.panel === 'transparent' || o.panel === 'dynamic';
    if (o.panel === 'theme' || transparent) {
        const bg = o.panel === 'theme' ? greys['#222226'] : 'transparent';
        rules.push(`#panel { background-color: ${bg}; }`);
        if (o.panel === 'dynamic') {
            const solid = o['panel-solid'] === 'black' ? 'black' : greys['#222226'];
            rules.push(`#panel.${PANEL_SOLID_CLASS} { background-color: ${solid}; }`);
        }
        rules.push('#panel:overview, #panel.unlock-screen, #panel.login-screen {\n' +
            '  background-color: transparent; }');
    }
    if (transparent && o['panel-shadow'] > 0) {
        const shadow = `0 1px 3px rgba(0, 0, 0, ${o['panel-shadow'] / 100})`;
        rules.push(`#panel .panel-button {\n  text-shadow: ${shadow}; }`,
            `#panel .panel-button StIcon {\n  icon-shadow: ${shadow}; }`,
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
    return `\n${rules.join('\n')}\n`;
}

export function buildCss({stockCss, darkness, parts, options = {}}) {
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

    const recoloured = stockCss.replace(GREY_RE,
        (m, rgb) => (rgb ? `rgba(${rgbaGreys[rgb]},` : greys[m]));

    return [recoloured, '\n', ...parts.values(), optionsCss(options, new Set(parts.keys()), greys)].join('');
}
