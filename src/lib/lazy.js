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

        async _sync() {
            if (this._feature || this._loading || !this._settings.get_boolean(key))
                return;
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
    Object.defineProperty(LazyFeature, 'name', {value: `Lazy(${key})`});
    return LazyFeature;
}
