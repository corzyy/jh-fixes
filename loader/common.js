// Shared by the loader's extension.js and prefs.js.
//
// GJS caches ES modules by URL for the life of the process, so GNOME Shell
// can't load changed code from the same file again: normally a new version
// needs a new login. The loader gets around that. `make install` copies the
// real code into builds/<id>/ (a path never used before) and writes <id> into
// the file "current-build". Disabling and enabling the extension then imports
// that new path, so the new code runs right away.
//
// The loader files themselves are cached like any module. Changing them still
// needs a new login, but they should rarely change.

import GLib from 'gi://GLib';

/**
 * Imports a file of the current build.
 *
 * @param {string} extensionPath - the installed extension's directory
 * @param {string} file - e.g. 'extension.js'
 * @returns {Promise<object>} the module
 */
export async function importFromCurrentBuild(extensionPath, file) {
    const [, bytes] = GLib.file_get_contents(
        GLib.build_filenamev([extensionPath, 'current-build']));
    const id = new TextDecoder().decode(bytes).trim();
    if (!/^[\w.-]+$/.test(id))
        throw new Error(`jh-fixes: bad build id "${id}"`);

    const path = GLib.build_filenamev([extensionPath, 'builds', id, file]);
    return import(GLib.filename_to_uri(path, null));
}
