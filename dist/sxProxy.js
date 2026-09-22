const http = require('http');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let inMemoryConfig = { providers: [], models: [] };
let currentActiveModelId = null;
let convModels = {}; // convKey -> modelId
let convPerfStats = {}; // convKey -> { ttftMs, totalMs, completionTokens, tps, modelName, timestamp }
let _dbgLastStats = null; // last request debug stats

// Session memory: modelKey -> last known working history budget after a context overflow.
// Prevents repeating the same oversized request within one proxy lifetime.
const learnedHistoryBudget = {};

// Detect upstream "context too big" rejections across vendors/gateways.
const CONTEXT_OVERFLOW_RE = /context|too many tokens|maximum context|context_length|context length|input.*too (long|large)|prompt.*too long|token.*(limit|exceed)|exceed.*token|too_large|request.*too large/i;
function isContextOverflow(status, text) {
    if (status === 413) {
        // Groq / some gateways use 413 for rate limits (ITPM / token/min), not context overflow
        const rateKeywords = /ITPM|input tokens per minute|rate_limit_exceeded|rate limit|per minute/i;
        if (rateKeywords.test(String(text || '').slice(0, 500))) return false;
        return true;
    }
    if (status !== 400 && status !== 422) return false;
    return CONTEXT_OVERFLOW_RE.test(String(text || '').slice(0, 2000));
}

// Only a first-attempt TTFB timeout is retried once (likely gateway queue);
// total timeouts and network errors surface immediately.
function isRetryableFetchTimeout(err, attempt) {
    return attempt === 0 && !!err && err.code === 'SX_TTFB_TIMEOUT';
}

const SX_PROXY_BUILD = '2026.09.22-r13';

// Tolerant JSON body parsing: strips BOM/whitespace some clients prepend.
// Returns null instead of throwing.
function parseJsonBody(raw) {
    try {
        const s = String(raw == null ? '' : raw).replace(/^\uFEFF/, '').trim();
        if (!s) return null;
        return JSON.parse(s);
    } catch(e) {
        return null;
    }
}

// Upstream watchdog: free-tier gateways can queue/hang forever leaving the UI
// stuck on "Working". TTFB aborts when no response headers arrive in time;
// total timer bounds the whole attempt including long streams.
const SX_TTFB_TIMEOUT_MS = 300000;
const SX_TOTAL_TIMEOUT_MS = 12 * 60 * 1000;
async function fetchUpstream(url, opts, timeouts) {
    const ctrl = new AbortController();
    let totalFired = false, ttfbFired = false;
    const ttfbMs = (timeouts && timeouts.ttfbMs) || SX_TTFB_TIMEOUT_MS;
    const totalMs = (timeouts && timeouts.totalMs) || SX_TOTAL_TIMEOUT_MS;
    const ttfbTimer = setTimeout(() => { ttfbFired = true; try { ctrl.abort(); } catch(e){} }, ttfbMs);
    const totalTimer = setTimeout(() => { totalFired = true; try { ctrl.abort(); } catch(e){} }, totalMs);
    const done = () => { clearTimeout(ttfbTimer); clearTimeout(totalTimer); };
    try {
        const res = await fetch(url, { ...opts, signal: ctrl.signal });
        clearTimeout(ttfbTimer);
        return { res, done };
    } catch (e) {
        done();
        if (ttfbFired && !totalFired) {
            const err = new Error('Upstream zaman aşımı: 5 dakika içinde yanıt başlamadı (gateway kuyruğu ya da sunucu yanıt vermiyor).');
            err.code = 'SX_TTFB_TIMEOUT'; throw err;
        }
        if (totalFired) {
            const err = new Error('Upstream zaman aşımı: toplam 12 dakika doldu.');
            err.code = 'SX_TOTAL_TIMEOUT'; throw err;
        }
        throw e;
    }
}

// Ingress log: proves whether a chat request reached the proxy (last 200 hits).
function logHit(entry) {
    try {
        const p = path.join(app.getPath('userData'), 'sx_proxy_hits.jsonl');
        let lines = [];
        if (fs.existsSync(p)) {
            lines = fs.readFileSync(p, 'utf8').split('\n').filter(l => l.trim()).slice(-199);
        }
        lines.push(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
        fs.writeFileSync(p, lines.join('\n'), 'utf8');
    } catch(e) {}
}

// Completion log: records how each chat request ENDED (done/error/timeout) so
// stuck subagents can be diagnosed per conversation.
function logDone(entry) {
    try {
        logHit({ event: 'done', ...entry });
    } catch(e) {}
}

// Live context-ring support: per-conversation generated chars while streaming,
// and the last post-trim sent size (what the model actually received).
const streamProgress = {}; // convKey -> { chars, ts }
const lastSentEstimate = {}; // convKey -> { tokens, model, ts, history: [last 10] }
// Generic LRU-ish cap for per-conversation maps (prevents unbounded growth).
function capMapSize(obj, max, protect) {
    try {
        const keys = Object.keys(obj).filter(k => k !== protect);
        if (keys.length > max) {
            for (let i = 0; i < keys.length - max; i++) delete obj[keys[i]];
        }
    } catch(e){}
}
function recordSentEstimate(convKey, tokens, model) {
    if (!convKey || !(tokens > 0)) return;
    try {
        const prev = lastSentEstimate[convKey];
        const history = Array.isArray(prev?.history) ? prev.history.slice(-9) : [];
        history.push(Math.round(tokens));
        lastSentEstimate[convKey] = { tokens: Math.round(tokens), model: model || '?', ts: Date.now(), history };
        capMapSize(lastSentEstimate, 60);
    } catch(e){}
}
function bumpStreamProgress(convKey, chars) {
    if (!convKey || !chars) return;
    try {
        const p = streamProgress[convKey] || { chars: 0 };
        if (!p.firstTs) p.firstTs = Date.now();
        p.chars += chars; p.ts = Date.now();
        streamProgress[convKey] = p;
    } catch(e){}
}

// Agent loop breaker: models sometimes call the same tool with identical args
// over and over (e.g. view_file with bad params), burning the whole context.
// Completed tool calls are tracked per conversation; on 5 consecutive identical
const LOOP_GUARD_THRESHOLD = 5;
const LOOP_GUARD_REWARN_EVERY = 10;
const READ_ONLY_TOOLS = new Set([
    'view_file', 'grep_search', 'list_dir', 'find_by_name',
    'read_url_content', 'list_files', 'read_file', 'manage_subagents', 'read_command',
    'search_web', 'get_metadata', 'list_functions', 'list_strings'
]);
const MODIFYING_TOOLS = new Set([
    'write_to_file', 'replace_file_content', 'run_command', 'privileged-command',
    'write_file', 'delete_files', 'copy_file', 'rename_files', 'server_command'
]);
const loopGuardCalls = {}; // convKey -> [{ key, ts }] (capped)
const loopGuardPending = {}; // convKey -> { name, args, count, type }
const loopGuardReadOnlyCounts = {}; // convKey -> number
function toolCallKey(name, argsStr) {
    const a = String(argsStr || '');
    return String(name || '') + '|' + (a.length > 500 ? a.slice(0, 500) : a);
}
function recordToolCall(convKey, name, argsStr) {
    if (!convKey || !name) return null;
    try {
        const toolNameStr = String(name);
        if (MODIFYING_TOOLS.has(toolNameStr)) {
            loopGuardReadOnlyCounts[convKey] = 0;
        } else if (READ_ONLY_TOOLS.has(toolNameStr)) {
            const rCount = (loopGuardReadOnlyCounts[convKey] || 0) + 1;
            loopGuardReadOnlyCounts[convKey] = rCount;
            if (rCount >= 10 && rCount % 5 === 0) {
                loopGuardPending[convKey] = {
                    name: 'read_only_loop',
                    args: `${toolNameStr} (art arda ${rCount} okuma)`,
                    count: rCount,
                    type: 'readonly'
                };
                console.warn(`[SX PROXY] Loop breaker: ${rCount} consecutive read-only calls on ${convKey} — nudge queued`);
            }
        }

        const key = toolCallKey(name, argsStr);
        if (!loopGuardCalls[convKey]) loopGuardCalls[convKey] = [];
        const arr = loopGuardCalls[convKey];
        arr.push({ key, ts: Date.now() });
        if (arr.length > 50) arr.splice(0, arr.length - 50);
        capMapSize(loopGuardCalls, 100);
        capMapSize(loopGuardPending, 100);
        const tail = arr.slice(-LOOP_GUARD_THRESHOLD);
        if (tail.length === LOOP_GUARD_THRESHOLD && tail.every(e => e.key === key)) {
            const total = arr.reduce((n, e) => n + (e.key === key ? 1 : 0), 0);
            if (total === LOOP_GUARD_THRESHOLD || (total > LOOP_GUARD_THRESHOLD && (total - LOOP_GUARD_THRESHOLD) % LOOP_GUARD_REWARN_EVERY === 0)) {
                loopGuardPending[convKey] = { name: toolNameStr, args: String(argsStr || '').slice(0, 300), count: total, type: 'identical' };
                console.warn(`[SX PROXY] Loop breaker: '${name}' x${total} identical calls on ${convKey} — nudge queued`);
                return { loop: true, key, name, count: total };
            }
        }
    } catch(e){}
    return null;
}
function makeLoopNudge(name, argsStr, count, type) {
    if (type === 'readonly' || name === 'read_only_loop') {
        return `[Sistem Uyarısı: Arka arkaya ${count} kez sadece dosya okuma/arama yaptın ama hiçbir kod düzenlemesi veya komut çalıştırma yapmadın. Dosyaları tekrar tekrar okuma/arama döngüsünü DERHAL DURDUR. Elindeki bilgiler yeterlidir; hemen write_to_file veya replace_file_content kullanarak kod değişikliklerini yap veya kullanıcıya doğrudan yanıt ver!]`;
    }
    const shortArgs = String(argsStr || '').slice(0, 300);
    return `[Sistem Uyarısı: '${name}' aracını aynı parametrelerle art arda ${count} kez çağırdın ve ilerleme yok — bu bir döngü. Aynı çağrıyı tekrarlama. Şunları dene: (1) bir önceki hata mesajındaki parametreyi düzelt, (2) önce listele/ara araçlarıyla doğru yolu bul, (3) farklı bir dosya ya da yönteme geç. Parametreler: ${shortArgs}]`;
}

// ── Intent rescue for vacuous continuations ───────────────────────────────
// When history gets trimmed, a bare "Continue"/"devam" loses its referent and
// the model replies "isteğiniz görünmüyor". Detect vacuous last messages and,
// if trimming actually dropped turns, re-inject the last substantive user
// intent so the model can continue without asking the user to repeat.
const VACUOUS_RE = /^(continue|devam|devam et|sürdür|go on|carry on|proceed|go ahead|do it|yap|ok|okay|okey|tamam|evet|yes|yeah|aynen|olur|hadi|please continue|lütfen devam et)[.!.…]*$/i;
function isVacuousContinuation(text) {
    try {
        const t = String(text || '').trim();
        if (!t || t.length > 30) return false;
        return VACUOUS_RE.test(t);
    } catch(e) { return false; }
}
function getTurnText(c) {
    try {
        const parts = c?.parts || [];
        return parts
            .filter(p => typeof p.text === 'string')
            .filter(p => !p.text.startsWith('[Otomatik Bağlam Özeti]') && !p.text.startsWith('[Sistem Uyarısı'))
            .map(p => p.text).join('\n').trim();
    } catch(e) { return ''; }
}
function findLastSubstantiveUser(contents) {
    try {
        if (!Array.isArray(contents)) return null;
        for (let i = contents.length - 1; i >= 0; i--) {
            const c = contents[i];
            if (!c || (c.role !== 'user' && c.role !== 'human')) continue;
            const t = getTurnText(c);
            if (!t || t.length < 120 || isVacuousContinuation(t)) continue;
            return t.slice(0, 1500);
        }
    } catch(e) {}
    return null;
}
function makeIntentReminder(substantive) {
    return `[Bağlam Hatırlatması: geçmiş kırpıldığı için son isteğin tam görünmüyor olabilir. Kullanıcının önceki somut isteği: "${substantive}" — buna göre kaldığın yerden devam et; gerçekten emin değilsen tek kısa soru sor.]`;
}

// ── Automatic context compaction (professional fix for full context) ──────
// When history exceeds the budget, the evicted middle is summarized with the
// same provider/model (one cheap non-streaming call) and the summary is pinned:
// [first turn (goal)] + [rolling summary] + [last K turns].
// The on-disk transcript keeps growing, but the model always receives a working
// set: nothing forgotten (knowledge lives in the summary), never stops.
// Re-summarizes only after substantial new growth; any failure falls back to
// the previous plain-trim behavior without breaking the chat.
const COMPACT_KEEP_LAST = 10;
const COMPACT_MIN_EVICT_CHARS = 12000;
const COMPACT_GROWTH_THRESHOLD = 20000;
const COMPACT_SUMMARY_MAX_OUT = 2500;
const COMPACT_INPUT_MAX_CHARS = 24000;
const COMPACT_SUMMARY_MARKER = '[Otomatik Bağlam Özeti]';
const compactState = {}; // convKey -> { summary, coveredChars, ts }
let compactStateLoaded = false;

function getCompactStateFile() { try { return path.join(app.getPath('userData'), 'sx_compact_state.json'); } catch(e){ return ''; } }
function loadCompactState() {
    if (compactStateLoaded) return;
    compactStateLoaded = true;
    try {
        const p = getCompactStateFile();
        if (p && fs.existsSync(p)) {
            const data = JSON.parse(fs.readFileSync(p, 'utf8')) || {};
            for (const k of Object.keys(data)) {
                if (data[k] && typeof data[k].summary === 'string') compactState[k] = data[k];
            }
        }
    } catch(e){}
}
function saveCompactState() {
    try {
        const p = getCompactStateFile();
        if (!p) return;
        const keys = Object.keys(compactState).slice(-100);
        const out = {};
        for (const k of keys) out[k] = compactState[k];
        fs.writeFileSync(p, JSON.stringify(out), 'utf8');
    } catch(e){}
}
function stripSummaryNotes(contents) {
    if (!Array.isArray(contents)) return contents;
    return contents.filter(c => {
        const parts = c?.parts || [];
        return !parts.some(p => typeof p.text === 'string' && p.text.startsWith(COMPACT_SUMMARY_MARKER));
    });
}
function turnToText(c, idx) {
    const role = (c?.role === 'model' || c?.role === 'assistant') ? 'Asistan' : 'Kullanıcı';
    const bits = [];
    for (const p of (c?.parts || [])) {
        if (typeof p.text === 'string' && p.text.trim()) bits.push(p.text.slice(0, 2000));
        else if (p.functionCall) bits.push(`[Araç çağrısı: ${p.functionCall.name || '?'}(${JSON.stringify(p.functionCall.args || {}).slice(0, 500)})]`);
        else if (p.functionResponse) {
            const r = typeof p.functionResponse.response === 'string' ? p.functionResponse.response : JSON.stringify(p.functionResponse.response || '');
            bits.push(`[Araç sonucu: ${r.slice(0, 1200)}]`);
        }
    }
    if (!bits.length) return '';
    return `--- Adım ${idx} (${role}) ---\n${bits.join('\n').slice(0, 4000)}`;
}
function extractSummaryText(data, proto) {
    try {
        if (proto === 'anthropic') {
            const blocks = data?.content || [];
            const t = blocks.filter(b => b.type === 'text' && b.text).map(b => b.text).join('\n');
            if (t.trim()) return t.trim().slice(0, 12000);
        } else {
            const t = data?.choices?.[0]?.message?.content || '';
            if (String(t).trim()) return String(t).trim().slice(0, 12000);
        }
    } catch(e){}
    return '';
}
async function summarizeForCompaction(provider, modelId, inputText, prevSummary) {
    const proto = (provider?.protocol || 'openai').toLowerCase();
    const cleanBase = String(provider?.baseUrl || '').replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '');
    if (!cleanBase || !modelId) throw new Error('no provider/model for summarizer');
    const sysPrompt = 'Aşağıdaki uzun bir yapay zeka asistanı sohbet geçmişidir. Sohbete kaldığı yerden devam edebilmek için kompakt bir bağlam özeti çıkar. Şu başlıkları kullan: (1) Amaç, (2) Alınan kararlar, (3) Yapılan işler ve dokunulan dosyalar, (4) Karşılaşılan hatalar ve çözümleri, (5) Güncel durum ve sonraki adım. Gereksiz detayı at, dosya yollarını ve kritik kod kararlarını koru. Yanıtı konuşmanın ana dilinde yaz, en fazla ~2500 token.';
    const userText = (prevSummary ? `ÖNCEKİ ÖZET (bunu güncelle, baştan yazma):\n${prevSummary.slice(0, 6000)}\n\n` : '') + `ÖZETLENECEK BÖLÜM:\n${inputText}`;
    let url, headers, body;
    if (proto === 'anthropic') {
        url = cleanBase + '/v1/messages';
        headers = { 'Content-Type': 'application/json', 'x-api-key': provider.apiKey || '', 'anthropic-version': '2023-06-01' };
        body = JSON.stringify({ model: modelId, max_tokens: COMPACT_SUMMARY_MAX_OUT, system: sysPrompt, messages: [{ role: 'user', content: userText }] });
    } else {
        url = cleanBase + '/chat/completions';
        headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (provider.apiKey || '') };
        body = JSON.stringify({ model: modelId, max_tokens: COMPACT_SUMMARY_MAX_OUT, stream: false, messages: [{ role: 'system', content: sysPrompt }, { role: 'user', content: userText }] });
    }
    const up = await fetchUpstream(url, { method: 'POST', headers, body }, null, { ttfbMs: 120000, totalMs: 300000 });
    try {
        const data = await up.res.json();
        return extractSummaryText(data, proto);
    } finally {
        try { up.done(); } catch(e){}
    }
}
function pinSummary(working, summary) {
    if (!working.length) return working;
    return [working[0], { role: 'user', parts: [{ text: `${COMPACT_SUMMARY_MARKER}\n${summary}` }] }, ...working.slice(1)];
}
async function autoCompactWithSummary(contents, budget, ctx) {
    loadCompactState();
    const convKey = ctx?.convKey || null;
    const working = stripSummaryNotes(Array.isArray(contents) ? contents : []);
    if (!working.length) return compactContentsForContext(contents, budget);
    const st = convKey ? compactState[convKey] : null;
    if (working.length <= COMPACT_KEEP_LAST + 2) {
        return compactContentsForContext(st?.summary ? pinSummary(working, st.summary) : working, budget);
    }
    const totalChars = estimateContentChars(working);
    const summaryChars = st?.summary ? st.summary.length + 200 : 0;
    // Fits already (with room for a pinned summary)? Just pin and trim normally.
    if (totalChars + summaryChars <= Math.max(30000, (budget - 6000) * 3.5)) {
        return compactContentsForContext(st?.summary ? pinSummary(working, st.summary) : working, budget);
    }
    const lastTurns = working.slice(-COMPACT_KEEP_LAST);
    // Growth gate: reuse stored summary unless the transcript grew substantially.
    const covered = st?.coveredChars || 0;
    if (st?.summary && totalChars < covered + COMPACT_GROWTH_THRESHOLD) {
        return compactContentsForContext([working[0], { role: 'user', parts: [{ text: `${COMPACT_SUMMARY_MARKER}\n${st.summary}` }] }, ...lastTurns], budget);
    }
    // Need (re)summarization of the middle turns between first and last K.
    const middle = working.slice(1, -COMPACT_KEEP_LAST);
    const middleChars = estimateContentChars(middle);
    if (middleChars < COMPACT_MIN_EVICT_CHARS) {
        return compactContentsForContext(st?.summary ? pinSummary(working, st.summary) : working, budget);
    }
    // NON-BLOCKING: answer NOW with plain trim; summarize in background for NEXT
    // requests so no message ever waits on the summarizer (Gemini-style: instant).
    if (convKey && !summarizeInFlight[convKey]) {
        const lastFail = summarizeCooldown[convKey] || 0;
        if (Date.now() - lastFail > 60000) {
            summarizeInFlight[convKey] = Date.now();
            const texts = [];
            let acc = 0;
            for (let i = 0; i < middle.length && acc < COMPACT_INPUT_MAX_CHARS; i++) {
                const t = turnToText(middle[i], i + 1);
                if (!t) continue;
                texts.push(t);
                acc += t.length;
            }
            const inputSlice = texts.join('\n\n').slice(0, COMPACT_INPUT_MAX_CHARS);
            const prevSum = st?.summary || '';
            const prov = ctx.provider, mid = ctx.modelId, covChars = totalChars;
            summarizeForCompaction(prov, mid, inputSlice, prevSum).then(summary => {
                delete summarizeInFlight[convKey];
                if (summary && summary.length > 200) {
                    compactState[convKey] = { summary, coveredChars: covChars, ts: Date.now() };
                    saveCompactState();
                    console.log(`[SX PROXY] Context compacted (bg) for ${convKey}: ${middleChars} chars -> ${summary.length} chars summary`);
                } else {
                    summarizeCooldown[convKey] = Date.now();
                }
            }).catch(e => {
                delete summarizeInFlight[convKey];
                summarizeCooldown[convKey] = Date.now();
                console.warn('[SX PROXY] Background summarization failed:', e.message);
            });
        }
    }
    return compactContentsForContext(st?.summary ? pinSummary(working, st.summary) : working, budget);
}

const summarizeInFlight = {}; // convKey -> start timestamp (at most one bg summarizer per conv)
const summarizeCooldown = {}; // convKey -> last failure timestamp (retry at most every 60s)

function getConvPerfFile() {
    try {
        return path.join(app.getPath('userData'), 'sx_conv_perf.json');
    } catch(e) { return ''; }
}

function saveConvPerfToDisk() {
    try {
        const p = getConvPerfFile();
        if (p) fs.writeFileSync(p, JSON.stringify(convPerfStats), 'utf8');
    } catch(e) {}
}

function loadConvPerfFromDisk() {
    try {
        const p = getConvPerfFile();
        if (p && fs.existsSync(p)) {
            convPerfStats = JSON.parse(fs.readFileSync(p, 'utf8')) || {};
        }
    } catch(e) {}
}

// Per-message perf history: convKey -> [last 30 msgPerf entries].
// convPerfStats keeps only the LAST message (compat); this keeps EVERY message
// with normal/thinking split, tool calls, prompt tokens and finish reason.
const convPerfHistory = {}; // convKey -> [{...msgPerf}]
function getConvPerfHistoryFile() {
    try {
        return path.join(app.getPath('userData'), 'sx_conv_perf_history.json');
    } catch(e) { return ''; }
}
function saveConvPerfHistoryToDisk() {
    try {
        const p = getConvPerfHistoryFile();
        if (p) fs.writeFileSync(p, JSON.stringify(convPerfHistory), 'utf8');
    } catch(e) {}
}
function loadConvPerfHistoryFromDisk() {
    try {
        const p = getConvPerfHistoryFile();
        if (p && fs.existsSync(p)) {
            const raw = JSON.parse(fs.readFileSync(p, 'utf8')) || {};
            for (const k of Object.keys(raw)) {
                if (Array.isArray(raw[k])) convPerfHistory[k] = raw[k].slice(-30);
            }
        }
    } catch(e) {}
}
// Shared chars->tokens estimate for text (matches transcript math).
function sxEstToks(chars) { return Math.max(0, Math.round((Number(chars) || 0) / 3.5)); }
// Finalize + store one message's perf. promptEstTokens falls back to the
// pre-request sent estimate when no real upstream usage arrived.
function recordMsgPerf(convKey, entry, promptEstTokens) {
    try {
        const e = { ...(entry || {}) };
        if (!(e.promptTokens > 0) && promptEstTokens > 0) {
            e.promptTokens = Math.round(promptEstTokens);
            e.promptEstimated = true;
        }
        if (!convKey) {
            convPerfStats['last'] = { ...(convPerfStats['last'] || {}), ...e };
            saveConvPerfToDisk();
            return e;
        }
        if (!convPerfHistory[convKey]) convPerfHistory[convKey] = [];
        convPerfHistory[convKey].push(e);
        if (convPerfHistory[convKey].length > 30) convPerfHistory[convKey].splice(0, convPerfHistory[convKey].length - 30);
        capMapSize(convPerfHistory, 60);
        // Compat: last-message slots keep the full detail object too
        convPerfStats[convKey] = e;
        convPerfStats['last'] = e;
        capMapSize(convPerfStats, 60, 'last');
        saveConvPerfToDisk();
        saveConvPerfHistoryToDisk();
    } catch(err) {}
    return entry;
}

function dbgLog(obj) {
    try {
        _dbgLastStats = { ...obj, ts: new Date().toISOString() };
        const p = path.join(app.getPath('userData'), 'sx_debug_last.json');
        fs.writeFileSync(p, JSON.stringify(_dbgLastStats, null, 2), 'utf8');
    } catch(e) {}
}

function getConvModelsFile() {
    try {
        return path.join(app.getPath('userData'), 'sx_conv_models.json');
    } catch(e) { return ''; }
}

function saveConvModelsToDisk() {
    try {
        const p = getConvModelsFile();
        if (p) fs.writeFileSync(p, JSON.stringify(convModels), 'utf8');
    } catch(e) { console.error('[SX Proxy] Error saving conv models:', e); }
}

function loadConvModelsFromDisk() {
    try {
        const p = getConvModelsFile();
        if (p && fs.existsSync(p)) {
            convModels = JSON.parse(fs.readFileSync(p, 'utf8')) || {};
            console.log('[SX PROXY] Restored conv models from disk:', Object.keys(convModels).length, 'conversations');
        }
        loadConvPerfFromDisk();
        loadConvPerfHistoryFromDisk();
    } catch(e) { console.error('[SX Proxy] Error loading conv models:', e); }
}

function getConfigFile() {
    try {
        return path.join(app.getPath('userData'), 'sx_custom_models.json');
    } catch(e) {
        return '';
    }
}

function getActiveModelFile() {
    try {
        return path.join(app.getPath('userData'), 'sx_active_model.json');
    } catch(e) {
        return '';
    }
}

let lastUsedModelId = null;

function loadActiveModelFromDisk() {
    try {
        const p = getActiveModelFile();
        if (p && fs.existsSync(p)) {
            const raw = fs.readFileSync(p, 'utf8');
            const data = JSON.parse(raw);
            if (data && data.activeModelId) {
                currentActiveModelId = data.activeModelId;
                console.log('[SX PROXY] Restored active model from disk:', currentActiveModelId);
            }
            if (data && data.lastUsedModelId) {
                lastUsedModelId = data.lastUsedModelId;
            }
        }
    } catch(e) {
        console.error('[SX Proxy] Error reading active model:', e);
    }
}

function saveActiveModelToDisk(modelId) {
    try {
        const p = getActiveModelFile();
        if (p) {
            if (modelId) lastUsedModelId = modelId;
            fs.writeFileSync(p, JSON.stringify({ activeModelId: currentActiveModelId || modelId, lastUsedModelId: lastUsedModelId || modelId }), 'utf8');
        }
    } catch(e) {
        console.error('[SX Proxy] Error saving active model:', e);
    }
}

// Resolve a stored conv-model ref (string id or {id,providerId,modelId} object)
// against the current model list; survives list rebuilds.
function findModelByRef(ref) {
    try {
        const list = inMemoryConfig.models || [];
        if (!ref || !list.length) return null;
        if (typeof ref === 'string') {
            return list.find(m => m.id === ref) || null;
        }
        if (ref.id) {
            const byId = list.find(m => m.id === ref.id);
            if (byId) return byId;
        }
        if (ref.providerId && ref.modelId) {
            const byPair = list.find(m => m.providerId === ref.providerId && m.modelId === ref.modelId);
            if (byPair) return byPair;
        }
        if (ref.modelId) {
            return list.find(m => m.modelId === ref.modelId) || null;
        }
    } catch(e) {}
    return null;
}

function loadConfigFromDisk() {
    try {
        const p = getConfigFile();
        if (p && fs.existsSync(p)) {
            const raw = fs.readFileSync(p, 'utf8');
            const data = JSON.parse(raw);
            if (Array.isArray(data.providers)) inMemoryConfig.providers = data.providers;
            if (Array.isArray(data.models)) inMemoryConfig.models = data.models;
        }
        loadActiveModelFromDisk();
        loadConvModelsFromDisk();
    } catch(e) {
        console.error('[SX Proxy] Error reading saved config:', e);
    }
}

function saveConfigToDisk() {
    try {
        const p = getConfigFile();
        if (p) {
            fs.writeFileSync(p, JSON.stringify(inMemoryConfig, null, 2), 'utf8');
        }
    } catch(e) {
        console.error('[SX Proxy] Error writing saved config:', e);
    }
}

function convertGeminiSchema(schema) {
    if (!schema || typeof schema !== 'object') return schema;
    const typeMap = {
        'OBJECT': 'object',
        'STRING': 'string',
        'NUMBER': 'number',
        'INTEGER': 'integer',
        'BOOLEAN': 'boolean',
        'ARRAY': 'array'
    };
    const res = Array.isArray(schema) ? [] : {};
    for (const [k, v] of Object.entries(schema)) {
        if (k === 'type' && typeof v === 'string') {
            res[k] = typeMap[v.toUpperCase()] || v.toLowerCase();
        } else if (v && typeof v === 'object') {
            res[k] = convertGeminiSchema(v);
        } else {
            res[k] = v;
        }
    }
    return res;
}

function convertGeminiToolsToOpenAI(tools) {
    if (!tools || !Array.isArray(tools)) return undefined;
    const otools = [];
    for (const tg of tools) {
        for (const decl of (tg.functionDeclarations || [])) {
            otools.push({
                type: 'function',
                function: {
                    name: decl.name,
                    description: decl.description || '',
                    parameters: convertGeminiSchema(decl.parameters || { type: 'object', properties: {} })
                }
            });
        }
    }
    return otools.length ? otools : undefined;
}

function convertGeminiToolsToAnthropic(tools) {
    if (!tools || !Array.isArray(tools)) return undefined;
    const atools = [];
    for (const tg of tools) {
        for (const decl of (tg.functionDeclarations || [])) {
            const params = convertGeminiSchema(decl.parameters || { type: 'object', properties: {} });
            if (!params.type) params.type = 'object';
            atools.push({
                name: decl.name,
                description: decl.description || '',
                input_schema: params
            });
        }
    }
    return atools.length ? atools : undefined;
}

function estimateContentChars(contents) {
    let chars = 0;
    for (const c of contents) {
        for (const p of (c.parts || [])) {
            if (p.text) chars += p.text.length;
            if (p.functionCall) chars += JSON.stringify(p.functionCall).length;
            if (p.functionResponse) chars += JSON.stringify(p.functionResponse).length;
        }
    }
    return chars;
}

// Post-conversion token trimmer for OpenAI messages.
// maxTokens here is the HISTORY budget (model limit minus system/tools overhead).
// We exclude the system message from the budget because it was already subtracted upstream.
function trimOpenAIMessages(messages, maxTokens) {
    if (!Array.isArray(messages) || messages.length === 0) return messages;

    function msgChars(m) {
        let c = 0;
        if (typeof m.content === 'string') c += m.content.length;
        else if (Array.isArray(m.content)) c += m.content.reduce((s, it) => s + (it.text || it.content || JSON.stringify(it) || '').length, 0);
        if (m.tool_calls) c += JSON.stringify(m.tool_calls).length;
        return c;
    }

    // Separate system message — its cost is already deducted in historyTokenBudget
    const systemMsgs = messages.filter(m => m.role === 'system');
    const nonSystem = messages.filter(m => m.role !== 'system');

    // Balanced token estimation: code & structured text averages ~2.6 chars/token.
    const CHARS_PER_TOKEN = 2.6;
    const budgetChars = Math.max(20000, Math.floor((maxTokens - 4000) * CHARS_PER_TOKEN));

    function totalNonSysChars(msgs) {
        return msgs.reduce((s, m) => s + msgChars(m), 0);
    }

    const currentNonSysChars = totalNonSysChars(nonSystem);
    console.log(`[SX PROXY TRIM] Checking history: ${currentNonSysChars} chars (~${Math.round(currentNonSysChars / CHARS_PER_TOKEN)} tok), budget: ${budgetChars} chars (~${maxTokens} tok)`);

    if (currentNonSysChars <= budgetChars) return messages; // fits, nothing to do

    console.log(`[SX PROXY TRIM] Trimming required! Current ${currentNonSysChars} chars exceeds budget ${budgetChars} chars.`);

    // Pass 1: Prune oversized tool results in older turns (keep last 12 turns intact, cap older to 8000 ch with head/tail preservation)
    const cloned = JSON.parse(JSON.stringify(nonSystem));
    const recentStart = Math.max(0, cloned.length - 12);
    for (let i = 0; i < cloned.length; i++) {
        const m = cloned[i];
        if (m.role === 'tool' && i < recentStart) {
            const cap = 8000;
            const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
            if (c.length > cap) {
                const head = c.slice(0, Math.floor(cap * 0.7));
                const tail = c.slice(-Math.floor(cap * 0.3));
                cloned[i] = { ...m, content: `${head}\n…[${c.length - cap} karakter özetlendi]…\n${tail}` };
            }
        }
    }

    if (totalNonSysChars(cloned) <= budgetChars) {
        console.log(`[SX PROXY TRIM] Pass 1 tool pruning sufficient: ${totalNonSysChars(cloned)} chars <= ${budgetChars}`);
        return sanitizeOpenAIMessages([...systemMsgs, ...cloned]);
    }

    // Pass 2: Atomically remove oldest turns without breaking tool_call <-> tool pairs
    let rest = [...cloned];
    let dropped = 0;
    while (rest.length > 3 && totalNonSysChars(rest) > budgetChars) {
        // Find the oldest droppable turn
        let removeIndices = [];
        for (let i = 0; i < rest.length; i++) {
            const m = rest[i];
            if (m.role === 'user') {
                removeIndices = [i];
                break;
            } else if (m.role === 'assistant') {
                // If assistant has tool calls, gather all corresponding subsequent tool responses
                if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
                    const callIds = new Set(m.tool_calls.map(tc => tc.id));
                    removeIndices = [i];
                    for (let j = i + 1; j < rest.length; j++) {
                        if (rest[j].role === 'tool' && callIds.has(rest[j].tool_call_id)) {
                            removeIndices.push(j);
                        } else if (rest[j].role !== 'tool') {
                            break;
                        }
                    }
                } else {
                    removeIndices = [i];
                }
                break;
            } else if (m.role === 'tool') {
                // Orphaned tool response at the beginning: drop it
                removeIndices = [i];
                break;
            }
        }

        if (removeIndices.length === 0) break;
        // Sort descending so splice indices remain stable
        removeIndices.sort((a, b) => b - a);
        for (const idx of removeIndices) {
            rest.splice(idx, 1);
            dropped++;
        }
    }

    if (dropped > 0) {
        console.log(`[SX PROXY TRIM] Pass 2 removed ${dropped} old msgs safely. Remaining: ${rest.length} (~${Math.round(totalNonSysChars(rest) / CHARS_PER_TOKEN)} tok est.)`);
        rest.unshift({ role: 'user', content: `[Sistem: Context sınırı (${maxTokens} token) nedeniyle ${dropped} eski mesaj otomatik kaldırıldı. Son bağlam korundu.]` });
    }

    const combined = [...systemMsgs, ...rest];
    // Final safety guarantee: ensure every tool_call has a response and no orphan tools remain
    return sanitizeOpenAIMessages(combined);
}

function compactContentsForContext(contents, maxTokens = 131072) {
    if (!contents || !Array.isArray(contents) || contents.length <= 4) return contents;
    
    // Reserve 6000 tokens for system prompt, generation budget, and tools
    const maxChars = Math.max(30000, (maxTokens - 6000) * 3.5);
    let currentChars = estimateContentChars(contents);
    if (currentChars <= maxChars) {
        return contents;
    }

    console.log(`[SX PROXY COMPACT] History (${currentChars} chars) exceeds budget (${Math.round(maxChars)} chars for ${maxTokens} tok). Starting auto-compaction...`);

    const cloned = JSON.parse(JSON.stringify(contents));

    // Pass 1: Prune oversized tool outputs in historical turns (>8000 chars) and recent turns (>30000 chars)
    const recentThreshold = Math.max(0, cloned.length - 10);
    for (let i = 0; i < cloned.length; i++) {
        const limit = (i < recentThreshold) ? 8000 : 30000;
        const c = cloned[i];
        for (const p of (c.parts || [])) {
            if (p.functionResponse) {
                const fr = p.functionResponse;
                let rawResp = typeof fr.response === 'string' ? fr.response : JSON.stringify(fr.response || '');
                if (rawResp.length > limit) {
                    const head = rawResp.slice(0, Math.floor(limit * 0.7));
                    const tail = rawResp.slice(-Math.floor(limit * 0.3));
                    const pruned = `${head}\n... [Önceki araç çıktısı context tasarrufu için özetlendi (${rawResp.length} karakter)] ...\n${tail}`;
                    fr.response = typeof fr.response === 'string' ? pruned : { output: pruned };
                }
            }
        }
    }

    currentChars = estimateContentChars(cloned);
    if (currentChars <= maxChars) {
        console.log(`[SX PROXY COMPACT] Pass 1 pruned tool outputs down to ${currentChars} chars. Fits within budget.`);
        return cloned;
    }

    // Pass 2: Atomic sliding window - remove turns in pairs (user + assistant) to never orphan tool_calls
    const keepHead = cloned.slice(0, 1);
    let middleAndRecent = cloned.slice(1);
    
    while (middleAndRecent.length > 4 && estimateContentChars([...keepHead, ...middleAndRecent]) > maxChars) {
        middleAndRecent.splice(0, 2);
    }

    const droppedCount = cloned.length - 1 - middleAndRecent.length;
    let finalContents = [...keepHead];
    if (droppedCount > 0) {
        finalContents.push({
            role: 'user',
            parts: [{
                text: `[Sistem Notu: Konuşma geçmişinin ara kısımları (${droppedCount} adım) context sınırını aşmamak için güvenle kaydırıldı. İlk hedef ve en son adımlar aşağıdadır.]`
            }]
        });
    }
    finalContents = finalContents.concat(middleAndRecent);
    console.log(`[SX PROXY COMPACT] Pass 2 sliding window applied: ${finalContents.length} turns, ${estimateContentChars(finalContents)} chars.`);
    return finalContents;
}

function sanitizeOpenAIMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return [{ role: 'user', content: 'Hello' }];

    const cleaned = [];
    let lastAssistantWithTools = null;
    const answeredCalls = new Set();

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];

        if (msg.role === 'tool') {
            const cid = msg.tool_call_id;
            const validPreceding = lastAssistantWithTools && 
                                   Array.isArray(lastAssistantWithTools.tool_calls) && 
                                   lastAssistantWithTools.tool_calls.some(tc => tc.id === cid);

            if (!validPreceding) {
                // Orphaned tool response: convert to regular user message to avoid HTTP 400
                const contentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
                cleaned.push({
                    role: 'user',
                    content: `[Önceki Araç Yanıtı]: ${contentStr}`
                });
                continue;
            }

            answeredCalls.add(cid);
            cleaned.push(msg);
        } else {
            // Before advancing to a non-tool message, ensure any preceding assistant tool_calls have responses
            if (lastAssistantWithTools && Array.isArray(lastAssistantWithTools.tool_calls)) {
                for (const tc of lastAssistantWithTools.tool_calls) {
                    if (!answeredCalls.has(tc.id)) {
                        cleaned.push({
                            role: 'tool',
                            tool_call_id: tc.id,
                            content: '(araç yanıtı context optimizasyonu için özetlendi)'
                        });
                        answeredCalls.add(tc.id);
                    }
                }
                lastAssistantWithTools = null;
                answeredCalls.clear();
            }

            if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
                lastAssistantWithTools = msg;
                answeredCalls.clear();
            } else {
                lastAssistantWithTools = null;
            }

            cleaned.push(msg);
        }
    }

    // Trailing assistant tool_calls check
    if (lastAssistantWithTools && Array.isArray(lastAssistantWithTools.tool_calls)) {
        for (const tc of lastAssistantWithTools.tool_calls) {
            if (!answeredCalls.has(tc.id)) {
                cleaned.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    content: '(araç yanıtı hazırlandı)'
                });
            }
        }
    }

    // Guarantee at least one valid non-system message
    const nonSystem = cleaned.filter(m => m.role !== 'system');
    if (nonSystem.length === 0) {
        cleaned.push({ role: 'user', content: 'Hello' });
    }

    return cleaned;
}

function sanitizeAnthropicMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return [{ role: 'user', content: 'Hello' }];
    // Pass 1: normalize string user content to blocks so roles can merge
    const normalized = messages.map(msg => {
        if (msg && msg.role === 'user' && typeof msg.content === 'string') {
            return { role: 'user', content: [{ type: 'text', text: msg.content }] };
        }
        return msg;
    });
    // Pass 2: merge consecutive same-role messages (Anthropic requires alternation)
    const merged = [];
    for (const msg of normalized) {
        const prev = merged[merged.length - 1];
        if (prev && msg && prev.role === msg.role && Array.isArray(prev.content) && Array.isArray(msg.content)) {
            prev.content = prev.content.concat(msg.content);
        } else {
            merged.push(msg);
        }
    }
    // Pass 3: drop orphan tool_results (existing pairing logic)
    const cleaned = [];
    const pendingUses = new Set();

    for (const msg of merged) {
        if (msg.role === 'assistant') {
            if (Array.isArray(msg.content)) {
                msg.content.forEach(it => {
                    if (it.type === 'tool_use' && it.id) pendingUses.add(it.id);
                });
            }
            cleaned.push(msg);
        } else if (msg.role === 'user') {
            if (Array.isArray(msg.content)) {
                const safeItems = [];
                msg.content.forEach(it => {
                    if (it.type === 'tool_result') {
                        if (pendingUses.has(it.tool_use_id)) {
                            pendingUses.delete(it.tool_use_id);
                            safeItems.push(it);
                        } else {
                            safeItems.push({ type: 'text', text: `[Araç Sonucu]: ${it.content || ''}` });
                        }
                    } else {
                        safeItems.push(it);
                    }
                });
                cleaned.push({ role: 'user', content: safeItems.length ? safeItems : [{ type: 'text', text: 'Ok' }] });
            } else {
                cleaned.push(msg);
            }
        } else {
            cleaned.push(msg);
        }
    }
    // Pass 4: first message must be user role (Anthropic requirement)
    if (cleaned.length && cleaned[0].role !== 'user') {
        cleaned.unshift({ role: 'user', content: [{ type: 'text', text: 'Devam et' }] });
    }
    return cleaned.length ? cleaned : [{ role: 'user', content: 'Hello' }];
}

function geminiContentsToOpenAI(contents, systemText) {
    const messages = [];
    if (systemText && systemText.trim()) {
        messages.push({ role: 'system', content: systemText.trim() });
    }
    let callIdCounter = 0;
    const pendingCallIds = {};

    for (const c of contents) {
        const parts = c.parts || [];
        const textParts = [];
        const toolCalls = [];
        const toolResponses = [];

        for (const p of parts) {
            if (p.text) {
                if (p.thought) continue;
                textParts.push(p.text);
            } else if (p.functionCall) {
                const fc = p.functionCall;
                const fname = fc.name || 'tool';
                const fargs = fc.args || {};
                callIdCounter++;
                const cid = fc.id || `call_${callIdCounter}_${fname.slice(0, 10)}`;
                (pendingCallIds[fname] = pendingCallIds[fname] || []).push(cid);
                toolCalls.push({
                    id: cid,
                    type: 'function',
                    function: {
                        name: fname,
                        arguments: typeof fargs === 'string' ? fargs : JSON.stringify(fargs)
                    }
                });
            } else if (p.functionResponse) {
                const fr = p.functionResponse;
                const fname = fr.name || 'tool';
                const fresp = fr.response || {};
                const q = pendingCallIds[fname];
                const cid = fr.id || (Array.isArray(q) ? (q.shift() || `call_${fname}`) : (q || `call_${fname}`));
                toolResponses.push({
                    role: 'tool',
                    tool_call_id: cid,
                    content: typeof fresp === 'string' ? fresp : JSON.stringify(fresp)
                });
            }
        }

        for (const tr of toolResponses) {
            messages.push(tr);
        }

        const role = (c.role === 'model' || c.role === 'assistant') ? 'assistant' : 'user';
        if (toolCalls.length > 0 || (textParts.length > 0 && role === 'assistant')) {
            const msg = { role: 'assistant' };
            if (textParts.length > 0) msg.content = textParts.join('');
            if (toolCalls.length > 0) msg.tool_calls = toolCalls;
            messages.push(msg);
        } else if (textParts.length > 0) {
            messages.push({ role: 'user', content: textParts.join('') });
        }
    }

    if (messages.length === 0 || (messages.length === 1 && messages[0].role === 'system')) {
        messages.push({ role: 'user', content: 'Hello' });
    }
    return messages;
}

function geminiContentsToAnthropic(contents) {
    const messages = [];
    let callIdCounter = 0;
    const pendingCallIds = {};

    for (const c of contents) {
        const parts = c.parts || [];
        const assistantItems = [];
        const userItems = [];
        const toolResults = [];

        for (const p of parts) {
            if (p.text) {
                if (p.thought) continue;
                if (c.role === 'model' || c.role === 'assistant') {
                    assistantItems.push({ type: 'text', text: p.text });
                } else {
                    userItems.push({ type: 'text', text: p.text });
                }
            } else if (p.functionCall) {
                const fc = p.functionCall;
                const fname = fc.name || 'tool';
                const fargs = fc.args || {};
                callIdCounter++;
                const cid = fc.id || `call_${callIdCounter}_${fname.slice(0, 10)}`;
                (pendingCallIds[fname] = pendingCallIds[fname] || []).push(cid);
                assistantItems.push({
                    type: 'tool_use',
                    id: cid,
                    name: fname,
                    input: typeof fargs === 'object' && fargs !== null ? fargs : {}
                });
            } else if (p.functionResponse) {
                const fr = p.functionResponse;
                const fname = fr.name || 'tool';
                const fresp = fr.response || {};
                const q = pendingCallIds[fname];
                const cid = fr.id || (Array.isArray(q) ? (q.shift() || `call_${fname}`) : (q || `call_${fname}`));
                toolResults.push({
                    type: 'tool_result',
                    tool_use_id: cid,
                    content: typeof fresp === 'string' ? fresp : JSON.stringify(fresp)
                });
            }
        }

        if (assistantItems.length > 0) {
            messages.push({ role: 'assistant', content: assistantItems });
        }
        if (toolResults.length > 0) {
            messages.push({ role: 'user', content: toolResults });
        }
        if (userItems.length > 0) {
            messages.push({ role: 'user', content: userItems });
        }
    }

    if (messages.length === 0) {
        messages.push({ role: 'user', content: 'Hello' });
    }
    return messages;
}

function loadTranscriptContents(convId) {
    const homedir = require('os').homedir();
    const candidates = [
        path.join(homedir, '.gemini-custom', 'antigravity-custom', 'brain', convId, '.system_generated', 'logs', 'transcript.jsonl'),
        path.join(homedir, '.gemini', 'antigravity', 'brain', convId, '.system_generated', 'logs', 'transcript.jsonl')
    ];
    let filePath = '';
    for (const c of candidates) {
        if (fs.existsSync(c)) { filePath = c; break; }
    }
    if (!filePath) return [];

    // Stat cache: skip re-reading/parsing multi-MB transcripts when unchanged.
    // Always return a copy — callers may push notes into the array.
    try {
        const st = fs.statSync(filePath);
        const hit = transcriptCache[filePath];
        if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.contents.slice();
    } catch(e) {}
    const parsed = parseTranscriptFile(filePath);
    try {
        const st = fs.statSync(filePath);
        transcriptCache[filePath] = { size: st.size, mtimeMs: st.mtimeMs, contents: parsed };
        const keys = Object.keys(transcriptCache);
        if (keys.length > 50) delete transcriptCache[keys[0]];
    } catch(e) {}
    return parsed.slice();
}

const transcriptCache = {}; // filePath -> { size, mtimeMs, contents }

function parseTranscriptFile(filePath) {
    try {
        const lines = fs.readFileSync(filePath, 'utf8').split('\n');
        const contents = [];
        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const d = JSON.parse(line);
                const typ = d.type;
                const content = d.content;
                const tool_calls = d.tool_calls || [];
                if (typ === 'USER_INPUT') {
                    let text = content || '';
                    if (text.includes('<USER_REQUEST>')) {
                        try { text = text.split('<USER_REQUEST>')[1].split('</USER_REQUEST>')[0].trim(); } catch(e) {}
                    }
                    contents.push({ role: 'user', parts: [{ text }] });
                } else if (typ === 'PLANNER_RESPONSE') {
                    const parts = [];
                    for (const tc of tool_calls) {
                        parts.push({
                            functionCall: {
                                name: tc.name,
                                args: tc.args || {}
                            }
                        });
                    }
                    if (content && !tool_calls.length) {
                        parts.push({ text: content });
                    }
                    if (parts.length) {
                        contents.push({ role: 'model', parts });
                    }
                } else if (typ === 'GENERIC') {
                    let lastCallName = 'tool';
                    if (contents.length && contents[contents.length - 1].role === 'model') {
                        const lastParts = contents[contents.length - 1].parts || [];
                        for (const p of lastParts) {
                            if (p.functionCall) lastCallName = p.functionCall.name || 'tool';
                        }
                    }
                    contents.push({
                        role: 'user',
                        parts: [{
                            functionResponse: {
                                name: lastCallName,
                                response: { output: content || '' }
                            }
                        }]
                    });
                }
            } catch(e) {}
        }
        return contents;
    } catch(e) {
        return [];
    }
}

let internalProxyServer = null;

function startInternalProxy() {
    loadConfigFromDisk();

    if (internalProxyServer && internalProxyServer.listening) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        const server = http.createServer(async (req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', '*');
            res.setHeader('Access-Control-Allow-Headers', '*');
            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }

            const url = req.url || '';
            console.log('[SX PROXY REQ]', req.method, url);

            // GET /sx/quota-status — basic rate-limit / usage hint for UI
            if (url === '/sx/quota-status' && req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ ok: true, status: 'ok', note: '429 durumunda günlük kota dolmuştur — farklı model veya yarın deneyin.' }));
                return;
            }

            // Endpoint to get config from proxy / disk
            if (url === '/sx/get-config' && req.method === 'GET') {
                loadConfigFromDisk();
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify(inMemoryConfig));
                return;
            }

            // Endpoint to receive config updates from renderer UI
            if (url === '/sx/update-config' && req.method === 'POST') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', () => {
                    try {
                        const parsed = parseJsonBody(body);
                        if (!parsed) throw new Error('Invalid JSON body');
                        // Guard: never accidentally wipe disk config with empty payload
                        if ((!parsed.models || !parsed.models.length) && (!parsed.providers || !parsed.providers.length) && (inMemoryConfig.models.length > 0 || inMemoryConfig.providers.length > 0) && !parsed.forceClear) {
                            console.warn('[SX PROXY] Ignored accidental empty config update from UI to protect saved models.');
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ ok: true, ignored: true }));
                            return;
                        }
                        if (Array.isArray(parsed.providers)) inMemoryConfig.providers = parsed.providers;
                        if (Array.isArray(parsed.models)) inMemoryConfig.models = parsed.models;
                        saveConfigToDisk();
                        console.log('[SX PROXY] Config updated from UI:', inMemoryConfig.models.length, 'models,', inMemoryConfig.providers.length, 'providers');
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: true }));
                    } catch(e) {
                        console.error('[SX PROXY] Failed to parse config update:', e);
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON: ' + e.message }));
                    }
                });
                return;
            }

            if (url === '/sx/set-active-model' && req.method === 'POST') {
                let rawBody = '';
                req.on('data', chunk => rawBody += chunk);
                req.on('end', () => {
                    try {
                        const data = parseJsonBody(rawBody);
                        if (!data) throw new Error('Invalid JSON body');
                        if (data.modelId) {
                            currentActiveModelId = data.modelId;
                            saveActiveModelToDisk(currentActiveModelId);
                            // Also save per-conversation mapping if convKey provided.
                            // Stored enriched (id+provider+model) so bindings survive list rebuilds.
                            if (data.convKey && data.convKey !== 'conv_global') {
                                convModels[data.convKey] = (data.meta && data.meta.modelId)
                                    ? { id: data.modelId, providerId: data.meta.providerId || '', modelId: data.meta.modelId }
                                    : data.modelId;
                                capMapSize(convModels, 200);
                                saveConvModelsToDisk();
                                console.log(`[SX PROXY] Conv model saved: ${data.convKey} -> ${data.modelId}`);
                            }
                            console.log('[SX PROXY] Active model updated:', currentActiveModelId);
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                        res.end(JSON.stringify({ ok: true, activeModelId: currentActiveModelId }));
                    } catch(e) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: e.message }));
                    }
                });
                return;
            }

            if (url === '/sx/get-conv-models' && req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ ok: true, convModels, activeModelId: currentActiveModelId, lastUsedModelId: lastUsedModelId || currentActiveModelId || null }));
                return;
            }

            // Version advertisement for renderer self-update checks
            if (url === '/sx/versions' && req.method === 'GET') {
                let injectBuild = '', injectMtime = 0;
                try {
                    const ip = path.join(__dirname, 'sx-inject.js');
                    const st = fs.statSync(ip);
                    injectMtime = st.mtimeMs || 0;
                    const full = fs.readFileSync(ip, 'utf8');
                    const m = full.match(/var SX_BUILD\s*=\s*["']([^"']+)["']/);
                    if (m) injectBuild = m[1];
                } catch(e) {}
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ ok: true, proxyBuild: SX_PROXY_BUILD, injectBuild, injectMtime }));
                return;
            }

            if (url === '/sx/debug-stats' && req.method === 'GET') {
                let stats = _dbgLastStats;
                try {
                    const p = path.join(app.getPath('userData'), 'sx_debug_last.json');
                    if (fs.existsSync(p)) stats = JSON.parse(fs.readFileSync(p, 'utf8'));
                } catch(e) {}
                let guard = {};
                try {
                    guard = {
                        loopTrackedConvs: Object.keys(loopGuardCalls).length,
                        loopPending: Object.keys(loopGuardPending).length,
                        compactConvs: Object.keys(compactState).length,
                        streamingNow: Object.keys(streamProgress).length,
                    };
                } catch(e) {}
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({ ok: true, stats, guard }));
                return;
            }

            // Per-conversation context overview (main chat + subagents) for the context UI.
            if (url === '/sx/get-all-contexts' && req.method === 'GET') {
                try {
                    loadConfigFromDisk();
                    const homedir = require('os').homedir();
                    const roots = [
                        path.join(homedir, '.gemini-custom', 'antigravity-custom', 'brain'),
                        path.join(homedir, '.gemini', 'antigravity', 'brain')
                    ];
                    const seen = {};
                    const nowTs = Date.now();
                    const consider = (id, mtimeMs) => {
                        if (!id || seen[id]) {
                            if (id && mtimeMs && (!seen[id] || mtimeMs > seen[id].mtime)) seen[id] = { mtime: mtimeMs };
                            return;
                        }
                        seen[id] = { mtime: mtimeMs || 0 };
                    };
                    for (const root of roots) {
                        try {
                            if (!fs.existsSync(root)) continue;
                            const dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory());
                            for (const d of dirs.slice(0, 60)) {
                                let mt = 0;
                                try { mt = fs.statSync(path.join(root, d.name)).mtimeMs || 0; } catch(e) {}
                                consider(d.name, mt);
                            }
                        } catch(e) {}
                    }
                    for (const k of Object.keys(convModels)) consider(String(k).replace(/^conv_/, ''), 0);
                    for (const k of Object.keys(streamProgress)) consider(String(k).replace(/^conv_/, ''), nowTs);
                    for (const k of Object.keys(lastSentEstimate)) consider(String(k).replace(/^conv_/, ''), 0);
                    const ids = Object.keys(seen).sort((a, b) => (seen[b].mtime || 0) - (seen[a].mtime || 0)).slice(0, 25);
                    const convs = ids.map(id => {
                        let turns = 0, estTok = 0;
                        try {
                            const contents = loadTranscriptContents(id);
                            turns = contents.length;
                            estTok = Math.round(estimateContentChars(contents) / 3.5);
                        } catch(e) {}
                        let modelId = '', modelName = '', ctx = 0;
                        try {
                            const m = inMemoryConfig.models.find(x => x.id === convModels['conv_' + id]);
                            if (m) {
                                modelId = m.id || ''; modelName = m.name || m.modelId || '';
                                if (Number(m.contextLength) > 0) ctx = Number(m.contextLength);
                            }
                        } catch(e) {}
                        const sp = streamProgress['conv_' + id];
                        const streaming = !!(sp && (nowTs - sp.ts < 15000));
                        return { id, modelId, modelName, ctx, turns, estTok, mtime: seen[id].mtime || 0, streaming };
                    });
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ ok: true, convs }));
                } catch(e) {
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ ok: false, convs: [] }));
                }
                return;
            }

            if (url === '/sx/update-context-limit' && req.method === 'POST') {
                let rawBody = '';
                req.on('data', chunk => rawBody += chunk);
                req.on('end', () => {
                    try {
                        const data = JSON.parse(rawBody);
                        const { modelId, contextLength } = data;
                        let found = false;
                        if (modelId && Number(contextLength) > 0) {
                            inMemoryConfig.models.forEach(m => {
                                if (m.id === modelId || m.modelId === modelId) {
                                    m.contextLength = Number(contextLength);
                                    found = true;
                                    console.log(`[SX PROXY] Set contextLength for ${m.name} -> ${m.contextLength}`);
                                }
                            });
                            if (found) {
                                saveConfigToDisk();
                            }
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                        res.end(JSON.stringify({ ok: true, found, contextLength: Number(contextLength) }));
                    } catch(e) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: e.message }));
                    }
                });
                return;
            }

            if (url.startsWith('/sx/get-chat-tokens') && req.method === 'GET') {
                try {
                    const u = new URL('http://localhost' + url);
                    const convId = u.searchParams.get('convId') || '';
                    let charCount = 0;
                    let turnCount = 0;
                    if (convId) {
                        const contents = loadTranscriptContents(convId);
                        turnCount = contents.length;
                        charCount = estimateContentChars(contents);
                    }
                    const estTokens = Math.round(charCount / 3.5);
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ ok: true, convId, charCount, turnCount, estTokens }));
                } catch(e) {
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ ok: false, estTokens: 0 }));
                }
                return;
            }

            if (url.startsWith('/sx/get-stream-progress') && req.method === 'GET') {
                try {
                    const u = new URL('http://localhost' + url);
                    const convId = (u.searchParams.get('convId') || '').replace(/^conv_/, '');
                    const p = streamProgress['conv_' + convId];
                    const age = p ? (Date.now() - p.ts) : 999999;
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ ok: true, streaming: !!p && age < 15000, genTokens: p ? Math.round(p.chars / 3.5) : 0, ageMs: age }));
                } catch(e) {
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ ok: false, streaming: false, genTokens: 0 }));
                }
                return;
            }

            if (url.startsWith('/sx/get-sent-estimate') && req.method === 'GET') {
                try {
                    const u = new URL('http://localhost' + url);
                    const convId = (u.searchParams.get('convId') || '').replace(/^conv_/, '');
                    const s = lastSentEstimate['conv_' + convId] || null;
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ ok: true, sent: s }));
                } catch(e) {
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ ok: false, sent: null }));
                }
                return;
            }

            if (url.startsWith('/sx/get-chat-context-details') && req.method === 'GET') {
                try {
                    const u = new URL('http://localhost' + url);
                    const convId = u.searchParams.get('convId') || '';
                    const cleanConvId = (convId || '').replace(/^conv_/, '');
                    const convKey = 'conv_' + cleanConvId;
                    const queryModelId = u.searchParams.get('modelId') || '';

                    loadConfigFromDisk();
                    // convModels values may be enriched refs -> resolve robustly
                    let targetModel = null;
                    if (!queryModelId && convKey && convModels[convKey]) {
                        targetModel = findModelByRef(convModels[convKey]);
                    }
                    if (!targetModel) {
                        const modelId = queryModelId || currentActiveModelId || '';
                        if (modelId) targetModel = inMemoryConfig.models.find(m => m.id === modelId || m.modelId === modelId);
                    }
                    if (!targetModel && currentActiveModelId) {
                        targetModel = inMemoryConfig.models.find(m => m.id === currentActiveModelId || m.modelId === currentActiveModelId);
                    }
                    if (!targetModel) targetModel = inMemoryConfig.models[0];

                    const totalContext = targetModel?.contextLength ? Number(targetModel.contextLength) : 262144;

                    let msgChars = 0;
                    let toolChars = 0;

                    const homedir = require('os').homedir();
                    const brainDirs = [
                        path.join(homedir, '.gemini-custom', 'antigravity-custom', 'brain'),
                        path.join(homedir, '.gemini', 'antigravity', 'brain')
                    ];
                    let filePath = '';

                    const isNewOrEmpty = (!cleanConvId || cleanConvId === 'new' || cleanConvId === 'draft' || cleanConvId === 'global');

                    if (!isNewOrEmpty) {
                        for (const bDir of brainDirs) {
                            const p = path.join(bDir, cleanConvId, '.system_generated', 'logs', 'transcript.jsonl');
                            if (fs.existsSync(p)) { filePath = p; break; }
                        }
                    }

                    // Strict per-conversation mode: NEVER fall back to subdirs[0]!
                    // If isNewOrEmpty or file does not exist, it's a new or fresh chat with 0 messages.

                    let detectedModelId = null;
                    if (filePath && fs.existsSync(filePath)) {
                        const lines = fs.readFileSync(filePath, 'utf8').split('\n');
                        for (const l of lines) {
                            if (!l.trim()) continue;
                            try {
                                const d = JSON.parse(l);
                                if (d.content && typeof d.content === 'string') {
                                    const mMatch = d.content.match(/The user changed setting `Model Selection` from .* to ([^.\n]+)/);
                                    if (mMatch && mMatch[1]) {
                                        const mName = mMatch[1].trim();
                                        const found = inMemoryConfig.models.find(m => 
                                            m.name.toLowerCase() === mName.toLowerCase() || 
                                            m.name.toLowerCase().includes(mName.toLowerCase()) ||
                                            mName.toLowerCase().includes(m.name.toLowerCase())
                                        );
                                        if (found) {
                                            detectedModelId = found.id;
                                        }
                                    }
                                }
                                if (d.type === 'USER_INPUT' || (d.type === 'PLANNER_RESPONSE' && !d.tool_calls?.length)) {
                                    msgChars += (d.content || '').length;
                                } else if (d.type === 'PLANNER_RESPONSE' && d.tool_calls?.length) {
                                    toolChars += JSON.stringify(d.tool_calls).length;
                                } else if (d.type === 'GENERIC') {
                                    toolChars += (d.content || '').length;
                                }
                            } catch(e) {}
                        }
                    }

                    if (detectedModelId && cleanConvId && cleanConvId !== 'new') {
                        if (!convModels[convKey]) {
                            convModels[convKey] = detectedModelId;
                            capMapSize(convModels, 200);
                            saveConvModelsToDisk();
                        }
                    }

                    const msgTokens = msgChars > 0 ? Math.round(msgChars / 3.5) : 0;
                    const toolTokens = toolChars > 0 ? Math.round(toolChars / 3.5) : 0;
                    const sysToolsTokens = 11800;
                    const sysPromptTokens = 6000;
                    const skillsTokens = 682;
                    const mcpToolsDeferred = 16100;
                    const sysToolsDeferred = 10400;
                    const autocompactBuffer = Math.min(33000, Math.round(totalContext * 0.033));

                    const isFreshChat = isNewOrEmpty || (msgTokens === 0 && toolTokens === 0);
                    const activeTokens = isFreshChat ? 0 : (msgTokens + toolTokens + sysToolsTokens + sysPromptTokens + skillsTokens);
                    const freeTokens = Math.max(0, totalContext - activeTokens - autocompactBuffer);

                    function fmt(n) {
                        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
                        if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
                        return String(Math.round(n));
                    }

                    function pct(n) {
                        if (n === 0) return '0%';
                        const p = (n / totalContext) * 100;
                        if (p >= 10) return p.toFixed(1) + '%';
                        if (p >= 0.1) return p.toFixed(1) + '%';
                        return '<0.1%';
                    }

                    const overallPercent = isFreshChat ? 0 : Math.min(100, (activeTokens / totalContext) * 100);

                    const items = [
                        { label: 'Messages', color: '#3b82f6', tokens: fmt(msgTokens), percent: pct(msgTokens) },
                        { label: 'Araç geçmişi', color: '#60a5fa', tokens: fmt(isFreshChat ? 0 : (sysToolsTokens + toolTokens)), percent: pct(isFreshChat ? 0 : (sysToolsTokens + toolTokens)), hint: 'Sohbet geçmişindeki araç çağrı ve sonuçları (diskteki transkript toplamı)' },
                        { label: 'System prompt', color: '#818cf8', tokens: fmt(isFreshChat ? 0 : sysPromptTokens), percent: pct(isFreshChat ? 0 : sysPromptTokens) },
                        { label: 'Skills', color: '#a78bfa', tokens: fmt(isFreshChat ? 0 : skillsTokens), percent: pct(isFreshChat ? 0 : skillsTokens) },
                        { label: 'MCP tools (deferred)', color: '#52525b', tokens: fmt(mcpToolsDeferred), percent: pct(mcpToolsDeferred) },
                        { label: 'System tools (deferred)', color: '#52525b', tokens: fmt(sysToolsDeferred), percent: pct(sysToolsDeferred) },
                        { label: 'Autocompact buffer', color: '#3f3f46', tokens: fmt(autocompactBuffer), percent: pct(autocompactBuffer) },
                        { label: 'Free space', color: '#27272a', tokens: fmt(freeTokens), percent: pct(freeTokens) }
                    ];

                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    const convModelRef = (convKey && convModels[convKey]) || null;
                    const convModelId = convModelRef
                        ? ((findModelByRef(convModelRef) || {}).id || (typeof convModelRef === 'string' ? convModelRef : null))
                        : null;
                    res.end(JSON.stringify({
                        ok: true,
                        convId: cleanConvId,
                        detectedModelId: detectedModelId || convModelId || null,
                        isFreshChat,
                        totalContext,
                        totalContextFormatted: fmt(totalContext),
                        usedTokens: activeTokens,
                        usedTokensFormatted: isFreshChat ? '0' : fmt(activeTokens),
                        percentNum: Math.round(overallPercent),
                        percentFormatted: Math.round(overallPercent) + '%',
                        items
                    }));
                } catch(e) {
                    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ error: e.message }));
                }
                return;
            }

            // GET /sx/get-chat-perf-stats?convId=...
            if (url.startsWith('/sx/get-chat-perf-stats') && req.method === 'GET') {
                try {
                    const u = new URL('http://localhost' + url);
                    const convId = u.searchParams.get('convId') || '';
                    const cleanConvId = (convId || '').replace(/^conv_/, '');
                    const convKey = 'conv_' + cleanConvId;

                    let stats = convPerfStats[convKey] || convPerfStats['conv_new'] || convPerfStats['last'] || null;
                    const history = (convPerfHistory[convKey] || convPerfHistory['conv_new'] || []).slice(-30);
                    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({
                        ok: true,
                        convId: cleanConvId,
                        history,
                        stats: stats || {
                            ttftMs: null,
                            totalMs: null,
                            completionTokens: 0,
                            tps: null,
                            modelName: null,
                            timestamp: null
                        }
                    }));
                } catch(e) {
                    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ error: e.message }));
                }
                return;
            }

            // Save custom theme seeds to config.json
            // POST /sx/save-theme body: { background, foregroundOverride, primary }
            if (url === '/sx/save-theme' && req.method === 'POST') {
                let raw = '';
                req.on('data', chunk => raw += chunk);
                req.on('end', () => {
                    try {
                        const { background, foregroundOverride, primary } = JSON.parse(raw);
                        const homedir = require('os').homedir();
                        const configPaths = [
                            path.join(homedir, '.gemini-custom', 'config', 'config.json'),
                            path.join(homedir, '.gemini', 'config', 'config.json')
                        ];
                        for (const cp of configPaths) {
                            if (fs.existsSync(cp)) {
                                try {
                                    const cfg = JSON.parse(fs.readFileSync(cp, 'utf8'));
                                    if (!cfg.userSettings) cfg.userSettings = {};
                                    cfg.userSettings.customThemeSeedsDark = { background, foregroundOverride, primary };
                                    cfg.userSettings.themeMode = 'THEME_MODE_DARK';
                                    fs.writeFileSync(cp, JSON.stringify(cfg, null, 2), 'utf8');
                                } catch(e) {}
                            }
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                        res.end(JSON.stringify({ ok: true }));
                    } catch(e) {
                        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                        res.end(JSON.stringify({ error: e.message }));
                    }
                });
                return;
            }

            // Voice transcription endpoint
            // POST /sx/transcribe-audio?lang=tr-TR (receives WAV audio binary)
            if (url.startsWith('/sx/transcribe-audio') && req.method === 'POST') {
                const u = new URL('http://localhost' + url);
                const lang = u.searchParams.get('lang') || 'tr-TR';

                let bodyChunks = [];
                req.on('data', chunk => bodyChunks.push(chunk));
                req.on('end', () => {
                    try {
                        const audioBuffer = Buffer.concat(bodyChunks);
                        if (audioBuffer.length < 100) {
                            res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                            res.end(JSON.stringify({ ok: false, error: 'Empty audio buffer' }));
                            return;
                        }

                        const tempWav = path.join(require('os').tmpdir(), `sx_rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.wav`);
                        fs.writeFileSync(tempWav, audioBuffer);

                        const pyCandidates = [
                            'C:\\Users\\squea\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
                            'C:\\Users\\squea\\AppData\\Local\\Programs\\Python\\Python313\\python.exe',
                            'python.exe',
                            'python'
                        ];
                        let pythonBin = pyCandidates.find(p => {
                            try { return fs.existsSync(p); } catch(e) { return false; }
                        }) || 'python';

                        const scriptPath = path.join(__dirname, 'transcribe.py');
                        const { execFile } = require('child_process');

                        execFile(pythonBin, [scriptPath, tempWav, lang], { timeout: 35000 }, (error, stdout, stderr) => {
                            try { if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav); } catch(e) {}

                            if (error) {
                                console.error('[SX PROXY Voice] Transcription exec error:', error, stderr);
                                res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                                res.end(JSON.stringify({ ok: false, error: error.message }));
                                return;
                            }

                            try {
                                const parsed = JSON.parse(stdout.trim());
                                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                                res.end(JSON.stringify(parsed));
                            } catch(e) {
                                console.error('[SX PROXY Voice] Failed to parse Python output:', stdout);
                                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                                res.end(JSON.stringify({ ok: true, text: stdout.trim() }));
                            }
                        });
                    } catch(err) {
                        console.error('[SX PROXY Voice] Request error:', err);
                        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                        res.end(JSON.stringify({ ok: false, error: err.message }));
                    }
                });
                return;
            }

            // CORS proxy: lets the renderer make requests to external APIs without CORS errors
            // POST /sx/proxy-fetch  body: { url, method, headers, body? }
            if (url === '/sx/proxy-fetch' && req.method === 'POST') {
                let rawBody = '';
                req.on('data', chunk => rawBody += chunk);
                req.on('end', async () => {
                    const ctrl = new AbortController();
                    const timer = setTimeout(() => { try { ctrl.abort(); } catch(e){} }, 30000);
                    try {
                        const { url: targetUrl, method = 'GET', headers = {}, body: fetchBody } = JSON.parse(rawBody);
                        if (!targetUrl || !targetUrl.startsWith('http')) throw new Error('Invalid URL');
                        const fetchOpts = { method, headers, signal: ctrl.signal };
                        if (fetchBody) fetchOpts.body = fetchBody;
                        const upstream = await fetch(targetUrl, fetchOpts);
                        const upstreamText = await upstream.text();
                        clearTimeout(timer);
                        res.writeHead(upstream.status, {
                            'Content-Type': upstream.headers.get('content-type') || 'application/json',
                            'Access-Control-Allow-Origin': '*'
                        });
                        res.end(upstreamText);
                    } catch(e) {
                        clearTimeout(timer);
                        res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                        res.end(JSON.stringify({ error: e.message }));
                    }
                });
                return;
            }

            // Handle fetchAvailableModels for language_server.exe
            if (url.includes('fetchAvailableModels')) {
                loadConfigFromDisk();
                const modelsMap = {};
                const modelIds = [];
                inMemoryConfig.models.forEach((m, idx) => {
                    const key = m.id || ('model_' + idx);
                    let maxTok = 131072;
                    if (m.contextLength && Number(m.contextLength) > 0) {
                        maxTok = Number(m.contextLength);
                    } else {
                        const mId = (m.modelId || m.id || '').toLowerCase();
                        if (mId.includes('1m') || mId.includes('gemini-1.5') || mId.includes('gemini-2.0') || mId.includes('gemini-2.5') || mId.includes('ultra') || mId.includes('spark') || mId.includes('muse') || mId.includes('ling') || mId.includes('inkling')) {
                            maxTok = 1048576;
                        } else if (mId.includes('2m')) {
                            maxTok = 2097152;
                        } else if (mId.includes('256k') || mId.includes('nemotron') || mId.includes('qwen') || mId.includes('pro') || mId.includes('deepseek') || mId.includes('step')) {
                            maxTok = 262144;
                        } else if (mId.includes('64k') || mId.includes('flash') || mId.includes('mini')) {
                            maxTok = 65536;
                        } else if (mId.includes('32k')) {
                            maxTok = 32768;
                        }
                    }

                    const mSupportsImages = typeof m.supportsImages === 'boolean'
                        ? m.supportsImages
                        : /(?:vl|vision|omni|4o|gemini|gemma|pixtral|llava|paligemma|qwen.*vl)/i.test(String(m.modelId || m.name || ''));

                    modelsMap[key] = {
                        displayName: m.name,
                        model: `MODEL_PLACEHOLDER_M${idx + 1}`,
                        supportsImages: mSupportsImages,
                        supportsThinking: true,
                        supportsAdaptiveThinking: true,
                        supportsRawThinking: true,
                        thinkingBudget: 16384,
                        minThinkingBudget: 2048,
                        recommended: true,
                        maxTokens: maxTok,
                        maxOutputTokens: 16384,
                        supportsCumulativeContext: true
                    };
                    modelIds.push(key);
                });
                const firstKey = modelIds[0] || 'custom_model_1';
                if (!modelIds.length) {
                    modelsMap[firstKey] = {
                        displayName: 'Custom AI Model',
                        model: 'MODEL_PLACEHOLDER_M1',
                        supportsImages: true,
                        supportsThinking: true,
                        supportsAdaptiveThinking: true,
                        supportsRawThinking: true,
                        thinkingBudget: 16384,
                        minThinkingBudget: 2048,
                        recommended: true,
                        maxTokens: 131072,
                        maxOutputTokens: 16384,
                        supportsCumulativeContext: true
                    };
                    modelIds.push(firstKey);
                }

                // Register all placeholders (M1 to M650) with 1M context to prevent context budget exhaustion
                for (let i = 1; i <= 650; i++) {
                    const ph = `MODEL_PLACEHOLDER_M${i}`;
                    if (!modelsMap[ph]) {
                        const fallbackModel = inMemoryConfig.models[i - 1] || inMemoryConfig.models[0];
                        modelsMap[ph] = {
                            displayName: fallbackModel ? fallbackModel.name : `Custom Model Slot ${i}`,
                            model: ph,
                            supportsImages: true,
                            supportsThinking: true,
                            supportsAdaptiveThinking: true,
                            supportsRawThinking: true,
                            recommended: false,
                            maxTokens: 1048576,
                            maxOutputTokens: 32768,
                            supportsCumulativeContext: true
                        };
                    }
                }

                const providerGroups = [];
                for (const prov of inMemoryConfig.providers) {
                    const provModels = inMemoryConfig.models.filter(m => m.providerId === prov.id);
                    if (provModels.length > 0) {
                        providerGroups.push({
                            displayName: prov.name,
                            modelIds: provModels.map(m => m.id)
                        });
                    }
                }
                if (!providerGroups.length) {
                    providerGroups.push({ displayName: 'Custom Models', modelIds });
                }

                const payload = {
                    models: modelsMap,
                    defaultAgentModelId: firstKey,
                    agentModelSorts: [
                        {
                            displayName: 'Providers',
                            groups: providerGroups
                        }
                    ]
                };
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify(payload));
                return;
            }

            // Handle retrieveUserQuotaSummary
            if (url.includes('retrieveUserQuotaSummary')) {
                const bucket = { displayName: "SX Development", remainingFraction: 1.0, disabled: false, resetTime: "2030-12-31T23:59:59Z" };
                res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                res.end(JSON.stringify({
                    buckets: [bucket],
                    groups: [{ displayName: "Custom Quota", description: "Custom AI Engine", buckets: [bucket] }],
                    description: "Custom Studio Enterprise Quota"
                }));
                return;
            }

            // Generation stream
            const urlLower = url.toLowerCase();
            if (urlLower.includes('generatecontent')) {
                let bodyChunks = [];
                req.on('data', chunk => bodyChunks.push(chunk));
                req.on('end', async () => {
                    try {
                        const rawBody = Buffer.concat(bodyChunks).toString('utf8');
                        let reqJson = {};
                        try { reqJson = parseJsonBody(rawBody) || {}; } catch(e) {}

                        if (!inMemoryConfig.models.length) {
                            loadConfigFromDisk();
                        }

                        const innerReq = reqJson.request || reqJson;

                        // Prioritize the custom header injected by our frontend hook
                        let requestedModel = req.headers['x-sx-model-id'] || innerReq.model || reqJson.model || '';
                        let reqConvKey = req.headers['x-sx-conv-key'] || '';
                        if (!reqConvKey) {
                            let convId = '';
                            const reqId = reqJson.requestId || innerReq.requestId || '';
                            if (reqId.startsWith('agent/')) convId = reqId.split('/')[1] || '';
                            if (!convId) convId = innerReq.labels?.trajectory_id || reqJson.labels?.trajectory_id || '';
                            if (convId) reqConvKey = 'conv_' + convId;
                        }

                        let modelIdx = 0;
                        let customModel = null;

                        // 1. Explicit unique model ID from custom header (e.g. m_...)
                        const headerModelId = req.headers['x-sx-model-id'];
                        if (headerModelId) {
                            customModel = inMemoryConfig.models.find(m => m.id === headerModelId);
                        }

                        // 2. Per-conversation saved model mapping (string id or enriched ref)
                        if (!customModel && reqConvKey && convModels[reqConvKey]) {
                            customModel = findModelByRef(convModels[reqConvKey]);
                            if (customModel) {
                                console.log(`[SX PROXY] Using per-conversation model for ${reqConvKey}: ${customModel.name} (${customModel.id})`);
                            }
                        }

                        // 3. Fallback to global active model by unique ID
                        if (!customModel && currentActiveModelId) {
                            customModel = inMemoryConfig.models.find(m => m.id === currentActiveModelId);
                            if (customModel) {
                                console.log(`[SX PROXY] Using global active model: ${customModel.name} (${customModel.id})`);
                            }
                        }

                        // 4. Fallback: match by requestedModel string (e.g. innerReq.model)
                        if (!customModel && requestedModel && !requestedModel.startsWith('MODEL_PLACEHOLDER_')) {
                            customModel = inMemoryConfig.models.find(m => m.id === requestedModel || m.modelId === requestedModel);
                        }
                        
                        // 3. Fallback to placeholder index
                        if (!customModel) {
                            const match = String(requestedModel || '').match(/MODEL_PLACEHOLDER_M(\d+)/i);
                            if (match) {
                                modelIdx = parseInt(match[1], 10) - 1;
                            } else {
                                const idx = [
                                    'MODEL_PLACEHOLDER_M1', 'MODEL_PLACEHOLDER_M2', 'MODEL_PLACEHOLDER_M3', 'MODEL_PLACEHOLDER_M4', 'MODEL_PLACEHOLDER_M5', 'MODEL_PLACEHOLDER_M6', 'MODEL_PLACEHOLDER_M7', 'MODEL_PLACEHOLDER_M8', 'MODEL_PLACEHOLDER_M9', 'MODEL_PLACEHOLDER_M10',
                                    'MODEL_PLACEHOLDER_M11', 'MODEL_PLACEHOLDER_M12', 'MODEL_PLACEHOLDER_M13', 'MODEL_PLACEHOLDER_M14', 'MODEL_PLACEHOLDER_M15', 'MODEL_PLACEHOLDER_M16', 'MODEL_PLACEHOLDER_M17', 'MODEL_PLACEHOLDER_M18'
                                ].indexOf(requestedModel);
                                if (idx !== -1) {
                                    modelIdx = idx % inMemoryConfig.models.length;
                                }
                            }
                            if (modelIdx >= 0 && modelIdx < inMemoryConfig.models.length) {
                                customModel = inMemoryConfig.models[modelIdx];
                            }
                        }
                        if (!customModel) {
                            customModel = inMemoryConfig.models[0];
                        }
                        const provider = customModel ? inMemoryConfig.providers.find(p => p.id === customModel.providerId) : inMemoryConfig.providers[0];

                        console.log(`[SX PROXY] Stream generation requested: model=${requestedModel} -> slotIdx=${modelIdx} -> customModel=${customModel?.name} (${customModel?.modelId})`);

                        if (!provider || !customModel) {
                            res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
                            const msg = JSON.stringify({
                                response: {
                                    candidates: [{
                                        content: { role: 'model', parts: [{ text: "Lütfen Settings > Models sekmesinden bir Provider ve Model ekleyin." }] },
                                        finishReason: 'STOP'
                                    }]
                                }
                            });
                            res.write(`data: ${msg}\n\n`);
                            res.end();
                            return;
                        }

                        let contents = innerReq.contents || reqJson.contents || [];
                        if (!contents.length) {
                            let convId = '';
                            const reqId = reqJson.requestId || innerReq.requestId || '';
                            if (reqId.startsWith('agent/')) {
                                convId = reqId.split('/')[1] || '';
                            }
                            if (!convId) {
                                convId = innerReq.labels?.trajectory_id || reqJson.labels?.trajectory_id || '';
                            }
                            if (convId) {
                                const rescued = loadTranscriptContents(convId);
                                if (rescued.length) {
                                    contents = rescued;
                                    console.log(`[SX PROXY] Rescued ${rescued.length} turns from transcript for ${convId}`);
                                }
                            }
                        }

                        // Determine model context limit
                        let modelContextLimit = 131072; // default 128k
                        if (customModel?.contextLength && Number(customModel.contextLength) > 0) {
                            modelContextLimit = Number(customModel.contextLength);
                        } else {
                            const mId = (customModel?.modelId || '').toLowerCase();
                            if (mId.includes('1m') || mId.includes('gemini') || mId.includes('lightning') || mId.includes('ultra') || mId.includes('spark') || mId.includes('muse') || mId.includes('ling') || mId.includes('inkling')) {
                                modelContextLimit = 1000000;
                            } else if (mId.includes('256k') || mId.includes('pro') || mId.includes('nemotron') || mId.includes('qwen') || mId.includes('step') || mId.includes('deepseek')) {
                                modelContextLimit = 262144;
                            } else if (mId.includes('128k') || mId.includes('gpt-4o') || mId.includes('claude-3') || mId.includes('gemma')) {
                                modelContextLimit = 128000;
                            } else if (mId.includes('64k') || mId.includes('mini')) {
                                modelContextLimit = 65536;
                            } else if (mId.includes('32k')) {
                                modelContextLimit = 32768;
                            }
                        }

                        // Extract system prompt and tools FIRST so we can measure their token cost
                        // before deciding how much space is left for conversation history.
                        const systemInst = innerReq.systemInstruction || reqJson.systemInstruction;
                        const systemParts = systemInst?.parts || [];
                        let systemText = systemParts.map(p => p.text || '').filter(Boolean).join('\n');
                        // Professional agent mode: remind model to manage context continuously
                        if (systemText && !systemText.includes('Otomatik Bağlam')) {
                            systemText += '\n\n[Profesyonel Mod] Uzun bağlamda önceki kararları özetleyip devam edin. Kırpma sonrası referansı kaybetmeyin; önceki kullanıcı isteğini hatırlayın.';
                        }
                        const rawTools = innerReq.tools || reqJson.tools || [];

                        // Estimate chars consumed by system prompt + tool schemas
                        // JSON tool schemas tokenize at ~2 chars/token (brackets, quotes are expensive)
                        // Natural language system prompt at ~3.5 chars/token
                        const systemChars = systemText.length;
                        const toolsChars = rawTools.length ? JSON.stringify(rawTools).length : 0;
                        const systemTokens = Math.ceil(systemChars / 3.0);
                        const toolsTokens = Math.ceil(toolsChars / 2.0); // JSON is denser in tokens
                        const overheadTokens = systemTokens + toolsTokens;
                        console.log(`[SX PROXY] Overhead: system ~${systemTokens} tok (${systemChars} ch) + tools ~${toolsTokens} tok (${toolsChars} ch) = ${overheadTokens} tok. Model limit: ${modelContextLimit}`);

                        // Reserve: overhead + 16k safety (generation budget + MCP overhead buffer)
                        let historyTokenBudget = Math.max(4000, modelContextLimit - overheadTokens - 16000);
                        const isGroq = (provider?.name || '').toLowerCase().includes('groq') || (provider?.baseUrl || '').toLowerCase().includes('groq') || /groq|qwen.*gguf|gpt-oss/i.test(String(customModel?.modelId || customModel?.id || '')) || /groq/i.test(String(customModel?.name || ''));
                        if (isGroq) {
                            // Groq on-demand ITPM hard cap ~7000/min total input — keep single request well under
                            historyTokenBudget = Math.min(historyTokenBudget, 1500);
                            console.log(`[SX PROXY] Groq detected — aggressive ITPM cap to ${historyTokenBudget}`);
                        }
                        const isFreeModel = ((customModel?.modelId || '').toLowerCase().endsWith(':free') || (customModel?.name || '').toLowerCase().endsWith(':free')) || (provider?.name || '').toLowerCase().includes('free');
                        if (isFreeModel) {
                            let freeCap = 120000;
                            if (modelContextLimit >= 1000000) {
                                freeCap = 800000;
                            } else if (modelContextLimit >= 500000) {
                                freeCap = 450000;
                            } else if (modelContextLimit >= 250000) {
                                freeCap = 220000;
                            } else if (modelContextLimit >= 120000) {
                                freeCap = 110000;
                            } else {
                                freeCap = Math.max(30000, modelContextLimit - 10000);
                            }
                            if (historyTokenBudget > freeCap) {
                                historyTokenBudget = freeCap;
                            }
                        }
                        console.log(`[SX PROXY] History budget: ${historyTokenBudget} tokens (freeModel=${isFreeModel})`);

                        // Auto-compact conversation history using real available budget
                        const contentsBeforeCompact = contents.length;
                        // Capture pre-trim intent for vacuous continuations ("Continue" etc.)
                        let lastUserText = '';
                        try {
                            for (let i = contents.length - 1; i >= 0; i--) {
                                const c = contents[i];
                                if (c && (c.role === 'user' || c.role === 'human')) { lastUserText = getTurnText(c); break; }
                            }
                        } catch(e) {}
                        const substantiveBefore = findLastSubstantiveUser(contents);
                        contents = await autoCompactWithSummary(contents, historyTokenBudget, { provider, modelId: customModel?.modelId, convKey: reqConvKey });
                        // If the last message is vacuous AND trimming dropped turns, the model
                        // loses the referent ("isteğiniz görünmüyor") — re-inject last intent.
                        let intentRescued = false;
                        if (lastUserText && isVacuousContinuation(lastUserText) && substantiveBefore && contents.length < contentsBeforeCompact) {
                            contents.push({ role: 'user', parts: [{ text: makeIntentReminder(substantiveBefore) }] });
                            intentRescued = true;
                            console.log(`[SX PROXY] Intent rescue injected for ${reqConvKey || '?'}`);
                        }
                        // Agent loop breaker: inject pending nudge from the previous streamed response
                        try {
                            const pend = (reqConvKey && loopGuardPending[reqConvKey]) || null;
                            if (pend && Array.isArray(contents)) {
                                contents.push({ role: 'user', parts: [{ text: makeLoopNudge(pend.name, pend.args, pend.count, pend.type) }] });
                                console.warn(`[SX PROXY] Loop breaker nudge injected for '${pend.name}' on ${reqConvKey}`);
                                delete loopGuardPending[reqConvKey];
                                if (loopGuardReadOnlyCounts && reqConvKey) loopGuardReadOnlyCounts[reqConvKey] = 0;
                            }
                        } catch(e){}
                        const historyCharsAfter = estimateContentChars(contents);
                        const historyTokensAfter = Math.ceil(historyCharsAfter / 3.5);

                        // Write debug stats to disk so we can diagnose issues
                        dbgLog({
                            model: customModel?.name || customModel?.modelId || '?',
                            modelContextLimit,
                            systemChars, systemTokens,
                            toolsChars, toolsTokens,
                            overheadTokens,
                            historyTokenBudget,
                            contentsTurns: contentsBeforeCompact,
                            contentsTurnsAfterCompact: contents.length,
                            historyCharsAfter,
                            historyTokensAfter,
                            estimatedTotal: overheadTokens + historyTokensAfter,
                        });
                        logHit({
                            conv: reqConvKey || null,
                            model: customModel?.modelId || customModel?.id || '?',
                            turns: contents.length,
                            estTok: overheadTokens + historyTokensAfter,
                            budget: historyTokenBudget,
                            sub: !!(req.headers['x-sx-conv-key'] && reqConvKey && req.headers['x-sx-conv-key'] !== reqConvKey) || undefined,
                        });
                        if (reqConvKey) {
                            recordSentEstimate(reqConvKey, overheadTokens + historyTokensAfter, customModel?.modelId || customModel?.id);
                        }

                        const proto = (provider.protocol || 'openai').toLowerCase();
                        res.writeHead(200, {
                            'Content-Type': 'text/event-stream; charset=utf-8',
                            'Cache-Control': 'no-cache',
                            'Connection': 'keep-alive',
                            'Access-Control-Allow-Origin': '*'
                        });
                        // Always release upstream timers when our response closes.
                        let upCleanup = null;
                        res.on('close', () => {
                            try { if (upCleanup) upCleanup(); } catch(e){}
                            try { if (reqConvKey) delete streamProgress[reqConvKey]; } catch(e){}
                        });

                        if (proto === 'anthropic') {
                            const anthropicTools = convertGeminiToolsToAnthropic(rawTools);
                            const apiUrl = (provider.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '') + '/v1/messages';
                            const anthStartTime = Date.now();
                            // Per-message detail accumulators (normal vs thinking split, tools, real usage)
                            let anthTextChars = 0, anthThinkChars = 0;
                            const anthMsgTools = [];
                            let anthUsageIn = 0, anthUsageOut = 0, anthStopReason = '';
                            const payload = {
                                model: customModel.modelId,
                                max_tokens: 16000,
                                stream: true,
                                messages: []
                            };
                            if (systemText) payload.system = systemText;
                            if (anthropicTools) payload.tools = anthropicTools;

                            const budgetKey = `${provider?.name || provider?.baseUrl || ''}|${customModel?.modelId || customModel?.id || ''}`;
                            let anthBudget = historyTokenBudget;
                            if (learnedHistoryBudget[budgetKey]) {
                                anthBudget = Math.min(anthBudget, learnedHistoryBudget[budgetKey]);
                            }

                            let apiRes = null;
                            let lastErrTxt = '';
                            let lastErrStatus = 0;
                            for (let attempt = 0; attempt < 3; attempt++) {
                                const slim = compactContentsForContext(contents, anthBudget);
                                payload.messages = sanitizeAnthropicMessages(geminiContentsToAnthropic(slim));
                                try {
                                    const up = await fetchUpstream(apiUrl, {
                                        method: 'POST',
                                        headers: {
                                            'Content-Type': 'application/json',
                                            'x-api-key': provider.apiKey || '',
                                            'anthropic-version': '2023-06-01',
                                            'HTTP-Referer': 'https://antigravity.google',
                                            'X-Title': 'Antigravity Pro - SX Custom Engine'
                                        },
                                        body: JSON.stringify(payload)
                                    });
                                    upCleanup = up.done;
                                    apiRes = up.res;
                                } catch (fetchErr) {
                                    lastErrStatus = 0;
                                    lastErrTxt = (fetchErr && fetchErr.message) || String(fetchErr);
                                    console.error(`[SX PROXY] Anthropic upstream fetch failed (attempt ${attempt + 1}/3):`, lastErrTxt);
                                    if (isRetryableFetchTimeout(fetchErr, attempt)) {
                                        console.warn('[SX PROXY] TTFB timeout on first attempt — one immediate retry');
                                        continue;
                                    }
                                    break; // total timeout / network: retrying won't help
                                }
                                if (apiRes.ok) break;
                                upCleanup && upCleanup(); upCleanup = null;
                                lastErrStatus = apiRes.status;
                                lastErrTxt = await apiRes.text().catch(() => `HTTP ${apiRes.status}`);
                                if (attempt < 2 && isContextOverflow(apiRes.status, lastErrTxt)) {
                                    anthBudget = Math.max(3000, Math.floor(anthBudget * 0.45));
                                    learnedHistoryBudget[budgetKey] = anthBudget;
                                    console.warn(`[SX PROXY] Context overflow on ${customModel?.modelId} (attempt ${attempt + 1}/3). Shrinking history budget to ${anthBudget} and retrying...`);
                                    continue;
                                }
                                // Tools-only retry: 400 with active tools -> retry once without tools
                                if (attempt < 2 && apiRes.status === 400 && (anthropicTools || payload.tools) && !lastErrTxt.includes('context')) {
                                    console.warn(`[SX PROXY] Tools 400 on ${customModel?.modelId} — retrying without tools (attempt ${attempt + 1}/3)`);
                                    payload.tools = undefined;
                                    payload.messages = sanitizeAnthropicMessages(geminiContentsToAnthropic(slim));
                                    continue;
                                }
                                break;
                            }
                            if (apiRes && apiRes.ok) {
                                learnedHistoryBudget[budgetKey] = anthBudget;
                            }

                            if (!apiRes || !apiRes.ok) {
                                const errTxt = lastErrTxt || `HTTP ${lastErrStatus}`;
                                if (isGroq && lastErrStatus === 413 && /ITPM|TPM|input tokens per minute|rate_limit_exceeded/i.test(String(errTxt || '').slice(0, 300))) {
                                    const budgetKey = `${provider?.name || provider?.baseUrl || ''}|${customModel?.modelId || customModel?.id || ''}`;
                                    learnedHistoryBudget[budgetKey] = 500;
                                    console.warn(`[SX PROXY] Groq-only rate-limit 413 — emergency budget 500 set for ${budgetKey}`);
                                }
                                console.error(`[SX PROXY] Anthropic upstream error ${lastErrStatus}:`, errTxt);
                                try { logDone({ conv: reqConvKey || null, event: 'error', proto: 'anthropic', status: lastErrStatus, err: String(errTxt).slice(0, 200) }); } catch(e){}
                                const errChunk = JSON.stringify({
                                    response: {
                                        candidates: [{
                                            content: { role: 'model', parts: [{ text: `Model servisi hata döndürdü${lastErrStatus ? ` (HTTP ${lastErrStatus})` : ''}: ${errTxt}` }] },
                                            finishReason: 'STOP'
                                        }]
                                    }
                                });
                                res.write(`data: ${errChunk}\n\n`);
                                res.end();
                                return;
                            }

                            const reader = apiRes.body.getReader();
                            const decoder = new TextDecoder();
                            let buf = '';
                            let currentToolCall = null;

                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) break;
                                buf += decoder.decode(value, { stream: true });
                                const lines = buf.split('\n');
                                buf = lines.pop();
                                for (const line of lines) {
                                    if (!line.startsWith('data: ')) continue;
                                    const raw = line.slice(6).trim();
                                    if (!raw || raw === '[DONE]') continue;
                                    try {
                                        const ev = JSON.parse(raw);
                                        // Real usage accounting (Anthropic streams input/output counts)
                                        if (ev.type === 'message_start' && ev.message && ev.message.usage) {
                                            anthUsageIn = Number(ev.message.usage.input_tokens) || 0;
                                            continue;
                                        }
                                        if (ev.type === 'message_delta' && ev.usage) {
                                            anthUsageOut = Number(ev.usage.output_tokens) || 0;
                                            if (ev.delta && ev.delta.stop_reason) anthStopReason = String(ev.delta.stop_reason);
                                            continue;
                                        }
                                        if (ev.type === 'content_block_delta') {
                                            if (ev.delta?.type === 'text_delta') {
                                                anthTextChars += (ev.delta.text || '').length;
                                                bumpStreamProgress(reqConvKey, (ev.delta.text || '').length);
                                                const chunk = JSON.stringify({
                                                    response: {
                                                        candidates: [{
                                                            content: { role: 'model', parts: [{ text: ev.delta.text }] }
                                                        }]
                                                    }
                                                });
                                                res.write(`data: ${chunk}\n\n`);
                                            } else if (ev.delta?.type === 'thinking_delta') {
                                                anthThinkChars += (ev.delta.thinking || '').length;
                                                bumpStreamProgress(reqConvKey, (ev.delta.thinking || '').length);
                                                const chunk = JSON.stringify({
                                                    response: {
                                                        candidates: [{
                                                            content: { role: 'model', parts: [{ text: ev.delta.thinking, thought: true }] }
                                                        }]
                                                    }
                                                });
                                                res.write(`data: ${chunk}\n\n`);
                                            } else if (ev.delta?.type === 'input_json_delta' && currentToolCall) {
                                                currentToolCall.arguments += ev.delta.partial_json;
                                            }
                                        } else if (ev.type === 'content_block_start') {
                                            if (ev.content_block?.type === 'tool_use') {
                                                currentToolCall = {
                                                    id: ev.content_block.id,
                                                    name: ev.content_block.name,
                                                    arguments: ''
                                                };
                                            }
                                        } else if (ev.type === 'content_block_stop') {
                                            if (currentToolCall) {
                                                let argsObj = {};
                                                try { argsObj = JSON.parse(currentToolCall.arguments || '{}'); } catch(e) {}
                                                const chunk = JSON.stringify({
                                                    response: {
                                                        candidates: [{
                                                            content: {
                                                                role: 'model',
                                                                parts: [{
                                                                    functionCall: {
                                                                        name: currentToolCall.name,
                                                                        args: argsObj
                                                                    }
                                                                }]
                                                            }
                                                        }]
                                                    }
                                                });
                                                res.write(`data: ${chunk}\n\n`);
                                                try { recordToolCall(reqConvKey, currentToolCall.name, currentToolCall.arguments); } catch(e){}
                                                if (currentToolCall.name) anthMsgTools.push(String(currentToolCall.name));
                                                currentToolCall = null;
                                            }
                                        }
                                    } catch(e) {}
                                }
                            }
                            // Anthropic perf stats (mirrors OpenAI tail; shared fin below terminates)
                            try {
                                const sp = (reqConvKey && streamProgress[reqConvKey]) || null;
                                const genChars = sp ? (sp.chars || 0) : 0;
                                const firstTs = (sp && sp.firstTs) || anthStartTime;
                                const totalMsA = Date.now() - anthStartTime;
                                const ttftMsA = Math.max(0, firstTs - anthStartTime);
                                const compToksA = Math.max(1, Math.round(genChars / 3.5));
                                const genMsA = Math.max(1, totalMsA - ttftMsA);
                                const normalToksA = sxEstToks(anthTextChars);
                                const thinkToksA = sxEstToks(anthThinkChars);
                                const perfDataA = {
                                    ttftMs: ttftMsA, totalMs: totalMsA, generationMs: genMsA,
                                    completionTokens: compToksA,
                                    normalTokens: normalToksA,
                                    thinkingTokens: thinkToksA,
                                    promptTokens: (anthUsageIn > 0 ? anthUsageIn : Math.round(genChars / 3.5)), // prefer real usage
                                    outputTokens: (anthUsageOut > 0 ? anthUsageOut : compToksA),
                                    toolCalls: anthMsgTools.length,
                                    toolCallNames: anthMsgTools,
                                    stopReason: anthStopReason || '',
                                    tps: Number((compToksA / (genMsA / 1000)).toFixed(1)),
                                    modelName: customModel?.name || customModel?.modelId || 'Custom Model',
                                    timestamp: new Date().toISOString()
                                };
                            if (reqConvKey) recordMsgPerf(reqConvKey, perfDataA, 0); // already saved above
                            } catch(e) {}
                        } else {
                            // OpenAI protocol (OpenRouter, OpenAI, Kilo, Kira, etc.)
                            // Convert first so we can measure ACTUAL payload sizes (Gemini format estimates are 2-3x off)
                            const oaTools = convertGeminiToolsToOpenAI(rawTools);

                            // Measure actual system + tools chars in OpenAI wire format
                            const sysMsgChars = systemText ? (systemText.length + 20) : 0; // +20 for role/wrapper JSON
                            const oaToolsChars = oaTools ? JSON.stringify(oaTools).length : 0;
                            // Real per-token char ratio for mixed content is ~1.55 for OpenAI JSON with code & tools
                            const actualOverheadTokens = Math.ceil((sysMsgChars + oaToolsChars) / 3.5);
                            // Real history budget based on actual OpenAI overhead measurement (reserve overhead + 16k buffer)
                            let realHistoryBudget = Math.max(3000, modelContextLimit - actualOverheadTokens - 16000);
                            if (isFreeModel && realHistoryBudget > 70000) {
                                realHistoryBudget = 70000;
                            }
                            if (isGroq) {
                                realHistoryBudget = Math.min(realHistoryBudget, 1500);
                                console.log(`[SX PROXY] Groq detected (OpenAI path) — aggressive budget capped to ${realHistoryBudget}`);
                            }

                            const rawOaMsgs = geminiContentsToOpenAI(contents, systemText);
                            const sanitizedOaMsgs = sanitizeOpenAIMessages(rawOaMsgs);
                            // Trim using ACTUAL measured budget
                            const oaMsgs = trimOpenAIMessages(sanitizedOaMsgs, realHistoryBudget);

                            // Update debug stats with accurate post-conversion numbers
                            const finalMsgChars = JSON.stringify(oaMsgs).length;
                            const finalToolsChars = oaTools ? JSON.stringify(oaTools).length : 0;
                            dbgLog({
                                ..._dbgLastStats,
                                sysMsgChars, oaToolsChars,
                                actualOverheadTokens,
                                realHistoryBudget,
                                finalMsgChars,
                                finalToolsChars,
                                finalEstimatedTokens: Math.ceil((finalMsgChars + finalToolsChars) / 3.5),
                                intentRescued: !!intentRescued,
                            });
                            if (reqConvKey) {
                                recordSentEstimate(reqConvKey, Math.ceil((finalMsgChars + finalToolsChars) / 1.55), customModel?.modelId || customModel?.id);
                            }

                            const cleanBase = (provider.baseUrl || 'https://api.openai.com/v1').replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '');
                            const apiUrl = cleanBase + '/chat/completions';
                            const payload = {
                                model: customModel.modelId,
                                stream: true,
                                messages: [],
                                include_reasoning: true,
                                // Groq service_tier omitted: user's org only has on_demand; default is safe
                            };
                            if (oaTools) payload.tools = oaTools;

                            const requestStartTime = Date.now();
                            let firstTokenTime = null;
                            let totalGeneratedChars = 0;

                            // Session-learned cap: a previous overflow for this model starts smaller.
                            const budgetKey = `${provider?.name || provider?.baseUrl || ''}|${customModel?.modelId || customModel?.id || ''}`;
                            if (learnedHistoryBudget[budgetKey]) {
                                const capped = Math.min(realHistoryBudget, learnedHistoryBudget[budgetKey]);
                                if (capped < realHistoryBudget) {
                                    console.log(`[SX PROXY] Applying learned history budget for ${customModel?.modelId}: ${realHistoryBudget} -> ${capped}`);
                                    realHistoryBudget = capped;
                                }
                            }

                            // Self-healing loop: on context overflow, shrink history and retry (max 3 attempts).
                            let apiRes = null;
                            let lastErrTxt = '';
                            let lastErrStatus = 0;
                            let attemptBudget = realHistoryBudget;
                            for (let attempt = 0; attempt < 3; attempt++) {
                                payload.messages = trimOpenAIMessages(sanitizedOaMsgs, attemptBudget);
                                try {
                                    const up = await fetchUpstream(apiUrl, {
                                        method: 'POST',
                                        headers: {
                                            'Content-Type': 'application/json',
                                            'Authorization': 'Bearer ' + (provider.apiKey || ''),
                                            'HTTP-Referer': 'https://antigravity.google',
                                            'X-Title': 'Antigravity Pro - SX Custom Engine'
                                        },
                                        body: JSON.stringify(payload)
                                    });
                                    upCleanup = up.done;
                                    apiRes = up.res;
                                } catch (fetchErr) {
                                    lastErrStatus = 0;
                                    lastErrTxt = (fetchErr && fetchErr.message) || String(fetchErr);
                                    console.error(`[SX PROXY] OpenAI upstream fetch failed (attempt ${attempt + 1}/3):`, lastErrTxt);
                                    if (isRetryableFetchTimeout(fetchErr, attempt)) {
                                        console.warn('[SX PROXY] TTFB timeout on first attempt — one immediate retry');
                                        continue;
                                    }
                                    break; // total timeout / network: retrying won't help
                                }
                                if (apiRes.ok) break;
                                upCleanup && upCleanup(); upCleanup = null;
                                lastErrStatus = apiRes.status;
                                lastErrTxt = await apiRes.text().catch(() => `HTTP ${apiRes.status}`);
                                if (attempt < 2 && isContextOverflow(apiRes.status, lastErrTxt)) {
                                    attemptBudget = Math.max(3000, Math.floor(attemptBudget * 0.45));
                                    learnedHistoryBudget[budgetKey] = attemptBudget;
                                    console.warn(`[SX PROXY] Context overflow on ${customModel?.modelId} (attempt ${attempt + 1}/3). Shrinking history budget to ${attemptBudget} and retrying...`);
                                    continue;
                                }
                                break;
                            }
                            // Remember the working budget for this session.
                            if (apiRes && apiRes.ok) {
                                learnedHistoryBudget[budgetKey] = attemptBudget;
                            }

                            if (!apiRes || !apiRes.ok) {
                                const errTxt = lastErrTxt || `HTTP ${lastErrStatus}`;
                                // Emergency shrink ONLY for Groq / Groq-routed rate-limit 413
                                if (isGroq && lastErrStatus === 413 && /ITPM|TPM|input tokens per minute|rate_limit_exceeded/i.test(String(errTxt || '').slice(0, 300))) {
                                    const budgetKey = `${provider?.name || provider?.baseUrl || ''}|${customModel?.modelId || customModel?.id || ''}`;
                                    learnedHistoryBudget[budgetKey] = 500;
                                    console.warn(`[SX PROXY] Groq-only rate-limit 413 — emergency budget 500 set for ${budgetKey}`);
                                }
                                console.error(`[SX PROXY] OpenAI upstream error ${lastErrStatus}:`, errTxt);
                                try { logDone({ conv: reqConvKey || null, event: 'error', proto: 'openai', status: lastErrStatus, err: String(errTxt).slice(0, 200) }); } catch(e){}
                                const errChunk = JSON.stringify({
                                    response: {
                                        candidates: [{
                                            content: { role: 'model', parts: [{ text: `Model servisi hata döndürdü${lastErrStatus ? ` (HTTP ${lastErrStatus})` : ''}: ${errTxt}` }] },
                                            finishReason: 'STOP'
                                        }]
                                    }
                                });
                                res.write(`data: ${errChunk}\n\n`);
                                res.end();
                                return;
                            }

                            const reader = apiRes.body.getReader();
                            const decoder = new TextDecoder();
                            let buf = '';
                            let inThink = false;
                            const activeToolCalls = {};
                            let totalChunksSent = 0;
                            // Per-message real usage tracking (upstream provides usage in final chunk)
                            let openUsagePrompt = 0, openUsageComplete = 0;
                            let openStopReason = '';
                            const openMsgTools = [];
                            let openNormalChars = 0, openThinkChars = 0;

                            let rawLinesSample = [];
                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) break;
                                buf += decoder.decode(value, { stream: true });
                                const lines = buf.split('\n');
                                buf = lines.pop();
                                for (const line of lines) {
                                    if (!line.startsWith('data: ')) continue;
                                    const raw = line.slice(6).trim();
                                    if (!raw || raw === '[DONE]') continue;
                                    if (rawLinesSample.length < 5) rawLinesSample.push(raw);
                                    try {
                                        const ev = JSON.parse(raw);
                                        if (ev.error) {
                                            const errObj = ev.error;
                                            const errMsg = typeof errObj === 'string' ? errObj : (errObj.message || JSON.stringify(errObj));
                                            console.error('[SX PROXY] Upstream SSE error event:', errMsg);
                                const errMsg429 = (lastErrStatus === 429) ? ' (Günlük kota doldu — yarın sıfırlanır; faklı model deneyin)' : '';
                                const errMsg429b = (lastErrStatus === 429) ? ' (Günlük kota doldu — yarın sıfırlanır; faklı model deneyin)' : '';
                                const errMsgOpenRouter429 = (lastErrStatus === 429 && /openrouter|thinkingmachines|inkling/i.test(String(errTxt || '').slice(0, 300))) ? ' (OpenRouter Thinking Machines günlük limiti doldu — bu limit credits ile aşılama; önceki gün sonuna kadar bekleyin veya başka model seçin)' : '';
                                const errMsg413b = (lastErrStatus === 413 && /ITPM|input tokens per minute/i.test(String(lastErrTxt || '').slice(0, 300))) ? ' (Groq ITPM limiti aşıldı: mesajı kısaltın veya farklı model deneyin)' : '';
                                const errChunk = JSON.stringify({
                                    response: {
                                        candidates: [{
                                            content: { role: 'model', parts: [{ text: `Model servisi hata döndürdü${lastErrStatus ? ` (HTTP ${lastErrStatus})` : ''}: ${errTxt}${errMsg429b}${errMsg413b}${errMsgOpenRouter429}` }] },
                                            finishReason: 'STOP'
                                        }]
                                    }
                                });
                                            res.write(`data: ${errChunk}\n\n`);
                                            totalChunksSent++;
                                            break;
                                        }
                                        const choice = ev.choices?.[0];
                                        const delta = choice?.delta || {};
                                        // Capture real usage when upstream sends it (often last line with usage block)
                                        if (ev.usage) {
                                            openUsagePrompt = Number(ev.usage.prompt_tokens) || openUsagePrompt;
                                            openUsageComplete = Number(ev.usage.completion_tokens) || openUsageComplete;
                                        }
                                        if (choice?.finish_reason) {
                                            openStopReason = String(choice.finish_reason);
                                            dbgLog({ ..._dbgLastStats, lastFinishReason: choice.finish_reason, rawLinesSample });
                                        }

                                        // Reasoning / Thought (OpenRouter, DeepSeek, Ollama, etc.)
                                        let rc = '';
                                        if (typeof delta.reasoning === 'string') {
                                            rc = delta.reasoning;
                                        } else if (typeof delta.reasoning_content === 'string') {
                                            rc = delta.reasoning_content;
                                        } else if (typeof delta.thought === 'string') {
                                            rc = delta.thought;
                                        } else if (Array.isArray(delta.reasoning_details)) {
                                            rc = delta.reasoning_details.map(d => d.text || '').join('');
                                        }
                                        if (rc) {
                                            if (!firstTokenTime) firstTokenTime = Date.now();
                                            totalGeneratedChars += rc.length;
                                            openThinkChars += rc.length;
                                            bumpStreamProgress(reqConvKey, rc.length);
                                            console.log('[SX PROXY THOUGHT]', rc.replace(/\n/g, ' ').slice(0, 30));
                                            const chunk = JSON.stringify({
                                                response: {
                                                    candidates: [{
                                                        content: { role: 'model', parts: [{ text: rc, thought: true }] }
                                                    }]
                                                }
                                            });
                                            res.write(`data: ${chunk}\n\n`);
                                            totalChunksSent++;
                                        }

                                        if (delta.content) bumpStreamProgress(reqConvKey, delta.content.length);

                                        // Content (handling potential embedded <think>, <thought>, or [THINK] tags)
                                        let textStream = delta.content || '';
                                        while (textStream) {
                                            if (inThink) {
                                                let closeIdx = -1;
                                                let closeLen = 0;
                                                const c1 = textStream.indexOf('</think>');
                                                const c2 = textStream.indexOf('</thought>');
                                                const c3 = textStream.indexOf('[/THINK]');
                                                
                                                const candidates = [
                                                    { idx: c1, len: 8 },
                                                    { idx: c2, len: 10 },
                                                    { idx: c3, len: 8 }
                                                ].filter(c => c.idx !== -1).sort((a, b) => a.idx - b.idx);

                                                if (candidates.length > 0) {
                                                    closeIdx = candidates[0].idx;
                                                    closeLen = candidates[0].len;
                                                }

                                                if (closeIdx !== -1) {
                                                    const thTxt = textStream.slice(0, closeIdx);
                                                    inThink = false;
                                                    textStream = textStream.slice(closeIdx + closeLen);
                                                    if (thTxt) {
                                                        const chunk = JSON.stringify({
                                                            response: {
                                                                candidates: [{
                                                                    content: { role: 'model', parts: [{ text: thTxt, thought: true }] }
                                                                }]
                                                            }
                                                        });
                                                        res.write(`data: ${chunk}\n\n`);
                                                    }
                                                } else {
                                                    const chunk = JSON.stringify({
                                                        response: {
                                                            candidates: [{
                                                                content: { role: 'model', parts: [{ text: textStream, thought: true }] }
                                                            }]
                                                        }
                                                    });
                                                    res.write(`data: ${chunk}\n\n`);
                                                    textStream = '';
                                                }
                                            } else {
                                                let openIdx = -1;
                                                let openLen = 0;
                                                const o1 = textStream.indexOf('<think>');
                                                const o2 = textStream.indexOf('<thought>');
                                                const o3 = textStream.indexOf('[THINK]');

                                                const candidates = [
                                                    { idx: o1, len: 7 },
                                                    { idx: o2, len: 9 },
                                                    { idx: o3, len: 7 }
                                                ].filter(c => c.idx !== -1).sort((a, b) => a.idx - b.idx);

                                                if (candidates.length > 0) {
                                                    openIdx = candidates[0].idx;
                                                    openLen = candidates[0].len;
                                                }

                                                if (openIdx !== -1) {
                                                    const normTxt = textStream.slice(0, openIdx);
                                                    inThink = true;
                                                    textStream = textStream.slice(openIdx + openLen);
                                                        if (normTxt) {
                                                            if (!firstTokenTime) firstTokenTime = Date.now();
                                                            totalGeneratedChars += normTxt.length;
                                                            openNormalChars += normTxt.length;
                                                        const chunk = JSON.stringify({
                                                            response: {
                                                                candidates: [{
                                                                    content: { role: 'model', parts: [{ text: normTxt }] }
                                                                }]
                                                            }
                                                        });
                                                        res.write(`data: ${chunk}\n\n`);
                                                        totalChunksSent++;
                                                    }
                                                } else {
                                                    if (!firstTokenTime) firstTokenTime = Date.now();
                                                    totalGeneratedChars += textStream.length;
                                                    openNormalChars += textStream.length;
                                                            openThinkChars += textStream.length;
                                                    const chunk = JSON.stringify({
                                                        response: {
                                                            candidates: [{
                                                                content: { role: 'model', parts: [{ text: textStream }] }
                                                            }]
                                                        }
                                                    });
                                                    res.write(`data: ${chunk}\n\n`);
                                                    totalChunksSent++;
                                                    textStream = '';
                                                }
                                            }
                                        }

                                        // Tool calls
                                        if (Array.isArray(delta.tool_calls)) {
                                            for (const tc of delta.tool_calls) {
                                                const idx = tc.index ?? 0;
                                                if (!activeToolCalls[idx]) {
                                                    activeToolCalls[idx] = { name: '', arguments: '' };
                                                }
                                                if (tc.function?.name) activeToolCalls[idx].name += tc.function.name;
                                                if (tc.function?.arguments) activeToolCalls[idx].arguments += tc.function.arguments;
                                            }
                                        }
                                    } catch(e) {}
                                }
                            }

                            // Emit accumulated tool calls if any
                            const fcParts = [];
                            for (const idx of Object.keys(activeToolCalls).sort()) {
                                const tc = activeToolCalls[idx];
                                if (!tc.name) continue;
                                try { recordToolCall(reqConvKey, tc.name, tc.arguments); } catch(e){}
                                if (tc.name) openMsgTools.push(String(tc.name));
                                let parsedArgs = {};
                                try { parsedArgs = JSON.parse(tc.arguments || '{}'); } catch(e) { parsedArgs = { raw: tc.arguments }; }
                                fcParts.push({
                                    functionCall: {
                                        name: tc.name,
                                        args: parsedArgs
                                    }
                                });
                            }
                            if (fcParts.length > 0) {
                                const fnChunk = JSON.stringify({
                                    response: {
                                        candidates: [{
                                            content: { role: 'model', parts: fcParts },
                                            finishReason: 'STOP'
                                        }]
                                    }
                                });
                                res.write(`data: ${fnChunk}\n\n`);
                                totalChunksSent++;
                            }

                            // Record performance metrics for this conversation
                            const totalRequestMs = Date.now() - requestStartTime;
                            const ttftMs = firstTokenTime ? (firstTokenTime - requestStartTime) : totalRequestMs;
                            const estimatedCompTokens = Math.max(1, Math.round(totalGeneratedChars / 3.5));
                            const generationMs = Math.max(1, totalRequestMs - ttftMs);
                            const tps = Number(((estimatedCompTokens / (generationMs / 1000))).toFixed(1));

                            const perfData = {
                                ttftMs,
                                totalMs: totalRequestMs,
                                generationMs,
                                completionTokens: estimatedCompTokens,
                                normalTokens: sxEstToks(openNormalChars),
                                thinkingTokens: sxEstToks(openThinkChars),
                                promptTokens: (openUsagePrompt > 0 ? openUsagePrompt : Math.round(finalMsgChars / 3.5) + Math.round(finalToolsChars / 3.5)),
                                outputTokens: (openUsageComplete > 0 ? openUsageComplete : estimatedCompTokens),
                                toolCalls: openMsgTools.length,
                                toolCallNames: openMsgTools,
                                stopReason: openStopReason || '',
                                tps,
                                modelName: customModel?.name || customModel?.modelId || 'Custom Model',
                                timestamp: new Date().toISOString()
                            };
                            if (reqConvKey) recordMsgPerf(reqConvKey, perfData, Math.round(finalMsgChars / 3.5) + Math.round(finalToolsChars / 3.5));
                            console.log(`[SX PROXY PERF] ${reqConvKey || 'last'}: TTFT=${ttftMs}ms, Total=${totalRequestMs}ms, CompToks=${estimatedCompTokens}, Normal=${perfData.normalTokens}, Think=${perfData.thinkingTokens}, Tools=${perfData.toolCalls}, Stop=${perfData.stopReason || '-'}`);

                            // If model sent absolutely nothing (empty stream), emit a fallback to avoid
                            // "model output must contain either output text or tool calls" error
                            if (totalChunksSent === 0) {
                                console.warn('[SX PROXY] Model returned empty stream — sending fallback message');
                                dbgLog({ ..._dbgLastStats, totalChunksSent: 0, rawLinesSample });
                                const fallback = JSON.stringify({
                                    response: {
                                        candidates: [{
                                            content: { role: 'model', parts: [{ text: '_(Model boş yanıt döndürdü. Lütfen farklı bir model seçin veya tekrar deneyin.)_' }] },
                                            finishReason: 'STOP'
                                        }]
                                    }
                                });
                                res.write(`data: ${fallback}\n\n`);
                            }
                        }

                        // Send finish STOP frame (without empty text to avoid validation errors)
                        try { logDone({ conv: reqConvKey || null, event: 'done', proto, model: customModel?.modelId || customModel?.id || '?' }); } catch(e){}
                        const fin = JSON.stringify({
                            response: {
                                candidates: [{
                                    finishReason: 'STOP'
                                }]
                            }
                        });
                        res.write(`data: ${fin}\n\n`);
                        res.end();
                    } catch(err) {
                        console.error('[SX PROXY ERROR]', err);
                        try { logDone({ conv: (typeof reqConvKey !== 'undefined' ? reqConvKey : null), event: 'error', err: String((err && err.message) || err).slice(0, 200) }); } catch(e){}
                        const errChunk = JSON.stringify({
                            response: {
                                candidates: [{
                                    content: { role: 'model', parts: [{ text: `\nHata oluştu: ${err.message}` }] },
                                    finishReason: 'STOP'
                                }]
                            }
                        });
                        res.write(`data: ${errChunk}\n\n`);
                        res.end();
                    }
                });
                return;
            }

            // Proxy everything else to appropriate Google endpoint
            const targetBase = url.startsWith('/v1beta') ? 'https://generativelanguage.googleapis.com' : 'https://daily-cloudcode-pa.googleapis.com';
            const targetUrl = `${targetBase}${url}`;
            const fwdHeaders = { ...req.headers };
            delete fwdHeaders['host'];
            delete fwdHeaders['content-length'];

            let bodyChunks = [];
            req.on('data', chunk => {
                bodyChunks.push(chunk);
                if (Buffer.concat(bodyChunks).length > 2 * 1024 * 1024) {
                    console.error('[SX PROXY] Request body exceeded 2MB — aborting');
                    res.writeHead(413, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
                    res.end(JSON.stringify({ error: 'Body too large (max 2MB)' }));
                    req.destroy();
                }
            });
            req.on('end', async () => {
                const ctrl = new AbortController();
                const timer = setTimeout(() => { try { ctrl.abort(); } catch(e){} }, 60000);
                try {
                    const upstream = await fetch(targetUrl, {
                        method: req.method,
                        headers: fwdHeaders,
                        signal: ctrl.signal,
                        body: req.method !== 'GET' && req.method !== 'HEAD' ? Buffer.concat(bodyChunks) : undefined
                    });
                    const respBuffer = await upstream.arrayBuffer();
                    clearTimeout(timer);
                    const respHeaders = {};
                    upstream.headers.forEach((val, key) => {
                        if (key !== 'transfer-encoding' && key !== 'content-encoding') {
                            respHeaders[key] = val;
                        }
                    });
                    respHeaders['access-control-allow-origin'] = '*';
                    res.writeHead(upstream.status, respHeaders);
                    res.end(Buffer.from(respBuffer));
                } catch(e) {
                    clearTimeout(timer);
                    res.writeHead(502);
                    res.end(e.message);
                }
            });
        });

        server.on('error', (err) => {
            console.error('[SX PROXY Server Error]', err);
            resolve();
        });

        server.listen(15725, '127.0.0.1', () => {
            internalProxyServer = server;
            console.log('[SX PROXY] Running on http://127.0.0.1:15725');
            resolve();
        });
    });
}

module.exports = {
    startInternalProxy,
    inMemoryConfig
};
