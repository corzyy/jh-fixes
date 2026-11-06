// Overview section of the Shell page. Shell side: features/overview/.

import {choice, group, toggle} from '../ui/build.js';

const AUTOMATIC = 0;
const automaticOr = v => (v === AUTOMATIC ? 'Automatic' : `${v}`);

export default {
    title: 'Overview',
    icon: 'view-app-grid-symbolic',
    groups: [
        group('Windows', '', [
            toggle('overview-window-titles', 'Window names', ''),
        ]),
        group('App Grid', '', [
            choice('app-grid-columns', 'Columns per page', '',
                [AUTOMATIC, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], {format: automaticOr}),
            choice('app-grid-rows', 'Rows per page', '',
                [AUTOMATIC, 2, 3, 4, 5, 6, 7, 8], {format: automaticOr}),
        ]),
    ],
};
