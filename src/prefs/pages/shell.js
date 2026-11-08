import {choice, custom, group, number, section, shortcut, slider, text, toggle, toggles} from '../ui/build.js';
import {launcherHistory} from '../editors/launcher.js';
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
        group('Login', [
            toggle('overview-at-startup', 'Open the Overview at login',
                {subtitle: 'Off: start on the desktop instead'}),
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

const launcher = {
    title: 'Launcher',
    icon: 'system-search-symbolic',
    groups: [
        group('Launcher', [
            toggle('launcher', 'Search launcher', {
                subtitle: 'A Raycast-style search box for apps, windows, files and more',
                options: [
                    toggle('launcher-popup', 'Open with a shortcut',
                        {subtitle: 'Turn off to use the launcher only from the Overview'}),
                    shortcut('launcher-shortcut', 'Shortcut', {showIf: 'launcher-popup'}),
                    toggle('launcher-overview-search', 'Replace the Overview search',
                        {subtitle: 'Typing in the Overview opens the launcher instead of GNOME search'}),
                ],
            }),
        ]),
        group('Search In', [
            toggle('launcher-apps', 'Applications', {
                options: [toggle('launcher-rank-by-usage', 'Rank often used apps higher')],
            }),
            toggle('launcher-windows', 'Open windows', {
                options: [toggles('launcher-window-scope', 'Windows from',
                    [['all', 'All workspaces'], ['workspace', 'This workspace']])],
            }),
            toggle('launcher-settings-panels', 'Settings panels'),
            toggle('launcher-system-actions', 'System actions',
                {subtitle: 'Lock, log out, suspend, restart, power off, screenshot'}),
            toggle('launcher-files', 'Recent files'),
            toggle('launcher-calculator', 'Calculator',
                {subtitle: 'Type maths like 2^10 / 4; Enter copies the result'}),
            toggle('launcher-commands', 'Shell commands', {
                subtitle: 'Start the search with the prefix to run a command',
                options: [text('launcher-command-prefix', 'Command prefix')],
            }),
            toggle('launcher-web-search', 'Web search', {
                options: [
                    choice('launcher-web-search-engine', 'Search engine', [
                        ['duckduckgo', 'DuckDuckGo'],
                        ['google', 'Google'],
                        ['bing', 'Bing'],
                        ['startpage', 'Startpage'],
                        ['brave', 'Brave Search'],
                        ['ecosia', 'Ecosia'],
                        ['custom', 'Custom'],
                    ]),
                    text('launcher-web-search-url', 'Custom address (%s = search)',
                        {showIf: {key: 'launcher-web-search-engine', is: 'custom'}}),
                    toggles('launcher-web-search-when', 'Offer it',
                        [['always', 'Always'], ['no-results', 'Only without results']]),
                ],
            }),
        ], {requires: 'launcher'}),
        group('Results', [
            toggle('launcher-group-results', 'Group by type',
                {subtitle: 'Off: one list ranked by match'}),
            number('launcher-max-results', 'Results per type', {
                showIf: 'launcher-group-results',
            }),
            number('launcher-visible-rows', 'Rows before scrolling'),
            choice('launcher-empty-state', 'Before typing, show', [
                ['recent', 'Recently opened'],
                ['frequent', 'Most used apps'],
                ['none', 'Nothing'],
            ]),
            toggle('launcher-remember-history', 'Remember what was opened',
                {subtitle: 'Ranks those results higher and lists them before typing'}),
            custom(launcherHistory),
        ], {requires: 'launcher'}),
        group('Look', [
            toggles('launcher-position', 'Position', [['top', 'Upper third'], ['center', 'Centre']]),
            choice('launcher-monitor', 'Monitor', [
                ['focused', 'With the focused window'],
                ['pointer', 'With the pointer'],
                ['primary', 'Primary'],
            ]),
            number('launcher-width', 'Width', {unit: 'px', step: 20}),
            choice('launcher-icon-size', 'Icon size', [16, 24, 32, 40, 48], {format: v => `${v} px`}),
            choice('launcher-font-size', 'Text size', [9, 10, 11, 12, 13, 14, 16], {format: v => `${v} pt`}),
            slider('launcher-opacity', 'Background opacity', {unit: ' %', step: 5, marks: [50, 100]}),
            slider('launcher-dim', 'Dim the screen', {unit: ' %', step: 5, marks: [0, 25, 80]}),
            toggle('launcher-show-subtitles', 'Second line with details'),
            toggle('launcher-show-kind', 'Result type label'),
            toggle('launcher-show-footer', 'Action bar',
                {subtitle: 'Shows what Enter and Shift+Enter do'}),
        ], {requires: 'launcher'}),
        group('Keyboard', [
            toggles('launcher-escape', 'Escape', [['close', 'Closes'], ['clear', 'Clears, then closes']]),
            toggle('launcher-remember-query', 'Keep the last search',
                {subtitle: 'Reopening shows what you typed last, unless you opened something'}),
        ], {
            requires: 'launcher',
            description: 'Up/Down, Tab or Ctrl+N/P move. Enter opens, Shift+Enter does the second action (new window, close window, show in folder). Alt+1–9 opens a result directly.',
        }),
    ],
};

export default {
    title: 'Shell',
    icon: 'preferences-desktop-display-symbolic',
    groups: [topBar, dash, overview, windows, altTab, launcher].map(section),
};
