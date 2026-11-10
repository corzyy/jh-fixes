import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

const BRIGHTNESS = '10';

const KNOWN_DISPLAY = ['--skip-ddc-checks'];

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

export async function getBrightness(bus, cancellable = null) {
    const out = await ddcutil(['getvcp', BRIGHTNESS, '--brief', '--bus', `${bus}`,
        ...KNOWN_DISPLAY], cancellable);
    const m = out.match(/VCP\s+10\s+C\s+(\d+)\s+(\d+)/);
    if (!m)
        throw new Error(`unexpected ddcutil output: ${out.trim()}`);
    return {current: Number(m[1]), max: Number(m[2])};
}

export async function setBrightness(bus, value, cancellable = null) {
    await ddcutil(['setvcp', BRIGHTNESS, `${value}`, '--bus', `${bus}`, '--noverify',
        ...KNOWN_DISPLAY], cancellable);
}
