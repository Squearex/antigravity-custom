/**
 * SX Core SDK - PerfMonitor
 * Tracks real-time LLM inference performance: TTFT, TPS, and total response stream latency.
 */
export class PerfMonitor {
    constructor(networkClient, modelManager, logger) {
        this.network = networkClient;
        this.models = modelManager;
        this.logger = logger;
        this._perfStatsCache = {};
    }

    init() {
        document.addEventListener('click', (e) => {
            const perfPop = document.getElementById('sx-perf-popover');
            if (perfPop && !perfPop.contains(e.target) && !e.target.closest('#sx-perf-btn')) {
                perfPop.remove();
                const pBtn = document.getElementById('sx-perf-btn');
                if (pBtn) pBtn.classList.remove('sx-active');
            }
        });
    }

    async fetchPerfStats(convId) {
        const stats = await this.network.fetchPerfStats(convId || '');
        if (stats) {
            this._perfStatsCache[convId || 'new'] = stats;
            return stats;
        }
        return this._perfStatsCache[convId || 'new'] || null;
    }

    togglePerfPopover(anchorEl) {
        let pop = document.getElementById('sx-perf-popover');
        if (pop) {
            pop.remove();
            if (anchorEl) anchorEl.classList.remove('sx-active');
            return;
        }

        const convKey = this.models.getActiveConversationKey();
        const cleanConvId = (convKey || '').replace(/^conv_/, '');

        if (anchorEl) anchorEl.classList.add('sx-active');

        pop = document.createElement('div');
        pop.id = 'sx-perf-popover';
        pop.style.cssText = `
            position: fixed;
            width: 310px;
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
        const popLeft = Math.max(10, Math.min(window.innerWidth - 330, rect.left - 20));
        pop.style.left = popLeft + 'px';
        pop.style.bottom = (window.innerHeight - rect.top + 8) + 'px';

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
        };

        const renderPerfDetails = (stats) => {
            const listEl = pop.querySelector('#sx-perf-items-list');
            const tpsBadge = pop.querySelector('#sx-perf-tps-badge');
            if (!listEl) return;

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

            const ttftSec = (stats.ttftMs / 1000).toFixed(2);
            const totalSec = (stats.totalMs / 1000).toFixed(2);

            let speedQuality = 'Normal';
            let speedColor = '#eab308';
            if (stats.tps >= 40) { speedQuality = 'Çok Hızlı'; speedColor = '#10b981'; }
            else if (stats.tps >= 20) { speedQuality = 'Hızlı'; speedColor = '#38bdf8'; }
            else if (stats.tps < 10) { speedQuality = 'Yavaş'; speedColor = '#f43f5e'; }

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
                    <span style="color:#94a3b8;">Üretilen Token:</span>
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
            `;
        };

        const cached = this._perfStatsCache[cleanConvId] || this._perfStatsCache['new'];
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
        const stats = this._perfStatsCache[cleanConvId] || this._perfStatsCache['new'];

        if (stats && stats.ttftMs) {
            perfBtn.title = `Model Performansı: ${stats.tps || 0} TPS, TTFT ${stats.ttftMs}ms (Tıkla)`;
        } else {
            perfBtn.title = 'Model Performansı (TTFT, TPS) (Tıkla)';
        }
    }
}
