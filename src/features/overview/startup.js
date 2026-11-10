// Show the desktop instead of the Overview right after login.
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {SettingTweak} from '../../lib/tweak.js';

export class OverviewAtStartup extends SettingTweak {
    static KEY = 'overview-at-startup';

    // GNOME opens the Overview at startup if the session mode allows it. Pretend it does
    // not until startup has completed, then put the original value back. Only relevant
    // while the shell is still starting up.
    _apply() {
        const layout = Main.layoutManager;
        if (!layout._startingUp)
            return;
        this._hadOverview = Main.sessionMode.hasOverview;
        Main.sessionMode.hasOverview = false;
        layout.connectObject('startup-complete', () => this._restore(), this);
    }

    _revert() {
        this._restore();
    }

    _restore() {
        Main.layoutManager.disconnectObject(this);
        if (this._hadOverview === undefined)
            return;
        Main.sessionMode.hasOverview = this._hadOverview;
        this._hadOverview = undefined;
    }
}
