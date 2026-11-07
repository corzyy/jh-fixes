export const KEYS = {
    layout: 'panel-layout',
    known: 'known-panel-items',
    present: 'present-panel-items',
    hidden: 'hidden-panel-items',
    clock: 'clock-style',
};

export const ACTIVITIES_KEY = 'panel-activities-button';

export const BOXES = ['left', 'center', 'right'];

export const STOCK_ITEMS = {
    activities: {title: 'Activities', icon: 'view-app-grid-symbolic', box: 'left'},
    dateMenu: {title: 'Clock', icon: 'preferences-system-time-symbolic', box: 'center'},
    screenRecording: {title: 'Screen Recording & Sharing', icon: 'screen-shared-symbolic', box: 'right'},
    screenSharing: {title: 'Screen Sharing', icon: 'screen-shared-symbolic', box: 'right'},
    dwellClick: {title: 'Dwell Click', icon: 'pointer-primary-click-symbolic', box: 'right'},
    a11y: {title: 'Accessibility', icon: 'preferences-desktop-accessibility-symbolic', box: 'right'},
    keyboard: {title: 'Keyboard Layout', icon: 'input-keyboard-symbolic', box: 'right'},
    quickSettings: {title: 'Quick Settings', icon: 'system-shutdown-symbolic', box: 'right'},
};

export const FOLLOWERS = {
    screenRecording: ['screenSharing'],
};
export const isFollower = role => Object.values(FOLLOWERS).some(f => f.includes(role));
export const withFollowers = role => [role, ...(FOLLOWERS[role] ?? [])];

export const isStock = role => Object.hasOwn(STOCK_ITEMS, role);

export function arrangeBoxes(stored, items) {
    const result = {left: [], center: [], right: []};
    const placed = new Set();
    for (const box of BOXES) {
        for (const role of stored[box] ?? []) {
            if (items.has(role) && !placed.has(role)) {
                result[box].push(role);
                placed.add(role);
            }
        }
    }
    const unplaced = [...items].filter(([role]) => !placed.has(role));
    for (const [role, {box}] of unplaced.filter(([role]) => isStock(role)))
        (result[box] ?? result.right).push(role);
    for (const [role, {box}] of unplaced.filter(([role]) => !isStock(role)).reverse())
        (result[box] ?? result.right).unshift(role);
    return result;
}
