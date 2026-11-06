// The pages of the preferences window, in order. The Shell page gathers the
// areas top bar, dash, Overview, windows and Alt+Tab (see shell.js); every
// area has a folder of the same name in src/features/ with the code that
// does the work.

import shell from './shell.js';
import quickSettings from './quickSettings.js';
import appearance from './appearance.js';

export const PAGES = [shell, quickSettings, appearance];
