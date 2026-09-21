/**
 * SX Core SDK - StateStore
 * Centralized state store for models, providers, and conversation state.
 */
export class StateStore {
    constructor(eventBus, logger) {
        this.bus = eventBus;
        this.logger = logger;
        this._providers = [];
        this._models = [];
        this._activeModelId = null;
        this._savedConfig = null;
    }

    init() {
        try {
            this._savedConfig = window.__SX_SAVED_CONFIG__ || {};
            if (this._savedConfig.providers?.length) {
                const curP = this._parseLocal('sx_providers');
                if (this._savedConfig.providers.length >= curP.length || !curP.length) {
                    localStorage.setItem('sx_providers', JSON.stringify(this._savedConfig.providers));
                }
            }
            if (this._savedConfig.models?.length) {
                const curM = this._parseLocal('sx_models');
                if (this._savedConfig.models.length >= curM.length || !curM.length) {
                    localStorage.setItem('sx_models', JSON.stringify(this._savedConfig.models));
                }
            }
        } catch(e) {
            this.logger.error('StateStore', 'Failed to read initial __SX_SAVED_CONFIG__', e);
        }

        this._loadProviders();
        this._loadModels();
        this._activeModelId = localStorage.getItem('sx_active_model_id') || (this._models[0]?.id || null);
    }

    _parseLocal(key) {
        try {
            return JSON.parse(localStorage.getItem(key) || '[]');
        } catch(e) {
            return [];
        }
    }

    _loadProviders() {
        const diskList = this._savedConfig?.providers;
        const localList = this._parseLocal('sx_providers');
        if (Array.isArray(diskList) && diskList.length >= localList.length && diskList.length > 0) {
            this._providers = diskList;
        } else if (localList.length) {
            this._providers = localList;
        } else if (Array.isArray(diskList) && diskList.length > 0) {
            this._providers = diskList;
        } else {
            this._providers = [];
        }
    }

    _loadModels() {
        const diskList = this._savedConfig?.models;
        const localList = this._parseLocal('sx_models');
        if (Array.isArray(diskList) && diskList.length >= localList.length && diskList.length > 0) {
            this._models = diskList;
        } else if (localList.length) {
            this._models = localList;
        } else if (Array.isArray(diskList) && diskList.length > 0) {
            this._models = diskList;
        } else {
            this._models = [];
        }
    }

    getProviders() {
        return [...this._providers];
    }

    getModels() {
        return [...this._models];
    }

    setProviders(list) {
        this._providers = list;
        localStorage.setItem('sx_providers', JSON.stringify(list));
        if (!window.__SX_SAVED_CONFIG__) window.__SX_SAVED_CONFIG__ = {};
        window.__SX_SAVED_CONFIG__.providers = list;
        this.bus.emit('state:providers-updated', this._providers);
    }

    setModels(list) {
        this._models = list;
        localStorage.setItem('sx_models', JSON.stringify(list));
        if (!window.__SX_SAVED_CONFIG__) window.__SX_SAVED_CONFIG__ = {};
        window.__SX_SAVED_CONFIG__.models = list;
        this.bus.emit('state:models-updated', this._models);
    }

    getActiveModelId() {
        return this._activeModelId || localStorage.getItem('sx_active_model_id');
    }

    setActiveModelId(modelId, convKey = null, persistConv = false) {
        this._activeModelId = modelId;
        localStorage.setItem('sx_active_model_id', modelId);
        if (persistConv && convKey && convKey !== 'conv_new' && convKey !== 'conv_global') {
            localStorage.setItem('sx_active_model_' + convKey, modelId);
        }
        this.bus.emit('state:model-selected', { modelId, convKey });
    }
}
