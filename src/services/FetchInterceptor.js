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

        // 2. Attach conversation and model metadata to streamGenerateContent
        if (url.includes('streamGenerateContent')) {
            try {
                const convKey = this.models.getActiveConversationKey();
                const convModel = convKey ? localStorage.getItem('sx_active_model_' + convKey) : null;
                const activeId = convModel || localStorage.getItem('sx_active_model_id');
                if (activeId) {
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

        // 6. Handle StreamAudioTranscription & SendAudioChunk safely
        if (url.includes('StreamAudioTranscription') || url.includes('SendAudioChunk')) {
            const emptyBytes = new TextEncoder().encode(JSON.stringify({}));
            const frame0 = StreamAdapter.encodeFrame(0, emptyBytes);
            return new Response(frame0, {
                status: 200,
                headers: { 'content-type': 'application/connect+json' }
            });
        }

        return resp;
    }
}
