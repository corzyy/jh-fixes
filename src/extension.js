import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import * as TopBar from './features/topBar/index.js';
import * as QuickSettings from './features/quickSettings/index.js';
import * as Dock from './features/dock/index.js';
import * as Overview from './features/overview/index.js';
import * as Windows from './features/windows/index.js';
import * as AltTab from './features/altTab/index.js';
import * as Appearance from './features/appearance/index.js';

const AREAS = [TopBar, QuickSettings, Dock, Overview, Windows, AltTab, Appearance];

export default class JhFixesExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._features = [];
        for (const Feature of AREAS.flatMap(area => area.FEATURES)) {
            try {
                const feature = new Feature(this._settings, this);
                this._features.push(feature);
                feature.enable();
            } catch (e) {
                console.error(`jh-fixes: ${Feature.name} failed to enable`, e);
            }
        }
    }

    disable() {
        for (const feature of this._features.reverse()) {
            try {
                feature.disable();
            } catch (e) {
                console.error(`jh-fixes: ${feature.constructor.name} failed to disable`, e);
            }
        }
        this._features = null;
        this._settings = null;
    }
}
