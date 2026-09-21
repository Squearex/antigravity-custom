/**
 * SX Core SDK - UIInjector
 * Manages DOM modifications, custom settings panel, model selector dropdown,
 * and chat input action buttons.
 */
import { SX_PRESETS } from './ModelManager.js';

export class UIInjector {
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

        // Click listener for sidebar navigation
        document.addEventListener('click', (e) => {
            const target = e.target.closest('a[href^="/c/"], a[href="/"], [data-testid="new-conversation-button"], [data-testid="conversation-row-sidebar"], button[aria-label*="New Conversation" i]');
            if (target) {
                const row = target.closest('[data-testid="conversation-row-sidebar"], a[href^="/c/"]');
                if (row) {
                    const rId = row.getAttribute('data-cascade-id') || row.getAttribute('data-conversation-id') || (row.getAttribute('href')?.match(/\/c\/([a-zA-Z0-9_-]+)/)?.[1]);
                    if (rId) {
                        const saved = localStorage.getItem('sx_active_model_conv_' + rId);
                        if (saved) {
                            localStorage.setItem('sx_active_model_id', saved);
                            this.models.notifyActiveModel(saved, true);
                        }
                    }
                }
                setTimeout(() => this.checkUrlChange(), 20);
                setTimeout(() => this.hookDOM(), 40);
                setTimeout(() => this.hookDOM(), 120);
            }
        }, true);

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
            let saved = localStorage.getItem('sx_active_model_' + newConvKey);
            if (!saved && newConvKey !== 'conv_new') {
                saved = localStorage.getItem('sx_active_model_conv_new') || localStorage.getItem('sx_active_model_id');
                if (saved) {
                    localStorage.setItem('sx_active_model_' + newConvKey, saved);
                    this.models.notifyActiveModel(saved, false);
                }
            }
            if (saved) {
                localStorage.setItem('sx_active_model_id', saved);
                this.models.notifyActiveModel(saved, true);
            }
            this.hookDOM();
        }
    }

    sxEsc(str) {
        return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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

        overlay.innerHTML = `
            <div class="sx-modal" style="width:500px;">
                <div class="sx-modal-title">${isEdit ? 'Model Düzenle' : 'Model Ekle'}</div>
                <div class="sx-field">
                    <label class="sx-label">Provider</label>
                    <select class="sx-select" id="sx-m-prov">${provOptions}</select>
                </div>
                <div class="sx-field">
                    <label class="sx-label">Model ID</label>
                    <input class="sx-input" id="sx-m-id" value="${this.sxEsc(existing?.modelId || '')}" placeholder="örnek: anthropic/claude-3-7-sonnet" />
                </div>
                <div class="sx-field">
                    <label class="sx-label">Görüntü Adı</label>
                    <input class="sx-input" id="sx-m-name" value="${this.sxEsc(existing?.name || '')}" placeholder="örnek: Claude 3.7 Sonnet" />
                </div>
                <div class="sx-modal-actions">
                    <button type="button" class="sx-btn" id="sx-m-cancel">İptal</button>
                    <button type="button" class="sx-btn sx-btn-primary" id="sx-m-save">${isEdit ? 'Kaydet' : 'Ekle'}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.querySelector('#sx-m-cancel').onclick = () => overlay.remove();
        overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

        overlay.querySelector('#sx-m-save').onclick = () => {
            const provId = overlay.querySelector('#sx-m-prov').value;
            const modelId = overlay.querySelector('#sx-m-id').value.trim();
            const name = overlay.querySelector('#sx-m-name').value.trim();
            if (!modelId || !name) { alert('Model ID ve ad zorunludur.'); return; }
            const list = this.state.getModels();
            const entry = { id: existing ? existing.id : 'm_' + Date.now(), providerId: provId, name, modelId, directMode: true };
            if (isEdit) {
                const idx = list.findIndex(m => m.id === existing.id);
                if (idx >= 0) list[idx] = entry; else list.push(entry);
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

        const existingWrap = dialog.querySelector('#sx-content-wrapper');
        if (existingWrap) {
            const rp = existingWrap.parentElement;
            if (rp) Array.from(rp.children).forEach(c => {
                if (c.id === 'sx-content-wrapper') return;
                c.style.setProperty('display', 'none', 'important');
            });
            return;
        }

        let rightPanel = null;
        const MARKERS = ['Gemini Models', 'Model Credits', 'Your Plan'];
        outer: for (const marker of MARKERS) {
            for (const el of Array.from(dialog.querySelectorAll('*'))) {
                if (!el.offsetParent) continue;
                if (el.textContent.trim() !== marker) continue;
                let anc = el.parentElement;
                while (anc && anc !== dialog) {
                    const cs = window.getComputedStyle(anc);
                    if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
                        rightPanel = anc;
                        break;
                    }
                    anc = anc.parentElement;
                }
                if (rightPanel) break outer;
            }
        }
        if (!rightPanel) return;

        Array.from(rightPanel.children).forEach(c => {
            c.style.setProperty('display', 'none', 'important');
        });

        const sxWrap = document.createElement('div');
        sxWrap.id = 'sx-content-wrapper';
        sxWrap.style.cssText = 'padding: 0 32px 32px 32px; box-sizing: border-box; width: 100%;';
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
                                <button class="sx-icon-btn edit-p" data-id="${p.id}" title="Edit">✎</button>
                                <button class="sx-icon-btn del del-p" data-id="${p.id}" title="Delete">✕</button>
                            </div>
                        </div>
                    `;
                });
            }
            provSec.innerHTML = html;
            provSec.querySelector('#sx-add-prov-btn').onclick = () => this.openProviderModal(null, () => { renderProviders(); renderModels(); });
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
                html += '<div class="sx-empty-hint">Henüz model eklenmedi.<br>Yukarıdan bir provider ekleyip model tanımlayın.</div>';
            } else {
                html += '<div class="sx-models-list">';
                models.forEach(m => {
                    const p = providers.find(x => x.id === m.providerId);
                    html += `
                        <div class="sx-model-card">
                            <div class="sx-model-name">${this.sxEsc(m.name)}</div>
                            <div class="sx-model-id">${this.sxEsc(m.modelId)}</div>
                            <div class="sx-model-prov">${this.sxEsc(p ? p.name : '?')}</div>
                            <div class="sx-card-actions">
                                <button class="sx-icon-btn edit-m" data-id="${m.id}" title="Edit">✎</button>
                                <button class="sx-icon-btn del del-m" data-id="${m.id}" title="Delete">✕</button>
                            </div>
                        </div>
                    `;
                });
                html += '</div>';
            }
            modelsSec.innerHTML = html;
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
    }

    trySXAppearanceSettingsInject() {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return;
        const nativeCombos = dialog.querySelectorAll('button[role="combobox"]');
        nativeCombos.forEach(b => {
            if (b.style.display === 'none') b.style.removeProperty('display');
        });
        const nativeListbox = document.querySelector('[role="listbox"]');
        if (nativeListbox && nativeListbox.style.display === 'none') {
            nativeListbox.style.removeProperty('display');
        }
    }

    hookDOM() {
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
            const micWrapper = actionContainer.querySelector('div.flex.items-center:has(button[aria-label*="Record voice" i]), div.flex.items-center:has([data-tooltip-id*="record-tooltip"])') ||
                actionContainer.querySelector('button[aria-label*="Record voice" i]');
            const sendBtn = actionContainer.querySelector('[data-testid="send-button"], button[aria-label*="send" i], [data-tooltip-id*="send-tooltip"]');
            const cancelBtn = actionContainer.querySelector('button[aria-label*="Cancel" i], [data-tooltip-id*="cancel-tooltip"]');
            const targetAnchor = micWrapper || sendBtn || cancelBtn;

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
                ctxBtn.innerHTML = `
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#94a3b8;">
                        <circle cx="12" cy="12" r="9"></circle>
                        <path d="M12 2v20M2 12h20"></path>
                    </svg>
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

            this.perf.updatePerfButtonUI();
        }

        // 3. Trigger button text sync
        const trigger = document.querySelector('[data-testid="model-selector-trigger"]');
        if (trigger) {
            const sxModels = this.state.getModels();
            if (sxModels.length > 0) {
                const curConv = this.models.getActiveConversationKey();
                const activeId = (curConv ? localStorage.getItem('sx_active_model_' + curConv) : null) || localStorage.getItem('sx_active_model_id');
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

        // 4. Injections for settings tabs
        this.trySXModelsSettingsInject();
        this.trySXAppearanceSettingsInject();
    }
}
