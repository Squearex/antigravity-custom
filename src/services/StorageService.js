/**
 * SX Core SDK - StorageService
 * Safe storage abstraction that prevents feedback loops and integrates with native dictionaries.
 */
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

        Storage.prototype.getItem = function(key) {
            const val = self._origGetItem.apply(this, arguments);
            if ((key === 'theme-preset-dark' || key === 'theme-preset-light') && val) {
                self.bus.emit('storage:get-theme', { key, val });
            }
            return val;
        };

        Storage.prototype.setItem = function(key, val) {
            const res = self._origSetItem.apply(this, arguments);
            if (key === 'theme-preset-dark' && !self._inSetItem) {
                self._inSetItem = true;
                try {
                    self.bus.emit('storage:theme-preset-changed', { key, val });
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
