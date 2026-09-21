/**
 * SX Core SDK - Logger
 * Structured, clean logging with log levels and module tagging.
 */
export class Logger {
    constructor(prefix = 'SX') {
        this.prefix = prefix;
        this.debugEnabled = true;
    }

    info(module, message, ...args) {
        console.log(`%c[${this.prefix}:${module}]`, 'color: #38bdf8; font-weight: bold;', message, ...args);
    }

    warn(module, message, ...args) {
        console.warn(`%c[${this.prefix}:${module}]`, 'color: #fbbf24; font-weight: bold;', message, ...args);
    }

    error(module, message, ...args) {
        console.error(`%c[${this.prefix}:${module}]`, 'color: #f43f5e; font-weight: bold;', message, ...args);
    }

    debug(module, message, ...args) {
        if (!this.debugEnabled) return;
        console.debug(`%c[${this.prefix}:${module}]`, 'color: #94a3b8; font-style: italic;', message, ...args);
    }
}
