/**
 * SX Core SDK - QuotaMonitor
 * Tracks real-time context token usage, live draft token estimation, and provides interactive context popover.
 */
export class QuotaMonitor {
    constructor(networkClient, modelManager, logger) {
        this.network = networkClient;
        this.models = modelManager;
        this.logger = logger;
        this._contextDetailsCache = {};
        this._inFlightFetches = new Map();
        this._progressInFlight = null;
        this._streamActive = false;
        this._lastStreamTs = 0;
        this._sentCache = {};
        this._progressFailTs = 0;
        this._detailsFailTs = {};
        this._lastGen = null;
        this._lastPollTs = 0;
        this._allCtxCache = null;
        this._lastRingModel = null;
    }

    _fmt(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
        return String(Math.round(n));
    }

    init() {
        document.addEventListener('click', (e) => {
            const pop = document.getElementById('sx-context-popover');
            if (pop && !pop.contains(e.target) && !e.target.closest('#sx-context-btn')) {
                pop.remove();
                const btn = document.getElementById('sx-context-btn');
                if (btn) btn.classList.remove('sx-active');
            }
        });

        // Instant live typing listener on prompt box (0ms keystroke latency)
        ['input', 'keyup', 'change', 'paste'].forEach(evName => {
            document.addEventListener(evName, (e) => {
                if (e.target && e.target.closest && e.target.closest('[contenteditable="true"], textarea, div.cursor-text')) {
                    this.updateContextButtonUI();
                }
            }, true);
        });
    }

    updateContextRing(metrics) {
        const btn = document.getElementById('sx-context-btn');
        if (!btn || !metrics) return;
        if (metrics.tooltip) btn.title = metrics.tooltip;

        const circ = 40.84; // 2 * Math.PI * 6.5
        const totalUsed = metrics.totalUsed || 0;
        const pctExact = metrics.percentExact || 0;

        let dash = 0;
        if (totalUsed > 0) {
            dash = Math.min(circ, Math.max(0.85, (pctExact / 100) * circ));
        }

        let color = '#38bdf8';
        if (pctExact > 85) color = '#f43f5e';
        else if (pctExact > 60) color = '#fbbf24';

        let svg = btn.querySelector('svg.sx-ring-svg');
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
            const prog = svg.querySelector('.sx-ring-progress');
            if (prog) {
                prog.setAttribute('stroke-dasharray', `${dash.toFixed(2)} ${circ.toFixed(2)}`);
                prog.setAttribute('stroke', color);
            }
        }
    }

    updateContextButtonUI() {
        const btn = document.getElementById('sx-context-btn');
        if (!btn) return;
        const sxModels = this.models.state.getModels();
        const activeConvKey = this.models.getActiveConversationKey();
        const activeId = this.models.getActiveModelForConversation(activeConvKey);
        const activeM = sxModels.find(m => m.id === activeId) || sxModels[0];
        const cleanConvId = (activeConvKey || '').replace(/^conv_/, '');
        const cacheKey = (cleanConvId || 'new') + '_' + (activeM?.id || '');

        // Model switched: sent cache belongs to the old model — refresh immediately
        // instead of showing stale/transcript numbers for up to 30s.
        const modelKey = activeM?.id || '';
        if (this._lastRingModel && this._lastRingModel !== modelKey) {
            this.refreshSentEstimate(cleanConvId, activeM?.id);
        }
        this._lastRingModel = modelKey;

        const metrics = this.calculateLiveContextMetrics(cleanConvId, activeM);
        this.updateContextRing(metrics);

        const pop = document.getElementById('sx-context-popover');
        if (pop && pop.isConnected) {
            if (pop.dataset.convKey && pop.dataset.convKey !== cacheKey) {
                // Conversation switched while popover open: rebind, never show stale conv data
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

        // Proactive background fetch if not fresh chat and (cache missing or older than 12s)
        const isFresh = (!cleanConvId || cleanConvId === 'new' || cleanConvId === 'draft');
        if (!isFresh) {
            const cached = this._contextDetailsCache[cacheKey];
            const failTs = this._detailsFailTs[cacheKey] || 0;
            const isStale = (!cached || (Date.now() - (cached._time || 0) > 12000)) && (Date.now() - failTs > 30000);
            if (isStale) {
                this.refreshContextDetails(cleanConvId, activeM);
            }
            const sentKey = 'sent_' + cleanConvId;
            const sentCached = this._sentCache[sentKey];
            if (!sentCached || (Date.now() - (sentCached._time || 0) > 30000)) {
                this.refreshSentEstimate(cleanConvId, activeM?.id);
            }
        }

        // Live generation progress: only updates shared state here; the ring and
        // popover read it through calculateLiveContextMetrics on the next tick,
        // so there is exactly one render path and no flicker.
        const wantLive = (pop && pop.isConnected) || this._streamActive || (Date.now() - (this._lastStreamTs || 0) < 45000);
        const bgPollDue = !isFresh && (Date.now() - (this._lastPollTs || 0) > 5000);
        if (!this._progressInFlight && (wantLive || bgPollDue) && !isFresh) {
            this._lastPollTs = Date.now();
            this._progressInFlight = this.fetchStreamProgress(cleanConvId).then(p => {
                this._progressInFlight = null;
                if (!p) { this._streamActive = false; this._lastGen = null; return; }
                this._streamActive = !!p.streaming;
                const gen = p.genTokens || 0;
                if (gen > 50) {
                    this._lastGen = { tokens: gen, ts: Date.now() };
                    if (p.streaming) this._lastStreamTs = Date.now();
                } else if (!p.streaming) {
                    this._streamActive = false;
                    this._lastGen = null;
                }
            }).catch(() => { this._progressInFlight = null; this._streamActive = false; this._lastGen = null; });
        }
    }

    async refreshContextDetails(cleanConvId, targetModel) {
        if (!cleanConvId || cleanConvId === 'new' || cleanConvId === 'draft') return null;
        const cacheKey = cleanConvId + '_' + (targetModel?.id || '');
        if (this._inFlightFetches.has(cacheKey)) {
            return this._inFlightFetches.get(cacheKey);
        }

        const promise = (async () => {
            try {
                const data = await this.network.fetchContextDetails(cleanConvId, targetModel?.id);
                if (data && data.ok) {
                    this._contextDetailsCache[cacheKey] = { data, _time: Date.now() };
                    delete this._detailsFailTs[cacheKey];

                    // If model was detected from transcript, sync if conversation not explicitly set
                    if (data.detectedModelId && cleanConvId) {
                        const cKey = 'conv_' + cleanConvId;
                        if (!localStorage.getItem('sx_active_model_' + cKey)) {
                            localStorage.setItem('sx_active_model_' + cKey, data.detectedModelId);
                        }
                    }

                    // Check if current view is still this conversation
                    const curConvKey = this.models.getActiveConversationKey();
                    const curClean = (curConvKey || '').replace(/^conv_/, '');
                    if (curClean === cleanConvId) {
                        const updatedMetrics = this.calculateLiveContextMetrics(cleanConvId, targetModel);
                        this.updateContextRing(updatedMetrics);
                        const pop = document.getElementById('sx-context-popover');
                        if (pop && pop.isConnected) {
                            this.renderPopoverDetails(pop, data, updatedMetrics);
                        }
                    }
                    return data;
                }
                // Negative cache on unsuccessful responses
                this._detailsFailTs[cacheKey] = Date.now();
            } catch(e) {
                this._detailsFailTs[cacheKey] = Date.now();
                this.logger?.warn('QuotaMonitor', 'Failed to refresh context details', e);
            } finally {
                this._inFlightFetches.delete(cacheKey);
            }
            return null;
        })();

        this._inFlightFetches.set(cacheKey, promise);
        return promise;
    }

    invalidateCacheAndRefresh(convKey) {
        const cleanConvId = (convKey || this.models.getActiveConversationKey() || '').replace(/^conv_/, '');
        if (!cleanConvId || cleanConvId === 'new') return;
        Object.keys(this._contextDetailsCache).forEach(k => {
            if (k.startsWith(cleanConvId + '_')) {
                delete this._contextDetailsCache[k];
            }
        });
        const activeId = this.models.getActiveModelForConversation('conv_' + cleanConvId);
        const targetModel = this.models.state.getModels().find(m => m.id === activeId);
        this.refreshContextDetails(cleanConvId, targetModel);
        this.refreshSentEstimate(cleanConvId, targetModel?.id);
    }

    getDraftPromptText() {
        try {
            const editable = document.querySelector('[contenteditable="true"], div.cursor-text[role="combobox"], textarea');
            if (editable) {
                return (editable.innerText || editable.textContent || editable.value || '').trim();
            }
        } catch(e) {}
        return '';
    }

    calculateLiveContextMetrics(cleanConvId, targetModel) {
        const cacheKey = (cleanConvId || 'new') + '_' + (targetModel?.id || '');
        const cacheEntry = this._contextDetailsCache[cacheKey];
        const cached = cacheEntry?.data;

        // Primary number = what the model actually receives (post-trim sent size).
        // Transcript debt is shown separately; it only ever grows and would pin the ring at 100%.
        let sentTok = 0;
        try {
            const sentEntry = this._sentCache['sent_' + (cleanConvId || 'new')];
            const s = sentEntry?.sent;
            if (s && s.tokens > 0) {
                // Guard: ignore sent values recorded under a different model
                const sentModel = String(s.model || '');
                const curModelIds = [targetModel?.id, targetModel?.modelId].filter(Boolean).map(String);
                if (!sentModel || curModelIds.includes(sentModel) || sentModel === (targetModel?.name || '')) {
                    sentTok = Number(s.tokens);
                }
            }
        } catch(e) {}
        const transcriptUsed = (cached && !cached.isFreshChat) ? cached.usedTokens : 0;
        const totalContext = cached ? cached.totalContext : (targetModel?.contextLength ? Number(targetModel.contextLength) : 262144);
        const baseUsed = sentTok > 0 ? sentTok : transcriptUsed;

        const draftText = this.getDraftPromptText();
        const draftChars = draftText.length;
        const draftTokens = draftChars > 0 ? Math.ceil(draftChars / 3.2) : 0;

        // Live generated tokens folded in here so EVERY render path (tick, poll,
        // popover) sees the same numbers — no flicker from competing sources.
        let genTokens = 0;
        try {
            if (this._lastGen && (Date.now() - this._lastGen.ts < 15000) && this._lastGen.tokens > 50) {
                genTokens = this._lastGen.tokens;
            }
        } catch(e) {}

        const totalUsed = baseUsed + draftTokens + genTokens;
        const isFresh = (baseUsed === 0 && draftTokens === 0 && genTokens === 0);
        const pct = isFresh ? 0 : Math.min(100, (totalUsed / totalContext) * 100);

        function fmt(n) {
            if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
            if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
            return String(Math.round(n));
        }

        let tooltip = '';
        const percentDisplay = (pct > 0 && pct < 1) ? '<1%' : `${Math.round(pct)}%`;
        const transcriptNote = (sentTok > 0 && transcriptUsed > totalUsed) ? ` • transkript ${fmt(transcriptUsed)}` : '';
        const genSuffix = genTokens > 0 ? ` [+${fmt(genTokens)} üretiliyor]` : '';
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
            cacheAgeMs: cacheEntry ? (Date.now() - (cacheEntry._time || 0)) : null,
            convId: cleanConvId || null,
            sentBased: sentTok > 0,
            transcriptUsed
        };
    }

    async fetchStreamProgress(cleanConvId) {
        if (!cleanConvId || cleanConvId === 'new' || cleanConvId === 'draft') return null;
        // Negative cache: don't hammer a proxy that lacks the endpoint (old version)
        if (this._progressFailTs && (Date.now() - this._progressFailTs < 60000)) return null;
        try {
            const r = await this.network.get(`/get-stream-progress?convId=${encodeURIComponent(cleanConvId)}`);
            if (r && r.ok) return r;
            this._progressFailTs = Date.now();
            return null;
        } catch(e) { this._progressFailTs = Date.now(); return null; }
    }

    /** Seconds since last streamed chunk if a stream is active, else 0. */
    streamElapsedSec() {
        try {
            if (this._streamActive && (Date.now() - (this._lastStreamTs || 0) < 45000)) {
                return Math.max(0, Math.round((Date.now() - this._lastStreamTs) / 1000));
            }
        } catch(e) {}
        return 0;
    }

    async fetchAllContexts() {
        try {
            if (this._allCtxCache && (Date.now() - this._allCtxCache._time < 30000)) {
                return this._allCtxCache.data;
            }
            const r = await this.network.get('/get-all-contexts');
            if (r && r.ok && Array.isArray(r.convs)) {
                this._allCtxCache = { data: r.convs, _time: Date.now() };
                return r.convs;
            }
            this._allCtxCache = { data: [], _time: Date.now(), failed: true };
            return [];
        } catch(e) {
            this._allCtxCache = { data: [], _time: Date.now(), failed: true };
            return [];
        }
    }

    renderAllContextsSection(pop, currentConvId) {
        try {
            let sec = pop.querySelector('#sx-ctx-subagents');
            const convs = (this._allCtxCache?.data || []).filter(c => c && c.id && c.id !== currentConvId).slice(0, 8);
            if (!convs.length) { if (sec) sec.remove(); return; }
            const fmt = (n) => {
                if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
                if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
                return String(Math.round(n));
            };
            const rows = convs.map(c => {
                const total = Number(c.ctx) > 0 ? Number(c.ctx) : 262144;
                const pct = Math.min(100, ((Number(c.estTok) || 0) / total) * 100);
                const color = pct > 85 ? '#f43f5e' : (pct > 60 ? '#fbbf24' : '#38bdf8');
                const label = `${String(c.id).slice(0, 8)}${c.streaming ? ' • üretiyor' : ''}`;
                const model = String(c.modelName || c.modelId || '?').slice(0, 20);
                return `
                    <div style="display:flex;align-items:center;justify-content:space-between;font-size:11.5px;line-height:1.5;" title="${this._escAttr(c.modelName || c.modelId || '')}">
                        <div style="display:flex;align-items:center;gap:7px;min-width:0;">
                            <div style="width:6px;height:6px;border-radius:50%;background:${color};flex-shrink:0;"></div>
                            <span style="color:#cbd5e1;font-family:ui-monospace,monospace;">${label}</span>
                            <span style="color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${model}</span>
                        </div>
                        <div style="font-family:ui-monospace,monospace;font-size:11px;color:#94a3b8;flex-shrink:0;margin-left:8px;">${fmt(c.estTok || 0)} (${Math.round(pct)}%)</div>
                    </div>`;
            }).join('');
            const html = `
                <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.7px;margin:14px 0 8px 0;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);">Diğer Sohbetler</div>
                <div style="display:flex;flex-direction:column;gap:7px;">${rows}</div>`;
            if (sec) { sec.innerHTML = html; }
            else {
                sec = document.createElement('div');
                sec.id = 'sx-ctx-subagents';
                sec.innerHTML = html;
                pop.appendChild(sec);
            }
        } catch(e) {}
    }

    _escAttr(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    async refreshSentEstimate(cleanConvId, modelId) {
        if (!cleanConvId || cleanConvId === 'new' || cleanConvId === 'draft') return null;
        try {
            const r = await this.network.get(`/get-sent-estimate?convId=${encodeURIComponent(cleanConvId)}`);
            if (r && r.ok && r.sent) {
                this._sentCache['sent_' + cleanConvId] = { sent: r.sent, _time: Date.now() };
                return r.sent;
            }
        } catch(e) {}
        // Fallback for old proxy without the endpoint: replicate the post-trim
        // sent-size math client-side so the button stays truthful regardless.
        const fb = this.estimateSentFallback(cleanConvId, modelId);
        if (fb) {
            const sent = { ...fb, fallback: true };
            this._sentCache['sent_' + cleanConvId] = { sent, _time: Date.now() };
            return sent;
        }
        // Negative cache so failures don't spam every tick
        this._sentCache['sent_' + cleanConvId] = { sent: null, failed: true, _time: Date.now() };
        return null;
    }

    estimateSentFallback(cleanConvId, modelId) {
        try {
            const prefix = cleanConvId + '_';
            let data = null, keyModelId = '';
            for (const k of Object.keys(this._contextDetailsCache)) {
                if (k.startsWith(prefix) && this._contextDetailsCache[k]?.data) {
                    // Prefer the entry matching the active model
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
            const OVERHEAD_CONST = 6000 + 11800 + 682; // sys prompt + sys tools + skills (same as proxy endpoint)
            let budget = Math.max(4000, total - OVERHEAD_CONST - 16000);
            let effModelId = modelId || keyModelId;
            try {
                const m = (this.models.state.getModels() || []).find(x => x.id === effModelId);
                const mid = `${m?.modelId || ''} ${m?.name || ''}`.toLowerCase();
                if (mid.includes(':free') || mid.includes('free')) budget = Math.min(budget, 70000);
                if (m?.modelId) effModelId = m.modelId;
            } catch(e) {}
            const historyPart = Math.max(0, Number(data.usedTokens) - OVERHEAD_CONST);
            const tokens = Math.round(OVERHEAD_CONST + Math.min(historyPart, budget));
            return { tokens, model: effModelId || undefined, ts: Date.now() };
        } catch(e) { return null; }
    }

    async fetchContextDetails(cleanConvId, targetModel) {
        return await this.refreshContextDetails(cleanConvId, targetModel);
    }

    toggleContextPopover(anchorEl) {
        let pop = document.getElementById('sx-context-popover');
        if (pop) {
            pop.remove();
            if (anchorEl) anchorEl.classList.remove('sx-active');
            return;
        }

        const convKey = this.models.getActiveConversationKey();
        const cleanConvId = (convKey || '').replace(/^conv_/, '');
        const activeModelId = this.models.getActiveModelForConversation(convKey);
        const targetModel = this.models.state.getModels().find(m => m.id === activeModelId);

        if (anchorEl) anchorEl.classList.add('sx-active');

        pop = document.createElement('div');
        pop.id = 'sx-context-popover';
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
        pop.style.left = popLeft + 'px';
        pop.style.bottom = (window.innerHeight - rect.top + 8) + 'px';

        pop.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;" id="sx-ctx-popover-header">
                <div style="display:flex;align-items:center;gap:6px;">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                    </svg>
                    <span style="font-size:13px;color:#f8fafc;font-weight:600;letter-spacing:0.2px;">Context Window</span>
                </div>
                <div style="display:flex;align-items:center;gap:4px;">
                    <span id="sx-ctx-stat-text" style="font-size:12px;color:#94a3b8;font-family:ui-monospace,monospace;">Hesaplanıyor...</span>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#64748b;margin-left:2px;"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
            </div>

            <div style="width:100%;height:6px;background:rgba(255,255,255,0.08);border-radius:999px;margin:12px 0 14px 0;overflow:hidden;position:relative;">
                <div id="sx-ctx-progress-bar" style="width:0%;height:100%;background:#38bdf8;border-radius:999px;transition:width 0.3s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s ease;"></div>
            </div>

            <div id="sx-ctx-items-list" style="display:flex;flex-direction:column;gap:9px;">
                <div style="font-size:12px;color:#64748b;text-align:center;padding:10px 0;">Yükleniyor...</div>
            </div>
        `;

        document.body.appendChild(pop);
        pop.dataset.convKey = (cleanConvId || 'new') + '_' + (targetModel?.id || '');

        pop.querySelector('#sx-ctx-popover-header').onclick = () => {
            pop.remove();
            if (anchorEl) anchorEl.classList.remove('sx-active');
        };

        const liveMetrics = this.calculateLiveContextMetrics(cleanConvId, targetModel);
        const cacheKey = (cleanConvId || 'new') + '_' + (targetModel?.id || '');
        const cached = this._contextDetailsCache[cacheKey]?.data;
        if (cached) {
            this.renderPopoverDetails(pop, cached, liveMetrics);
        }

        this.fetchContextDetails(cleanConvId, targetModel).then(data => {
            if (pop.isConnected && data) {
                const updatedLive = this.calculateLiveContextMetrics(cleanConvId, targetModel);
                this.renderPopoverDetails(pop, data, updatedLive);
                this.updateContextRing(updatedLive);
            }
        });
        // Other conversations section (async fill)
        this.fetchAllContexts().then(() => {
            try {
                if (!pop.isConnected) return;
                const curKey = this.models.getActiveConversationKey();
                const curClean = (curKey || '').replace(/^conv_/, '');
                const cacheKey = (curClean || 'new') + '_' + (targetModel?.id || '');
                const d = this._contextDetailsCache[cacheKey]?.data;
                if (d) this.renderAllContextsSection(pop, String(d.convId || curClean || ''));
            } catch(e) {}
        });
    }

    renderPopoverDetails(pop, data, liveMetrics) {
        if (!data || !data.items) return;
        const statText = pop.querySelector('#sx-ctx-stat-text');
        const progBar = pop.querySelector('#sx-ctx-progress-bar');
        const itemsList = pop.querySelector('#sx-ctx-items-list');

        function fmt(n) {
            if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
            if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
            return String(Math.round(n));
        }

        // Conversation identity + freshness line (proves per-conv isolation)
        let convLine = pop.querySelector('#sx-ctx-convline');
        if (!convLine) {
            convLine = document.createElement('div');
            convLine.id = 'sx-ctx-convline';
            convLine.style.cssText = 'font-size:10.5px;color:rgba(255,255,255,0.35);font-family:ui-monospace,monospace;margin:-6px 0 10px 0;';
            const bar = pop.querySelector('#sx-ctx-progress-bar')?.parentElement;
            if (bar && bar.parentElement) bar.parentElement.insertBefore(convLine, bar.nextSibling);
            else pop.appendChild(convLine);
        }
        try {
            const shortConv = String(data.convId || liveMetrics?.convId || '').slice(0, 8) || '?';
            const basisTxt = liveMetrics?.sentBased ? ' • gönderilen bazlı' : '';
            const trTxt = (liveMetrics?.sentBased && liveMetrics?.transcriptUsed > 0)
                ? ` • geçmiş ${fmt(liveMetrics.transcriptUsed)}` : '';
            convLine.textContent = `sohbet ${shortConv}${basisTxt}${trTxt}`;
            convLine.title = 'Bu sohbete ait ölçüm. Halka modele gönderilen boyutu gösterir; geçmiş diskteki toplamdır.';
        } catch(e) {}

        const totalUsed = liveMetrics?.totalUsed ?? data.usedTokens;
        const pctNum = liveMetrics?.percentNum ?? data.percentNum;
        const pctExact = liveMetrics?.percentExact ?? (data.percentNum || 0);
        const pctDisplay = liveMetrics?.percentDisplay || (pctNum === 0 && totalUsed > 0 ? '<1%' : `${pctNum}%`);

        if (statText) {
            const draftSuffix = liveMetrics?.draftTokens > 0 ? ` (+${fmt(liveMetrics.draftTokens)} taslak)` : '';
            statText.innerText = `${fmt(totalUsed)} / ${data.totalContextFormatted} (${pctDisplay})${draftSuffix}`;
        }
        if (progBar) {
            const barWidth = totalUsed > 0 ? Math.max(1.5, Math.min(100, pctExact)) : 0;
            progBar.style.width = barWidth + '%';
            if (pctExact > 85) progBar.style.background = '#f43f5e';
            else if (pctExact > 60) progBar.style.background = '#fbbf24';
            else progBar.style.background = '#38bdf8';
        }

        if (itemsList) {
            let html = '';
            const itemsToRender = [...data.items];
            if (liveMetrics?.genTokens > 50) {
                const genPct = ((liveMetrics.genTokens / data.totalContext) * 100).toFixed(1);
                itemsToRender.unshift({
                    label: 'Üretiliyor (canlı)',
                    color: '#22d3ee',
                    tokens: `+${fmt(liveMetrics.genTokens)}`,
                    percent: `+${genPct}%`
                });
            }
            try {
                const convForSent = String(data.convId || liveMetrics?.convId || '');
                const sentEntry = convForSent ? this._sentCache['sent_' + convForSent] : null;
                if (sentEntry?.sent?.tokens > 0) {
                    const sTok = sentEntry.sent.tokens;
                    const sPct = ((sTok / data.totalContext) * 100).toFixed(1);
                    itemsToRender.unshift({
                        label: sentEntry.sent.fallback ? 'Son gönderim (tahmini)' : 'Son gönderim (modele giden)',
                        color: '#2dd4bf',
                        tokens: fmt(sTok),
                        percent: `${sPct}%`
                    });
                    const hist = Array.isArray(sentEntry.sent.history) ? sentEntry.sent.history.filter(Number.isFinite) : [];
                    if (hist.length >= 2) {
                        const avg = Math.round(hist.reduce((a, b) => a + b, 0) / hist.length);
                        const aPct = ((avg / data.totalContext) * 100).toFixed(1);
                        itemsToRender.unshift({
                            label: `Ortalama gönderim (son ${hist.length})`,
                            color: '#5eead4',
                            tokens: fmt(avg),
                            percent: `${aPct}%`
                        });
                    }
                }
            } catch(e) {}
            if (liveMetrics?.draftTokens > 0) {
                const draftPct = ((liveMetrics.draftTokens / data.totalContext) * 100).toFixed(1);
                itemsToRender.unshift({
                    label: 'Yazılan Taslak Mesaj',
                    color: '#38bdf8',
                    tokens: `+${fmt(liveMetrics.draftTokens)}`,
                    percent: `+${draftPct}%`
                });
            }
            itemsToRender.forEach(item => {
                const title = item.hint ? ` title="${item.hint}"` : '';
                html += `
                    <div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px;line-height:1.2;"${title}>
                        <div style="display:flex;align-items:center;gap:8px;">
                            <div style="width:7px;height:7px;border-radius:50%;background:${item.color || '#38bdf8'};flex-shrink:0;"></div>
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
        // Other conversations (subagents): cached data renders instantly, refresh fills in
        try {
            this.renderAllContextsSection(pop, String(data.convId || liveMetrics?.convId || ''));
        } catch(e) {}
    }
}
