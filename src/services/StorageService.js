/**
 * SX Core SDK - StorageService
 * Safe storage abstraction that prevents feedback loops and integrates with native dictionaries.
 */
export const NATIVE_DARK_THEMES = new Set([
    "Default Dark", "Catppuccin", "Dracula", "Monokai", "One Dark Pro", "Tokyo Night", "Solarized Dark", "Vesper"
]);

export const NATIVE_LIGHT_THEMES = new Set([
    "Default Light", "Catppuccin", "One Light", "Solarized Light"
]);

export class StorageService {
    constructor(eventBus, logger) {
        this.bus = eventBus;
        this.logger = logger;
        this._origGetItem = Storage.prototype.getItem;
        this._origSetItem = Storage.prototype.setItem;
        this._inSetItem = false;
    }

    init() {
        const self = this;

        // Clean any corrupted theme preset right away so Settings dialog never crashes
        try {
            const curDark = this._origGetItem.call(localStorage, 'theme-preset-dark');
            if (curDark && !NATIVE_DARK_THEMES.has(curDark)) {
                this._origSetItem.call(localStorage, 'theme-preset-dark', 'Default Dark');
            }
            const curLight = this._origGetItem.call(localStorage, 'theme-preset-light');
            if (curLight && !NATIVE_LIGHT_THEMES.has(curLight)) {
                this._origSetItem.call(localStorage, 'theme-preset-light', 'Default Light');
            }
        } catch(e) {}

        Storage.prototype.getItem = function(key) {
            let val = self._origGetItem.apply(this, arguments);

            // Guard: native Antigravity Settings UI expects jbc[mode][val].
            // If val is not in the native dictionary, jbc[mode][val] is undefined,
            // throwing "Cannot read properties of undefined (reading 'background')" and crashing the window!
            if (key === 'theme-preset-dark') {
                if (!val || !NATIVE_DARK_THEMES.has(val)) {
                    val = 'Default Dark';
                }
            } else if (key === 'theme-preset-light') {
                if (!val || !NATIVE_LIGHT_THEMES.has(val)) {
                    val = 'Default Light';
                }
            }

            if ((key === 'theme-preset-dark' || key === 'theme-preset-light') && val) {
                self.bus.emit('storage:get-theme', { key, val });
            }
            return val;
        };

        Storage.prototype.setItem = function(key, val) {
            // Guard: if setting theme-preset-dark to a custom SX theme, keep native safe
            if (key === 'theme-preset-dark' && val && !NATIVE_DARK_THEMES.has(val)) {
                self._origSetItem.call(this, 'sx_active_theme_preset', val);
                val = 'Default Dark';
            } else if (key === 'theme-preset-light' && val && !NATIVE_LIGHT_THEMES.has(val)) {
                self._origSetItem.call(this, 'sx_active_theme_preset_light', val);
                val = 'Default Light';
            }

            const res = self._origSetItem.call(this, key, val);
            if (!self._inSetItem) {
                self._inSetItem = true;
                try {
                    if (key === 'theme-preset-dark') {
                        self.bus.emit('storage:theme-preset-changed', { key, val });
                    } else if (key === 'theme' || key === 'theme-mode') {
                        self.bus.emit('storage:theme-mode-changed', { key, val });
                    } else if (key === 'theme-preset-light') {
                        self.bus.emit('storage:theme-preset-light-changed', { key, val });
                    }
                } finally {
                    self._inSetItem = false;
                }
            }
            return res;
        };

        this.logger.info('StorageService', 'Storage hooks initialized safely.');
    }

    silentSetItem(key, val) {
        return this._origSetItem.call(localStorage, key, val);
    }

    silentGetItem(key) {
        return this._origGetItem.call(localStorage, key);
    }
}
