// The "update available" banner at the top of every preferences page.
//
// `make install` writes source.json next to the loader: the git clone it was
// installed from and the commit. When the preferences open, this fetches
// that clone's upstream branch (GitHub) and, if it has commits the installed
// build doesn't, shows a banner whose button pulls them and runs
// `make install`, which reloads the running extension. Installs that did not
// come from a git clone (no source.json) never show it.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

// Files that the running shell only reads at login (see loader/common.js).
const LOGIN_FILES = ['loader', 'src/metadata.json'];

/**
 * Runs a command and returns its stdout. Throws with its stderr on failure.
 *
 * @param {string[]} argv - the command
 * @returns {Promise<string>}
 */
async function run(argv) {
    const launcher = new Gio.SubprocessLauncher({
        flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    });
    // Never wait for a password prompt nobody can see, and keep git's
    // messages in English for the banner.
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

function readSource(extensionPath) {
    try {
        const [, bytes] = GLib.file_get_contents(
            GLib.build_filenamev([extensionPath, 'source.json']));
        const source = JSON.parse(new TextDecoder().decode(bytes));
        if (source.repo && /^[0-9a-f]{40}$/.test(source.commit))
            return source;
    } catch {
        // Not installed from a git clone.
    }
    return null;
}

/**
 * Adds the update banner to the pages and starts the check.
 *
 * @param {Adw.PreferencesPage[]} pages - the window's pages
 * @param {object} ctx - {window, path}
 */
export function addUpdateBanner(pages, {window, path}) {
    const source = readSource(path);
    if (!source)
        return;

    const git = (...args) => run(['git', '-C', source.repo, ...args]);
    const banners = pages.map(page => (page.banner = new Adw.Banner({use_markup: false})));
    let onClick = null;
    banners.forEach(b => b.connect('button-clicked', () => onClick?.()));

    // Every page shows the same banner.
    const show = (title, buttonLabel = '', click = null) => {
        onClick = click;
        for (const b of banners) {
            b.title = title;
            b.button_label = buttonLabel;
            b.revealed = true;
        }
    };

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

    const check = async () => {
        await git('fetch', '--quiet');
        const count = Number(await git('rev-list', '--count', `${source.commit}..@{upstream}`));
        if (count > 0) {
            show(`A newer version of jh-fixes is on GitHub (${count} new commit${count === 1 ? '' : 's'})`,
                'Update', update);
        }
    };
    // Offline or GitHub unreachable: no banner, nothing to do.
    check().catch(e => console.log(`jh-fixes: update check failed: ${e.message}`));
}
