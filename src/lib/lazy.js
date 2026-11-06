// Defers loading a feature that is off by default until it is first turned
// on, so a session that never uses it never parses or keeps its code.

/**
 * Wraps a feature whose boolean setting `key` is off by default. While the
 * key is off nothing is imported; the first time it is on, load() imports
 * the feature, which from then on watches its key itself.
 *
 * @param {string} key - the feature's on/off settings key
 * @param {() => Promise<Function>} load - imports and returns the class
 * @returns {Function} a feature class with enable() and disable()
 */
export function lazyFeature(key, load) {
    class LazyFeature {
        constructor(settings, extension) {
            this._settings = settings;
            this._extension = extension;
            this._feature = null;
            this._loading = null;   // token of the import under way
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
            // disable() may run while the import is pending; it drops the token.
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
