import GLib from 'gi://GLib';

export async function importFromCurrentBuild(extensionPath, file) {
    const [, bytes] = GLib.file_get_contents(
        GLib.build_filenamev([extensionPath, 'current-build']));
    const id = new TextDecoder().decode(bytes).trim();
    if (!/^[\w.-]+$/.test(id))
        throw new Error(`jh-fixes: bad build id "${id}"`);

    const path = GLib.build_filenamev([extensionPath, 'builds', id, file]);
    return import(GLib.filename_to_uri(path, null));
}
