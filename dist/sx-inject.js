(() => {
  // src/core/EventBus.js
  var EventBus = class {
    constructor() {
      this._listeners = /* @__PURE__ */ new Map();
    }
    /**
     * Subscribe to an event
     * @param {string} event
     * @param {Function} handler
     * @returns {Function} unsubscribe function
     */
    on(event, handler) {
      if (!this._listeners.has(event)) {
        this._listeners.set(event, /* @__PURE__ */ new Set());
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
  };

  // src/core/Logger.js
  var Logger = class {
    constructor(prefix = "SX") {
      this.prefix = prefix;
      this.debugEnabled = true;
    }
    info(module, message, ...args) {
      console.log(`%c[${this.prefix}:${module}]`, "color: #38bdf8; font-weight: bold;", message, ...args);
    }
    warn(module, message, ...args) {
      console.warn(`%c[${this.prefix}:${module}]`, "color: #fbbf24; font-weight: bold;", message, ...args);
    }
    error(module, message, ...args) {
      console.error(`%c[${this.prefix}:${module}]`, "color: #f43f5e; font-weight: bold;", message, ...args);
    }
    debug(module, message, ...args) {
      if (!this.debugEnabled) return;
      console.debug(`%c[${this.prefix}:${module}]`, "color: #94a3b8; font-style: italic;", message, ...args);
    }
  };

  // src/core/Container.js
  var Container = class {
    constructor() {
      this._services = /* @__PURE__ */ new Map();
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
  };

  // src/core/StateStore.js
  var StateStore = class {
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
          const curP = this._parseLocal("sx_providers");
          if (this._savedConfig.providers.length >= curP.length || !curP.length) {
            localStorage.setItem("sx_providers", JSON.stringify(this._savedConfig.providers));
          }
        }
        if (this._savedConfig.models?.length) {
          const curM = this._parseLocal("sx_models");
          if (this._savedConfig.models.length >= curM.length || !curM.length) {
            localStorage.setItem("sx_models", JSON.stringify(this._savedConfig.models));
          }
        }
      } catch (e) {
        this.logger.error("StateStore", "Failed to read initial __SX_SAVED_CONFIG__", e);
      }
      this._loadProviders();
      this._loadModels();
      this._activeModelId = localStorage.getItem("sx_active_model_id") || (this._models[0]?.id || null);
    }
    _parseLocal(key) {
      try {
        return JSON.parse(localStorage.getItem(key) || "[]");
      } catch (e) {
        return [];
      }
    }
    _loadProviders() {
      const diskList = this._savedConfig?.providers;
      const localList = this._parseLocal("sx_providers");
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
      const localList = this._parseLocal("sx_models");
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
      localStorage.setItem("sx_providers", JSON.stringify(list));
      if (!window.__SX_SAVED_CONFIG__) window.__SX_SAVED_CONFIG__ = {};
      window.__SX_SAVED_CONFIG__.providers = list;
      this.bus.emit("state:providers-updated", this._providers);
    }
    setModels(list) {
      this._models = list;
      localStorage.setItem("sx_models", JSON.stringify(list));
      if (!window.__SX_SAVED_CONFIG__) window.__SX_SAVED_CONFIG__ = {};
      window.__SX_SAVED_CONFIG__.models = list;
      this.bus.emit("state:models-updated", this._models);
    }
    getActiveModelId() {
      return this._activeModelId || localStorage.getItem("sx_active_model_id");
    }
    setActiveModelId(modelId, convKey = null, persistConv = false) {
      this._activeModelId = modelId;
      localStorage.setItem("sx_active_model_id", modelId);
      if (persistConv && convKey && convKey !== "conv_new" && convKey !== "conv_global") {
        localStorage.setItem("sx_active_model_" + convKey, modelId);
      }
      this.bus.emit("state:model-selected", { modelId, convKey });
    }
  };

  // src/services/StorageService.js
  var StorageService = class {
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
        if ((key === "theme-preset-dark" || key === "theme-preset-light") && val) {
          self.bus.emit("storage:get-theme", { key, val });
        }
        return val;
      };
      Storage.prototype.setItem = function(key, val) {
        const res = self._origSetItem.apply(this, arguments);
        if (key === "theme-preset-dark" && !self._inSetItem) {
          self._inSetItem = true;
          try {
            self.bus.emit("storage:theme-preset-changed", { key, val });
          } finally {
            self._inSetItem = false;
          }
        }
        return res;
      };
      this.logger.info("StorageService", "Storage hooks initialized safely.");
    }
    silentSetItem(key, val) {
      return this._origSetItem.call(localStorage, key, val);
    }
    silentGetItem(key) {
      return this._origGetItem.call(localStorage, key);
    }
  };

  // src/services/NetworkClient.js
  var NetworkClient = class {
    constructor(logger, baseUrl = "http://127.0.0.1:15725/sx") {
      this.logger = logger;
      this.baseUrl = baseUrl;
    }
    async get(path) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", `${this.baseUrl}${path}`, true);
        xhr.timeout = 1e4;
        xhr.onload = () => {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) {
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
        xhr.open("POST", `${this.baseUrl}${path}`, true);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.timeout = 15e3;
        xhr.onload = () => {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) {
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
        return await this.get("/get-config");
      } catch (e) {
        this.logger.warn("NetworkClient", "Failed to fetch persisted config", e.message);
        return null;
      }
    }
    async syncConfig(providers, models, forceClear = false) {
      try {
        if (!forceClear && !providers.length && !models.length) return;
        return await this.post("/update-config", { providers, models, forceClear });
      } catch (e) {
        this.logger.warn("NetworkClient", "Failed to sync config to proxy", e.message);
      }
    }
    async setActiveModel(modelId, convKey) {
      try {
        return await this.post("/set-active-model", { modelId, convKey });
      } catch (e) {
        this.logger.warn("NetworkClient", "Failed to notify active model", e.message);
      }
    }
    async saveTheme(theme) {
      try {
        return await this.post("/save-theme", theme);
      } catch (e) {
        this.logger.warn("NetworkClient", "Failed to save theme to proxy", e.message);
      }
    }
    async fetchContextDetails(convId, modelId = "") {
      try {
        const query = `?convId=${encodeURIComponent(convId || "")}${modelId ? `&modelId=${encodeURIComponent(modelId)}` : ""}`;
        return await this.get(`/get-chat-context-details${query}`);
      } catch (e) {
        return null;
      }
    }
    async fetchPerfStats(convId) {
      try {
        const res = await this.get(`/get-chat-perf-stats?convId=${encodeURIComponent(convId)}`);
        return res?.stats || res || null;
      } catch (e) {
        return null;
      }
    }
    proxyFetch(targetUrl, method = "GET", headers = {}, body) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${this.baseUrl}/proxy-fetch`, true);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.timeout = 15e3;
        xhr.onload = () => {
          const status = xhr.status;
          const responseText = xhr.responseText;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            text: () => Promise.resolve(responseText),
            json: () => {
              try {
                return Promise.resolve(JSON.parse(responseText));
              } catch (e) {
                return Promise.reject(e);
              }
            }
          });
        };
        xhr.onerror = () => reject(new Error("Network error reaching sxProxy"));
        xhr.ontimeout = () => reject(new Error("Timeout reaching sxProxy"));
        xhr.send(JSON.stringify({ url: targetUrl, method, headers, body }));
      });
    }
    async fetchModels(baseUrl, apiKey, protocol, modelsPath) {
      const proto = (protocol || "openai").toLowerCase();
      const normalBase = (baseUrl || "").replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "");
      let url, headers;
      if (proto === "anthropic") {
        url = (normalBase || "https://api.anthropic.com") + (modelsPath || "/v1/models");
        headers = { "x-api-key": apiKey || "", "anthropic-version": "2023-06-01" };
      } else {
        url = (normalBase || "https://api.openai.com/v1") + (modelsPath || "/models");
        headers = { "Authorization": "Bearer " + (apiKey || "") };
      }
      const resp = await this.proxyFetch(url, "GET", headers);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      const list = data.data || data.models || (Array.isArray(data) ? data : []);
      return list.map((m) => m && typeof m === "object" ? this._normalizeModelMeta(m) : null).filter((m) => m && m.id);
    }
    _normalizeModelMeta(m) {
      const id = m.id || m.name || "";
      const name = m.display_name || m.name || m.id || "";
      const contextLength = this._extractContextLength(m);
      const supportsImages = this._extractVision(m);
      const supportsTools = this._extractTools(m);
      const out = { id, name };
      if (contextLength) out.contextLength = contextLength;
      if (typeof supportsImages === "boolean") out.supportsImages = supportsImages;
      if (typeof supportsTools === "boolean") out.supportsTools = supportsTools;
      return out;
    }
    _extractContextLength(m) {
      const candidates = [
        m.context_length,
        m.contextLength,
        m.context_window,
        m.contextWindow,
        m.max_context_length,
        m.maxContextLength,
        m.max_context_tokens,
        m.maxContextTokens,
        m.context_length_tokens,
        m.max_tokens,
        m.maxTokens,
        m.topics?.context_length,
        m.limits?.context_length,
        m.info?.context_length
      ];
      for (const c of candidates) {
        const n = Number(c);
        if (Number.isFinite(n) && n >= 1e3) return Math.round(n);
      }
      const arch = m.architecture || m.model_info || m.info || {};
      for (const c of [arch.context_length, arch.context_window, arch.max_context_length]) {
        const n = Number(c);
        if (Number.isFinite(n) && n >= 1e3) return Math.round(n);
      }
      const win = m.window || m.input?.context_window;
      if (win && typeof win === "object") {
        const n = Number(win.max || win.context_length);
        if (Number.isFinite(n) && n >= 1e3) return Math.round(n);
      }
      return 0;
    }
    _extractVision(m) {
      if (typeof m.supports_images === "boolean") return m.supports_images;
      if (typeof m.supports_vision === "boolean") return m.supports_vision;
      if (typeof m.supportsImages === "boolean") return m.supportsImages;
      if (typeof m.vision === "boolean") return m.vision;
      const modality = String(m.modality || m.architecture?.modality || m.architecture?.input_modalities || "").toLowerCase();
      if (modality) {
        if (modality.includes("image") || modality.includes("vision") || modality.includes("multimodal")) return true;
        if (modality.includes("text") && !modality.includes("image")) return false;
      }
      const inputMods = m.input_modalities || m.modalities?.input || m.architecture?.input_modalities;
      if (Array.isArray(inputMods)) {
        const s = inputMods.map(String).join(",").toLowerCase();
        if (s.includes("image") || s.includes("vision")) return true;
        if (s.includes("text")) return false;
      }
      const caps = m.capabilities || m.features || m.supported_modalities;
      if (Array.isArray(caps)) {
        const s = caps.map(String).join(",").toLowerCase();
        if (s.includes("image") || s.includes("vision") || s.includes("multimodal")) return true;
      }
      return void 0;
    }
    _extractTools(m) {
      if (typeof m.supports_tools === "boolean") return m.supports_tools;
      if (typeof m.supportsTools === "boolean") return m.supportsTools;
      if (typeof m.tools === "boolean") return m.tools;
      const params = m.supported_parameters || m.supported_features || m.features;
      if (Array.isArray(params)) {
        const s = params.map(String).join(",").toLowerCase();
        if (s.includes("tool") || s.includes("function")) return true;
        if (s.length) return false;
      }
      const caps = m.capabilities;
      if (Array.isArray(caps)) {
        const s = caps.map(String).join(",").toLowerCase();
        if (s.includes("tool") || s.includes("function")) return true;
      }
      return void 0;
    }
  };

  // src/services/ThemeEngine.js
  var SX_THEME_PRESETS = [
    {
      id: "sx-matrix",
      name: "SX Cyber Matrix",
      background: "#030805",
      foreground: "#E2FDF0",
      primary: "#00FF87",
      tagColor: "#00ff87"
    },
    {
      id: "sx-synthwave",
      name: "SX Quantum Synthwave",
      background: "#090614",
      foreground: "#FDF2F8",
      primary: "#FF2A85",
      tagColor: "#ff2a85"
    },
    {
      id: "sx-signature",
      name: "SX Development Pro",
      background: "#060B12",
      foreground: "#F0F9FF",
      primary: "#00E5FF",
      tagColor: "#00e5ff"
    },
    {
      id: "sx-cyberpunk",
      name: "SX Cyberpunk Neon",
      background: "#08090E",
      foreground: "#F1F5F9",
      primary: "#A855F7",
      tagColor: "#a855f7"
    },
    {
      id: "sx-oled",
      name: "SX OLED Pure Black",
      background: "#000000",
      foreground: "#F8FAFC",
      primary: "#10B981",
      tagColor: "#10b981"
    },
    {
      id: "sx-crimson",
      name: "SX Crimson Eclipse",
      background: "#11090D",
      foreground: "#FFF1F2",
      primary: "#F43F5E",
      tagColor: "#f43f5e"
    },
    {
      id: "sx-amber",
      name: "SX Sunset Amber",
      background: "#12100C",
      foreground: "#FEF3C7",
      primary: "#F59E0B",
      tagColor: "#f59e0b"
    },
    {
      id: "sx-arctic",
      name: "SX Arctic Glacier",
      background: "#0A1118",
      foreground: "#E6F4F8",
      primary: "#06B6D4",
      tagColor: "#06b6d4"
    },
    {
      id: "sx-amethyst",
      name: "SX Royal Amethyst",
      background: "#0F0B18",
      foreground: "#F3E8FF",
      primary: "#C084FC",
      tagColor: "#c084fc"
    },
    {
      id: "sx-tokyo",
      name: "SX Tokyo Neon",
      background: "#13141F",
      foreground: "#C0CAF5",
      primary: "#7AA2F7",
      tagColor: "#7aa2f7"
    }
  ];
  var ThemeEngine = class {
    constructor(eventBus, storageService, networkClient, logger) {
      this.bus = eventBus;
      this.storage = storageService;
      this.network = networkClient;
      this.logger = logger;
      this.currentThemeId = null;
      this._isApplying = false;
    }
    init() {
      this.patchNativeThemeDict();
      setInterval(() => this.patchNativeThemeDict(), 1e3);
      this.bus.on("storage:get-theme", () => {
        this.patchNativeThemeDict();
      });
      this.bus.on("storage:theme-preset-changed", ({ val }) => {
        const found = SX_THEME_PRESETS.find((p) => p.name === val || p.id === val);
        if (found) {
          this.storage.silentSetItem("sx_active_theme_preset", found.id);
          if (this.currentThemeId !== found.id) {
            this.applyPreset(found, false);
          }
        } else {
          this.storage.silentSetItem("sx_active_theme_preset", "");
          this.deactivateSXEffects();
        }
      });
      setTimeout(() => {
        try {
          const savedId = localStorage.getItem("sx_active_theme_preset") || "";
          const darkVal = localStorage.getItem("theme-preset-dark") || "";
          const savedPreset = savedId && SX_THEME_PRESETS.find((p) => p.id === savedId);
          let foundInitial = null;
          if (savedPreset && darkVal !== savedPreset.name) {
            foundInitial = savedPreset;
          } else {
            foundInitial = SX_THEME_PRESETS.find((p) => p.name === darkVal || p.id === darkVal);
          }
          if (foundInitial) {
            this.applyPreset(foundInitial, false);
          }
        } catch (e) {
        }
      }, 150);
    }
    patchNativeThemeDict() {
      try {
        if (typeof window.F$ !== "undefined") {
          ["dark", "light"].forEach((mode) => {
            if (window.F$[mode] && !window.F$[mode].__sxPatched) {
              SX_THEME_PRESETS.forEach((p) => {
                window.F$[mode][p.name] = {
                  background: p.background,
                  foregroundOverride: p.foreground,
                  primary: p.primary
                };
              });
              window.F$[mode] = new Proxy(window.F$[mode], {
                get(target, prop) {
                  if (prop in target) return target[prop];
                  if (typeof prop === "string") {
                    const sx = SX_THEME_PRESETS.find((p) => p.name === prop || p.id === prop);
                    if (sx) return { background: sx.background, foregroundOverride: sx.foreground, primary: sx.primary };
                    return target[mode === "light" ? "Default Light" : "Default Dark"] || Object.values(target)[0];
                  }
                  return target[prop];
                }
              });
              Object.defineProperty(window.F$[mode], "__sxPatched", {
                value: true,
                enumerable: false,
                configurable: true,
                writable: true
              });
            }
          });
        }
      } catch (e) {
      }
    }
    applyPreset(presetOrId, saveToServer = true) {
      try {
        const preset = typeof presetOrId === "string" ? SX_THEME_PRESETS.find((p) => p.id === presetOrId || p.name === presetOrId) || SX_THEME_PRESETS[0] : presetOrId;
        if (!preset) return;
        if (this._isApplying) return;
        this._isApplying = true;
        try {
          this.currentThemeId = preset.id;
          window.__sxCurrentThemeId = preset.id;
          this.patchNativeThemeDict();
          this.storage.silentSetItem("sx_active_theme_preset", preset.id);
          this.storage.silentSetItem("theme-preset-dark", preset.name);
          const rgbStr = this._hexToRgbStr(preset.primary);
          const provider = this._getAntigravityCustomThemeSeedsProvider();
          if (provider && typeof provider.pushUpdate === "function") {
            const curState = provider.getState() || {};
            const curDark = curState.dark || {};
            if (curDark.background !== preset.background || curDark.foregroundOverride !== preset.foreground || curDark.primary !== preset.primary) {
              provider.pushUpdate({
                ...curState,
                dark: {
                  $typeName: "jetbox_state_pb.CustomThemeSeeds",
                  background: preset.background,
                  foregroundOverride: preset.foreground,
                  primary: preset.primary
                }
              });
            }
          }
          const root = document.documentElement;
          if (root && root.style) {
            root.style.setProperty("--background", preset.background);
            root.style.setProperty("--foreground", preset.foreground);
            root.style.setProperty("--primary", preset.primary);
            root.style.setProperty("--sidebar-background", preset.background);
            root.style.setProperty("--sx-accent-rgb", rgbStr);
          }
          if (document.body) {
            const bStyle = document.body.style;
            bStyle.setProperty("--syntax-comment", "#64748B");
            bStyle.setProperty("--syntax-punctuation", preset.foreground);
            bStyle.setProperty("--syntax-property", preset.primary);
            bStyle.setProperty("--syntax-tag", preset.tagColor || preset.primary);
            bStyle.setProperty("--syntax-constant", "#F59E0B");
            bStyle.setProperty("--syntax-number", "#F59E0B");
            bStyle.setProperty("--syntax-string", "#10B981");
            bStyle.setProperty("--syntax-attr-name", preset.primary);
            bStyle.setProperty("--syntax-builtin", "#06B6D4");
            bStyle.setProperty("--syntax-operator", preset.foreground);
            bStyle.setProperty("--syntax-variable", preset.foreground);
            bStyle.setProperty("--syntax-attr-value", "#10B981");
            bStyle.setProperty("--syntax-keyword", preset.primary);
            bStyle.setProperty("--syntax-function", "#38BDF8");
          }
          document.body?.classList.add("sx-theme-active");
          document.body?.setAttribute("data-sx-preset", preset.id);
          document.documentElement?.classList.add("sx-theme-active");
          let styleEl = document.getElementById("sx-theme-engine-styles");
          if (!styleEl) {
            styleEl = document.createElement("style");
            styleEl.id = "sx-theme-engine-styles";
            const target = document.head || document.documentElement;
            if (target) target.appendChild(styleEl);
          }
          if (styleEl) styleEl.textContent = this._getThemeCSS(preset, rgbStr);
          const d = document.querySelector('[role="dialog"]');
          if (d) {
            const darkH3 = Array.from(d.querySelectorAll("*")).find((el) => el.children.length === 0 && el.textContent.trim() === "Dark Theme");
            if (darkH3) {
              const card = darkH3.closest(".border") || darkH3.parentElement.parentElement;
              const comboBtn = card?.querySelector('button[role="combobox"] span');
              if (comboBtn) comboBtn.innerText = preset.name;
            }
          }
          if (saveToServer) {
            this.network.saveTheme({
              background: preset.background,
              foregroundOverride: preset.foreground,
              primary: preset.primary
            });
          }
          this.bus.emit("theme:applied", preset);
        } finally {
          this._isApplying = false;
        }
      } catch (e) {
        this.logger.error("ThemeEngine", "Error applying theme", e);
        this._isApplying = false;
      }
    }
    deactivateSXEffects() {
      this.currentThemeId = null;
      window.__sxCurrentThemeId = null;
      try {
        if (document.body) {
          document.body.classList.remove("sx-theme-active");
          document.body.removeAttribute("data-sx-preset");
        }
        if (document.documentElement) {
          document.documentElement.classList.remove("sx-theme-active");
        }
        const styleEl = document.getElementById("sx-theme-engine-styles");
        if (styleEl) styleEl.remove();
      } catch (e) {
      }
    }
    _hexToRgbStr(hex) {
      if (!hex) return "56, 189, 248";
      let c = hex.replace("#", "");
      if (c.length === 3) c = c.split("").map((x) => x + x).join("");
      const num = parseInt(c, 16);
      return `${num >> 16 & 255}, ${num >> 8 & 255}, ${num & 255}`;
    }
    _getAntigravityCustomThemeSeedsProvider() {
      try {
        let walk = function(fiber) {
          if (!fiber || provider) return;
          if (fiber.memoizedProps?.value?.customThemeSeedsProvider) {
            provider = fiber.memoizedProps.value.customThemeSeedsProvider;
            return;
          }
          walk(fiber.child);
          walk(fiber.sibling);
        };
        const all = Array.from(document.querySelectorAll("*"));
        const elWithFiber = all.find((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber")));
        if (!elWithFiber) return null;
        const fiberKey = Object.keys(elWithFiber).find((k) => k.startsWith("__reactFiber"));
        let rootFiber = elWithFiber[fiberKey];
        while (rootFiber && rootFiber.return) rootFiber = rootFiber.return;
        let provider = null;
        walk(rootFiber);
        return provider;
      } catch (e) {
        return null;
      }
    }
    _getThemeCSS(preset, rgbStr) {
      return `
            body.sx-theme-active, html.sx-theme-active {
                --background: ${preset.background} !important;
                --foreground: ${preset.foreground} !important;
                --primary: ${preset.primary} !important;
                --sidebar-background: ${preset.background} !important;
                --sx-accent-rgb: ${rgbStr} !important;
            }
            body.sx-theme-active {
                background-color: ${preset.background} !important;
                color: ${preset.foreground} !important;
            }
            body.sx-theme-active textarea {
                color: ${preset.foreground} !important;
                caret-color: ${preset.primary} !important;
            }
            body.sx-theme-active div[class*="bg-background"],
            body.sx-theme-active main,
            body.sx-theme-active nav,
            body.sx-theme-active aside {
                background-color: ${preset.background} !important;
            }

            /* SX Atmospheric Lighting Field (Expanded, Softer Luminous Glow) */
            body.sx-theme-active .relative.z-0.flex-1.flex.min-h-0.h-full {
                position: relative;
                overflow: hidden;
                background-color: var(--background) !important;
                background-image: 
                    radial-gradient(ellipse 130% 90% at 50% 15%, rgba(var(--sx-accent-rgb), 0.05) 0%, transparent 80%),
                    radial-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px) !important;
                background-size: 100% 100%, 28px 28px !important;
            }
            body.sx-theme-active .relative.z-0.flex-1.flex.min-h-0.h-full::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 100%;
                max-height: 1050px;
                background: radial-gradient(ellipse 110% 800px at 50% -2%, rgba(var(--sx-accent-rgb), 0.16) 0%, rgba(var(--sx-accent-rgb), 0.08) 35%, rgba(var(--sx-accent-rgb), 0.03) 65%, transparent 95%);
                pointer-events: none;
                z-index: 0;
            }

            /* Transparent Sticky Chat Message Headers (Prevents dark block artifacts) */
            body.sx-theme-active div.sticky.top-0 {
                background: transparent !important;
            }
            body.sx-theme-active div.sticky.top-0::after {
                display: none !important;
            }

            /* Message Actions Container (Eliminates dark box and dark shadow bleed) */
            body.sx-theme-active [class*="group/user-input-step"] .user-input-buttons-shadow,
            body.sx-theme-active [data-testid="user-input-step"] .user-input-buttons-shadow {
                box-shadow: none !important;
            }

            /* Assistant Message Timestamp & Performance Metrics */
            body.sx-theme-active .flex.w-full.items-start.gap-1 > .grow {
                opacity: 0.85 !important;
                transition: opacity 0.15s ease;
            }
            body.sx-theme-active .flex.w-full.items-start.gap-1:hover > .grow {
                opacity: 1 !important;
            }
            .sx-msg-perf-metrics {
                user-select: none;
                cursor: default;
                display: inline-flex;
                align-items: center;
                gap: 5px;
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                font-size: 11px;
                margin-left: 8px;
                line-height: 1;
            }

            /* Floating Prompt Card Glassmorphism & Cyber Glow */
            body.sx-theme-active .bg-card.rounded-\\[calc\\(theme\\(borderRadius\\.2xl\\)-1px\\)\\] {
                background: rgba(6, 10, 16, 0.74) !important;
                backdrop-filter: blur(20px) saturate(180%) !important;
                border: 1px solid rgba(var(--sx-accent-rgb), 0.28) !important;
                box-shadow: 0 12px 36px -4px rgba(0, 0, 0, 0.65), 0 0 20px -2px rgba(var(--sx-accent-rgb), 0.18) !important;
                transition: border-color 0.2s ease, box-shadow 0.2s ease;
            }
            body.sx-theme-active .bg-card.rounded-\\[calc\\(theme\\(borderRadius\\.2xl\\)-1px\\)\\]:focus-within {
                border-color: var(--primary) !important;
                box-shadow: 0 12px 36px -4px rgba(0, 0, 0, 0.75), 0 0 28px -2px rgba(var(--sx-accent-rgb), 0.35) !important;
            }

            /* Sleek Cyber Scrollbars */
            body.sx-theme-active *::-webkit-scrollbar {
                width: 6px;
                height: 6px;
            }
            body.sx-theme-active *::-webkit-scrollbar-track {
                background: transparent;
            }
            body.sx-theme-active *::-webkit-scrollbar-thumb {
                background: rgba(var(--sx-accent-rgb), 0.25);
                border-radius: 9999px;
            }
            body.sx-theme-active *::-webkit-scrollbar-thumb:hover {
                background: var(--primary);
                box-shadow: 0 0 10px var(--primary);
            }
            body.sx-theme-active ::-webkit-scrollbar-button,
            body.sx-theme-active ::-webkit-scrollbar-button:single-button,
            body.sx-theme-active ::-webkit-scrollbar-button:start:decrement,
            body.sx-theme-active ::-webkit-scrollbar-button:end:increment,
            body.sx-theme-active ::-webkit-scrollbar-button:vertical:start:decrement,
            body.sx-theme-active ::-webkit-scrollbar-button:vertical:end:increment {
                display: block !important;
                height: 0px !important;
                width: 0px !important;
                border-width: 0px !important;
                border: none !important;
                background: transparent !important;
            }
            body.sx-theme-active ::-webkit-scrollbar-corner {
                background: transparent !important;
            }

            /* Developer Code Blocks Obsidian Glass (Only standalone markdown blocks, NOT terminal cards) */
            body.sx-theme-active .prose pre,
            body.sx-theme-active pre:not([class*="group/run-command"] pre):not(.group\\/run-command pre) {
                border: 1px solid rgba(var(--sx-accent-rgb), 0.20) !important;
                background: rgba(3, 7, 12, 0.65) !important;
                box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4) !important;
                border-radius: 8px !important;
            }

            /* Unified Run Command Terminal Card */
            body.sx-theme-active [class*="group/run-command"],
            body.sx-theme-active .group\\/run-command {
                border: 1px solid rgba(255, 255, 255, 0.08) !important;
                background: rgba(10, 13, 20, 0.88) !important;
                backdrop-filter: blur(16px) !important;
                border-radius: 8px !important;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5) !important;
                overflow: hidden !important;
                margin-top: 4px !important;
                margin-bottom: 4px !important;
            }

            /* Command header */
            body.sx-theme-active [class*="group/run-command"] > div:first-child,
            body.sx-theme-active .group\\/run-command > div:first-child {
                background: rgba(255, 255, 255, 0.02) !important;
                padding: 2px 4px !important;
            }

            /* Reset inner pre inside command blocks */
            body.sx-theme-active [class*="group/run-command"] pre,
            body.sx-theme-active .group\\/run-command pre {
                border: none !important;
                background: transparent !important;
                box-shadow: none !important;
                border-radius: 0 !important;
                margin: 0 !important;
                padding: 6px 10px !important;
                scrollbar-width: thin !important;
                scrollbar-color: rgba(255, 255, 255, 0.18) transparent !important;
            }

            /* Clean divider line */
            body.sx-theme-active [class*="group/run-command"] .border-t,
            body.sx-theme-active .group\\/run-command .border-t {
                border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
                padding-top: 0 !important;
                margin-top: 0 !important;
            }

            /* Primary Buttons Glow */
            body.sx-theme-active button.bg-primary {
                box-shadow: 0 0 14px rgba(var(--sx-accent-rgb), 0.4) !important;
            }

            /* Active Sidebar Conversation */
            body.sx-theme-active .bg-secondary:not(button):not(input) {
                border-left: 2px solid var(--primary);
            }

            /* Symmetrical View Usage and Quota Submenu Alignment */
            [role="menu"][data-nested] {
                width: 320px !important;
                border: 1px solid rgba(255, 255, 255, 0.1) !important;
                box-shadow: 0 12px 36px rgba(0, 0, 0, 0.5) !important;
            }
            [role="menu"][data-nested] [role="group"] {
                gap: 0 !important;
            }
            [role="menu"][data-nested] [role="presentation"] {
                padding: 6px 10px !important;
                font-size: 11px !important;
                font-weight: 600 !important;
                color: rgba(255, 255, 255, 0.45) !important;
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                text-transform: uppercase !important;
                letter-spacing: 0.6px !important;
            }
            [role="menu"][data-nested] .flex.items-center.justify-between.px-2 {
                border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
                padding: 6px 10px !important;
                margin-top: 0 !important;
            }
            [role="menu"][data-nested] span.text-foreground.truncate {
                font-size: 11px !important;
                font-weight: 600 !important;
                color: rgba(255, 255, 255, 0.9) !important;
            }
            [role="menu"][data-nested] span.text-xs.text-foreground {
                font-size: 11px !important;
                font-weight: 600 !important;
                font-family: ui-monospace, monospace !important;
                color: #a3e635 !important;
            }
        `;
    }
  };

  // src/services/ModelManager.js
  var SX_PRESETS = [
    { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", protocol: "openai", modelsPath: "/models" },
    { id: "kilo", name: "Kilo AI", baseUrl: "https://api.kilo.ai/v1", protocol: "openai", modelsPath: "/models" },
    { id: "kira", name: "Kira AI", baseUrl: "https://api.kira.ai/v1", protocol: "openai", modelsPath: "/models" },
    { id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com", protocol: "anthropic", modelsPath: "/v1/models" },
    { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", protocol: "openai", modelsPath: "/models" },
    { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", protocol: "openai", modelsPath: "/models" },
    { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", protocol: "openai", modelsPath: "/models" },
    { id: "mistral", name: "Mistral AI", baseUrl: "https://api.mistral.ai/v1", protocol: "openai", modelsPath: "/models" },
    { id: "together", name: "Together AI", baseUrl: "https://api.together.xyz/v1", protocol: "openai", modelsPath: "/models" },
    { id: "fireworks", name: "Fireworks AI", baseUrl: "https://api.fireworks.ai/inference/v1", protocol: "openai", modelsPath: "/models" },
    { id: "xai", name: "xAI (Grok)", baseUrl: "https://api.x.ai/v1", protocol: "openai", modelsPath: "/models" },
    { id: "gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", protocol: "openai", modelsPath: "/models" },
    { id: "siliconflow", name: "SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1", protocol: "openai", modelsPath: "/models" },
    { id: "qwen", name: "Qwen / DashScope", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", protocol: "openai", modelsPath: "/models" },
    { id: "cohere", name: "Cohere", baseUrl: "https://api.cohere.com/v2", protocol: "openai", modelsPath: "/models" },
    { id: "perplexity", name: "Perplexity", baseUrl: "https://api.perplexity.ai", protocol: "openai", modelsPath: "/models" },
    { id: "ollama", name: "Ollama (Local)", baseUrl: "http://127.0.0.1:11434/v1", protocol: "openai", modelsPath: "/models" },
    { id: "lmstudio", name: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", protocol: "openai", modelsPath: "/models" },
    { id: "custom", name: "Custom Endpoint", baseUrl: "", protocol: "openai", modelsPath: "/models" }
  ];
  var ALLOWED_TIERS = [
    "TEAMS_TIER_PRO",
    "TEAMS_TIER_TEAMS",
    "TEAMS_TIER_ENTERPRISE_SELF_HOSTED",
    "TEAMS_TIER_ENTERPRISE_SAAS",
    "TEAMS_TIER_HYBRID",
    "TEAMS_TIER_PRO_ULTIMATE"
  ];
  var ModelManager = class {
    constructor(eventBus, stateStore, networkClient, logger, metaResolver = null) {
      this.bus = eventBus;
      this.state = stateStore;
      this.network = networkClient;
      this.logger = logger;
      this.metaResolver = metaResolver;
    }
    init() {
      this.bus.on("state:providers-updated", () => {
        this.network.syncConfig(this.state.getProviders(), this.state.getModels());
      });
      this.bus.on("state:models-updated", () => {
        this.network.syncConfig(this.state.getProviders(), this.state.getModels());
      });
    }
    getProviderMeta(providerIdOrName) {
      let prov = null;
      try {
        const providers = this.state.getProviders();
        if (typeof providerIdOrName === "string") {
          prov = providers.find((p) => p.id === providerIdOrName || p.name && p.name.toLowerCase() === providerIdOrName.toLowerCase());
        } else if (providerIdOrName && typeof providerIdOrName === "object") {
          prov = providerIdOrName;
        }
      } catch (e) {
      }
      const preset = SX_PRESETS.find((p) => p.id === (prov?.preset || prov?.id));
      const finalName = prov?.name || preset?.name || (typeof providerIdOrName === "string" ? providerIdOrName : "Custom");
      const finalLower = finalName.toLowerCase();
      let iconSvg = "";
      let color = "#38bdf8";
      if (finalLower.includes("openrouter")) {
        color = "#06b6d4";
        iconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`;
      } else if (finalLower.includes("kilo") || finalLower.includes("kira")) {
        color = "#f97316";
        iconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 4h4v16H4zM16 4l-6 8 6 8h4.5l-6-8 6-8z"/></svg>`;
      } else if (finalLower.includes("anthropic") || finalLower.includes("claude")) {
        color = "#a855f7";
        iconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M14.5 3h-5l-6 18h4.5l1.2-3.8h5.6l1.2 3.8h4.5L14.5 3zm-4.1 11.2l1.6-5.2 1.6 5.2h-3.2z"/></svg>`;
      } else if (finalLower.includes("openai") || finalLower.includes("gpt")) {
        color = "#10b981";
        iconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>`;
      } else if (finalLower.includes("deepseek")) {
        color = "#3b82f6";
        iconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.5h-2v-2h2v2zm0-4h-2V7h2v5.5z"/></svg>`;
      } else {
        color = "#06b6d4";
        iconSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
      }
      return { name: finalName, color, iconSvg };
    }
    formatContextSize(num) {
      if (!num) return "";
      const n = Number(num);
      if (isNaN(n) || n <= 0) return "";
      if (n >= 1048576) return Math.round(n / 1048576) + "M";
      if (n >= 1e3) return Math.round(n / 1024) + "k";
      return String(n);
    }
    isVisionModel(m) {
      if (typeof m.supportsImages === "boolean") return m.supportsImages;
      const str = `${m.modelId || ""} ${m.name || ""} ${m.id || ""}`.toLowerCase();
      if (/(?:vl|vision|omni|4o|gemini|gemma|inkling|nex-n|pixtral|llava|paligemma|qwen.*vl|qwen3\.8)/i.test(str)) {
        if (/(?:code|sante|fin|super|ultra|lightning)/i.test(str) && !/(?:vl|vision|omni)/i.test(str)) {
          return false;
        }
        return true;
      }
      return false;
    }
    supportsTools(m) {
      if (typeof m.supportsTools === "boolean") return m.supportsTools;
      const str = `${m.modelId || ""} ${m.name || ""}`.toLowerCase();
      if (/(?:no[-_]?tools?|text[-_]?only|completion)/.test(str)) return false;
      return true;
    }
    buildSXModelConfig(m, index = 0) {
      const slotNum = Number(index) + 1;
      const placeholderEnum = "MODEL_PLACEHOLDER_M" + slotNum;
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
        quotaInfo: { remainingFraction: 1, resetTime: "2030-12-31T23:59:59Z" },
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
        contextLength: m.contextLength || void 0
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
          quotaInfo: { remainingFraction: 1, resetTime: "2030-12-31T23:59:59Z" },
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
          groups: [{ groupName: "AI Models", modelLabels: sxModels.map((m) => m.name) }]
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
        if (m && m[1]) return "conv_" + m[1];
      } catch (e) {
      }
      try {
        const m2 = window.location.href.match(/(?:\/c\/|\/conversation[s]?\/)([a-zA-Z0-9_-]+)/);
        if (m2 && m2[1]) return "conv_" + m2[1];
      } catch (e) {
      }
      try {
        const selRow = document.querySelector('[data-testid="conversation-row-sidebar"][data-selected="true"]');
        if (selRow) {
          const id = selRow.getAttribute("data-cascade-id") || selRow.getAttribute("data-conversation-id");
          if (id) return "conv_" + id;
        }
      } catch (e) {
      }
      try {
        const activeLink = document.querySelector('a[href^="/c/"][aria-current], a[href^="/c/"].active');
        if (activeLink) {
          const m3 = activeLink.getAttribute("href").match(/\/c\/([a-zA-Z0-9_-]+)/);
          if (m3 && m3[1]) return "conv_" + m3[1];
        }
      } catch (e) {
      }
      return "conv_new";
    }
    getActiveModelForConversation(convKey = null) {
      const key = convKey || this.getActiveConversationKey();
      let modelId = null;
      if (key && key !== "conv_new") {
        modelId = localStorage.getItem("sx_active_model_" + key);
      }
      if (!modelId) {
        modelId = localStorage.getItem("sx_last_used_model_id") || localStorage.getItem("sx_active_model_id");
      }
      const sxModels = this.state.getModels();
      if (sxModels.length > 0) {
        const found = sxModels.find((m) => m.id === modelId);
        return found ? found.id : sxModels[0].id;
      }
      return modelId;
    }
    setActiveModelForConversation(modelId, convKey = null, explicitUserChoice = false) {
      if (!modelId) return;
      const key = convKey || this.getActiveConversationKey();
      if (explicitUserChoice && key && key !== "conv_new") {
        localStorage.setItem("sx_active_model_" + key, modelId);
      }
      localStorage.setItem("sx_last_used_model_id", modelId);
      localStorage.setItem("sx_active_model_id", modelId);
      this.notifyActiveModel(modelId, false, key, explicitUserChoice);
    }
    notifyActiveModel(modelId, forceGlobal = false, specificConvKey = null, persistConv = false) {
      if (!modelId) return;
      const convKey = specificConvKey || this.getActiveConversationKey();
      this.state.setActiveModelId(modelId, forceGlobal ? null : convKey, persistConv);
      this.network.setActiveModel(modelId, forceGlobal ? "conv_global" : convKey);
    }
  };

  // src/services/QuotaMonitor.js
  var QuotaMonitor = class {
    constructor(networkClient, modelManager, logger) {
      this.network = networkClient;
      this.models = modelManager;
      this.logger = logger;
      this._contextDetailsCache = {};
      this._inFlightFetches = /* @__PURE__ */ new Map();
      this._progressInFlight = null;
      this._streamActive = false;
      this._lastStreamTs = 0;
      this._sentCache = {};
      this._progressFailTs = 0;
      this._detailsFailTs = {};
      this._lastGen = null;
      this._lastPollTs = 0;
    }
    _fmt(n) {
      if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
      if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
      return String(Math.round(n));
    }
    init() {
      document.addEventListener("click", (e) => {
        const pop = document.getElementById("sx-context-popover");
        if (pop && !pop.contains(e.target) && !e.target.closest("#sx-context-btn")) {
          pop.remove();
          const btn = document.getElementById("sx-context-btn");
          if (btn) btn.classList.remove("sx-active");
        }
      });
      ["input", "keyup", "change", "paste"].forEach((evName) => {
        document.addEventListener(evName, (e) => {
          if (e.target && e.target.closest && e.target.closest('[contenteditable="true"], textarea, div.cursor-text')) {
            this.updateContextButtonUI();
          }
        }, true);
      });
    }
    updateContextRing(metrics) {
      const btn = document.getElementById("sx-context-btn");
      if (!btn || !metrics) return;
      if (metrics.tooltip) btn.title = metrics.tooltip;
      const circ = 40.84;
      const totalUsed = metrics.totalUsed || 0;
      const pctExact = metrics.percentExact || 0;
      let dash = 0;
      if (totalUsed > 0) {
        dash = Math.min(circ, Math.max(0.85, pctExact / 100 * circ));
      }
      let color = "#38bdf8";
      if (pctExact > 85) color = "#f43f5e";
      else if (pctExact > 60) color = "#fbbf24";
      let svg = btn.querySelector("svg.sx-ring-svg");
      if (!svg) {
        btn.innerHTML = `
                <svg class="sx-ring-svg" width="18" height="18" viewBox="0 0 20 20" style="display:block;pointer-events:none;transform:rotate(-90deg);">
                    <circle cx="10" cy="10" r="6.5" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2" />
                    <circle class="sx-ring-progress" cx="10" cy="10" r="6.5" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"
                        stroke-dasharray="${dash.toFixed(2)} ${circ.toFixed(2)}"
                        stroke-dashoffset="0"
                        style="transition: stroke-dasharray 0.12s ease-out, stroke 0.2s ease;" />
                </svg>
            `;
      } else {
        const prog = svg.querySelector(".sx-ring-progress");
        if (prog) {
          prog.setAttribute("stroke-dasharray", `${dash.toFixed(2)} ${circ.toFixed(2)}`);
          prog.setAttribute("stroke", color);
        }
      }
    }
    updateContextButtonUI() {
      const btn = document.getElementById("sx-context-btn");
      if (!btn) return;
      const sxModels = this.models.state.getModels();
      const activeConvKey = this.models.getActiveConversationKey();
      const activeId = this.models.getActiveModelForConversation(activeConvKey);
      const activeM = sxModels.find((m) => m.id === activeId) || sxModels[0];
      const cleanConvId = (activeConvKey || "").replace(/^conv_/, "");
      const cacheKey = (cleanConvId || "new") + "_" + (activeM?.id || "");
      const metrics = this.calculateLiveContextMetrics(cleanConvId, activeM);
      this.updateContextRing(metrics);
      const pop = document.getElementById("sx-context-popover");
      if (pop && pop.isConnected) {
        if (pop.dataset.convKey && pop.dataset.convKey !== cacheKey) {
          pop.dataset.convKey = cacheKey;
          this.refreshContextDetails(cleanConvId, activeM);
          this.refreshSentEstimate(cleanConvId, activeM?.id);
        } else {
          pop.dataset.convKey = cacheKey;
          const currentData = this._contextDetailsCache[cacheKey]?.data;
          if (currentData) {
            this.renderPopoverDetails(pop, currentData, metrics);
          }
        }
      }
      const isFresh = !cleanConvId || cleanConvId === "new" || cleanConvId === "draft";
      if (!isFresh) {
        const cached = this._contextDetailsCache[cacheKey];
        const failTs = this._detailsFailTs[cacheKey] || 0;
        const isStale = (!cached || Date.now() - (cached._time || 0) > 12e3) && Date.now() - failTs > 3e4;
        if (isStale) {
          this.refreshContextDetails(cleanConvId, activeM);
        }
        const sentKey = "sent_" + cleanConvId;
        const sentCached = this._sentCache[sentKey];
        if (!sentCached || Date.now() - (sentCached._time || 0) > 3e4) {
          this.refreshSentEstimate(cleanConvId, activeM?.id);
        }
      }
      const wantLive = pop && pop.isConnected || this._streamActive || Date.now() - (this._lastStreamTs || 0) < 45e3;
      const bgPollDue = !isFresh && Date.now() - (this._lastPollTs || 0) > 5e3;
      if (!this._progressInFlight && (wantLive || bgPollDue) && !isFresh) {
        this._lastPollTs = Date.now();
        this._progressInFlight = this.fetchStreamProgress(cleanConvId).then((p) => {
          this._progressInFlight = null;
          if (!p) {
            this._streamActive = false;
            return;
          }
          this._streamActive = !!p.streaming;
          const gen = p.genTokens || 0;
          if (gen > 50) {
            this._lastGen = { tokens: gen, ts: Date.now() };
            if (p.streaming) this._lastStreamTs = Date.now();
          } else if (!p.streaming) {
            this._streamActive = false;
          }
        }).catch(() => {
          this._progressInFlight = null;
          this._streamActive = false;
        });
      }
    }
    async refreshContextDetails(cleanConvId, targetModel) {
      if (!cleanConvId || cleanConvId === "new" || cleanConvId === "draft") return null;
      const cacheKey = cleanConvId + "_" + (targetModel?.id || "");
      if (this._inFlightFetches.has(cacheKey)) {
        return this._inFlightFetches.get(cacheKey);
      }
      const promise = (async () => {
        try {
          const data = await this.network.fetchContextDetails(cleanConvId, targetModel?.id);
          if (data && data.ok) {
            this._contextDetailsCache[cacheKey] = { data, _time: Date.now() };
            delete this._detailsFailTs[cacheKey];
            if (data.detectedModelId && cleanConvId) {
              const cKey = "conv_" + cleanConvId;
              if (!localStorage.getItem("sx_active_model_" + cKey)) {
                localStorage.setItem("sx_active_model_" + cKey, data.detectedModelId);
              }
            }
            const curConvKey = this.models.getActiveConversationKey();
            const curClean = (curConvKey || "").replace(/^conv_/, "");
            if (curClean === cleanConvId) {
              const updatedMetrics = this.calculateLiveContextMetrics(cleanConvId, targetModel);
              this.updateContextRing(updatedMetrics);
              const pop = document.getElementById("sx-context-popover");
              if (pop && pop.isConnected) {
                this.renderPopoverDetails(pop, data, updatedMetrics);
              }
            }
            return data;
          }
          this._detailsFailTs[cacheKey] = Date.now();
        } catch (e) {
          this._detailsFailTs[cacheKey] = Date.now();
          this.logger?.warn("QuotaMonitor", "Failed to refresh context details", e);
        } finally {
          this._inFlightFetches.delete(cacheKey);
        }
        return null;
      })();
      this._inFlightFetches.set(cacheKey, promise);
      return promise;
    }
    invalidateCacheAndRefresh(convKey) {
      const cleanConvId = (convKey || this.models.getActiveConversationKey() || "").replace(/^conv_/, "");
      if (!cleanConvId || cleanConvId === "new") return;
      Object.keys(this._contextDetailsCache).forEach((k) => {
        if (k.startsWith(cleanConvId + "_")) {
          delete this._contextDetailsCache[k];
        }
      });
      const activeId = this.models.getActiveModelForConversation("conv_" + cleanConvId);
      const targetModel = this.models.state.getModels().find((m) => m.id === activeId);
      this.refreshContextDetails(cleanConvId, targetModel);
      this.refreshSentEstimate(cleanConvId, targetModel?.id);
    }
    getDraftPromptText() {
      try {
        const editable = document.querySelector('[contenteditable="true"], div.cursor-text[role="combobox"], textarea');
        if (editable) {
          return (editable.innerText || editable.textContent || editable.value || "").trim();
        }
      } catch (e) {
      }
      return "";
    }
    calculateLiveContextMetrics(cleanConvId, targetModel) {
      const cacheKey = (cleanConvId || "new") + "_" + (targetModel?.id || "");
      const cacheEntry = this._contextDetailsCache[cacheKey];
      const cached = cacheEntry?.data;
      let sentTok = 0;
      try {
        const sentEntry = this._sentCache["sent_" + (cleanConvId || "new")];
        const s = sentEntry?.sent;
        if (s && s.tokens > 0) {
          const sentModel = String(s.model || "");
          const curModelIds = [targetModel?.id, targetModel?.modelId].filter(Boolean).map(String);
          if (!sentModel || curModelIds.includes(sentModel) || sentModel === (targetModel?.name || "")) {
            sentTok = Number(s.tokens);
          }
        }
      } catch (e) {
      }
      const transcriptUsed = cached && !cached.isFreshChat ? cached.usedTokens : 0;
      const totalContext = cached ? cached.totalContext : targetModel?.contextLength ? Number(targetModel.contextLength) : 262144;
      const baseUsed = sentTok > 0 ? sentTok : transcriptUsed;
      const draftText = this.getDraftPromptText();
      const draftChars = draftText.length;
      const draftTokens = draftChars > 0 ? Math.ceil(draftChars / 3.2) : 0;
      let genTokens = 0;
      try {
        if (this._lastGen && Date.now() - this._lastGen.ts < 15e3 && this._lastGen.tokens > 50) {
          genTokens = this._lastGen.tokens;
        }
      } catch (e) {
      }
      const totalUsed = baseUsed + draftTokens + genTokens;
      const isFresh = baseUsed === 0 && draftTokens === 0 && genTokens === 0;
      const pct = isFresh ? 0 : Math.min(100, totalUsed / totalContext * 100);
      function fmt(n) {
        if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
        if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
        return String(Math.round(n));
      }
      let tooltip = "";
      const percentDisplay = pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`;
      const transcriptNote = sentTok > 0 && transcriptUsed > totalUsed ? ` \u2022 transkript ${fmt(transcriptUsed)}` : "";
      const genSuffix = genTokens > 0 ? ` [+${fmt(genTokens)} \xFCretiliyor]` : "";
      if (isFresh) {
        tooltip = `Context: Yeni Sohbet (0 / ${fmt(totalContext)})`;
      } else if (draftTokens > 0) {
        tooltip = `Context: ${fmt(totalUsed)} / ${fmt(totalContext)} (${percentDisplay}) [+${fmt(draftTokens)} taslak]${genSuffix}${transcriptNote}`;
      } else {
        tooltip = `Context: ${fmt(totalUsed)} / ${fmt(totalContext)} (${percentDisplay})${genSuffix}${transcriptNote}`;
      }
      return {
        isFresh,
        draftTokens,
        genTokens,
        totalUsed,
        totalContext,
        totalContextFormatted: fmt(totalContext),
        usedTokensFormatted: fmt(totalUsed),
        percentNum: Math.round(pct),
        percentExact: pct,
        percentDisplay,
        tooltip,
        baseUsed,
        cachedData: cached,
        cacheAgeMs: cacheEntry ? Date.now() - (cacheEntry._time || 0) : null,
        convId: cleanConvId || null,
        sentBased: sentTok > 0,
        transcriptUsed
      };
    }
    async fetchStreamProgress(cleanConvId) {
      if (!cleanConvId || cleanConvId === "new" || cleanConvId === "draft") return null;
      if (this._progressFailTs && Date.now() - this._progressFailTs < 6e4) return null;
      try {
        const r = await this.network.get(`/get-stream-progress?convId=${encodeURIComponent(cleanConvId)}`);
        if (r && r.ok) return r;
        this._progressFailTs = Date.now();
        return null;
      } catch (e) {
        this._progressFailTs = Date.now();
        return null;
      }
    }
    /** Seconds since last streamed chunk if a stream is active, else 0. */
    streamElapsedSec() {
      try {
        if (this._streamActive && Date.now() - (this._lastStreamTs || 0) < 45e3) {
          return Math.max(0, Math.round((Date.now() - this._lastStreamTs) / 1e3));
        }
      } catch (e) {
      }
      return 0;
    }
    async refreshSentEstimate(cleanConvId, modelId) {
      if (!cleanConvId || cleanConvId === "new" || cleanConvId === "draft") return null;
      try {
        const r = await this.network.get(`/get-sent-estimate?convId=${encodeURIComponent(cleanConvId)}`);
        if (r && r.ok && r.sent) {
          this._sentCache["sent_" + cleanConvId] = { sent: r.sent, _time: Date.now() };
          return r.sent;
        }
      } catch (e) {
      }
      const fb = this.estimateSentFallback(cleanConvId, modelId);
      if (fb) {
        const sent = { ...fb, fallback: true };
        this._sentCache["sent_" + cleanConvId] = { sent, _time: Date.now() };
        return sent;
      }
      this._sentCache["sent_" + cleanConvId] = { sent: null, failed: true, _time: Date.now() };
      return null;
    }
    estimateSentFallback(cleanConvId, modelId) {
      try {
        const prefix = cleanConvId + "_";
        let data = null, keyModelId = "";
        for (const k of Object.keys(this._contextDetailsCache)) {
          if (k.startsWith(prefix) && this._contextDetailsCache[k]?.data) {
            if (modelId && k === prefix + modelId) {
              data = this._contextDetailsCache[k].data;
              keyModelId = modelId;
              break;
            }
            if (!data) {
              data = this._contextDetailsCache[k].data;
              keyModelId = k.slice(prefix.length);
            }
          }
        }
        if (!data || !data.totalContext || !(data.usedTokens > 0)) return null;
        const total = Number(data.totalContext);
        const OVERHEAD_CONST = 6e3 + 11800 + 682;
        let budget = Math.max(4e3, total - OVERHEAD_CONST - 16e3);
        let effModelId = modelId || keyModelId;
        try {
          const m = (this.models.state.getModels() || []).find((x) => x.id === effModelId);
          const mid = `${m?.modelId || ""} ${m?.name || ""}`.toLowerCase();
          if (mid.includes(":free") || mid.includes("free")) budget = Math.min(budget, 7e4);
          if (m?.modelId) effModelId = m.modelId;
        } catch (e) {
        }
        const historyPart = Math.max(0, Number(data.usedTokens) - OVERHEAD_CONST);
        const tokens = Math.round(OVERHEAD_CONST + Math.min(historyPart, budget));
        return { tokens, model: effModelId || void 0, ts: Date.now() };
      } catch (e) {
        return null;
      }
    }
    async fetchContextDetails(cleanConvId, targetModel) {
      return await this.refreshContextDetails(cleanConvId, targetModel);
    }
    toggleContextPopover(anchorEl) {
      let pop = document.getElementById("sx-context-popover");
      if (pop) {
        pop.remove();
        if (anchorEl) anchorEl.classList.remove("sx-active");
        return;
      }
      const convKey = this.models.getActiveConversationKey();
      const cleanConvId = (convKey || "").replace(/^conv_/, "");
      const activeModelId = this.models.getActiveModelForConversation(convKey);
      const targetModel = this.models.state.getModels().find((m) => m.id === activeModelId);
      if (anchorEl) anchorEl.classList.add("sx-active");
      pop = document.createElement("div");
      pop.id = "sx-context-popover";
      pop.style.cssText = `
            position: fixed;
            width: 320px;
            background: #14151b;
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 12px;
            box-shadow: 0 24px 56px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.05);
            padding: 16px;
            z-index: 100000;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #f1f5f9;
            box-sizing: border-box;
            user-select: none;
            backdrop-filter: blur(16px);
        `;
      const rect = anchorEl.getBoundingClientRect();
      const popLeft = Math.max(10, Math.min(window.innerWidth - 340, rect.left - 20));
      pop.style.left = popLeft + "px";
      pop.style.bottom = window.innerHeight - rect.top + 8 + "px";
      pop.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;" id="sx-ctx-popover-header">
                <div style="display:flex;align-items:center;gap:6px;">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                    </svg>
                    <span style="font-size:13px;color:#f8fafc;font-weight:600;letter-spacing:0.2px;">Context Window</span>
                </div>
                <div style="display:flex;align-items:center;gap:4px;">
                    <span id="sx-ctx-stat-text" style="font-size:12px;color:#94a3b8;font-family:ui-monospace,monospace;">Hesaplan\u0131yor...</span>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#64748b;margin-left:2px;"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
            </div>

            <div style="width:100%;height:6px;background:rgba(255,255,255,0.08);border-radius:999px;margin:12px 0 14px 0;overflow:hidden;position:relative;">
                <div id="sx-ctx-progress-bar" style="width:0%;height:100%;background:#38bdf8;border-radius:999px;transition:width 0.3s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s ease;"></div>
            </div>

            <div id="sx-ctx-items-list" style="display:flex;flex-direction:column;gap:9px;">
                <div style="font-size:12px;color:#64748b;text-align:center;padding:10px 0;">Y\xFCkleniyor...</div>
            </div>
        `;
      document.body.appendChild(pop);
      pop.dataset.convKey = (cleanConvId || "new") + "_" + (targetModel?.id || "");
      pop.querySelector("#sx-ctx-popover-header").onclick = () => {
        pop.remove();
        if (anchorEl) anchorEl.classList.remove("sx-active");
      };
      const liveMetrics = this.calculateLiveContextMetrics(cleanConvId, targetModel);
      const cacheKey = (cleanConvId || "new") + "_" + (targetModel?.id || "");
      const cached = this._contextDetailsCache[cacheKey]?.data;
      if (cached) {
        this.renderPopoverDetails(pop, cached, liveMetrics);
      }
      this.fetchContextDetails(cleanConvId, targetModel).then((data) => {
        if (pop.isConnected && data) {
          const updatedLive = this.calculateLiveContextMetrics(cleanConvId, targetModel);
          this.renderPopoverDetails(pop, data, updatedLive);
          this.updateContextRing(updatedLive);
        }
      });
    }
    renderPopoverDetails(pop, data, liveMetrics) {
      if (!data || !data.items) return;
      const statText = pop.querySelector("#sx-ctx-stat-text");
      const progBar = pop.querySelector("#sx-ctx-progress-bar");
      const itemsList = pop.querySelector("#sx-ctx-items-list");
      function fmt(n) {
        if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
        if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
        return String(Math.round(n));
      }
      let convLine = pop.querySelector("#sx-ctx-convline");
      if (!convLine) {
        convLine = document.createElement("div");
        convLine.id = "sx-ctx-convline";
        convLine.style.cssText = "font-size:10.5px;color:rgba(255,255,255,0.35);font-family:ui-monospace,monospace;margin:-6px 0 10px 0;";
        const bar = pop.querySelector("#sx-ctx-progress-bar")?.parentElement;
        if (bar && bar.parentElement) bar.parentElement.insertBefore(convLine, bar.nextSibling);
        else pop.appendChild(convLine);
      }
      try {
        const shortConv = String(data.convId || liveMetrics?.convId || "").slice(0, 8) || "?";
        const basisTxt = liveMetrics?.sentBased ? " \u2022 g\xF6nderilen bazl\u0131" : "";
        const trTxt = liveMetrics?.sentBased && liveMetrics?.transcriptUsed > 0 ? ` \u2022 ge\xE7mi\u015F ${fmt(liveMetrics.transcriptUsed)}` : "";
        convLine.textContent = `sohbet ${shortConv}${basisTxt}${trTxt}`;
        convLine.title = "Bu sohbete ait \xF6l\xE7\xFCm. Halka modele g\xF6nderilen boyutu g\xF6sterir; ge\xE7mi\u015F diskteki toplamd\u0131r.";
      } catch (e) {
      }
      const totalUsed = liveMetrics?.totalUsed ?? data.usedTokens;
      const pctNum = liveMetrics?.percentNum ?? data.percentNum;
      const pctExact = liveMetrics?.percentExact ?? (data.percentNum || 0);
      const pctDisplay = liveMetrics?.percentDisplay || (pctNum === 0 && totalUsed > 0 ? "<1%" : `${pctNum}%`);
      if (statText) {
        const draftSuffix = liveMetrics?.draftTokens > 0 ? ` (+${fmt(liveMetrics.draftTokens)} taslak)` : "";
        statText.innerText = `${fmt(totalUsed)} / ${data.totalContextFormatted} (${pctDisplay})${draftSuffix}`;
      }
      if (progBar) {
        const barWidth = totalUsed > 0 ? Math.max(1.5, Math.min(100, pctExact)) : 0;
        progBar.style.width = barWidth + "%";
        if (pctExact > 85) progBar.style.background = "#f43f5e";
        else if (pctExact > 60) progBar.style.background = "#fbbf24";
        else progBar.style.background = "#38bdf8";
      }
      if (itemsList) {
        let html = "";
        const itemsToRender = [...data.items];
        if (liveMetrics?.genTokens > 50) {
          const genPct = (liveMetrics.genTokens / data.totalContext * 100).toFixed(1);
          itemsToRender.unshift({
            label: "\xDCretiliyor (canl\u0131)",
            color: "#22d3ee",
            tokens: `+${fmt(liveMetrics.genTokens)}`,
            percent: `+${genPct}%`
          });
        }
        try {
          const convForSent = String(data.convId || liveMetrics?.convId || "");
          const sentEntry = convForSent ? this._sentCache["sent_" + convForSent] : null;
          if (sentEntry?.sent?.tokens > 0) {
            const sTok = sentEntry.sent.tokens;
            const sPct = (sTok / data.totalContext * 100).toFixed(1);
            itemsToRender.unshift({
              label: sentEntry.sent.fallback ? "Son g\xF6nderim (tahmini)" : "Son g\xF6nderim (modele giden)",
              color: "#2dd4bf",
              tokens: fmt(sTok),
              percent: `${sPct}%`
            });
            const hist = Array.isArray(sentEntry.sent.history) ? sentEntry.sent.history.filter(Number.isFinite) : [];
            if (hist.length >= 2) {
              const avg = Math.round(hist.reduce((a, b) => a + b, 0) / hist.length);
              const aPct = (avg / data.totalContext * 100).toFixed(1);
              itemsToRender.unshift({
                label: `Ortalama g\xF6nderim (son ${hist.length})`,
                color: "#5eead4",
                tokens: fmt(avg),
                percent: `${aPct}%`
              });
            }
          }
        } catch (e) {
        }
        if (liveMetrics?.draftTokens > 0) {
          const draftPct = (liveMetrics.draftTokens / data.totalContext * 100).toFixed(1);
          itemsToRender.unshift({
            label: "Yaz\u0131lan Taslak Mesaj",
            color: "#38bdf8",
            tokens: `+${fmt(liveMetrics.draftTokens)}`,
            percent: `+${draftPct}%`
          });
        }
        itemsToRender.forEach((item) => {
          const title = item.hint ? ` title="${item.hint}"` : "";
          html += `
                    <div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px;line-height:1.2;"${title}>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <div style="width:7px;height:7px;border-radius:50%;background:${item.color || "#38bdf8"};flex-shrink:0;"></div>
                            <span style="color:#cbd5e1;">${item.label}</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:8px;font-family:ui-monospace,monospace;font-size:12px;">
                            <span style="color:#94a3b8;">${item.tokens}</span>
                            <span style="color:#64748b;width:38px;text-align:right;">${item.percent}</span>
                        </div>
                    </div>
                `;
        });
        itemsList.innerHTML = html;
      }
    }
  };

  // src/services/PerfMonitor.js
  var PerfMonitor = class {
    constructor(networkClient, modelManager, logger) {
      this.network = networkClient;
      this.models = modelManager;
      this.logger = logger;
      this._perfStatsCache = {};
      this._latestLivePerf = null;
      this._observer = null;
      this._perfHistory = {};
    }
    init() {
      document.addEventListener("click", (e) => {
        const perfPop = document.getElementById("sx-perf-popover");
        if (perfPop && !perfPop.contains(e.target) && !e.target.closest("#sx-perf-btn")) {
          perfPop.remove();
          const pBtn = document.getElementById("sx-perf-btn");
          if (pBtn) pBtn.classList.remove("sx-active");
        }
      });
      this.setupMessageFootersObserver();
      setTimeout(() => {
        const convKey = this.models.getActiveConversationKey();
        const cleanConvId = (convKey || "").replace(/^conv_/, "");
        this.fetchPerfStats(cleanConvId);
      }, 300);
    }
    setupMessageFootersObserver() {
      try {
        if (this._observer) this._observer.disconnect();
        this._observer = new MutationObserver(() => {
          if (this._obsTimer) return;
          this._obsTimer = setTimeout(() => {
            this._obsTimer = null;
            this.injectMetricsToMessageFooters();
          }, 650);
        });
        this._observer.observe(document.body, {
          childList: true,
          subtree: true
        });
      } catch (e) {
      }
      setInterval(() => {
        this.injectMetricsToMessageFooters();
        this.updatePerfButtonUI();
      }, 1200);
    }
    /**
     * Accurate Unicode-aware token counter
     */
    countTokens(text) {
      if (!text) return 0;
      const tokens = text.match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) || [];
      let count = 0;
      for (const t of tokens) {
        if (t.length <= 4) count += 1;
        else count += Math.ceil(t.length / 3.5);
      }
      return Math.max(1, count);
    }
    /**
     * Creates a unique stable signature for a message based on its timestamp and content
     */
    getMessageSignature(footerEl) {
      if (!footerEl) return null;
      const timeText = footerEl.childNodes[0]?.textContent?.trim() || "";
      const group = footerEl.closest(".flex.flex-col.gap-0\\.5.group.w-full.scroll-mt-4") || footerEl.closest('[class*="group"]');
      const textEl = group ? group.querySelector(".prose, .break-words, .leading-relaxed, p") || group : null;
      const textSnippet = (textEl ? textEl.innerText.trim() : "").slice(0, 35);
      if (!timeText && !textSnippet) return null;
      return `${timeText}__${textSnippet}`;
    }
    /**
     * Retrieves real measured metrics for a specific message.
     * Returns null when no measurement exists — never fabricates numbers.
     */
    getStatsForMessage(footerEl, isLastMessage = false) {
      this._pruneStoredStats();
      const sig = this.getMessageSignature(footerEl);
      if (sig) {
        try {
          const saved = localStorage.getItem("sx_msg_perf_" + sig);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && parsed.measured === true) return parsed;
          }
        } catch (e) {
        }
      }
      if (isLastMessage && this._latestLivePerf) {
        const live = this._latestLivePerf;
        this._latestLivePerf = null;
        if (sig) {
          try {
            localStorage.setItem("sx_msg_perf_" + sig, JSON.stringify({ ...live, measured: true }));
          } catch (e) {
          }
        }
        return { ...live, measured: true };
      }
      return null;
    }
    /**
     * Caps stored per-message stats so localStorage can't fill up over time.
     * Throttled: runs at most once every 120s.
     */
    _pruneStoredStats() {
      try {
        const now = Date.now();
        if (!localStorage.getItem("sx_perf_purged_v2")) {
          const del = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith("sx_msg_perf_")) {
              try {
                const v = JSON.parse(localStorage.getItem(k) || "{}");
                if (!v || v.measured !== true) del.push(k);
              } catch (e) {
                del.push(k);
              }
            }
          }
          del.forEach((k) => {
            try {
              localStorage.removeItem(k);
            } catch (e) {
            }
          });
          try {
            localStorage.setItem("sx_perf_purged_v2", "1");
          } catch (e) {
          }
        }
        if (this._lastPruneTs && now - this._lastPruneTs < 12e4) return;
        this._lastPruneTs = now;
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith("sx_msg_perf_")) keys.push(k);
        }
        const MAX_KEYS = 300;
        if (keys.length <= MAX_KEYS) return;
        const withTs = keys.map((k) => {
          let ts = 0;
          try {
            const v = JSON.parse(localStorage.getItem(k) || "{}");
            ts = Date.parse(v.timestamp || "") || 0;
          } catch (e) {
          }
          return { k, ts };
        });
        withTs.sort((a, b) => a.ts - b.ts);
        const drop = withTs.slice(0, withTs.length - MAX_KEYS);
        drop.forEach(({ k }) => {
          try {
            localStorage.removeItem(k);
          } catch (e) {
          }
        });
      } catch (e) {
      }
    }
    /**
     * Called by FetchInterceptor when a live message finishes streaming
     */
    recordLiveMessagePerf(convKey, perfData) {
      if (!perfData) return;
      const cleanConvId = (convKey || "").replace(/^conv_/, "");
      const measured = { ...perfData, measured: true };
      this._perfStatsCache[cleanConvId || "new"] = measured;
      this._perfStatsCache["last"] = measured;
      this._latestLivePerf = measured;
      try {
        const hk = cleanConvId || "new";
        if (!this._perfHistory[hk]) this._perfHistory[hk] = [];
        this._perfHistory[hk].push(measured);
        if (this._perfHistory[hk].length > 20) this._perfHistory[hk].splice(0, this._perfHistory[hk].length - 20);
      } catch (e) {
      }
      try {
        localStorage.setItem("sx_last_perf_stats", JSON.stringify(measured));
      } catch (e) {
      }
      const footers = Array.from(document.querySelectorAll(".flex.w-full.items-start.gap-1 > .grow"));
      if (footers.length > 0) {
        const lastFooter = footers[footers.length - 1];
        const sig = this.getMessageSignature(lastFooter);
        if (sig) {
          try {
            localStorage.setItem("sx_msg_perf_" + sig, JSON.stringify(measured));
          } catch (e) {
          }
        }
      }
      this.injectMetricsToMessageFooters();
      this.updatePerfButtonUI();
      const pop = document.getElementById("sx-perf-popover");
      if (pop && this._currentRenderFn) {
        this._currentRenderFn(perfData);
      }
    }
    getLatestStats(convId) {
      const clean = (convId || "").replace(/^conv_/, "");
      if (clean && this._perfStatsCache[clean]) return this._perfStatsCache[clean];
      if (this._perfStatsCache["new"]) return this._perfStatsCache["new"];
      if (this._perfStatsCache["last"]) return this._perfStatsCache["last"];
      try {
        const saved = localStorage.getItem("sx_last_perf_stats");
        if (saved) return JSON.parse(saved);
      } catch (e) {
      }
      return null;
    }
    async fetchPerfStats(convId) {
      try {
        const cleanConvId = (convId || "").replace(/^conv_/, "");
        const raw = await this.network.fetchPerfStats(cleanConvId);
        const stats = raw?.stats || raw;
        if (stats && stats.ttftMs) {
          const measured = { ...stats, measured: true };
          this._perfStatsCache[cleanConvId || "new"] = measured;
          this._perfStatsCache["last"] = measured;
          this.updatePerfButtonUI();
          return measured;
        }
      } catch (e) {
      }
      return this.getLatestStats(convId);
    }
    /**
     * Injects or updates distinct metrics badges on each assistant message footer
     */
    injectMetricsToMessageFooters() {
      try {
        const now = Date.now();
        if (this._lastScanTs && now - this._lastScanTs < 600) return;
        this._lastScanTs = now;
        const footers = Array.from(document.querySelectorAll(".flex.w-full.items-start.gap-1 > .grow"));
        if (!footers || footers.length === 0) return;
        footers.forEach((footerEl, idx) => {
          const timeText = footerEl.childNodes[0]?.textContent?.trim() || "";
          if (!/\b\d{1,2}:\d{2}\b/.test(timeText)) return;
          const isLast = idx === footers.length - 1;
          const stats = this.getStatsForMessage(footerEl, isLast);
          if (!stats || !stats.completionTokens) return;
          const ttftSec = (stats.ttftMs / 1e3).toFixed(2);
          const ttftStr = stats.ttftMs >= 1e3 ? `${ttftSec}s` : `${stats.ttftMs}ms`;
          let speedColor = "#10b981";
          if (stats.tps < 20) speedColor = "#f43f5e";
          else if (stats.tps < 40) speedColor = "#eab308";
          else if (stats.tps < 80) speedColor = "#38bdf8";
          let badge = footerEl.querySelector(".sx-msg-perf-metrics");
          if (!badge) {
            badge = document.createElement("span");
            badge.className = "sx-msg-perf-metrics";
            badge.style.cssText = `
                        margin-left: 8px;
                        display: inline-flex;
                        align-items: center;
                        gap: 5px;
                        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                        font-size: 11px;
                        user-select: none;
                        vertical-align: middle;
                        line-height: 1;
                    `;
            footerEl.appendChild(badge);
          }
          badge.innerHTML = `
                    <span style="color: #64748b; font-size: 10px;">\u2022</span>
                    <span style="color: ${speedColor}; font-weight: 700;" title="\u0130nferans H\u0131z\u0131: ${stats.tps} Token/Saniye">\u26A1 ${stats.tps} TPS</span>
                    <span style="color: #64748b; font-size: 10px;">\u2022</span>
                    <span style="color: #38bdf8; font-weight: 600;" title="\u0130lk Yan\u0131t S\xFCresi (TTFT): ${stats.ttftMs}ms (${ttftSec}s)">\u23F1\uFE0F ${ttftStr} TTFT</span>
                    <span style="color: #64748b; font-size: 10px;">\u2022</span>
                    <span style="color: #94a3b8;" title="Bu Mesaj \u0130\xE7in \xDCretilen Token: ~${stats.completionTokens} tok">~${stats.completionTokens} tok</span>
                `;
        });
      } catch (e) {
      }
    }
    togglePerfPopover(anchorEl) {
      let pop = document.getElementById("sx-perf-popover");
      if (pop) {
        pop.remove();
        if (anchorEl) anchorEl.classList.remove("sx-active");
        this._currentRenderFn = null;
        return;
      }
      const convKey = this.models.getActiveConversationKey();
      const cleanConvId = (convKey || "").replace(/^conv_/, "");
      if (anchorEl) anchorEl.classList.add("sx-active");
      pop = document.createElement("div");
      pop.id = "sx-perf-popover";
      pop.style.cssText = `
            position: fixed;
            width: 320px;
            background: #14151b;
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 12px;
            box-shadow: 0 24px 56px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.05);
            padding: 15px 17px;
            z-index: 100000;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #f1f5f9;
            box-sizing: border-box;
            user-select: none;
            backdrop-filter: blur(16px);
        `;
      const rect = anchorEl.getBoundingClientRect();
      const popLeft = Math.max(10, Math.min(window.innerWidth - 340, rect.left - 20));
      pop.style.left = popLeft + "px";
      pop.style.bottom = window.innerHeight - rect.top + 8 + "px";
      pop.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;" id="sx-perf-popover-header">
                <div style="display:flex;align-items:center;gap:6px;">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                    </svg>
                    <span style="font-size:13px;color:#f8fafc;font-weight:600;letter-spacing:0.2px;">Model Performans\u0131</span>
                </div>
                <div style="display:flex;align-items:center;gap:4px;">
                    <span id="sx-perf-tps-badge" style="font-size:11.5px;color:#eab308;font-family:ui-monospace,monospace;font-weight:700;background:rgba(234,179,8,0.12);padding:1.5px 6px;border-radius:4px;border:1px solid rgba(234,179,8,0.25);">-- TPS</span>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#64748b;margin-left:2px;"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
            </div>

            <div style="width:100%;height:1px;background:rgba(255,255,255,0.08);margin:12px 0 14px 0;"></div>

            <div id="sx-perf-items-list" style="display:flex;flex-direction:column;gap:9px;">
                <div style="font-size:12px;color:#64748b;text-align:center;padding:10px 0;">Y\xFCkleniyor...</div>
            </div>
        `;
      document.body.appendChild(pop);
      pop.querySelector("#sx-perf-popover-header").onclick = () => {
        pop.remove();
        if (anchorEl) anchorEl.classList.remove("sx-active");
        this._currentRenderFn = null;
      };
      const renderPerfDetails = (rawStats) => {
        const listEl = pop.querySelector("#sx-perf-items-list");
        const tpsBadge = pop.querySelector("#sx-perf-tps-badge");
        if (!listEl) return;
        const stats = rawStats?.stats || rawStats;
        if (!stats || !stats.ttftMs) {
          listEl.innerHTML = `
                    <div style="font-size:12px;color:#94a3b8;text-align:center;padding:12px 0;line-height:1.5;">
                        Bu sohbet i\xE7in hen\xFCz performans \xF6l\xE7\xFCm\xFC yap\u0131lmad\u0131.<br>
                        <span style="font-size:11px;color:#64748b;">Bir mesaj g\xF6nderdi\u011Finizde ilk yan\u0131t s\xFCresi ve TPS burada g\xF6r\xFCnecektir.</span>
                    </div>
                `;
          if (tpsBadge) tpsBadge.innerText = "Bekleniyor";
          return;
        }
        if (tpsBadge) {
          tpsBadge.innerText = `${stats.tps || 0} TPS`;
        }
        try {
          const hist = (this._perfHistory[cleanConvId] || []).filter((s) => s && s.ttftMs > 0);
          if (hist.length >= 2) {
            const avgTps = (hist.reduce((a, s) => a + (Number(s.tps) || 0), 0) / hist.length).toFixed(1);
            const avgTtft = Math.round(hist.reduce((a, s) => a + (Number(s.ttftMs) || 0), 0) / hist.length);
            const avgTok = Math.round(hist.reduce((a, s) => a + (Number(s.completionTokens) || 0), 0) / hist.length);
            listEl.innerHTML += `
                        <div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;margin-top:4px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);">
                            <span style="color:#94a3b8;">Sohbet ortalamas\u0131 (${hist.length} mesaj):</span>
                            <span style="color:#f8fafc;font-family:ui-monospace,monospace;font-weight:600;">${avgTps} TPS <span style="color:#64748b;font-size:11px;">\u2022 ${avgTtft}ms \u2022 ~${avgTok} tok</span></span>
                        </div>
                    `;
          }
        } catch (e) {
        }
        const ttftSec = (stats.ttftMs / 1e3).toFixed(2);
        const totalSec = (stats.totalMs / 1e3).toFixed(2);
        let speedQuality = "Normal";
        let speedColor = "#eab308";
        if (stats.tps >= 60) {
          speedQuality = "\xC7ok H\u0131zl\u0131";
          speedColor = "#10b981";
        } else if (stats.tps >= 35) {
          speedQuality = "H\u0131zl\u0131";
          speedColor = "#38bdf8";
        } else if (stats.tps < 15) {
          speedQuality = "Yava\u015F";
          speedColor = "#f43f5e";
        }
        const sxEsc = (s) => (s || "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
        listEl.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px;">
                    <span style="color:#94a3b8;">\u0130lk Yan\u0131t S\xFCresi (TTFT):</span>
                    <span style="color:#f8fafc;font-family:ui-monospace,monospace;font-weight:600;">${stats.ttftMs} ms <span style="color:#64748b;font-size:11px;">(${ttftSec}s)</span></span>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px;">
                    <span style="color:#94a3b8;">H\u0131z (Token / Saniye):</span>
                    <span style="color:${speedColor};font-family:ui-monospace,monospace;font-weight:700;">${stats.tps} TPS <span style="color:#64748b;font-size:11px;">(${speedQuality})</span></span>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px;">
                    <span style="color:#94a3b8;">Son \xDCretilen Token:</span>
                    <span style="color:#f8fafc;font-family:ui-monospace,monospace;font-weight:600;">~${stats.completionTokens} tok</span>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px;">
                    <span style="color:#94a3b8;">Toplam Ak\u0131\u015F S\xFCresi:</span>
                    <span style="color:#f8fafc;font-family:ui-monospace,monospace;font-weight:600;">${stats.totalMs} ms <span style="color:#64748b;font-size:11px;">(${totalSec}s)</span></span>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;font-size:11.5px;margin-top:4px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);">
                    <span style="color:#64748b;">\xD6l\xE7\xFClen Model:</span>
                    <span style="color:#cbd5e1;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${sxEsc(stats.modelName || "")}">${sxEsc(stats.modelName || "")}</span>
                </div>
            `;
      };
      this._currentRenderFn = renderPerfDetails;
      const cached = this.getLatestStats(cleanConvId);
      if (cached) renderPerfDetails(cached);
      this.fetchPerfStats(cleanConvId).then((stats) => {
        if (pop.isConnected && stats) renderPerfDetails(stats);
      });
    }
    updatePerfButtonUI() {
      const perfBtn = document.getElementById("sx-perf-btn");
      if (!perfBtn) return;
      const convKey = this.models.getActiveConversationKey();
      const cleanConvId = (convKey || "").replace(/^conv_/, "");
      const stats = this.getLatestStats(cleanConvId);
      let liveSuffix = "";
      try {
        const elapsed = window.SX_SDK?.quota?.streamElapsedSec?.() || 0;
        const streaming = elapsed > 0;
        if (streaming) liveSuffix = ` \u2022 \xDCretiliyor\u2026 (${elapsed}sn)`;
      } catch (e) {
      }
      if (stats && stats.ttftMs) {
        perfBtn.title = `Model Performans\u0131: ${stats.tps || 0} TPS, TTFT ${stats.ttftMs}ms (T\u0131kla)${liveSuffix}`;
      } else {
        perfBtn.title = `Model Performans\u0131 (TTFT, TPS) (T\u0131kla)${liveSuffix}`;
      }
    }
  };

  // src/services/StreamAdapter.js
  var StreamAdapter = class _StreamAdapter {
    static encodeFrame(flag, payloadU8) {
      const frame = new Uint8Array(5 + payloadU8.length);
      frame[0] = flag;
      frame[1] = payloadU8.length >>> 24 & 255;
      frame[2] = payloadU8.length >>> 16 & 255;
      frame[3] = payloadU8.length >>> 8 & 255;
      frame[4] = payloadU8.length & 255;
      frame.set(payloadU8, 5);
      return frame;
    }
    static frameJSON(obj, flag = 0) {
      const jsonBytes = new TextEncoder().encode(JSON.stringify(obj));
      return _StreamAdapter.encodeFrame(flag, jsonBytes);
    }
    static makeAGChunk(text, thought) {
      const part = thought ? { text, thought: true } : { text };
      return _StreamAdapter.frameJSON({
        candidates: [{ content: { role: "model", parts: [part] } }]
      });
    }
    static makeAGFinish() {
      return _StreamAdapter.frameJSON({
        candidates: [{ content: { role: "model", parts: [{ text: "" }] }, finishReason: "STOP" }]
      });
    }
    static makeAGError(msg) {
      return _StreamAdapter.frameJSON({
        error: { code: 500, message: msg }
      });
    }
    /**
     * Converts OpenAI or Anthropic streaming responses into Antigravity Connect protocol responses
     */
    static async directStream(provider, modelId, reqJson, reqContentType, origFetch) {
      const contents = reqJson?.contents || [];
      const systemInstruction = reqJson?.systemInstruction;
      const systemParts = systemInstruction?.parts || [];
      let systemText = systemParts.map((p) => p.text || "").filter(Boolean).join("\n");
      const messages = [];
      for (const c of contents) {
        if (!c.parts || !Array.isArray(c.parts)) continue;
        const text = c.parts.map((p) => p.text || "").join("");
        if (!text.trim()) continue;
        messages.push({ role: c.role === "user" ? "user" : "assistant", content: text });
      }
      if (!messages.length) messages.push({ role: "user", content: "Hello" });
      const proto = (provider.protocol || "openai").toLowerCase();
      let apiUrl, headers, body;
      if (proto === "anthropic") {
        apiUrl = (provider.baseUrl || "https://api.anthropic.com").replace(/\/$/, "") + "/v1/messages";
        headers = {
          "Content-Type": "application/json",
          "x-api-key": provider.apiKey || "",
          "anthropic-version": "2023-06-01"
        };
        body = JSON.stringify({
          model: modelId,
          max_tokens: 16e3,
          stream: true,
          system: systemText || void 0,
          messages
        });
      } else {
        const cleanBase = (provider.baseUrl || "https://api.openai.com/v1").replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "");
        apiUrl = cleanBase + "/chat/completions";
        headers = {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + (provider.apiKey || "")
        };
        const oaMsgs = systemText ? [{ role: "system", content: systemText }, ...messages] : messages;
        body = JSON.stringify({
          model: modelId,
          stream: true,
          messages: oaMsgs
        });
      }
      const apiResp = await origFetch(apiUrl, { method: "POST", headers, body });
      if (!apiResp.ok) {
        const errTxt = await apiResp.text().catch(() => "HTTP " + apiResp.status);
        const errStream = new ReadableStream({
          start(ctrl) {
            ctrl.enqueue(_StreamAdapter.makeAGError(errTxt));
            ctrl.close();
          }
        });
        return new Response(errStream, {
          status: 200,
          headers: { "Content-Type": reqContentType || "application/connect+json", "Cache-Control": "no-cache" }
        });
      }
      const isAnthropicProto = proto === "anthropic";
      const stream = new ReadableStream({
        async start(ctrl) {
          const reader = apiResp.body.getReader();
          const dec = new TextDecoder();
          let buf = "";
          let inThink = false;
          const send = (txt, thought) => ctrl.enqueue(_StreamAdapter.makeAGChunk(txt, thought));
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += dec.decode(value, { stream: true });
              const lines = buf.split("\n");
              buf = lines.pop();
              for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const raw = line.slice(6).trim();
                if (raw === "[DONE]") continue;
                try {
                  const ev = JSON.parse(raw);
                  if (isAnthropicProto) {
                    if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
                      send(ev.delta.text, false);
                    } else if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta") {
                      send(ev.delta.thinking, true);
                    } else if (ev.type === "message_stop") {
                      ctrl.enqueue(_StreamAdapter.makeAGFinish());
                    }
                  } else {
                    const delta = (ev.choices || [{}])[0]?.delta || {};
                    if (delta.reasoning_content) send(delta.reasoning_content, true);
                    if (delta.content) {
                      let txt = delta.content;
                      while (txt) {
                        if (inThink) {
                          if (txt.includes("</think>")) {
                            const idx = txt.indexOf("</think>");
                            send(txt.slice(0, idx), true);
                            inThink = false;
                            txt = txt.slice(idx + 8);
                          } else {
                            send(txt, true);
                            txt = "";
                          }
                        } else {
                          if (txt.includes("<think>")) {
                            const idx = txt.indexOf("<think>");
                            if (idx > 0) send(txt.slice(0, idx), false);
                            inThink = true;
                            txt = txt.slice(idx + 7);
                          } else {
                            send(txt, false);
                            txt = "";
                          }
                        }
                      }
                    }
                    if ((ev.choices || [{}])[0]?.finish_reason) {
                      ctrl.enqueue(_StreamAdapter.makeAGFinish());
                    }
                  }
                } catch (e) {
                }
              }
            }
          } catch (e) {
            ctrl.enqueue(_StreamAdapter.makeAGError("Stream error: " + e.message));
          }
          if ((reqContentType || "").includes("connect")) {
            ctrl.enqueue(_StreamAdapter.frameJSON({ flags: 0, metadata: {} }, 2));
          } else if ((reqContentType || "").includes("grpc")) {
            ctrl.enqueue(_StreamAdapter.frameJSON({ "grpc-status": "0", "grpc-message": "OK" }, 128));
          }
          ctrl.close();
        }
      });
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": reqContentType || "application/connect+json", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*" }
      });
    }
  };

  // src/services/FetchInterceptor.js
  var FetchInterceptor = class {
    constructor(modelManager, logger) {
      this.models = modelManager;
      this.logger = logger;
      this.origFetch = window.fetch.bind(window);
    }
    init() {
      const self = this;
      window.fetch = async function(...args) {
        return self.handleFetch(this, args);
      };
      this.logger.info("FetchInterceptor", "window.fetch interceptor registered.");
    }
    async handleFetch(context, args) {
      const url = args[0]?.toString() || "";
      if (url.includes("GetUserStatus")) {
        try {
          const resp2 = await this.origFetch.apply(context, args);
          const clone = resp2.clone();
          const buf = await clone.arrayBuffer();
          const u8 = new Uint8Array(buf);
          if (u8.length > 5 && u8[0] === 0) {
            const dataLen = u8[1] << 24 | u8[2] << 16 | u8[3] << 8 | u8[4];
            const dataPayload = u8.slice(5, 5 + dataLen);
            const trailerBuf = u8.slice(5 + dataLen);
            const jsonStr = new TextDecoder().decode(dataPayload);
            const data = JSON.parse(jsonStr);
            if (data.userStatus) {
              data.userStatus.name = "SX Developer";
              data.userStatus.email = "sx-developer@custom.local";
              if (!data.userStatus.planStatus) data.userStatus.planStatus = {};
              data.userStatus.planStatus.planInfo = {
                planName: "Antigravity Pro",
                teamsTier: "TEAMS_TIER_ENTERPRISE_SELF_HOSTED",
                hasProAccess: true,
                isTrial: false,
                isGrandfathered: true,
                canUpgrade: false,
                organizationName: "Custom Studio"
              };
              data.userStatus.planStatus.userStatus = "USER_STATUS_ACTIVE";
              if (!data.userStatus.cascadeModelConfigData) data.userStatus.cascadeModelConfigData = {};
              const configs = this.models.buildCustomModelConfigs();
              const curActiveId = localStorage.getItem("sx_active_model_id");
              const activeModel = configs.find((c) => c.modelId === curActiveId) || configs[0];
              const firstModel = activeModel?.modelOrAlias?.model || "SX_EMPTY";
              const firstModelId = activeModel?.modelId || "sx-empty";
              const modelRef = { versionId: "v-custom", modelOrAlias: { model: firstModel } };
              data.userStatus.cascadeModelConfigData.clientModelConfigs = configs;
              data.userStatus.cascadeModelConfigData.clientModelSorts = this.models.buildCustomModelSorts();
              data.userStatus.cascadeModelConfigData.defaultModelConfig = modelRef;
              data.userStatus.cascadeModelConfigData.defaultOverrideModelConfig = modelRef;
              data.userStatus.cascadeModelConfigData.planModeModelConfig = modelRef;
              data.userStatus.cascadeModelConfigData.defaultAgentModelId = firstModelId;
            }
            const newJsonBytes = new TextEncoder().encode(JSON.stringify(data));
            const newFrame0 = StreamAdapter.encodeFrame(0, newJsonBytes);
            const combined = new Uint8Array(newFrame0.length + trailerBuf.length);
            combined.set(newFrame0, 0);
            combined.set(trailerBuf, newFrame0.length);
            return new Response(combined, { status: resp2.status, statusText: resp2.statusText, headers: resp2.headers });
          }
          return resp2;
        } catch (e) {
          this.logger.error("FetchInterceptor", "GetUserStatus hook error", e);
        }
      }
      if (url.includes("streamGenerateContent")) {
        const reqStart = performance.now();
        let firstTokenTime = null;
        let totalBytes = 0;
        let convKey = "";
        let activeId = "";
        try {
          convKey = this.models.getActiveConversationKey();
          activeId = this.models.getActiveModelForConversation(convKey);
          if (activeId) {
            localStorage.setItem("sx_last_used_model_id", activeId);
            localStorage.setItem("sx_active_model_id", activeId);
            if (!args[1]) args[1] = {};
            if (!args[1].headers) args[1].headers = {};
            if (args[1].headers instanceof Headers) {
              args[1].headers.set("x-sx-model-id", activeId);
              if (convKey) args[1].headers.set("x-sx-conv-key", convKey);
            } else if (typeof args[1].headers.set === "function") {
              args[1].headers.set("x-sx-model-id", activeId);
              if (convKey) args[1].headers.set("x-sx-conv-key", convKey);
            } else {
              args[1].headers["x-sx-model-id"] = activeId;
              if (convKey) args[1].headers["x-sx-conv-key"] = convKey;
            }
          }
        } catch (e) {
        }
        const resp2 = await this.origFetch.apply(context, args);
        try {
          if (resp2 && resp2.body && typeof resp2.body.getReader === "function") {
            const origReader = resp2.body.getReader();
            const self = this;
            const readable = new ReadableStream({
              async pull(controller) {
                try {
                  const { done, value } = await origReader.read();
                  if (done) {
                    controller.close();
                    const totalMs = Math.round(performance.now() - reqStart);
                    const ttftMs = firstTokenTime ? Math.round(firstTokenTime - reqStart) : totalMs;
                    const compTokens = Math.max(1, Math.round(totalBytes / 4));
                    const genMs = Math.max(1, totalMs - ttftMs);
                    const tps = Number((compTokens / (genMs / 1e3)).toFixed(1));
                    const perfData = {
                      ttftMs,
                      totalMs,
                      generationMs: genMs,
                      completionTokens: compTokens,
                      tps,
                      modelName: activeId || "Active Model",
                      timestamp: (/* @__PURE__ */ new Date()).toISOString()
                    };
                    window.SX_SDK?.perf?.recordLiveMessagePerf(convKey, perfData);
                    setTimeout(() => {
                      window.SX_SDK?.quota?.invalidateCacheAndRefresh(convKey);
                    }, 200);
                    return;
                  }
                  if (!firstTokenTime) {
                    firstTokenTime = performance.now();
                  }
                  if (value) {
                    totalBytes += value.length;
                  }
                  controller.enqueue(value);
                } catch (err) {
                  controller.error(err);
                }
              },
              cancel(reason) {
                return origReader.cancel(reason);
              }
            });
            return new Response(readable, {
              status: resp2.status,
              statusText: resp2.statusText,
              headers: resp2.headers
            });
          }
        } catch (e) {
        }
        return resp2;
      }
      const resp = await this.origFetch.apply(context, args);
      if (url.includes("HasAuthToken")) {
        try {
          const clone = resp.clone();
          const buf = await clone.arrayBuffer();
          const u8 = new Uint8Array(buf);
          if (u8.length > 5 && u8[0] === 0) {
            const dataLen = u8[1] << 24 | u8[2] << 16 | u8[3] << 8 | u8[4];
            const trailerBuf = u8.slice(5 + dataLen);
            const newJsonBytes = new TextEncoder().encode(JSON.stringify({ hasToken: true }));
            const newFrame0 = StreamAdapter.encodeFrame(0, newJsonBytes);
            const combined = new Uint8Array(newFrame0.length + trailerBuf.length);
            combined.set(newFrame0, 0);
            combined.set(trailerBuf, newFrame0.length);
            return new Response(combined, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
          }
        } catch (e) {
        }
      }
      if (url.includes("GetAuthStatus")) {
        try {
          const clone = resp.clone();
          const buf = await clone.arrayBuffer();
          const u8 = new Uint8Array(buf);
          if (u8.length > 5 && u8[0] === 0) {
            const dataLen = u8[1] << 24 | u8[2] << 16 | u8[3] << 8 | u8[4];
            const dataPayload = u8.slice(5, 5 + dataLen);
            const trailerBuf = u8.slice(5 + dataLen);
            const jsonStr = new TextDecoder().decode(dataPayload);
            const data = JSON.parse(jsonStr);
            if (!data.authResult) data.authResult = {};
            data.authResult.hasValidAuth = true;
            if (!data.authResult.email) data.authResult.email = "sx-developer@custom.local";
            if (!data.authResult.name) data.authResult.name = "SX Developer";
            const newJsonBytes = new TextEncoder().encode(JSON.stringify(data));
            const newFrame0 = StreamAdapter.encodeFrame(0, newJsonBytes);
            const combined = new Uint8Array(newFrame0.length + trailerBuf.length);
            combined.set(newFrame0, 0);
            combined.set(trailerBuf, newFrame0.length);
            return new Response(combined, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
          }
        } catch (e) {
        }
      }
      if (url.includes("GetCascadeConfig") || url.includes("getCascadeConfig") || url.includes("cascade-config") || url.includes("CascadeConfig")) {
        try {
          const cfgs = this.models.buildCustomModelConfigs();
          if (cfgs.length > 0 && cfgs[0].modelOrAlias) {
            const m = cfgs[0].modelOrAlias.model;
            const mid = cfgs[0].modelId;
            const ref = { versionId: "v-custom", modelOrAlias: { model: m } };
            const clone = resp.clone();
            const buf = await clone.arrayBuffer();
            const u8 = new Uint8Array(buf);
            if (u8.length > 5 && u8[0] === 0) {
              const dataLen = u8[1] << 24 | u8[2] << 16 | u8[3] << 8 | u8[4];
              const dataPayload = u8.slice(5, 5 + dataLen);
              const trailerBuf = u8.slice(5 + dataLen);
              const data = JSON.parse(new TextDecoder().decode(dataPayload));
              const patchModelRefs = (obj) => {
                if (!obj || typeof obj !== "object") return;
                if (obj.planModeModelConfig !== void 0) obj.planModeModelConfig = ref;
                if (obj.defaultModelConfig !== void 0) obj.defaultModelConfig = ref;
                if (obj.defaultOverrideModelConfig !== void 0) obj.defaultOverrideModelConfig = ref;
                if (obj.defaultAgentModelId !== void 0) obj.defaultAgentModelId = mid;
                if (obj.requestedModel !== void 0) obj.requestedModel = m;
                if (obj.planModel !== void 0) obj.planModel = m;
                for (const k of Object.keys(obj)) {
                  if (typeof obj[k] === "object" && obj[k] !== null) patchModelRefs(obj[k]);
                }
              };
              patchModelRefs(data);
              const newBytes = new TextEncoder().encode(JSON.stringify(data));
              const newFrame = StreamAdapter.encodeFrame(0, newBytes);
              const combined = new Uint8Array(newFrame.length + trailerBuf.length);
              combined.set(newFrame, 0);
              combined.set(trailerBuf, newFrame.length);
              return new Response(combined, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
            }
          }
        } catch (e) {
          this.logger.error("FetchInterceptor", "GetCascadeConfig hook error", e);
        }
      }
      if (url.includes("StreamAudioTranscription") || url.includes("SendAudioChunk")) {
        const emptyBytes = new TextEncoder().encode(JSON.stringify({}));
        const frame0 = StreamAdapter.encodeFrame(0, emptyBytes);
        return new Response(frame0, {
          status: 200,
          headers: { "content-type": "application/connect+json" }
        });
      }
      return resp;
    }
  };

  // src/services/VoiceRecorder.js
  var VoiceRecorder = class {
    constructor(logger) {
      this.logger = logger;
      this.isRecording = false;
      this.recognition = null;
      this.activeBtn = null;
      this.originalContent = "";
    }
    init() {
      document.addEventListener("click", (e) => {
        const btn = e.target.closest('button[aria-label*="Record voice" i], [data-tooltip-id*="record-tooltip"], button.sx-voice-btn');
        if (btn) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.toggleRecording(btn);
        }
      }, true);
      if (!document.getElementById("sx-voice-recorder-styles")) {
        const st = document.createElement("style");
        st.id = "sx-voice-recorder-styles";
        st.textContent = `
                @keyframes sx-mic-pulse {
                    0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
                    70% { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
                }
                button.sx-recording {
                    background-color: #ef4444 !important;
                    color: #ffffff !important;
                    animation: sx-mic-pulse 1.4s infinite !important;
                }
                button.sx-recording svg {
                    color: #ffffff !important;
                    fill: #ffffff !important;
                }
            `;
        (document.head || document.documentElement)?.appendChild(st);
      }
      this.logger.info("VoiceRecorder", "Voice recorder initialized with SpeechRecognition support.");
    }
    toggleRecording(btn) {
      if (this.isRecording) {
        this.stopRecording();
      } else {
        this.startRecording(btn);
      }
    }
    startRecording(btn) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        alert("Taray\u0131c\u0131n\u0131zda veya sisteminizde ses tan\u0131ma (SpeechRecognition) desteklenmiyor.");
        return;
      }
      try {
        this.recognition = new SR();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = navigator.language || "tr-TR";
        this.activeBtn = btn;
        this.isRecording = true;
        if (btn) {
          btn.classList.add("sx-recording");
          btn.setAttribute("aria-label", "Stop recording");
          btn.title = "Kayd\u0131 durdurmak i\xE7in t\u0131klay\u0131n";
        }
        const editor = document.querySelector('[contenteditable="true"]');
        if (editor) editor.focus();
        let lastFinalText = "";
        this.recognition.onresult = (event) => {
          let interim = "";
          let newFinal = "";
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              newFinal += event.results[i][0].transcript;
            } else {
              interim += event.results[i][0].transcript;
            }
          }
          if (newFinal && newFinal !== lastFinalText) {
            lastFinalText = newFinal;
            this.insertTextIntoPrompt(newFinal.trim() + " ");
          }
        };
        this.recognition.onerror = (event) => {
          this.logger.error("VoiceRecorder", "Speech recognition error", event.error);
          if (event.error !== "no-speech") {
            this.stopRecording();
          }
        };
        this.recognition.onend = () => {
          if (this.isRecording) {
            try {
              this.recognition.start();
            } catch (e) {
              this.stopRecording();
            }
          } else {
            this.stopRecording();
          }
        };
        this.recognition.start();
        this.logger.info("VoiceRecorder", "Speech recording started");
      } catch (e) {
        this.logger.error("VoiceRecorder", "Failed to start recording", e);
        this.stopRecording();
      }
    }
    stopRecording() {
      this.isRecording = false;
      if (this.recognition) {
        try {
          this.recognition.stop();
        } catch (e) {
        }
        this.recognition = null;
      }
      if (this.activeBtn) {
        this.activeBtn.classList.remove("sx-recording");
        this.activeBtn.setAttribute("aria-label", "Record voice memo");
        this.activeBtn.title = "Ses kayd\u0131 ba\u015Flat";
        this.activeBtn = null;
      }
      this.logger.info("VoiceRecorder", "Speech recording stopped");
    }
    insertTextIntoPrompt(text) {
      try {
        const editor = document.querySelector('[contenteditable="true"]');
        if (editor) {
          editor.focus();
          document.execCommand("insertText", false, text);
        }
      } catch (e) {
        this.logger.error("VoiceRecorder", "Error inserting recognized text", e);
      }
    }
  };

  // src/services/UIInjector.js
  var UIInjector = class {
    constructor(eventBus, stateStore, modelManager, themeEngine, quotaMonitor, perfMonitor, networkClient, logger, metaResolver = null) {
      this.bus = eventBus;
      this.state = stateStore;
      this.models = modelManager;
      this.theme = themeEngine;
      this.quota = quotaMonitor;
      this.perf = perfMonitor;
      this.network = networkClient;
      this.logger = logger;
      this.meta = metaResolver;
      this._lastUrl = window.location.href;
      this._lastAutoFetch = 0;
    }
    init() {
      this.injectGlobalStyles();
      setInterval(() => this.checkUrlChange(), 90);
      const origPushState = history.pushState;
      if (origPushState) {
        const self = this;
        history.pushState = function(...args) {
          const ret = origPushState.apply(this, args);
          setTimeout(() => self.checkUrlChange(), 20);
          return ret;
        };
      }
      const origReplaceState = history.replaceState;
      if (origReplaceState) {
        const self = this;
        history.replaceState = function(...args) {
          const ret = origReplaceState.apply(this, args);
          setTimeout(() => self.checkUrlChange(), 20);
          return ret;
        };
      }
      window.addEventListener("popstate", () => {
        setTimeout(() => this.checkUrlChange(), 20);
      });
      document.addEventListener("click", (e) => {
        const target = e.target.closest('a[href^="/c/"], a[href="/"], [data-testid="new-conversation-button"], [data-testid="conversation-row-sidebar"], button[aria-label*="New Conversation" i]');
        if (target) {
          const row = target.closest('[data-testid="conversation-row-sidebar"], a[href^="/c/"]');
          if (row) {
            const rId = row.getAttribute("data-cascade-id") || row.getAttribute("data-conversation-id") || row.getAttribute("href")?.match(/\/c\/([a-zA-Z0-9_-]+)/)?.[1];
            if (rId) {
              const targetKey = "conv_" + rId;
              const targetModel = this.models.getActiveModelForConversation(targetKey);
              if (targetModel) {
                this.models.setActiveModelForConversation(targetModel, targetKey, false);
              }
            }
          }
          setTimeout(() => this.checkUrlChange(), 20);
          setTimeout(() => this.hookDOM(), 40);
          setTimeout(() => this.hookDOM(), 120);
        }
      }, true);
      window.addEventListener("DOMContentLoaded", () => {
        setInterval(() => this.hookDOM(), 200);
      });
      setInterval(() => this.hookDOM(), 350);
      this.logger.info("UIInjector", "DOM Injector & event hooks initialized.");
    }
    checkUrlChange() {
      const cur = window.location.href;
      if (cur !== this._lastUrl) {
        this._lastUrl = cur;
        const newConvKey = this.models.getActiveConversationKey();
        const activeModel = this.models.getActiveModelForConversation(newConvKey);
        if (activeModel) {
          this.models.setActiveModelForConversation(activeModel, newConvKey, false);
        }
        this.quota?.updateContextButtonUI();
        this.perf?.updatePerfButtonUI();
        this.hookDOM();
      }
    }
    sxEsc(str) {
      return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    injectGlobalStyles() {
      if (document.getElementById("sx-custom-styles")) return;
      const style = document.createElement("style");
      style.id = "sx-custom-styles";
      style.textContent = `
            .sx-section { margin-top: 24px; margin-bottom: 8px; }
            .sx-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
            .sx-section-title { font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 1px; }
            .sx-section-count { font-size: 11px; color: rgba(255,255,255,0.22); margin-left: 6px; }
            .sx-btn { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.8); font-size: 12px; font-weight: 500; padding: 5px 12px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; font-family: inherit; transition: all 0.12s; line-height: 1.5; }
            .sx-btn:hover { background: rgba(255,255,255,0.09); border-color: rgba(255,255,255,0.2); color: #fff; }
            .sx-btn-primary { background: #fff; color: #0e0e11; font-weight: 600; border: none; padding: 5px 14px; }
            .sx-btn-primary:hover { background: #e8e8e8; }
            .sx-card { display: flex; align-items: center; gap: 12px; padding: 13px 16px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; margin-bottom: 6px; transition: all 0.12s; }
            .sx-card:hover { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.1); }
            .sx-card-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
            .sx-card-info { flex: 1; min-width: 0; }
            .sx-card-name { font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.9); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .sx-card-sub { font-size: 11px; color: rgba(255,255,255,0.28); font-family: ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
            .sx-card-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
            .sx-models-list { border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; overflow: hidden; }
            .sx-model-card { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: transparent; border-bottom: 1px solid rgba(255,255,255,0.04); transition: background 0.1s; }
            .sx-model-card:last-child { border-bottom: none; }
            .sx-model-card:hover { background: rgba(255,255,255,0.03); }
            .sx-model-name { font-size: 13px; color: rgba(255,255,255,0.88); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .sx-model-id { font-size: 10.5px; color: rgba(255,255,255,0.3); font-family: ui-monospace, monospace; flex: 1.2; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .sx-model-prov { font-size: 10.5px; color: rgba(255,255,255,0.22); flex-shrink: 0; }
            .sx-icon-btn { background: none; border: none; color: rgba(255,255,255,0.25); cursor: pointer; padding: 4px 7px; border-radius: 5px; font-size: 12px; transition: all 0.1s; line-height: 1; }
            .sx-icon-btn:hover { color: rgba(255,255,255,0.75); background: rgba(255,255,255,0.07); }
            .sx-icon-btn.del:hover { color: #f87171; background: rgba(239,68,68,0.1); }
            .sx-empty-hint { font-size: 12px; color: rgba(255,255,255,0.25); padding: 20px 16px; text-align: center; border: 1px dashed rgba(255,255,255,0.07); border-radius: 10px; margin-bottom: 6px; line-height: 1.6; }
            .sx-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.65); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 999999; }
            .sx-modal { background: #111114; border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; padding: 24px 26px; width: 560px; max-width: 96vw; max-height: 90vh; overflow-y: auto; box-shadow: 0 32px 64px rgba(0,0,0,0.8); font-family: inherit; }
            .sx-modal-title { font-size: 16px; font-weight: 700; color: rgba(255,255,255,0.95); margin-bottom: 20px; letter-spacing: -0.3px; }
            .sx-field { margin-bottom: 16px; }
            .sx-label { display: block; font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 0.7px; margin-bottom: 7px; }
            .sx-input, .sx-select { width: 100%; box-sizing: border-box; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.09); color: rgba(255,255,255,0.92); border-radius: 8px; padding: 9px 12px; font-size: 13px; font-family: inherit; outline: none; }
            .sx-input:focus, .sx-select:focus { border-color: rgba(255,255,255,0.3); background: rgba(255,255,255,0.06); }
            .sx-select option { background: #111114; }
            .sx-preset-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; max-height: 180px; overflow-y: auto; }
            .sx-preset-btn { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); color: rgba(255,255,255,0.65); font-size: 11px; font-weight: 500; padding: 7px 5px; border-radius: 6px; cursor: pointer; text-align: center; }
            .sx-preset-btn.active { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.3); color: #fff; font-weight: 600; }
            .sx-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 22px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,0.06); }
        `;
      const target = document.head || document.documentElement;
      if (target) {
        target.appendChild(style);
      } else {
        window.addEventListener("DOMContentLoaded", () => {
          (document.head || document.documentElement)?.appendChild(style);
        }, { once: true });
      }
    }
    openProviderModal(existing = null, onSave = null) {
      const isEdit = !!existing;
      const overlay = document.createElement("div");
      overlay.className = "sx-modal-overlay";
      overlay.id = "sx-p-modal";
      const initPreset = isEdit ? SX_PRESETS.find((p) => existing.baseUrl && existing.baseUrl.includes(p.id === "custom" ? "!!" : p.baseUrl.split("/")[2] || "---")) || SX_PRESETS[5] : SX_PRESETS[0];
      overlay.innerHTML = `
            <div class="sx-modal">
                <div class="sx-modal-title">${isEdit ? "Edit Provider" : "Add Provider"}</div>
                <div class="sx-field">
                    <label class="sx-label">Select Provider</label>
                    <div class="sx-preset-grid" id="sx-p-presets">
                        ${SX_PRESETS.map((p) => `
                            <button type="button" class="sx-preset-btn${p.id === initPreset.id ? " active" : ""}" data-preset="${p.id}">
                                ${p.name}
                            </button>
                        `).join("")}
                    </div>
                </div>
                <div class="sx-field">
                    <label class="sx-label">Provider Name</label>
                    <input class="sx-input" id="sx-p-name" value="${existing ? this.sxEsc(existing.name) : initPreset.name}" placeholder="e.g. My OpenRouter" />
                </div>
                <div class="sx-field">
                    <label class="sx-label">API Base URL</label>
                    <input class="sx-input" id="sx-p-url" value="${existing ? this.sxEsc(existing.baseUrl || "") : initPreset.baseUrl}" placeholder="https://..." />
                </div>
                <div class="sx-field">
                    <label class="sx-label">Protocol</label>
                    <select class="sx-select" id="sx-p-proto">
                        <option value="openai"${(existing ? existing.protocol : initPreset.protocol) === "openai" ? " selected" : ""}>OpenAI Compatible (SSE)</option>
                        <option value="anthropic"${(existing ? existing.protocol : initPreset.protocol) === "anthropic" ? " selected" : ""}>Anthropic Messages (SSE)</option>
                    </select>
                </div>
                <div class="sx-field">
                    <label class="sx-label">API Key</label>
                    <input class="sx-input" type="password" id="sx-p-key" value="${existing ? this.sxEsc(existing.apiKey || "") : ""}" placeholder="sk-..." autocomplete="off" />
                </div>
                <div class="sx-modal-actions">
                    <button type="button" class="sx-btn" id="sx-p-cancel">Cancel</button>
                    <button type="button" class="sx-btn sx-btn-primary" id="sx-p-save">Save Provider</button>
                </div>
            </div>
        `;
      document.body.appendChild(overlay);
      let selectedPreset = initPreset;
      overlay.querySelector("#sx-p-presets").onclick = (e) => {
        const btn = e.target.closest(".sx-preset-btn");
        if (!btn) return;
        const preset = SX_PRESETS.find((p) => p.id === btn.dataset.preset);
        if (preset) {
          selectedPreset = preset;
          overlay.querySelectorAll(".sx-preset-btn").forEach((b) => b.classList.toggle("active", b.dataset.preset === preset.id));
          if (preset.id !== "custom") {
            overlay.querySelector("#sx-p-name").value = preset.name;
            overlay.querySelector("#sx-p-url").value = preset.baseUrl;
            overlay.querySelector("#sx-p-proto").value = preset.protocol;
          }
        }
      };
      overlay.querySelector("#sx-p-cancel").onclick = () => overlay.remove();
      overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
      };
      overlay.querySelector("#sx-p-save").onclick = () => {
        const name = overlay.querySelector("#sx-p-name").value.trim();
        const baseUrl = overlay.querySelector("#sx-p-url").value.trim();
        const protocol = overlay.querySelector("#sx-p-proto").value;
        const apiKey = overlay.querySelector("#sx-p-key").value.trim();
        if (!name || !apiKey) {
          alert("Name and API key are required.");
          return;
        }
        const list = this.state.getProviders();
        const entry = { id: existing ? existing.id : "prov_" + Date.now(), name, baseUrl, protocol, apiKey, modelsPath: selectedPreset.modelsPath || "/models" };
        if (existing) {
          const idx = list.findIndex((p) => p.id === existing.id);
          if (idx >= 0) list[idx] = entry;
          else list.push(entry);
        } else {
          list.push(entry);
        }
        this.state.setProviders(list);
        overlay.remove();
        onSave && onSave();
      };
      setTimeout(() => overlay.querySelector("#sx-p-key").focus(), 50);
    }
    openModelModal(existing = null, onSave = null) {
      const providers = this.state.getProviders();
      if (!providers.length) {
        alert("\xD6nce bir provider ekleyin.");
        return;
      }
      const isEdit = !!existing;
      const overlay = document.createElement("div");
      overlay.className = "sx-modal-overlay";
      overlay.id = "sx-m-modal";
      const provOptions = providers.map(
        (p) => `<option value="${p.id}"${existing && existing.providerId === p.id ? " selected" : ""}>${this.sxEsc(p.name)} (${this.sxEsc(p.protocol)})</option>`
      ).join("");
      const editFields = `
            <div class="sx-field">
                <label class="sx-label">Model ID</label>
                <input class="sx-input" id="sx-m-id" value="${this.sxEsc(existing?.modelId || "")}" placeholder="\xF6rnek: anthropic/claude-3-7-sonnet" />
            </div>
            <div class="sx-field">
                <label class="sx-label">G\xF6r\xFCnt\xFC Ad\u0131</label>
                <input class="sx-input" id="sx-m-name" value="${this.sxEsc(existing?.name || "")}" placeholder="\xF6rnek: Claude 3.7 Sonnet" />
            </div>
            <div class="sx-field">
                <label class="sx-label">Context (token)</label>
                <input class="sx-input" id="sx-m-ctx" type="number" min="0" step="1024" value="${existing?.contextLength ? this.sxEsc(existing.contextLength) : ""}" placeholder="\xF6rnek: 200000" />
            </div>
            <div class="sx-field" style="display:flex;gap:18px;align-items:center;">
                <label style="display:flex;align-items:center;gap:7px;font-size:12.5px;color:rgba(255,255,255,0.75);cursor:pointer;">
                    <input type="checkbox" id="sx-m-vision" ${existing?.supportsImages ? "checked" : ""} style="width:14px;height:14px;accent-color:#38bdf8;" />
                    Vision
                </label>
                <label style="display:flex;align-items:center;gap:7px;font-size:12.5px;color:rgba(255,255,255,0.75);cursor:pointer;">
                    <input type="checkbox" id="sx-m-tools" ${existing?.supportsTools ? "checked" : ""} style="width:14px;height:14px;accent-color:#fb923c;" />
                    Tools
                </label>
            </div>`;
      const addFields = `
            <div class="sx-field">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                    <label class="sx-label" style="margin:0;">Model Listesi</label>
                    <button type="button" class="sx-btn" id="sx-m-fetch" style="padding:3px 10px;font-size:11px;">&#8595; Listele</button>
                </div>
                <input class="sx-input" id="sx-m-filter" placeholder="Model ara..." style="margin-bottom:6px;display:none;" />
                <div id="sx-m-check-list" style="max-height:200px;overflow-y:auto;border:1px solid rgba(255,255,255,0.09);border-radius:7px;display:none;"></div>
                <div id="sx-m-bulk-hint" style="font-size:12px;color:rgba(255,255,255,0.3);padding:8px 0 4px 0;">Provider'dan model listesi y\xFCkle veya a\u015Fa\u011F\u0131da manuel gir.</div>
            </div>
            <div class="sx-field">
                <label class="sx-label">Manuel Model ID (opsiyonel)</label>
                <input class="sx-input" id="sx-m-id" placeholder="\xF6rnek: anthropic/claude-3-7-sonnet" />
            </div>
            <div class="sx-field">
                <label class="sx-label">G\xF6r\xFCnt\xFC Ad\u0131 (opsiyonel)</label>
                <input class="sx-input" id="sx-m-name" placeholder="\xF6rnek: Claude 3.7 Sonnet" />
            </div>`;
      overlay.innerHTML = `
            <div class="sx-modal" style="width:500px;">
                <div class="sx-modal-title">${isEdit ? "Model D\xFCzenle" : "Model Ekle"}</div>
                <div class="sx-field">
                    <label class="sx-label">Provider</label>
                    <select class="sx-select" id="sx-m-prov">${provOptions}</select>
                </div>
                ${isEdit ? editFields : addFields}
                <div class="sx-modal-actions">
                    <button type="button" class="sx-btn" id="sx-m-cancel">\u0130ptal</button>
                    <button type="button" class="sx-btn sx-btn-primary" id="sx-m-save">${isEdit ? "Kaydet" : "Ekle"}</button>
                </div>
            </div>
        `;
      document.body.appendChild(overlay);
      let allFetchedModels = [];
      const checkedIds = /* @__PURE__ */ new Set();
      const self = this;
      const isAlreadyAdded = (modelId, provId) => self.state.getModels().some((m) => m.modelId === modelId && m.providerId === provId);
      const META_SRC_LABEL = { api: "Provider API", zen: "Zen dok\xFCman\u0131", "zen-catalog": "Zen katalog", modelsdev: "models.dev", openrouter: "OpenRouter", local: "Yerel DB", manual: "Manuel", partial: "K\u0131smi", none: "Bilinmiyor" };
      const metaSrcLabel = (m) => META_SRC_LABEL[m?.metaSource] || (m?.metaSource || "");
      const metaFromFetched = (fm) => {
        if (!fm) return {};
        const out = {};
        if (fm.contextLength) out.contextLength = fm.contextLength;
        if (typeof fm.supportsImages === "boolean") out.supportsImages = fm.supportsImages;
        if (typeof fm.supportsTools === "boolean") out.supportsTools = fm.supportsTools;
        if (fm.metaSource) out.metaSource = fm.metaSource;
        return out;
      };
      function renderChecklist(filterText) {
        const list = overlay.querySelector("#sx-m-check-list");
        if (!list) return;
        const provId = overlay.querySelector("#sx-m-prov")?.value;
        const filtered = allFetchedModels.filter(
          (m) => m.id.toLowerCase().includes(filterText) || (m.name || "").toLowerCase().includes(filterText)
        ).slice(0, 500);
        if (!filtered.length) {
          list.innerHTML = '<div style="padding:12px;color:rgba(255,255,255,0.3);font-size:12px;text-align:center;">Sonu\xE7 yok</div>';
          return;
        }
        let addedCount = 0;
        list.innerHTML = filtered.map((m) => {
          const already = isAlreadyAdded(m.id, provId);
          if (already) addedCount++;
          const ctxTag = self.models.formatContextSize(m.contextLength);
          const srcTitle = metaSrcLabel(m) ? ` title="Kaynak: ${metaSrcLabel(m)}"` : "";
          const badges = [];
          if (ctxTag) badges.push(`<span${srcTitle} style="font-size:9px;font-weight:700;color:#a3e635;background:rgba(163,230,53,0.1);padding:0 4px;border-radius:3px;">${ctxTag}</span>`);
          if (m.supportsImages) badges.push(`<span${srcTitle} style="font-size:9px;font-weight:600;color:#38bdf8;background:rgba(56,189,248,0.1);padding:0 4px;border-radius:3px;">Vision</span>`);
          if (m.supportsTools) badges.push(`<span${srcTitle} style="font-size:9px;font-weight:600;color:#fbbf24;background:rgba(245,158,11,0.1);padding:0 4px;border-radius:3px;">Tools</span>`);
          const badgeHtml = badges.length ? `<span style="display:inline-flex;gap:4px;flex-shrink:0;margin-left:auto;padding-left:6px;">${badges.join("")}</span>` : "";
          return '<label style="display:flex;align-items:center;gap:9px;padding:7px 12px;cursor:' + (already ? "default" : "pointer") + ";opacity:" + (already ? "0.45" : "1") + ';"><input type="checkbox" data-id="' + self.sxEsc(m.id) + '"' + (checkedIds.has(m.id) ? " checked" : "") + (already ? " disabled" : "") + ' style="width:14px;height:14px;accent-color:#38bdf8;cursor:' + (already ? "not-allowed" : "pointer") + ';flex-shrink:0;" /><span style="min-width:0;overflow:hidden;flex:1;"><div style="font-family:ui-monospace,monospace;font-size:11.5px;color:rgba(255,255,255,0.88);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + self.sxEsc(m.id) + (already ? ' <span style="font-size:9px;color:rgba(255,255,255,0.35);font-family:inherit;">(ekli)</span>' : "") + "</div>" + (m.name && m.name !== m.id ? '<div style="font-size:10px;color:rgba(255,255,255,0.38);">' + self.sxEsc(m.name) + "</div>" : "") + "</span>" + badgeHtml + "</label>";
        }).join("");
        list.querySelectorAll("input[type=checkbox]").forEach((cb) => {
          cb.onchange = () => {
            if (cb.checked) checkedIds.add(cb.dataset.id);
            else checkedIds.delete(cb.dataset.id);
            const bulkHint = overlay.querySelector("#sx-m-bulk-hint");
            if (bulkHint && checkedIds.size > 0) {
              bulkHint.textContent = checkedIds.size + " model se\xE7ildi \u2014 Ekle ile toplu eklenecek.";
            }
          };
        });
        const hint = overlay.querySelector("#sx-m-bulk-hint");
        if (hint && checkedIds.size === 0 && addedCount > 0) {
          hint.style.display = "";
          hint.textContent = addedCount + " model zaten ekli \u2014 tekrar eklenmeyecek.";
        } else if (hint && checkedIds.size > 0) {
          hint.style.display = "";
          hint.textContent = checkedIds.size + " model se\xE7ildi \u2014 Ekle ile toplu eklenecek.";
        }
      }
      const fetchBtn = overlay.querySelector("#sx-m-fetch");
      if (fetchBtn) fetchBtn.onclick = async () => {
        const provId = overlay.querySelector("#sx-m-prov").value;
        const prov = providers.find((p) => p.id === provId);
        if (!prov) {
          alert("\xD6nce provider se\xE7in.");
          return;
        }
        fetchBtn.disabled = true;
        fetchBtn.textContent = "Y\xFCkleniyor...";
        checkedIds.clear();
        try {
          const rawList = await self.network.fetchModels(prov.baseUrl, prov.apiKey, prov.protocol, prov.modelsPath);
          allFetchedModels = self.meta ? await self.meta.enrichList(rawList, { online: true }) : rawList;
          const modelsNow = self.state.getModels();
          let metaUpdated = false;
          allFetchedModels.forEach((fm) => {
            const ex = modelsNow.find((m) => m.modelId === fm.id && m.providerId === provId);
            if (!ex) return;
            if (fm.contextLength && !ex.contextLength) {
              ex.contextLength = fm.contextLength;
              metaUpdated = true;
            }
            if (typeof fm.supportsImages === "boolean" && typeof ex.supportsImages !== "boolean") {
              ex.supportsImages = fm.supportsImages;
              metaUpdated = true;
            }
            if (typeof fm.supportsTools === "boolean" && typeof ex.supportsTools !== "boolean") {
              ex.supportsTools = fm.supportsTools;
              metaUpdated = true;
            }
          });
          if (self.meta) {
            const { list: bfList, changed } = await self.meta.backfillStored(modelsNow, { online: true });
            if (changed) {
              self.state.setModels(bfList);
              metaUpdated = true;
            }
          } else if (metaUpdated) {
            self.state.setModels(modelsNow);
          }
          const hint = overlay.querySelector("#sx-m-bulk-hint");
          const filterEl2 = overlay.querySelector("#sx-m-filter");
          const listEl = overlay.querySelector("#sx-m-check-list");
          if (filterEl2) filterEl2.style.display = "";
          if (listEl) listEl.style.display = "";
          const filterText = (filterEl2?.value || "").toLowerCase().trim();
          renderChecklist(filterText);
          if (hint) {
            const total = allFetchedModels.length;
            const already = allFetchedModels.filter((m) => isAlreadyAdded(m.id, provId)).length;
            const withCtx = allFetchedModels.filter((m) => Number(m.contextLength) > 0).length;
            const zenOk = self.meta ? allFetchedModels.filter((m) => self.meta.isZenModel(m.id)).length : 0;
            hint.style.display = "";
            hint.textContent = `${total} model bulundu` + (already ? ` \u2014 ${already} zaten ekli` : "") + ` \u2014 ${withCtx}/${total} context bilgili` + (zenOk ? ` \u2014 ${zenOk} Zen katalo\u011Funda` : "") + (metaUpdated ? " \u2014 metadata g\xFCncellendi" : "") + ".";
          }
          if (metaUpdated) onSave && onSave();
        } catch (e) {
          alert("Listelenemedi: " + e.message);
        } finally {
          fetchBtn.disabled = false;
          fetchBtn.innerHTML = "&#8595; Listele";
        }
      };
      const filterEl = overlay.querySelector("#sx-m-filter");
      if (filterEl) filterEl.oninput = (e) => renderChecklist(e.target.value.toLowerCase().trim());
      const provSel = overlay.querySelector("#sx-m-prov");
      if (provSel) provSel.onchange = () => {
        checkedIds.clear();
        allFetchedModels = [];
        const listEl = overlay.querySelector("#sx-m-check-list");
        const fEl = overlay.querySelector("#sx-m-filter");
        const hint = overlay.querySelector("#sx-m-bulk-hint");
        if (listEl) {
          listEl.style.display = "none";
          listEl.innerHTML = "";
        }
        if (fEl) {
          fEl.style.display = "none";
          fEl.value = "";
        }
        if (hint) {
          hint.style.display = "";
          hint.textContent = "Provider'dan model listesi y\xFCkle veya a\u015Fa\u011F\u0131da manuel gir.";
        }
      };
      overlay.querySelector("#sx-m-cancel").onclick = () => overlay.remove();
      overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
      };
      overlay.querySelector("#sx-m-save").onclick = async () => {
        const provId = overlay.querySelector("#sx-m-prov").value;
        const list = self.state.getModels();
        if (isEdit) {
          const name = overlay.querySelector("#sx-m-name").value.trim();
          const modelId = overlay.querySelector("#sx-m-id").value.trim();
          if (!name || !modelId) {
            alert("Model ID ve ad zorunludur.");
            return;
          }
          const dup = list.find((m) => m.modelId === modelId && m.providerId === provId && m.id !== existing.id);
          if (dup) {
            alert("Bu provider i\xE7in ayn\u0131 model ID zaten ekli.");
            return;
          }
          const ctxRaw = Number(String(overlay.querySelector("#sx-m-ctx")?.value || "").trim());
          const entry = {
            id: existing.id,
            providerId: provId,
            name,
            modelId,
            directMode: true,
            contextLength: Number.isFinite(ctxRaw) && ctxRaw > 0 ? Math.round(ctxRaw) : 0,
            supportsImages: !!overlay.querySelector("#sx-m-vision")?.checked,
            supportsTools: !!overlay.querySelector("#sx-m-tools")?.checked,
            metaSource: "manual"
          };
          if (!entry.contextLength) delete entry.contextLength;
          const idx = list.findIndex((m) => m.id === existing.id);
          if (idx >= 0) list[idx] = entry;
          else list.push(entry);
          self.state.setModels(list);
          overlay.remove();
          onSave && onSave();
          return;
        }
        if (checkedIds.size > 0) {
          let added = 0;
          let skipped = 0;
          const toEnrich = [];
          checkedIds.forEach((id) => {
            if (list.some((m) => m.modelId === id && m.providerId === provId)) {
              skipped++;
              return;
            }
            const fm2 = allFetchedModels.find((m) => m.id === id) || { id, name: id };
            toEnrich.push(fm2);
          });
          if (self.meta && toEnrich.length) {
            await self.meta.enrichList(toEnrich, { online: true });
          }
          toEnrich.forEach((fm2) => {
            list.push({
              id: "m_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
              providerId: provId,
              name: fm2.name || fm2.id,
              modelId: fm2.id,
              directMode: true,
              ...metaFromFetched(fm2)
            });
            added++;
          });
          if (added === 0) {
            alert(skipped ? "Se\xE7ilen t\xFCm modeller zaten ekli." : "Eklenecek model yok.");
            return;
          }
          self.state.setModels(list);
          overlay.remove();
          onSave && onSave();
          return;
        }
        const manualId = (overlay.querySelector("#sx-m-id") || {}).value?.trim();
        const manualName = (overlay.querySelector("#sx-m-name") || {}).value?.trim();
        if (!manualId) {
          alert("Model ID girin veya listeden en az bir model se\xE7in.");
          return;
        }
        if (list.some((m) => m.modelId === manualId && m.providerId === provId)) {
          alert("Bu provider i\xE7in ayn\u0131 model ID zaten ekli.");
          return;
        }
        const fmBase = allFetchedModels.find((m) => m.id === manualId) || { id: manualId, name: manualName || manualId };
        const fm = self.meta ? await self.meta.enrichAsync(fmBase, { online: true }) : fmBase;
        list.push({
          id: "m_" + Date.now(),
          providerId: provId,
          name: manualName || fm.name || manualId,
          modelId: manualId,
          directMode: true,
          ...metaFromFetched(fm)
        });
        self.state.setModels(list);
        overlay.remove();
        onSave && onSave();
      };
      setTimeout(() => overlay.querySelector("#sx-m-prov").focus(), 50);
    }
    trySXModelsSettingsInject() {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return;
      this.injectGlobalStyles();
      const existingWrap = dialog.querySelector("#sx-content-wrapper");
      if (existingWrap) {
        const rp = existingWrap.parentElement;
        if (rp) Array.from(rp.children).forEach((c) => {
          if (c.id === "sx-content-wrapper") return;
          c.style.setProperty("display", "none", "important");
        });
        return;
      }
      const scanTs = Date.now();
      if (this._lastSettingsScan && scanTs - this._lastSettingsScan < 2e3) return;
      this._lastSettingsScan = scanTs;
      let rightPanel = null;
      const MARKERS = ["Gemini Models", "Model Credits", "Your Plan"];
      outer: for (const marker of MARKERS) {
        for (const el of Array.from(dialog.querySelectorAll("*"))) {
          if (!el.offsetParent) continue;
          if (el.textContent.trim() !== marker) continue;
          let anc = el.parentElement;
          while (anc && anc !== dialog) {
            const cs = window.getComputedStyle(anc);
            if (cs.overflowY === "auto" || cs.overflowY === "scroll") {
              rightPanel = anc;
              break;
            }
            anc = anc.parentElement;
          }
          if (rightPanel) break outer;
        }
      }
      if (!rightPanel) return;
      Array.from(rightPanel.children).forEach((c) => {
        c.style.setProperty("display", "none", "important");
      });
      const sxWrap = document.createElement("div");
      sxWrap.id = "sx-content-wrapper";
      sxWrap.style.cssText = "padding: 0 32px 32px 32px; box-sizing: border-box; width: 100%;";
      rightPanel.appendChild(sxWrap);
      const sxHeader = document.createElement("div");
      sxHeader.id = "sx-custom-engine-header";
      sxHeader.innerHTML = `
            <div style="padding:20px 0 14px 0;">
                <div style="font-size:22px;font-weight:700;color:rgba(255,255,255,0.92);letter-spacing:-0.5px;">Models &amp; Usage</div>
                <div style="font-size:13px;color:rgba(255,255,255,0.4);margin-top:4px;">Do\u011Frudan custom provider ba\u011Flant\u0131s\u0131 aktif.</div>
            </div>
        `;
      sxWrap.appendChild(sxHeader);
      const provSec = document.createElement("div");
      provSec.id = "sx-providers-section";
      provSec.className = "sx-section";
      sxWrap.appendChild(provSec);
      const modelsSec = document.createElement("div");
      modelsSec.id = "sx-models-section";
      modelsSec.className = "sx-section";
      sxWrap.appendChild(modelsSec);
      const renderProviders = () => {
        const providers = this.state.getProviders();
        const models = this.state.getModels();
        let html = `
                <div class="sx-section-header">
                    <div style="display:flex;align-items:center;gap:6px;">
                        <div class="sx-section-title">Providers</div>
                        <span class="sx-section-count">(${providers.length})</span>
                    </div>
                    <button type="button" class="sx-btn sx-btn-primary" id="sx-add-prov-btn">+ Add Provider</button>
                </div>
            `;
        if (!providers.length) {
          html += '<div class="sx-empty-hint">Hen\xFCz provider eklenmedi.<br>OpenRouter, Anthropic veya OpenAI uyumlu bir sa\u011Flay\u0131c\u0131 ekleyin.</div>';
        } else {
          providers.forEach((p) => {
            const count = models.filter((m) => m.providerId === p.id).length;
            html += `
                        <div class="sx-card">
                            <div class="sx-card-dot" style="background:#38bdf8;"></div>
                            <div class="sx-card-info">
                                <div style="display:flex;align-items:center;gap:8px;">
                                    <div class="sx-card-name">${this.sxEsc(p.name)}</div>
                                    <span style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.45);background:rgba(255,255,255,0.06);padding:1px 6px;border-radius:4px;">${count} model</span>
                                </div>
                                <div class="sx-card-sub">${this.sxEsc(p.baseUrl || "")}</div>
                            </div>
                            <div class="sx-card-actions">
                                <button class="sx-icon-btn edit-p" data-id="${p.id}" title="Edit">\u270E</button>
                                <button class="sx-icon-btn del del-p" data-id="${p.id}" title="Delete">\u2715</button>
                            </div>
                        </div>
                    `;
          });
        }
        provSec.innerHTML = html;
        provSec.querySelector("#sx-add-prov-btn").onclick = () => this.openProviderModal(null, () => {
          renderProviders();
          renderModels();
        });
        provSec.querySelectorAll(".edit-p").forEach((b) => {
          b.onclick = () => {
            const p = this.state.getProviders().find((x) => x.id === b.dataset.id);
            if (p) this.openProviderModal(p, () => {
              renderProviders();
              renderModels();
            });
          };
        });
        provSec.querySelectorAll(".del-p").forEach((b) => {
          b.onclick = () => {
            if (!confirm("Bu provider ve modellerini sil?")) return;
            this.state.setProviders(this.state.getProviders().filter((x) => x.id !== b.dataset.id));
            this.state.setModels(this.state.getModels().filter((x) => x.providerId !== b.dataset.id));
            renderProviders();
            renderModels();
          };
        });
      };
      const renderModels = () => {
        const models = this.state.getModels();
        const providers = this.state.getProviders();
        let html = `
                <div class="sx-section-header">
                    <div style="display:flex;align-items:center;gap:6px;">
                        <div class="sx-section-title">Models</div>
                        <span class="sx-section-count">(${models.length})</span>
                    </div>
                    <button type="button" class="sx-btn sx-btn-primary" id="sx-add-model-btn">+ Add Model</button>
                </div>
            `;
        if (!models.length) {
          html += '<div class="sx-empty-hint">Hen\xFCz model eklenmedi.<br>Yukar\u0131dan bir provider ekleyip model tan\u0131mlay\u0131n.</div>';
        } else {
          html += '<div class="sx-models-list">';
          models.forEach((m) => {
            const p = providers.find((x) => x.id === m.providerId);
            const ctxTag = this.models.formatContextSize(m.contextLength);
            const badgeBits = [];
            if (ctxTag) badgeBits.push(`<span style="font-size:9.5px;font-weight:700;color:#a3e635;background:rgba(163,230,53,0.08);border:1px solid rgba(163,230,53,0.2);padding:0 5px;border-radius:4px;">${ctxTag}</span>`);
            if (this.models.isVisionModel(m)) badgeBits.push('<span style="font-size:9.5px;font-weight:600;color:#38bdf8;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.2);padding:0 5px;border-radius:4px;">Vision</span>');
            if (m.supportsTools === true) badgeBits.push('<span style="font-size:9.5px;font-weight:600;color:#fb923c;background:rgba(251,146,60,0.08);border:1px solid rgba(251,146,60,0.2);padding:0 5px;border-radius:4px;">Tools</span>');
            html += `
                        <div class="sx-model-card">
                            <div class="sx-model-name">${this.sxEsc(m.name)}</div>
                            <div class="sx-model-id">${this.sxEsc(m.modelId)}</div>
                            <div style="display:flex;gap:4px;flex-shrink:0;">${badgeBits.join("")}</div>
                            <div class="sx-model-prov">${this.sxEsc(p ? p.name : "?")}</div>
                            <div class="sx-card-actions">
                                <button class="sx-icon-btn edit-m" data-id="${m.id}" title="Edit">\u270E</button>
                                <button class="sx-icon-btn del del-m" data-id="${m.id}" title="Delete">\u2715</button>
                            </div>
                        </div>
                    `;
          });
          html += "</div>";
        }
        modelsSec.innerHTML = html;
        modelsSec.querySelector("#sx-add-model-btn").onclick = () => this.openModelModal(null, () => renderModels());
        modelsSec.querySelectorAll(".edit-m").forEach((b) => {
          b.onclick = () => {
            const m = this.state.getModels().find((x) => x.id === b.dataset.id);
            if (m) this.openModelModal(m, () => renderModels());
          };
        });
        modelsSec.querySelectorAll(".del-m").forEach((b) => {
          b.onclick = () => {
            if (!confirm("Bu modeli sil?")) return;
            this.state.setModels(this.state.getModels().filter((x) => x.id !== b.dataset.id));
            renderModels();
          };
        });
      };
      renderProviders();
      renderModels();
    }
    trySXAppearanceSettingsInject() {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return;
      const nativeCombos = dialog.querySelectorAll('button[role="combobox"]');
      nativeCombos.forEach((b) => {
        if (b.style.display === "none") b.style.removeProperty("display");
      });
      const nativeListbox = document.querySelector('[role="listbox"]');
      if (nativeListbox && nativeListbox.style.display === "none") {
        nativeListbox.style.removeProperty("display");
      }
    }
    hookDOM() {
      const nowTs = Date.now();
      if (this._lastHookTs && nowTs - this._lastHookTs < 250) return;
      this._lastHookTs = nowTs;
      try {
        const currentPreset = localStorage.getItem("theme-preset-dark");
        const foundPreset = this.theme.currentThemeId || currentPreset?.startsWith("SX ");
        if (foundPreset && !document.body.classList.contains("sx-theme-active")) {
          document.body.classList.add("sx-theme-active");
        }
      } catch (e) {
      }
      const promptInput = document.querySelector('[contenteditable="true"], div.cursor-text[role="combobox"], textarea');
      const promptRoot = promptInput ? promptInput.closest('form, div.relative, [data-testid="chat-input-container"]') : null;
      const actionContainer = document.querySelector(
        'div.flex.items-center.gap-1:has([data-tooltip-id*="input-send-button"]), div.flex.items-center.gap-1:has([data-testid="send-button"]), div.flex.items-center.gap-1:has(button[aria-label*="Record voice" i]), div.flex.items-center.gap-1:has(button[aria-label*="Cancel" i])'
      ) || (promptRoot ? promptRoot.querySelector("div.flex.items-center.gap-1") : null);
      if (actionContainer) {
        let ctxBtn = document.getElementById("sx-context-btn");
        let perfBtn = document.getElementById("sx-perf-btn");
        const micWrapper = actionContainer.querySelector('div.flex.items-center:has(button[aria-label*="Record voice" i]), div.flex.items-center:has([data-tooltip-id*="record-tooltip"])') || actionContainer.querySelector('button[aria-label*="Record voice" i]');
        const sendBtn = actionContainer.querySelector('[data-testid="send-button"], button[aria-label*="send" i], [data-tooltip-id*="send-tooltip"]');
        const cancelBtn = actionContainer.querySelector('button[aria-label*="Cancel" i], [data-tooltip-id*="cancel-tooltip"]');
        const targetAnchor = micWrapper || sendBtn || cancelBtn;
        if (!ctxBtn) {
          ctxBtn = document.createElement("button");
          ctxBtn.id = "sx-context-btn";
          ctxBtn.type = "button";
          ctxBtn.title = "Context Window (T\u0131kla)";
          ctxBtn.style.cssText = `
                    display: inline-flex !important; align-items: center !important; justify-content: center !important;
                    width: 28px !important; height: 28px !important; border-radius: 50% !important; background: transparent !important;
                    border: none !important; padding: 0 !important; cursor: pointer !important; user-select: none !important;
                `;
          ctxBtn.onclick = (e) => {
            e.stopPropagation();
            this.quota.toggleContextPopover(ctxBtn);
          };
        }
        if (!perfBtn) {
          perfBtn = document.createElement("button");
          perfBtn.id = "sx-perf-btn";
          perfBtn.type = "button";
          perfBtn.title = "Model Performans\u0131 (TTFT, TPS) (T\u0131kla)";
          perfBtn.style.cssText = `
                    display: inline-flex !important; align-items: center !important; justify-content: center !important;
                    width: 28px !important; height: 28px !important; border-radius: 50% !important; background: transparent !important;
                    border: none !important; padding: 0 !important; cursor: pointer !important; user-select: none !important;
                `;
          perfBtn.innerHTML = `
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#94a3b8;">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                    </svg>
                `;
          perfBtn.onclick = (e) => {
            e.stopPropagation();
            this.perf.togglePerfPopover(perfBtn);
          };
        }
        if (targetAnchor && targetAnchor.parentElement === actionContainer) {
          if (targetAnchor.previousElementSibling !== ctxBtn) {
            actionContainer.insertBefore(ctxBtn, targetAnchor);
          }
        } else if (!actionContainer.contains(ctxBtn)) {
          actionContainer.appendChild(ctxBtn);
        }
        if (ctxBtn.previousElementSibling !== perfBtn) {
          actionContainer.insertBefore(perfBtn, ctxBtn);
        }
        this.quota.updateContextButtonUI();
        this.perf.updatePerfButtonUI();
      }
      this.trySXModelSelectorPanelInject();
      const trigger = document.querySelector('[data-testid="model-selector-trigger"]');
      if (trigger) {
        const sxModels = this.state.getModels();
        if (sxModels.length > 0) {
          const curConv = this.models.getActiveConversationKey();
          const activeId = this.models.getActiveModelForConversation(curConv);
          const activeM = sxModels.find((m) => m.id === activeId) || sxModels[0];
          if (activeM) {
            const pMeta = this.models.getProviderMeta(activeM.providerId);
            const s = trigger.querySelector(".truncate") || trigger.querySelector("span") || trigger;
            const desiredKey = activeM.id + "_" + pMeta.name;
            if (s && s.dataset.sxKey !== desiredKey) {
              s.dataset.sxKey = desiredKey;
              s.style.setProperty("display", "inline-flex", "important");
              s.style.setProperty("align-items", "center", "important");
              s.innerHTML = `
                            <span class="sx-prov-badge" style="display:inline-flex;align-items:center;gap:3.5px;padding:0.5px 5px;border-radius:4px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);font-size:9.5px;font-weight:700;color:${pMeta.color};margin-right:6px;"><span style="width:4px;height:4px;border-radius:50%;background:${pMeta.color};"></span>${this.sxEsc(pMeta.name)}</span>
                            <span style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600;color:rgba(255,255,255,0.95);">${this.sxEsc(activeM.name)}</span>
                        `;
              trigger.setAttribute("aria-label", `Select model, current: ${activeM.name}`);
            }
          }
        }
      }
      const quotaMenu = document.querySelector('[role="menu"][data-nested]');
      if (quotaMenu) {
        const span = quotaMenu.querySelector("span.text-foreground.truncate");
        if (span && (!span.dataset.sxFixed || !span.textContent.trim())) {
          span.dataset.sxFixed = "true";
          span.innerHTML = '<span style="color:#38bdf8;font-weight:700;">SX</span> <span style="color:#ffffff;">Development</span>';
        }
      }
      this.trySXModelsSettingsInject();
      this.trySXAppearanceSettingsInject();
    }
    trySXModelSelectorPanelInject() {
      const modelPanel = document.querySelector('[data-testid="model-selector-panel"]');
      if (!modelPanel || modelPanel.closest("[data-sx-usage-panel]")) return;
      const sxModels = this.state.getModels();
      if (!sxModels || sxModels.length === 0) return;
      let searchWrap = modelPanel.querySelector("#sx-model-search-wrap");
      if (!searchWrap) {
        searchWrap = document.createElement("div");
        searchWrap.id = "sx-model-search-wrap";
        searchWrap.style.cssText = "padding: 8px 8px 10px 8px; border-bottom: 1px solid rgba(255,255,255,0.06); background: inherit; position: sticky; top: 0; z-index: 10; box-sizing: border-box;";
        searchWrap.innerHTML = `
                <div style="display:flex;align-items:center;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:0 10px;gap:7px;height:32px;box-sizing:border-box;width:100%;transition:border-color 0.15s;">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:rgba(255,255,255,0.3);flex-shrink:0;">
                        <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    <input id="sx-model-search-input" type="text" placeholder="Search models..." style="background:transparent;border:none;outline:none;color:rgba(255,255,255,0.9);font-size:12.5px;width:100%;height:100%;font-family:inherit;line-height:normal;padding:0;margin:0;" autocomplete="off" spellcheck="false" />
                </div>
            `;
        modelPanel.prepend(searchWrap);
        const inputWrap = searchWrap.querySelector("div");
        const input = searchWrap.querySelector("#sx-model-search-input");
        input.addEventListener("focus", () => {
          inputWrap.style.borderColor = "rgba(255,255,255,0.25)";
          inputWrap.style.background = "rgba(255,255,255,0.07)";
        });
        input.addEventListener("blur", () => {
          inputWrap.style.borderColor = "rgba(255,255,255,0.1)";
          inputWrap.style.background = "rgba(255,255,255,0.05)";
        });
        ["keydown", "keyup", "keypress"].forEach((evt) => {
          input.addEventListener(evt, (e) => e.stopPropagation());
        });
        input.addEventListener("input", () => {
          const q = input.value.trim().toLowerCase();
          const items = modelPanel.querySelectorAll(".sx-custom-model-item");
          let visibleCount = 0;
          items.forEach((item) => {
            const lbl = (item.getAttribute("data-model-label") || item.innerText || "").toLowerCase();
            const match = !q || lbl.includes(q);
            item.classList.toggle("is-hidden", !match);
            if (match) visibleCount++;
          });
          modelPanel.querySelectorAll(".sx-provider-header").forEach((hdr) => {
            const pId = hdr.getAttribute("data-provider-id");
            const hasVisible = Array.from(modelPanel.querySelectorAll(`.sx-custom-model-item[data-sx-provider="${pId}"]`)).some((it) => !it.classList.contains("is-hidden"));
            hdr.style.display = hasVisible ? "flex" : "none";
          });
          let emptyMsg = modelPanel.querySelector("#sx-model-search-empty");
          if (visibleCount === 0) {
            if (!emptyMsg) {
              emptyMsg = document.createElement("div");
              emptyMsg.id = "sx-model-search-empty";
              emptyMsg.style.cssText = "padding: 16px 10px; font-size: 11.5px; color: rgba(255,255,255,0.3); text-align: center;";
              emptyMsg.innerText = "No matching models found";
              modelPanel.querySelector(".overflow-y-auto")?.appendChild(emptyMsg);
            }
            emptyMsg.style.setProperty("display", "block", "important");
          } else if (emptyMsg) {
            emptyMsg.style.setProperty("display", "none", "important");
          }
        });
        setTimeout(() => input.focus(), 50);
      }
      const defaultHeader = modelPanel.querySelector('[data-testid="model-selector-header"]');
      if (defaultHeader) defaultHeader.style.display = "none";
      const providers = this.state.getProviders();
      const listContainer = modelPanel.querySelector(".flex.flex-col.gap-px") || modelPanel.querySelector(".overflow-y-auto");
      if (listContainer) {
        const nativeItems = Array.from(listContainer.querySelectorAll('[data-testid="model-selector-item"]:not(.sx-custom-model-item)'));
        const sampleNative = nativeItems[0];
        nativeItems.forEach((item) => item.style.display = "none");
        if (!document.getElementById("sx-custom-model-style")) {
          const st = document.createElement("style");
          st.id = "sx-custom-model-style";
          st.textContent = `
                    .sx-custom-model-item {
                        height: 27px !important;
                        min-height: 27px !important;
                        padding: 0 8px !important;
                        margin: 1px 0 !important;
                        border-radius: 5px !important;
                        cursor: pointer !important;
                        user-select: none !important;
                        display: flex !important;
                        align-items: center !important;
                        transition: background-color 0.1s ease, color 0.1s ease !important;
                    }
                    .sx-custom-model-item.is-hidden {
                        display: none !important;
                    }
                    .sx-custom-model-item:hover {
                        background-color: rgba(255, 255, 255, 0.08) !important;
                    }
                    .sx-custom-model-item.is-selected {
                        background-color: rgba(255, 255, 255, 0.05) !important;
                        font-weight: 500 !important;
                    }
                    .sx-custom-model-item .sx-model-title {
                        font-size: 12px !important;
                        line-height: normal !important;
                        color: rgba(255, 255, 255, 0.9) !important;
                        overflow: hidden !important;
                        text-overflow: ellipsis !important;
                        white-space: nowrap !important;
                        flex: 1 !important;
                        min-width: 0 !important;
                    }
                    .sx-provider-header {
                        padding: 8px 8px 3px 8px !important;
                        display: flex !important;
                        align-items: center !important;
                        gap: 6px !important;
                        margin-top: 4px !important;
                        border-top: 1px solid rgba(255, 255, 255, 0.04) !important;
                    }
                    .sx-provider-header:first-child {
                        margin-top: 0 !important;
                        border-top: none !important;
                    }
                `;
          document.head.appendChild(st);
        }
        const curConvKey = this.models.getActiveConversationKey();
        const activeId = this.models.getActiveModelForConversation(curConvKey);
        if (!listContainer.querySelector(".sx-custom-list-injected")) {
          const marker = document.createElement("div");
          marker.className = "sx-custom-list-injected";
          marker.style.display = "none";
          listContainer.appendChild(marker);
          const groups = {};
          providers.forEach((p) => {
            groups[p.id] = [];
          });
          groups["other"] = [];
          sxModels.forEach((m) => {
            const pId = m.providerId || "other";
            if (!groups[pId]) groups[pId] = [];
            groups[pId].push(m);
          });
          Object.keys(groups).forEach((pId) => {
            const groupModels = groups[pId];
            if (!groupModels || groupModels.length === 0) return;
            const pMeta = this.models.getProviderMeta(pId);
            const header = document.createElement("div");
            header.className = "sx-provider-header";
            header.setAttribute("data-provider-id", pId);
            header.innerHTML = `
                        <span style="width:6px;height:6px;border-radius:50%;background:${pMeta.color};display:inline-block;"></span>
                        <span style="font-size:10px;font-weight:700;color:${pMeta.color};text-transform:uppercase;letter-spacing:0.5px;">${this.sxEsc(pMeta.name)}</span>
                    `;
            listContainer.appendChild(header);
            groupModels.forEach((m) => {
              const isSelected = m.id === activeId;
              const isVision = this.models.isVisionModel(m);
              const isReasoning = (m.modelId || m.name || "").toLowerCase().includes("reasoning") || (m.modelId || "").includes("omni") || (m.modelId || "").includes("r1");
              const item = document.createElement("div");
              item.className = "sx-custom-model-item" + (isSelected ? " is-selected" : "");
              item.dataset.modelId = m.id;
              item.dataset.modelLabel = m.name;
              item.dataset.sxProvider = pId;
              let rightBadges = "";
              let ctxTag = this.models.formatContextSize(m.contextLength);
              if (!ctxTag) {
                const mLow = (m.modelId || m.name || "").toLowerCase();
                if (mLow.includes("1m") || mLow.includes("ultra")) ctxTag = "1M";
                else if (mLow.includes("256k") || mLow.includes("pro")) ctxTag = "256k";
                else if (mLow.includes("128k")) ctxTag = "128k";
              }
              if (ctxTag) {
                rightBadges += `<span style="font-size:8.5px;font-weight:700;letter-spacing:0.2px;color:#a3e635;background:rgba(163,230,53,0.08);border:1px solid rgba(163,230,53,0.22);padding:0.5px 4px;border-radius:3px;line-height:normal;margin-right:4px;">${ctxTag}</span>`;
              }
              if (isReasoning) {
                rightBadges += `<span style="font-size:8.5px;font-weight:600;letter-spacing:0.2px;color:#fbbf24;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);padding:0.5px 4px;border-radius:3px;line-height:normal;margin-right:4px;">Reasoning</span>`;
              }
              if (isVision) {
                rightBadges += `<span style="font-size:8.5px;font-weight:600;letter-spacing:0.2px;color:#38bdf8;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.2);padding:0.5px 4px;border-radius:3px;line-height:normal;margin-right:4px;">Vision</span>`;
              }
              if (m.supportsTools === true) {
                rightBadges += `<span style="font-size:8.5px;font-weight:600;letter-spacing:0.2px;color:#fb923c;background:rgba(251,146,60,0.08);border:1px solid rgba(251,146,60,0.2);padding:0.5px 4px;border-radius:3px;line-height:normal;margin-right:4px;">Tools</span>`;
              }
              const checkSvg = `<svg class="sx-item-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="color:rgba(255,255,255,0.95);margin-left:4px;flex-shrink:0;${isSelected ? "" : "visibility:hidden;"}"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
              item.innerHTML = `
                            <span class="sx-model-title">${this.sxEsc(m.name)}</span>
                            <div style="display:flex;align-items:center;margin-left:auto;flex-shrink:0;">${rightBadges}${checkSvg}</div>
                        `;
              item.addEventListener("click", () => {
                const cKey = this.models.getActiveConversationKey();
                this.models.setActiveModelForConversation(m.id, cKey, true);
                listContainer.querySelectorAll(".sx-custom-model-item").forEach((el) => {
                  el.classList.remove("is-selected");
                  const c2 = el.querySelector(".sx-item-check");
                  if (c2) c2.style.visibility = "hidden";
                });
                item.classList.add("is-selected");
                const c = item.querySelector(".sx-item-check");
                if (c) c.style.visibility = "visible";
                this.quota?.updateContextButtonUI();
                if (sampleNative) sampleNative.click();
                setTimeout(() => this.hookDOM(), 30);
              });
              listContainer.appendChild(item);
            });
          });
        } else {
          listContainer.querySelectorAll(".sx-custom-model-item").forEach((el) => {
            const sel = el.dataset.modelId === activeId;
            el.classList.toggle("is-selected", sel);
            const c = el.querySelector(".sx-item-check");
            if (c) c.style.visibility = sel ? "visible" : "hidden";
          });
        }
      }
      let fBadge = document.getElementById("sx-panel-footer-badge");
      if (!fBadge) {
        fBadge = document.createElement("div");
        fBadge.id = "sx-panel-footer-badge";
        fBadge.style.cssText = "margin-top:4px;padding:6px 10px;border-top:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;font-size:10.5px;user-select:none;";
        modelPanel.appendChild(fBadge);
      }
      fBadge.innerHTML = '<span style="font-weight:700;"><span style="color:#38bdf8;text-shadow:0 0 10px rgba(56,189,248,0.35);">SX</span> <span style="color:#ffffff;">Development</span></span><span style="font-size:9.5px;color:rgba(255,255,255,0.35);font-weight:500;">Custom Engine</span>';
    }
  };

  // src/services/ModelMetaResolver.js
  var LOCAL_KB = {
    // OpenAI
    "gpt-4o": { contextLength: 131072, supportsImages: true, supportsTools: true },
    "gpt-4o-mini": { contextLength: 131072, supportsImages: true, supportsTools: true },
    "gpt-4.1": { contextLength: 1047576, supportsImages: true, supportsTools: true },
    "gpt-4.1-mini": { contextLength: 1047576, supportsImages: true, supportsTools: true },
    "gpt-4.1-nano": { contextLength: 1047576, supportsImages: true, supportsTools: true },
    "gpt-4-turbo": { contextLength: 131072, supportsImages: true, supportsTools: true },
    "gpt-4-turbo-preview": { contextLength: 131072, supportsImages: true, supportsTools: true },
    "gpt-4": { contextLength: 8192, supportsImages: false, supportsTools: true },
    "gpt-3.5-turbo": { contextLength: 16385, supportsImages: false, supportsTools: true },
    "gpt-3.5-turbo-16k": { contextLength: 16385, supportsImages: false, supportsTools: true },
    "o1": { contextLength: 2e5, supportsImages: true, supportsTools: true },
    "o1-mini": { contextLength: 131072, supportsImages: false, supportsTools: false },
    "o1-preview": { contextLength: 131072, supportsImages: false, supportsTools: false },
    "o3": { contextLength: 2e5, supportsImages: true, supportsTools: true },
    "o3-mini": { contextLength: 2e5, supportsImages: false, supportsTools: true },
    "o4-mini": { contextLength: 2e5, supportsImages: true, supportsTools: true },
    // Anthropic
    "claude-3-7-sonnet": { contextLength: 2e5, supportsImages: true, supportsTools: true },
    "claude-3-7-sonnet-latest": { contextLength: 2e5, supportsImages: true, supportsTools: true },
    "claude-3-5-sonnet": { contextLength: 2e5, supportsImages: true, supportsTools: true },
    "claude-3-5-sonnet-latest": { contextLength: 2e5, supportsImages: true, supportsTools: true },
    "claude-3-5-haiku": { contextLength: 2e5, supportsImages: true, supportsTools: true },
    "claude-3-opus": { contextLength: 2e5, supportsImages: true, supportsTools: true },
    "claude-3-sonnet": { contextLength: 2e5, supportsImages: true, supportsTools: true },
    "claude-3-haiku": { contextLength: 2e5, supportsImages: true, supportsTools: true },
    "claude-sonnet-4": { contextLength: 2e5, supportsImages: true, supportsTools: true },
    "claude-opus-4": { contextLength: 2e5, supportsImages: true, supportsTools: true },
    "claude-opus-4-1": { contextLength: 2e5, supportsImages: true, supportsTools: true },
    "claude-opus-4-5": { contextLength: 2e5, supportsImages: true, supportsTools: true },
    "claude-sonnet-4-5": { contextLength: 2e5, supportsImages: true, supportsTools: true },
    "claude-haiku-4-5": { contextLength: 2e5, supportsImages: true, supportsTools: true },
    // Google
    "gemini-2.5-pro": { contextLength: 1048576, supportsImages: true, supportsTools: true },
    "gemini-2.5-flash": { contextLength: 1048576, supportsImages: true, supportsTools: true },
    "gemini-2.5-flash-lite": { contextLength: 1048576, supportsImages: true, supportsTools: true },
    "gemini-2.0-flash": { contextLength: 1048576, supportsImages: true, supportsTools: true },
    "gemini-2.0-flash-lite": { contextLength: 1048576, supportsImages: true, supportsTools: true },
    "gemini-1.5-pro": { contextLength: 2097152, supportsImages: true, supportsTools: true },
    "gemini-1.5-flash": { contextLength: 1048576, supportsImages: true, supportsTools: true },
    "gemini-1.5-flash-8b": { contextLength: 1048576, supportsImages: true, supportsTools: true },
    // DeepSeek
    "deepseek-chat": { contextLength: 65536, supportsImages: false, supportsTools: true },
    "deepseek-reasoner": { contextLength: 65536, supportsImages: false, supportsTools: true },
    "deepseek-coder": { contextLength: 131072, supportsImages: false, supportsTools: true },
    // Meta
    "llama-3.3-70b-instruct": { contextLength: 131072, supportsImages: false, supportsTools: true },
    "llama-3.1-405b-instruct": { contextLength: 131072, supportsImages: false, supportsTools: true },
    "llama-3.1-70b-instruct": { contextLength: 131072, supportsImages: false, supportsTools: true },
    "llama-3.1-8b-instruct": { contextLength: 131072, supportsImages: false, supportsTools: true },
    "llama-3.2-11b-vision": { contextLength: 131072, supportsImages: true, supportsTools: true },
    "llama-3.2-90b-vision": { contextLength: 131072, supportsImages: true, supportsTools: true },
    // Mistral
    "mistral-large": { contextLength: 131072, supportsImages: false, supportsTools: true },
    "mistral-medium": { contextLength: 32768, supportsImages: false, supportsTools: true },
    "mistral-small": { contextLength: 32768, supportsImages: false, supportsTools: true },
    "pixtral-large": { contextLength: 131072, supportsImages: true, supportsTools: true },
    "codestral": { contextLength: 262144, supportsImages: false, supportsTools: true },
    // Qwen
    "qwen-2.5-72b-instruct": { contextLength: 131072, supportsImages: false, supportsTools: true },
    "qwen-2.5-coder-32b": { contextLength: 131072, supportsImages: false, supportsTools: true },
    "qwen2.5-vl-72b-instruct": { contextLength: 131072, supportsImages: true, supportsTools: true },
    "qwen3-235b-a22b": { contextLength: 131072, supportsImages: false, supportsTools: true },
    "qwq-32b": { contextLength: 131072, supportsImages: false, supportsTools: true },
    // xAI
    "grok-2": { contextLength: 131072, supportsImages: true, supportsTools: true },
    "grok-3": { contextLength: 131072, supportsImages: true, supportsTools: true },
    "grok-4": { contextLength: 2e6, supportsImages: true, supportsTools: true },
    // Cohere
    "command-r": { contextLength: 131072, supportsImages: false, supportsTools: true },
    "command-r-plus": { contextLength: 131072, supportsImages: false, supportsTools: true },
    "command-a": { contextLength: 262144, supportsImages: false, supportsTools: true },
    // Perplexity
    "sonar": { contextLength: 131072, supportsImages: false, supportsTools: true },
    "sonar-pro": { contextLength: 2e5, supportsImages: false, supportsTools: true },
    "sonar-reasoning": { contextLength: 131072, supportsImages: false, supportsTools: true },
    "sonar-reasoning-pro": { contextLength: 2e5, supportsImages: false, supportsTools: true },
    // Amazon
    "nova-pro": { contextLength: 3e5, supportsImages: true, supportsTools: true },
    "nova-lite": { contextLength: 3e5, supportsImages: true, supportsTools: true },
    "nova-micro": { contextLength: 131072, supportsImages: false, supportsTools: true },
    // Moonshot / Kimi
    "kimi-k2": { contextLength: 262144, supportsImages: false, supportsTools: true },
    // MiniMax
    "minimax-m1": { contextLength: 2e5, supportsImages: false, supportsTools: true },
    // Zhipu / GLM
    "glm-4-plus": { contextLength: 131072, supportsImages: false, supportsTools: true },
    "glm-4.5": { contextLength: 131072, supportsImages: false, supportsTools: true },
    "glm-4.6": { contextLength: 2e5, supportsImages: false, supportsTools: true },
    // Microsoft
    "phi-4": { contextLength: 16384, supportsImages: false, supportsTools: true },
    // Google older
    "gemma-2-27b": { contextLength: 8192, supportsImages: false, supportsTools: false },
    "gemma-2-9b": { contextLength: 8192, supportsImages: false, supportsTools: false }
  };
  var ZEN_META = {
    // GPT-5.x / 6 family — ≤272K tier in pricing table
    "gpt-6-astra": { ctx: 272e3, vis: true, tools: true },
    "gpt-5.6-sol": { ctx: 272e3, vis: true, tools: true },
    "gpt-5.6-terra": { ctx: 272e3, vis: true, tools: true },
    "gpt-5.6-luna": { ctx: 272e3, vis: true, tools: true },
    "gpt-5.5": { ctx: 105e4, vis: true, tools: true },
    "gpt-5.5-pro": { ctx: 272e3, vis: true, tools: true },
    "gpt-5.4": { ctx: 272e3, vis: true, tools: true },
    "gpt-5.4-pro": { ctx: 272e3, vis: true, tools: true },
    "gpt-5.4-mini": { ctx: 272e3, vis: true, tools: true },
    "gpt-5.4-nano": { ctx: 272e3, vis: true, tools: true },
    "gpt-5.3-codex": { ctx: 272e3, vis: true, tools: true },
    "gpt-5.3-codex-spark": { ctx: 272e3, vis: true, tools: true },
    "gpt-5.2": { ctx: 272e3, vis: true, tools: true },
    "gpt-5.2-codex": { ctx: 272e3, vis: true, tools: true },
    "gpt-5.1": { ctx: 272e3, vis: true, tools: true },
    "gpt-5.1-codex": { ctx: 272e3, vis: true, tools: true },
    "gpt-5.1-codex-max": { ctx: 272e3, vis: true, tools: true },
    "gpt-5.1-codex-mini": { ctx: 272e3, vis: true, tools: true },
    "gpt-5": { ctx: 272e3, vis: true, tools: true },
    "gpt-5-codex": { ctx: 272e3, vis: true, tools: true },
    "gpt-5-nano": { ctx: 272e3, vis: true, tools: true },
    // Claude family — 200K standard (sonnet-4.5 row shows ≤200K/>200K split)
    "claude-fable-5": { ctx: 2e5, vis: true, tools: true },
    "claude-fable-5-1": { ctx: 2e5, vis: true, tools: true },
    "claude-opus-5": { ctx: 2e5, vis: true, tools: true },
    "claude-opus-4-8": { ctx: 2e5, vis: true, tools: true },
    "claude-opus-4-7": { ctx: 2e5, vis: true, tools: true },
    "claude-opus-4-6": { ctx: 2e5, vis: true, tools: true },
    "claude-opus-4-5": { ctx: 2e5, vis: true, tools: true },
    "claude-sonnet-5": { ctx: 2e5, vis: true, tools: true },
    "claude-sonnet-4-6": { ctx: 2e5, vis: true, tools: true },
    "claude-sonnet-4-5": { ctx: 2e5, vis: true, tools: true },
    "claude-sonnet-4": { ctx: 2e5, vis: true, tools: true },
    "claude-haiku-4-5": { ctx: 2e5, vis: true, tools: true },
    // Gemini family — 1M standard
    "gemini-3.8-flash": { ctx: 1048576, vis: true, tools: true },
    "gemini-3.7-flash": { ctx: 1048576, vis: true, tools: true },
    "gemini-3.6-flash": { ctx: 1048576, vis: true, tools: true },
    "gemini-3.5-flash": { ctx: 1048576, vis: true, tools: true },
    "gemini-3.5-flash-lite": { ctx: 1048576, vis: true, tools: true },
    "gemini-3.1-pro": { ctx: 1048576, vis: true, tools: true },
    "gemini-3-flash": { ctx: 1048576, vis: true, tools: true },
    // Grok — Zen serving caps (models.dev opencode section)
    "grok-4.7": { ctx: 2e5, vis: true, tools: true },
    "grok-4.6": { ctx: 5e5, vis: true, tools: true },
    "grok-4.5": { ctx: 5e5, vis: true, tools: true },
    "grok-build-0.1": { ctx: 256e3, vis: true, tools: true },
    // Xiaomi MiMo — Zen serving caps (models.dev opencode section); base rows stay vendor-native
    "mimo-v2.6-flash-free": { ctx: 2e5, vis: true, tools: true },
    "mimo-v2.6-flash": { ctx: 262144, vis: false, tools: true },
    "mimo-v2.5-free": { ctx: 2e5, vis: true, tools: true },
    "mimo-v2.5": { ctx: 1048576, vis: true, tools: true },
    // Muse Spark (Meta Model API) — 1M multimodal + parallel tool calls
    "muse-spark-1.3": { ctx: 1048576, vis: true, tools: true },
    "muse-spark-1.2": { ctx: 1048576, vis: true, tools: true },
    "muse-spark-1.3-contributor-free": { ctx: 1048576, vis: true, tools: true },
    "muse-spark-1.2-contributor-free": { ctx: 1048576, vis: true, tools: true },
    // DeepSeek V4 family — Zen serving caps (free tier capped at 200K)
    "deepseek-v4.1-flash": { ctx: 1048576, vis: true, tools: true },
    "deepseek-v4-pro": { ctx: 1048576, vis: false, tools: true },
    "deepseek-v4-flash": { ctx: 1048576, vis: false, tools: true },
    "deepseek-v4-flash-free": { ctx: 2e5, vis: false, tools: true },
    "deepseek-v4-flash-vision-exp": { ctx: 1048576, vis: true, tools: true },
    // Ling-3.0 (AntLing/InclusionAI) — 256K, text in/out
    "ling-3.0-flash-fin-free": { ctx: 262144, vis: false, tools: true },
    // NVIDIA Nemotron 3 — Zen serving caps (lightning-free capped at 256K)
    "nemotron-3-ultra-free": { ctx: 1048576, vis: false, tools: true },
    "nemotron-3.5-lightning-free": { ctx: 262144, vis: false, tools: true },
    // Big Pickle — 200K text-only stealth (models.dev)
    "big-pickle": { ctx: 2e5, vis: false, tools: true },
    // Qwen on Zen — serving caps (models.dev opencode section)
    "qwen3.8-flash": { ctx: 1e6, vis: true, tools: true },
    "qwen3.5-plus": { ctx: 262144, vis: true, tools: true },
    "qwen3.6-plus": { ctx: 262144, vis: true, tools: true },
    // Kimi / GLM / MiniMax on Zen — serving caps
    "kimi-k2.5": { ctx: 262144, vis: true, tools: true },
    "glm-5.2": { ctx: 1e6, vis: false, tools: true },
    "minimax-m2.7": { ctx: 204800, vis: false, tools: true },
    // Jev — /systemone eval model, no tool calls, no images
    "jev-1.13": { ctx: 0, vis: false, tools: false },
    "jev-1.13-free": { ctx: 0, vis: false, tools: false }
  };
  var VISION_NAME_RE = /(?:^|[\/\-_.])(?:vl|vision|4o|omni|gemini|gemma|pixtral|llava|paligemma|vision[-_]?pro|llama[-_]?3\.2[-_].*vision)/i;
  var NO_VISION_NAME_RE = /(?:^|[\/\-_.])(?:code|coder|embedding|audio|transcribe|tts|whisper|rerank)/i;
  var NO_TOOLS_NAME_RE = /(?:^|[\/\-_.])(?:embedding|whisper|tts|transcribe|rerank|moderation|audio)/i;
  var MODELSDEV_URL = "https://models.dev/api.json";
  var OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
  var MODELSDEV_CACHE_KEY = "sx_modelsdev_v1";
  var OR_CACHE_KEY = "sx_openrouter_v1";
  var CATALOG_CACHE_TTL = 24 * 60 * 60 * 1e3;
  var ModelMetaResolver = class {
    constructor(networkClient, logger) {
      this.network = networkClient;
      this.logger = logger;
      this._orCatalog = null;
      this._orCatalogRaw = null;
      this._orPromise = null;
      this._orLoadedAt = 0;
      this._zenSet = null;
      this._zenPromise = null;
      this._zenLoadedAt = 0;
      this._mdExact = null;
      this._mdNorm = null;
      this._mdPromise = null;
      this._mdLoadedAt = 0;
    }
    _cacheGet(key) {
      try {
        if (typeof localStorage === "undefined") return null;
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const o = JSON.parse(raw);
        if (!o || !o.ts || !Array.isArray(o.rows)) return null;
        if (Date.now() - o.ts > CATALOG_CACHE_TTL) return null;
        return o.rows;
      } catch (e) {
        return null;
      }
    }
    _cacheSet(key, rows) {
      try {
        if (typeof localStorage === "undefined") return;
        localStorage.setItem(key, JSON.stringify({ ts: Date.now(), rows }));
      } catch (e) {
      }
    }
    /** Compact row [id, ctx, vis(-1/0/1), tools(-1/0/1), name] -> meta object. */
    _expandRow(r) {
      const o = {};
      if (r[1] > 0) o.contextLength = r[1];
      if (r[2] === 1) o.supportsImages = true;
      else if (r[2] === 0) o.supportsImages = false;
      if (r[3] === 1) o.supportsTools = true;
      else if (r[3] === 0) o.supportsTools = false;
      if (r[4]) o.name = r[4];
      return o;
    }
    _indexRows(rows) {
      const exact = /* @__PURE__ */ new Map();
      const norm = /* @__PURE__ */ new Map();
      for (const r of rows) {
        const id = String(r[0] || "").toLowerCase();
        if (!id) continue;
        const meta = this._expandRow(r);
        if (!exact.has(id)) exact.set(id, meta);
        const base = id.split("/").pop();
        if (base && base !== id && !exact.has(base)) exact.set(base, meta);
        for (const k of [this.normalizeKey(id), this.normalizeKey(base)]) {
          if (k && !norm.has(k)) norm.set(k, meta);
        }
      }
      return { exact, norm };
    }
    /** Last-resort fuzzy: prefix overlap between query and catalog keys. */
    _fuzzyLookup(map, q) {
      if (!map || !q || q.length < 10) return null;
      let best = null;
      for (const k of map.keys()) {
        if (k === q) return map.get(k);
        if (k.startsWith(q)) {
          if (!best || k.length < best.k.length) best = { k, v: map.get(k) };
        } else if (q.startsWith(k) && k.length >= 10) {
          if (!best || k.length > best.k.length) best = { k, v: map.get(k) };
        }
      }
      return best ? best.v : null;
    }
    /** Normalize model id for fuzzy matching across providers/catalogs. */
    normalizeKey(id) {
      let s = String(id || "").toLowerCase().trim();
      if (!s) return "";
      s = s.replace(/^(openai|anthropic|google|meta|meta-llama|mistralai|mistral|deepseek|qwen|amazon|cohere|perplexity|together|fireworks|groq|x-ai|xai|openrouter|nvidia|microsoft|ai21|liquid|z-ai|zhipu|moonshotai|moonshot|minimax|stepfun|qwen)\//, "");
      s = s.replace(/[-_]?20\d{6}$/, "");
      s = s.replace(/[-_]?20\d{2}[-_]?\d{2}[-_]?\d{2}$/, "");
      s = s.replace(/[-_.]?(latest|free|experimental|instruct|preview|chat|thinking|turbo)$/g, "");
      s = s.replace(/[\s_]+/g, "-");
      s = s.replace(/\.(\d)/g, "-$1");
      s = s.replace(/-+/g, "-").replace(/^-|-$/g, "");
      return s;
    }
    _kbLookup(modelId) {
      const raw = String(modelId || "").toLowerCase();
      if (!raw) return null;
      if (LOCAL_KB[raw]) return LOCAL_KB[raw];
      const key = this.normalizeKey(modelId);
      if (LOCAL_KB[key]) return LOCAL_KB[key];
      const basename = raw.split("/").pop();
      if (LOCAL_KB[basename]) return LOCAL_KB[basename];
      const baseKey = this.normalizeKey(basename);
      if (LOCAL_KB[baseKey]) return LOCAL_KB[baseKey];
      if (key.length >= 6) {
        const hits = Object.keys(LOCAL_KB).filter((k) => k.includes(key) || key.includes(k));
        if (hits.length === 1) return LOCAL_KB[hits[0]];
        let best = null;
        for (const k of Object.keys(LOCAL_KB)) {
          if (key.includes(k) && (!best || k.length > best.length)) best = k;
        }
        if (best) return LOCAL_KB[best];
      }
      return null;
    }
    /** Doc-verified Zen metadata by exact/normalized id. Returns {contextLength?, supportsImages?, supportsTools?}. */
    _zenLookup(modelId) {
      const raw = String(modelId || "").toLowerCase().trim();
      if (!raw) return null;
      const cands = [raw, this.normalizeKey(modelId)];
      const base = raw.split("/").pop();
      if (base && base !== raw) cands.push(base, this.normalizeKey(base));
      for (const c of cands) {
        const row = c && ZEN_META[c];
        if (row) {
          const out = {};
          if (Number(row.ctx) > 0) out.contextLength = Number(row.ctx);
          if (typeof row.vis === "boolean") out.supportsImages = row.vis;
          if (typeof row.tools === "boolean") out.supportsTools = row.tools;
          out.metaSource = "zen";
          return out;
        }
      }
      return null;
    }
    /** Live Zen catalog (auth-free). Used to confirm a model id exists on Zen. */
    async ensureZenCatalog(force = false) {
      const maxAge = 12 * 60 * 60 * 1e3;
      if (!force && this._zenSet && Date.now() - this._zenLoadedAt < maxAge) return this._zenSet;
      if (this._zenPromise && !force) return this._zenPromise;
      this._zenPromise = (async () => {
        try {
          const resp = await this.network.proxyFetch("https://opencode.ai/zen/v1/models", "GET", {});
          if (!resp.ok) throw new Error("HTTP " + resp.status);
          const data = await resp.json();
          const list = Array.isArray(data?.data) ? data.data : [];
          const set = new Set(list.map((m) => String(m?.id || "").toLowerCase()).filter(Boolean));
          this._zenSet = set;
          this._zenLoadedAt = Date.now();
          this.logger?.info?.("ModelMetaResolver", `Zen catalog loaded: ${set.size} models`);
          return set;
        } catch (e) {
          this.logger?.warn?.("ModelMetaResolver", "Zen catalog failed", e.message);
          this._zenPromise = null;
          return null;
        }
      })();
      return this._zenPromise;
    }
    isZenModel(modelId) {
      if (!this._zenSet || !modelId) return false;
      return this._zenSet.has(String(modelId).toLowerCase());
    }
    async ensureOpenRouterCatalog(force = false) {
      if (!force && this._orCatalog && Date.now() - this._orLoadedAt < CATALOG_CACHE_TTL) return this._orCatalog;
      if (this._orPromise && !force) return this._orPromise;
      this._orPromise = (async () => {
        const cached = this._cacheGet(OR_CACHE_KEY);
        if (cached && cached.length) {
          const { exact, norm } = this._indexRows(cached);
          this._orCatalogRaw = exact;
          this._orCatalog = norm;
          this._orLoadedAt = Date.now();
          this.logger?.info?.("ModelMetaResolver", `OpenRouter catalog from cache: ${exact.size} models`);
          return this._orCatalog;
        }
        try {
          const resp = await this.network.proxyFetch(OPENROUTER_MODELS_URL, "GET", {});
          if (!resp.ok) throw new Error("HTTP " + resp.status);
          const data = await resp.json();
          const list = Array.isArray(data?.data) ? data.data : [];
          const rows = list.filter((m) => m?.id).map((m) => {
            const meta = this._fromOpenRouterItem(m);
            const id = String(m.id).toLowerCase();
            return [
              id,
              meta.contextLength || 0,
              typeof meta.supportsImages === "boolean" ? meta.supportsImages ? 1 : 0 : -1,
              typeof meta.supportsTools === "boolean" ? meta.supportsTools ? 1 : 0 : -1,
              String(m.name || "").slice(0, 120)
            ];
          });
          this._cacheSet(OR_CACHE_KEY, rows);
          const { exact, norm } = this._indexRows(rows);
          this._orCatalogRaw = exact;
          this._orCatalog = norm;
          this._orLoadedAt = Date.now();
          this.logger?.info?.("ModelMetaResolver", `OpenRouter catalog loaded: ${exact.size} models`);
          return this._orCatalog;
        } catch (e) {
          this.logger?.warn?.("ModelMetaResolver", "OpenRouter catalog failed", e.message);
          this._orPromise = null;
          return null;
        }
      })();
      return this._orPromise;
    }
    /** Parse models.dev api.json into compact rows. Pure — unit testable. */
    _parseModelsDev(data) {
      const rows = [];
      if (!data || typeof data !== "object") return rows;
      for (const pkey of Object.keys(data)) {
        const models = data[pkey]?.models;
        if (!models || typeof models !== "object") continue;
        for (const mkey of Object.keys(models)) {
          const m = models[mkey];
          if (!m || typeof m !== "object") continue;
          const id = String(m.id || mkey || "").toLowerCase();
          if (!id) continue;
          const ctxRaw = Number(m.limit?.context);
          const ctx = Number.isFinite(ctxRaw) && ctxRaw >= 1e3 ? Math.round(ctxRaw) : 0;
          let vis = -1;
          const ins = Array.isArray(m.modalities?.input) ? m.modalities.input.map((x) => String(x).toLowerCase()) : [];
          if (ins.includes("image")) vis = 1;
          else if (ins.length && ins.every((x) => x === "text")) vis = 0;
          const tools = typeof m.tool_call === "boolean" ? m.tool_call ? 1 : 0 : -1;
          rows.push([id, ctx, vis, tools, String(m.name || "").slice(0, 120)]);
        }
      }
      return rows;
    }
    /** models.dev catalog (7954 models incl. exact opencode/Zen ids). Cached 24h. */
    async ensureModelsDev(force = false) {
      if (!force && this._mdExact && Date.now() - this._mdLoadedAt < CATALOG_CACHE_TTL) return this._mdExact;
      if (this._mdPromise && !force) return this._mdPromise;
      this._mdPromise = (async () => {
        const cached = this._cacheGet(MODELSDEV_CACHE_KEY);
        if (cached && cached.length) {
          const { exact, norm } = this._indexRows(cached);
          this._mdExact = exact;
          this._mdNorm = norm;
          this._mdLoadedAt = Date.now();
          this.logger?.info?.("ModelMetaResolver", `models.dev catalog from cache: ${exact.size} models`);
          return this._mdExact;
        }
        try {
          const resp = await this.network.proxyFetch(MODELSDEV_URL, "GET", {});
          if (!resp.ok) throw new Error("HTTP " + resp.status);
          const data = await resp.json();
          const rows = this._parseModelsDev(data);
          if (!rows.length) throw new Error("empty models.dev payload");
          this._cacheSet(MODELSDEV_CACHE_KEY, rows);
          const { exact, norm } = this._indexRows(rows);
          this._mdExact = exact;
          this._mdNorm = norm;
          this._mdLoadedAt = Date.now();
          this.logger?.info?.("ModelMetaResolver", `models.dev catalog loaded: ${exact.size} models`);
          return this._mdExact;
        } catch (e) {
          this.logger?.warn?.("ModelMetaResolver", "models.dev catalog failed", e.message);
          this._mdPromise = null;
          return null;
        }
      })();
      return this._mdPromise;
    }
    lookupModelsDev(modelId) {
      if (!this._mdExact) return null;
      const raw = String(modelId || "").toLowerCase();
      if (!raw) return null;
      if (this._mdExact.has(raw)) return this._mdExact.get(raw);
      const base = raw.split("/").pop();
      if (base && base !== raw && this._mdExact.has(base)) return this._mdExact.get(base);
      const key = this.normalizeKey(modelId);
      if (key && this._mdNorm.has(key)) return this._mdNorm.get(key);
      const bk = this.normalizeKey(base);
      if (bk && bk !== key && this._mdNorm.has(bk)) return this._mdNorm.get(bk);
      return this._fuzzyLookup(this._mdNorm, key) || this._fuzzyLookup(this._mdNorm, bk);
    }
    _fromOpenRouterItem(m) {
      const out = {};
      const ctx = Number(m.context_length || m.context_window || 0);
      if (Number.isFinite(ctx) && ctx >= 1e3) out.contextLength = Math.round(ctx);
      const modality = String(m.architecture?.modality || "").toLowerCase();
      const inMods = Array.isArray(m.architecture?.input_modalities) ? m.architecture.input_modalities.join(",").toLowerCase() : "";
      const hay = `${modality},${inMods}`;
      if (hay.includes("image") || hay.includes("vision")) out.supportsImages = true;
      else if (hay.includes("text")) out.supportsImages = false;
      const params = Array.isArray(m.supported_parameters) ? m.supported_parameters.join(",").toLowerCase() : "";
      if (params.includes("tool") || params.includes("function")) out.supportsTools = true;
      else if (params) out.supportsTools = false;
      if (m.name) out.name = m.name;
      return out;
    }
    async lookupOnline(modelId) {
      await this.ensureOpenRouterCatalog();
      if (!this._orCatalogRaw) return null;
      const raw = String(modelId || "").toLowerCase();
      if (this._orCatalogRaw.has(raw)) return this._orCatalogRaw.get(raw);
      const key = this.normalizeKey(modelId);
      if (key && this._orCatalog.has(key)) return this._orCatalog.get(key);
      const base = raw.split("/").pop();
      if (this._orCatalogRaw.has(base)) return this._orCatalogRaw.get(base);
      const bk = this.normalizeKey(base);
      if (bk && this._orCatalog.has(bk)) return this._orCatalog.get(bk);
      return this._fuzzyLookup(this._orCatalog, key) || this._fuzzyLookup(this._orCatalog, bk);
    }
    /**
     * Merge metadata layers into a model-like object.
     * Priority: explicit fields on input > Zen doc table > provider-shaped fields already on input
     *           > local KB > OpenRouter catalog (async) > name heuristics.
     * Unknown context is left 0 — never faked.
     */
    enrich(input, { online = true } = {}) {
      const out = { ...input || {} };
      const id = out.modelId || out.id || "";
      const name = out.name || "";
      const hasCtx = Number(out.contextLength) > 0;
      const hasVis = typeof out.supportsImages === "boolean";
      const hasTool = typeof out.supportsTools === "boolean";
      const apply = (src) => {
        if (!src) return false;
        let touched = false;
        if (!out.contextLength && Number(src.contextLength) > 0) {
          out.contextLength = Number(src.contextLength);
          touched = true;
        }
        if (typeof out.supportsImages !== "boolean" && typeof src.supportsImages === "boolean") {
          out.supportsImages = src.supportsImages;
          touched = true;
        }
        if (typeof out.supportsTools !== "boolean" && typeof src.supportsTools === "boolean") {
          out.supportsTools = src.supportsTools;
          touched = true;
        }
        if (!out.name && src.name) out.name = src.name;
        if (touched && src.metaSource && !out.metaSource) out.metaSource = src.metaSource;
        return touched;
      };
      apply(this._zenLookup(id) || this._zenLookup(name));
      apply(this._kbLookup(id) || this._kbLookup(name));
      if (typeof out.supportsImages !== "boolean") {
        if (VISION_NAME_RE.test(id) || VISION_NAME_RE.test(name)) {
          out.supportsImages = !NO_VISION_NAME_RE.test(id);
        }
      }
      if (typeof out.supportsTools !== "boolean") {
        if (NO_TOOLS_NAME_RE.test(id) || NO_TOOLS_NAME_RE.test(name)) out.supportsTools = false;
      }
      const missing = !(Number(out.contextLength) > 0 && typeof out.supportsImages === "boolean" && typeof out.supportsTools === "boolean");
      if (online && missing && id) {
      }
      if (hasCtx && hasVis && hasTool) out.metaSource = out.metaSource || "api";
      return out;
    }
    async enrichAsync(input, opts = {}) {
      const out = this.enrich(input, opts);
      const id = out.modelId || out.id || "";
      const need = () => ({
        c: !(Number(out.contextLength) > 0),
        v: typeof out.supportsImages !== "boolean",
        t: typeof out.supportsTools !== "boolean"
      });
      const fill = (src, tag) => {
        if (!src) return;
        const n = need();
        let touched = false;
        if (n.c && Number(src.contextLength) > 0) {
          out.contextLength = Number(src.contextLength);
          touched = true;
        }
        if (n.v && typeof src.supportsImages === "boolean") {
          out.supportsImages = src.supportsImages;
          touched = true;
        }
        if (n.t && typeof src.supportsTools === "boolean") {
          out.supportsTools = src.supportsTools;
          touched = true;
        }
        if (!out.name && src.name) out.name = src.name;
        if (touched && !out.metaSource) out.metaSource = tag;
      };
      if (opts.online !== false && id) {
        await this.ensureModelsDev().catch(() => null);
        let n = need();
        if (n.c || n.v || n.t) fill(this.lookupModelsDev(id), "modelsdev");
        n = need();
        if (n.c || n.v || n.t) fill(await this.lookupOnline(id), "openrouter");
      }
      if (!out.metaSource) {
        const kb = this._kbLookup(id);
        out.metaSource = kb ? "local" : typeof out.supportsImages === "boolean" || Number(out.contextLength) > 0 ? "partial" : "none";
      }
      return out;
    }
    async enrichList(list, opts = {}) {
      if (!Array.isArray(list) || !list.length) return list || [];
      if (opts.online !== false) {
        await Promise.all([
          this.ensureZenCatalog().catch(() => null),
          this.ensureModelsDev().catch(() => null),
          this.ensureOpenRouterCatalog().catch(() => null)
        ]);
      }
      const out = [];
      for (const item of list) {
        const e = await this.enrichAsync(item, opts);
        if (this._zenSet && !e.metaSourceResolved && this.isZenModel(e.modelId || e.id)) {
          e.inZenCatalog = true;
        }
        out.push(e);
      }
      return out;
    }
    /**
     * Fill missing fields AND refresh stale values on stored models.
     * - 'manual' / 'api' sourced entries are never touched.
     * - Missing fields are always filled when resolvable.
     * - Existing fields are overwritten only when the stored source is refreshable
     *   (old guesses) and the fresh resolution is authoritative.
     * Returns { list, changed }.
     */
    async backfillStored(models, opts = {}) {
      if (!Array.isArray(models) || !models.length) return { list: models || [], changed: false };
      if (opts.online !== false) {
        await Promise.all([
          this.ensureZenCatalog().catch(() => null),
          this.ensureModelsDev().catch(() => null),
          this.ensureOpenRouterCatalog().catch(() => null)
        ]);
      }
      const REFRESHABLE = /* @__PURE__ */ new Set([void 0, null, "", "local", "partial", "none", "zen", "modelsdev", "openrouter"]);
      let changed = false;
      const list = models.map((m) => ({ ...m }));
      for (const m of list) {
        if (m.metaSource === "manual" || m.metaSource === "api") continue;
        const id = m.modelId || m.id || "";
        if (!id) continue;
        const fresh = await this.enrichAsync({ id, name: m.name || id }, opts);
        const authoritative = fresh.metaSource && fresh.metaSource !== "none" && fresh.metaSource !== "partial";
        const canOverwrite = REFRESHABLE.has(m.metaSource) && authoritative;
        let touched = false;
        if (Number(fresh.contextLength) > 0 && (!Number(m.contextLength) || canOverwrite && Number(m.contextLength) !== Number(fresh.contextLength))) {
          m.contextLength = Number(fresh.contextLength);
          touched = true;
        }
        if (typeof fresh.supportsImages === "boolean" && (typeof m.supportsImages !== "boolean" || canOverwrite && m.supportsImages !== fresh.supportsImages)) {
          m.supportsImages = fresh.supportsImages;
          touched = true;
        }
        if (typeof fresh.supportsTools === "boolean" && (typeof m.supportsTools !== "boolean" || canOverwrite && m.supportsTools !== fresh.supportsTools)) {
          m.supportsTools = fresh.supportsTools;
          touched = true;
        }
        if (touched) {
          changed = true;
          if (!m.metaSource || canOverwrite) m.metaSource = fresh.metaSource || m.metaSource;
        }
      }
      return { list, changed };
    }
  };

  // src/index.js
  var SX_BUILD = "2026.09.22-r11";
  (function bootstrapSX() {
    const logger = new Logger("SX");
    logger.info("Core", `Bootstrapping SX Core SDK v2.0 (build ${SX_BUILD})...`);
    window.__SX_BUILD = SX_BUILD;
    const bus = new EventBus();
    const container = new Container();
    container.register("bus", bus);
    container.register("logger", logger);
    const storage = new StorageService(bus, logger);
    const network = new NetworkClient(logger);
    const state = new StateStore(bus, logger);
    const metaResolver = new ModelMetaResolver(network, logger);
    const models = new ModelManager(bus, state, network, logger, metaResolver);
    const theme = new ThemeEngine(bus, storage, network, logger);
    const quota = new QuotaMonitor(network, models, logger);
    const perf = new PerfMonitor(network, models, logger);
    const fetchInterceptor = new FetchInterceptor(models, logger);
    const voice = new VoiceRecorder(logger);
    const ui = new UIInjector(bus, state, models, theme, quota, perf, network, logger, metaResolver);
    container.register("storage", storage);
    container.register("network", network);
    container.register("state", state);
    container.register("metaResolver", metaResolver);
    container.register("models", models);
    container.register("theme", theme);
    container.register("quota", quota);
    container.register("perf", perf);
    container.register("fetchInterceptor", fetchInterceptor);
    container.register("voice", voice);
    container.register("ui", ui);
    storage.init();
    state.init();
    models.init();
    theme.init();
    quota.init();
    perf.init();
    fetchInterceptor.init();
    voice.init();
    ui.init();
    network.fetchPersistedConfig().then((cfg) => {
      if (cfg) {
        if (Array.isArray(cfg.providers) && cfg.providers.length > 0) {
          state.setProviders(cfg.providers);
        }
        if (Array.isArray(cfg.models) && cfg.models.length > 0) {
          state.setModels(cfg.models);
        }
      }
      metaResolver.backfillStored(state.getModels()).then(({ list, changed }) => {
        if (changed) {
          state.setModels(list);
          logger.info("Core", "Model metadata backfilled from knowledge sources.");
        }
      }).catch((e) => logger.warn("Core", "Metadata backfill failed", e.message));
    });
    metaResolver.ensureZenCatalog().catch(() => {
    });
    metaResolver.ensureModelsDev().catch(() => {
    });
    metaResolver.ensureOpenRouterCatalog().catch(() => {
    });
    window.SX_SDK = {
      bus,
      container,
      state,
      models,
      theme,
      quota,
      perf,
      network,
      metaResolver
    };
    window.SX_THEME_PRESETS = SX_THEME_PRESETS;
    window.sxApplyThemePreset = (p, s = true) => theme.applyPreset(p, s);
    logger.info("Core", "SX Core SDK initialized successfully.");
  })();
})();
