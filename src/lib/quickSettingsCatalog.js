export const KEYS = {
    hidden: 'hidden-quick-settings',
    order: 'quick-settings-order',
    widths: 'quick-settings-widths',
    columns: 'quick-settings-columns',
    known: 'known-quick-settings-items',
    knownIcons: 'known-quick-settings-icons',
    knownKinds: 'known-quick-settings-kinds',
    present: 'present-quick-settings-items',
    prefsButton: 'quick-settings-prefs-button',
};

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

export const TOP_ROW_BUTTONS = [
    {id: 'button-battery', title: 'Battery', icon: 'battery-level-80-symbolic', subtitle: 'Only on computers with a battery'},
    {id: 'button-screenshot', title: 'Screenshot', icon: 'applets-screenshooter-symbolic'},
    {id: 'button-settings', title: 'Settings', icon: 'emblem-system-symbolic'},
    {id: 'button-lock', title: 'Lock', icon: 'system-lock-screen-symbolic'},
    {id: 'button-power', title: 'Power Off / Log Out', icon: 'system-shutdown-symbolic'},
];

export const EXTERNAL_PREFIX = 'ext:';

export const FULL_WIDTH = 0;

const CATALOG_RANK = new Map(GRID_ITEMS.map(({id}, i) => [id, i]));
const EXTERNAL_RANK = CATALOG_RANK.get('background-apps') - 0.5;

export function rankOf(id) {
    return CATALOG_RANK.get(id) ?? EXTERNAL_RANK;
}

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

export function spanFor(stored, stockFull, stockSpan, columns) {
    let span;
    if (stored === undefined)
        span = stockFull ? columns : stockSpan;
    else
        span = stored === FULL_WIDTH ? columns : stored;
    return Math.min(Math.max(span, 1), columns);
}
