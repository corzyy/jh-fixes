// Hide the caption under a window in the Overview: the window title (or the
// app name, for windows without one) that fades in when you point at it.
//
// WindowPreview (ui/windowPreview.js) shows the caption in showOverlay(),
// together with the close button. The override lets that run and then puts
// the caption away again, so the close button and the zoom still work.
// overlapHeights() is what keeps room for the caption at the bottom of the
// screen; without the caption there is nothing to keep room for.

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

    // Nothing to put back: the next showOverlay() shows the caption again.
}
