/**
 * SX Core SDK - ModelMetaResolver
 * Guarantees context/vision/tools metadata for any model ID via layered sources:
 *  1) Provider API payload (already normalized upstream)
 *  2) Built-in knowledge base (bundled offline)
 *  3) OpenRouter public catalog (auth-free, covers most model IDs)
 *  4) Explicit user overrides stored on the model entry
 */

const LOCAL_KB = {
    // OpenAI
    'gpt-4o': { contextLength: 131072, supportsImages: true, supportsTools: true },
    'gpt-4o-mini': { contextLength: 131072, supportsImages: true, supportsTools: true },
    'gpt-4.1': { contextLength: 1047576, supportsImages: true, supportsTools: true },
    'gpt-4.1-mini': { contextLength: 1047576, supportsImages: true, supportsTools: true },
    'gpt-4.1-nano': { contextLength: 1047576, supportsImages: true, supportsTools: true },
    'gpt-4-turbo': { contextLength: 131072, supportsImages: true, supportsTools: true },
    'gpt-4-turbo-preview': { contextLength: 131072, supportsImages: true, supportsTools: true },
    'gpt-4': { contextLength: 8192, supportsImages: false, supportsTools: true },
    'gpt-3.5-turbo': { contextLength: 16385, supportsImages: false, supportsTools: true },
    'gpt-3.5-turbo-16k': { contextLength: 16385, supportsImages: false, supportsTools: true },
    'o1': { contextLength: 200000, supportsImages: true, supportsTools: true },
    'o1-mini': { contextLength: 131072, supportsImages: false, supportsTools: false },
    'o1-preview': { contextLength: 131072, supportsImages: false, supportsTools: false },
    'o3': { contextLength: 200000, supportsImages: true, supportsTools: true },
    'o3-mini': { contextLength: 200000, supportsImages: false, supportsTools: true },
    'o4-mini': { contextLength: 200000, supportsImages: true, supportsTools: true },
    // Anthropic
    'claude-3-7-sonnet': { contextLength: 200000, supportsImages: true, supportsTools: true },
    'claude-3-7-sonnet-latest': { contextLength: 200000, supportsImages: true, supportsTools: true },
    'claude-3-5-sonnet': { contextLength: 200000, supportsImages: true, supportsTools: true },
    'claude-3-5-sonnet-latest': { contextLength: 200000, supportsImages: true, supportsTools: true },
    'claude-3-5-haiku': { contextLength: 200000, supportsImages: true, supportsTools: true },
    'claude-3-opus': { contextLength: 200000, supportsImages: true, supportsTools: true },
    'claude-3-sonnet': { contextLength: 200000, supportsImages: true, supportsTools: true },
    'claude-3-haiku': { contextLength: 200000, supportsImages: true, supportsTools: true },
    'claude-sonnet-4': { contextLength: 200000, supportsImages: true, supportsTools: true },
    'claude-opus-4': { contextLength: 200000, supportsImages: true, supportsTools: true },
    'claude-opus-4-1': { contextLength: 200000, supportsImages: true, supportsTools: true },
    'claude-opus-4-5': { contextLength: 200000, supportsImages: true, supportsTools: true },
    'claude-sonnet-4-5': { contextLength: 200000, supportsImages: true, supportsTools: true },
    'claude-haiku-4-5': { contextLength: 200000, supportsImages: true, supportsTools: true },
    // Google
    'gemini-2.5-pro': { contextLength: 1048576, supportsImages: true, supportsTools: true },
    'gemini-2.5-flash': { contextLength: 1048576, supportsImages: true, supportsTools: true },
    'gemini-2.5-flash-lite': { contextLength: 1048576, supportsImages: true, supportsTools: true },
    'gemini-2.0-flash': { contextLength: 1048576, supportsImages: true, supportsTools: true },
    'gemini-2.0-flash-lite': { contextLength: 1048576, supportsImages: true, supportsTools: true },
    'gemini-1.5-pro': { contextLength: 2097152, supportsImages: true, supportsTools: true },
    'gemini-1.5-flash': { contextLength: 1048576, supportsImages: true, supportsTools: true },
    'gemini-1.5-flash-8b': { contextLength: 1048576, supportsImages: true, supportsTools: true },
    // DeepSeek
    'deepseek-chat': { contextLength: 65536, supportsImages: false, supportsTools: true },
    'deepseek-reasoner': { contextLength: 65536, supportsImages: false, supportsTools: true },
    'deepseek-coder': { contextLength: 131072, supportsImages: false, supportsTools: true },
    // Meta
    'llama-3.3-70b-instruct': { contextLength: 131072, supportsImages: false, supportsTools: true },
    'llama-3.1-405b-instruct': { contextLength: 131072, supportsImages: false, supportsTools: true },
    'llama-3.1-70b-instruct': { contextLength: 131072, supportsImages: false, supportsTools: true },
    'llama-3.1-8b-instruct': { contextLength: 131072, supportsImages: false, supportsTools: true },
    'llama-3.2-11b-vision': { contextLength: 131072, supportsImages: true, supportsTools: true },
    'llama-3.2-90b-vision': { contextLength: 131072, supportsImages: true, supportsTools: true },
    // Mistral
    'mistral-large': { contextLength: 131072, supportsImages: false, supportsTools: true },
    'mistral-medium': { contextLength: 32768, supportsImages: false, supportsTools: true },
    'mistral-small': { contextLength: 32768, supportsImages: false, supportsTools: true },
    'pixtral-large': { contextLength: 131072, supportsImages: true, supportsTools: true },
    'codestral': { contextLength: 262144, supportsImages: false, supportsTools: true },
    // Qwen
    'qwen-2.5-72b-instruct': { contextLength: 131072, supportsImages: false, supportsTools: true },
    'qwen-2.5-coder-32b': { contextLength: 131072, supportsImages: false, supportsTools: true },
    'qwen2.5-vl-72b-instruct': { contextLength: 131072, supportsImages: true, supportsTools: true },
    'qwen3-235b-a22b': { contextLength: 131072, supportsImages: false, supportsTools: true },
    'qwq-32b': { contextLength: 131072, supportsImages: false, supportsTools: true },
    // xAI
    'grok-2': { contextLength: 131072, supportsImages: true, supportsTools: true },
    'grok-3': { contextLength: 131072, supportsImages: true, supportsTools: true },
    'grok-4': { contextLength: 262144, supportsImages: true, supportsTools: true },
    // Cohere
    'command-r': { contextLength: 131072, supportsImages: false, supportsTools: true },
    'command-r-plus': { contextLength: 131072, supportsImages: false, supportsTools: true },
    'command-a': { contextLength: 262144, supportsImages: false, supportsTools: true },
    // Perplexity
    'sonar': { contextLength: 131072, supportsImages: false, supportsTools: true },
    'sonar-pro': { contextLength: 200000, supportsImages: false, supportsTools: true },
    'sonar-reasoning': { contextLength: 131072, supportsImages: false, supportsTools: true },
    'sonar-reasoning-pro': { contextLength: 200000, supportsImages: false, supportsTools: true },
    // Amazon
    'nova-pro': { contextLength: 300000, supportsImages: true, supportsTools: true },
    'nova-lite': { contextLength: 300000, supportsImages: true, supportsTools: true },
    'nova-micro': { contextLength: 131072, supportsImages: false, supportsTools: true },
    // Moonshot / Kimi
    'kimi-k2': { contextLength: 131072, supportsImages: false, supportsTools: true },
    'kimi-latest': { contextLength: 131072, supportsImages: true, supportsTools: true },
    // MiniMax
    'minimax-m1': { contextLength: 1000000, supportsImages: false, supportsTools: true },
    // Zhipu / GLM
    'glm-4-plus': { contextLength: 131072, supportsImages: false, supportsTools: true },
    'glm-4.5': { contextLength: 131072, supportsImages: false, supportsTools: true },
    'glm-4.6': { contextLength: 200000, supportsImages: false, supportsTools: true },
    // Microsoft
    'phi-4': { contextLength: 16384, supportsImages: false, supportsTools: true },
    // Google older
    'gemma-2-27b': { contextLength: 8192, supportsImages: false, supportsTools: false },
    'gemma-2-9b': { contextLength: 8192, supportsImages: false, supportsTools: false },
    // Common OpenRouter free aliases (basename forms)
    'mimo-v2.6-flash-free': { contextLength: 131072, supportsImages: false, supportsTools: true },
    'mimo-v2.5-free': { contextLength: 131072, supportsImages: false, supportsTools: true },
    'muse-spark-1.3-contributor-free': { contextLength: 131072, supportsImages: false, supportsTools: true },
    'muse-spark-1.2-contributor-free': { contextLength: 131072, supportsImages: false, supportsTools: true },
};

const VISION_NAME_RE = /(?:^|[\/\-_.])(?:vl|vision|4o|omni|gemini|gemma|pixtral|llava|paligemma|vision[-_]?pro|llama[-_]?3\.2[-_].*vision)/i;
const NO_VISION_NAME_RE = /(?:^|[\/\-_.])(?:code|coder|embedding|audio|transcribe|tts|whisper|rerank)/i;
const NO_TOOLS_NAME_RE = /(?:^|[\/\-_.])(?:embedding|whisper|tts|transcribe|rerank|moderation|audio)/i;

export class ModelMetaResolver {
    constructor(networkClient, logger) {
        this.network = networkClient;
        this.logger = logger;
        this._orCatalog = null;       // Map normalizedKey -> meta
        this._orCatalogRaw = null;    // Map exact id -> meta
        this._orPromise = null;
        this._orLoadedAt = 0;
    }

    /** Normalize model id for fuzzy matching across providers/catalogs. */
    normalizeKey(id) {
        let s = String(id || '').toLowerCase().trim();
        if (!s) return '';
        // strip common vendor prefixes (openrouter style)
        s = s.replace(/^(openai|anthropic|google|meta|meta-llama|mistralai|mistral|deepseek|qwen|amazon|cohere|perplexity|together|fireworks|groq|x-ai|xai|openrouter|nvidia|microsoft|ai21|liquid|z-ai|zhipu|moonshotai|moonshot|minimax|stepfun|qwen)\//, '');
        // drop date suffixes 20241022 / -2024-10-22
        s = s.replace(/[-_]?20\d{6}$/, '');
        s = s.replace(/[-_]?20\d{2}[-_]?\d{2}[-_]?\d{2}$/, '');
        // drop common trailing tags
        s = s.replace(/[-_.]?(latest|free|experimental|instruct|preview|chat|thinking|turbo)$/g, '');
        // unify separators
        s = s.replace(/[\s_]+/g, '-');
        s = s.replace(/\.(\d)/g, '-$1'); // qwen3.8 -> qwen3-8 style not needed but ok for gemini-2.5
        s = s.replace(/-+/g, '-').replace(/^-|-$/g, '');
        return s;
    }

    _kbLookup(modelId) {
        const raw = String(modelId || '').toLowerCase();
        if (!raw) return null;
        if (LOCAL_KB[raw]) return LOCAL_KB[raw];
        const key = this.normalizeKey(modelId);
        if (LOCAL_KB[key]) return LOCAL_KB[key];
        // prefix/basename candidates
        const basename = raw.split('/').pop();
        if (LOCAL_KB[basename]) return LOCAL_KB[basename];
        const baseKey = this.normalizeKey(basename);
        if (LOCAL_KB[baseKey]) return LOCAL_KB[baseKey];
        // contains unique match in KB
        if (key.length >= 6) {
            const hits = Object.keys(LOCAL_KB).filter(k => k.includes(key) || key.includes(k));
            if (hits.length === 1) return LOCAL_KB[hits[0]];
            // prefer longest KB key contained in query
            let best = null;
            for (const k of Object.keys(LOCAL_KB)) {
                if (key.includes(k) && (!best || k.length > best.length)) best = k;
            }
            if (best) return LOCAL_KB[best];
        }
        return null;
    }

    async ensureOpenRouterCatalog(force = false) {
        const maxAge = 12 * 60 * 60 * 1000;
        if (!force && this._orCatalog && (Date.now() - this._orLoadedAt) < maxAge) return this._orCatalog;
        if (this._orPromise && !force) return this._orPromise;
        this._orPromise = (async () => {
            try {
                const resp = await this.network.proxyFetch('https://openrouter.ai/api/v1/models', 'GET', {});
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const data = await resp.json();
                const list = Array.isArray(data?.data) ? data.data : [];
                const exact = new Map();
                const norm = new Map();
                for (const m of list) {
                    if (!m?.id) continue;
                    const meta = this._fromOpenRouterItem(m);
                    exact.set(String(m.id).toLowerCase(), meta);
                    const nk = this.normalizeKey(m.id);
                    // prefer non-free original when both exist (exact free keeps its own entry)
                    if (nk && !norm.has(nk)) norm.set(nk, meta);
                    // also map basename
                    const base = String(m.id).split('/').pop();
                    const bk = this.normalizeKey(base);
                    if (bk && !norm.has(bk)) norm.set(bk, meta);
                }
                this._orCatalogRaw = exact;
                this._orCatalog = norm;
                this._orLoadedAt = Date.now();
                this.logger?.info?.('ModelMetaResolver', `OpenRouter catalog loaded: ${exact.size} models`);
                return this._orCatalog;
            } catch (e) {
                this.logger?.warn?.('ModelMetaResolver', 'OpenRouter catalog failed', e.message);
                this._orPromise = null;
                return null;
            }
        })();
        return this._orPromise;
    }

    _fromOpenRouterItem(m) {
        const out = {};
        const ctx = Number(m.context_length || m.context_window || 0);
        if (Number.isFinite(ctx) && ctx >= 1000) out.contextLength = Math.round(ctx);

        const modality = String(m.architecture?.modality || '').toLowerCase();
        const inMods = Array.isArray(m.architecture?.input_modalities) ? m.architecture.input_modalities.join(',').toLowerCase() : '';
        const hay = `${modality},${inMods}`;
        if (hay.includes('image') || hay.includes('vision')) out.supportsImages = true;
        else if (hay.includes('text')) out.supportsImages = false;

        const params = Array.isArray(m.supported_parameters) ? m.supported_parameters.join(',').toLowerCase() : '';
        if (params.includes('tool') || params.includes('function')) out.supportsTools = true;
        else if (params) out.supportsTools = false;

        if (m.name) out.name = m.name;
        return out;
    }

    async lookupOnline(modelId) {
        await this.ensureOpenRouterCatalog();
        if (!this._orCatalogRaw) return null;
        const raw = String(modelId || '').toLowerCase();
        if (this._orCatalogRaw.has(raw)) return this._orCatalogRaw.get(raw);
        const key = this.normalizeKey(modelId);
        if (key && this._orCatalog.has(key)) return this._orCatalog.get(key);
        const base = raw.split('/').pop();
        if (this._orCatalogRaw.has(base)) return this._orCatalogRaw.get(base);
        const bk = this.normalizeKey(base);
        if (bk && this._orCatalog.has(bk)) return this._orCatalog.get(bk);
        return null;
    }

    /**
     * Merge metadata layers into a model-like object.
     * Priority: explicit fields on input > provider-shaped fields already on input > online catalog > local KB > name heuristics
     * Always returns object with contextLength (may be 0) and boolean supportsImages/supportsTools when resolvable.
     */
    enrich(input, { online = true } = {}) {
        const out = { ...(input || {}) };
        const id = out.modelId || out.id || '';
        const name = out.name || '';

        const hasCtx = Number(out.contextLength) > 0;
        const hasVis = typeof out.supportsImages === 'boolean';
        const hasTool = typeof out.supportsTools === 'boolean';

        const apply = (src) => {
            if (!src) return;
            if (!out.contextLength && Number(src.contextLength) > 0) out.contextLength = Number(src.contextLength);
            if (typeof out.supportsImages !== 'boolean' && typeof src.supportsImages === 'boolean') out.supportsImages = src.supportsImages;
            if (typeof out.supportsTools !== 'boolean' && typeof src.supportsTools === 'boolean') out.supportsTools = src.supportsTools;
            if (!out.name && src.name) out.name = src.name;
        };

        // Sync layers that are available offline first
        apply(this._kbLookup(id) || this._kbLookup(name));

        // Heuristics only for still-missing vision flag (never override boolean)
        if (typeof out.supportsImages !== 'boolean') {
            if (VISION_NAME_RE.test(id) || VISION_NAME_RE.test(name)) {
                out.supportsImages = !NO_VISION_NAME_RE.test(id);
            }
        }
        if (typeof out.supportsTools !== 'boolean') {
            if (NO_TOOLS_NAME_RE.test(id) || NO_TOOLS_NAME_RE.test(name)) out.supportsTools = false;
        }

        const missing = !(Number(out.contextLength) > 0 && typeof out.supportsImages === 'boolean' && typeof out.supportsTools === 'boolean');
        if (online && missing && id) {
            // fire-and-forget is NOT ok here — caller may await enrichAll
            // enrich() itself is sync; use enrichAsync for online fill
        }

        // If everything already known, mark source
        if (hasCtx && hasVis && hasTool) out.metaSource = out.metaSource || 'api';
        return out;
    }

    async enrichAsync(input, opts = {}) {
        const out = this.enrich(input, opts);
        const id = out.modelId || out.id || '';
        const missingCtx = !(Number(out.contextLength) > 0);
        const missingVis = typeof out.supportsImages !== 'boolean';
        const missingTool = typeof out.supportsTools !== 'boolean';
        if (opts.online !== false && id && (missingCtx || missingVis || missingTool)) {
            const online = await this.lookupOnline(id);
            if (online) {
                if (missingCtx && Number(online.contextLength) > 0) out.contextLength = Number(online.contextLength);
                if (missingVis && typeof online.supportsImages === 'boolean') out.supportsImages = online.supportsImages;
                if (missingTool && typeof online.supportsTools === 'boolean') out.supportsTools = online.supportsTools;
                if (!out.name && online.name) out.name = online.name;
                out.metaSource = 'openrouter';
            }
        }
        if (!out.metaSource) {
            const kb = this._kbLookup(id);
            out.metaSource = kb ? 'local' : (typeof out.supportsImages === 'boolean' || Number(out.contextLength) > 0 ? 'partial' : 'none');
        }
        // Final safety: still unknown context → leave 0 (no fake numbers); vision/tools keep unknown as undefined only if truly unknown
        return out;
    }

    async enrichList(list, opts = {}) {
        if (!Array.isArray(list) || !list.length) return list || [];
        // Warm catalog once for the whole batch
        if (opts.online !== false) await this.ensureOpenRouterCatalog();
        const out = [];
        for (const item of list) {
            out.push(await this.enrichAsync(item, opts));
        }
        return out;
    }

    /**
     * Fill missing fields on stored models without overwriting user/API values.
     * Returns { list, changed }.
     */
    async backfillStored(models, opts = {}) {
        if (!Array.isArray(models) || !models.length) return { list: models || [], changed: false };
        if (opts.online !== false) await this.ensureOpenRouterCatalog();
        let changed = false;
        const list = models.map(m => ({ ...m }));
        for (const m of list) {
            const id = m.modelId || m.id || '';
            const needCtx = !(Number(m.contextLength) > 0);
            const needVis = typeof m.supportsImages !== 'boolean';
            const needTool = typeof m.supportsTools !== 'boolean';
            if (!needCtx && !needVis && !needTool) continue;
            const filled = await this.enrichAsync(m, opts);
            if (Number(filled.contextLength) > 0 && !Number(m.contextLength)) {
                m.contextLength = Number(filled.contextLength); changed = true;
            }
            if (typeof m.supportsImages !== 'boolean' && typeof filled.supportsImages === 'boolean') {
                m.supportsImages = filled.supportsImages; changed = true;
            }
            if (typeof m.supportsTools !== 'boolean' && typeof filled.supportsTools === 'boolean') {
                m.supportsTools = filled.supportsTools; changed = true;
            }
            void id;
        }
        return { list, changed };
    }
}
