/**
 * SX Core SDK - ModelManager
 * Handles models, providers, presets, metadata, and ConnectRPC model configuration data.
 */
export const SX_PRESETS = [
    { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', protocol: 'openai', modelsPath: '/models' },
    { id: 'kilo',       name: 'Kilo AI',    baseUrl: 'https://api.kilo.ai/v1',        protocol: 'openai', modelsPath: '/models' },
    { id: 'kira',       name: 'Kira AI',    baseUrl: 'https://api.kira.ai/v1',        protocol: 'openai', modelsPath: '/models' },
    { id: 'anthropic',  name: 'Anthropic',  baseUrl: 'https://api.anthropic.com',     protocol: 'anthropic', modelsPath: '/v1/models' },
    { id: 'openai',     name: 'OpenAI',     baseUrl: 'https://api.openai.com/v1',     protocol: 'openai', modelsPath: '/models' },
    { id: 'deepseek',   name: 'DeepSeek',   baseUrl: 'https://api.deepseek.com/v1',   protocol: 'openai', modelsPath: '/models' },
    { id: 'groq',       name: 'Groq',       baseUrl: 'https://api.groq.com/openai/v1', protocol: 'openai', modelsPath: '/models' },
    { id: 'mistral',    name: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1',     protocol: 'openai', modelsPath: '/models' },
    { id: 'together',   name: 'Together AI', baseUrl: 'https://api.together.xyz/v1',  protocol: 'openai', modelsPath: '/models' },
    { id: 'fireworks',  name: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1', protocol: 'openai', modelsPath: '/models' },
    { id: 'xai',        name: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1',           protocol: 'openai', modelsPath: '/models' },
    { id: 'gemini',     name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', protocol: 'openai', modelsPath: '/models' },
    { id: 'siliconflow', name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', protocol: 'openai', modelsPath: '/models' },
    { id: 'qwen',       name: 'Qwen / DashScope', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', protocol: 'openai', modelsPath: '/models' },
    { id: 'cohere',     name: 'Cohere',     baseUrl: 'https://api.cohere.com/v2',     protocol: 'openai', modelsPath: '/models' },
    { id: 'perplexity', name: 'Perplexity', baseUrl: 'https://api.perplexity.ai',    protocol: 'openai', modelsPath: '/models' },
    { id: 'ollama',     name: 'Ollama (Local)', baseUrl: 'http://127.0.0.1:11434/v1', protocol: 'openai', modelsPath: '/models' },
    { id: 'lmstudio',   name: 'LM Studio',  baseUrl: 'http://127.0.0.1:1234/v1',     protocol: 'openai', modelsPath: '/models' },
    { id: 'custom',     name: 'Custom Endpoint', baseUrl: '',                         protocol: 'openai', modelsPath: '/models' }
];

export const ALLOWED_TIERS = [
    "TEAMS_TIER_PRO", "TEAMS_TIER_TEAMS", "TEAMS_TIER_ENTERPRISE_SELF_HOSTED",
    "TEAMS_TIER_ENTERPRISE_SAAS", "TEAMS_TIER_HYBRID", "TEAMS_TIER_PRO_ULTIMATE"
];

export class ModelManager {
    constructor(eventBus, stateStore, networkClient, logger) {
        this.bus = eventBus;
        this.state = stateStore;
        this.network = networkClient;
        this.logger = logger;
    }

    init() {
        this.bus.on('state:providers-updated', () => {
            this.network.syncConfig(this.state.getProviders(), this.state.getModels());
        });

        this.bus.on('state:models-updated', () => {
            this.network.syncConfig(this.state.getProviders(), this.state.getModels());
        });
    }

    getProviderMeta(providerIdOrName) {
        let prov = null;
        try {
            const providers = this.state.getProviders();
            if (typeof providerIdOrName === 'string') {
                prov = providers.find(p => p.id === providerIdOrName || (p.name && p.name.toLowerCase() === providerIdOrName.toLowerCase()));
            } else if (providerIdOrName && typeof providerIdOrName === 'object') {
                prov = providerIdOrName;
            }
        } catch(e) {}

        const preset = SX_PRESETS.find(p => p.id === (prov?.preset || prov?.id));
        const finalName = prov?.name || preset?.name || (typeof providerIdOrName === 'string' ? providerIdOrName : 'Custom');
        const finalLower = finalName.toLowerCase();

        let iconSvg = '';
        let color = '#38bdf8';

        if (finalLower.includes('openrouter')) {
            color = '#06b6d4'; // cyan
            iconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`;
        } else if (finalLower.includes('kilo') || finalLower.includes('kira')) {
            color = '#f97316'; // warm orange
            iconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 4h4v16H4zM16 4l-6 8 6 8h4.5l-6-8 6-8z"/></svg>`;
        } else if (finalLower.includes('anthropic') || finalLower.includes('claude')) {
            color = '#a855f7'; // violet
            iconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M14.5 3h-5l-6 18h4.5l1.2-3.8h5.6l1.2 3.8h4.5L14.5 3zm-4.1 11.2l1.6-5.2 1.6 5.2h-3.2z"/></svg>`;
        } else if (finalLower.includes('openai') || finalLower.includes('gpt')) {
            color = '#10b981'; // emerald
            iconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>`;
        } else if (finalLower.includes('deepseek')) {
            color = '#3b82f6'; // deep blue
            iconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.5h-2v-2h2v2zm0-4h-2V7h2v5.5z"/></svg>`;
        } else {
            color = '#06b6d4';
            iconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
        }

        return { name: finalName, color, iconSvg };
    }

    formatContextSize(num) {
        if (!num) return '';
        const n = Number(num);
        if (isNaN(n) || n <= 0) return '';
        if (n >= 1048576) return Math.round(n / 1048576) + 'M';
        if (n >= 1000) return Math.round(n / 1024) + 'k';
        return String(n);
    }

    isVisionModel(m) {
        if (typeof m.supportsImages === 'boolean') return m.supportsImages;
        const str = `${m.modelId || ''} ${m.name || ''} ${m.id || ''}`.toLowerCase();
        if (/(?:vl|vision|omni|4o|gemini|gemma|inkling|nex-n|pixtral|llava|paligemma|content-safety|qwen.*vl|qwen3\.8)/i.test(str)) {
            if (/(?:code|sante|fin|super|ultra|lightning)/i.test(str) && !/(?:vl|vision|omni)/i.test(str)) {
                return false;
            }
            return true;
        }
        return false;
    }

    supportsTools(m) {
        if (typeof m.supportsTools === 'boolean') return m.supportsTools;
        const str = `${m.modelId || ''} ${m.name || ''}`.toLowerCase();
        if (/(?:no[-_]?tools?|text[-_]?only|completion)/.test(str)) return false;
        return true;
    }

    buildSXModelConfig(m, index = 0) {
        const placeholderEnum = 'MODEL_PLACEHOLDER_M1';
        const hasVision = this.isVisionModel(m);
        const hasTools = this.supportsTools(m);
        return {
            label: m.name,
            modelOrAlias: { model: placeholderEnum },
            supportsImages: hasVision,
            supportsTools: hasTools,
            supportsThinking: true,
            supportsAdaptiveThinking: true,
            supportsRawThinking: true,
            thinkingBudget: 16384,
            minThinkingBudget: 2048,
            isRecommended: true,
            allowedTiers: ALLOWED_TIERS,
            quotaInfo: { remainingFraction: 1.0, resetTime: "2030-12-31T23:59:59Z" },
            tagTitle: "",
            tagDescription: "",
            supportedMimeTypes: hasVision ? {
                "text/plain": true,
                "image/png": true,
                "image/jpeg": true,
                "image/webp": true,
                "image/gif": true
            } : {
                "text/plain": true
            },
            modelId: m.id,
            contextLength: m.contextLength || undefined
        };
    }

    buildCustomModelConfigs() {
        const sxModels = this.state.getModels();
        if (sxModels && sxModels.length > 0) {
            return sxModels.map((m, idx) => this.buildSXModelConfig(m, idx));
        }
        return [
            {
                label: "SX Custom Engine",
                modelOrAlias: { model: "MODEL_PLACEHOLDER_M1" },
                supportsImages: true,
                supportsThinking: true,
                supportsAdaptiveThinking: true,
                supportsRawThinking: true,
                thinkingBudget: 16384,
                minThinkingBudget: 2048,
                isRecommended: true,
                allowedTiers: ALLOWED_TIERS,
                quotaInfo: { remainingFraction: 1.0, resetTime: "2030-12-31T23:59:59Z" },
                tagTitle: "",
                tagDescription: "",
                supportedMimeTypes: { "text/plain": true, "image/png": true, "image/jpeg": true, "image/webp": true, "image/gif": true },
                modelId: "sx-proxy-1"
            }
        ];
    }

    buildCustomModelSorts() {
        const sxModels = this.state.getModels();
        if (sxModels && sxModels.length > 0) {
            return [{
                name: "Recommended",
                groups: [{ groupName: "AI Models", modelLabels: sxModels.map(m => m.name) }]
            }];
        }
        return [{
            name: "Recommended",
            groups: [{ groupName: "AI Models", modelLabels: ["SX Custom Engine"] }]
        }];
    }

    getActiveConversationKey() {
        try {
            const m = window.location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/);
            if (m && m[1]) return 'conv_' + m[1];
        } catch(e) {}
        try {
            const m2 = window.location.href.match(/(?:\/c\/|\/conversation[s]?\/)([a-zA-Z0-9_-]+)/);
            if (m2 && m2[1]) return 'conv_' + m2[1];
        } catch(e) {}
        try {
            const selRow = document.querySelector('[data-testid="conversation-row-sidebar"][data-selected="true"]');
            if (selRow) {
                const id = selRow.getAttribute('data-cascade-id') || selRow.getAttribute('data-conversation-id');
                if (id) return 'conv_' + id;
            }
        } catch(e) {}
        try {
            const activeLink = document.querySelector('a[href^="/c/"][aria-current], a[href^="/c/"].active');
            if (activeLink) {
                const m3 = activeLink.getAttribute('href').match(/\/c\/([a-zA-Z0-9_-]+)/);
                if (m3 && m3[1]) return 'conv_' + m3[1];
            }
        } catch(e) {}
        return 'conv_new';
    }

    getActiveModelForConversation(convKey = null) {
        const key = convKey || this.getActiveConversationKey();
        let modelId = null;
        if (key && key !== 'conv_new') {
            modelId = localStorage.getItem('sx_active_model_' + key);
        }
        if (!modelId) {
            modelId = localStorage.getItem('sx_last_used_model_id') || localStorage.getItem('sx_active_model_id');
        }
        const sxModels = this.state.getModels();
        if (sxModels.length > 0) {
            const found = sxModels.find(m => m.id === modelId);
            return found ? found.id : sxModels[0].id;
        }
        return modelId;
    }

    setActiveModelForConversation(modelId, convKey = null, explicitUserChoice = false) {
        if (!modelId) return;
        const key = convKey || this.getActiveConversationKey();
        if (explicitUserChoice && key && key !== 'conv_new') {
            localStorage.setItem('sx_active_model_' + key, modelId);
        }
        localStorage.setItem('sx_last_used_model_id', modelId);
        localStorage.setItem('sx_active_model_id', modelId);
        this.notifyActiveModel(modelId, false, key, explicitUserChoice);
    }

    notifyActiveModel(modelId, forceGlobal = false, specificConvKey = null, persistConv = false) {
        if (!modelId) return;
        const convKey = specificConvKey || this.getActiveConversationKey();
        this.state.setActiveModelId(modelId, forceGlobal ? null : convKey, persistConv);
        this.network.setActiveModel(modelId, forceGlobal ? 'conv_global' : convKey);
    }
}
