// Shell page: the areas of the shell, each a section that folds open.
// Each area is described in its own file, with the code that does the work
// in the src/features/ folder of the same name.

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
