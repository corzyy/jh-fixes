// Loader: runs the extension from the current build (see common.js).

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {importFromCurrentBuild} from './common.js';

export default class JhFixesLoader extends Extension {
    async enable() {
        // disable() may run while the import is still pending (the shell
        // only waits for enable() when it enables us itself, not when it
        // re-enables us after disabling another extension). Each enable()
        // gets a token; a disable() in between invalidates it.
        const token = (this._token = Symbol('enable'));
        const {default: Impl} = await importFromCurrentBuild(this.path, 'extension.js');
        if (this._token !== token)
            return;
        // Same metadata, so getSettings() and this.path still point here.
        this._impl = new Impl(this.metadata);
        this._impl.enable();
    }

    disable() {
        this._token = null;
        this._impl?.disable();
        this._impl = null;
    }
}
