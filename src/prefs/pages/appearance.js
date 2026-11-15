import {choice, custom, group, number, toggle} from '../ui/build.js';
import {userThemesWarning} from '../editors/theme.js';

export default {
    title: 'Appearance',
    icon: 'preferences-desktop-appearance-symbolic',
    groups: [
        group('Top Bar', [
            custom(userThemesWarning),
            choice('shell-theme-panel', 'Background', [
                ['black', 'Black'],
                ['theme', 'Theme grey'],
                ['transparent', 'Transparent'],
                ['dynamic', 'Dynamic'],
            ]),
            choice('shell-theme-panel-solid', 'Behind windows',
                [['theme', 'Theme grey'], ['black', 'Black']],
                {showIf: {key: 'shell-theme-panel', is: 'dynamic'}}),
            number('shell-theme-panel-shadow', 'Text shadow', {
                unit: '%', step: 5,
                showIf: {key: 'shell-theme-panel', in: ['transparent', 'dynamic']},
            }),
            number('panel-clock-gap', 'Clock gap', {
                unit: 'px', step: 2,
                subtitle: 'Space between Quick Settings and the clock when they sit side by side',
            }),
            toggle('panel-clock-right-space', 'Space right of the clock'),
        ]),
        group('On-Screen Display', [
            choice('osd-style', 'Style', [
                ['gnome', 'As GNOME does'],
                ['compact', 'Compact'],
            ], {subtitle: 'Compact is a slim pill with the value as a number, like on Windows'}),
        ]),
        group('Updates', [
            toggle('update-banner', 'Check for updates',
                {subtitle: 'Looks on GitHub when the preferences open'}),
        ]),
    ],
};
