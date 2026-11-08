import {choice, custom, group, number, section, shortcut, toggle} from '../ui/build.js';
import {panelLayout} from '../editors/panelLayout.js';
import {KEYS as PANEL_KEYS} from '../../lib/panelCatalog.js';

const auto = v => (v === 0 ? 'Automatic' : `${v}`);

const topBar = {
    title: 'Top Bar',
    icon: 'go-top-symbolic',
    groups: [
        group('Layout', [
            custom(panelLayout, [PANEL_KEYS.layout, PANEL_KEYS.hidden, PANEL_KEYS.clock]),
        ], {description: 'Drag items to move them, or below the bar to hide them. Click items with an arrow for their options. Dimmed items are not showing right now.'}),
        group('Items', [
            toggle('panel-activities-button', 'Activities button'),
        ]),
        group('Background', [
            choice('shell-theme-panel', 'Bar background', [
                ['black', 'Black'],
                ['theme', 'Theme grey'],
                ['transparent', 'Transparent'],
                ['dynamic', 'Dynamic'],
            ]),
            choice('shell-theme-panel-solid', 'Dynamic: behind windows',
                [['theme', 'Theme grey'], ['black', 'Black']],
                {showIf: {key: 'shell-theme-panel', is: 'dynamic'}}),
            number('shell-theme-panel-shadow', 'Text shadow', {
                unit: '%', step: 5,
                showIf: {key: 'shell-theme-panel', in: ['transparent', 'dynamic']},
            }),
        ], {requires: 'shell-theme'}),
    ],
};

const dash = {
    title: 'Dash',
    icon: 'user-bookmarks-symbolic',
    groups: [
        group('Dash', [
            toggle('dash-visible', 'Show the dash'),
            choice('dash-max-icon-size', 'Largest icon size', [16, 22, 24, 32, 48, 64],
                {format: v => `${v} px`, requires: 'dash-visible'}),
            toggle('dash-show-apps-button', 'Show Apps button', {requires: 'dash-visible'}),
        ]),
    ],
};

const overview = {
    title: 'Overview',
    icon: 'view-app-grid-symbolic',
    groups: [
        group('Windows', [
            toggle('overview-window-titles', 'Window names'),
        ]),
        group('App Grid', [
            choice('app-grid-columns', 'Columns per page',
                [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], {format: auto}),
            choice('app-grid-rows', 'Rows per page',
                [0, 2, 3, 4, 5, 6, 7, 8], {format: auto}),
        ]),
    ],
};

const windows = {
    title: 'Windows',
    icon: 'focus-windows-symbolic',
    groups: [
        group('Windows', [
            toggle('window-corners', 'Rounded corners'),
            toggle('show-desktop', 'Show Desktop', {
                options: [shortcut('show-desktop-shortcut', 'Shortcut')],
            }),
        ]),
    ],
};

const altTab = {
    title: 'Alt+Tab',
    icon: 'view-dual-symbolic',
    groups: [
        group('Alt+Tab', [
            choice('alt-tab-mode', 'Switches between', [['apps', 'Apps'], ['windows', 'Windows']]),
            choice('alt-tab-window-style', 'Window style', [
                ['gnome', 'As GNOME does'],
                ['thumbnails', 'Previews'],
                ['icons', 'App icons'],
                ['both', 'Previews with icons'],
            ], {showIf: {key: 'alt-tab-mode', is: 'windows'}}),
            number('alt-tab-popup-delay', 'Delay before it appears', {unit: 'ms', step: 50}),
        ]),
    ],
};

export default {
    title: 'Shell',
    icon: 'preferences-desktop-display-symbolic',
    groups: [topBar, dash, overview, windows, altTab].map(section),
};
