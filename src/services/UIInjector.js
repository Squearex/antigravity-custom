/**
 * SX Core SDK - UIInjector
 * Manages DOM modifications, custom settings panel, model selector dropdown,
 * and chat input action buttons.
 */
import { SX_PRESETS } from './ModelManager.js';

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

        // Throttle the expensive full-tree marker scan while the dialog is open
        // without our wrapper yet (hookDOM ticks every ~250ms).
        const scanTs = Date.now();
        if (this._lastSettingsScan && (scanTs - this._lastSettingsScan < 2000)) return;
        this._lastSettingsScan = scanTs;

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
                    const ctxTag = this.models.formatContextSize(m.contextLength);
                    const badgeBits = [];
                    if (ctxTag) badgeBits.push(`<span style="font-size:9.5px;font-weight:700;color:#a3e635;background:rgba(163,230,53,0.08);border:1px solid rgba(163,230,53,0.2);padding:0 5px;border-radius:4px;">${ctxTag}</span>`);
                    if (this.models.isVisionModel(m)) badgeBits.push('<span style="font-size:9.5px;font-weight:600;color:#38bdf8;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.2);padding:0 5px;border-radius:4px;">Vision</span>');
                    if (m.supportsTools === true) badgeBits.push('<span style="font-size:9.5px;font-weight:600;color:#fb923c;background:rgba(251,146,60,0.08);border:1px solid rgba(251,146,60,0.2);padding:0 5px;border-radius:4px;">Tools</span>');
                    html += `
                        <div class="sx-model-card">
                            <div class="sx-model-name">${this.sxEsc(m.name)}</div>
                            <div class="sx-model-id">${this.sxEsc(m.modelId)}</div>
                            <div style="display:flex;gap:4px;flex-shrink:0;">${badgeBits.join('')}</div>
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

            this.quota.updateContextButtonUI();
            this.perf.updatePerfButtonUI();
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

        // Sticky search input at the very top of panel
        let searchWrap = modelPanel.querySelector('#sx-model-search-wrap');
        if (!searchWrap) {
            searchWrap = document.createElement('div');
            searchWrap.id = 'sx-model-search-wrap';
            searchWrap.style.cssText = 'padding: 8px 8px 10px 8px; border-bottom: 1px solid rgba(255,255,255,0.06); background: inherit; position: sticky; top: 0; z-index: 10; box-sizing: border-box;';
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
                        const isReasoning = (m.modelId || m.name || '').toLowerCase().includes('reasoning') || (m.modelId || '').includes('omni') || (m.modelId || '').includes('r1');

                        const item = document.createElement('div');
                        item.className = 'sx-custom-model-item' + (isSelected ? ' is-selected' : '');
                        item.dataset.modelId = m.id;
                        item.dataset.modelLabel = m.name;
                        item.dataset.sxProvider = pId;

                        let rightBadges = '';
                        let ctxTag = this.models.formatContextSize(m.contextLength);
                        if (!ctxTag) {
                            const mLow = (m.modelId || m.name || '').toLowerCase();
                            if (mLow.includes('1m') || mLow.includes('ultra')) ctxTag = '1M';
                            else if (mLow.includes('256k') || mLow.includes('pro')) ctxTag = '256k';
                            else if (mLow.includes('128k')) ctxTag = '128k';
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

                        const checkSvg = `<svg class="sx-item-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="color:rgba(255,255,255,0.95);margin-left:4px;flex-shrink:0;${isSelected ? '' : 'visibility:hidden;'}"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

                        item.innerHTML = `
                            <span class="sx-model-title">${this.sxEsc(m.name)}</span>
                            <div style="display:flex;align-items:center;margin-left:auto;flex-shrink:0;">${rightBadges}${checkSvg}</div>
                        `;

                        item.addEventListener('click', () => {
                            const cKey = this.models.getActiveConversationKey();
                            this.models.setActiveModelForConversation(m.id, cKey, true);

                            listContainer.querySelectorAll('.sx-custom-model-item').forEach(el => {
                                el.classList.remove('is-selected');
                                const c = el.querySelector('.sx-item-check');
                                if (c) c.style.visibility = 'hidden';
                            });
                            item.classList.add('is-selected');
                            const c = item.querySelector('.sx-item-check');
                            if (c) c.style.visibility = 'visible';

                            this.quota?.updateContextButtonUI();

                            // Close popper
                            if (sampleNative) sampleNative.click();
                            setTimeout(() => this.hookDOM(), 30);
                        });

                        listContainer.appendChild(item);
                    });
                });
            } else {
                // Sync checkmarks
                listContainer.querySelectorAll('.sx-custom-model-item').forEach(el => {
                    const sel = el.dataset.modelId === activeId;
                    el.classList.toggle('is-selected', sel);
                    const c = el.querySelector('.sx-item-check');
                    if (c) c.style.visibility = sel ? 'visible' : 'hidden';
                });
            }
        }

        // Footer badge
        let fBadge = document.getElementById('sx-panel-footer-badge');
        if (!fBadge) {
            fBadge = document.createElement('div');
            fBadge.id = 'sx-panel-footer-badge';
            fBadge.style.cssText = 'margin-top:4px;padding:6px 10px;border-top:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;font-size:10.5px;user-select:none;';
            modelPanel.appendChild(fBadge);
        }
        fBadge.innerHTML = '<span style="font-weight:700;"><span style="color:#38bdf8;text-shadow:0 0 10px rgba(56,189,248,0.35);">SX</span> <span style="color:#ffffff;">Development</span></span><span style="font-size:9.5px;color:rgba(255,255,255,0.35);font-weight:500;">Custom Engine</span>';
    }
}
