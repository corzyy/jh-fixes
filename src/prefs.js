// Preferences window: three pages (Shell, Quick Settings, Appearance), built
// from the descriptions in prefs/pages/ by prefs/ui/build.js.

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {PAGES} from './prefs/pages/index.js';
import {buildPage} from './prefs/ui/build.js';

export default class JhFixesPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        // Keeps the settings alive as long as the window.
        window._settings = settings;
        window.search_enabled = true;
        window.set_default_size(1060, 900);

        const ctx = {settings, window};
        for (const spec of PAGES)
            window.add(buildPage(spec, ctx));
    }
}
