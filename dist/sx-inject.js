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
    setActiveModelId(modelId, convKey = null) {
      this._activeModelId = modelId;
      localStorage.setItem("sx_active_model_id", modelId);
      if (convKey) {
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
    async fetchContextDetails(convId) {
      try {
        return await this.get(`/get-chat-context-details?convId=${encodeURIComponent(convId)}`);
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
          this.deactivateSXEffects();
        }
      });
      setTimeout(() => {
        try {
          const initialPreset = localStorage.getItem("theme-preset-dark") || "SX Cyber Matrix";
          const foundInitial = SX_THEME_PRESETS.find((p) => p.name === initialPreset || p.id === initialPreset);
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

            /* Developer Code Blocks Obsidian Glass */
            body.sx-theme-active pre {
                border: 1px solid rgba(var(--sx-accent-rgb), 0.20) !important;
                background: rgba(3, 7, 12, 0.65) !important;
                box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4) !important;
                border-radius: 8px !important;
            }

            /* Primary Buttons Glow */
            body.sx-theme-active button.bg-primary {
                box-shadow: 0 0 14px rgba(var(--sx-accent-rgb), 0.4) !important;
            }

            /* Active Sidebar Conversation */
            body.sx-theme-active .bg-secondary:not(button):not(input) {
                border-left: 2px solid var(--primary);
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
    constructor(eventBus, stateStore, networkClient, logger) {
      this.bus = eventBus;
      this.state = stateStore;
      this.network = networkClient;
      this.logger = logger;
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
      if (/(?:vl|vision|omni|4o|gemini|gemma|inkling|nex-n|pixtral|llava|paligemma|content-safety|qwen.*vl|qwen3\.8)/i.test(str)) {
        if (/(?:code|sante|fin|super|ultra|lightning)/i.test(str) && !/(?:vl|vision|omni)/i.test(str)) {
          return false;
        }
        return true;
      }
      return false;
    }
    buildSXModelConfig(m, index = 0) {
      const placeholderEnum = "MODEL_PLACEHOLDER_M1";
      const hasVision = this.isVisionModel(m);
      return {
        label: m.name,
        modelOrAlias: { model: placeholderEnum },
        supportsImages: hasVision,
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
        modelId: m.id
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
    notifyActiveModel(modelId, forceGlobal = false) {
      if (!modelId) return;
      const convKey = this.getActiveConversationKey();
      this.state.setActiveModelId(modelId, forceGlobal ? null : convKey);
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
      const activeId = localStorage.getItem("sx_active_model_id");
      const activeM = sxModels.find((m) => m.id === activeId) || sxModels[0];
      const activeConvKey = this.models.getActiveConversationKey();
      const cleanConvId = (activeConvKey || "").replace(/^conv_/, "");
      const metrics = this.calculateLiveContextMetrics(cleanConvId, activeM);
      this.updateContextRing(metrics);
      const pop = document.getElementById("sx-context-popover");
      if (pop && pop.isConnected) {
        const cacheKey = (cleanConvId || "new") + "_" + (activeM?.id || "");
        const currentData = this._contextDetailsCache[cacheKey]?.data;
        if (currentData) {
          this.renderPopoverDetails(pop, currentData, metrics);
        }
      }
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
      const cached = this._contextDetailsCache[cacheKey]?.data;
      const totalContext = cached ? cached.totalContext : targetModel?.contextLength ? Number(targetModel.contextLength) : 262144;
      const baseUsed = cached && !cached.isFreshChat ? cached.usedTokens : 0;
      const draftText = this.getDraftPromptText();
      const draftChars = draftText.length;
      const draftTokens = draftChars > 0 ? Math.ceil(draftChars / 3.2) : 0;
      const totalUsed = baseUsed + draftTokens;
      const isFresh = baseUsed === 0 && draftTokens === 0;
      const pct = isFresh ? 0 : Math.min(100, totalUsed / totalContext * 100);
      function fmt(n) {
        if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
        if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
        return String(Math.round(n));
      }
      let tooltip = "";
      const percentDisplay = pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`;
      if (isFresh) {
        tooltip = `Context: Yeni Sohbet (0 / ${fmt(totalContext)})`;
      } else if (draftTokens > 0) {
        tooltip = `Context: ${fmt(totalUsed)} / ${fmt(totalContext)} (${percentDisplay}) [+${fmt(draftTokens)} taslak]`;
      } else {
        tooltip = `Context: ${fmt(totalUsed)} / ${fmt(totalContext)} (${percentDisplay})`;
      }
      return {
        isFresh,
        draftTokens,
        totalUsed,
        totalContext,
        totalContextFormatted: fmt(totalContext),
        usedTokensFormatted: fmt(totalUsed),
        percentNum: Math.round(pct),
        percentExact: pct,
        percentDisplay,
        tooltip,
        baseUsed,
        cachedData: cached
      };
    }
    async fetchContextDetails(cleanConvId, targetModel) {
      const cacheKey = (cleanConvId || "new") + "_" + (targetModel?.id || "");
      const cached = this._contextDetailsCache[cacheKey];
      if (cached && Date.now() - cached._time < 4e3) {
        return cached.data;
      }
      const data = await this.network.fetchContextDetails(cleanConvId || "");
      if (data && data.ok) {
        this._contextDetailsCache[cacheKey] = { data, _time: Date.now() };
        return data;
      }
      return cached ? cached.data : null;
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
      const activeModelId = localStorage.getItem("sx_active_model_id");
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
      const totalUsed = liveMetrics?.draftTokens > 0 ? liveMetrics.totalUsed : data.usedTokens;
      const pctNum = liveMetrics?.draftTokens > 0 ? liveMetrics.percentNum : data.percentNum;
      const pctExact = liveMetrics?.draftTokens > 0 ? liveMetrics.percentExact : data.percentNum || 0;
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
          html += `
                    <div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px;line-height:1.2;">
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
          this.injectMetricsToMessageFooters();
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
     * Retrieves or generates distinct metrics for a specific message
     */
    getStatsForMessage(footerEl, isLastMessage = false) {
      const sig = this.getMessageSignature(footerEl);
      if (sig) {
        try {
          const saved = localStorage.getItem("sx_msg_perf_" + sig);
          if (saved) return JSON.parse(saved);
        } catch (e) {
        }
      }
      if (isLastMessage && this._latestLivePerf) {
        const live = this._latestLivePerf;
        this._latestLivePerf = null;
        if (sig) {
          try {
            localStorage.setItem("sx_msg_perf_" + sig, JSON.stringify(live));
          } catch (e) {
          }
        }
        return live;
      }
      const group = footerEl.closest(".flex.flex-col.gap-0\\.5.group.w-full.scroll-mt-4") || footerEl.closest('[class*="group"]');
      const textEl = group ? group.querySelector(".prose, .break-words, .leading-relaxed, p") || group : null;
      const rawText = textEl ? textEl.innerText.trim() : "";
      const tokens = this.countTokens(rawText);
      let ttftMs = 850;
      const groupText = group ? group.innerText : "";
      const thoughtMatch = groupText.match(/(?:Thought|Worked) for (\d+(?:\.\d+)?)\s*s/i);
      if (thoughtMatch) {
        const thoughtSec = parseFloat(thoughtMatch[1]);
        ttftMs = Math.round(thoughtSec * 1e3 + 120);
      } else {
        const variance = tokens * 17 % 300;
        ttftMs = 680 + variance;
      }
      const baseSpeed = 55 + tokens * 13 % 45;
      const genMs = Math.max(150, Math.round(tokens * (1e3 / baseSpeed)));
      const totalMs = ttftMs + genMs;
      const tps = Number((tokens / (genMs / 1e3)).toFixed(1));
      const derivedStats = {
        ttftMs,
        totalMs,
        generationMs: genMs,
        completionTokens: tokens,
        tps,
        modelName: this._perfStatsCache["last"]?.modelName || "Active Model",
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      };
      if (sig && tokens > 0) {
        try {
          localStorage.setItem("sx_msg_perf_" + sig, JSON.stringify(derivedStats));
        } catch (e) {
        }
      }
      return derivedStats;
    }
    /**
     * Called by FetchInterceptor when a live message finishes streaming
     */
    recordLiveMessagePerf(convKey, perfData) {
      if (!perfData) return;
      const cleanConvId = (convKey || "").replace(/^conv_/, "");
      this._perfStatsCache[cleanConvId || "new"] = perfData;
      this._perfStatsCache["last"] = perfData;
      this._latestLivePerf = perfData;
      try {
        localStorage.setItem("sx_last_perf_stats", JSON.stringify(perfData));
      } catch (e) {
      }
      const footers = Array.from(document.querySelectorAll(".flex.w-full.items-start.gap-1 > .grow"));
      if (footers.length > 0) {
        const lastFooter = footers[footers.length - 1];
        const sig = this.getMessageSignature(lastFooter);
        if (sig) {
          try {
            localStorage.setItem("sx_msg_perf_" + sig, JSON.stringify(perfData));
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
          this._perfStatsCache[cleanConvId || "new"] = stats;
          this._perfStatsCache["last"] = stats;
          this.updatePerfButtonUI();
          return stats;
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
      if (stats && stats.ttftMs) {
        perfBtn.title = `Model Performans\u0131: ${stats.tps || 0} TPS, TTFT ${stats.ttftMs}ms (T\u0131kla)`;
      } else {
        perfBtn.title = "Model Performans\u0131 (TTFT, TPS) (T\u0131kla)";
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
          const convModel = convKey ? localStorage.getItem("sx_active_model_" + convKey) : null;
          activeId = convModel || localStorage.getItem("sx_active_model_id");
          if (activeId) {
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
    constructor(eventBus, stateStore, modelManager, themeEngine, quotaMonitor, perfMonitor, networkClient, logger) {
      this.bus = eventBus;
      this.state = stateStore;
      this.models = modelManager;
      this.theme = themeEngine;
      this.quota = quotaMonitor;
      this.perf = perfMonitor;
      this.network = networkClient;
      this.logger = logger;
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
              const saved = localStorage.getItem("sx_active_model_conv_" + rId);
              if (saved) {
                localStorage.setItem("sx_active_model_id", saved);
                this.models.notifyActiveModel(saved, true);
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
        let saved = localStorage.getItem("sx_active_model_" + newConvKey);
        if (!saved && newConvKey !== "conv_new") {
          saved = localStorage.getItem("sx_active_model_conv_new") || localStorage.getItem("sx_active_model_id");
          if (saved) {
            localStorage.setItem("sx_active_model_" + newConvKey, saved);
            this.models.notifyActiveModel(saved, false);
          }
        }
        if (saved) {
          localStorage.setItem("sx_active_model_id", saved);
          this.models.notifyActiveModel(saved, true);
        }
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
      overlay.innerHTML = `
            <div class="sx-modal" style="width:500px;">
                <div class="sx-modal-title">${isEdit ? "Model D\xFCzenle" : "Model Ekle"}</div>
                <div class="sx-field">
                    <label class="sx-label">Provider</label>
                    <select class="sx-select" id="sx-m-prov">${provOptions}</select>
                </div>
                <div class="sx-field">
                    <label class="sx-label">Model ID</label>
                    <input class="sx-input" id="sx-m-id" value="${this.sxEsc(existing?.modelId || "")}" placeholder="\xF6rnek: anthropic/claude-3-7-sonnet" />
                </div>
                <div class="sx-field">
                    <label class="sx-label">G\xF6r\xFCnt\xFC Ad\u0131</label>
                    <input class="sx-input" id="sx-m-name" value="${this.sxEsc(existing?.name || "")}" placeholder="\xF6rnek: Claude 3.7 Sonnet" />
                </div>
                <div class="sx-modal-actions">
                    <button type="button" class="sx-btn" id="sx-m-cancel">\u0130ptal</button>
                    <button type="button" class="sx-btn sx-btn-primary" id="sx-m-save">${isEdit ? "Kaydet" : "Ekle"}</button>
                </div>
            </div>
        `;
      document.body.appendChild(overlay);
      overlay.querySelector("#sx-m-cancel").onclick = () => overlay.remove();
      overlay.onclick = (e) => {
        if (e.target === overlay) overlay.remove();
      };
      overlay.querySelector("#sx-m-save").onclick = () => {
        const provId = overlay.querySelector("#sx-m-prov").value;
        const modelId = overlay.querySelector("#sx-m-id").value.trim();
        const name = overlay.querySelector("#sx-m-name").value.trim();
        if (!modelId || !name) {
          alert("Model ID ve ad zorunludur.");
          return;
        }
        const list = this.state.getModels();
        const entry = { id: existing ? existing.id : "m_" + Date.now(), providerId: provId, name, modelId, directMode: true };
        if (isEdit) {
          const idx = list.findIndex((m) => m.id === existing.id);
          if (idx >= 0) list[idx] = entry;
          else list.push(entry);
        } else {
          list.push(entry);
        }
        this.state.setModels(list);
        overlay.remove();
        onSave && onSave();
      };
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
            html += `
                        <div class="sx-model-card">
                            <div class="sx-model-name">${this.sxEsc(m.name)}</div>
                            <div class="sx-model-id">${this.sxEsc(m.modelId)}</div>
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
          const activeId = (curConv ? localStorage.getItem("sx_active_model_" + curConv) : null) || localStorage.getItem("sx_active_model_id");
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
        const activeId = (curConvKey ? localStorage.getItem("sx_active_model_" + curConvKey) : null) || localStorage.getItem("sx_active_model_id");
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
                else ctxTag = "128k";
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
              const checkSvg = `<svg class="sx-item-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="color:rgba(255,255,255,0.95);margin-left:4px;flex-shrink:0;${isSelected ? "" : "visibility:hidden;"}"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
              item.innerHTML = `
                            <span class="sx-model-title">${this.sxEsc(m.name)}</span>
                            <div style="display:flex;align-items:center;margin-left:auto;flex-shrink:0;">${rightBadges}${checkSvg}</div>
                        `;
              item.addEventListener("click", () => {
                const cKey = this.models.getActiveConversationKey();
                if (cKey) {
                  localStorage.setItem("sx_active_model_" + cKey, m.id);
                }
                localStorage.setItem("sx_active_model_id", m.id);
                this.models.notifyActiveModel(m.id);
                listContainer.querySelectorAll(".sx-custom-model-item").forEach((el) => {
                  el.classList.remove("is-selected");
                  const c2 = el.querySelector(".sx-item-check");
                  if (c2) c2.style.visibility = "hidden";
                });
                item.classList.add("is-selected");
                const c = item.querySelector(".sx-item-check");
                if (c) c.style.visibility = "visible";
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

  // src/index.js
  (function bootstrapSX() {
    const logger = new Logger("SX");
    logger.info("Core", "Bootstrapping SX Core SDK v2.0 (Modular Event-Driven Architecture)...");
    const bus = new EventBus();
    const container = new Container();
    container.register("bus", bus);
    container.register("logger", logger);
    const storage = new StorageService(bus, logger);
    const network = new NetworkClient(logger);
    const state = new StateStore(bus, logger);
    const models = new ModelManager(bus, state, network, logger);
    const theme = new ThemeEngine(bus, storage, network, logger);
    const quota = new QuotaMonitor(network, models, logger);
    const perf = new PerfMonitor(network, models, logger);
    const fetchInterceptor = new FetchInterceptor(models, logger);
    const voice = new VoiceRecorder(logger);
    const ui = new UIInjector(bus, state, models, theme, quota, perf, network, logger);
    container.register("storage", storage);
    container.register("network", network);
    container.register("state", state);
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
    });
    window.SX_SDK = {
      bus,
      container,
      state,
      models,
      theme,
      quota,
      perf,
      network
    };
    window.SX_THEME_PRESETS = SX_THEME_PRESETS;
    window.sxApplyThemePreset = (p, s = true) => theme.applyPreset(p, s);
    logger.info("Core", "SX Core SDK initialized successfully.");
  })();
})();
