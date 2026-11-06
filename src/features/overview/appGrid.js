// The app grid's page size (ui/appDisplay.js AppDisplay, ui/iconGrid.js
// IconGrid and IconGridLayout).
//
// Page size: IconGrid picks one of its grid modes (8×3, 6×4, 4×6, 3×8, all
// 24 apps) by the page's aspect ratio in _findBestModeForSize(), called on
// every allocation. That method is replaced on the app grid's instance, so
// app folders keep their own 3×3 pages. With only columns (or only rows)
// set, the other count follows the page's shape, as GNOME's modes do.
//
// GNOME places apps by the layout saved in app-picker-layout (once you have
// dragged one; until then all are just appended) and only ever with 24 per
// page, so a page size change moves nothing by itself. So whenever it
// changes, the apps are laid out again in their order (_repack), and apps
// with a saved place keep getting one that follows that order
// (AppDisplay._getItemPosition, mapped through the linear order). The saved
// layout is only rewritten when you drag an app, as usual.

import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const COLUMNS_KEY = 'app-grid-columns';
const ROWS_KEY = 'app-grid-rows';

export class AppGridLayout {
    constructor(settings) {
        this._settings = settings;
        this._appDisplay = null;
        this._laterId = 0;
        // The settings, read once per change: the overrides below run on
        // every allocation of the grid.
        this._columns = 0;
        this._rows = 0;
    }

    enable() {
        const appDisplay = Main.overview._overview?.controls?.appDisplay;
        if (!appDisplay?._grid?.layout_manager)
            throw new Error('App grid not found');
        this._appDisplay = appDisplay;
        const grid = appDisplay._grid;
        const self = this;

        // Own properties on the instances, removed again in disable().
        const findMode = Object.getPrototypeOf(grid)._findBestModeForSize;
        grid._findBestModeForSize = function (width, height) {
            const size = self._pageSize(this, width, height);
            if (!size) {
                findMode.call(this, width, height);
                return;
            }
            // -1 makes the stock code apply its mode again later on.
            this._currentMode = -1;
            if (this.layout_manager.columns_per_page === size.columns &&
                this.layout_manager.rows_per_page === size.rows)
                return;
            this.layout_manager.columns_per_page = size.columns;
            this.layout_manager.rows_per_page = size.rows;
            // Called from allocation; move the apps once that is done.
            self._queueReflow();
        };

        const getPosition = Object.getPrototypeOf(appDisplay)._getItemPosition;
        appDisplay._getItemPosition = function (item) {
            const [page, position] = getPosition.call(this, item);
            if (page < 0 || item === this._placeholder || !self._isCustom())
                return [page, position];
            // Saved page and position -> place in the saved order -> the
            // page and position for this page size.
            const pages = this._pageManager.pages;
            let index = position;
            for (let i = 0; i < page && i < pages.length; i++)
                index += Object.keys(pages[i]).length;
            const perPage = this._grid.itemsPerPage;
            return [Math.floor(index / perPage), index % perPage];
        };

        this._settings.connectObject(
            `changed::${COLUMNS_KEY}`, () => this._apply(),
            `changed::${ROWS_KEY}`, () => this._apply(),
            this);
        this._apply();
    }

    disable() {
        this._settings.disconnectObject(this);
        if (this._laterId)
            global.compositor.get_laters().remove(this._laterId);
        this._laterId = 0;

        const appDisplay = this._appDisplay;
        if (!appDisplay)
            return;
        this._appDisplay = null;
        const grid = appDisplay._grid;
        delete grid._findBestModeForSize;
        delete appDisplay._getItemPosition;

        grid._currentMode = -1;
        this._relayout(grid);
        if (this._isCustom()) {
            // Back to GNOME's 24 apps per page right away, and the apps
            // with them.
            const [width, height] = grid.get_allocation_box().get_size();
            if (width > 0 && height > 0)
                grid._findBestModeForSize(width, height);
            this._reflow(appDisplay);
        }
    }

    _isCustom() {
        return this._columns > 0 || this._rows > 0;
    }

    // The columns and rows to use, or null for GNOME's own choice.
    _pageSize(grid, width, height) {
        let {_columns: columns, _rows: rows} = this;
        if (!columns && !rows)
            return null;
        if (!columns || !rows) {
            const {pagePadding} = grid.layout_manager;
            const ratio = (width - pagePadding.left - pagePadding.right) /
                Math.max(1, height - pagePadding.top - pagePadding.bottom);
            if (!columns)
                columns = Math.max(1, Math.round(rows * ratio));
            else
                rows = Math.max(1, Math.round(columns / ratio));
        }
        return {columns, rows};
    }

    _apply() {
        this._columns = this._settings.get_int(COLUMNS_KEY);
        this._rows = this._settings.get_int(ROWS_KEY);
        const grid = this._appDisplay._grid;
        const [width, height] = grid.get_allocation_box().get_size();
        // Right away rather than at the next allocation, so the reflow
        // below already sees the new page size.
        if (width > 0 && height > 0)
            grid._findBestModeForSize(width, height);
        this._relayout(grid);
        this._queueReflow();
    }

    // Icon sizes are only worked out again when the page size changes.
    _relayout(grid) {
        grid.layout_manager._pageWidth = -1;
        grid.queue_relayout();
    }

    _queueReflow() {
        if (this._laterId)
            return;
        this._laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._laterId = 0;
            if (this._appDisplay)
                this._reflow(this._appDisplay);
            return false;
        });
    }

    // Puts every app at its place in the current order for the current page
    // size, then lets GNOME move the ones with a saved place there. Moving
    // them in order keeps every earlier page full, so each target page
    // exists (the grid adds and drops pages as needed).
    _reflow(appDisplay) {
        const perPage = appDisplay._grid.itemsPerPage;
        appDisplay._orderedItems.slice().forEach((item, i) => {
            const page = Math.floor(i / perPage), position = i % perPage;
            const [oldPage, oldPosition] = appDisplay._grid.getItemPosition(item);
            if (oldPage !== page || oldPosition !== position)
                appDisplay._moveItem(item, page, position);
        });
        appDisplay._redisplay();
    }
}
