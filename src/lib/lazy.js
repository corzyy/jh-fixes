// Wraps a feature so its module is only imported (and the feature only created)
// while the boolean setting `key` is on. `load` resolves to the feature class.
// The wrapper exposes the same enable()/disable() interface as a real feature.
export function lazyFeature(key, load) {
    class LazyFeature {
        constructor(settings, extension) {
            this._settings = settings;
            this._extension = extension;
            this._feature = null;
            this._loading = null;
        }

        enable() {
            this._settings.connectObject(`changed::${key}`, () => this._sync(), this);
            this._sync();
        }

        disable() {
            this._settings.disconnectObject(this);
            this._loading = null;
            this._feature?.disable();
            this._feature = null;
        }

        // Runs on enable and on every change of `key`. Once the feature exists it reacts to
        // settings itself, so the wrapper stops listening.
        async _sync() {
            if (this._feature || this._loading || !this._settings.get_boolean(key))
                return;
            // Guards against disable() running while the import is still in flight.
            const token = (this._loading = Symbol(key));
            let Feature;
            try {
                Feature = await load();
            } catch (e) {
                console.error(`jh-fixes: loading ${key} failed`, e);
            }
            if (this._loading !== token)
                return;
            this._loading = null;
            if (!Feature)
                return;
            this._settings.disconnectObject(this);
            try {
                this._feature = new Feature(this._settings, this._extension);
                this._feature.enable();
            } catch (e) {
                console.error(`jh-fixes: ${Feature.name} failed to enable`, e);
            }
        }
    }
    // Readable name for the "failed to enable" log messages.
    Object.defineProperty(LazyFeature, 'name', {value: `Lazy(${key})`});
    return LazyFeature;
}
