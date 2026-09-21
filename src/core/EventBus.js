/**
 * SX Core SDK - EventBus
 * Lightweight, asynchronous Pub/Sub event bus for inter-module communication.
 */
export class EventBus {
    constructor() {
        this._listeners = new Map();
    }

    /**
     * Subscribe to an event
     * @param {string} event
     * @param {Function} handler
     * @returns {Function} unsubscribe function
     */
    on(event, handler) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event).add(handler);
        return () => this.off(event, handler);
    }

    /**
     * Subscribe to an event only once
     * @param {string} event
     * @param {Function} handler
     */
    once(event, handler) {
        const wrapper = (...args) => {
            this.off(event, wrapper);
            handler(...args);
        };
        return this.on(event, wrapper);
    }

    /**
     * Unsubscribe from an event
     * @param {string} event
     * @param {Function} handler
     */
    off(event, handler) {
        const set = this._listeners.get(event);
        if (set) {
            set.delete(handler);
            if (set.size === 0) {
                this._listeners.delete(event);
            }
        }
    }

    /**
     * Emit an event asynchronously to prevent blocking dispatchers
     * @param {string} event
     * @param {*} payload
     */
    emit(event, payload) {
        const set = this._listeners.get(event);
        if (!set || set.size === 0) return;
        const listeners = Array.from(set);
        Promise.resolve().then(() => {
            for (const handler of listeners) {
                try {
                    handler(payload);
                } catch (err) {
                    console.error(`[SX EventBus] Error in handler for event "${event}":`, err);
                }
            }
        });
    }
}
