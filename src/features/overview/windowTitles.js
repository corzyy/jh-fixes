// Hides the title labels on window previews in the Overview.
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {WindowPreview} from 'resource:///org/gnome/shell/ui/windowPreview.js';

import {actorsOfType} from '../../lib/shell.js';
import {SettingTweak} from '../../lib/tweak.js';

// The title fades in on hover through a transition; stop it so it stays hidden.
function hideTitle(preview) {
    preview._title?.remove_all_transitions();
    preview._title?.hide();
}

export class WindowTitles extends SettingTweak {
    static KEY = 'overview-window-titles';

    // showOverlay() is what reveals the title. overlapHeights() reserves room for it in
    // the layout, so report zero to use that space for the previews. Previews that
    // already exist are fixed up directly.
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
