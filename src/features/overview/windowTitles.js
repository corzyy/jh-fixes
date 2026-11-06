import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {WindowPreview} from 'resource:///org/gnome/shell/ui/windowPreview.js';

import {actorsOfType} from '../../lib/shell.js';
import {SettingTweak} from '../../lib/tweak.js';

function hideTitle(preview) {
    preview._title?.remove_all_transitions();
    preview._title?.hide();
}

export class WindowTitles extends SettingTweak {
    static KEY = 'overview-window-titles';

    _apply() {
        this._injections.overrideMethod(WindowPreview.prototype, 'showOverlay',
            original => function (...args) {
                original.apply(this, args);
                hideTitle(this);
            });
        this._injections.overrideMethod(WindowPreview.prototype, 'overlapHeights',
            () => () => [0, 0]);
        for (const preview of actorsOfType(Main.layoutManager.overviewGroup, WindowPreview))
            hideTitle(preview);
    }
}
