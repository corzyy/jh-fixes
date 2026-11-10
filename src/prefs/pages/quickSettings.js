import {custom, customGroups, group, link, number, toggle} from '../ui/build.js';
import {backgroundAppsRow, menuItemsGroup, topRowGroup} from '../editors/quickSettingsItems.js';
import {deviceGroup} from '../editors/soundDevices.js';

const subpage = (title, build) => ({settings}) =>
    ({title, groups: [customGroups(() => build(settings))]});

export default {
    title: 'Quick Settings',
    icon: 'emblem-system-symbolic',
    groups: [
        group('Menu', [
            link('Menu items', subpage('Menu Items', menuItemsGroup)),
            link('Top row buttons', subpage('Top Row Buttons', topRowGroup)),
            number('quick-settings-columns', 'Columns'),
        ]),
        group('Extras', [
            toggle('ddc-brightness', 'Brightness of external monitors'),
            toggle('sound-app-volumes', 'Volume for each app'),
            custom(backgroundAppsRow),
        ]),
        group('Sound Devices', [
            link('Output devices', subpage('Output Devices', s => deviceGroup(s, 'output'))),
            link('Input devices', subpage('Input Devices', s => deviceGroup(s, 'input'))),
        ]),
    ],
};
