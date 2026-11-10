// Thin prefs entry point; loads the real prefs.js from the current build.
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {importFromCurrentBuild} from './common.js';

export default class JhFixesPrefsLoader extends ExtensionPreferences {
    async fillPreferencesWindow(window) {
        const {default: Impl} = await importFromCurrentBuild(this.path, 'prefs.js');
        await new Impl(this.metadata).fillPreferencesWindow(window);
    }
}
