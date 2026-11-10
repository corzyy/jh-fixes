import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import shell from './prefs/pages/shell.js';
import quickSettings from './prefs/pages/quickSettings.js';
import appearance from './prefs/pages/appearance.js';
import {buildPage} from './prefs/ui/build.js';
import {addUpdateBanner} from './prefs/update.js';

export default class JhFixesPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        window.search_enabled = true;
        window.set_default_size(1060, 900);

        const ctx = {settings, window};
        const pages = [shell, quickSettings, appearance].map(spec => buildPage(spec, ctx));
        pages.forEach(page => window.add(page));
        addUpdateBanner(pages, {window, path: this.path, settings});
    }
}
