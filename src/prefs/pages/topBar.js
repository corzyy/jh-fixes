import {choice, custom, group, number, toggle} from '../ui/build.js';
import {panelLayout} from '../editors/panelLayout.js';
import {KEYS as PANEL_KEYS} from '../../lib/panelCatalog.js';

export default {
    title: 'Top Bar',
    icon: 'go-top-symbolic',
    groups: [
        group('Layout', 'Drag items to move them, or below the bar to hide them. Click items with an arrow for their options. Dimmed items are not showing right now.', [
            custom(panelLayout, [PANEL_KEYS.layout, PANEL_KEYS.hidden, PANEL_KEYS.clock]),
        ]),
        group('Items', '', [
            toggle('panel-activities-button', 'Activities button', ''),
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
