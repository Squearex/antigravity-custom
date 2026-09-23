/**
 * SX Core SDK - UIInjector
 * Manages DOM modifications, custom settings panel, model selector dropdown,
 * and chat input action buttons.
 */
import { SX_PRESETS } from './ModelManager.js';
import { SX_THEME_PRESETS } from './ThemeEngine.js';

export class UIInjector {
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
        setInterval(() => this.checkForUpdates(), 60000);
        setTimeout(() => this.checkForUpdates(), 20000);

        // Check URL route transitions
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

        window.addEventListener('popstate', () => {
            setTimeout(() => this.checkUrlChange(), 20);
        });

        // Click listener for sidebar navigation, model selector, and settings dialogs
        document.addEventListener('click', (e) => {
            const navTarget = e.target.closest('a[href^="/c/"], a[href="/"], [data-testid="new-conversation-button"], [data-testid="conversation-row-sidebar"], button[aria-label*="New Conversation" i]');
            if (navTarget) {
                const row = navTarget.closest('[data-testid="conversation-row-sidebar"], a[href^="/c/"]');
                if (row) {
                    const rId = row.getAttribute('data-cascade-id') || row.getAttribute('data-conversation-id') || (row.getAttribute('href')?.match(/\/c\/([a-zA-Z0-9_-]+)/)?.[1]);
                    if (rId) {
                        const targetKey = 'conv_' + rId;
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

            // Model selector trigger instant injection
            if (e.target.closest('[data-testid="model-selector-trigger"]')) {
                this.trySXModelSelectorPanelInject();
                requestAnimationFrame(() => this.trySXModelSelectorPanelInject());
                setTimeout(() => this.trySXModelSelectorPanelInject(), 10);
                setTimeout(() => this.trySXModelSelectorPanelInject(), 35);
            }

            // Settings dialog tabs & buttons instant injection
            const settingsTarget = e.target.closest('[role="dialog"] [role="tab"], [role="dialog"] button, [data-testid*="settings"], button[aria-label*="Settings" i]');
            if (settingsTarget) {
                const targetTxt = (settingsTarget.textContent || '').trim().toLowerCase();
                if (targetTxt.includes('model')) {
                    this._selectedSettingsTab = 'models';
                } else if (['general', 'genel', 'application', 'uygulama', 'appearance', 'görünüm', 'customization', 'özelleştirme', 'browser', 'tarayıcı', 'conversation', 'sohbet', 'shortcut', 'kısayol', 'feedback', 'geri bildirim'].some(k => targetTxt.includes(k))) {
                    this._selectedSettingsTab = targetTxt;
                }
                this.trySXModelsSettingsInject();
                requestAnimationFrame(() => this.trySXModelsSettingsInject());
                setTimeout(() => this.trySXModelsSettingsInject(), 25);
                setTimeout(() => this.trySXModelsSettingsInject(), 80);
            }
        }, true);

        // Fast settings and model selector observer (0ms microtask instead of waiting for poll interval)
        try {
            const sObs = new MutationObserver((muts) => {
                for (const mut of muts) {
                    if (mut.addedNodes && mut.addedNodes.length) {
                        for (const n of mut.addedNodes) {
                            if (n.nodeType === 1) {
                                if (n.matches?.('[data-testid="model-selector-panel"]') || n.querySelector?.('[data-testid="model-selector-panel"]')) {
                                    this.trySXModelSelectorPanelInject();
                                }
                                if (n.matches?.('[role="dialog"]') || n.closest?.('[role="dialog"]') || n.querySelector?.('[role="dialog"]')) {
                                    this.trySXModelsSettingsInject();
                                    this.trySXAppearanceSettingsInject();
                                }
                                if (n.matches?.('[role="listbox"]') || n.querySelector?.('[role="listbox"]') || n.closest?.('[role="listbox"]')) {
                                    this.trySXAppearanceSettingsInject();
                                }
                            }
                        }
                    }
                }
            });
            sObs.observe(document.body, { childList: true, subtree: true });
            this._settingsObserver = sObs;
        } catch(e) {}

        // Core DOM hook loop
        window.addEventListener('DOMContentLoaded', () => {
            setInterval(() => this.hookDOM(), 200);
        });
        setInterval(() => this.hookDOM(), 350);

        this.logger.info('UIInjector', 'DOM Injector & event hooks initialized.');
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
        return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    async checkForUpdates() {
        try {
            const r = await this.network.get('/versions');
            if (!r || !r.ok) return;
            const curInject = window.__SX_BUILD || '';
            if (r.injectBuild && curInject && r.injectBuild !== curInject) {
                if (this._updateNotified !== r.injectBuild) {
                    this._updateNotified = r.injectBuild;
                    this.logger?.info?.('UIInjector', `New inject build ${r.injectBuild} available (running ${curInject})`);
                }
                if (this._isIdleForReload()) {
                    this.logger?.info?.('UIInjector', 'Auto-reloading to new build while idle.');
                    window.location.reload();
                }
            }
        } catch(e) {}
    }

    _isIdleForReload() {
        try {
            // Never reload with unsaved form state
            if (document.querySelector('.sx-modal-overlay')) return false;
            // Never reload mid-stream
            if (this.quota && (this.quota._streamActive || (Date.now() - (this.quota._lastStreamTs || 0) < 60000))) return false;
            // Never reload while the user is typing
            const ed = document.querySelector('[contenteditable="true"], textarea');
            const txt = (ed?.innerText || ed?.textContent || ed?.value || '').trim();
            if (txt) return false;
            return true;
        } catch(e) { return false; }
    }

    injectGlobalStyles() {
        if (document.getElementById('sx-custom-styles')) return;
        const style = document.createElement('style');
        style.id = 'sx-custom-styles';
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

            /* Model selector menu wrapper: unified sleek single card */
            [role="menu"]:has([data-testid="model-selector-panel"]) {
                background: hsl(var(--popover, var(--card, 222 47% 11%))) !important;
                border: 1px solid hsl(var(--border, rgba(255, 255, 255, 0.12))) !important;
                border-radius: 10px !important;
                box-shadow: 0 10px 30px -4px rgba(0, 0, 0, 0.45), 0 4px 12px -2px rgba(0, 0, 0, 0.25) !important;
                backdrop-filter: blur(20px) !important;
                padding: 0 !important;
                overflow: hidden !important;
                width: 320px !important;
                min-width: 320px !important;
                max-width: 340px !important;
            }

            [role="menu"] > [data-testid="model-selector-panel"],
            [role="menu"] [data-testid="model-selector-panel"],
            [data-testid="model-selector-panel"] {
                background: transparent !important;
                border: none !important;
                border-radius: 0 !important;
                box-shadow: none !important;
                backdrop-filter: none !important;
                padding: 0 !important;
                width: 100% !important;
                min-width: 0 !important;
                max-width: 100% !important;
                transform: none !important;
            }

            /* Hide native model selector items instantly */
            [data-testid="model-selector-item"]:not(.sx-custom-model-item),
            [data-testid="model-selector-panel"] [data-testid="model-selector-item"]:not(.sx-custom-model-item),
            [data-testid="model-selector-header"] {
                display: none !important;
            }

            /* Custom model item layout with two-row support to prevent title truncation */
            .sx-custom-model-item {
                min-height: 32px !important;
                padding: 4px 8px !important;
                margin: 1px 0 !important;
                border-radius: 6px !important;
                cursor: pointer !important;
                user-select: none !important;
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                gap: 8px !important;
                box-sizing: border-box !important;
                transition: background-color 0.1s ease, color 0.1s ease !important;
            }
            .sx-custom-model-item.has-badges {
                min-height: 42px !important;
                padding: 5px 8px !important;
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
            .sx-model-info-col {
                flex: 1 1 auto !important;
                min-width: 0 !important;
                display: flex !important;
                flex-direction: column !important;
                justify-content: center !important;
                gap: 2px !important;
            }
            .sx-custom-model-item .sx-model-title {
                font-size: 12px !important;
                line-height: 1.3 !important;
                color: rgba(255, 255, 255, 0.92) !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                white-space: nowrap !important;
                width: 100% !important;
            }
            .sx-model-badges-row {
                display: flex !important;
                align-items: center !important;
                gap: 4px !important;
                flex-wrap: wrap !important;
                margin-top: 1px !important;
            }
            .sx-model-right-actions {
                flex-shrink: 0 !important;
                margin-left: auto !important;
                display: flex !important;
                align-items: center !important;
                justify-content: flex-end !important;
                gap: 4px !important;
                width: 36px !important;
                min-width: 36px !important;
            }
            .sx-model-check-slot {
                width: 14px !important;
                height: 14px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                flex-shrink: 0 !important;
            }
            .sx-model-arrow-slot {
                width: 14px !important;
                height: 14px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                flex-shrink: 0 !important;
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

            /* Model Reasoning subtag underneath model title */
            .sx-reasoning-subtag {
                font-size: 9.5px !important;
                font-weight: 500 !important;
                color: rgba(255, 255, 255, 0.45) !important;
                line-height: normal !important;
                user-select: none !important;
                transition: all 0.12s ease !important;
            }
            .sx-reasoning-subtag.is-badge {
                font-size: 8.5px !important;
                font-weight: 600 !important;
                letter-spacing: 0.2px !important;
                color: #c084fc !important;
                background: rgba(192, 132, 252, 0.08) !important;
                border: 1px solid rgba(192, 132, 252, 0.22) !important;
                padding: 0.5px 5px !important;
                border-radius: 3px !important;
            }
            .sx-custom-model-item:hover .sx-reasoning-subtag {
                color: rgba(255, 255, 255, 0.8) !important;
            }
            .sx-custom-model-item:hover .sx-reasoning-subtag.is-badge {
                color: #d8b4fe !important;
                background: rgba(192, 132, 252, 0.14) !important;
                border-color: rgba(192, 132, 252, 0.35) !important;
            }

            /* Clean subtle chevron arrow at the far right of model row */
            .sx-model-chevron-hint {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                cursor: pointer !important;
                color: rgba(255, 255, 255, 0.3) !important;
                transition: color 0.12s ease !important;
                flex-shrink: 0 !important;
                line-height: 1 !important;
            }
            .sx-custom-model-item:hover .sx-model-chevron-hint {
                color: rgba(255, 255, 255, 0.85) !important;
            }
            .sx-reasoning-arrow {
                opacity: 0.45 !important;
                transition: opacity 0.12s ease, transform 0.12s ease !important;
                flex-shrink: 0 !important;
            }
            .sx-custom-model-item:hover .sx-reasoning-arrow {
                opacity: 0.9 !important;
                transform: translateX(1px) !important;
            }

            /* Reasoning submenu popover matching Antigravity dark dropdown theme */
            .sx-nested-menu {
                position: fixed !important;
                z-index: 999999 !important;
                background: hsl(var(--popover, var(--card, 222 47% 11%))) !important;
                border: 1px solid hsl(var(--border, rgba(255, 255, 255, 0.12))) !important;
                border-radius: 10px !important;
                padding: 4px !important;
                min-width: 135px !important;
                max-height: calc(100vh - 24px) !important;
                overflow-y: auto !important;
                box-shadow: 0 10px 30px -4px rgba(0, 0, 0, 0.45), 0 4px 12px -2px rgba(0, 0, 0, 0.25) !important;
                backdrop-filter: blur(20px) !important;
                font-family: inherit !important;
                display: flex !important;
                flex-direction: column !important;
                gap: 2px !important;
            }
            .sx-nested-item {
                height: 28px !important;
                padding: 0 10px !important;
                border-radius: 6px !important;
                font-size: 12px !important;
                font-weight: 500 !important;
                color: rgba(255, 255, 255, 0.75) !important;
                cursor: pointer !important;
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                transition: background 0.12s ease, color 0.12s ease !important;
                user-select: none !important;
            }
            .sx-nested-item:hover {
                background: rgba(255, 255, 255, 0.08) !important;
                color: #ffffff !important;
            }
            .sx-nested-item.is-active {
                font-weight: 600 !important;
                color: #ffffff !important;
                background: rgba(255, 255, 255, 0.04) !important;
            }

            /* Effort Popover & Slider Styles (Always loaded globally) */
            .sx-effort-popover {
                position: fixed !important;
                z-index: 100000 !important;
                width: 236px !important;
                border-radius: 12px !important;
                background: hsl(var(--popover, var(--card, 222 47% 11%))) !important;
                border: 1px solid hsl(var(--border, rgba(255, 255, 255, 0.12))) !important;
                padding: 14px 16px !important;
                box-shadow: 0 10px 30px -4px rgba(0, 0, 0, 0.45), 0 4px 12px -2px rgba(0, 0, 0, 0.25) !important;
                backdrop-filter: blur(20px) !important;
                font-family: inherit !important;
                box-sizing: border-box !important;
            }
            .sx-effort-track {
                height: 22px !important;
                border-radius: 11px !important;
                background: rgba(255, 255, 255, 0.06) !important;
                border: 1px solid rgba(255, 255, 255, 0.1) !important;
                position: relative !important;
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                padding: 0 8px !important;
                cursor: pointer !important;
                user-select: none !important;
                box-sizing: border-box !important;
                transition: background 0.15s ease !important;
            }
            .sx-effort-track:hover {
                background: rgba(255, 255, 255, 0.09) !important;
            }
            .sx-effort-dot {
                position: absolute !important;
                top: 9px !important;
                width: 4px !important;
                height: 4px !important;
                border-radius: 50% !important;
                background: rgba(255, 255, 255, 0.3) !important;
                pointer-events: none !important;
                transform: translateX(-50%) !important;
            }
            .sx-effort-thumb {
                position: absolute !important;
                top: 2px !important;
                width: 16px !important;
                height: 16px !important;
                border-radius: 6px !important;
                background: #ffffff !important;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.25) !important;
                pointer-events: none !important;
                transition: left 0.12s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
            }

            /* Effort Hover Tooltip Popup */
            .sx-hover-popup {
                position: fixed !important;
                z-index: 100005 !important;
                width: 290px !important;
                background: hsl(var(--popover, var(--card, 222 47% 11%))) !important;
                border: 1px solid hsl(var(--border, rgba(255, 255, 255, 0.12))) !important;
                border-radius: 10px !important;
                padding: 12px 14px !important;
                box-shadow: 0 10px 30px -4px rgba(0, 0, 0, 0.45), 0 4px 12px -2px rgba(0, 0, 0, 0.25) !important;
                backdrop-filter: blur(20px) !important;
                pointer-events: none !important;
                box-sizing: border-box !important;
                font-family: inherit !important;
                color: hsl(var(--popover-foreground, var(--foreground, #f1f5f9))) !important;
            }
        `;
        const target = document.head || document.documentElement;
        if (target) {
            target.appendChild(style);
        } else {
            window.addEventListener('DOMContentLoaded', () => {
                (document.head || document.documentElement)?.appendChild(style);
            }, { once: true });
        }
    }

    openProviderModal(existing = null, onSave = null) {
        const isEdit = !!existing;
        const overlay = document.createElement('div');
        overlay.className = 'sx-modal-overlay';
        overlay.id = 'sx-p-modal';

        const initPreset = isEdit
            ? (SX_PRESETS.find(p => existing.baseUrl && existing.baseUrl.includes(p.id === 'custom' ? '!!' : (p.baseUrl.split('/')[2] || '---'))) || SX_PRESETS[5])
            : SX_PRESETS[0];

        overlay.innerHTML = `
            <div class="sx-modal">
                <div class="sx-modal-title">${isEdit ? 'Edit Provider' : 'Add Provider'}</div>
                <div class="sx-field">
                    <label class="sx-label">Select Provider</label>
                    <div class="sx-preset-grid" id="sx-p-presets">
                        ${SX_PRESETS.map(p => `
                            <button type="button" class="sx-preset-btn${p.id === initPreset.id ? ' active' : ''}" data-preset="${p.id}">
                                ${p.name}
                            </button>
                        `).join('')}
                    </div>
                </div>
                <div class="sx-field">
                    <label class="sx-label">Provider Name</label>
                    <input class="sx-input" id="sx-p-name" value="${existing ? this.sxEsc(existing.name) : initPreset.name}" placeholder="e.g. My OpenRouter" />
                </div>
                <div class="sx-field">
                    <label class="sx-label">API Base URL</label>
                    <input class="sx-input" id="sx-p-url" value="${existing ? this.sxEsc(existing.baseUrl || '') : initPreset.baseUrl}" placeholder="https://..." />
                </div>
                <div class="sx-field">
                    <label class="sx-label">Protocol</label>
                    <select class="sx-select" id="sx-p-proto">
                        <option value="openai"${(existing ? existing.protocol : initPreset.protocol) === 'openai' ? ' selected' : ''}>OpenAI Compatible (SSE)</option>
                        <option value="anthropic"${(existing ? existing.protocol : initPreset.protocol) === 'anthropic' ? ' selected' : ''}>Anthropic Messages (SSE)</option>
                    </select>
                </div>
                <div class="sx-field">
                    <label class="sx-label">API Key</label>
                    <input class="sx-input" type="password" id="sx-p-key" value="${existing ? this.sxEsc(existing.apiKey || '') : ''}" placeholder="sk-..." autocomplete="off" />
                </div>
                <div class="sx-modal-actions">
                    <button type="button" class="sx-btn" id="sx-p-cancel">Cancel</button>
                    <button type="button" class="sx-btn sx-btn-primary" id="sx-p-save">Save Provider</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        let selectedPreset = initPreset;
        overlay.querySelector('#sx-p-presets').onclick = (e) => {
            const btn = e.target.closest('.sx-preset-btn');
            if (!btn) return;
            const preset = SX_PRESETS.find(p => p.id === btn.dataset.preset);
            if (preset) {
                selectedPreset = preset;
                overlay.querySelectorAll('.sx-preset-btn').forEach(b => b.classList.toggle('active', b.dataset.preset === preset.id));
                if (preset.id !== 'custom') {
                    overlay.querySelector('#sx-p-name').value = preset.name;
                    overlay.querySelector('#sx-p-url').value = preset.baseUrl;
                    overlay.querySelector('#sx-p-proto').value = preset.protocol;
                }
            }
        };

        overlay.querySelector('#sx-p-cancel').onclick = () => overlay.remove();
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

        overlay.querySelector('#sx-p-save').onclick = () => {
            const name = overlay.querySelector('#sx-p-name').value.trim();
            const baseUrl = overlay.querySelector('#sx-p-url').value.trim();
            const protocol = overlay.querySelector('#sx-p-proto').value;
            const apiKey = overlay.querySelector('#sx-p-key').value.trim();
            if (!name || !apiKey) { alert('Name and API key are required.'); return; }
            const list = this.state.getProviders();
            const entry = { id: existing ? existing.id : 'prov_' + Date.now(), name, baseUrl, protocol, apiKey, modelsPath: selectedPreset.modelsPath || '/models' };
            if (existing) {
                const idx = list.findIndex(p => p.id === existing.id);
                if (idx >= 0) list[idx] = entry; else list.push(entry);
            } else { list.push(entry); }
            this.state.setProviders(list);
            overlay.remove();
            onSave && onSave();
        };

        setTimeout(() => overlay.querySelector('#sx-p-key').focus(), 50);
    }

    openModelModal(existing = null, onSave = null) {
        const providers = this.state.getProviders();
        if (!providers.length) { alert('Önce bir provider ekleyin.'); return; }
        const isEdit = !!existing;
        const overlay = document.createElement('div');
        overlay.className = 'sx-modal-overlay';
        overlay.id = 'sx-m-modal';

        const provOptions = providers.map(p =>
            `<option value="${p.id}"${existing && existing.providerId === p.id ? ' selected' : ''}>${this.sxEsc(p.name)} (${this.sxEsc(p.protocol)})</option>`
        ).join('');

        const editFields = `
            <div class="sx-field">
                <label class="sx-label">Model ID</label>
                <input class="sx-input" id="sx-m-id" value="${this.sxEsc(existing?.modelId || '')}" placeholder="örnek: anthropic/claude-3-7-sonnet" />
            </div>
            <div class="sx-field">
                <label class="sx-label">Görüntü Adı</label>
                <input class="sx-input" id="sx-m-name" value="${this.sxEsc(existing?.name || '')}" placeholder="örnek: Claude 3.7 Sonnet" />
            </div>
            <div class="sx-field">
                <label class="sx-label">Context (token)</label>
                <input class="sx-input" id="sx-m-ctx" type="number" min="0" step="1024" value="${existing?.contextLength ? this.sxEsc(existing.contextLength) : ''}" placeholder="örnek: 200000" />
            </div>
            <div class="sx-field" style="display:flex;gap:18px;align-items:center;">
                <label style="display:flex;align-items:center;gap:7px;font-size:12.5px;color:rgba(255,255,255,0.75);cursor:pointer;">
                    <input type="checkbox" id="sx-m-vision" ${existing?.supportsImages ? 'checked' : ''} style="width:14px;height:14px;accent-color:#38bdf8;" />
                    Vision
                </label>
                <label style="display:flex;align-items:center;gap:7px;font-size:12.5px;color:rgba(255,255,255,0.75);cursor:pointer;">
                    <input type="checkbox" id="sx-m-tools" ${existing?.supportsTools ? 'checked' : ''} style="width:14px;height:14px;accent-color:#fb923c;" />
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
                <div id="sx-m-bulk-hint" style="font-size:12px;color:rgba(255,255,255,0.3);padding:8px 0 4px 0;">Provider'dan model listesi yükle veya aşağıda manuel gir.</div>
            </div>
            <div class="sx-field">
                <label class="sx-label">Manuel Model ID (opsiyonel)</label>
                <input class="sx-input" id="sx-m-id" placeholder="örnek: anthropic/claude-3-7-sonnet" />
            </div>
            <div class="sx-field">
                <label class="sx-label">Görüntü Adı (opsiyonel)</label>
                <input class="sx-input" id="sx-m-name" placeholder="örnek: Claude 3.7 Sonnet" />
            </div>`;

        overlay.innerHTML = `
            <div class="sx-modal" style="width:500px;">
                <div class="sx-modal-title">${isEdit ? 'Model Düzenle' : 'Model Ekle'}</div>
                <div class="sx-field">
                    <label class="sx-label">Provider</label>
                    <select class="sx-select" id="sx-m-prov">${provOptions}</select>
                </div>
                ${isEdit ? editFields : addFields}
                <div class="sx-modal-actions">
                    <button type="button" class="sx-btn" id="sx-m-cancel">İptal</button>
                    <button type="button" class="sx-btn sx-btn-primary" id="sx-m-save">${isEdit ? 'Kaydet' : 'Ekle'}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        let allFetchedModels = [];
        const checkedIds = new Set();
        const self = this;

        const isAlreadyAdded = (modelId, provId) =>
            self.state.getModels().some(m => m.modelId === modelId && m.providerId === provId);

        const META_SRC_LABEL = { api: 'Provider API', zen: 'Zen dokümanı', 'zen-catalog': 'Zen katalog', modelsdev: 'models.dev', openrouter: 'OpenRouter', local: 'Yerel DB', manual: 'Manuel', partial: 'Kısmi', none: 'Bilinmiyor' };
        const metaSrcLabel = (m) => META_SRC_LABEL[m?.metaSource] || (m?.metaSource || '');

        const metaFromFetched = (fm) => {
            if (!fm) return {};
            const out = {};
            if (fm.contextLength) out.contextLength = fm.contextLength;
            if (typeof fm.supportsImages === 'boolean') out.supportsImages = fm.supportsImages;
            if (typeof fm.supportsTools === 'boolean') out.supportsTools = fm.supportsTools;
            if (typeof fm.supportsReasoning === 'boolean') out.supportsReasoning = fm.supportsReasoning;
            if (Array.isArray(fm.supportedReasoningEfforts)) out.supportedReasoningEfforts = fm.supportedReasoningEfforts;
            if (fm.defaultReasoningEffort) out.defaultReasoningEffort = fm.defaultReasoningEffort;
            if (Array.isArray(fm.supportedParameters)) out.supportedParameters = fm.supportedParameters;
            if (fm.metaSource) out.metaSource = fm.metaSource;
            return out;
        };

        function renderChecklist(filterText) {
            const list = overlay.querySelector('#sx-m-check-list');
            if (!list) return;
            const provId = overlay.querySelector('#sx-m-prov')?.value;
            const filtered = allFetchedModels.filter(m =>
                m.id.toLowerCase().includes(filterText) || (m.name || '').toLowerCase().includes(filterText)
            ).slice(0, 500);
            if (!filtered.length) {
                list.innerHTML = '<div style="padding:12px;color:rgba(255,255,255,0.3);font-size:12px;text-align:center;">Sonuç yok</div>';
                return;
            }
            let addedCount = 0;
            list.innerHTML = filtered.map(m => {
                const already = isAlreadyAdded(m.id, provId);
                if (already) addedCount++;
                const ctxTag = self.models.formatContextSize(m.contextLength);
                const srcTitle = metaSrcLabel(m) ? ` title="Kaynak: ${metaSrcLabel(m)}"` : '';
                const badges = [];
                if (ctxTag) badges.push(`<span${srcTitle} style="font-size:9px;font-weight:700;color:#a3e635;background:rgba(163,230,53,0.1);padding:0 4px;border-radius:3px;">${ctxTag}</span>`);
                if (m.supportsImages) badges.push(`<span${srcTitle} style="font-size:9px;font-weight:600;color:#38bdf8;background:rgba(56,189,248,0.1);padding:0 4px;border-radius:3px;">Vision</span>`);
                if (m.supportsTools) badges.push(`<span${srcTitle} style="font-size:9px;font-weight:600;color:#fbbf24;background:rgba(245,158,11,0.1);padding:0 4px;border-radius:3px;">Tools</span>`);
                const badgeHtml = badges.length
                    ? `<span style="display:inline-flex;gap:4px;flex-shrink:0;margin-left:auto;padding-left:6px;">${badges.join('')}</span>`
                    : '';
                return '<label style="display:flex;align-items:center;gap:9px;padding:7px 12px;cursor:' + (already ? 'default' : 'pointer') + ';opacity:' + (already ? '0.45' : '1') + ';">' +
                    '<input type="checkbox" data-id="' + self.sxEsc(m.id) + '"' +
                        (checkedIds.has(m.id) ? ' checked' : '') +
                        (already ? ' disabled' : '') +
                        ' style="width:14px;height:14px;accent-color:#38bdf8;cursor:' + (already ? 'not-allowed' : 'pointer') + ';flex-shrink:0;" />' +
                    '<span style="min-width:0;overflow:hidden;flex:1;">' +
                        '<div style="font-family:ui-monospace,monospace;font-size:11.5px;color:rgba(255,255,255,0.88);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + self.sxEsc(m.id) + (already ? ' <span style="font-size:9px;color:rgba(255,255,255,0.35);font-family:inherit;">(ekli)</span>' : '') + '</div>' +
                        (m.name && m.name !== m.id ? '<div style="font-size:10px;color:rgba(255,255,255,0.38);">' + self.sxEsc(m.name) + '</div>' : '') +
                    '</span>' +
                    badgeHtml +
                '</label>';
            }).join('');
            list.querySelectorAll('input[type=checkbox]').forEach(cb => {
                cb.onchange = () => {
                    if (cb.checked) checkedIds.add(cb.dataset.id);
                    else checkedIds.delete(cb.dataset.id);
                    const bulkHint = overlay.querySelector('#sx-m-bulk-hint');
                    if (bulkHint && checkedIds.size > 0) {
                        bulkHint.textContent = checkedIds.size + ' model seçildi — Ekle ile toplu eklenecek.';
                    }
                };
            });
            const hint = overlay.querySelector('#sx-m-bulk-hint');
            if (hint && checkedIds.size === 0 && addedCount > 0) {
                hint.style.display = '';
                hint.textContent = addedCount + ' model zaten ekli — tekrar eklenmeyecek.';
            } else if (hint && checkedIds.size > 0) {
                hint.style.display = '';
                hint.textContent = checkedIds.size + ' model seçildi — Ekle ile toplu eklenecek.';
            }
        }

        const fetchBtn = overlay.querySelector('#sx-m-fetch');
        if (fetchBtn) fetchBtn.onclick = async () => {
            const provId = overlay.querySelector('#sx-m-prov').value;
            const prov = providers.find(p => p.id === provId);
            if (!prov) { alert('Önce provider seçin.'); return; }
            fetchBtn.disabled = true;
            fetchBtn.textContent = 'Yükleniyor...';
            checkedIds.clear();
            try {
                const rawList = await self.network.fetchModels(prov.baseUrl, prov.apiKey, prov.protocol, prov.modelsPath);
                // Layered enrichment: API fields + local KB + OpenRouter public catalog
                allFetchedModels = self.meta
                    ? await self.meta.enrichList(rawList, { online: true })
                    : rawList;

                // Backfill metadata for already-added models (context/vision/tools)
                const modelsNow = self.state.getModels();
                let metaUpdated = false;
                allFetchedModels.forEach(fm => {
                    const ex = modelsNow.find(m => m.modelId === fm.id && m.providerId === provId);
                    if (!ex) return;
                    if (fm.contextLength && !ex.contextLength) { ex.contextLength = fm.contextLength; metaUpdated = true; }
                    if (typeof fm.supportsImages === 'boolean' && typeof ex.supportsImages !== 'boolean') { ex.supportsImages = fm.supportsImages; metaUpdated = true; }
                    if (typeof fm.supportsTools === 'boolean' && typeof ex.supportsTools !== 'boolean') { ex.supportsTools = fm.supportsTools; metaUpdated = true; }
                    if (typeof fm.supportsReasoning === 'boolean' && typeof ex.supportsReasoning !== 'boolean') { ex.supportsReasoning = fm.supportsReasoning; metaUpdated = true; }
                    if (Array.isArray(fm.supportedReasoningEfforts) && !ex.supportedReasoningEfforts) { ex.supportedReasoningEfforts = fm.supportedReasoningEfforts; metaUpdated = true; }
                    if (fm.defaultReasoningEffort && !ex.defaultReasoningEffort) { ex.defaultReasoningEffort = fm.defaultReasoningEffort; metaUpdated = true; }
                    if (Array.isArray(fm.supportedParameters) && !ex.supportedParameters) { ex.supportedParameters = fm.supportedParameters; metaUpdated = true; }
                });
                // Also backfill ALL stored models missing meta (not just this provider)
                if (self.meta) {
                    const { list: bfList, changed } = await self.meta.backfillStored(modelsNow, { online: true });
                    if (changed) {
                        self.state.setModels(bfList);
                        metaUpdated = true;
                    }
                } else if (metaUpdated) {
                    self.state.setModels(modelsNow);
                }

                const hint = overlay.querySelector('#sx-m-bulk-hint');
                const filterEl = overlay.querySelector('#sx-m-filter');
                const listEl = overlay.querySelector('#sx-m-check-list');
                if (filterEl) filterEl.style.display = '';
                if (listEl) listEl.style.display = '';
                const filterText = (filterEl?.value || '').toLowerCase().trim();
                renderChecklist(filterText);
                if (hint) {
                    const total = allFetchedModels.length;
                    const already = allFetchedModels.filter(m => isAlreadyAdded(m.id, provId)).length;
                    const withCtx = allFetchedModels.filter(m => Number(m.contextLength) > 0).length;
                    const zenOk = self.meta ? allFetchedModels.filter(m => self.meta.isZenModel(m.id)).length : 0;
                    hint.style.display = '';
                    hint.textContent = `${total} model bulundu` +
                        (already ? ` — ${already} zaten ekli` : '') +
                        ` — ${withCtx}/${total} context bilgili` +
                        (zenOk ? ` — ${zenOk} Zen kataloğunda` : '') +
                        (metaUpdated ? ' — metadata güncellendi' : '') + '.';
                }
                if (metaUpdated) onSave && onSave();
            } catch(e) { alert('Listelenemedi: ' + e.message); }
            finally { fetchBtn.disabled = false; fetchBtn.innerHTML = '&#8595; Listele'; }
        };

        const filterEl = overlay.querySelector('#sx-m-filter');
        if (filterEl) filterEl.oninput = e => renderChecklist(e.target.value.toLowerCase().trim());
        const provSel = overlay.querySelector('#sx-m-prov');
        if (provSel) provSel.onchange = () => {
            // Provider changed: fetched list belongs to the old provider — reset
            checkedIds.clear();
            allFetchedModels = [];
            const listEl = overlay.querySelector('#sx-m-check-list');
            const fEl = overlay.querySelector('#sx-m-filter');
            const hint = overlay.querySelector('#sx-m-bulk-hint');
            if (listEl) { listEl.style.display = 'none'; listEl.innerHTML = ''; }
            if (fEl) { fEl.style.display = 'none'; fEl.value = ''; }
            if (hint) { hint.style.display = ''; hint.textContent = "Provider'dan model listesi yükle veya aşağıda manuel gir."; }
        };

        overlay.querySelector('#sx-m-cancel').onclick = () => overlay.remove();
        overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

        overlay.querySelector('#sx-m-save').onclick = async () => {
            const provId = overlay.querySelector('#sx-m-prov').value;
            const list = self.state.getModels();

            if (isEdit) {
                const name = overlay.querySelector('#sx-m-name').value.trim();
                const modelId = overlay.querySelector('#sx-m-id').value.trim();
                if (!name || !modelId) { alert('Model ID ve ad zorunludur.'); return; }
                const dup = list.find(m => m.modelId === modelId && m.providerId === provId && m.id !== existing.id);
                if (dup) { alert('Bu provider için aynı model ID zaten ekli.'); return; }
                const ctxRaw = Number(String(overlay.querySelector('#sx-m-ctx')?.value || '').trim());
                const entry = {
                    id: existing.id, providerId: provId, name, modelId, directMode: true,
                    contextLength: Number.isFinite(ctxRaw) && ctxRaw > 0 ? Math.round(ctxRaw) : 0,
                    supportsImages: !!overlay.querySelector('#sx-m-vision')?.checked,
                    supportsTools: !!overlay.querySelector('#sx-m-tools')?.checked,
                    metaSource: 'manual'
                };
                if (!entry.contextLength) delete entry.contextLength;
                const idx = list.findIndex(m => m.id === existing.id);
                if (idx >= 0) list[idx] = entry; else list.push(entry);
                self.state.setModels(list);
                overlay.remove();
                onSave && onSave();
                return;
            }

            // Bulk add from checklist (skip already-added)
            if (checkedIds.size > 0) {
                let added = 0;
                let skipped = 0;
                const toEnrich = [];
                checkedIds.forEach(id => {
                    if (list.some(m => m.modelId === id && m.providerId === provId)) { skipped++; return; }
                    const fm = allFetchedModels.find(m => m.id === id) || { id, name: id };
                    toEnrich.push(fm);
                });
                if (self.meta && toEnrich.length) {
                    await self.meta.enrichList(toEnrich, { online: true });
                }
                toEnrich.forEach(fm => {
                    list.push({
                        id: 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                        providerId: provId,
                        name: fm.name || fm.id,
                        modelId: fm.id,
                        directMode: true,
                        ...metaFromFetched(fm)
                    });
                    added++;
                });
                if (added === 0) {
                    alert(skipped ? 'Seçilen tüm modeller zaten ekli.' : 'Eklenecek model yok.');
                    return;
                }
                self.state.setModels(list);
                overlay.remove();
                onSave && onSave();
                return;
            }

            // Single manual add
            const manualId = (overlay.querySelector('#sx-m-id') || {}).value?.trim();
            const manualName = (overlay.querySelector('#sx-m-name') || {}).value?.trim();
            if (!manualId) { alert('Model ID girin veya listeden en az bir model seçin.'); return; }
            if (list.some(m => m.modelId === manualId && m.providerId === provId)) {
                alert('Bu provider için aynı model ID zaten ekli.');
                return;
            }
            const fmBase = allFetchedModels.find(m => m.id === manualId) || { id: manualId, name: manualName || manualId };
            const fm = self.meta
                ? await self.meta.enrichAsync(fmBase, { online: true })
                : fmBase;
            list.push({
                id: 'm_' + Date.now(),
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

        setTimeout(() => overlay.querySelector('#sx-m-prov').focus(), 50);
    }

    trySXModelsSettingsInject() {
        try {
            // 1. Safety cleanup: If an orphaned sx-content-wrapper exists outside of a valid settings dialog, remove it and restore page!
            const isSettingsDialog = (d) => {
                if (!d || d.nodeType !== 1) return false;
                const text = (d.textContent || '').toLowerCase();
                if (text.includes('delete conversation') || text.includes('delete this') || text.includes('silmek istediğinize')) return false;
                return text.includes('general') || text.includes('genel') || text.includes('appearance') || text.includes('görünüm') || text.includes('models') || text.includes('shortcuts') || !!d.querySelector('[role="tablist"], [role="tab"], nav');
            };

            document.querySelectorAll('#sx-content-wrapper').forEach(wrap => {
                const parentDialog = wrap.closest('[role="dialog"]');
                if (!parentDialog || !isSettingsDialog(parentDialog)) {
                    const parent = wrap.parentElement;
                    if (parent) {
                        Array.from(parent.children).forEach(c => c.style.removeProperty('display'));
                    }
                    wrap.remove();
                }
            });

            // 2. Locate the real Settings modal
            const allDialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
            const dialog = allDialogs.find(isSettingsDialog);
            if (!dialog) {
                this._selectedSettingsTab = null;
                return;
            }

            this.injectGlobalStyles();

            // 3. Locate the tablist (sidebar) and rightPanel (content container)
            const tabList = dialog.querySelector('[role="tablist"], nav, aside');
            let rightPanel = dialog.querySelector('[role="tabpanel"]');

            if (!rightPanel && tabList && tabList.parentElement) {
                const siblings = Array.from(tabList.parentElement.children).filter(el => el !== tabList);
                if (siblings.length === 1) {
                    rightPanel = siblings[0];
                }
            }
            if (!rightPanel) {
                const scrollContainers = Array.from(dialog.querySelectorAll('.overflow-y-auto, main'));
                rightPanel = scrollContainers.find(c => (!tabList || !c.contains(tabList)) && c !== dialog);
            }

            if (!rightPanel || rightPanel === dialog || (tabList && rightPanel.contains(tabList))) return;

            // 4. Check which tab is currently active
            const activeTabBtn = dialog.querySelector('[role="tab"][aria-selected="true"], [role="tab"][data-state="active"], button[aria-selected="true"], button[data-state="active"], nav button.active');
            let activeTabTxt = (activeTabBtn?.textContent || '').trim().toLowerCase();
            if (!activeTabTxt && this._selectedSettingsTab) {
                activeTabTxt = this._selectedSettingsTab;
            }

            const isExplicitOtherTab = ['general', 'genel', 'appearance', 'görünüm', 'application', 'uygulama', 'shortcut', 'kısayol', 'customization', 'özelleştirme', 'browser', 'tarayıcı'].some(k => activeTabTxt.includes(k));

            const panelText = (rightPanel.textContent || '').toLowerCase();
            const hasNativeModelsText = ['manage your model quota', 'model credits', 'your plan', 'custom quota'].some(m => panelText.includes(m));

            const isModelsActive = !isExplicitOtherTab && (activeTabTxt.includes('model') || hasNativeModelsText || this._selectedSettingsTab === 'models');

            const existingWrap = dialog.querySelector('#sx-content-wrapper');

            // If user is NOT on Models tab, cleanly remove custom wrap and restore native view!
            if (!isModelsActive) {
                if (existingWrap) {
                    const rp = existingWrap.parentElement;
                    existingWrap.remove();
                    if (rp) {
                        Array.from(rp.children).forEach(c => c.style.removeProperty('display'));
                    }
                }
                return;
            }

            // User IS on Models tab: if wrap already exists inside rightPanel, keep it visible
            if (existingWrap && rightPanel.contains(existingWrap)) {
                Array.from(rightPanel.children).forEach(c => {
                    if (c.id !== 'sx-content-wrapper') {
                        c.style.setProperty('display', 'none', 'important');
                    } else {
                        c.style.removeProperty('display');
                    }
                });
                return;
            }

            // Clean up any stray wrap before fresh mount
            if (existingWrap) existingWrap.remove();

            Array.from(rightPanel.children).forEach(c => {
                c.style.setProperty('display', 'none', 'important');
            });

            const sxWrap = document.createElement('div');
            sxWrap.id = 'sx-content-wrapper';
            sxWrap.style.cssText = 'padding: 0 32px 32px 32px; box-sizing: border-box; width: 100%; height: 100%; overflow-y: auto;';
            rightPanel.appendChild(sxWrap);

        const sxHeader = document.createElement('div');
        sxHeader.id = 'sx-custom-engine-header';
        sxHeader.innerHTML = `
            <div style="padding:20px 0 14px 0;">
                <div style="font-size:22px;font-weight:700;color:rgba(255,255,255,0.92);letter-spacing:-0.5px;">Models &amp; Usage</div>
                <div style="font-size:13px;color:rgba(255,255,255,0.4);margin-top:4px;">Doğrudan custom provider bağlantısı aktif.</div>
            </div>
        `;
        sxWrap.appendChild(sxHeader);

        const provSec = document.createElement('div');
        provSec.id = 'sx-providers-section';
        provSec.className = 'sx-section';
        sxWrap.appendChild(provSec);

        const modelsSec = document.createElement('div');
        modelsSec.id = 'sx-models-section';
        modelsSec.className = 'sx-section';
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
                html += '<div class="sx-empty-hint">Henüz provider eklenmedi.<br>OpenRouter, Anthropic veya OpenAI uyumlu bir sağlayıcı ekleyin.</div>';
            } else {
                providers.forEach(p => {
                    const count = models.filter(m => m.providerId === p.id).length;
                    html += `
                        <div class="sx-card">
                            <div class="sx-card-dot" style="background:#38bdf8;"></div>
                            <div class="sx-card-info">
                                <div style="display:flex;align-items:center;gap:8px;">
                                    <div class="sx-card-name">${this.sxEsc(p.name)}</div>
                                    <span style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.45);background:rgba(255,255,255,0.06);padding:1px 6px;border-radius:4px;">${count} model</span>
                                </div>
                                <div class="sx-card-sub">${this.sxEsc(p.baseUrl || '')}</div>
                            </div>
                            <div class="sx-card-actions">
                                <button type="button" class="sx-btn test-p" data-id="${p.id}" style="padding:2px 8px;font-size:11px;height:24px;border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.85);border-radius:4px;cursor:pointer;" title="Provider Bağlantısını Test Et">⚡ Test</button>
                                <button class="sx-icon-btn edit-p" data-id="${p.id}" title="Edit">✎</button>
                                <button class="sx-icon-btn del del-p" data-id="${p.id}" title="Delete">✕</button>
                            </div>
                        </div>
                    `;
                });
            }
            provSec.innerHTML = html;
            provSec.querySelector('#sx-add-prov-btn').onclick = () => this.openProviderModal(null, () => { renderProviders(); renderModels(); });
            provSec.querySelectorAll('.test-p').forEach(b => {
                b.onclick = async (e) => {
                    e.stopPropagation();
                    const origText = b.textContent;
                    b.disabled = true;
                    b.textContent = '⏳...';
                    try {
                        const res = await this.network.post('/sx/test-provider', { providerId: b.dataset.id });
                        if (res && res.ok) {
                            b.textContent = `✓ ${res.latency || 0}ms`;
                            b.style.color = '#86efac';
                            b.style.borderColor = 'rgba(134,239,172,0.4)';
                        } else {
                            b.textContent = `✕ ${res?.status || 'Hata'}`;
                            b.style.color = '#f87171';
                            b.style.borderColor = 'rgba(248,113,113,0.4)';
                        }
                    } catch(err) {
                        b.textContent = '✕ Hata';
                        b.style.color = '#f87171';
                    }
                    setTimeout(() => {
                        b.disabled = false;
                        b.textContent = origText;
                        b.style.color = '';
                        b.style.borderColor = '';
                    }, 3500);
                };
            });
            provSec.querySelectorAll('.edit-p').forEach(b => {
                b.onclick = () => { const p = this.state.getProviders().find(x => x.id === b.dataset.id); if (p) this.openProviderModal(p, () => { renderProviders(); renderModels(); }); };
            });
            provSec.querySelectorAll('.del-p').forEach(b => {
                b.onclick = () => {
                    if (!confirm('Bu provider ve modellerini sil?')) return;
                    this.state.setProviders(this.state.getProviders().filter(x => x.id !== b.dataset.id));
                    this.state.setModels(this.state.getModels().filter(x => x.providerId !== b.dataset.id));
                    renderProviders(); renderModels();
                };
            });
        };

        const renderModels = () => {
            const allModels = this.state.getModels();
            const providers = this.state.getProviders();
            const searchQuery = (this._modelSearchQuery || '').toLowerCase().trim();

            const filteredModels = searchQuery
                ? allModels.filter(m => (m.name || '').toLowerCase().includes(searchQuery) || (m.modelId || '').toLowerCase().includes(searchQuery))
                : allModels;

            const subagentCount = allModels.filter(m => m.isSubagent).length;

            let html = `
                <div class="sx-section-header">
                    <div style="display:flex;align-items:center;gap:6px;">
                        <div class="sx-section-title">Models</div>
                        <span class="sx-section-count">(${allModels.length})</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:10px;">
                        <span style="font-size:11px;color:rgba(255,255,255,0.5);" title="Subagent isteklerini yürütebilecek seçili modeller">🤖 Subagent Havuzu: <strong style="color:${subagentCount > 0 ? '#38bdf8' : 'rgba(255,255,255,0.6)'};">${subagentCount} seçili</strong></span>
                        <button type="button" class="sx-btn sx-btn-primary" id="sx-add-model-btn">+ Add Model</button>
                    </div>
                </div>
                <div style="margin:8px 0 12px 0;">
                    <input type="text" id="sx-models-search-input" value="${this.sxEsc(this._modelSearchQuery || '')}" placeholder="🔍 Model adı veya ID filtrele..." style="width:100%;height:32px;box-sizing:border-box;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:0 10px;font-size:12px;color:#ffffff;outline:none;transition:border-color 0.15s ease;" />
                </div>
            `;

            if (!filteredModels.length) {
                html += searchQuery
                    ? `<div class="sx-empty-hint">"${this.sxEsc(searchQuery)}" ile eşleşen model bulunamadı.</div>`
                    : '<div class="sx-empty-hint">Henüz model eklenmedi.<br>Yukarıdan bir provider ekleyip model tanımlayın.</div>';
            } else {
                // Group by Provider
                const grouped = new Map();
                filteredModels.forEach(m => {
                    const p = providers.find(x => x.id === m.providerId);
                    const pName = p ? p.name : 'Diğer / Tanımsız';
                    if (!grouped.has(pName)) grouped.set(pName, []);
                    grouped.get(pName).push(m);
                });

                grouped.forEach((pModels, pName) => {
                    html += `
                        <div class="sx-provider-group-header" style="margin:14px 0 8px 0;padding-bottom:5px;border-bottom:1px solid rgba(255,255,255,0.12);display:flex;align-items:center;justify-content:space-between;">
                            <span style="font-size:12px;font-weight:700;color:rgba(255,255,255,0.85);text-transform:uppercase;letter-spacing:0.5px;">${this.sxEsc(pName)}</span>
                            <span style="font-size:10.5px;color:rgba(255,255,255,0.45);font-weight:600;">${pModels.length} model</span>
                        </div>
                        <div class="sx-models-list" style="margin-bottom:12px;">
                    `;

                    pModels.forEach(m => {
                        const ctxTag = this.models.formatContextSize(m.contextLength);
                        const badgeBits = [];
                        if (ctxTag) badgeBits.push(`<span style="font-size:9.5px;font-weight:700;color:#a3e635;background:rgba(163,230,53,0.08);border:1px solid rgba(163,230,53,0.2);padding:0 5px;border-radius:4px;">${ctxTag}</span>`);
                        if (this.models.isVisionModel(m)) badgeBits.push('<span style="font-size:9.5px;font-weight:600;color:#38bdf8;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.2);padding:0 5px;border-radius:4px;">Vision</span>');
                        if (m.supportsTools === true) badgeBits.push('<span style="font-size:9.5px;font-weight:600;color:#fb923c;background:rgba(251,146,60,0.08);border:1px solid rgba(251,146,60,0.2);padding:0 5px;border-radius:4px;">Tools</span>');

                        const isSub = !!m.isSubagent;
                        const subStyle = isSub
                            ? 'background:rgba(56,189,248,0.18);border:1px solid rgba(56,189,248,0.45);color:#38bdf8;font-weight:600;'
                            : 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.45);';

                        html += `
                            <div class="sx-model-card" style="display:flex;align-items:center;gap:10px;">
                                <div class="sx-model-name" style="flex:1.2;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${this.sxEsc(m.name)}</div>
                                <div class="sx-model-id" style="flex:1.4;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:rgba(255,255,255,0.45);">${this.sxEsc(m.modelId)}</div>
                                <div style="display:flex;gap:4px;flex-shrink:0;">${badgeBits.join('')}</div>
                                <button type="button" class="sx-btn subagent-toggle" data-id="${m.id}" style="height:22px;padding:0 8px;font-size:10.5px;border-radius:4px;cursor:pointer;transition:all 0.15s ease;flex-shrink:0;${subStyle}" title="Bu modeli subagent havuzuna ekle / çıkar">
                                    🤖 ${isSub ? 'Subagent ✓' : 'Subagent'}
                                </button>
                                <div class="sx-card-actions" style="flex-shrink:0;">
                                    <button class="sx-icon-btn edit-m" data-id="${m.id}" title="Edit">✎</button>
                                    <button class="sx-icon-btn del del-m" data-id="${m.id}" title="Delete">✕</button>
                                </div>
                            </div>
                        `;
                    });

                    html += '</div>';
                });
            }
            modelsSec.innerHTML = html;

            const searchInput = modelsSec.querySelector('#sx-models-search-input');
            if (searchInput) {
                searchInput.oninput = (e) => {
                    this._modelSearchQuery = e.target.value;
                    renderModels();
                    const nextInput = modelsSec.querySelector('#sx-models-search-input');
                    if (nextInput) {
                        nextInput.focus();
                        nextInput.selectionStart = nextInput.selectionEnd = nextInput.value.length;
                    }
                };
            }

            modelsSec.querySelectorAll('.subagent-toggle').forEach(b => {
                b.onclick = (e) => {
                    e.stopPropagation();
                    const mod = allModels.find(x => x.id === b.dataset.id);
                    if (mod) {
                        mod.isSubagent = !mod.isSubagent;
                        this.state.setModels(allModels);
                        renderModels();
                    }
                };
            });

            modelsSec.querySelector('#sx-add-model-btn').onclick = () => this.openModelModal(null, () => renderModels());
            modelsSec.querySelectorAll('.edit-m').forEach(b => {
                b.onclick = () => { const m = this.state.getModels().find(x => x.id === b.dataset.id); if (m) this.openModelModal(m, () => renderModels()); };
            });
            modelsSec.querySelectorAll('.del-m').forEach(b => {
                b.onclick = () => {
                    if (!confirm('Bu modeli sil?')) return;
                    this.state.setModels(this.state.getModels().filter(x => x.id !== b.dataset.id));
                    renderModels();
                };
            });
        };

        renderProviders();
        renderModels();
        } catch(e) {
            this.logger.error('UIInjector', 'Settings inject error:', e);
        }
    }

    trySXAppearanceSettingsInject() {
        const dialog = document.querySelector('[role="dialog"]');
        if (dialog) {
            const nativeCombos = dialog.querySelectorAll('button[role="combobox"]');
            nativeCombos.forEach(b => {
                if (b.style.display === 'none') b.style.removeProperty('display');
            });

            // Clean up any previously injected quick-preset bar
            const existingPillBar = document.getElementById('sx-quick-presets-bar');
            if (existingPillBar) existingPillBar.remove();
        }

        // 2. Hook native theme combobox listbox when opened (whether in dialog or portal on body)
        const listbox = document.querySelector('[role="listbox"]');
        if (listbox && !listbox.querySelector('.sx-custom-preset-option')) {
            const allOpts = Array.from(listbox.querySelectorAll('[role="option"], [data-radix-collection-item]'));
            const isThemeListbox = allOpts.some(o => {
                const txt = o.innerText || o.textContent || '';
                return /Dark|Light|Tokyo|Ocean|Matrix|Default|Tema/i.test(txt);
            });

            if (isThemeListbox) {
                const targetContainer = listbox.querySelector('[data-radix-select-viewport]') || listbox;
                const sampleOpt = allOpts[0];

                SX_THEME_PRESETS.forEach(p => {
                    const opt = document.createElement('div');
                    opt.setAttribute('role', 'option');
                    opt.setAttribute('tabindex', '-1');
                    if (sampleOpt) {
                        opt.className = sampleOpt.className;
                    } else {
                        opt.style.cssText = 'padding:6px 12px;cursor:pointer;display:flex;align-items:center;font-size:13px;border-radius:6px;margin:1px 0;user-select:none;color:rgba(255,255,255,0.85);';
                    }
                    opt.classList.add('sx-custom-preset-option');
                    opt.innerHTML = `<span class="truncate" style="font-weight:inherit;color:inherit;">${p.name}</span>`;

                    opt.addEventListener('mouseenter', () => {
                        opt.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
                        opt.style.color = '#ffffff';
                    });
                    opt.addEventListener('mouseleave', () => {
                        opt.style.backgroundColor = '';
                        opt.style.color = '';
                    });

                    opt.addEventListener('click', (e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        this.theme.applyPreset(p, true);

                        // Update open combobox label
                        const combo = document.querySelector('[role="dialog"] button[role="combobox"] span') ||
                                      document.querySelector('button[role="combobox"][data-state="open"] span');
                        if (combo) combo.innerText = p.name;

                        // Dismiss listbox
                        const openCombo = document.querySelector('button[role="combobox"][data-state="open"]');
                        if (openCombo) openCombo.click();
                        else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
                    });

                    targetContainer.appendChild(opt);
                });
            }
        }
    }

    hookDOM() {
        // Dedupe: hookDOM is driven by overlapping intervals (200ms + 350ms);
        // running at most ~4x/sec is plenty and halves redundant DOM scans.
        const nowTs = Date.now();
        if (this._lastHookTs && (nowTs - this._lastHookTs < 250)) return;
        this._lastHookTs = nowTs;
        // 1. Ensure theme classes
        try {
            const currentPreset = localStorage.getItem('theme-preset-dark');
            const foundPreset = this.theme.currentThemeId || (currentPreset?.startsWith('SX '));
            if (foundPreset && !document.body.classList.contains('sx-theme-active')) {
                document.body.classList.add('sx-theme-active');
            }
        } catch(e) {}

        // 2. Chat action buttons (Context & Perf)
        const promptInput = document.querySelector('[contenteditable="true"], div.cursor-text[role="combobox"], textarea');
        const promptRoot = promptInput ? promptInput.closest('form, div.relative, [data-testid="chat-input-container"]') : null;
        const actionContainer = document.querySelector(
            'div.flex.items-center.gap-1:has([data-tooltip-id*="input-send-button"]), ' +
            'div.flex.items-center.gap-1:has([data-testid="send-button"]), ' +
            'div.flex.items-center.gap-1:has(button[aria-label*="Record voice" i]), ' +
            'div.flex.items-center.gap-1:has(button[aria-label*="Cancel" i])'
        ) || (promptRoot ? promptRoot.querySelector('div.flex.items-center.gap-1') : null);

        if (actionContainer) {
            let ctxBtn = document.getElementById('sx-context-btn');
            let perfBtn = document.getElementById('sx-perf-btn');
            let effortBtn = document.getElementById('sx-effort-pill');
            const micWrapper = actionContainer.querySelector('div.flex.items-center:has(button[aria-label*="Record voice" i]), div.flex.items-center:has([data-tooltip-id*="record-tooltip"])') ||
                actionContainer.querySelector('button[aria-label*="Record voice" i]');
            const sendBtn = actionContainer.querySelector('[data-testid="send-button"], button[aria-label*="send" i], [data-tooltip-id*="send-tooltip"]');
            const cancelBtn = actionContainer.querySelector('button[aria-label*="Cancel" i], [data-tooltip-id*="cancel-tooltip"]');
            const targetAnchor = micWrapper || sendBtn || cancelBtn;

            if (!effortBtn) {
                effortBtn = document.createElement('button');
                effortBtn.id = 'sx-effort-pill';
                effortBtn.type = 'button';
                effortBtn.className = 'sx-effort-pill';
                effortBtn.title = 'Agent Effort (Tıkla)';
                effortBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.toggleEffortSliderPopover(effortBtn);
                };
            }

            if (!ctxBtn) {
                ctxBtn = document.createElement('button');
                ctxBtn.id = 'sx-context-btn';
                ctxBtn.type = 'button';
                ctxBtn.title = 'Context Window (Tıkla)';
                ctxBtn.style.cssText = `
                    display: inline-flex !important; align-items: center !important; justify-content: center !important;
                    width: 28px !important; height: 28px !important; border-radius: 50% !important; background: transparent !important;
                    border: none !important; padding: 0 !important; cursor: pointer !important; user-select: none !important;
                `;
                ctxBtn.onclick = (e) => { e.stopPropagation(); this.quota.toggleContextPopover(ctxBtn); };
            }

            if (!perfBtn) {
                perfBtn = document.createElement('button');
                perfBtn.id = 'sx-perf-btn';
                perfBtn.type = 'button';
                perfBtn.title = 'Model Performansı (TTFT, TPS) (Tıkla)';
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
                perfBtn.onclick = (e) => { e.stopPropagation(); this.perf.togglePerfPopover(perfBtn); };
            }

            // Left to right: perfBtn -> ctxBtn -> effortBtn -> targetAnchor (microphone / send)
            if (targetAnchor && targetAnchor.parentElement === actionContainer) {
                if (targetAnchor.previousElementSibling !== effortBtn) {
                    actionContainer.insertBefore(effortBtn, targetAnchor);
                }
            } else if (!actionContainer.contains(effortBtn)) {
                actionContainer.appendChild(effortBtn);
            }

            if (effortBtn.previousElementSibling !== ctxBtn) {
                actionContainer.insertBefore(ctxBtn, effortBtn);
            }

            if (ctxBtn.previousElementSibling !== perfBtn) {
                actionContainer.insertBefore(perfBtn, ctxBtn);
            }

            this.quota.updateContextButtonUI();
            this.perf.updatePerfButtonUI();
            this.injectEffortButton();
        }

        // 3. Custom searchable model selector dropdown panel
        this.trySXModelSelectorPanelInject();

        // 4. Trigger button text sync
        const trigger = document.querySelector('[data-testid="model-selector-trigger"]');
        if (trigger) {
            const sxModels = this.state.getModels();
            if (sxModels.length > 0) {
                const curConv = this.models.getActiveConversationKey();
                const activeId = this.models.getActiveModelForConversation(curConv);
                const activeM = sxModels.find(m => m.id === activeId) || sxModels[0];
                if (activeM) {
                    const pMeta = this.models.getProviderMeta(activeM.providerId);
                    const s = trigger.querySelector('.truncate') || trigger.querySelector('span') || trigger;
                    const desiredKey = activeM.id + '_' + pMeta.name;
                    if (s && s.dataset.sxKey !== desiredKey) {
                        s.dataset.sxKey = desiredKey;
                        s.style.setProperty('display', 'inline-flex', 'important');
                        s.style.setProperty('align-items', 'center', 'important');
                        s.innerHTML = `
                            <span class="sx-prov-badge" style="display:inline-flex;align-items:center;gap:3.5px;padding:0.5px 5px;border-radius:4px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);font-size:9.5px;font-weight:700;color:${pMeta.color};margin-right:6px;"><span style="width:4px;height:4px;border-radius:50%;background:${pMeta.color};"></span>${this.sxEsc(pMeta.name)}</span>
                            <span style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600;color:rgba(255,255,255,0.95);">${this.sxEsc(activeM.name)}</span>
                        `;
                        trigger.setAttribute('aria-label', `Select model, current: ${activeM.name}`);
                    }
                }
            }
        }

        // 5. Symmetric Quota Submenu Sync
        const quotaMenu = document.querySelector('[role="menu"][data-nested]');
        if (quotaMenu) {
            const span = quotaMenu.querySelector('span.text-foreground.truncate');
            if (span && (!span.dataset.sxFixed || !span.textContent.trim())) {
                span.dataset.sxFixed = 'true';
                span.innerHTML = '<span style="color:#38bdf8;font-weight:700;">SX</span> <span style="color:#ffffff;">Development</span>';
            }
        }

        // 6. Injections for settings tabs
        this.trySXModelsSettingsInject();
        this.trySXAppearanceSettingsInject();
    }

    trySXModelSelectorPanelInject() {
        const modelPanel = document.querySelector('[data-testid="model-selector-panel"]');
        if (!modelPanel || modelPanel.closest('[data-sx-usage-panel]')) return;

        const sxModels = this.state.getModels();
        if (!sxModels || sxModels.length === 0) return;

        const menuBox = modelPanel.closest('[role="menu"]') || modelPanel.parentElement;
        const isMenu = menuBox && menuBox !== modelPanel;

        if (isMenu) {
            menuBox.style.setProperty('background', 'hsl(var(--popover, var(--card, 222 47% 11%)))', 'important');
            menuBox.style.setProperty('border', '1px solid hsl(var(--border, rgba(255, 255, 255, 0.12)))', 'important');
            menuBox.style.setProperty('border-radius', '10px', 'important');
            menuBox.style.setProperty('box-shadow', '0 10px 30px -4px rgba(0, 0, 0, 0.45), 0 4px 12px -2px rgba(0, 0, 0, 0.25)', 'important');
            menuBox.style.setProperty('backdrop-filter', 'blur(20px)', 'important');
            menuBox.style.setProperty('padding', '0', 'important');
            menuBox.style.setProperty('width', '320px', 'important');
            menuBox.style.setProperty('min-width', '320px', 'important');
            menuBox.style.setProperty('max-width', '340px', 'important');
            menuBox.style.setProperty('overflow', 'hidden', 'important');
            menuBox.style.setProperty('outline', 'none', 'important');
            menuBox.style.transition = 'transform 0.08s ease-out';

            modelPanel.style.setProperty('background', 'transparent', 'important');
            modelPanel.style.setProperty('border', 'none', 'important');
            modelPanel.style.setProperty('border-radius', '0', 'important');
            modelPanel.style.setProperty('box-shadow', 'none', 'important');
            modelPanel.style.setProperty('backdrop-filter', 'none', 'important');
            modelPanel.style.setProperty('padding', '0', 'important');
            modelPanel.style.setProperty('transform', 'none', 'important');
            modelPanel.style.setProperty('width', '100%', 'important');
            modelPanel.style.setProperty('min-width', '0', 'important');
            modelPanel.style.setProperty('max-width', '100%', 'important');
        } else {
            modelPanel.style.background = 'hsl(var(--popover, var(--card, 222 47% 11%)))';
            modelPanel.style.border = '1px solid hsl(var(--border, rgba(255, 255, 255, 0.12)))';
            modelPanel.style.borderRadius = '10px';
            modelPanel.style.boxShadow = '0 10px 30px -4px rgba(0, 0, 0, 0.45), 0 4px 12px -2px rgba(0, 0, 0, 0.25)';
            modelPanel.style.backdropFilter = 'blur(20px)';
            modelPanel.style.width = '320px';
            modelPanel.style.minWidth = '320px';
            modelPanel.style.maxWidth = '340px';
            modelPanel.style.padding = '0';
            modelPanel.style.overflow = 'hidden';
            modelPanel.style.transition = 'transform 0.08s ease-out';
        }

        // Position model menu cleanly above the chat input box so it never covers what the user is typing
        const targetShiftBox = isMenu ? menuBox : modelPanel;
        const adjustPosition = () => {
            try {
                if (!targetShiftBox || !targetShiftBox.isConnected) return;
                const boxTop = this.getPromptBoxTop();
                targetShiftBox.style.removeProperty('margin-top');
                targetShiftBox.style.removeProperty('transform');
                const mRect = targetShiftBox.getBoundingClientRect();
                if (mRect.bottom > boxTop - 10) {
                    const shiftY = Math.ceil(mRect.bottom - (boxTop - 10));
                    const maxShift = Math.max(0, Math.floor(mRect.top - 12));
                    const safeShift = Math.min(shiftY, maxShift);
                    if (safeShift > 0) {
                        targetShiftBox.style.setProperty('margin-top', `-${safeShift}px`, 'important');
                    }
                }
            } catch(e) {}
        };
        adjustPosition();
        setTimeout(adjustPosition, 25);
        setTimeout(adjustPosition, 60);
        setTimeout(adjustPosition, 140);

        if (!targetShiftBox._sxResizeObs) {
            targetShiftBox._sxResizeObs = new ResizeObserver(() => {
                requestAnimationFrame(adjustPosition);
            });
            targetShiftBox._sxResizeObs.observe(targetShiftBox);
        }

        // Prevent View Usage from auto-opening without explicit hover
        const viewUsageItem = Array.from(modelPanel.querySelectorAll('[role="menuitem"], div, button')).find(el => {
            return (el.textContent || '').trim().toLowerCase().includes('view usage');
        });
        if (viewUsageItem) {
            viewUsageItem.setAttribute('tabindex', '-1');
            viewUsageItem.blur();
            const checkNestedSubmenu = () => {
                const nestedMenu = document.querySelector('[role="menu"][data-nested]');
                if (nestedMenu) {
                    const isHovered = viewUsageItem.matches(':hover') || nestedMenu.matches(':hover');
                    const popper = nestedMenu.closest('[role="presentation"]') || nestedMenu;
                    if (!isHovered) {
                        popper.style.setProperty('display', 'none', 'important');
                    } else {
                        popper.style.removeProperty('display');
                    }
                }
            };
            checkNestedSubmenu();
            setTimeout(checkNestedSubmenu, 20);
            setTimeout(checkNestedSubmenu, 60);
            setTimeout(checkNestedSubmenu, 150);

            viewUsageItem.addEventListener('mouseenter', () => {
                const nestedMenu = document.querySelector('[role="menu"][data-nested]');
                if (nestedMenu) {
                    const popper = nestedMenu.closest('[role="presentation"]') || nestedMenu;
                    popper.style.removeProperty('display');
                }
            });
            viewUsageItem.addEventListener('mouseleave', () => {
                setTimeout(checkNestedSubmenu, 60);
            });
        }

        const scrollContainer = modelPanel.querySelector('.overflow-y-auto');
        if (scrollContainer) {
            scrollContainer.style.maxHeight = '340px';
            scrollContainer.style.padding = '4px 6px';
        }

        // Sticky search input at the very top of panel
        let searchWrap = modelPanel.querySelector('#sx-model-search-wrap');
        if (!searchWrap) {
            searchWrap = document.createElement('div');
            searchWrap.id = 'sx-model-search-wrap';
            searchWrap.style.cssText = 'padding: 8px 10px; border-bottom: 1px solid hsl(var(--border, rgba(255,255,255,0.08))); background: hsl(var(--popover, var(--card, 222 47% 11%))) !important; position: sticky; top: 0; z-index: 20; box-sizing: border-box;';
            searchWrap.innerHTML = `
                <div style="display:flex;align-items:center;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:0 10px;gap:7px;height:32px;box-sizing:border-box;width:100%;transition:border-color 0.15s;">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:rgba(255,255,255,0.3);flex-shrink:0;">
                        <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    <input id="sx-model-search-input" type="text" placeholder="Search models..." style="background:transparent;border:none;outline:none;color:rgba(255,255,255,0.9);font-size:12.5px;width:100%;height:100%;font-family:inherit;line-height:normal;padding:0;margin:0;" autocomplete="off" spellcheck="false" />
                </div>
            `;
            modelPanel.prepend(searchWrap);

            const inputWrap = searchWrap.querySelector('div');
            const input = searchWrap.querySelector('#sx-model-search-input');
            input.addEventListener('focus', () => { inputWrap.style.borderColor = 'rgba(255,255,255,0.25)'; inputWrap.style.background = 'rgba(255,255,255,0.07)'; });
            input.addEventListener('blur', () => { inputWrap.style.borderColor = 'rgba(255,255,255,0.1)'; inputWrap.style.background = 'rgba(255,255,255,0.05)'; });

            ['keydown', 'keyup', 'keypress'].forEach(evt => {
                input.addEventListener(evt, e => e.stopPropagation());
            });

            input.addEventListener('input', () => {
                const q = input.value.trim().toLowerCase();
                const items = modelPanel.querySelectorAll('.sx-custom-model-item');
                let visibleCount = 0;
                items.forEach(item => {
                    const lbl = (item.getAttribute('data-model-label') || item.innerText || '').toLowerCase();
                    const match = !q || lbl.includes(q);
                    item.classList.toggle('is-hidden', !match);
                    if (match) visibleCount++;
                });

                modelPanel.querySelectorAll('.sx-provider-header').forEach(hdr => {
                    const pId = hdr.getAttribute('data-provider-id');
                    const hasVisible = Array.from(modelPanel.querySelectorAll(`.sx-custom-model-item[data-sx-provider="${pId}"]`)).some(it => !it.classList.contains('is-hidden'));
                    hdr.style.display = hasVisible ? 'flex' : 'none';
                });

                let emptyMsg = modelPanel.querySelector('#sx-model-search-empty');
                if (visibleCount === 0) {
                    if (!emptyMsg) {
                        emptyMsg = document.createElement('div');
                        emptyMsg.id = 'sx-model-search-empty';
                        emptyMsg.style.cssText = 'padding: 16px 10px; font-size: 11.5px; color: rgba(255,255,255,0.3); text-align: center;';
                        emptyMsg.innerText = 'No matching models found';
                        modelPanel.querySelector('.overflow-y-auto')?.appendChild(emptyMsg);
                    }
                    emptyMsg.style.setProperty('display', 'block', 'important');
                } else if (emptyMsg) {
                    emptyMsg.style.setProperty('display', 'none', 'important');
                }
                adjustPosition();
            });

            setTimeout(() => input.focus(), 50);
        }

        // Hide default "Model" header
        const defaultHeader = modelPanel.querySelector('[data-testid="model-selector-header"]');
        if (defaultHeader) defaultHeader.style.display = 'none';

        const providers = this.state.getProviders();

        const listContainer = modelPanel.querySelector('.flex.flex-col.gap-px') || modelPanel.querySelector('.overflow-y-auto');
        if (listContainer) {
            const nativeItems = Array.from(listContainer.querySelectorAll('[data-testid="model-selector-item"]:not(.sx-custom-model-item)'));
            const sampleNative = nativeItems[0];
            nativeItems.forEach(item => item.style.display = 'none');

            if (!document.getElementById('sx-custom-model-style')) {
                const st = document.createElement('style');
                st.id = 'sx-custom-model-style';
                st.textContent = `
                    .sx-custom-model-item {
                        min-height: 28px !important;
                        padding: 3px 8px !important;
                        margin: 1px 0 !important;
                        border-radius: 6px !important;
                        cursor: pointer !important;
                        user-select: none !important;
                        display: flex !important;
                        align-items: center !important;
                        justify-content: space-between !important;
                        gap: 8px !important;
                        box-sizing: border-box !important;
                        transition: background-color 0.1s ease, color 0.1s ease !important;
                    }
                    .sx-custom-model-item.has-badges {
                        min-height: 42px !important;
                        padding: 5px 8px !important;
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
                    .sx-model-info-col {
                        flex: 1 1 auto !important;
                        min-width: 0 !important;
                        display: flex !important;
                        flex-direction: column !important;
                        justify-content: center !important;
                        gap: 2px !important;
                    }
                    .sx-custom-model-item .sx-model-title {
                        font-size: 12px !important;
                        line-height: 1.3 !important;
                        color: rgba(255, 255, 255, 0.92) !important;
                        overflow: hidden !important;
                        text-overflow: ellipsis !important;
                        white-space: nowrap !important;
                        width: 100% !important;
                    }
                    .sx-model-badges-row {
                        display: flex !important;
                        align-items: center !important;
                        gap: 4px !important;
                        flex-wrap: wrap !important;
                        margin-top: 1px !important;
                    }
                    .sx-model-right-actions {
                        flex-shrink: 0 !important;
                        margin-left: auto !important;
                        display: flex !important;
                        align-items: center !important;
                        justify-content: flex-end !important;
                        gap: 4px !important;
                        width: 36px !important;
                        min-width: 36px !important;
                    }
                    .sx-model-check-slot {
                        width: 14px !important;
                        height: 14px !important;
                        display: flex !important;
                        align-items: center !important;
                        justify-content: center !important;
                        flex-shrink: 0 !important;
                    }
                    .sx-model-arrow-slot {
                        width: 14px !important;
                        height: 14px !important;
                        display: flex !important;
                        align-items: center !important;
                        justify-content: center !important;
                        flex-shrink: 0 !important;
                    }
                    .sx-model-chevron-hint {
                        display: inline-flex !important;
                        align-items: center !important;
                        justify-content: center !important;
                        cursor: pointer !important;
                        color: rgba(255, 255, 255, 0.3) !important;
                        transition: color 0.12s ease !important;
                        flex-shrink: 0 !important;
                        line-height: 1 !important;
                    }
                    .sx-custom-model-item:hover .sx-model-chevron-hint {
                        color: rgba(255, 255, 255, 0.85) !important;
                    }
                    .sx-reasoning-arrow {
                        opacity: 0.45 !important;
                        transition: opacity 0.12s ease, transform 0.12s ease !important;
                        flex-shrink: 0 !important;
                    }
                    .sx-custom-model-item:hover .sx-reasoning-arrow {
                        opacity: 0.9 !important;
                        transform: translateX(1px) !important;
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
                    .sx-nested-menu {
                        position: fixed !important;
                        z-index: 999999 !important;
                        background: hsl(var(--popover, var(--card, 222 47% 11%))) !important;
                        border: 1px solid hsl(var(--border, rgba(255, 255, 255, 0.12))) !important;
                        border-radius: 8px !important;
                        padding: 4px !important;
                        min-width: 135px !important;
                        max-height: calc(100vh - 24px) !important;
                        overflow-y: auto !important;
                        box-shadow: 0 10px 30px -4px rgba(0, 0, 0, 0.45), 0 4px 12px -2px rgba(0, 0, 0, 0.25) !important;
                        backdrop-filter: blur(20px) !important;
                        font-family: inherit !important;
                        display: flex !important;
                        flex-direction: column !important;
                        gap: 2px !important;
                        box-sizing: border-box !important;
                    }
                    .sx-nested-item {
                        height: 28px !important;
                        padding: 0 10px !important;
                        border-radius: 6px !important;
                        font-size: 12px !important;
                        font-weight: 500 !important;
                        color: rgba(255, 255, 255, 0.8) !important;
                        cursor: pointer !important;
                        display: flex !important;
                        align-items: center !important;
                        justify-content: space-between !important;
                        transition: background 0.12s ease, color 0.12s ease !important;
                        user-select: none !important;
                    }
                    .sx-nested-item:hover {
                        background: rgba(255, 255, 255, 0.08) !important;
                        color: #ffffff !important;
                    }
                    .sx-nested-item.is-active {
                        font-weight: 600 !important;
                        color: #ffffff !important;
                        background: rgba(255, 255, 255, 0.08) !important;
                    }
                    .sx-effort-popover {
                        position: fixed !important;
                        z-index: 100000 !important;
                        width: 236px !important;
                        border-radius: 12px !important;
                        background: hsl(var(--popover, var(--card, 222 47% 11%))) !important;
                        border: 1px solid hsl(var(--border, rgba(255, 255, 255, 0.12))) !important;
                        padding: 14px 16px !important;
                        box-shadow: 0 10px 30px -4px rgba(0, 0, 0, 0.45), 0 4px 12px -2px rgba(0, 0, 0, 0.25) !important;
                        backdrop-filter: blur(20px) !important;
                        font-family: inherit !important;
                        box-sizing: border-box !important;
                    }
                    .sx-effort-track {
                        height: 22px !important;
                        border-radius: 11px !important;
                        background: rgba(255, 255, 255, 0.06) !important;
                        border: 1px solid rgba(255, 255, 255, 0.1) !important;
                        position: relative !important;
                        display: flex !important;
                        align-items: center !important;
                        justify-content: space-between !important;
                        padding: 0 8px !important;
                        cursor: pointer !important;
                        user-select: none !important;
                        box-sizing: border-box !important;
                        transition: background 0.15s ease !important;
                    }
                    .sx-effort-track:hover {
                        background: rgba(255, 255, 255, 0.09) !important;
                    }
                    .sx-effort-dot {
                        position: absolute !important;
                        top: 9px !important;
                        width: 4px !important;
                        height: 4px !important;
                        border-radius: 50% !important;
                        background: rgba(255, 255, 255, 0.3) !important;
                        pointer-events: none !important;
                        transform: translateX(-50%) !important;
                    }
                    .sx-effort-thumb {
                        position: absolute !important;
                        top: 2px !important;
                        width: 16px !important;
                        height: 16px !important;
                        border-radius: 6px !important;
                        background: #ffffff !important;
                        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.25) !important;
                        pointer-events: none !important;
                        transition: left 0.12s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
                    }
                `;
                document.head.appendChild(st);
            }

            const curConvKey = this.models.getActiveConversationKey();
            const activeId = this.models.getActiveModelForConversation(curConvKey);

            if (!listContainer.querySelector('.sx-custom-list-injected')) {
                const marker = document.createElement('div');
                marker.className = 'sx-custom-list-injected';
                marker.style.display = 'none';
                listContainer.appendChild(marker);

                const groups = {};
                providers.forEach(p => { groups[p.id] = []; });
                groups['other'] = [];

                sxModels.forEach(m => {
                    const pId = m.providerId || 'other';
                    if (!groups[pId]) groups[pId] = [];
                    groups[pId].push(m);
                });

                Object.keys(groups).forEach(pId => {
                    const groupModels = groups[pId];
                    if (!groupModels || groupModels.length === 0) return;

                    const pMeta = this.models.getProviderMeta(pId);

                    const header = document.createElement('div');
                    header.className = 'sx-provider-header';
                    header.setAttribute('data-provider-id', pId);
                    header.innerHTML = `
                        <span style="width:6px;height:6px;border-radius:50%;background:${pMeta.color};display:inline-block;"></span>
                        <span style="font-size:10px;font-weight:700;color:${pMeta.color};text-transform:uppercase;letter-spacing:0.5px;">${this.sxEsc(pMeta.name)}</span>
                    `;
                    listContainer.appendChild(header);

                    groupModels.forEach(m => {
                        const isSelected = m.id === activeId;
                        const isVision = this.models.isVisionModel(m);
                        const isReasoning = this.isModelSupportingReasoning(m);

                        let rightBadges = '';
                        let ctxTag = this.models.formatContextSize(m.contextLength);
                        if (!ctxTag) {
                            const mLow = (m.modelId || m.name || '').toLowerCase();
                            if (mLow.includes('1m') || mLow.includes('ultra')) ctxTag = '1M';
                            else if (mLow.includes('256k') || mLow.includes('pro')) ctxTag = '256k';
                            else if (mLow.includes('128k')) ctxTag = '128k';
                        }
                        if (ctxTag) {
                            rightBadges += `<span style="font-size:8.5px;font-weight:700;letter-spacing:0.2px;color:#a3e635;background:rgba(163,230,53,0.08);border:1px solid rgba(163,230,53,0.22);padding:0.5px 4px;border-radius:3px;line-height:normal;">${ctxTag}</span>`;
                        }
                        if (isVision) {
                            rightBadges += `<span style="font-size:8.5px;font-weight:600;letter-spacing:0.2px;color:#38bdf8;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.2);padding:0.5px 4px;border-radius:3px;line-height:normal;">Vision</span>`;
                        }
                        if (m.supportsTools === true) {
                            rightBadges += `<span style="font-size:8.5px;font-weight:600;letter-spacing:0.2px;color:#fb923c;background:rgba(251,146,60,0.08);border:1px solid rgba(251,146,60,0.2);padding:0.5px 4px;border-radius:3px;line-height:normal;">Tools</span>`;
                        }

                        const hasOtherBadges = !!rightBadges;
                        let reasoningLabel = '';
                        if (isReasoning) {
                            const curReasoning = (this._modelReasoning && this._modelReasoning[m.id]) || 'default';
                            const options = this.getModelReasoningOptions(m);
                            const effectiveReasoning = options.some(o => o.id === curReasoning) ? curReasoning : (options[0]?.id || 'default');
                            const optObj = options.find(o => o.id === effectiveReasoning);
                            reasoningLabel = optObj ? optObj.label : 'Default';
                            if (hasOtherBadges) {
                                rightBadges += `<span class="sx-reasoning-subtag is-badge" data-model-id="${m.id}" data-has-badges="true">${reasoningLabel}</span>`;
                            } else {
                                rightBadges += `<span class="sx-reasoning-subtag" data-model-id="${m.id}" data-has-badges="false">(${reasoningLabel})</span>`;
                            }
                        }

                        const hasBadges = !!rightBadges;
                        const item = document.createElement('div');
                        item.className = 'sx-custom-model-item' + (isSelected ? ' is-selected' : '') + (hasBadges ? ' has-badges' : '');
                        item.dataset.modelId = m.id;
                        item.dataset.modelLabel = m.name;
                        item.dataset.sxProvider = pId;

                        const checkSvg = `<svg class="sx-item-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="color:rgba(255,255,255,0.95);flex-shrink:0;"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

                        item.innerHTML = `
                            <div class="sx-model-info-col">
                                <div class="sx-model-title" title="${this.sxEsc(m.name)}">${this.sxEsc(m.name)}</div>
                                ${hasBadges ? `<div class="sx-model-badges-row">${rightBadges}</div>` : ''}
                            </div>
                            <div class="sx-model-right-actions">
                                <div class="sx-model-check-slot">
                                    ${isSelected ? checkSvg : ''}
                                </div>
                                <div class="sx-model-arrow-slot">
                                    ${isReasoning ? `
                                        <div class="sx-model-chevron-hint" title="Reasoning: ${this.sxEsc(reasoningLabel)}">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="sx-reasoning-arrow">
                                                <polyline points="9 18 15 12 9 6"></polyline>
                                            </svg>
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                        `;

                        // Row hover and direct trigger click for reasoning submenu
                        item.addEventListener('mouseenter', () => {
                            if (isReasoning) {
                                if (this._menuCloseTimeout) clearTimeout(this._menuCloseTimeout);
                                this.openModelReasoningSubmenu(item, m.id, m.name);
                            } else {
                                this.closeModelReasoningSubmenu();
                            }
                        });

                        item.addEventListener('mouseleave', (e) => {
                            const toEl = e.relatedTarget;
                            if (toEl && (toEl.closest('#sx-nested-reasoning-menu') || toEl.closest('.sx-custom-model-item') === item)) {
                                return;
                            }
                            if (this._menuCloseTimeout) clearTimeout(this._menuCloseTimeout);
                            this._menuCloseTimeout = setTimeout(() => {
                                this.closeModelReasoningSubmenu();
                            }, 200);
                        });

                        const cHint = item.querySelector('.sx-model-chevron-hint');
                        if (cHint) {
                            cHint.addEventListener('click', (e) => {
                                e.stopPropagation();
                                this.openModelReasoningSubmenu(item, m.id, m.name);
                            });
                        }

                        item.addEventListener('click', () => {
                            const cKey = this.models.getActiveConversationKey();
                            this.models.setActiveModelForConversation(m.id, cKey, true);

                            listContainer.querySelectorAll('.sx-custom-model-item').forEach(el => {
                                el.classList.remove('is-selected');
                                const cs = el.querySelector('.sx-model-check-slot');
                                if (cs) cs.innerHTML = '';
                            });
                            item.classList.add('is-selected');
                            const cs = item.querySelector('.sx-model-check-slot');
                            if (cs) cs.innerHTML = checkSvg;

                            this.quota?.updateContextButtonUI();

                            // Close popper
                            if (sampleNative) sampleNative.click();
                            setTimeout(() => this.hookDOM(), 30);
                        });

                        listContainer.appendChild(item);
                    });
                });
            } else {
                // Sync checkmarks & reasoning labels
                const checkSvg = `<svg class="sx-item-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="color:rgba(255,255,255,0.95);flex-shrink:0;"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
                listContainer.querySelectorAll('.sx-custom-model-item').forEach(el => {
                    const sel = el.dataset.modelId === activeId;
                    el.classList.toggle('is-selected', sel);
                    const cs = el.querySelector('.sx-model-check-slot');
                    if (cs) cs.innerHTML = sel ? checkSvg : '';

                    const mId = el.dataset.modelId;
                    if (mId && this._modelReasoning && this._modelReasoning[mId]) {
                        const val = this._modelReasoning[mId];
                        const mObj = this.state.getModels().find(mod => mod.id === mId);
                        const optObj = this.getModelReasoningOptions(mObj).find(o => o.id === val);
                        const label = optObj ? optObj.label : (val.charAt(0).toUpperCase() + val.slice(1));
                        const subtag = el.querySelector('.sx-reasoning-subtag');
                        if (subtag) {
                            const isBadge = subtag.classList.contains('is-badge') || subtag.getAttribute('data-has-badges') === 'true';
                            subtag.textContent = isBadge ? label : `(${label})`;
                        }
                        const cHint = el.querySelector('.sx-model-chevron-hint');
                        if (cHint) {
                            cHint.title = `Reasoning: ${label}`;
                        }
                    }
                });
            }
        }

        // Footer badge
        let fBadge = document.getElementById('sx-panel-footer-badge');
        if (!fBadge) {
            fBadge = document.createElement('div');
            fBadge.id = 'sx-panel-footer-badge';
            fBadge.style.cssText = 'padding:6px 12px;border-top:1px solid hsl(var(--border, rgba(255,255,255,0.08)));background:hsl(var(--popover, var(--card, 222 47% 11%)));border-bottom-left-radius:10px;border-bottom-right-radius:10px;display:flex;align-items:center;justify-content:space-between;font-size:10.5px;user-select:none;box-sizing:border-box;';
            modelPanel.appendChild(fBadge);
        }
        fBadge.innerHTML = '<span style="font-weight:700;"><span style="color:#38bdf8;text-shadow:0 0 10px rgba(56,189,248,0.35);">SX</span> <span style="color:#ffffff;">Development</span></span><span style="font-size:9.5px;color:rgba(255,255,255,0.35);font-weight:500;">Custom Engine</span>';
        adjustPosition();
        setTimeout(adjustPosition, 40);
        setTimeout(adjustPosition, 120);
    }

    isModelSupportingReasoning(m) {
        if (!m) return false;
        if (m.supportsReasoning === false) return false;

        // 1. Explicit supported reasoning efforts from API / model definition
        if (Array.isArray(m.supportedReasoningEfforts) && m.supportedReasoningEfforts.length > 0) return true;
        if (Array.isArray(m.reasoning_efforts) && m.reasoning_efforts.length > 0) return true;
        if (Array.isArray(m.reasoningEfforts) && m.reasoningEfforts.length > 0) return true;
        if (Array.isArray(m.reasoning?.supported_efforts) && m.reasoning.supported_efforts.length > 0) return true;

        // 2. OpenRouter / Provider supported_parameters check
        const params = Array.isArray(m.supported_parameters) ? m.supported_parameters : (Array.isArray(m.supportedParameters) ? m.supportedParameters : null);
        if (params) {
            const hasReasoningEffort = params.some(p => {
                const s = String(p).toLowerCase();
                return s === 'reasoning_effort' || s === 'reasoning-effort';
            });
            if (hasReasoningEffort) return true;
            // API explicitly sent parameters and reasoning_effort is NOT supported
            if (params.length > 0) return false;
        }

        // 3. Metadata resolver explicitly resolved supportsReasoning
        if (m.supportsReasoning === true) return true;

        // 4. Known reasoning models for direct providers where API metadata doesn't declare parameters
        const id = `${m.id || ''} ${m.modelId || ''}`.toLowerCase();
        if (/(?:embedding|embed|whisper|tts|moderation|dall-e|stable-diffusion|flux|midjourney)/i.test(id)) {
            return false;
        }
        if (/^(openai\/)?o[134](?:-mini|-preview|-high)?(?:$|[\/:])/i.test(id)) return true;
        if (/(?:^|\/)(?:o1|o3|o4|gpt-5-codex|nex-n2\.5)/i.test(id)) return true;

        return false;
    }

    getModelReasoningOptions(m) {
        const canonicalOrder = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
        const formatLabel = (id) => {
            if (id === 'xhigh') return 'Extra High';
            return id.charAt(0).toUpperCase() + id.slice(1);
        };

        const rawEfforts = m?.supportedReasoningEfforts
            || m?.reasoning_efforts
            || m?.reasoningEfforts
            || m?.reasoning?.supported_efforts
            || m?.parameters?.reasoning_effort?.options
            || m?.parameters?.reasoning?.options;

        if (Array.isArray(rawEfforts) && rawEfforts.length > 0) {
            const set = new Set(rawEfforts.map(x => String(x).toLowerCase().trim()));
            const sorted = [];
            canonicalOrder.forEach(lvl => {
                if (set.has(lvl)) {
                    sorted.push({ id: lvl, label: formatLabel(lvl) });
                    set.delete(lvl);
                }
            });
            set.forEach(rem => {
                if (rem) sorted.push({ id: rem, label: formatLabel(rem) });
            });

            return [
                { id: 'default', label: 'Default' },
                ...sorted
            ];
        }

        return [
            { id: 'default', label: 'Default' },
            { id: 'none', label: 'None' },
            { id: 'medium', label: 'Medium' },
            { id: 'high', label: 'High' }
        ];
    }

    closeModelReasoningSubmenu() {
        const existing = document.getElementById('sx-nested-reasoning-menu');
        if (existing) {
            existing.remove();
        }
    }

    openModelReasoningSubmenu(triggerEl, modelId, modelName) {
        let existing = document.getElementById('sx-nested-reasoning-menu');
        if (existing) {
            if (existing._triggerEl === triggerEl) return;
            existing.remove();
        }

        const menu = document.createElement('div');
        menu.id = 'sx-nested-reasoning-menu';
        menu.className = 'sx-nested-menu';
        menu._triggerEl = triggerEl;

        const m = this.state.getModels().find(mod => mod.id === modelId) || { id: modelId, name: modelName };
        const options = this.getModelReasoningOptions(m);
        const curReasoning = (this._modelReasoning && this._modelReasoning[modelId]) || 'default';
        const effectiveReasoning = options.some(o => o.id === curReasoning) ? curReasoning : (options[0]?.id || 'default');

        menu.innerHTML = options.map(opt => {
            const isActive = opt.id === effectiveReasoning;
            const checkIcon = isActive
                ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#86efac" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="color:#86efac;flex-shrink:0;"><polyline points="20 6 9 17 4 12"></polyline></svg>`
                : '';
            return `
                <div class="sx-nested-item ${isActive ? 'is-active' : ''}" data-val="${opt.id}">
                    <span>${opt.label}</span>
                    ${checkIcon}
                </div>
            `;
        }).join('');

        document.body.appendChild(menu);

        // Position directly outside on the right edge of model menu (Image 1 & 3 style)
        const panel = triggerEl.closest('[role="menu"]')
                   || triggerEl.closest('[data-testid="model-selector-panel"]')
                   || triggerEl.closest('.sx-custom-model-panel')
                   || document.querySelector('[role="menu"]:has([data-testid="model-selector-panel"])')
                   || document.querySelector('[data-testid="model-selector-panel"]')
                   || triggerEl.closest('div[role="dialog"]')
                   || triggerEl.closest('.overflow-y-auto')?.parentElement;

        const pRect = panel ? panel.getBoundingClientRect() : null;
        const tRect = triggerEl.getBoundingClientRect();

        let left = pRect ? (pRect.right + 4) : (tRect.right + 6);
        let top = tRect.top - 2;

        const menuWidth = 140;
        if (left + menuWidth > window.innerWidth - 8) {
            if (pRect) {
                left = Math.max(8, pRect.left - menuWidth - 4);
            } else {
                left = Math.max(8, tRect.left - menuWidth - 4);
            }
        }

        // Accurately measure menu height so it NEVER goes off-screen
        const itemCount = options.length;
        const estimatedHeight = itemCount * 30 + 10;
        const menuHeight = menu.offsetHeight || estimatedHeight;

        if (top + menuHeight > window.innerHeight - 12) {
            top = Math.max(12, window.innerHeight - menuHeight - 12);
        }
        if (top < 12) top = 12;

        menu.style.top = top + 'px';
        menu.style.left = left + 'px';

        menu.querySelectorAll('.sx-nested-item').forEach(item => {
            item.onclick = (e) => {
                e.stopPropagation();
                e.preventDefault();
                const val = item.dataset.val;
                if (!this._modelReasoning) this._modelReasoning = {};
                this._modelReasoning[modelId] = val;

                const optObj = options.find(o => o.id === val);
                const newLabel = optObj ? optObj.label : (val.charAt(0).toUpperCase() + val.slice(1));

                const subtag = triggerEl.querySelector('.sx-reasoning-subtag');
                if (subtag) {
                    const isBadge = subtag.classList.contains('is-badge') || subtag.getAttribute('data-has-badges') === 'true';
                    subtag.textContent = isBadge ? newLabel : `(${newLabel})`;
                }
                const cHint = triggerEl.querySelector('.sx-model-chevron-hint');
                if (cHint) {
                    cHint.title = `Reasoning: ${newLabel}`;
                }

                this.network.post('/set-agent-effort', {
                    modelId: modelId,
                    reasoningEffort: val
                }).catch(() => {});

                this.closeModelReasoningSubmenu();
            };
        });

        // Retain menu when moving mouse across trigger and menu
        const onMouseLeave = (e) => {
            const toEl = e.relatedTarget;
            if (toEl && (toEl.closest('#sx-nested-reasoning-menu') || toEl.closest('.sx-custom-model-item') === triggerEl)) {
                return;
            }
            if (this._menuCloseTimeout) clearTimeout(this._menuCloseTimeout);
            this._menuCloseTimeout = setTimeout(() => {
                this.closeModelReasoningSubmenu();
            }, 200);
        };
        const onMouseEnter = () => {
            if (this._menuCloseTimeout) clearTimeout(this._menuCloseTimeout);
        };

        menu.addEventListener('mouseleave', onMouseLeave);
        menu.addEventListener('mouseenter', onMouseEnter);
        triggerEl.addEventListener('mouseleave', onMouseLeave);
        triggerEl.addEventListener('mouseenter', onMouseEnter);

        setTimeout(() => {
            const onDocClick = (e) => {
                if (!menu.contains(e.target) && !triggerEl.contains(e.target)) {
                    this.closeModelReasoningSubmenu();
                    document.removeEventListener('click', onDocClick);
                }
            };
            document.addEventListener('click', onDocClick);
        }, 10);
    }

    async injectEffortButton() {
        let effortBtn = document.getElementById('sx-effort-pill');
        if (!effortBtn) return;

        // Clean up any old duplicate button outside actionContainer
        document.querySelectorAll('#sx-effort-pill, #sx-effort-btn').forEach(b => {
            if (b !== effortBtn && b.parentElement) b.remove();
        });

        if (!this._lastEffortFetch || Date.now() - this._lastEffortFetch > 5000) {
            this._lastEffortFetch = Date.now();
            try {
                const cKey = this.models.getActiveConversationKey();
                const res = await this.network.get('/get-agent-effort?convId=' + encodeURIComponent(cKey));
                if (res && res.ok) {
                    if (res.profile) this._currentEffort = res.profile;
                    if (res.modelReasoning) this._modelReasoning = res.modelReasoning;
                }
            } catch(e) {}
        }

        const profile = this._currentEffort || { agentEffort: 'normal', reasoningEffort: 'normal' };
        const agentEffort = profile.agentEffort || 'normal';
        this.updateEffortPillUI(effortBtn, agentEffort);
    }

    updateEffortPillUI(effortBtn, agentEffort) {
        if (!effortBtn) return;
        effortBtn.dataset.sxEffort = agentEffort;

        let text = 'Normal';
        let style = 'height:22px;padding:0 9px;border-radius:6px;font-size:11.5px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;margin-right:2px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.9);transition:all 0.15s ease;user-select:none;font-family:inherit;line-height:1;flex-shrink:0;';

        if (agentEffort === 'ultra') {
            text = 'Ultra Code';
            style += 'border-color:rgba(245,158,11,0.5);background:rgba(245,158,11,0.12);color:#fbbf24;box-shadow:0 0 10px rgba(245,158,11,0.25);';
        } else if (agentEffort === 'max') {
            text = 'Max';
            style += 'border-color:rgba(255,255,255,0.3);background:rgba(255,255,255,0.12);color:#ffffff;';
        } else if (agentEffort === 'high') {
            text = 'High';
            style += 'border-color:rgba(56,189,248,0.4);background:rgba(56,189,248,0.08);color:#38bdf8;';
        } else if (agentEffort === 'low') {
            text = 'Low';
            style += 'border-color:rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);color:rgba(255,255,255,0.5);';
        } else {
            text = 'Normal';
            style += 'color:rgba(255,255,255,0.85);';
        }

        effortBtn.style.cssText = style;
        effortBtn.textContent = text;
    }

    getPromptBoxTop() {
        const textarea = document.querySelector('[contenteditable="true"], textarea, [data-testid="chat-input"]');
        if (textarea) {
            const formOrCard = textarea.closest('form')
                            || textarea.closest('[class*="rounded-2xl"], [class*="rounded-3xl"], [class*="rounded-[calc"]')
                            || textarea.closest('.bg-card, [class*="border"]')
                            || textarea.parentElement?.parentElement;
            if (formOrCard) {
                const r = formOrCard.getBoundingClientRect();
                if (r.top > 80 && r.top < window.innerHeight) {
                    return r.top;
                }
            }
        }
        const promptContainer = document.querySelector('form')
                             || document.querySelector('[data-testid="chat-input-container"]');
        if (promptContainer) {
            const r = promptContainer.getBoundingClientRect();
            if (r.top > 80 && r.top < window.innerHeight) {
                return r.top;
            }
        }
        return window.innerHeight - 150;
    }

    toggleEffortSliderPopover(anchorBtn) {
        this.injectGlobalStyles();

        const existing = document.getElementById('sx-effort-slider-popover');
        if (existing) {
            existing.remove();
            const hp = document.getElementById('sx-effort-hover-popup');
            if (hp) hp.remove();
            return;
        }

        // Mutual exclusion: Close other popovers and help modal
        const perfPop = document.getElementById('sx-perf-popover');
        if (perfPop) perfPop.remove();
        const ctxPop = document.getElementById('sx-context-popover');
        if (ctxPop) ctxPop.remove();
        const infoModal = document.getElementById('sx-effort-info-modal');
        if (infoModal) infoModal.remove();
        const infoBdrop = document.getElementById('sx-effort-info-backdrop');
        if (infoBdrop) infoBdrop.remove();
        const prevHp = document.getElementById('sx-effort-hover-popup');
        if (prevHp) prevHp.remove();

        const popover = document.createElement('div');
        popover.id = 'sx-effort-slider-popover';
        popover.className = 'sx-effort-popover';

        const profile = this._currentEffort || { agentEffort: 'normal', reasoningEffort: 'normal' };
        let curAgent = profile.agentEffort || 'normal';

        // Order: Low (0) -> Normal (1) -> High (2) -> Max (3) -> Ultra Code (4 - ultimate smartest!)
        const LEVELS = [
            { id: 'low', label: 'Low', color: 'rgba(255,255,255,0.6)' },
            { id: 'normal', label: 'Normal', color: 'rgba(255,255,255,0.9)' },
            { id: 'high', label: 'High', color: '#38bdf8' },
            { id: 'max', label: 'Max', color: '#ffffff' },
            { id: 'ultra', label: 'Ultra Code', color: '#fbbf24' }
        ];

        let curIdx = LEVELS.findIndex(l => l.id === curAgent);
        if (curIdx === -1) curIdx = 1; // Default to Normal

        const curLvl = LEVELS[curIdx];

        popover.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;">
                <div style="font-size:13px;color:rgba(255,255,255,0.7);display:flex;align-items:center;gap:5px;">
                    <span>Effort</span>
                    <strong id="sx-effort-popover-val" style="color:${curLvl.color};font-weight:700;">${curLvl.label}</strong>
                </div>
                <button type="button" id="sx-effort-help-btn" class="sx-help-icon" style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;min-width:18px;min-height:18px;border-radius:50%;border:1px solid rgba(255,255,255,0.25);background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.7);font-size:11px;font-weight:600;cursor:help;line-height:1;box-sizing:border-box;flex-shrink:0;aspect-ratio:1/1;padding:0;transition:all 0.15s ease;" title="Bilgi için üzerine gelin">?</button>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;font-size:11px;color:rgba(255,255,255,0.45);margin:10px 0 6px 0;user-select:none;">
                <span>Faster</span>
                <span>Smarter</span>
            </div>
            <div id="sx-effort-slider-track" class="sx-effort-track">
                <div class="sx-effort-dot" style="left: 10px;"></div>
                <div class="sx-effort-dot" style="left: calc(10px + (100% - 20px) * 0.25);"></div>
                <div class="sx-effort-dot" style="left: calc(10px + (100% - 20px) * 0.5);"></div>
                <div class="sx-effort-dot" style="left: calc(10px + (100% - 20px) * 0.75);"></div>
                <div class="sx-effort-dot" style="left: calc(100% - 10px);"></div>
                <div id="sx-effort-slider-thumb" class="sx-effort-thumb" style="left: calc(2px + (100% - 20px) * ${(curIdx / 4)});"></div>
            </div>
            <div id="sx-effort-footer-extra" style="margin-top:10px;padding:6px 10px;border-radius:6px;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.2);display:${(curAgent === 'ultra' || curAgent === 'max') ? 'flex' : 'none'};align-items:center;justify-content:space-between;font-size:10.5px;">
                <span style="color:#fbbf24;font-weight:600;">Titan Self-Healing Aktif</span>
                <button type="button" id="sx-popover-scan-btn" style="background:transparent;border:none;color:#38bdf8;cursor:pointer;font-size:10px;text-decoration:underline;">Haritayı Yenile</button>
            </div>
        `;

        document.body.appendChild(popover);

        // Position above entire message box (so it never blocks typing or prompt text)
        const rect = anchorBtn.getBoundingClientRect();
        const popoverWidth = 236;
        let left = rect.left - (popoverWidth - rect.width) / 2;
        if (left + popoverWidth > window.innerWidth - 10) {
            left = window.innerWidth - popoverWidth - 10;
        }
        if (left < 10) left = 10;
        popover.style.left = left + 'px';

        const boxTop = this.getPromptBoxTop();
        popover.style.bottom = Math.max(12, window.innerHeight - boxTop + 10) + 'px';

        const track = popover.querySelector('#sx-effort-slider-track');
        const thumb = popover.querySelector('#sx-effort-slider-thumb');
        const valEl = popover.querySelector('#sx-effort-popover-val');
        const extraFooter = popover.querySelector('#sx-effort-footer-extra');

        const updateToLevel = (idx) => {
            idx = Math.max(0, Math.min(4, Math.round(idx)));
            const lvl = LEVELS[idx];
            curAgent = lvl.id;
            thumb.style.left = `calc(2px + (100% - 20px) * ${(idx / 4)})`;
            if (valEl) {
                valEl.textContent = lvl.label;
                valEl.style.color = lvl.color;
            }
            if (extraFooter) {
                extraFooter.style.display = (curAgent === 'ultra' || curAgent === 'max') ? 'flex' : 'none';
            }
            this.updateEffortPillUI(anchorBtn, curAgent);
            if (!this._currentEffort) this._currentEffort = {};
            this._currentEffort.agentEffort = curAgent;

            const cKey = this.models.getActiveConversationKey();
            this.network.post('/set-agent-effort', {
                convId: cKey,
                agentEffort: curAgent
            }).catch(() => {});
        };

        const handleTrackEvent = (e) => {
            const tr = track.getBoundingClientRect();
            const relX = Math.max(0, Math.min(tr.width, e.clientX - tr.left));
            const pct = relX / tr.width;
            const targetIdx = Math.round(pct * 4);
            updateToLevel(targetIdx);
        };

        track.addEventListener('mousedown', (e) => {
            handleTrackEvent(e);
            const onMouseMove = (ev) => handleTrackEvent(ev);
            const onMouseUp = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });

        const helpBtn = popover.querySelector('#sx-effort-help-btn');
        if (helpBtn) {
            let hideTimeout = null;

            const removeHoverPopup = () => {
                const hp = document.getElementById('sx-effort-hover-popup');
                if (hp) hp.remove();
            };

            const showHoverPopup = () => {
                if (hideTimeout) clearTimeout(hideTimeout);
                if (document.getElementById('sx-effort-hover-popup')) return;

                const hoverPopup = document.createElement('div');
                hoverPopup.id = 'sx-effort-hover-popup';
                hoverPopup.className = 'sx-hover-popup';
                hoverPopup.innerHTML = `
                    <div style="font-weight:700;color:#fbbf24;font-size:12px;margin-bottom:6px;display:flex;align-items:center;gap:6px;">
                        <span>⚡</span> Effort & Titan Self-Healing
                    </div>
                    <div style="font-size:11px;line-height:1.55;color:rgba(255,255,255,0.85);margin-bottom:8px;">
                        <div><strong style="color:rgba(255,255,255,0.6)">Low:</strong> Hızlı, tek satırlık düzenlemeler.</div>
                        <div><strong style="color:rgba(255,255,255,0.9)">Normal:</strong> Dengeli standart mod.</div>
                        <div><strong style="color:#38bdf8">High:</strong> Mimari ve çoklu dosya akıl yürütmesi.</div>
                        <div><strong style="color:#ffffff">Max:</strong> Maksimum derin analiz.</div>
                        <div><strong style="color:#fbbf24">Ultra Code:</strong> Titan Self-Healing devrede.</div>
                    </div>
                    <div style="padding-top:7px;border-top:1px solid rgba(255,255,255,0.1);font-size:10.5px;color:rgba(255,255,255,0.7);line-height:1.45;">
                        <strong style="color:#fbbf24;">🛡️ Titan Protokolü:</strong><br>
                        1. Repo Haritalama (AST bağımlılık taraması)<br>
                        2. Atomik Kod Düzenleme (Sıfır kayıp)<br>
                        3. Otomatik Doğrulama (Syntax/lint kontrolü)<br>
                        4. Otonom Onarım (Hataları kendi kendine çözme)
                    </div>
                `;

                document.body.appendChild(hoverPopup);

                const hRect = helpBtn.getBoundingClientRect();
                const pWidth = 290;
                let hLeft = hRect.right - pWidth;
                if (hLeft < 10) hLeft = 10;
                if (hLeft + pWidth > window.innerWidth - 10) hLeft = window.innerWidth - pWidth - 10;

                hoverPopup.style.left = hLeft + 'px';
                hoverPopup.style.bottom = (window.innerHeight - hRect.top + 8) + 'px';
            };

            const scheduleHide = () => {
                hideTimeout = setTimeout(removeHoverPopup, 180);
            };

            helpBtn.addEventListener('mouseenter', showHoverPopup);
            helpBtn.addEventListener('mouseleave', scheduleHide);
            helpBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };
        }

        const scanBtn = popover.querySelector('#sx-popover-scan-btn');
        if (scanBtn) {
            scanBtn.onclick = async () => {
                scanBtn.disabled = true;
                scanBtn.textContent = 'Taranıyor...';
                try {
                    const res = await this.network.post('/sx/generate-repo-map', {});
                    if (res && res.ok) {
                        scanBtn.textContent = '✓ ' + res.fileCount + ' dosya';
                    } else {
                        scanBtn.textContent = 'Tekrar dene';
                        scanBtn.disabled = false;
                    }
                } catch(e) {
                    scanBtn.textContent = 'Hata';
                    scanBtn.disabled = false;
                }
            };
        }

        setTimeout(() => {
            const onDocClick = (e) => {
                if (!popover.contains(e.target) && !anchorBtn.contains(e.target)) {
                    popover.remove();
                    const hp = document.getElementById('sx-effort-hover-popup');
                    if (hp) hp.remove();
                    document.removeEventListener('click', onDocClick);
                }
            };
            document.addEventListener('click', onDocClick);
        }, 20);
    }

    showEffortHelpModal() {
        const existing = document.getElementById('sx-effort-info-modal');
        if (existing) {
            existing.remove();
            const b = document.getElementById('sx-effort-info-backdrop');
            if (b) b.remove();
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'sx-effort-info-modal';
        modal.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 490px;
            max-width: 90vw;
            max-height: 85vh;
            overflow-y: auto;
            background: hsl(var(--popover, var(--card, 222 47% 11%)));
            border: 1px solid hsl(var(--border, rgba(255, 255, 255, 0.12)));
            border-radius: 14px;
            padding: 22px 24px;
            box-shadow: 0 16px 40px -6px rgba(0, 0, 0, 0.5), 0 6px 16px -4px rgba(0, 0, 0, 0.3);
            backdrop-filter: blur(20px);
            z-index: 100002;
            color: hsl(var(--popover-foreground, var(--foreground, #f1f5f9)));
            font-family: inherit;
            box-sizing: border-box;
        `;

        modal.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="width:28px;height:28px;border-radius:8px;background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.3);display:flex;align-items:center;justify-content:center;color:#fbbf24;font-size:14px;font-weight:700;">⚡</div>
                    <div>
                        <div style="font-size:15px;font-weight:700;color:#ffffff;line-height:1.2;">Effort & Titan Self-Healing</div>
                        <div style="font-size:11.5px;color:rgba(255,255,255,0.45);">Ajan Gayret ve Otonom Hata Onarım Rehberi</div>
                    </div>
                </div>
                <button type="button" id="sx-close-effort-modal" style="background:transparent;border:none;color:rgba(255,255,255,0.5);font-size:16px;cursor:pointer;padding:4px 8px;border-radius:6px;transition:all 0.15s ease;" onmouseenter="this.style.color='#ffffff';this.style.background='rgba(255,255,255,0.08)'" onmouseleave="this.style.color='rgba(255,255,255,0.5)';this.style.background='transparent'">✕</button>
            </div>

            <div style="font-size:12.5px;line-height:1.6;color:rgba(255,255,255,0.85);margin-bottom:16px;">
                <div style="font-weight:700;color:#38bdf8;margin-bottom:6px;font-size:13px;">🧠 Effort Seviyeleri (Faster ➔ Smarter)</div>
                <div style="display:flex;flex-direction:column;gap:6px;background:rgba(255,255,255,0.03);padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.07);">
                    <div><strong style="color:rgba(255,255,255,0.6);">Low:</strong> En hızlı yanıt, minimal token tüketimi. Basit sorular ve tek satırlık düzenlemeler.</div>
                    <div><strong style="color:rgba(255,255,255,0.9);">Normal:</strong> Standart dengeli mod. Tipik kod geliştirme ve soru yanıtlama.</div>
                    <div><strong style="color:#38bdf8;">High:</strong> Derin kod analizi, mimari tasarım ve çoklu dosya akıl yürütmesi.</div>
                    <div><strong style="color:#ffffff;">Max:</strong> Maksimum düşünme payı. Kompleks algoritmalar ve kapsamlı refactoring.</div>
                    <div><strong style="color:#fbbf24;">Ultra Code (Titan):</strong> En akıllı seviye. Kod değişikliklerini atomik yapar, test ve linter döngülerini otomatik yönetir.</div>
                </div>
            </div>

            <div style="font-size:12.5px;line-height:1.6;color:rgba(255,255,255,0.85);">
                <div style="font-weight:700;color:#fbbf24;margin-bottom:6px;font-size:13px;">🛡️ Titan Self-Healing Protokolü Nedir?</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.7);margin-bottom:8px;">
                    Ultra Code modunda devreye giren Titan Self-Healing, ajanın yazdığı kodları kendi kendine doğrulaması ve hataları onarması için 4 aşamalı bir güvenlik kalkanıdır:
                </div>
                <div style="display:flex;flex-direction:column;gap:8px;background:rgba(245,158,11,0.04);padding:12px;border-radius:8px;border:1px solid rgba(245,158,11,0.18);">
                    <div style="display:flex;gap:8px;">
                        <span style="font-weight:700;color:#fbbf24;flex-shrink:0;">1.</span>
                        <div><strong style="color:#ffffff;">Repo Haritası (Repo-Map):</strong> Projedeki fonksiyonları ve tipleri AST bazlı tarar, modele doğrudan doğruya ilgili sembolleri aktarır.</div>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <span style="font-weight:700;color:#fbbf24;flex-shrink:0;">2.</span>
                        <div><strong style="color:#ffffff;">Atomik Kod Değişimi:</strong> Dosyayı baştan sona silip yazmak yerine yalnızca hedeflenen satır bloğunu değiştirir; bozulmaları önler.</div>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <span style="font-weight:700;color:#fbbf24;flex-shrink:0;">3.</span>
                        <div><strong style="color:#ffffff;">Otomatik Doğrulama:</strong> Kod yazıldıktan hemen sonra syntax ve lint kontrolleri arka planda otomatik koşturulur.</div>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <span style="font-weight:700;color:#fbbf24;flex-shrink:0;">4.</span>
                        <div><strong style="color:#ffffff;">Otonom Onarım:</strong> Herhangi bir hata veya linter kırılması tespit edilirse ajan anında uyarılır ve insan müdahalesine gerek kalmadan hatayı düzeltir.</div>
                    </div>
                </div>
            </div>

            <div style="margin-top:18px;display:flex;justify-content:flex-end;">
                <button type="button" id="sx-ok-effort-modal" style="height:30px;padding:0 18px;border-radius:6px;font-size:12px;font-weight:600;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.18);color:#ffffff;cursor:pointer;transition:all 0.15s ease;" onmouseenter="this.style.background='rgba(255,255,255,0.18)'" onmouseleave="this.style.background='rgba(255,255,255,0.1)'">Anladım</button>
            </div>
        `;

        const backdrop = document.createElement('div');
        backdrop.id = 'sx-effort-info-backdrop';
        backdrop.style.cssText = `
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(4px);
            z-index: 100001;
        `;

        const closeIt = () => {
            modal.remove();
            backdrop.remove();
        };

        backdrop.onclick = closeIt;
        document.body.appendChild(backdrop);
        document.body.appendChild(modal);

        modal.querySelector('#sx-close-effort-modal').onclick = closeIt;
        modal.querySelector('#sx-ok-effort-modal').onclick = closeIt;
    }
}

