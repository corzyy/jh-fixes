// Top Bar section of the Shell page. Shell side: features/topBar/.

import {choice, group, number, toggle, toggles} from '../ui/build.js';

export default {
    title: 'Top Bar',
    icon: 'go-top-symbolic',
    groups: [
        group('Items', '', [
            toggle('panel-activities-button', 'Activities button', ''),
            toggles('clock-style', 'Clock shows', '',
                [['default', 'Date and time'], ['time', 'Time only']]),
        ]),
        group('Background', '', [
            choice('shell-theme-panel', 'Bar background', '', [
                    ['black', 'Black'],
                    ['theme', 'Theme grey'],
                    ['transparent', 'Transparent'],
                    ['dynamic', 'Dynamic'],
                ]),
            choice('shell-theme-panel-solid', 'Dynamic: behind windows', '',
                [['theme', 'Theme grey'], ['black', 'Black']],
                {showIf: {key: 'shell-theme-panel', is: 'dynamic'}}),
            number('shell-theme-panel-shadow', 'Text shadow', '',
                {unit: '%', step: 5,
                    showIf: {key: 'shell-theme-panel', in: ['transparent', 'dynamic']}}),
        ], {requires: 'shell-theme'}),
    ],
};
