/**
 * SX Core SDK - PerfMonitor
 * Tracks real-time LLM inference performance: TTFT, TPS, and accurate token count per message.
 * Ensures EACH message displays its OWN distinct performance metrics right next to its timestamp.
 */
export class PerfMonitor {
    constructor(networkClient, modelManager, logger) {
        this.network = networkClient;
        this.models = modelManager;
        this.logger = logger;
        this._perfStatsCache = {};
        this._latestLivePerf = null;
        this._observer = null;
        this._perfHistory = {}; // convKey -> [last 20 measured stats] for averages
    }

    init() {
        // 1. Popover dismiss listener
        document.addEventListener('click', (e) => {
            const perfPop = document.getElementById('sx-perf-popover');
            if (perfPop && !perfPop.contains(e.target) && !e.target.closest('#sx-perf-btn')) {
                perfPop.remove();
                const pBtn = document.getElementById('sx-perf-btn');
                if (pBtn) pBtn.classList.remove('sx-active');
            }
        });

        // 2. Observe chat DOM for messages to inject individual metrics badges
        this.setupMessageFootersObserver();

        // 3. Initial sync with proxy stats
        setTimeout(() => {
            const convKey = this.models.getActiveConversationKey();
            const cleanConvId = (convKey || '').replace(/^conv_/, '');
            this.fetchPerfStats(cleanConvId);
        }, 300);
    }

    setupMessageFootersObserver() {
        try {
            if (this._observer) this._observer.disconnect();
            this._observer = new MutationObserver(() => {
                // Debounced: streaming fires mutations per chunk; rescan at most ~1.5/s
                if (this._obsTimer) return;
                this._obsTimer = setTimeout(() => {
                    this._obsTimer = null;
                    this.injectMetricsToMessageFooters();
                }, 150);
            });
            this._observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        } catch(e) {}

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
        const timeText = footerEl.childNodes[0]?.textContent?.trim() || '';
        const group = footerEl.closest('.flex.flex-col.gap-0\\.5.group.w-full.scroll-mt-4') || 
                      footerEl.closest('[class*="group"]');
        const textEl = group ? (group.querySelector('.prose, .break-words, .leading-relaxed, p') || group) : null;
        const textSnippet = (textEl ? textEl.innerText.trim() : '').slice(0, 35);
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
                const saved = localStorage.getItem('sx_msg_perf_' + sig);
                if (saved) {
                    const parsed = JSON.parse(saved);
                    // Only trust entries that came from real measurements
                    if (parsed && parsed.measured === true) return parsed;
                }
            } catch(e) {}
        }

        // If this is the newly generated message and we have live streaming stats waiting
        if (isLastMessage && this._latestLivePerf) {
            const live = this._latestLivePerf;
            this._latestLivePerf = null;
            if (sig) {
                try {
                    localStorage.setItem('sx_msg_perf_' + sig, JSON.stringify({ ...live, measured: true }));
                } catch(e) {}
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
            // One-time purge of pre-v2 fabricated entries (never measured)
            if (!localStorage.getItem('sx_perf_purged_v2')) {
                const del = [];
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith('sx_msg_perf_')) {
                        try {
                            const v = JSON.parse(localStorage.getItem(k) || '{}');
                            if (!v || v.measured !== true) del.push(k);
                        } catch(e) { del.push(k); }
                    }
                }
                del.forEach(k => { try { localStorage.removeItem(k); } catch(e){} });
                try { localStorage.setItem('sx_perf_purged_v2', '1'); } catch(e){}
            }
            if (this._lastPruneTs && (now - this._lastPruneTs < 120000)) return;
            this._lastPruneTs = now;
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith('sx_msg_perf_')) keys.push(k);
            }
            const MAX_KEYS = 300;
            if (keys.length <= MAX_KEYS) return;
            const withTs = keys.map(k => {
                let ts = 0;
                try {
                    const v = JSON.parse(localStorage.getItem(k) || '{}');
                    ts = Date.parse(v.timestamp || '') || 0;
                } catch(e) {}
                return { k, ts };
            });
            withTs.sort((a, b) => a.ts - b.ts);
            const drop = withTs.slice(0, withTs.length - MAX_KEYS);
            drop.forEach(({ k }) => { try { localStorage.removeItem(k); } catch(e){} });
        } catch(e) {}
    }

    /**
     * Called by FetchInterceptor when a live message finishes streaming
     */
    recordLiveMessagePerf(convKey, perfData) {
        if (!perfData) return;
        const cleanConvId = (convKey || '').replace(/^conv_/, '');
        const measured = { ...perfData, measured: true };
        this._perfStatsCache[cleanConvId || 'new'] = measured;
        this._perfStatsCache['last'] = measured;
        this._latestLivePerf = measured;
        // Rolling history for per-conversation averages
        try {
            const hk = cleanConvId || 'new';
            if (!this._perfHistory[hk]) this._perfHistory[hk] = [];
            this._perfHistory[hk].push(measured);
            if (this._perfHistory[hk].length > 20) this._perfHistory[hk].splice(0, this._perfHistory[hk].length - 20);
        } catch(e) {}

        try {
            localStorage.setItem('sx_last_perf_stats', JSON.stringify(measured));
        } catch(e) {}

        // Bind immediately to the newest message
        const footers = Array.from(document.querySelectorAll('.flex.w-full.items-start.gap-1 > .grow'));
        if (footers.length > 0) {
            const lastFooter = footers[footers.length - 1];
            const sig = this.getMessageSignature(lastFooter);
            if (sig) {
                try {
                    localStorage.setItem('sx_msg_perf_' + sig, JSON.stringify(measured));
                } catch(e) {}
            }
        }

        this.injectMetricsToMessageFooters();
        this.updatePerfButtonUI();

        // If popover is open, update it
        const pop = document.getElementById('sx-perf-popover');
        if (pop && this._currentRenderFn) {
            this._currentRenderFn(perfData);
        }
    }

    getLatestStats(convId) {
        const clean = (convId || '').replace(/^conv_/, '');
        if (clean && this._perfStatsCache[clean]) return this._perfStatsCache[clean];
        if (this._perfStatsCache['new']) return this._perfStatsCache['new'];
        if (this._perfStatsCache['last']) return this._perfStatsCache['last'];

        try {
            const saved = localStorage.getItem('sx_last_perf_stats');
            if (saved) return JSON.parse(saved);
        } catch(e) {}
        return null;
    }

    async fetchPerfStats(convId) {
        try {
            const cleanConvId = (convId || '').replace(/^conv_/, '');
            const raw = await this.network.fetchPerfStats(cleanConvId);
            const stats = raw?.stats || raw;
            if (stats && stats.ttftMs) {
                const measured = { ...stats, measured: true };
                this._perfStatsCache[cleanConvId || 'new'] = measured;
                this._perfStatsCache['last'] = measured;
                this.updatePerfButtonUI();
                return measured;
            }
        } catch(e) {}
        return this.getLatestStats(convId);
    }

    /**
     * Injects or updates distinct metrics badges on each assistant message footer
     */
    injectMetricsToMessageFooters() {
        try {
            const now = Date.now();
            if (this._lastScanTs && (now - this._lastScanTs < 500)) return;
            this._lastScanTs = now;

            // Broader selector to reliably find message footer containing timestamps
            let footers = Array.from(document.querySelectorAll('.flex.w-full.items-start.gap-1 > .grow, [data-testid*="message-footer"], .message-footer'));
            if (!footers || footers.length === 0) {
                footers = Array.from(document.querySelectorAll('div, span')).filter(el => {
                    if (el.children.length > 2) return false;
                    const txt = el.textContent.trim();
                    return /\b\d{1,2}:\d{2}\b/.test(txt) && txt.length < 35 && !el.closest('#sx-perf-popover') && !el.closest('#sx-context-popover') && !el.closest('#sx-effort-slider-popover');
                });
            }
            if (!footers || footers.length === 0) return;

            footers.forEach((footerEl, idx) => {
                const timeText = footerEl.childNodes[0]?.textContent?.trim() || footerEl.textContent?.trim() || '';
                // Must contain timestamp format e.g. "1:03" or "21:21, 21.09.2026"
                if (!/\b\d{1,2}:\d{2}\b/.test(timeText)) return;

                const isLast = (idx === footers.length - 1);
                const stats = this.getStatsForMessage(footerEl, isLast);
                if (!stats && !isLast) return;

                const ttftSec = stats ? (stats.ttftMs / 1000).toFixed(2) : '--';
                const ttftStr = stats ? (stats.ttftMs >= 1000 ? `${ttftSec}s` : `${stats.ttftMs}ms`) : '--ms';
                const tpsStr = stats ? (stats.tps || 0) : 0;
                const tokDisp = stats ? `~${stats.completionTokens || 0} tok` : '--';
                const splitStr = (stats && (stats.normalTokens != null || stats.thinkingTokens != null)) ? ` (${stats.normalTokens || 0}N / ${stats.thinkingTokens || 0}T)` : '';
                const durStr = (stats && stats.durationMs) ? `${(stats.durationMs / 1000).toFixed(1)}s` : '';

                let speedColor = '#10b981';
                if (stats && stats.tps < 20) speedColor = '#f43f5e';
                else if (stats && stats.tps < 40) speedColor = '#eab308';
                else if (stats && stats.tps < 80) speedColor = '#38bdf8';

                let badge = footerEl.querySelector('.sx-msg-perf-metrics');
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'sx-msg-perf-metrics';
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
                        background: rgba(255, 255, 255, 0.03);
                        border: 1px solid rgba(255, 255, 255, 0.08);
                        padding: 2px 7px;
                        border-radius: 6px;
                    `;
                    footerEl.appendChild(badge);
                }

                badge.innerHTML = `
                    <span style="color: ${speedColor}; font-weight: 700;" title="İnferans Hızı: ${tpsStr} Token/Saniye">⚡ ${tpsStr} TPS</span>
                    <span style="color: rgba(255,255,255,0.25); font-size: 9px;">•</span>
                    <span style="color: #38bdf8; font-weight: 600;" title="İlk Yanıt Süresi (TTFT): ${stats ? stats.ttftMs + 'ms' : '--'}">⏱️ ${ttftStr}</span>
                    <span style="color: rgba(255,255,255,0.25); font-size: 9px;">•</span>
                    <span style="color: rgba(255,255,255,0.7);" title="Toplam Üretilen Token: ${tokDisp}${splitStr}">📊 ${tokDisp}${splitStr}</span>
                    ${durStr ? `<span style="color: rgba(255,255,255,0.25); font-size: 9px;">•</span><span style="color: rgba(255,255,255,0.5);" title="Toplam Süre: ${durStr}">⏳ ${durStr}</span>` : ''}
                `;
            });
        } catch(e) {}
    }

    togglePerfPopover(anchorEl) {
        // Mutual exclusion: Close other open popovers
        const otherCtx = document.getElementById('sx-context-popover');
        if (otherCtx) otherCtx.remove();
        const otherEffort = document.getElementById('sx-effort-slider-popover');
        if (otherEffort) otherEffort.remove();
        const infoModal = document.getElementById('sx-effort-info-modal');
        if (infoModal) infoModal.remove();

        let pop = document.getElementById('sx-perf-popover');
        if (pop) {
            pop.remove();
            if (anchorEl) anchorEl.classList.remove('sx-active');
            this._currentRenderFn = null;
            return;
        }

        document.querySelectorAll('.sx-active').forEach(el => {
            if (el !== anchorEl) el.classList.remove('sx-active');
        });

        const convKey = this.models.getActiveConversationKey();
        const cleanConvId = (convKey || '').replace(/^conv_/, '');

        if (anchorEl) anchorEl.classList.add('sx-active');

        pop = document.createElement('div');
        pop.id = 'sx-perf-popover';
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
        pop.style.left = popLeft + 'px';

        const promptBox = anchorEl.closest('form') ||
                          anchorEl.closest('[data-testid="chat-input-container"]') ||
                          document.querySelector('[contenteditable="true"], textarea')?.closest('form, div.relative.flex, div.border') ||
                          anchorEl.closest('.relative');
        const boxTop = promptBox ? promptBox.getBoundingClientRect().top : rect.top;
        pop.style.bottom = Math.max(8, window.innerHeight - boxTop + 10) + 'px';

        pop.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;" id="sx-perf-popover-header">
                <div style="display:flex;align-items:center;gap:6px;">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#eab308" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                    </svg>
                    <span style="font-size:13px;color:#f8fafc;font-weight:600;letter-spacing:0.2px;">Model Performansı</span>
                </div>
                <div style="display:flex;align-items:center;gap:4px;">
                    <span id="sx-perf-tps-badge" style="font-size:11.5px;color:#eab308;font-family:ui-monospace,monospace;font-weight:700;background:rgba(234,179,8,0.12);padding:1.5px 6px;border-radius:4px;border:1px solid rgba(234,179,8,0.25);">-- TPS</span>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#64748b;margin-left:2px;"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
            </div>

            <div style="width:100%;height:1px;background:rgba(255,255,255,0.08);margin:12px 0 14px 0;"></div>

            <div id="sx-perf-items-list" style="display:flex;flex-direction:column;gap:9px;">
                <div style="font-size:12px;color:#64748b;text-align:center;padding:10px 0;">Yükleniyor...</div>
            </div>
        `;

        document.body.appendChild(pop);

        pop.querySelector('#sx-perf-popover-header').onclick = () => {
            pop.remove();
            if (anchorEl) anchorEl.classList.remove('sx-active');
            this._currentRenderFn = null;
        };

        const renderPerfDetails = (rawStats) => {
            const listEl = pop.querySelector('#sx-perf-items-list');
            const tpsBadge = pop.querySelector('#sx-perf-tps-badge');
            if (!listEl) return;

            const stats = rawStats?.stats || rawStats;

            if (!stats || !stats.ttftMs) {
                listEl.innerHTML = `
                    <div style="font-size:12px;color:#94a3b8;text-align:center;padding:12px 0;line-height:1.5;">
                        Bu sohbet için henüz performans ölçümü yapılmadı.<br>
                        <span style="font-size:11px;color:#64748b;">Bir mesaj gönderdiğinizde ilk yanıt süresi ve TPS burada görünecektir.</span>
                    </div>
                `;
                if (tpsBadge) tpsBadge.innerText = 'Bekleniyor';
                return;
            }

            if (tpsBadge) {
                tpsBadge.innerText = `${stats.tps || 0} TPS`;
            }

            // Conversation average across measured messages
            try {
                const hist = (this._perfHistory[cleanConvId] || []).filter(s => s && s.ttftMs > 0);
                if (hist.length >= 2) {
                    const avgTps = (hist.reduce((a, s) => a + (Number(s.tps) || 0), 0) / hist.length).toFixed(1);
                    const avgTtft = Math.round(hist.reduce((a, s) => a + (Number(s.ttftMs) || 0), 0) / hist.length);
                    const avgTok = Math.round(hist.reduce((a, s) => a + (Number(s.completionTokens) || 0), 0) / hist.length);
                    listEl.innerHTML += `
                        <div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;margin-top:4px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);">
                            <span style="color:#94a3b8;">Sohbet ortalaması (${hist.length} mesaj):</span>
                            <span style="color:#f8fafc;font-family:ui-monospace,monospace;font-weight:600;">${avgTps} TPS <span style="color:#64748b;font-size:11px;">• ${avgTtft}ms • ~${avgTok} tok</span></span>
                        </div>
                    `;
                }
            } catch(e) {}

            const ttftSec = (stats.ttftMs / 1000).toFixed(2);
            const totalSec = (stats.totalMs / 1000).toFixed(2);

            let speedQuality = 'Normal';
            let speedColor = '#eab308';
            if (stats.tps >= 60) { speedQuality = 'Çok Hızlı'; speedColor = '#10b981'; }
            else if (stats.tps >= 35) { speedQuality = 'Hızlı'; speedColor = '#38bdf8'; }
            else if (stats.tps < 15) { speedQuality = 'Yavaş'; speedColor = '#f43f5e'; }

            const sxEsc = (s) => (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');

            listEl.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px;">
                    <span style="color:#94a3b8;">İlk Yanıt Süresi (TTFT):</span>
                    <span style="color:#f8fafc;font-family:ui-monospace,monospace;font-weight:600;">${stats.ttftMs} ms <span style="color:#64748b;font-size:11px;">(${ttftSec}s)</span></span>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px;">
                    <span style="color:#94a3b8;">Hız (Token / Saniye):</span>
                    <span style="color:${speedColor};font-family:ui-monospace,monospace;font-weight:700;">${stats.tps} TPS <span style="color:#64748b;font-size:11px;">(${speedQuality})</span></span>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px;">
                    <span style="color:#94a3b8;">Son Üretilen Token:</span>
                    <span style="color:#f8fafc;font-family:ui-monospace,monospace;font-weight:600;">~${stats.completionTokens} tok</span>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px;">
                    <span style="color:#94a3b8;">Toplam Akış Süresi:</span>
                    <span style="color:#f8fafc;font-family:ui-monospace,monospace;font-weight:600;">${stats.totalMs} ms <span style="color:#64748b;font-size:11px;">(${totalSec}s)</span></span>
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;font-size:11.5px;margin-top:4px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06);">
                    <span style="color:#64748b;">Ölçülen Model:</span>
                    <span style="color:#cbd5e1;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${sxEsc(stats.modelName || '')}">${sxEsc(stats.modelName || '')}</span>
                </div>
                ${(stats.normalTokens != null || stats.thinkingTokens != null) ? `<div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px;color:#a3e635;"><span>Normal / Thinking (tok):</span><span style="font-family:ui-monospace,monospace;font-weight:600;">${stats.normalTokens || 0} / ${stats.thinkingTokens || 0}</span></div>` : ''}
                ${(stats.promptTokens > 0 || stats.outputTokens > 0) ? `<div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px;color:#38bdf8;"><span>Prompt / Output (gerçek):</span><span style="font-family:ui-monospace,monospace;font-weight:600;">${stats.promptTokens || 0} / ${stats.outputTokens || 0}</span></div>` : ''}
                ${(stats.toolCalls > 0) ? `<div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px;color:#fb923c;"><span>Araç çağrısı:</span><span style="font-family:ui-monospace,monospace;font-weight:600;">${stats.toolCalls} (${(stats.toolCallNames || []).slice(0,3).join(', ')})</span></div>` : ''}
                ${(stats.stopReason) ? `<div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px;color:#f472b6;"><span>Stop reason:</span><span style="font-family:ui-monospace,monospace;font-weight:600;">${stats.stopReason}</span></div>` : ''}
            `;
        };

        this._currentRenderFn = renderPerfDetails;

        const cached = this.getLatestStats(cleanConvId);
        if (cached) renderPerfDetails(cached);

        this.fetchPerfStats(cleanConvId).then(stats => {
            if (pop.isConnected && stats) renderPerfDetails(stats);
        });
    }

    updatePerfButtonUI() {
        const perfBtn = document.getElementById('sx-perf-btn');
        if (!perfBtn) return;
        const convKey = this.models.getActiveConversationKey();
        const cleanConvId = (convKey || '').replace(/^conv_/, '');
        const stats = this.getLatestStats(cleanConvId);

        // Live state while the model is streaming (ticks every 1.2s via interval)
        let liveSuffix = '';
        try {
            const elapsed = window.SX_SDK?.quota?.streamElapsedSec?.() || 0;
            const streaming = elapsed > 0;
            if (streaming) liveSuffix = ` • Üretiliyor… (${elapsed}sn)`;
        } catch(e) {}

        if (stats && stats.ttftMs) {
            perfBtn.title = `Model Performansı: ${stats.tps || 0} TPS, TTFT ${stats.ttftMs}ms (Tıkla)${liveSuffix}`;
        } else {
            perfBtn.title = `Model Performansı (TTFT, TPS) (Tıkla)${liveSuffix}`;
        }
    }
}
