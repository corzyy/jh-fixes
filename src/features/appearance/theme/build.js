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

export const PANEL_SOLID_CLASS = 'jh-fixes-panel-solid';

const PANEL_GREY = GREYS['#222226'];

const GREY_RE = new RegExp(
    `${Object.keys(GREYS).join('|')}|rgba\\((${Object.keys(RGBA_GREYS).join('|')}),`, 'g');

function panelCss({panel, solid, shadow}) {
    const dynamic = panel === 'dynamic';
    const transparent = panel === 'transparent' || dynamic;
    if (panel !== 'theme' && !transparent)
        return '';

    const rules = [`#panel { background-color: ${transparent ? 'transparent' : PANEL_GREY}; }`];
    if (dynamic) {
        rules.push(`#panel.${PANEL_SOLID_CLASS} { background-color: ${
            solid === 'black' ? 'black' : PANEL_GREY}; }`);
    }
    rules.push('#panel:overview, #panel.unlock-screen, #panel.login-screen { background-color: transparent; }');
    if (transparent && shadow > 0) {
        const value = `0 1px 3px rgba(0, 0, 0, ${shadow / 100})`;
        const add = (prefix, v) => rules.push(
            `${prefix} .panel-button { text-shadow: ${v}; }`,
            `${prefix} .panel-button StIcon { icon-shadow: ${v}; }`,
            `${prefix} .panel-button#panelActivities .workspace-dot { box-shadow: ${v}; }`);
        add('#panel', value);
        if (dynamic)
            add(`#panel.${PANEL_SOLID_CLASS}`, 'none');
    }
    return `\n${rules.join('\n')}\n`;
}

export function buildCss(stockCss, extraCss, options) {
    const recoloured = stockCss.replace(GREY_RE,
        (m, rgb) => (rgb ? `rgba(${RGBA_GREYS[rgb]},` : GREYS[m]));
    return `${recoloured}\n${extraCss}${panelCss(options)}`;
}
