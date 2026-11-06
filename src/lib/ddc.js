// Small async wrapper around the ddcutil command line tool, which talks to
// external monitors over DDC/CI (I2C through the display cable).
//
// Each call runs one ddcutil process. Monitors are addressed by I2C bus
// number, which `ddcutil detect` reports and which is much faster than
// letting ddcutil search for the display on every call.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

const BRIGHTNESS = '10';   // MCCS VCP feature code for luminance

// The bus comes from a detection that already talked to the monitor, so the
// check ddcutil makes before each command is redundant; skipping it roughly
// halves the time of every read and write (an I2C round trip less).
const KNOWN_DISPLAY = ['--skip-ddc-checks'];

/**
 * Runs ddcutil and returns its stdout. Throws with stderr on failure.
 *
 * @param {string[]} args - arguments after "ddcutil"
 * @param {Gio.Cancellable} [cancellable] - kills the process when cancelled
 * @returns {Promise<string>}
 */
async function ddcutil(args, cancellable = null) {
    const proc = Gio.Subprocess.new(['ddcutil', ...args],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    const id = cancellable?.connect(() => proc.force_exit()) ?? 0;
    try {
        const [stdout, stderr] = await proc.communicate_utf8_async(null, null);
        if (!proc.get_successful())
            throw new Error(`ddcutil ${args.join(' ')}: ${(stderr || stdout).trim()}`);
        return stdout;
    } finally {
        if (id)
            cancellable.disconnect(id);
    }
}

/** @returns {boolean} whether ddcutil is installed */
export function haveDdcutil() {
    return GLib.find_program_in_path('ddcutil') !== null;
}

/**
 * Finds the monitors that answer DDC/CI.
 *
 * @param {Gio.Cancellable} [cancellable] - to stop early
 * @returns {Promise<{bus: number, name: string, connector: string}[]>}
 */
export async function detect(cancellable = null) {
    const out = await ddcutil(['detect', '--terse'], cancellable);
    // Blocks start with "Display N" (usable) or "Invalid display" (not);
    // only the usable ones are kept.
    const displays = [];
    let current = null;
    for (const line of out.split('\n')) {
        if (/^Display \d+/.test(line)) {
            current = {bus: -1, name: '', connector: ''};
            displays.push(current);
        } else if (/^\S/.test(line)) {
            current = null;
        } else if (current) {
            const bus = line.match(/I2C bus:\s*\/dev\/i2c-(\d+)/);
            if (bus)
                current.bus = Number(bus[1]);
            const connector = line.match(/DRM connector:\s*(?:card\d+-)?(\S+)/);
            if (connector)
                current.connector = connector[1];
            const monitor = line.match(/Monitor:\s*(.*)/);
            if (monitor)
                current.name = monitor[1].trim();
        }
    }
    return displays.filter(d => d.bus >= 0);
}

/**
 * @param {number} bus - I2C bus number
 * @param {Gio.Cancellable} [cancellable] - to stop early
 * @returns {Promise<{current: number, max: number}>}
 */
export async function getBrightness(bus, cancellable = null) {
    const out = await ddcutil(['getvcp', BRIGHTNESS, '--brief', '--bus', `${bus}`,
        ...KNOWN_DISPLAY], cancellable);
    // "VCP 10 C 50 100": continuous feature, current value, maximum
    const m = out.match(/VCP\s+10\s+C\s+(\d+)\s+(\d+)/);
    if (!m)
        throw new Error(`unexpected ddcutil output: ${out.trim()}`);
    return {current: Number(m[1]), max: Number(m[2])};
}

/**
 * @param {number} bus - I2C bus number
 * @param {number} value - raw value, 0..max
 * @param {Gio.Cancellable} [cancellable] - to stop early
 * @returns {Promise<void>}
 */
export async function setBrightness(bus, value, cancellable = null) {
    // --noverify skips reading the value back, which halves the time.
    await ddcutil(['setvcp', BRIGHTNESS, `${value}`, '--bus', `${bus}`, '--noverify',
        ...KNOWN_DISPLAY], cancellable);
}
