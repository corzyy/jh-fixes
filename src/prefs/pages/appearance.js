import {choice, custom, group, slider, toggle} from '../ui/build.js';
import {PALETTE_KEY, STYLES, STYLE_KEYS, paletteGrid, styleRow, userThemesWarning} from '../editors/theme.js';

export default {
    title: 'Appearance',
    icon: 'preferences-desktop-appearance-symbolic',
    groups: [
        group('Shell Theme', [
            toggle('shell-theme', 'Umbra theme'),
            custom(userThemesWarning),
        ]),
        group('Colour Theme', [
            custom(paletteGrid, [PALETTE_KEY]),
        ], {requires: 'shell-theme'}),
        group('Corners', [
            slider('shell-theme-radius', 'Corner radius', {unit: ' px', marks: [0, 20, 40]}),
        ]),
        group('Styled Areas',
            STYLES.map((style, i) => custom(ctx => styleRow(style, ctx), i === 0 ? STYLE_KEYS : [])),
            {requires: 'shell-theme'}),
        group('Volume & Brightness Popups', [
            choice('osd-position', 'Position', [
                ['top-left', 'Top left'],
                ['top', 'Top'],
                ['top-right', 'Top right'],
                ['left', 'Left'],
                ['center', 'Centre'],
                ['right', 'Right'],
                ['bottom-left', 'Bottom left'],
                ['bottom', 'Bottom'],
                ['bottom-right', 'Bottom right'],
            ]),
            choice('osd-size', 'Size', [50, 75, 100, 125, 150, 200],
                {format: v => `${v} %`}),
        ]),
        group('Motion', [
            choice('animation-duration', 'Animation duration', [25, 50, 75, 100, 150, 200],
                {format: v => `${v} %`}),
        ]),
        group('Updates', [
            toggle('update-banner', 'Update banner',
                {subtitle: 'Check GitHub for a newer version when the preferences open'}),
        ]),
    ],
};
