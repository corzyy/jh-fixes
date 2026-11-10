// Update banner at the top of every preferences page.
//
// The extension is installed from a git checkout (see tools/install.sh, which records
// its location and commit in source.json). When the preferences open we check that
// repository's upstream for newer commits and offer to pull and reinstall.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {onChanged} from './ui/build.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

// Changes to these require a new login: the shell caches the loaders and metadata.
const LOGIN_FILES = ['loader', 'src/metadata.json'];

// Runs a command and resolves with its trimmed stdout. On failure the error carries
// the last line of its output. git must never wait for a password prompt.
async function run(argv) {
    const launcher = new Gio.SubprocessLauncher({
        flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    });
    launcher.setenv('GIT_TERMINAL_PROMPT', '0', true);
    launcher.setenv('LC_ALL', 'C', true);
    const proc = launcher.spawnv(argv);
    const [stdout, stderr] = await proc.communicate_utf8_async(null, null);
    if (!proc.get_successful()) {
        const message = (stderr || stdout).trim().split('\n').pop();
        throw new Error(message || `${argv.slice(0, 2).join(' ')} failed`);
    }
    return stdout.trim();
}

// Reads source.json; null if missing or malformed (e.g. installed from a zip).
function readSource(extensionPath) {
    try {
        const [, bytes] = GLib.file_get_contents(
            GLib.build_filenamev([extensionPath, 'source.json']));
        const source = JSON.parse(new TextDecoder().decode(bytes));
        return source.repo && /^[0-9a-f]{40}$/.test(source.commit) ? source : null;
    } catch {
        return null;
    }
}

// Setting that turns the update check on or off.
const KEY = 'update-banner';

// Adds a banner to each page (they are separate widgets) and keeps them in sync.
export function addUpdateBanner(pages, {window, path, settings}) {
    const source = readSource(path);
    if (!source)
        return;

    const git = (...args) => run(['git', '-C', source.repo, ...args]);
    const banners = pages.map(page => (page.banner = new Adw.Banner({use_markup: false})));
    let onClick = null;
    banners.forEach(b => b.connect('button-clicked', () => onClick?.()));

    let checked = false;
    // The check runs once, the first time it is enabled while the window is open.
    const sync = () => {
        if (!settings.get_boolean(KEY)) {
            banners.forEach(b => (b.revealed = false));
        } else if (!checked) {
            checked = true;
            check().catch(e => console.log(`jh-fixes: update check failed: ${e.message}`));
        }
    };
    onChanged(settings, KEY, sync, window);

    // Shows the same message on every banner; `click` handles the button.
    const show = (title, buttonLabel = '', click = null) => {
        if (!settings.get_boolean(KEY))
            return;
        onClick = click;
        for (const b of banners) {
            b.title = title;
            b.button_label = buttonLabel;
            b.revealed = true;
        }
    };

    // Fast-forward pull, reinstall, then tell the user what to do next: log out if the
    // loaders or metadata changed, otherwise just reopen the preferences.
    const update = async () => {
        show('Updating jh-fixes…');
        try {
            await git('pull', '--ff-only');
            await run(['make', '-C', source.repo, 'install']);
            const loginFiles = await git('diff', '--name-only',
                source.commit, 'HEAD', '--', ...LOGIN_FILES);
            show(loginFiles
                ? 'Updated. Log out and back in to finish the update'
                : 'Updated. Reopen the preferences to see the new version',
            'Close', () => window.close());
        } catch (e) {
            show(`Update failed: ${e.message}`, 'Try Again', update);
        }
    };

    // Compares the installed commit with the upstream branch.
    const check = async () => {
        await git('fetch', '--quiet');
        const count = Number(await git('rev-list', '--count', `${source.commit}..@{upstream}`));
        if (count > 0) {
            show(`A newer version of jh-fixes is on GitHub (${count} new commit${count === 1 ? '' : 's'})`,
                'Update', update);
        }
    };
    sync();
}
