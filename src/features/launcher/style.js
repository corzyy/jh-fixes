// Loads launcher.css into the shell theme while the launcher exists and removes it again.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

// Resolved relative to this module so it works from any build directory.
const FILE = Gio.File.new_for_uri(
    GLib.uri_resolve_relative(import.meta.url, 'launcher.css', GLib.UriFlags.NONE));
const theme = () => St.ThemeContext.get_for_stage(global.stage).get_theme();

export class LauncherStyle {
    load() {
        if (this._loaded)
            return;
        theme().load_stylesheet(FILE);
        this._loaded = true;
    }

    unload() {
        if (!this._loaded)
            return;
        this._loaded = false;
        try {
            theme().unload_stylesheet(FILE);
        } catch {}
    }
}
