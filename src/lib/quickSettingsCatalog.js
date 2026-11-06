// The Quick Settings items jh-fixes knows by name. Pure data, so both the
// shell side (features/quickSettings/items.js) and the preferences
// (prefs/quickSettingsPage.js) can import it.
//
// Ids are stored in the settings, so never rename one.

/**
 * Grid items in GNOME's own order. `kind` is 'row', 'slider' or 'tile';
 * `icon` is for the preview in the preferences.
 */
export const GRID_ITEMS = [
    {id: 'system', title: 'Top Row', icon: 'system-shutdown-symbolic', kind: 'row', subtitle: 'Battery, Screenshot, Settings, Lock, Power Off'},
    {id: 'volume-output', title: 'Volume', icon: 'audio-volume-high-symbolic', kind: 'slider'},
    {id: 'volume-input', title: 'Microphone', icon: 'audio-input-microphone-symbolic', kind: 'slider', subtitle: 'Only shown while an app is recording'},
    {id: 'brightness', title: 'Screen Brightness', icon: 'display-brightness-symbolic', kind: 'slider', subtitle: 'Only shown with a laptop panel'},
    {id: 'ddc-brightness', title: 'External Monitor Brightness', icon: 'video-display-symbolic', kind: 'slider', subtitle: 'jh-fixes, see External Monitors'},
    {id: 'wired', title: 'Wired', icon: 'network-wired-symbolic', kind: 'tile'},
    {id: 'wifi', title: 'Wi-Fi', icon: 'network-wireless-signal-excellent-symbolic', kind: 'tile'},
    {id: 'mobile-broadband', title: 'Mobile Broadband', icon: 'network-cellular-signal-excellent-symbolic', kind: 'tile'},
    {id: 'bluetooth-tethering', title: 'Bluetooth Tethering', icon: 'bluetooth-active-symbolic', kind: 'tile'},
    {id: 'vpn', title: 'VPN', icon: 'network-vpn-symbolic', kind: 'tile'},
    {id: 'bluetooth', title: 'Bluetooth', icon: 'bluetooth-active-symbolic', kind: 'tile'},
    {id: 'power-mode', title: 'Power Mode', icon: 'power-profile-balanced-symbolic', kind: 'tile'},
    {id: 'night-light', title: 'Night Light', icon: 'night-light-symbolic', kind: 'tile'},
    {id: 'dark-style', title: 'Dark Style', icon: 'weather-clear-night-symbolic', kind: 'tile'},
    {id: 'do-not-disturb', title: 'Do Not Disturb', icon: 'notifications-disabled-symbolic', kind: 'tile'},
    {id: 'keyboard-brightness', title: 'Keyboard Backlight', icon: 'keyboard-brightness-symbolic', kind: 'tile'},
    {id: 'airplane-mode', title: 'Airplane Mode', icon: 'airplane-mode-symbolic', kind: 'tile'},
    {id: 'auto-rotate', title: 'Auto Rotate', icon: 'rotation-allowed-symbolic', kind: 'tile'},
    {id: 'background-apps', title: 'Background Apps', icon: 'application-x-executable-symbolic', kind: 'row', subtitle: 'Only shown while apps run in the background'},
];

/** Buttons inside the top row. */
export const TOP_ROW_BUTTONS = [
    {id: 'button-battery', title: 'Battery', icon: 'battery-level-80-symbolic', subtitle: 'Only on computers with a battery'},
    {id: 'button-screenshot', title: 'Screenshot', icon: 'applets-screenshooter-symbolic'},
    {id: 'button-settings', title: 'Settings', icon: 'emblem-system-symbolic'},
    {id: 'button-lock', title: 'Lock', icon: 'system-lock-screen-symbolic'},
    {id: 'button-power', title: 'Power Off / Log Out', icon: 'system-shutdown-symbolic'},
];

/** Items added by other extensions get this prefix plus their class name. */
export const EXTERNAL_PREFIX = 'ext:';

/** Stored width meaning "all columns". */
export const FULL_WIDTH = 0;

const CATALOG_RANK = new Map(GRID_ITEMS.map(({id}, i) => [id, i]));
// GNOME puts other extensions' items right before Background Apps.
const EXTERNAL_RANK = CATALOG_RANK.get('background-apps') - 0.5;

/**
 * Where GNOME puts an item, for sorting: built-in items in catalog order,
 * other extensions' items just before Background Apps.
 *
 * @param {string} id - item id
 * @returns {number}
 */
export function rankOf(id) {
    return CATALOG_RANK.get(id) ?? EXTERNAL_RANK;
}

/**
 * Arranges item ids by the saved order. Ids not in `order` (all of them while
 * it is empty, or ones that turned up after it was saved) go where GNOME
 * would put them relative to the listed ones.
 *
 * @param {string[]} ids - the ids, in GNOME's order (sorted by rankOf)
 * @param {string[]} order - the saved order
 * @returns {string[]}
 */
export function arrange(ids, order) {
    const position = new Map(order.map((id, i) => [id, i]));
    const result = ids.filter(id => position.has(id))
        .sort((a, b) => position.get(a) - position.get(b));
    for (const id of ids) {
        if (position.has(id))
            continue;
        const before = result.findIndex(other =>
            position.has(other) && rankOf(other) > rankOf(id));
        result.splice(before < 0 ? result.length : before, 0, id);
    }
    return result;
}

/**
 * The column span for an item.
 *
 * @param {number|undefined} stored - the saved width, if any
 * @param {boolean} stockFull - whether GNOME makes it span all columns
 * @param {number} stockSpan - GNOME's span otherwise
 * @param {number} columns - the grid's columns
 * @returns {number}
 */
export function spanFor(stored, stockFull, stockSpan, columns) {
    let span;
    if (stored === undefined)
        span = stockFull ? columns : stockSpan;
    else
        span = stored === FULL_WIDTH ? columns : stored;
    return Math.min(Math.max(span, 1), columns);
}
