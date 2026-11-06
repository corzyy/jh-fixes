// Quick Settings: the system menu on the right of the top bar, its layout,
// the extra controls jh-fixes adds to it and its sound menus.
//
// The extra controls are off by default and only loaded once turned on.

import {lazyFeature} from '../../lib/lazy.js';
import {QuickSettingsItems} from './items.js';
import {PrefsButton} from './prefsButton.js';
import {InputDevices, OutputDevices} from './soundDevices.js';

export const FEATURES = [
    lazyFeature('ddc-brightness',
        async () => (await import('./ddcBrightness.js')).DdcBrightness),
    QuickSettingsItems,
    PrefsButton,
    lazyFeature('sound-app-volumes',
        async () => (await import('./appVolumes.js')).AppVolumes),
    OutputDevices,
    InputDevices,
];
