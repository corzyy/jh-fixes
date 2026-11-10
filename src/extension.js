// Extension entry point: creates every feature and ties it to enable()/disable().
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {lazyFeature} from './lib/lazy.js';
import {DynamicPanel} from './features/topBar/panel.js';
import {QuickSettingsItems} from './features/quickSettings/items.js';
import {PrefsButton} from './features/quickSettings/prefsButton.js';
import {InputDevices, OutputDevices} from './features/quickSettings/soundDevices.js';
import {AppGridLayout} from './features/overview/appGrid.js';
import {WindowTitles} from './features/overview/windowTitles.js';
import {OverviewAtStartup} from './features/overview/startup.js';
import {ShowDesktop} from './features/windows/showDesktop.js';
import {AltTabSwitcher} from './features/altTab/altTab.js';
import {ShellTheme} from './features/appearance/theme/theme.js';

// Each feature is a class with enable()/disable() constructed with (settings, extension).
// Heavy ones are wrapped in lazyFeature() so their module is only imported once
// their setting is switched on.
const FEATURES = [
    OverviewAtStartup,
    DynamicPanel,
    lazyFeature('ddc-brightness', async () => (await import('./features/quickSettings/ddcBrightness.js')).DdcBrightness),
    QuickSettingsItems,
    lazyFeature('quick-settings-systray', async () => (await import('./features/quickSettings/systemTray.js')).SystemTray),
    PrefsButton,
    lazyFeature('sound-app-volumes', async () => (await import('./features/quickSettings/appVolumes.js')).AppVolumes),
    OutputDevices,
    InputDevices,
    WindowTitles,
    AppGridLayout,
    lazyFeature('window-corners', async () => (await import('./features/windows/roundedCorners.js')).RoundedCorners),
    ShowDesktop,
    AltTabSwitcher,
    lazyFeature('launcher', async () => (await import('./features/launcher/launcher.js')).Launcher),
    ShellTheme,
];

// One failing feature must not take the others down, so each is wrapped in try/catch.
export default class JhFixesExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._features = [];
        for (const Feature of FEATURES) {
            try {
                const feature = new Feature(this._settings, this);
                this._features.push(feature);
                feature.enable();
            } catch (e) {
                console.error(`jh-fixes: ${Feature.name} failed to enable`, e);
            }
        }
    }

    // Tear down in reverse order of creation.
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
