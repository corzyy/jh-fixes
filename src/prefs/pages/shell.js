import {section} from '../ui/build.js';
import topBar from './topBar.js';
import dock from './dock.js';
import overview from './overview.js';
import windows from './windows.js';
import altTab from './altTab.js';

export default {
    title: 'Shell',
    icon: 'preferences-desktop-display-symbolic',
    groups: [topBar, dock, overview, windows, altTab].map(section),
};
