// Windows section of the Shell page. Shell side: features/windows/.

import {group, shortcut, toggle} from '../ui/build.js';

export default {
    title: 'Windows',
    icon: 'focus-windows-symbolic',
    groups: [
        group('Windows', '', [
            toggle('window-corners', 'Rounded corners', ''),
            toggle('show-desktop', 'Show Desktop', '', {
                    options: [
                        shortcut('show-desktop-shortcut', 'Shortcut', ''),
                    ],
                }),
        ]),
    ],
};
