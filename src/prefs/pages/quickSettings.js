// Quick Settings page. Shell side: features/quickSettings/.

import {customGroups, group, link, number, toggle} from '../ui/build.js';
import {LAYOUT_KEYS, quickSettingsLayout} from '../editors/quickSettingsLayout.js';
import {deviceGroup, deviceKeys} from '../editors/soundDevices.js';

// A page with the devices of one kind ('output' or 'input').
const devicesPage = (kind, title) => ({settings}) => ({
    title,
    groups: [
        customGroups(() => deviceGroup(settings, kind),
            [deviceKeys(kind).names, deviceKeys(kind).hidden]),
    ],
});

export default {
    title: 'Quick Settings',
    icon: 'emblem-system-symbolic',
    groups: [
        customGroups(quickSettingsLayout, LAYOUT_KEYS),
        group('Size', '', [
            number('quick-settings-columns', 'Columns', ''),
        ]),
        group('Extra Controls', '', [
            toggle('ddc-brightness', 'Brightness of external monitors', ''),
            toggle('sound-app-volumes', 'Volume for each app', ''),
            toggle('quick-settings-prefs-button', 'Button for these settings', ''),
        ]),
        group('Sound Menus', '', [
            link('Output devices', '',
                devicesPage('output', 'Output Devices')),
            link('Input devices', '',
                devicesPage('input', 'Input Devices')),
        ]),
    ],
};
