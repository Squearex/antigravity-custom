/**
 * SX Core SDK - NetworkClient
 * Manages HTTP communication with the local SX proxy service (127.0.0.1:15725).
 */
export class NetworkClient {
    constructor(logger, baseUrl = 'http://127.0.0.1:15725/sx') {
        this.logger = logger;
        this.baseUrl = baseUrl;
    }

    async get(path) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', `${this.baseUrl}${path}`, true);
            xhr.timeout = 10000;
            xhr.onload = () => {
                try {
                    resolve(JSON.parse(xhr.responseText));
                } catch(e) {
                    resolve(null);
                }
            };
            xhr.onerror = () => reject(new Error(`Network error requesting ${path}`));
            xhr.ontimeout = () => reject(new Error(`Timeout requesting ${path}`));
            xhr.send();
        });
    }

    async post(path, data) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${this.baseUrl}${path}`, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 15000;
            xhr.onload = () => {
                try {
                    resolve(JSON.parse(xhr.responseText));
                } catch(e) {
                    resolve({ ok: xhr.status >= 200 && xhr.status < 300 });
                }
            };
            xhr.onerror = () => reject(new Error(`Network error requesting ${path}`));
            xhr.ontimeout = () => reject(new Error(`Timeout requesting ${path}`));
            xhr.send(JSON.stringify(data));
        });
    }

    async fetchPersistedConfig() {
        try {
            return await this.get('/get-config');
        } catch(e) {
            this.logger.warn('NetworkClient', 'Failed to fetch persisted config', e.message);
            return null;
        }
    }

    async syncConfig(providers, models, forceClear = false) {
        try {
            if (!forceClear && !providers.length && !models.length) return;
            return await this.post('/update-config', { providers, models, forceClear });
        } catch(e) {
            this.logger.warn('NetworkClient', 'Failed to sync config to proxy', e.message);
        }
    }

    async setActiveModel(modelId, convKey) {
        try {
            return await this.post('/set-active-model', { modelId, convKey });
        } catch(e) {
            this.logger.warn('NetworkClient', 'Failed to notify active model', e.message);
        }
    }

    async saveTheme(theme) {
        try {
            return await this.post('/save-theme', theme);
        } catch(e) {
            this.logger.warn('NetworkClient', 'Failed to save theme to proxy', e.message);
        }
    }

    async fetchContextDetails(convId) {
        try {
            return await this.get(`/get-chat-context-details?convId=${encodeURIComponent(convId)}`);
        } catch(e) {
            return null;
        }
    }

    async fetchPerfStats(convId) {
        try {
            const res = await this.get(`/get-chat-perf-stats?convId=${encodeURIComponent(convId)}`);
            return res?.stats || res || null;
        } catch(e) {
            return null;
        }
    }
}
