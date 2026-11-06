// Windows: how they look, Show Desktop.
//
// Rounded corners are off by default and only loaded once turned on.

import {lazyFeature} from '../../lib/lazy.js';
import {ShowDesktop} from './showDesktop.js';

export const FEATURES = [
    lazyFeature('window-corners',
        async () => (await import('./roundedCorners.js')).RoundedCorners),
    ShowDesktop,
];
