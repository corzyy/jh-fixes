import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {PAGES} from './prefs/pages/index.js';
import {buildPage} from './prefs/ui/build.js';
import {addUpdateBanner} from './prefs/update.js';

export default class JhFixesPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        window.search_enabled = true;
        window.set_default_size(1060, 900);

        const ctx = {settings, window};
        const pages = PAGES.map(spec => buildPage(spec, ctx));
        pages.forEach(page => window.add(page));
        addUpdateBanner(pages, {window, path: this.path});
    }
}
