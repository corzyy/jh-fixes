// Shared by the two loaders: resolves the active build directory.
//
// GNOME Shell caches ES modules for the life of the session, so a changed extension
// cannot be reloaded in place. Instead the install root only holds thin loaders that
// import the real code from builds/<id>/, where <id> is named by `current-build`.
// Each install creates a new id, so a disable/enable cycle loads fresh code.
import GLib from 'gi://GLib';

// Dynamically imports `file` from the build selected by `current-build`.
export async function importFromCurrentBuild(extensionPath, file) {
    const [, bytes] = GLib.file_get_contents(
        GLib.build_filenamev([extensionPath, 'current-build']));
    const id = new TextDecoder().decode(bytes).trim();
    // The id ends up in a file path; refuse anything that could escape builds/.
    if (!/^[\w.-]+$/.test(id))
        throw new Error(`jh-fixes: bad build id "${id}"`);

    const path = GLib.build_filenamev([extensionPath, 'builds', id, file]);
    return import(GLib.filename_to_uri(path, null));
}
