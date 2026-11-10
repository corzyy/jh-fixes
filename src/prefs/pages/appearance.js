// Appearance page: top bar background and updates.
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
            // Dynamic mode only: color while a window touches the bar.
            choice('shell-theme-panel-solid', 'Behind windows',
                [['theme', 'Theme grey'], ['black', 'Black']],
                {showIf: {key: 'shell-theme-panel', is: 'dynamic'}}),
            // Text shadow keeps the labels readable on a transparent bar.
            number('shell-theme-panel-shadow', 'Text shadow', {
                unit: '%', step: 5,
                showIf: {key: 'shell-theme-panel', in: ['transparent', 'dynamic']},
            }),
        ]),
        group('Updates', [
            toggle('update-banner', 'Check for updates',
                {subtitle: 'Looks on GitHub when the preferences open'}),
        ]),
    ],
};
