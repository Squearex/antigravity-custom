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

    async setActiveModel(modelId, convKey, meta = null) {
        try {
            const body = { modelId, convKey };
            if (meta && (meta.providerId || meta.modelId)) body.meta = meta;
            return await this.post('/set-active-model', body);
        } catch(e) {
            this.logger.warn('NetworkClient', 'Failed to notify active model', e.message);
        }
    }

    async fetchConvModels() {
        try {
            const res = await this.get('/get-conv-models');
            return (res && res.ok) ? res : null;
        } catch(e) {
            return null;
        }
    }

    async saveTheme(theme) {
        try {
            return await this.post('/save-theme', theme);
        } catch(e) {
            this.logger.warn('NetworkClient', 'Failed to save theme to proxy', e.message);
        }
    }

    async fetchContextDetails(convId, modelId = '') {
        try {
            const query = `?convId=${encodeURIComponent(convId || '')}${modelId ? `&modelId=${encodeURIComponent(modelId)}` : ''}`;
            return await this.get(`/get-chat-context-details${query}`);
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

    proxyFetch(targetUrl, method = 'GET', headers = {}, body) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${this.baseUrl}/proxy-fetch`, true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.timeout = 15000;
            xhr.onload = () => {
                const status = xhr.status;
                const responseText = xhr.responseText;
                resolve({
                    ok: status >= 200 && status < 300,
                    status,
                    text: () => Promise.resolve(responseText),
                    json: () => {
                        try { return Promise.resolve(JSON.parse(responseText)); }
                        catch(e) { return Promise.reject(e); }
                    }
                });
            };
            xhr.onerror = () => reject(new Error('Network error reaching sxProxy'));
            xhr.ontimeout = () => reject(new Error('Timeout reaching sxProxy'));
            xhr.send(JSON.stringify({ url: targetUrl, method, headers, body }));
        });
    }

    async fetchModels(baseUrl, apiKey, protocol, modelsPath) {
        const proto = (protocol || 'openai').toLowerCase();
        const normalBase = (baseUrl || '').replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '');
        let url, headers;
        if (proto === 'anthropic') {
            url = (normalBase || 'https://api.anthropic.com') + (modelsPath || '/v1/models');
            headers = { 'x-api-key': apiKey || '', 'anthropic-version': '2023-06-01' };
        } else {
            url = (normalBase || 'https://api.openai.com/v1') + (modelsPath || '/models');
            headers = { 'Authorization': 'Bearer ' + (apiKey || '') };
        }
        const resp = await this.proxyFetch(url, 'GET', headers);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        const list = data.data || data.models || (Array.isArray(data) ? data : []);
        return list
            .map(m => (m && typeof m === 'object') ? this._normalizeModelMeta(m) : null)
            .filter(m => m && m.id);
    }

    _normalizeModelMeta(m) {
        const id = m.id || m.name || '';
        const name = m.display_name || m.name || m.id || '';
        const contextLength = this._extractContextLength(m);
        const supportsImages = this._extractVision(m);
        const supportsTools = this._extractTools(m);
        const out = { id, name };
        if (contextLength) out.contextLength = contextLength;
        if (typeof supportsImages === 'boolean') out.supportsImages = supportsImages;
        if (typeof supportsTools === 'boolean') out.supportsTools = supportsTools;
        return out;
    }

    _extractContextLength(m) {
        const candidates = [
            m.context_length, m.contextLength, m.context_window, m.contextWindow,
            m.max_context_length, m.maxContextLength, m.max_context_tokens, m.maxContextTokens,
            m.context_length_tokens, m.max_tokens, m.maxTokens,
            m.topics?.context_length, m.limits?.context_length, m.info?.context_length
        ];
        for (const c of candidates) {
            const n = Number(c);
            if (Number.isFinite(n) && n >= 1000) return Math.round(n);
        }
        const arch = m.architecture || m.model_info || m.info || {};
        for (const c of [arch.context_length, arch.context_window, arch.max_context_length]) {
            const n = Number(c);
            if (Number.isFinite(n) && n >= 1000) return Math.round(n);
        }
        // Anthropic-style: top-level window
        const win = m.window || m.input?.context_window;
        if (win && typeof win === 'object') {
            const n = Number(win.max || win.context_length);
            if (Number.isFinite(n) && n >= 1000) return Math.round(n);
        }
        return 0;
    }

    _extractVision(m) {
        if (typeof m.supports_images === 'boolean') return m.supports_images;
        if (typeof m.supports_vision === 'boolean') return m.supports_vision;
        if (typeof m.supportsImages === 'boolean') return m.supportsImages;
        if (typeof m.vision === 'boolean') return m.vision;
        const modality = String(m.modality || m.architecture?.modality || m.architecture?.input_modalities || '').toLowerCase();
        if (modality) {
            if (modality.includes('image') || modality.includes('vision') || modality.includes('multimodal')) return true;
            if (modality.includes('text') && !modality.includes('image')) return false;
        }
        const inputMods = m.input_modalities || m.modalities?.input || m.architecture?.input_modalities;
        if (Array.isArray(inputMods)) {
            const s = inputMods.map(String).join(',').toLowerCase();
            if (s.includes('image') || s.includes('vision')) return true;
            if (s.includes('text')) return false;
        }
        const caps = m.capabilities || m.features || m.supported_modalities;
        if (Array.isArray(caps)) {
            const s = caps.map(String).join(',').toLowerCase();
            if (s.includes('image') || s.includes('vision') || s.includes('multimodal')) return true;
        }
        return undefined;
    }

    _extractTools(m) {
        if (typeof m.supports_tools === 'boolean') return m.supports_tools;
        if (typeof m.supportsTools === 'boolean') return m.supportsTools;
        if (typeof m.tools === 'boolean') return m.tools;
        const params = m.supported_parameters || m.supported_features || m.features;
        if (Array.isArray(params)) {
            const s = params.map(String).join(',').toLowerCase();
            if (s.includes('tool') || s.includes('function')) return true;
            if (s.length) return false;
        }
        const caps = m.capabilities;
        if (Array.isArray(caps)) {
            const s = caps.map(String).join(',').toLowerCase();
            if (s.includes('tool') || s.includes('function')) return true;
        }
        return undefined;
    }
}
