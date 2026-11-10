// Thin async wrapper around the `ddcutil` command line tool, used to control the
// brightness of external monitors over DDC/CI.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

// VCP feature code 0x10 is brightness.
const BRIGHTNESS = '10';

// We address monitors by bus number, so the slow display re-detection can be skipped.
const KNOWN_DISPLAY = ['--skip-ddc-checks'];

// Runs ddcutil and resolves with its stdout. Cancelling kills the process.
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

export function haveDdcutil() {
    return GLib.find_program_in_path('ddcutil') !== null;
}

// Lists DDC-capable monitors as {bus, name, connector}, parsed from the terse
// output. The connector (e.g. DP-1) is how they are matched to shell monitors.
export async function detect(cancellable = null) {
    const out = await ddcutil(['detect', '--terse'], cancellable);
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

// Resolves with {current, max}. Brief output looks like "VCP 10 C <current> <max>".
export async function getBrightness(bus, cancellable = null) {
    const out = await ddcutil(['getvcp', BRIGHTNESS, '--brief', '--bus', `${bus}`,
        ...KNOWN_DISPLAY], cancellable);
    const m = out.match(/VCP\s+10\s+C\s+(\d+)\s+(\d+)/);
    if (!m)
        throw new Error(`unexpected ddcutil output: ${out.trim()}`);
    return {current: Number(m[1]), max: Number(m[2])};
}

// --noverify skips the read-back, which makes dragging the slider much smoother.
export async function setBrightness(bus, value, cancellable = null) {
    await ddcutil(['setvcp', BRIGHTNESS, `${value}`, '--bus', `${bus}`, '--noverify',
        ...KNOWN_DISPLAY], cancellable);
}
