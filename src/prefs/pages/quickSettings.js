import {customGroups, group, link, number, toggle} from '../ui/build.js';
import {LAYOUT_KEYS, quickSettingsLayout} from '../editors/quickSettingsLayout.js';
import {deviceGroup, deviceKeys} from '../editors/soundDevices.js';

const devicesPage = (kind, title) => ({settings}) => {
    const {names, hidden} = deviceKeys(kind);
    return {title, groups: [customGroups(() => deviceGroup(settings, kind), [names, hidden])]};
};

export default {
    title: 'Quick Settings',
    icon: 'emblem-system-symbolic',
    groups: [
        customGroups(quickSettingsLayout, LAYOUT_KEYS),
        group('Size', [
            number('quick-settings-columns', 'Columns'),
        ]),
        group('Extra Controls', [
            toggle('ddc-brightness', 'Brightness of external monitors'),
            toggle('sound-app-volumes', 'Volume for each app'),
            toggle('quick-settings-prefs-button', 'Button for these settings'),
        ]),
        group('Sound Menus', [
            link('Output devices', devicesPage('output', 'Output Devices')),
            link('Input devices', devicesPage('input', 'Input Devices')),
        ]),
    ],
};
