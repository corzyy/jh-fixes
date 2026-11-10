// Thin entry point that lives in the install root; see common.js for why.
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {importFromCurrentBuild} from './common.js';

export default class JhFixesLoader extends Extension {
    async enable() {
        // The import is async. If disable() runs before it resolves, the token no longer
        // matches and the freshly loaded implementation is discarded.
        const token = (this._token = Symbol('enable'));
        const {default: Impl} = await importFromCurrentBuild(this.path, 'extension.js');
        if (this._token !== token)
            return;
        this._impl = new Impl(this.metadata);
        this._impl.enable();
    }

    disable() {
        this._token = null;
        this._impl?.disable();
        this._impl = null;
    }
}
