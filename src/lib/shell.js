// Helpers for finding and changing shell actors.

import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/**
 * Walks the actor tree below root and yields every actor of the given class.
 *
 * @param {Clutter.Actor} root - where to start
 * @param {Function} type - the class to look for
 * @yields {Clutter.Actor}
 */
export function* actorsOfType(root, type) {
    for (const child of root.get_children()) {
        if (child instanceof type)
            yield child;
        yield* actorsOfType(child, type);
    }
}

/**
 * Shows or hides an actor. A hidden actor also gets a height of 0, because
 * the overview layout asks for preferred sizes without checking visibility
 * and would otherwise leave an empty gap.
 *
 * @param {Clutter.Actor} actor - the actor
 * @param {boolean} visible - whether it should be shown
 */
export function setShownInLayout(actor, visible) {
    actor.height = visible ? -1 : 0;
    actor.visible = visible;
}

/**
 * Calls onReady(value) once getter() returns something truthy, checking now
 * and then every POLL_INTERVAL ms. Gives up with a warning after maxTries. Used
 * for shell objects that are created asynchronously, such as the Quick
 * Settings items at login.
 *
 * @param {() => any} getter - returns the object, or null while not ready
 * @param {(value: any) => void} onReady - called once with the object
 * @param {string} what - name for the warning when giving up
 * @param {object} [params] - maxTries (checks, POLL_INTERVAL ms apart)
 * @returns {() => void} cancels the wait
 */
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

// All waits share one timer, so at login the features waiting for Quick
// Settings wake the shell once per interval instead of once each.
const POLL_INTERVAL = 200;   // ms
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
        if (!waiters.has(waiter))   // cancelled by an earlier onReady()
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
    // While polling, poll() itself stops the timer when done.
    if (waiters.size === 0 && pollId && !polling) {
        GLib.source_remove(pollId);
        pollId = 0;
    }
}

/**
 * Calls onReady(quickSettings) once all Quick Settings items exist. They are
 * created in an async function after the panel; the background apps item is
 * added last, so its presence means the rest are there.
 *
 * @param {(qs: object) => void} onReady - called once with the QuickSettings
 * @returns {() => void} cancels the wait
 */
export function whenQuickSettingsReady(onReady) {
    return whenReady(() => {
        const qs = Main.panel.statusArea.quickSettings;
        return qs?._backgroundApps ? qs : null;
    }, onReady, 'Quick Settings items');
}
