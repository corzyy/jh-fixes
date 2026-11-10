import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {importFromCurrentBuild} from './common.js';

export default class JhFixesLoader extends Extension {
    async enable() {
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
