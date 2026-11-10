import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function* actorsOfType(root, type) {
    for (const child of root.get_children()) {
        if (child instanceof type)
            yield child;
        yield* actorsOfType(child, type);
    }
}

export function whenReady(getter, onReady, what, {maxTries = 50} = {}) {
    const value = getter();
    if (value) {
        onReady(value);
        return () => {};
    }
    const waiter = {getter, onReady, what, triesLeft: maxTries};
    waiters.add(waiter);
    pollId ||= GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_INTERVAL, poll);
    return () => {
        waiters.delete(waiter);
        stopPollingIfIdle();
    };
}

const POLL_INTERVAL = 200;
const waiters = new Set();
let pollId = 0;
let polling = false;

function poll() {
    polling = true;
    try {
        pollOnce();
    } finally {
        polling = false;
    }
    if (waiters.size > 0)
        return GLib.SOURCE_CONTINUE;
    pollId = 0;
    return GLib.SOURCE_REMOVE;
}

function pollOnce() {
    for (const waiter of [...waiters]) {
        if (!waiters.has(waiter))
            continue;
        const value = waiter.getter();
        if (value) {
            waiters.delete(waiter);
            try {
                waiter.onReady(value);
            } catch (e) {
                console.error(`jh-fixes: setting up ${waiter.what} failed`, e);
            }
        } else if (--waiter.triesLeft <= 0) {
            waiters.delete(waiter);
            console.warn(`jh-fixes: ${waiter.what} not found, giving up`);
        }
    }
}

function stopPollingIfIdle() {
    if (waiters.size === 0 && pollId && !polling) {
        GLib.source_remove(pollId);
        pollId = 0;
    }
}

export function whenQuickSettingsReady(onReady) {
    return whenReady(() => {
        const qs = Main.panel.statusArea.quickSettings;
        return qs?._backgroundApps ? qs : null;
    }, onReady, 'Quick Settings items');
}
