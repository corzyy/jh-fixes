// Alt+Tab section of the Shell page. Shell side: features/altTab/.

import {choice, group, number} from '../ui/build.js';

export default {
    title: 'Alt+Tab',
    icon: 'view-dual-symbolic',
    groups: [
        group('Alt+Tab', '', [
            choice('alt-tab-mode', 'Switches between', '',
                [['apps', 'Apps'], ['windows', 'Windows']]),
            choice('alt-tab-window-style', 'Window style', '', [
                ['gnome', 'As GNOME does'],
                ['thumbnails', 'Previews'],
                ['icons', 'App icons'],
                ['both', 'Previews with icons'],
            ], {showIf: {key: 'alt-tab-mode', is: 'windows'}}),
            number('alt-tab-popup-delay', 'Delay before it appears', '',
                {unit: 'ms', step: 50}),
        ]),
    ],
};
