import {lazyFeature} from '../../lib/lazy.js';
import {ShowDesktop} from './showDesktop.js';

export const FEATURES = [
    lazyFeature('window-corners',
        async () => (await import('./roundedCorners.js')).RoundedCorners),
    ShowDesktop,
];
