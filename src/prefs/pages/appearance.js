import {choice, custom, group, slider, toggle} from '../ui/build.js';
import {PALETTE_KEY, STYLES, STYLE_KEYS, paletteGrid, styleRow, userThemesWarning} from '../editors/theme.js';

const SPEEDS = [25, 50, 75, 100, 150, 200];

export default {
    title: 'Appearance',
    icon: 'preferences-desktop-appearance-symbolic',
    groups: [
        group('Shell Theme', '', [
            toggle('shell-theme', 'Umbra theme'),
            custom(userThemesWarning),
        ]),
        group('Colour Theme', '', [
            custom(paletteGrid, [PALETTE_KEY]),
        ], {requires: 'shell-theme'}),
        group('Corners', '', [
            slider('shell-theme-radius', 'Corner radius', '',
                {unit: ' px', step: 1, marks: [0, 20, 40]}),
        ]),
        group('Styled Areas', '',
        STYLES.map((style, i) => custom(ctx => styleRow(style, ctx), i === 0 ? STYLE_KEYS : [])),
        {requires: 'shell-theme'}),
        group('Motion', '', [
            choice('animation-duration', 'Animation duration', '',
                SPEEDS, {format: v => `${v} %`}),
        ]),
    ],
};
