/**
 * SX Core SDK - FetchInterceptor
 * Hooks window.fetch to inject Pro licenses, custom model configs, and routing into ConnectRPC calls.
 */
import { StreamAdapter } from './StreamAdapter.js';

export class FetchInterceptor {
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
        this.logger.info('FetchInterceptor', 'window.fetch interceptor registered.');
    }

    async handleFetch(context, args) {
        const url = args[0]?.toString() || '';

        // Internal SX Proxy or local endpoints pass through directly
        if (url.includes('/sx/') || url.includes(':15725')) {
            return this.origFetch.apply(context, args);
        }

        // 0. Native Antigravity Audio Transcription Interceptor (ConnectRPC)
        if (url.includes('StreamAudioTranscription')) {
            return this.handleStreamAudioTranscription(context, args);
        }
        if (url.includes('SendAudioChunk')) {
            return this.handleSendAudioChunk(context, args);
        }
        if (url.includes('EndAudioSession')) {
            return this.handleEndAudioSession(context, args);
        }

        // 1. Intercept GetUserStatus
        if (url.includes('GetUserStatus')) {
            try {
                const resp = await this.origFetch.apply(context, args);
                const clone = resp.clone();
                const buf = await clone.arrayBuffer();
                const u8 = new Uint8Array(buf);
                if (u8.length > 5 && u8[0] === 0) {
                    const dataLen = (u8[1] << 24) | (u8[2] << 16) | (u8[3] << 8) | u8[4];
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
                        const curActiveId = localStorage.getItem('sx_active_model_id');
                        const activeModel = configs.find(c => c.modelId === curActiveId) || configs[0];
                        const firstModel = activeModel?.modelOrAlias?.model || 'SX_EMPTY';
                        const firstModelId = activeModel?.modelId || 'sx-empty';
                        const modelRef = { versionId: 'v-custom', modelOrAlias: { model: firstModel } };

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
                    return new Response(combined, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
                }
                return resp;
            } catch(e) {
                this.logger.error('FetchInterceptor', 'GetUserStatus hook error', e);
            }
        }

        // 2. Attach conversation and model metadata and measure streaming performance for streamGenerateContent
        if (url.includes('streamGenerateContent')) {
            const reqStart = performance.now();
            let firstTokenTime = null;
            let totalBytes = 0;
            let convKey = '';
            let activeId = '';
            try {
                convKey = this.models.getActiveConversationKey();
                activeId = this.models.getActiveModelForConversation(convKey);
                if (activeId) {
                    // NOTE: never persist per-conversation bindings here. This hook also fires
                    // for background/subagent requests; writing sx_active_model_<conv> would
                    // freeze fallback values and clobber other conversations ("model keeps
                    // switching" bug). Explicit choices are persisted by the selector click path.
                    // Global last-used pointers are safe: they always reflect the visible convo.
                    localStorage.setItem('sx_last_used_model_id', activeId);
                    localStorage.setItem('sx_active_model_id', activeId);
                    if (!args[1]) args[1] = {};
                    if (!args[1].headers) args[1].headers = {};
                    if (args[1].headers instanceof Headers) {
                        args[1].headers.set('x-sx-model-id', activeId);
                        if (convKey) args[1].headers.set('x-sx-conv-key', convKey);
                    } else if (typeof args[1].headers.set === 'function') {
                        args[1].headers.set('x-sx-model-id', activeId);
                        if (convKey) args[1].headers.set('x-sx-conv-key', convKey);
                    } else {
                        args[1].headers['x-sx-model-id'] = activeId;
                        if (convKey) args[1].headers['x-sx-conv-key'] = convKey;
                    }
                }
            } catch(e) {}

            const resp = await this.origFetch.apply(context, args);

            try {
                if (resp && resp.body && typeof resp.body.getReader === 'function') {
                    const origReader = resp.body.getReader();
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
                                    const tps = Number(((compTokens / (genMs / 1000))).toFixed(1));
                                    const perfData = {
                                        ttftMs,
                                        totalMs,
                                        generationMs: genMs,
                                        completionTokens: compTokens,
                                        tps,
                                        modelName: activeId || 'Active Model',
                                        timestamp: new Date().toISOString()
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
                            } catch(err) {
                                controller.error(err);
                            }
                        },
                        cancel(reason) {
                            return origReader.cancel(reason);
                        }
                    });

                    return new Response(readable, {
                        status: resp.status,
                        statusText: resp.statusText,
                        headers: resp.headers
                    });
                }
            } catch(e) {}

            return resp;
        }

        const resp = await this.origFetch.apply(context, args);

        // 3. Intercept HasAuthToken
        if (url.includes('HasAuthToken')) {
            try {
                const clone = resp.clone();
                const buf = await clone.arrayBuffer();
                const u8 = new Uint8Array(buf);
                if (u8.length > 5 && u8[0] === 0) {
                    const dataLen = (u8[1] << 24) | (u8[2] << 16) | (u8[3] << 8) | u8[4];
                    const trailerBuf = u8.slice(5 + dataLen);
                    const newJsonBytes = new TextEncoder().encode(JSON.stringify({ hasToken: true }));
                    const newFrame0 = StreamAdapter.encodeFrame(0, newJsonBytes);
                    const combined = new Uint8Array(newFrame0.length + trailerBuf.length);
                    combined.set(newFrame0, 0);
                    combined.set(trailerBuf, newFrame0.length);
                    return new Response(combined, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
                }
            } catch(e) {}
        }

        // 4. Intercept GetAuthStatus
        if (url.includes('GetAuthStatus')) {
            try {
                const clone = resp.clone();
                const buf = await clone.arrayBuffer();
                const u8 = new Uint8Array(buf);
                if (u8.length > 5 && u8[0] === 0) {
                    const dataLen = (u8[1] << 24) | (u8[2] << 16) | (u8[3] << 8) | u8[4];
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
            } catch(e) {}
        }

        // 5. Intercept GetCascadeConfig
        if (url.includes('GetCascadeConfig') || url.includes('getCascadeConfig') || url.includes('cascade-config') || url.includes('CascadeConfig')) {
            try {
                const cfgs = this.models.buildCustomModelConfigs();
                if (cfgs.length > 0 && cfgs[0].modelOrAlias) {
                    const m = cfgs[0].modelOrAlias.model;
                    const mid = cfgs[0].modelId;
                    const ref = { versionId: 'v-custom', modelOrAlias: { model: m } };
                    const clone = resp.clone();
                    const buf = await clone.arrayBuffer();
                    const u8 = new Uint8Array(buf);
                    if (u8.length > 5 && u8[0] === 0) {
                        const dataLen = (u8[1] << 24) | (u8[2] << 16) | (u8[3] << 8) | u8[4];
                        const dataPayload = u8.slice(5, 5 + dataLen);
                        const trailerBuf = u8.slice(5 + dataLen);
                        const data = JSON.parse(new TextDecoder().decode(dataPayload));

                        const patchModelRefs = (obj) => {
                            if (!obj || typeof obj !== 'object') return;
                            if (obj.planModeModelConfig !== undefined) obj.planModeModelConfig = ref;
                            if (obj.defaultModelConfig !== undefined) obj.defaultModelConfig = ref;
                            if (obj.defaultOverrideModelConfig !== undefined) obj.defaultOverrideModelConfig = ref;
                            if (obj.defaultAgentModelId !== undefined) obj.defaultAgentModelId = mid;
                            if (obj.requestedModel !== undefined) obj.requestedModel = m;
                            if (obj.planModel !== undefined) obj.planModel = m;
                            for (const k of Object.keys(obj)) {
                                if (typeof obj[k] === 'object' && obj[k] !== null) patchModelRefs(obj[k]);
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
            } catch(e) {
                this.logger.error('FetchInterceptor', 'GetCascadeConfig hook error', e);
            }
        }

        return resp;
    }

    encodeGrpcFrame(flag, u8) {
        const frame = new Uint8Array(5 + u8.length);
        frame[0] = flag;
        frame[1] = (u8.length >>> 24) & 0xff;
        frame[2] = (u8.length >>> 16) & 0xff;
        frame[3] = (u8.length >>> 8) & 0xff;
        frame[4] = u8.length & 0xff;
        frame.set(u8, 5);
        return frame;
    }

    frameGrpcJson(obj, flag = 0) {
        return this.encodeGrpcFrame(flag, new TextEncoder().encode(JSON.stringify(obj)));
    }

    frameGrpcTrailer() {
        return this.encodeGrpcFrame(128, new TextEncoder().encode("grpc-status: 0\r\n\r\n"));
    }

    makeGrpcWebUnaryOk() {
        const f0 = this.frameGrpcJson({});
        const f128 = this.frameGrpcTrailer();
        const comb = new Uint8Array(f0.length + f128.length);
        comb.set(f0, 0);
        comb.set(f128, f0.length);
        return comb;
    }

    handleStreamAudioTranscription(context, args) {
        const self = this;
        const sessionId = 'sx_audio_' + Date.now();
        let streamCtrl = null;

        const session = {
            sessionId,
            phraseChunks: [],
            accumulatedBytes: 0,
            noiseFloor: 0.015,
            hadVoice: false,
            lastVoiceTime: 0,
            lastInterimTime: 0,
            checkInterval: null,
            isFinished: false,
            isTranscribing: false,

            addChunk(pcmBytes) {
                if (this.isFinished) return;
                this.phraseChunks.push(pcmBytes);
                this.accumulatedBytes += pcmBytes.length;

                const sampleCount = Math.floor(pcmBytes.length / 2);
                if (sampleCount > 0) {
                    const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
                    let sumSq = 0;
                    for (let i = 0; i < sampleCount; i++) {
                        const sample = view.getInt16(i * 2, true) / 32768.0;
                        sumSq += sample * sample;
                    }
                    const rms = Math.sqrt(sumSq / sampleCount);
                    if (rms < this.noiseFloor * 1.5) {
                        this.noiseFloor = this.noiseFloor * 0.96 + rms * 0.04;
                    }
                    if (rms > Math.max(0.018, this.noiseFloor * 2.0)) {
                        this.hadVoice = true;
                        this.lastVoiceTime = performance.now();
                    }
                }
            },

            async transcribe(isFinal = false) {
                if (this.isTranscribing) return;
                if (!this.phraseChunks.length || this.accumulatedBytes < 3200) return;

                const chunks = isFinal ? this.phraseChunks : [...this.phraseChunks];
                if (isFinal) {
                    this.phraseChunks = [];
                    this.accumulatedBytes = 0;
                    this.hadVoice = false;
                }

                this.isTranscribing = true;

                const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
                const merged = new Uint8Array(totalLen);
                let off = 0;
                for (const c of chunks) {
                    merged.set(c, off);
                    off += c.length;
                }

                const wavBlob = self.encodeWAV16(merged, 16000);
                try {
                    const lang = navigator.language || 'tr-TR';
                    const resp = await self.origFetch(`http://localhost:15725/sx/transcribe-audio?lang=${encodeURIComponent(lang)}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'audio/wav' },
                        body: wavBlob
                    });
                    const res = await resp.json();
                    if (res && res.ok && res.text) {
                        const text = res.text.trim();
                        if (text && streamCtrl && !this.isFinished) {
                            streamCtrl.enqueue(self.frameGrpcJson({
                                transcription: {
                                    text: text,
                                    isFinal: isFinal
                                }
                            }));
                        }
                    }
                } catch(e) {
                    console.error('[SX StreamAudio] Transcription failed:', e);
                } finally {
                    this.isTranscribing = false;
                }
            },

            async end() {
                if (this.isFinished) return;
                this.isFinished = true;
                if (this.checkInterval) {
                    clearInterval(this.checkInterval);
                    this.checkInterval = null;
                }
                if (this.accumulatedBytes >= 3200) {
                    await this.transcribe(true);
                }
                if (streamCtrl) {
                    streamCtrl.enqueue(self.frameGrpcJson({ complete: {} }));
                    streamCtrl.enqueue(self.frameGrpcTrailer());
                    try { streamCtrl.close(); } catch(e) {}
                }
            }
        };

        session.checkInterval = setInterval(() => {
            if (session.isFinished) return;
            const now = performance.now();
            if (session.hadVoice) {
                const silenceMs = now - session.lastVoiceTime;
                // Case 1: User paused speaking (> 300ms) -> commit final text
                if (silenceMs >= 300 && session.accumulatedBytes >= 4800) {
                    session.transcribe(true);
                }
                // Case 2: User is actively speaking -> stream interim ghost-text every 350ms
                else if (silenceMs < 300 && (now - session.lastInterimTime) >= 350 && session.accumulatedBytes >= 6400) {
                    session.lastInterimTime = now;
                    session.transcribe(false);
                }
            }
        }, 60);

        this.activeAudioSession = session;

        const stream = new ReadableStream({
            start(controller) {
                streamCtrl = controller;
                controller.enqueue(self.frameGrpcJson({
                    ready: { sessionId }
                }));
            },
            cancel() {
                session.end();
            }
        });

        return new Response(stream, {
            status: 200,
            headers: {
                'Content-Type': 'application/grpc-web+json'
            }
        });
    }

    async handleSendAudioChunk(context, args) {
        try {
            let bodyBytes = args[1]?.body;
            if (bodyBytes) {
                let jsonStr = '';
                if (typeof bodyBytes === 'string') {
                    jsonStr = bodyBytes;
                } else if (bodyBytes instanceof Uint8Array || bodyBytes instanceof ArrayBuffer) {
                    const u8 = bodyBytes instanceof Uint8Array ? bodyBytes : new Uint8Array(bodyBytes);
                    if (u8.length > 5 && u8[0] === 0) {
                        const dataLen = (u8[1] << 24) | (u8[2] << 16) | (u8[3] << 8) | u8[4];
                        jsonStr = new TextDecoder().decode(u8.slice(5, 5 + dataLen));
                    } else {
                        jsonStr = new TextDecoder().decode(u8);
                    }
                }
                if (jsonStr) {
                    const data = JSON.parse(jsonStr);
                    if (data.data && this.activeAudioSession) {
                        let pcmBytes;
                        if (typeof data.data === 'string') {
                            const binary = atob(data.data);
                            pcmBytes = new Uint8Array(binary.length);
                            for (let i = 0; i < binary.length; i++) {
                                pcmBytes[i] = binary.charCodeAt(i);
                            }
                        } else if (Array.isArray(data.data)) {
                            pcmBytes = new Uint8Array(data.data);
                        }
                        if (pcmBytes) {
                            this.activeAudioSession.addChunk(pcmBytes);
                        }
                    }
                }
            }
        } catch(e) {}

        return new Response(this.makeGrpcWebUnaryOk(), {
            status: 200,
            headers: { 'Content-Type': 'application/grpc-web+json' }
        });
    }

    async handleEndAudioSession(context, args) {
        if (this.activeAudioSession) {
            await this.activeAudioSession.end();
            this.activeAudioSession = null;
        }
        return new Response(this.makeGrpcWebUnaryOk(), {
            status: 200,
            headers: { 'Content-Type': 'application/grpc-web+json' }
        });
    }


    encodeWAV16(pcmBytes, sampleRate = 16000) {
        const buffer = new ArrayBuffer(44 + pcmBytes.length);
        const view = new DataView(buffer);
        const writeStr = (off, s) => {
            for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
        };
        writeStr(0, 'RIFF');
        view.setUint32(4, 36 + pcmBytes.length, true);
        writeStr(8, 'WAVE');
        writeStr(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, 1, true); // Mono
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true); // 16-bit
        writeStr(36, 'data');
        view.setUint32(40, pcmBytes.length, true);
        new Uint8Array(buffer, 44).set(pcmBytes);
        return new Blob([buffer], { type: 'audio/wav' });
    }
}
