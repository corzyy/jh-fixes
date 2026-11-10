// Shell page: Overview, windows, Alt+Tab and launcher.
import {choice, custom, group, link, number, shortcut, toggle} from '../ui/build.js';
import {launcherHistory} from '../editors/launcher.js';

// Label for 0, which means "let GNOME decide" for the app grid.
const auto = v => (v === 0 ? 'Automatic' : `${v}`);

// Subpage listing what the launcher searches.
const launcherSources = () => ({
    title: 'Launcher Search',
    groups: [
        group('Search In', [
            toggle('launcher-apps', 'Applications'),
            toggle('launcher-windows', 'Open windows'),
            toggle('launcher-settings-panels', 'Settings panels'),
            toggle('launcher-system-actions', 'System actions'),
            toggle('launcher-files', 'Recent files'),
            toggle('launcher-calculator', 'Calculator'),
            toggle('launcher-commands', 'Shell commands', {subtitle: 'Start the search with >'}),
            toggle('launcher-web-search', 'Web search', {subtitle: 'DuckDuckGo'}),
        ], {
            description: 'Enter opens, Shift+Enter does the second action (new window, close window, show in folder). Alt+1–9 opens a result directly.',
        }),
        group('', [custom(launcherHistory)]),
    ],
});

export default {
    title: 'Shell',
    icon: 'preferences-desktop-display-symbolic',
    groups: [
        group('Overview', [
            toggle('overview-window-titles', 'Window names'),
            toggle('overview-at-startup', 'Open at login'),
            choice('app-grid-columns', 'App grid columns',
                [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], {format: auto}),
            choice('app-grid-rows', 'App grid rows',
                [0, 2, 3, 4, 5, 6, 7, 8], {format: auto}),
        ]),
        group('Windows', [
            toggle('window-corners', 'Rounded corners'),
            toggle('show-desktop', 'Show Desktop', {
                options: [shortcut('show-desktop-shortcut', 'Shortcut')],
            }),
        ]),
        group('Alt+Tab', [
            choice('alt-tab-mode', 'Switches between', [['apps', 'Apps'], ['windows', 'Windows']]),
            choice('alt-tab-window-style', 'Window style', [
                ['gnome', 'As GNOME does'],
                ['thumbnails', 'Previews'],
                ['icons', 'App icons'],
                ['both', 'Previews with icons'],
            ], {showIf: {key: 'alt-tab-mode', is: 'windows'}}),
            number('alt-tab-popup-delay', 'Popup delay', {unit: 'ms', step: 50}),
        ]),
        group('Launcher', [
            toggle('launcher', 'Search launcher', {
                options: [
                    toggle('launcher-overview-search', 'Replace the Overview search'),
                    toggle('launcher-popup', 'Open with a shortcut'),
                    shortcut('launcher-shortcut', 'Shortcut', {showIf: 'launcher-popup'}),
                ],
            }),
            link('Search sources', launcherSources, {requires: 'launcher'}),
        ]),
    ],
};
