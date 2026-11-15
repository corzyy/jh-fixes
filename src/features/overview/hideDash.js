import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SettingTweak} from '../../lib/tweak.js';

// The overview layout asks the dash for its preferred height, so pinning that to 0
// hands its space to the workspaces and the app grid instead of leaving a hole.
export class HideDash extends SettingTweak {
    static KEY = 'overview-dash';
    static DEFAULT = true;

    _apply() {
        const {dash} = Main.overview;
        dash.hide();
        dash.height = 0;
    }

    _revert() {
        const {dash} = Main.overview;
        dash.height = -1;
        dash.show();
    }
}
