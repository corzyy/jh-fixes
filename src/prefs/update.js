import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

const LOGIN_FILES = ['loader', 'src/metadata.json'];

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

export function addUpdateBanner(pages, {window, path}) {
    const source = readSource(path);
    if (!source)
        return;

    const git = (...args) => run(['git', '-C', source.repo, ...args]);
    const banners = pages.map(page => (page.banner = new Adw.Banner({use_markup: false})));
    let onClick = null;
    banners.forEach(b => b.connect('button-clicked', () => onClick?.()));

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
    check().catch(e => console.log(`jh-fixes: update check failed: ${e.message}`));
}
