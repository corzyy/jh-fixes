import {choice, group, toggle} from '../ui/build.js';

const ICON_SIZES = [16, 22, 24, 32, 48, 64];

export default {
    title: 'Dash',
    icon: 'user-bookmarks-symbolic',
    groups: [
        group('Dash', '', [
            toggle('dash-visible', 'Show the dash', ''),
            choice('dash-max-icon-size', 'Largest icon size', '',
                ICON_SIZES, {format: v => `${v} px`, requires: 'dash-visible'}),
            toggle('dash-show-apps-button', 'Show Apps button', '',
                {requires: 'dash-visible'}),
        ]),
    ],
};
