/**
 * SX Core SDK - Container
 * Lightweight dependency container for managing registered services and singletons.
 */
export class Container {
    constructor() {
        this._services = new Map();
    }

    /**
     * Register a service instance by name
     * @param {string} name
     * @param {Object} serviceInstance
     */
    register(name, serviceInstance) {
        if (this._services.has(name)) {
            console.warn(`[SX Container] Service "${name}" already registered, replacing.`);
        }
        this._services.set(name, serviceInstance);
        return serviceInstance;
    }

    /**
     * Retrieve a registered service instance
     * @param {string} name
     * @returns {Object|undefined}
     */
    get(name) {
        return this._services.get(name);
    }

    /**
     * Check if a service is registered
     * @param {string} name
     * @returns {boolean}
     */
    has(name) {
        return this._services.has(name);
    }
}
