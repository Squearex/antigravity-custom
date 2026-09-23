/**
 * SX Core SDK - PerfMonitor
 * Tracks real-time LLM inference performance: TTFT, TPS, and accurate token count per message.
 * Ensures EACH message displays its OWN distinct performance metrics right next to its timestamp.
 */
import { attachPopoverAboveChat } from '../ui/floatingAnchor.js';

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
                // Debounced: streaming fires mutations per chunk; rescan at most ~2.5/s
                if (this._obsTimer) return;
                this._obsTimer = setTimeout(() => {
                    this._obsTimer = null;
                    const convKey = this.models?.getActiveConversationKey();
                    const cleanConvId = (convKey || '').replace(/^conv_/, '');
                    this.fetchPerfStats(cleanConvId).then(() => {
                        this.injectMetricsToMessageFooters();
                    });
                }, 200);
            });
            this._observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        } catch(e) {}

        setInterval(() => {
            const convKey = this.models?.getActiveConversationKey();
            const cleanConvId = (convKey || '').replace(/^conv_/, '');
            this.fetchPerfStats(cleanConvId).then(() => {
                this.injectMetricsToMessageFooters();
                this.updatePerfButtonUI();
            });
        }, 2000);
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
    getStatsForMessage(footerEl, isLastMessage = false, indexFromEnd = 0, convId = '') {
        this._pruneStoredStats();
        const sig = this.getMessageSignature(footerEl);
        if (sig) {
            try {
                const saved = localStorage.getItem('sx_msg_perf_' + sig);
                if (saved) {
                    const parsed = JSON.parse(saved);
                    // Only trust entries that came from real measurements with real data
                    if (parsed && parsed.measured === true && (parsed.tps > 0 || parsed.ttftMs > 0 || parsed.completionTokens > 0)) {
                        return parsed;
                    }
                }
            } catch(e) {}
        }

        // 1. If this is the newly generated message and we have live streaming stats waiting
        if (isLastMessage && this._latestLivePerf && (this._latestLivePerf.tps > 0 || this._latestLivePerf.ttftMs > 0 || this._latestLivePerf.completionTokens > 0)) {
            const live = { ...this._latestLivePerf, measured: true };
            this._latestLivePerf = null;
            if (sig) {
                try {
                    localStorage.setItem('sx_msg_perf_' + sig, JSON.stringify(live));
                } catch(e) {}
            }
            return live;
        }

        // 2. Match from convPerfHistory (reverse chronological index)
        const cleanConvId = (convId || this.models?.getActiveConversationKey() || '').replace(/^conv_/, '');
        if (!cleanConvId || cleanConvId === 'new' || cleanConvId === 'draft') return null;
        const hist = this._perfHistory[cleanConvId] || [];
        if (Array.isArray(hist) && hist.length > 0) {
            const histIdx = hist.length - 1 - indexFromEnd;
            if (histIdx >= 0 && hist[histIdx]) {
                const item = hist[histIdx];
                if (item && (item.tps > 0 || item.ttftMs > 0 || item.completionTokens > 0)) {
                    const measured = { ...item, measured: true };
                    if (sig) {
                        try {
                            localStorage.setItem('sx_msg_perf_' + sig, JSON.stringify(measured));
                        } catch(e) {}
                    }
                    return measured;
                }
            }
        }

        // 3. Fallback for the latest message: use latest stats cache
        if (isLastMessage) {
            const latest = this.getLatestStats(cleanConvId);
            if (latest && (latest.tps > 0 || latest.ttftMs > 0 || latest.completionTokens > 0)) {
                const measured = { ...latest, measured: true };
                if (sig) {
                    try {
                        localStorage.setItem('sx_msg_perf_' + sig, JSON.stringify(measured));
                    } catch(e) {}
                }
                return measured;
            }
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
        if (!cleanConvId || cleanConvId === 'new' || cleanConvId === 'draft') return;
        const measured = { ...perfData, measured: true };
        this._perfStatsCache[cleanConvId] = measured;
        this._latestLivePerf = measured;
        // Rolling history for per-conversation averages
        try {
            if (!this._perfHistory[cleanConvId]) this._perfHistory[cleanConvId] = [];
            this._perfHistory[cleanConvId].push(measured);
            if (this._perfHistory[cleanConvId].length > 20) this._perfHistory[cleanConvId].splice(0, this._perfHistory[cleanConvId].length - 20);
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
        if (clean && clean !== 'new' && clean !== 'draft' && this._perfStatsCache[clean]) {
            return this._perfStatsCache[clean];
        }
        return null;
    }

    async fetchPerfStats(convId) {
        try {
            const cleanConvId = (convId || '').replace(/^conv_/, '');
            if (!cleanConvId || cleanConvId === 'new') return null;
            const raw = await this.network.fetchPerfStats(cleanConvId);
            const stats = raw?.stats || raw;
            if (raw?.history && Array.isArray(raw.history)) {
                this._perfHistory[cleanConvId] = raw.history;
            }
            if (stats && (stats.ttftMs || stats.tps || stats.completionTokens)) {
                const measured = { ...stats, measured: true };
                this._perfStatsCache[cleanConvId] = measured;
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
            if (this._lastScanTs && (now - this._lastScanTs < 300)) return;
            this._lastScanTs = now;

            const convKey = this.models?.getActiveConversationKey();
            const cleanConvId = (convKey || '').replace(/^conv_/, '');

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

            // Only target assistant message footers (avoiding prompt/user bubbles)
            const validFooters = footers.filter(footerEl => {
                const timeText = footerEl.childNodes[0]?.textContent?.trim() || footerEl.textContent?.trim() || '';
                return /\b\d{1,2}:\d{2}\b/.test(timeText) && !footerEl.closest('.items-end');
            });
            if (validFooters.length === 0) return;

            validFooters.forEach((footerEl, idx) => {
                const isLast = (idx === validFooters.length - 1);
                const indexFromEnd = validFooters.length - 1 - idx;
                const stats = this.getStatsForMessage(footerEl, isLast, indexFromEnd, cleanConvId);

                // Never display unmeasured dummy zeroes
                if (!stats || (!stats.tps && !stats.ttftMs && !stats.completionTokens)) {
                    const existingBadge = footerEl.querySelector('.sx-msg-perf-metrics');
                    if (existingBadge && existingBadge.getAttribute('data-measured') !== 'true') {
                        existingBadge.remove();
                    }
                    return;
                }

                const ttftSec = stats.ttftMs ? (stats.ttftMs / 1000).toFixed(2) : '--';
                const ttftStr = stats.ttftMs ? (stats.ttftMs >= 1000 ? `${ttftSec}s` : `${stats.ttftMs}ms`) : '--ms';
                const tpsStr = (stats.tps != null && stats.tps > 0) ? stats.tps : 0;
                const tokDisp = stats.completionTokens ? `~${stats.completionTokens} tok` : (stats.outputTokens ? `~${stats.outputTokens} tok` : '--');
                const splitStr = (stats.thinkingTokens != null && stats.thinkingTokens > 0) ? ` (${stats.thinkingTokens}T)` : '';
                const durVal = stats.totalMs || stats.generationMs || stats.durationMs;
                const durStr = durVal ? `${(durVal / 1000).toFixed(1)}s` : '';

                let speedColor = '#10b981';
                if (stats.tps < 15) speedColor = '#f43f5e';
                else if (stats.tps < 35) speedColor = '#eab308';
                else if (stats.tps < 60) speedColor = '#38bdf8';

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
                        background: rgba(255, 255, 255, 0.04);
                        border: 1px solid rgba(255, 255, 255, 0.08);
                        padding: 2px 7px;
                        border-radius: 6px;
                        cursor: default;
                        transition: background-color 0.15s ease;
                    `;
                    footerEl.appendChild(badge);
                }

                badge.setAttribute('data-measured', 'true');
                const tooltipTitle = [
                    `Model: ${stats.modelName || 'Active Model'}`,
                    `İnferans Hızı: ${tpsStr} Token/Saniye`,
                    `İlk Yanıt (TTFT): ${stats.ttftMs || 0}ms`,
                    `Üretilen: ${stats.completionTokens || 0} token${stats.thinkingTokens ? ` (${stats.thinkingTokens} düşünce)` : ''}`,
                    stats.promptTokens ? `İstem (Prompt): ~${stats.promptTokens} token` : '',
                    durStr ? `Toplam Süre: ${durStr}` : '',
                    stats.toolCalls ? `Araç Çağrısı: ${stats.toolCalls}` : '',
                    stats.stopReason ? `Bitiş: ${stats.stopReason}` : ''
                ].filter(Boolean).join('\n');

                badge.title = tooltipTitle;
                badge.innerHTML = `
                    <span style="color: ${speedColor}; font-weight: 700;">⚡ ${tpsStr} TPS</span>
                    <span style="color: rgba(255,255,255,0.25); font-size: 9px;">•</span>
                    <span style="color: #38bdf8; font-weight: 600;">⏱️ ${ttftStr}</span>
                    <span style="color: rgba(255,255,255,0.25); font-size: 9px;">•</span>
                    <span style="color: rgba(255,255,255,0.85);">📊 ${tokDisp}${splitStr}</span>
                    ${durStr ? `<span style="color: rgba(255,255,255,0.25); font-size: 9px;">•</span><span style="color: rgba(255,255,255,0.6);">⏳ ${durStr}</span>` : ''}
                `;
            });
        } catch(e) {}
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
            background: hsl(var(--popover, var(--card, 222 47% 11%)));
            border: 1px solid hsl(var(--border, rgba(255, 255, 255, 0.12)));
            border-radius: 12px;
            box-shadow: 0 10px 30px -4px rgba(0, 0, 0, 0.45), 0 4px 12px -2px rgba(0, 0, 0, 0.25);
            padding: 15px 17px;
            z-index: 100000;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: hsl(var(--popover-foreground, var(--foreground, #f1f5f9)));
            box-sizing: border-box;
            user-select: none;
            backdrop-filter: blur(20px);
        `;

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
        attachPopoverAboveChat(anchorEl, pop, { placement: 'top-start', gap: 10 });

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
        if (cached) {
            renderPerfDetails(cached);
        } else {
            renderPerfDetails(null);
        }

        if (cleanConvId && cleanConvId !== 'new' && cleanConvId !== 'draft') {
            this.fetchPerfStats(cleanConvId).then(stats => {
                if (pop.isConnected && stats) renderPerfDetails(stats);
            });
        }
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
