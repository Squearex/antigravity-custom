(function() {
    console.log('[SX Studio] Initializing direct mode inject (Gateway decoupled)...');

    function encodeFrame(flag, payloadU8) {
        const frame = new Uint8Array(5 + payloadU8.length);
        frame[0] = flag;
        frame[1] = (payloadU8.length >>> 24) & 0xff;
        frame[2] = (payloadU8.length >>> 16) & 0xff;
        frame[3] = (payloadU8.length >>> 8) & 0xff;
        frame[4] = payloadU8.length & 0xff;
        frame.set(payloadU8, 5);
        return frame;
    }

    // Persistent storage initialization (fixes dynamic port localStorage reset)
    try {
        const saved = window.__SX_SAVED_CONFIG__;
        if (saved) {
            if (Array.isArray(saved.providers) && saved.providers.length > 0) {
                const curP = JSON.parse(localStorage.getItem('sx_providers') || '[]');
                if (saved.providers.length >= curP.length || !curP.length) {
                    localStorage.setItem('sx_providers', JSON.stringify(saved.providers));
                }
            }
            if (Array.isArray(saved.models) && saved.models.length > 0) {
                const curM = JSON.parse(localStorage.getItem('sx_models') || '[]');
                if (saved.models.length >= curM.length || !curM.length) {
                    localStorage.setItem('sx_models', JSON.stringify(saved.models));
                }
            }
        }
    } catch(e) {}

    // Fetch latest persisted config from proxy using XHR (bypasses fetch interceptor)
    function sxFetchPersistedConfig() {
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', 'http://127.0.0.1:15725/sx/get-config', true);
            xhr.onload = () => {
                try {
                    const data = JSON.parse(xhr.responseText);
                    if (Array.isArray(data.providers) && data.providers.length > 0) {
                        localStorage.setItem('sx_providers', JSON.stringify(data.providers));
                        if (!window.__SX_SAVED_CONFIG__) window.__SX_SAVED_CONFIG__ = {};
                        window.__SX_SAVED_CONFIG__.providers = data.providers;
                    }
                    if (Array.isArray(data.models) && data.models.length > 0) {
                        localStorage.setItem('sx_models', JSON.stringify(data.models));
                        if (!window.__SX_SAVED_CONFIG__) window.__SX_SAVED_CONFIG__ = {};
                        window.__SX_SAVED_CONFIG__.models = data.models;
                    }
                } catch(e) {}
            };
            xhr.send();
        } catch(e) {}
    }
    sxFetchPersistedConfig();

    // ────────────────────────────────────────────────────────────────────────
    // SX Theme Presets & Engine
    // ────────────────────────────────────────────────────────────────────────
    const SX_THEME_PRESETS = [
        {
            id: 'sx-signature',
            name: 'SX Development Pro',
            badge: 'Official ⭐',
            desc: 'Derin obsidyen arka plan, elektrik camgöbeği ışıma ve buz beyazı metinler',
            background: '#0B0F17',
            foreground: '#F8FAFC',
            primary: '#38BDF8',
            tagColor: '#38bdf8'
        },
        {
            id: 'sx-cyberpunk',
            name: 'SX Cyberpunk Neon',
            badge: 'High Contrast',
            desc: 'Koyu synthwave atmosferi ve elektrik menekşe/mor aksan',
            background: '#08090E',
            foreground: '#F1F5F9',
            primary: '#A855F7',
            tagColor: '#a855f7'
        },
        {
            id: 'sx-oled',
            name: 'SX OLED Pure Black',
            badge: 'Zero Lux',
            desc: 'Tamamen saf %100 siyah OLED zemin ve zümrüt yeşili lazer aksan',
            background: '#000000',
            foreground: '#F8FAFC',
            primary: '#10B981',
            tagColor: '#10b981'
        },
        {
            id: 'sx-crimson',
            name: 'SX Crimson Eclipse',
            badge: 'Vampiric',
            desc: 'Derin yakut kırmızısı gölgeler ve keskin gül-kırmızı aksan',
            background: '#11090D',
            foreground: '#FFF1F2',
            primary: '#F43F5E',
            tagColor: '#f43f5e'
        },
        {
            id: 'sx-amber',
            name: 'SX Sunset Amber',
            badge: 'Warm',
            desc: 'Sıcak kömür tonları ve parıldayan altın kehribar ışıltısı',
            background: '#12100C',
            foreground: '#FEF3C7',
            primary: '#F59E0B',
            tagColor: '#f59e0b'
        },
        {
            id: 'sx-arctic',
            name: 'SX Arctic Glacier',
            badge: 'Cool Frost',
            desc: 'Kutup soğuğu lacivert zemin ve parlak buzul turkuazı detaylar',
            background: '#0A1118',
            foreground: '#E6F4F8',
            primary: '#06B6D4',
            tagColor: '#06b6d4'
        },
        {
            id: 'sx-amethyst',
            name: 'SX Royal Amethyst',
            badge: 'Luxury',
            desc: 'Kadife imparatorluk obsidyeni ve lüks lavanta mor aydınlatması',
            background: '#0F0B18',
            foreground: '#F3E8FF',
            primary: '#C084FC',
            tagColor: '#c084fc'
        },
        {
            id: 'sx-tokyo',
            name: 'SX Tokyo Neon',
            badge: 'Atmosphere',
            desc: 'Gece yarısı indigo zemin ve modern Tokyo mavisi aurası',
            background: '#13141F',
            foreground: '#C0CAF5',
            primary: '#7AA2F7',
            tagColor: '#7aa2f7'
        }
    ];

    // ────────────────────────────────────────────────────────────────────────
    // Antigravity Native Theme Dictionary Integration & Crash Prevention
    // ────────────────────────────────────────────────────────────────────────
    function sxPatchNativeThemeDict() {
        try {
            if (typeof F$ !== 'undefined') {
                ['dark', 'light'].forEach(mode => {
                    if (F$[mode] && !F$[mode].__sxPatched) {
                        SX_THEME_PRESETS.forEach(p => {
                            F$[mode][p.name] = {
                                background: p.background,
                                foregroundOverride: p.foreground,
                                primary: p.primary
                            };
                        });
                        F$[mode] = new Proxy(F$[mode], {
                            get(target, prop) {
                                if (prop in target) return target[prop];
                                if (typeof prop === 'string') {
                                    const sx = SX_THEME_PRESETS.find(p => p.name === prop || p.id === prop);
                                    if (sx) return { background: sx.background, foregroundOverride: sx.foreground, primary: sx.primary };
                                    return target[mode === 'light' ? 'Default Light' : 'Default Dark'] || Object.values(target)[0];
                                }
                                return target[prop];
                            }
                        });
                        F$[mode].__sxPatched = true;
                    }
                });
            }
        } catch(e) {}
    }
    sxPatchNativeThemeDict();
    setInterval(sxPatchNativeThemeDict, 300);

    // Safe Storage hook to prevent "Cannot read properties of undefined (reading 'background')"
    try {
        const _origGetItem = Storage.prototype.getItem;
        Storage.prototype.getItem = function(key) {
            const val = _origGetItem.apply(this, arguments);
            if (key === 'theme-preset-dark' || key === 'theme-preset-light') {
                if (typeof F$ === 'undefined' || !F$?.dark?.[val]) {
                    const isSX = SX_THEME_PRESETS.some(p => p.name === val || p.id === val);
                    if (isSX) {
                        sxPatchNativeThemeDict();
                        if (typeof F$ === 'undefined' || !F$?.dark?.[val]) {
                            return 'Default Dark';
                        }
                    }
                }
            }
            return val;
        };
    } catch(e) {}

    function setNativeValue(element, value) {
        if (!element) return;
        const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
        const prototype = Object.getPrototypeOf(element);
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
            prototypeValueSetter.call(element, value);
        } else if (valueSetter) {
            valueSetter.call(element, value);
        } else {
            element.value = value;
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function getAntigravityCustomThemeSeedsProvider() {
        try {
            const all = Array.from(document.querySelectorAll('*'));
            const elWithFiber = all.find(el => Object.keys(el).some(k => k.startsWith('__reactFiber')));
            if (!elWithFiber) return null;
            const fiberKey = Object.keys(elWithFiber).find(k => k.startsWith('__reactFiber'));
            let rootFiber = elWithFiber[fiberKey];
            while (rootFiber && rootFiber.return) rootFiber = rootFiber.return;
            
            let provider = null;
            function walk(fiber) {
                if (!fiber || provider) return;
                if (fiber.memoizedProps?.value?.customThemeSeedsProvider) {
                    provider = fiber.memoizedProps.value.customThemeSeedsProvider;
                    return;
                }
                walk(fiber.child);
                walk(fiber.sibling);
            }
            walk(rootFiber);
            return provider;
        } catch(e) {
            return null;
        }
    }

    function sxApplyThemePreset(presetOrId, saveToServer = true) {
        try {
            const preset = typeof presetOrId === 'string'
                ? SX_THEME_PRESETS.find(p => p.id === presetOrId) || SX_THEME_PRESETS[0]
                : presetOrId;
            if (!preset) return;

            sxPatchNativeThemeDict();
            localStorage.setItem('sx_active_theme_preset', preset.id);
            localStorage.setItem('theme-preset-dark', preset.name);

            // 1. Push to Antigravity's NATIVE Jetbox Theme Provider
            const provider = getAntigravityCustomThemeSeedsProvider();
            if (provider && typeof provider.pushUpdate === 'function') {
                const curState = provider.getState() || {};
                provider.pushUpdate({
                    ...curState,
                    dark: {
                        $typeName: 'jetbox_state_pb.CustomThemeSeeds',
                        background: preset.background,
                        foregroundOverride: preset.foreground,
                        primary: preset.primary
                    }
                });
            }

            // 2. Direct CSS variable updates on document.documentElement
            const root = document.documentElement;
            root.style.setProperty('--background', preset.background);
            root.style.setProperty('--foreground', preset.foreground);
            root.style.setProperty('--primary', preset.primary);
            root.style.setProperty('--sidebar-background', preset.background);

            // 3. Syntax Highlighting CSS Variables (matching Antigravity's native i7b)
            if (document.body) {
                const bStyle = document.body.style;
                bStyle.setProperty('--syntax-comment', '#64748B');
                bStyle.setProperty('--syntax-punctuation', preset.foreground);
                bStyle.setProperty('--syntax-property', preset.primary);
                bStyle.setProperty('--syntax-tag', preset.tagColor || preset.primary);
                bStyle.setProperty('--syntax-constant', '#F59E0B');
                bStyle.setProperty('--syntax-number', '#F59E0B');
                bStyle.setProperty('--syntax-string', '#10B981');
                bStyle.setProperty('--syntax-attr-name', preset.primary);
                bStyle.setProperty('--syntax-builtin', '#06B6D4');
                bStyle.setProperty('--syntax-operator', preset.foreground);
                bStyle.setProperty('--syntax-variable', preset.foreground);
                bStyle.setProperty('--syntax-attr-value', '#10B981');
                bStyle.setProperty('--syntax-keyword', preset.primary);
                bStyle.setProperty('--syntax-function', '#38BDF8');
                bStyle.setProperty('--syntax-class-name', '#F59E0B');
                bStyle.setProperty('--syntax-regex', '#EC4899');
                bStyle.setProperty('--syntax-default-fg', 'var(--foreground)');
            }

            // 4. If Settings > Appearance dialog is open, sync via Antigravity's native inputs
            const d = document.querySelector('[role="dialog"]');
            if (d) {
                const darkThemeH3 = Array.from(d.querySelectorAll('*')).find(el => el.children.length === 0 && el.textContent.trim() === 'Dark Theme');
                if (darkThemeH3) {
                    const card = darkThemeH3.closest('.border') || darkThemeH3.parentElement.parentElement;
                    if (card) {
                        const inputs = Array.from(card.querySelectorAll('input.uppercase, input[type="text"]'));
                        if (inputs.length >= 3) {
                            const bgClean = preset.background.replace('#', '').toUpperCase();
                            const fgClean = preset.foreground.replace('#', '').toUpperCase();
                            const prClean = preset.primary.replace('#', '').toUpperCase();
                            setNativeValue(inputs[0], bgClean);
                            setNativeValue(inputs[1], fgClean);
                            setNativeValue(inputs[2], prClean);
                        }
                        const btnSpan = card.querySelector('#sx-preset-combobox-btn .sx-preset-btn-name');
                        if (btnSpan) btnSpan.innerText = preset.name;
                        const btnDot = card.querySelector('#sx-preset-btn-dot');
                        if (btnDot) {
                            btnDot.style.background = preset.primary;
                            btnDot.style.boxShadow = `0 0 5px ${preset.primary}`;
                        }
                    }
                }
            }

            // 5. Update Quick Pills active state
            document.querySelectorAll('.sx-preset-pill').forEach(pill => {
                const isMatch = pill.dataset.sxId === preset.id;
                if (isMatch) {
                    pill.style.borderColor = preset.primary;
                    pill.style.background = 'rgba(255,255,255,0.14)';
                    pill.style.color = '#ffffff';
                } else {
                    pill.style.borderColor = 'rgba(255,255,255,0.1)';
                    pill.style.background = 'rgba(255,255,255,0.05)';
                    pill.style.color = 'rgba(255,255,255,0.85)';
                }
            });

            // 6. Persist to config.json via sxProxy
            if (saveToServer) {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', 'http://127.0.0.1:15725/sx/save-theme', true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.send(JSON.stringify({
                    background: preset.background,
                    foregroundOverride: preset.foreground,
                    primary: preset.primary
                }));
            }
        } catch(e) {
            console.error('[SX Theme] Apply error:', e);
        }
    }

    // Export helpers to window
    window.SX_THEME_PRESETS = SX_THEME_PRESETS;
    window.sxApplyThemePreset = sxApplyThemePreset;

    // Storage helpers: always prioritize whichever has the most up-to-date models
    function getSXProviders() {
        try {
            const diskList = window.__SX_SAVED_CONFIG__?.providers;
            const localList = JSON.parse(localStorage.getItem('sx_providers') || '[]');
            if (Array.isArray(diskList) && diskList.length >= localList.length && diskList.length > 0) {
                return diskList;
            }
            if (localList.length) return localList;
            if (Array.isArray(diskList) && diskList.length > 0) return diskList;
            return [];
        } catch(e) { return []; }
    }
    function getSXModels() {
        try {
            const diskList = window.__SX_SAVED_CONFIG__?.models;
            const localList = JSON.parse(localStorage.getItem('sx_models') || '[]');
            if (Array.isArray(diskList) && diskList.length >= localList.length && diskList.length > 0) {
                return diskList;
            }
            if (localList.length) return localList;
            if (Array.isArray(diskList) && diskList.length > 0) return diskList;
            return [];
        } catch(e) { return []; }
    }
    function getSXActiveModelName() {
        return window._lastSyncedModel || '';
    }

    function formatContextSize(num) {
        if (!num) return '';
        const n = Number(num);
        if (isNaN(n) || n <= 0) return '';
        if (n >= 1048576) return Math.round(n / 1048576) + 'M';
        if (n >= 1000) return Math.round(n / 1024) + 'k';
        return String(n);
    }

    const SX_PRESETS = [
        { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', protocol: 'openai', modelsPath: '/models' },
        { id: 'kilo',       name: 'Kilo AI',    baseUrl: 'https://api.kilo.ai/v1',        protocol: 'openai', modelsPath: '/models' },
        { id: 'kira',       name: 'Kira AI',    baseUrl: 'https://api.kira.ai/v1',        protocol: 'openai', modelsPath: '/models' },
        { id: 'anthropic',  name: 'Anthropic',  baseUrl: 'https://api.anthropic.com',     protocol: 'anthropic', modelsPath: '/v1/models' },
        { id: 'openai',     name: 'OpenAI',     baseUrl: 'https://api.openai.com/v1',     protocol: 'openai', modelsPath: '/models' },
        { id: 'deepseek',   name: 'DeepSeek',   baseUrl: 'https://api.deepseek.com/v1',   protocol: 'openai', modelsPath: '/models' },
        { id: 'groq',       name: 'Groq',       baseUrl: 'https://api.groq.com/openai/v1', protocol: 'openai', modelsPath: '/models' },
        { id: 'mistral',    name: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1',     protocol: 'openai', modelsPath: '/models' },
        { id: 'together',   name: 'Together AI', baseUrl: 'https://api.together.xyz/v1',  protocol: 'openai', modelsPath: '/models' },
        { id: 'fireworks',  name: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1', protocol: 'openai', modelsPath: '/models' },
        { id: 'xai',        name: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1',           protocol: 'openai', modelsPath: '/models' },
        { id: 'gemini',     name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', protocol: 'openai', modelsPath: '/models' },
        { id: 'siliconflow', name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', protocol: 'openai', modelsPath: '/models' },
        { id: 'qwen',       name: 'Qwen / DashScope', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', protocol: 'openai', modelsPath: '/models' },
        { id: 'cohere',     name: 'Cohere',     baseUrl: 'https://api.cohere.com/v2',     protocol: 'openai', modelsPath: '/models' },
        { id: 'perplexity', name: 'Perplexity', baseUrl: 'https://api.perplexity.ai',    protocol: 'openai', modelsPath: '/models' },
        { id: 'ollama',     name: 'Ollama (Local)', baseUrl: 'http://127.0.0.1:11434/v1', protocol: 'openai', modelsPath: '/models' },
        { id: 'lmstudio',   name: 'LM Studio',  baseUrl: 'http://127.0.0.1:1234/v1',     protocol: 'openai', modelsPath: '/models' },
        { id: 'custom',     name: 'Custom Endpoint', baseUrl: '',                         protocol: 'openai', modelsPath: '/models' }
    ];

    function getSXProviderMeta(providerIdOrName) {
        let prov = null;
        try {
            const providers = getSXProviders();
            if (typeof providerIdOrName === 'string') {
                prov = providers.find(p => p.id === providerIdOrName || (p.name && p.name.toLowerCase() === providerIdOrName.toLowerCase()));
            } else if (providerIdOrName && typeof providerIdOrName === 'object') {
                prov = providerIdOrName;
            }
        } catch (e) {}
        const name = prov ? prov.name : (typeof providerIdOrName === 'string' ? providerIdOrName : 'Custom');
        const pLower = (name || '').toLowerCase();
        let dotColor = '#10b981'; // default emerald
        if (pLower.includes('kilo')) dotColor = '#f97316'; // warm orange
        else if (pLower.includes('kira')) dotColor = '#f59e0b'; // amber
        else if (pLower.includes('anthropic')) dotColor = '#a855f7'; // violet
        else if (pLower.includes('openrouter')) dotColor = '#06b6d4'; // cyan / sky blue
        else if (pLower.includes('deepseek')) dotColor = '#3b82f6'; // deep blue
        else if (pLower.includes('groq')) dotColor = '#f43f5e'; // rose/orange
        else if (pLower.includes('mistral')) dotColor = '#ea580c'; // amber orange
        else if (pLower.includes('together')) dotColor = '#6366f1'; // indigo
        else if (pLower.includes('fireworks')) dotColor = '#ec4899'; // pink
        else if (pLower.includes('xai') || pLower.includes('grok')) dotColor = '#ffffff'; // white
        else if (pLower.includes('gemini') || pLower.includes('google')) dotColor = '#4285f4'; // google blue
        else if (pLower.includes('silicon')) dotColor = '#14b8a6'; // teal
        else if (pLower.includes('qwen') || pLower.includes('dashscope')) dotColor = '#8b5cf6'; // purple
        else if (pLower.includes('cohere')) dotColor = '#d97706'; // coral
        else if (pLower.includes('perplexity')) dotColor = '#22d3ee'; // light cyan
        else if (pLower.includes('ollama') || pLower.includes('lm studio')) dotColor = '#84cc16'; // lime green
        return { id: prov ? prov.id : '', name, dotColor, protocol: prov?.protocol || 'openai' };
    }

    // Internal helper: route external fetches through sxProxy to avoid CORS blocks.
    // Uses XMLHttpRequest (not fetch) to bypass the SX fetch interceptor which would
    // otherwise hijack requests to 127.0.0.1:15725 and route them to the language server.
    function sxProxyFetch(targetUrl, method, headers, body) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', 'http://127.0.0.1:15725/sx/proxy-fetch', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.onload = () => {
                // Wrap XHR in a fetch-like Response object
                const status = xhr.status;
                const responseText = xhr.responseText;
                resolve({
                    ok: status >= 200 && status < 300,
                    status,
                    text: () => Promise.resolve(responseText),
                    json: () => {
                        try { return Promise.resolve(JSON.parse(responseText)); }
                        catch(e) { return Promise.reject(e); }
                    }
                });
            };
            xhr.onerror = () => reject(new Error('Network error reaching sxProxy'));
            xhr.ontimeout = () => reject(new Error('Timeout reaching sxProxy'));
            xhr.timeout = 15000;
            xhr.send(JSON.stringify({ url: targetUrl, method: method || 'GET', headers: headers || {}, body }));
        });
    }

    async function sxTestProvider(baseUrl, apiKey, protocol) {
        const t0 = Date.now();
        const proto = (protocol || 'openai').toLowerCase();
        let testUrl, headers;
        // Normalize: strip trailing /chat/completions (user may paste the completions URL as base)
        const normalBase = (baseUrl || '').replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '');
        if (proto === 'anthropic') {
            testUrl = (normalBase || 'https://api.anthropic.com') + '/v1/models';
            headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
        } else {
            testUrl = (normalBase || 'https://api.openai.com/v1') + '/models';
            headers = { 'Authorization': 'Bearer ' + apiKey };
        }
        const resp = await sxProxyFetch(testUrl, 'GET', headers);
        const ms = Date.now() - t0;
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return { ok: true, ms };
    }

    async function sxFetchModels(baseUrl, apiKey, protocol, modelsPath) {
        const proto = (protocol || 'openai').toLowerCase();
        let url, headers;
        // Normalize: strip trailing /chat/completions suffix
        const normalBase = (baseUrl || '').replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '');
        if (proto === 'anthropic') {
            url = (normalBase || 'https://api.anthropic.com') + (modelsPath || '/v1/models');
            headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
        } else {
            url = (normalBase || 'https://api.openai.com/v1') + (modelsPath || '/models');
            headers = { 'Authorization': 'Bearer ' + apiKey };
        }
        const resp = await sxProxyFetch(url, 'GET', headers);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        const list = data.data || data.models || (Array.isArray(data) ? data : []);
        return list.map(m => ({
            id: m.id || m.name || String(m),
            name: m.display_name || m.name || m.id || String(m)
        })).filter(m => m.id);
    }

    function frameJSON(obj, flag = 0) {
        const jsonBytes = new TextEncoder().encode(JSON.stringify(obj));
        return encodeFrame(flag, jsonBytes);
    }

    function makeAGChunk(text, thought) {
        const part = thought ? { text, thought: true } : { text };
        return frameJSON({
            candidates: [{ content: { role: 'model', parts: [part] } }]
        });
    }

    function makeAGFinish() {
        return frameJSON({
            candidates: [{ content: { role: 'model', parts: [{ text: '' }] }, finishReason: 'STOP' }]
        });
    }

    function makeAGError(msg) {
        return frameJSON({
            error: { code: 500, message: msg }
        });
    }

    // Direct stream generator: converts OpenAI/Anthropic SSE to Connect format
    async function sxDirectStream(provider, modelId, reqJson, reqContentType) {
        const contents = reqJson?.contents || [];
        const systemInstruction = reqJson?.systemInstruction;
        const systemParts = systemInstruction?.parts || [];
        let systemText = systemParts.map(p => p.text || '').filter(Boolean).join('\n');

        const messages = [];
        for (const c of contents) {
            if (!c.parts || !Array.isArray(c.parts)) continue;
            const text = c.parts.map(p => p.text || '').join('');
            if (!text.trim()) continue;
            messages.push({ role: c.role === 'user' ? 'user' : 'assistant', content: text });
        }
        if (!messages.length) messages.push({ role: 'user', content: 'Hello' });

        const proto = (provider.protocol || 'openai').toLowerCase();
        let apiUrl, headers, body;

        if (proto === 'anthropic') {
            apiUrl = (provider.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '') + '/v1/messages';
            headers = {
                'Content-Type': 'application/json',
                'x-api-key': provider.apiKey || '',
                'anthropic-version': '2023-06-01',
            };
            body = JSON.stringify({
                model: modelId,
                max_tokens: 16000,
                stream: true,
                system: systemText || undefined,
                messages
            });
        } else {
            const cleanBase = (provider.baseUrl || 'https://api.openai.com/v1').replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '');
            apiUrl = cleanBase + '/chat/completions';
            headers = {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + (provider.apiKey || ''),
            };
            const oaMsgs = systemText ? [{ role: 'system', content: systemText }, ...messages] : messages;
            body = JSON.stringify({
                model: modelId,
                stream: true,
                messages: oaMsgs
            });
        }

        const apiResp = await origFetch(apiUrl, { method: 'POST', headers, body });
        if (!apiResp.ok) {
            const errTxt = await apiResp.text().catch(() => 'HTTP ' + apiResp.status);
            const errStream = new ReadableStream({
                start(ctrl) {
                    ctrl.enqueue(makeAGError(errTxt));
                    ctrl.close();
                }
            });
            return new Response(errStream, {
                status: 200,
                headers: { 'Content-Type': reqContentType || 'application/connect+json', 'Cache-Control': 'no-cache' }
            });
        }

        const isAnthropicProto = (proto === 'anthropic');
        const stream = new ReadableStream({
            async start(ctrl) {
                const reader = apiResp.body.getReader();
                const dec = new TextDecoder();
                let buf = '';
                let inThink = false;
                const send = (txt, thought) => ctrl.enqueue(makeAGChunk(txt, thought));

                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buf += dec.decode(value, { stream: true });
                        const lines = buf.split('\n');
                        buf = lines.pop();
                        for (const line of lines) {
                            if (!line.startsWith('data: ')) continue;
                            const raw = line.slice(6).trim();
                            if (raw === '[DONE]') continue;
                            try {
                                const ev = JSON.parse(raw);
                                if (isAnthropicProto) {
                                    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
                                        send(ev.delta.text, false);
                                    } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta') {
                                        send(ev.delta.thinking, true);
                                    } else if (ev.type === 'message_stop') {
                                        ctrl.enqueue(makeAGFinish());
                                    }
                                } else {
                                    const delta = (ev.choices || [{}])[0]?.delta || {};
                                    if (delta.reasoning_content) send(delta.reasoning_content, true);
                                    if (delta.content) {
                                        let txt = delta.content;
                                        while (txt) {
                                            if (inThink) {
                                                if (txt.includes('</think>')) {
                                                    const idx = txt.indexOf('</think>');
                                                    send(txt.slice(0, idx), true);
                                                    inThink = false;
                                                    txt = txt.slice(idx + 8);
                                                } else { send(txt, true); txt = ''; }
                                            } else {
                                                if (txt.includes('<think>')) {
                                                    const idx = txt.indexOf('<think>');
                                                    if (idx > 0) send(txt.slice(0, idx), false);
                                                    inThink = true;
                                                    txt = txt.slice(idx + 7);
                                                } else { send(txt, false); txt = ''; }
                                            }
                                        }
                                    }
                                    if ((ev.choices || [{}])[0]?.finish_reason) {
                                        ctrl.enqueue(makeAGFinish());
                                    }
                                }
                            } catch(e) {}
                        }
                    }
                } catch(e) {
                    ctrl.enqueue(makeAGError('Stream error: ' + e.message));
                }
                
                // End Connect stream with EndStreamResponse frame
                if ((reqContentType || '').includes('connect')) {
                    ctrl.enqueue(frameJSON({ flags: 0, metadata: {} }, 2)); // 0x02 is EndStream in Connect
                } else if ((reqContentType || '').includes('grpc')) {
                    ctrl.enqueue(frameJSON({ "grpc-status": "0", "grpc-message": "OK" }, 0x80)); // 0x80 is trailer in gRPC
                }
                ctrl.close();
            }
        });

        return new Response(stream, {
            status: 200,
            headers: { 'Content-Type': reqContentType || 'application/connect+json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' }
        });
    }

    const ALLOWED_TIERS = [
        "TEAMS_TIER_PRO", "TEAMS_TIER_TEAMS", "TEAMS_TIER_ENTERPRISE_SELF_HOSTED",
        "TEAMS_TIER_ENTERPRISE_SAAS", "TEAMS_TIER_HYBRID", "TEAMS_TIER_PRO_ULTIMATE"
    ];

    function sxSyncConfigToProxy(forceClear = false) {
        try {
            const providers = getSXProviders();
            const models = getSXModels();
            if (!forceClear && !providers.length && !models.length) {
                return; // Guard: never wipe proxy with empty config
            }
            fetch('http://127.0.0.1:15725/sx/update-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ providers, models, forceClear })
            }).catch(() => {});
        } catch(e) {}
    }

    function getActiveConversationKey() {
        try {
            // 1. Check window.location.pathname for /c/<uuid>
            const m = window.location.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/);
            if (m && m[1]) return 'conv_' + m[1];
        } catch(e) {}
        try {
            // 2. Check full href for /c/<uuid> or /conversation[s]/<uuid>
            const m2 = window.location.href.match(/(?:\/c\/|\/conversation[s]?\/)([a-zA-Z0-9_-]+)/);
            if (m2 && m2[1]) return 'conv_' + m2[1];
        } catch(e) {}
        try {
            // 3. Check sidebar active conversation element
            const selRow = document.querySelector('[data-testid="conversation-row-sidebar"][data-selected="true"]');
            if (selRow) {
                const id = selRow.getAttribute('data-cascade-id') || selRow.getAttribute('data-conversation-id');
                if (id) return 'conv_' + id;
            }
        } catch(e) {}
        try {
            // 4. Check active conversation link
            const activeLink = document.querySelector('a[href^="/c/"][aria-current], a[href^="/c/"].active');
            if (activeLink) {
                const m3 = activeLink.getAttribute('href').match(/\/c\/([a-zA-Z0-9_-]+)/);
                if (m3 && m3[1]) return 'conv_' + m3[1];
            }
        } catch(e) {}
        return 'conv_new';
    }

    function sxNotifyActiveModel(modelId, forceGlobal = false) {
        if (!modelId) return;
        localStorage.setItem('sx_active_model_id', modelId);
        
        const convKey = getActiveConversationKey();
        if (convKey && !forceGlobal) {
            localStorage.setItem('sx_active_model_' + convKey, modelId);
        }

        // Send to proxy with convKey so it can persist per-conversation model to disk
        fetch('http://127.0.0.1:15725/sx/set-active-model', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ modelId: modelId, convKey: forceGlobal ? 'conv_global' : convKey })
        }).catch(() => {});
    }

    function isVisionModel(m) {
        if (typeof m.supportsImages === 'boolean') return m.supportsImages;
        const str = `${m.modelId || ''} ${m.name || ''} ${m.id || ''}`.toLowerCase();
        if (/(?:vl|vision|omni|4o|gemini|gemma|inkling|nex-n|pixtral|llava|paligemma|content-safety|qwen.*vl|qwen3\.8)/i.test(str)) {
            if (/(?:code|sante|fin|super|ultra|lightning)/i.test(str) && !/(?:vl|vision|omni)/i.test(str)) {
                return false;
            }
        }
        return false;
    }

    const SX_MODEL_ENUMS = [
        'MODEL_PLACEHOLDER_M1', 'MODEL_PLACEHOLDER_M2', 'MODEL_PLACEHOLDER_M3', 'MODEL_PLACEHOLDER_M4', 'MODEL_PLACEHOLDER_M5', 'MODEL_PLACEHOLDER_M6', 'MODEL_PLACEHOLDER_M7', 'MODEL_PLACEHOLDER_M8', 'MODEL_PLACEHOLDER_M9', 'MODEL_PLACEHOLDER_M10',
        'MODEL_PLACEHOLDER_M11', 'MODEL_PLACEHOLDER_M12', 'MODEL_PLACEHOLDER_M13', 'MODEL_PLACEHOLDER_M14', 'MODEL_PLACEHOLDER_M15', 'MODEL_PLACEHOLDER_M16', 'MODEL_PLACEHOLDER_M17', 'MODEL_PLACEHOLDER_M18'
    ];

    function buildSXModelConfig(m, index = 0) {
        const placeholderEnum = 'MODEL_PLACEHOLDER_M1';
        const hasVision = isVisionModel(m);
        return {
            label: m.name,
            modelOrAlias: { model: placeholderEnum },
            supportsImages: hasVision,
            supportsThinking: true,
            supportsAdaptiveThinking: true,
            supportsRawThinking: true,
            thinkingBudget: 16384,
            minThinkingBudget: 2048,
            isRecommended: true,
            allowedTiers: ALLOWED_TIERS,
            quotaInfo: { remainingFraction: 1.0, resetTime: "2030-12-31T23:59:59Z" },
            tagTitle: "",
            tagDescription: "",
            supportedMimeTypes: hasVision ? {
                "text/plain": true,
                "image/png": true,
                "image/jpeg": true,
                "image/webp": true,
                "image/gif": true
            } : {
                "text/plain": true
            },
            modelId: m.id
        };
    }

    function buildCustomModelConfigs() {
        const sxModels = getSXModels();
        if (sxModels && sxModels.length > 0) {
            return sxModels.map((m, idx) => buildSXModelConfig(m, idx));
        }
        return [
            {
                label: "SX Custom Engine",
                modelOrAlias: { model: "MODEL_PLACEHOLDER_M1" },
                supportsImages: true,
                supportsThinking: true,
                supportsAdaptiveThinking: true,
                supportsRawThinking: true,
                thinkingBudget: 16384,
                minThinkingBudget: 2048,
                isRecommended: true,
                allowedTiers: ALLOWED_TIERS,
                quotaInfo: { remainingFraction: 1.0, resetTime: "2030-12-31T23:59:59Z" },
                tagTitle: "",
                tagDescription: "",
                supportedMimeTypes: { "text/plain": true, "image/png": true, "image/jpeg": true, "image/webp": true, "image/gif": true },
                modelId: "sx-proxy-1"
            }
        ];
    }

    function buildCustomModelSorts() {
        const sxModels = getSXModels();
        if (sxModels && sxModels.length > 0) {
            return [{
                name: "Recommended",
                groups: [{ groupName: "AI Models", modelLabels: sxModels.map(m => m.name) }]
            }];
        }
        return [{
            name: "Recommended",
            groups: [{ groupName: "AI Models", modelLabels: ["SX Custom Engine"] }]
        }];
    }

    // Intercept fetch
    const origFetch = window.fetch;
    window.fetch = async function(...args) {
        const url = args[0]?.toString() || '';
        console.log('[SX Fetch Intercept]', url);

        // Intercept GetUserStatus
        if (url.includes('GetUserStatus')) {
            try {
                const resp = await origFetch.apply(this, args);
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
                        const _configs = buildCustomModelConfigs();
                        const curActiveId = localStorage.getItem('sx_active_model_id');
                        const _activeModel = _configs.find(c => c.modelId === curActiveId) || _configs[0];
                        const _firstModel = _activeModel?.modelOrAlias?.model || 'SX_EMPTY';
                        const _firstModelId = _activeModel?.modelId || 'sx-empty';
                        const _modelRef = { versionId: 'v-custom', modelOrAlias: { model: _firstModel } };
                        data.userStatus.cascadeModelConfigData.clientModelConfigs = _configs;
                        data.userStatus.cascadeModelConfigData.clientModelSorts = buildCustomModelSorts();
                        // Required by cascade config resolution - "neither PlanMode nor model" fix
                        data.userStatus.cascadeModelConfigData.defaultModelConfig = _modelRef;
                        data.userStatus.cascadeModelConfigData.defaultOverrideModelConfig = _modelRef;
                        data.userStatus.cascadeModelConfigData.planModeModelConfig = _modelRef;
                        data.userStatus.cascadeModelConfigData.defaultAgentModelId = _firstModelId;
                    }
                    const newJsonBytes = new TextEncoder().encode(JSON.stringify(data));
                    const newFrame0 = encodeFrame(0, newJsonBytes);
                    const combined = new Uint8Array(newFrame0.length + trailerBuf.length);
                    combined.set(newFrame0, 0);
                    combined.set(trailerBuf, newFrame0.length);
                    console.log('[SX Custom Models Injected]', data.userStatus.cascadeModelConfigData.clientModelConfigs.length, 'models.');
                    return new Response(combined, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
                }
                return resp;
            } catch(e) {
                console.error('[GetUserStatus Hook Error]', e);
            }
        }
        
        if (url.includes('streamGenerateContent')) {
            try {
                const convKey = getActiveConversationKey();
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

        const resp = await origFetch.apply(this, args);

        if (url.includes('HasAuthToken')) {
            try {
                const clone = resp.clone();
                const buf = await clone.arrayBuffer();
                const u8 = new Uint8Array(buf);
                if (u8.length > 5 && u8[0] === 0) {
                    const dataLen = (u8[1] << 24) | (u8[2] << 16) | (u8[3] << 8) | u8[4];
                    const trailerBuf = u8.slice(5 + dataLen);
                    const newJsonBytes = new TextEncoder().encode(JSON.stringify({ hasToken: true }));
                    const newFrame0 = encodeFrame(0, newJsonBytes);
                    const combined = new Uint8Array(newFrame0.length + trailerBuf.length);
                    combined.set(newFrame0, 0);
                    combined.set(trailerBuf, newFrame0.length);
                    return new Response(combined, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
                }
            } catch(e) {}
        }

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
                    const newFrame0 = encodeFrame(0, newJsonBytes);
                    const combined = new Uint8Array(newFrame0.length + trailerBuf.length);
                    combined.set(newFrame0, 0);
                    combined.set(trailerBuf, newFrame0.length);

                    return new Response(combined, {
                        status: resp.status,
                        statusText: resp.statusText,
                        headers: resp.headers
                    });
                }
            } catch(e) {}
        }

        // ── Intercept GetCascadeConfig: patch any model refs to use our custom model ──
        if (url.includes('GetCascadeConfig') || url.includes('getCascadeConfig') || url.includes('cascade-config') || url.includes('CascadeConfig')) {
            try {
                const _cfgs = buildCustomModelConfigs();
                if (_cfgs.length > 0 && _cfgs[0].modelOrAlias) {
                    const _m = _cfgs[0].modelOrAlias.model;
                    const _mid = _cfgs[0].modelId;
                    const _ref = { versionId: 'v-custom', modelOrAlias: { model: _m } };
                    const clone = resp.clone();
                    const buf = await clone.arrayBuffer();
                    const u8 = new Uint8Array(buf);
                    if (u8.length > 5 && u8[0] === 0) {
                        const dataLen = (u8[1] << 24) | (u8[2] << 16) | (u8[3] << 8) | u8[4];
                        const dataPayload = u8.slice(5, 5 + dataLen);
                        const trailerBuf = u8.slice(5 + dataLen);
                        const data = JSON.parse(new TextDecoder().decode(dataPayload));
                        // Patch any model config field we find
                        function patchModelRefs(obj) {
                            if (!obj || typeof obj !== 'object') return;
                            if (obj.planModeModelConfig !== undefined) obj.planModeModelConfig = _ref;
                            if (obj.defaultModelConfig !== undefined) obj.defaultModelConfig = _ref;
                            if (obj.defaultOverrideModelConfig !== undefined) obj.defaultOverrideModelConfig = _ref;
                            if (obj.defaultAgentModelId !== undefined) obj.defaultAgentModelId = _mid;
                            if (obj.requestedModel !== undefined) obj.requestedModel = _m;
                            if (obj.planModel !== undefined) obj.planModel = _m;
                            for (const k of Object.keys(obj)) {
                                if (typeof obj[k] === 'object' && obj[k] !== null) patchModelRefs(obj[k]);
                            }
                        }
                        patchModelRefs(data);
                        const newBytes = new TextEncoder().encode(JSON.stringify(data));
                        const newFrame = encodeFrame(0, newBytes);
                        const combined = new Uint8Array(newFrame.length + trailerBuf.length);
                        combined.set(newFrame, 0);
                        combined.set(trailerBuf, newFrame.length);
                        return new Response(combined, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
                    }
                }
            } catch(e) { console.error('[CascadeConfig Hook]', e); }
        }

        // ── Intercept any JSON response that has planModeModelConfig / defaultModelConfig ──
        // This catches REST API cascade config endpoints
        try {
            const ct = resp.headers.get('content-type') || '';
            if (ct.includes('application/json') && !url.includes('streamGenerateContent')) {
                const _cfgs = buildCustomModelConfigs();
                if (_cfgs.length > 0 && _cfgs[0].modelOrAlias) {
                    const clone = resp.clone();
                    const text = await clone.text();
                    if (text.includes('planModeModelConfig') || text.includes('defaultModelConfig') || text.includes('cascadeModelConfig')) {
                        const data = JSON.parse(text);
                        const _m = _cfgs[0].modelOrAlias.model;
                        const _mid = _cfgs[0].modelId;
                        const _ref = { versionId: 'v-custom', modelOrAlias: { model: _m } };
                        function patchJSON(obj) {
                            if (!obj || typeof obj !== 'object') return;
                            if ('planModeModelConfig' in obj) obj.planModeModelConfig = _ref;
                            if ('defaultModelConfig' in obj) obj.defaultModelConfig = _ref;
                            if ('defaultOverrideModelConfig' in obj) obj.defaultOverrideModelConfig = _ref;
                            if ('defaultAgentModelId' in obj) obj.defaultAgentModelId = _mid;
                            if ('requestedModel' in obj) obj.requestedModel = _m;
                            if ('planModel' in obj) obj.planModel = _m;
                            for (const k of Object.keys(obj)) {
                                if (typeof obj[k] === 'object' && obj[k] !== null) patchJSON(obj[k]);
                            }
                        }
                        patchJSON(data);
                        return new Response(JSON.stringify(data), { status: resp.status, statusText: resp.statusText, headers: { 'Content-Type': 'application/json' } });
                    }
                }
            }
        } catch(e) {}

        return resp;
    };

    // ────────────────────────────────────────────────────────────────────────
    // UI MODAL: Provider Add / Edit Dialog
    // ────────────────────────────────────────────────────────────────────────
    function sxOpenProviderModal(existing, onSave) {
        const isEdit = !!existing;
        const overlay = document.createElement('div');
        overlay.className = 'sx-modal-overlay';
        overlay.id = 'sx-p-modal';

        const initPreset = isEdit
            ? (SX_PRESETS.find(p => existing.baseUrl && existing.baseUrl.includes(p.id === 'custom' ? '!!' : (p.baseUrl.split('/')[2] || '---'))) || SX_PRESETS[5])
            : SX_PRESETS[0];

        overlay.innerHTML = `
            <div class="sx-modal">
                <div class="sx-modal-title">` + (isEdit ? 'Edit Provider' : 'Add Provider') + `</div>
                <div class="sx-field">
                    <label class="sx-label">Select Provider</label>
                    <div class="sx-preset-grid" id="sx-p-presets">
                        ` + SX_PRESETS.map(p => `
                            <button type="button" class="sx-preset-btn` + (p.id === initPreset.id ? ' active' : '') + `" data-preset="` + p.id + `">
                                ` + p.name + `
                            </button>
                        `).join('') + `
                    </div>
                </div>
                <div class="sx-field">
                    <label class="sx-label">Provider Name</label>
                    <input class="sx-input" id="sx-p-name" value="` + (existing ? sxEsc(existing.name) : initPreset.name) + `" placeholder="e.g. My OpenRouter" />
                </div>
                <div class="sx-field">
                    <label class="sx-label">API Base URL</label>
                    <input class="sx-input" id="sx-p-url" value="` + (existing ? sxEsc(existing.baseUrl || '') : initPreset.baseUrl) + `" placeholder="https://..." />
                </div>
                <div class="sx-field">
                    <label class="sx-label">Protocol</label>
                    <select class="sx-select" id="sx-p-proto">
                        <option value="openai"` + ((existing ? existing.protocol : initPreset.protocol) === 'openai' ? ' selected' : '') + `>OpenAI Compatible (SSE)</option>
                        <option value="anthropic"` + ((existing ? existing.protocol : initPreset.protocol) === 'anthropic' ? ' selected' : '') + `>Anthropic Messages (SSE)</option>
                    </select>
                </div>
                <div class="sx-field">
                    <label class="sx-label">API Key</label>
                    <input class="sx-input" type="password" id="sx-p-key" value="` + (existing ? sxEsc(existing.apiKey || '') : '') + `" placeholder="sk-..." autocomplete="off" />
                </div>
                <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;margin-bottom:14px">
                    <button type="button" class="sx-btn" id="sx-p-test" style="border:1px solid rgba(255,255,255,0.18);padding:5px 12px;font-size:12px">⚡ Test Connection</button>
                    <span id="sx-p-test-result" style="font-size:12px;color:rgba(255,255,255,0.6)"></span>
                </div>
                <div class="sx-modal-actions">
                    <button type="button" class="sx-btn" id="sx-p-cancel">Cancel</button>
                    <button type="button" class="sx-btn sx-btn-primary" id="sx-p-save">Save Provider</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        let selectedPreset = initPreset;
        function updatePresetUI(preset) {
            selectedPreset = preset;
            overlay.querySelectorAll('.sx-preset-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.preset === preset.id);
            });
            if (preset.id !== 'custom') {
                overlay.querySelector('#sx-p-name').value = preset.name;
                overlay.querySelector('#sx-p-url').value = preset.baseUrl;
                overlay.querySelector('#sx-p-proto').value = preset.protocol;
            }
        }

        overlay.querySelector('#sx-p-presets').onclick = (e) => {
            const btn = e.target.closest('.sx-preset-btn');
            if (!btn) return;
            const preset = SX_PRESETS.find(p => p.id === btn.dataset.preset);
            if (preset) updatePresetUI(preset);
        };

        overlay.querySelector('#sx-p-test').onclick = async () => {
            const btn = overlay.querySelector('#sx-p-test');
            const res = overlay.querySelector('#sx-p-test-result');
            const key = overlay.querySelector('#sx-p-key').value.trim();
            const url = overlay.querySelector('#sx-p-url').value.trim();
            const proto = overlay.querySelector('#sx-p-proto').value;
            if (!key) { res.innerHTML = '<span class="sx-test-fail">Enter API key first</span>'; return; }
            btn.disabled = true;
            btn.textContent = 'Testing...';
            res.innerHTML = '<span style="color:rgba(255,255,255,0.4)">Connecting...</span>';
            try {
                const result = await sxTestProvider(url, key, proto);
                res.innerHTML = '<span class="sx-test-ok">✓ Connected</span> <span style="color:rgba(255,255,255,0.35);font-size:11px">' + result.ms + 'ms</span>';
            } catch(e) {
                res.innerHTML = '<span class="sx-test-fail">✗ ' + sxEsc(e.message) + '</span>';
            } finally {
                btn.disabled = false;
                btn.textContent = '⚡ Test Connection';
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
            const list = getSXProviders();
            const entry = { id: existing ? existing.id : 'prov_' + Date.now(), name, baseUrl, protocol, apiKey, modelsPath: selectedPreset.modelsPath || '/models' };
            if (existing) {
                const idx = list.findIndex(p => p.id === existing.id);
                if (idx >= 0) list[idx] = entry; else list.push(entry);
            } else { list.push(entry); }
            localStorage.setItem('sx_providers', JSON.stringify(list));
            sxSyncConfigToProxy();
            overlay.remove();
            onSave && onSave();
        };

        setTimeout(() => overlay.querySelector('#sx-p-key').focus(), 50);
    }

    // ────────────────────────────────────────────────────────────────────────
    // UI MODAL: Model Add / Edit Dialog (with multi-select)
    // ────────────────────────────────────────────────────────────────────────
    function sxOpenModelModal(existing, onSave) {
        const providers = getSXProviders();
        if (!providers.length) { alert('Once bir provider ekle.'); return; }
        const isEdit = !!existing;
        const overlay = document.createElement('div');
        overlay.className = 'sx-modal-overlay';
        overlay.id = 'sx-m-modal';

        const provOptions = providers.map(p =>
            '<option value="' + p.id + '"' + (existing && existing.providerId === p.id ? ' selected' : '') + '>' + sxEsc(p.name) + ' (' + sxEsc(p.protocol) + ')</option>'
        ).join('');

        const editFields =
            '<div class="sx-field">' +
                '<label class="sx-label">Model ID</label>' +
                '<input class="sx-input" id="sx-m-id" value="' + sxEsc((existing || {}).modelId || '') + '" />' +
            '</div>' +
            '<div class="sx-field">' +
                '<label class="sx-label">Goruntu Adi</label>' +
                '<input class="sx-input" id="sx-m-name" value="' + sxEsc((existing || {}).name || '') + '" />' +
            '</div>';

        const addFields =
            '<div class="sx-field">' +
                '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">' +
                    '<label class="sx-label" style="margin:0;">Model Listesi</label>' +
                    '<button type="button" class="sx-btn" id="sx-m-fetch" style="padding:3px 10px;font-size:11px;">&#8595; Listele</button>' +
                '</div>' +
                '<input class="sx-input" id="sx-m-filter" placeholder="Model ara..." style="margin-bottom:6px;display:none;" />' +
                '<div id="sx-m-check-list" style="max-height:200px;overflow-y:auto;border:1px solid rgba(255,255,255,0.09);border-radius:7px;display:none;"></div>' +
                '<div id="sx-m-bulk-hint" style="font-size:12px;color:rgba(255,255,255,0.3);padding:8px 0 4px 0;">Provider\'dan model listesi yukle veya asagida manuel gir.</div>' +
            '</div>' +
            '<div class="sx-field">' +
                '<label class="sx-label">Manuel Model ID (opsiyonel)</label>' +
                '<input class="sx-input" id="sx-m-id" placeholder="ornek: anthropic/claude-3-7-sonnet" />' +
            '</div>' +
            '<div class="sx-field">' +
                '<label class="sx-label">Goruntu Adi (opsiyonel)</label>' +
                '<input class="sx-input" id="sx-m-name" placeholder="ornek: Claude 3.7 Sonnet" />' +
            '</div>';

        overlay.innerHTML =
            '<div class="sx-modal" style="width:500px;">' +
                '<div class="sx-modal-title">' + (isEdit ? 'Model Duzenle' : 'Model Ekle') + '</div>' +
                '<div class="sx-field">' +
                    '<label class="sx-label">Provider</label>' +
                    '<select class="sx-select" id="sx-m-prov">' + provOptions + '</select>' +
                '</div>' +
                (isEdit ? editFields : addFields) +
                '<div class="sx-modal-actions">' +
                    '<button type="button" class="sx-btn" id="sx-m-cancel">Iptal</button>' +
                    '<button type="button" class="sx-btn sx-btn-primary" id="sx-m-save">' + (isEdit ? 'Kaydet' : 'Ekle') + '</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        let allFetchedModels = [];
        const checkedIds = new Set();

        function renderChecklist(filterText) {
            const list = overlay.querySelector('#sx-m-check-list');
            if (!list) return;
            const filtered = allFetchedModels.filter(m =>
                m.id.toLowerCase().includes(filterText) || (m.name || '').toLowerCase().includes(filterText)
            ).slice(0, 300);
            if (!filtered.length) {
                list.innerHTML = '<div style="padding:12px;color:rgba(255,255,255,0.3);font-size:12px;text-align:center;">Sonuc yok</div>';
                return;
            }
            list.innerHTML = filtered.map(m =>
                '<label style="display:flex;align-items:center;gap:9px;padding:7px 12px;cursor:pointer;">' +
                    '<input type="checkbox" data-id="' + sxEsc(m.id) + '" data-name="' + sxEsc(m.name || m.id) + '"' +
                        (checkedIds.has(m.id) ? ' checked' : '') +
                        ' style="width:14px;height:14px;accent-color:#38bdf8;cursor:pointer;flex-shrink:0;" />' +
                    '<span style="min-width:0;overflow:hidden;">' +
                        '<div style="font-family:ui-monospace,monospace;font-size:11.5px;color:rgba(255,255,255,0.88);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + sxEsc(m.id) + '</div>' +
                        (m.name && m.name !== m.id ? '<div style="font-size:10px;color:rgba(255,255,255,0.38);">' + sxEsc(m.name) + '</div>' : '') +
                    '</span>' +
                '</label>'
            ).join('');
            list.querySelectorAll('input[type=checkbox]').forEach(cb => {
                cb.onchange = () => { if (cb.checked) checkedIds.add(cb.dataset.id); else checkedIds.delete(cb.dataset.id); };
            });
        }

        const fetchBtn = overlay.querySelector('#sx-m-fetch');
        if (fetchBtn) fetchBtn.onclick = async () => {
            const provId = overlay.querySelector('#sx-m-prov').value;
            const prov = providers.find(p => p.id === provId);
            if (!prov) { alert('Once provider sec.'); return; }
            fetchBtn.disabled = true; fetchBtn.textContent = 'Yukleniyor...';
            try {
                allFetchedModels = await sxFetchModels(prov.baseUrl, prov.apiKey, prov.protocol, prov.modelsPath);
                const hint = overlay.querySelector('#sx-m-bulk-hint');
                const filterEl = overlay.querySelector('#sx-m-filter');
                const listEl = overlay.querySelector('#sx-m-check-list');
                if (hint) hint.style.display = 'none';
                if (filterEl) filterEl.style.display = '';
                if (listEl) listEl.style.display = '';
                renderChecklist('');
            } catch(e) { alert('Listelenemedi: ' + e.message); }
            finally { fetchBtn.disabled = false; fetchBtn.textContent = '&#8595; Listele'; }
        };

        const filterEl = overlay.querySelector('#sx-m-filter');
        if (filterEl) filterEl.oninput = e => renderChecklist(e.target.value.toLowerCase().trim());

        overlay.querySelector('#sx-m-cancel').onclick = () => overlay.remove();
        overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

        overlay.querySelector('#sx-m-save').onclick = () => {
            const provId = overlay.querySelector('#sx-m-prov').value;
            const list = getSXModels();

            if (isEdit) {
                const name = overlay.querySelector('#sx-m-name').value.trim();
                const modelId = overlay.querySelector('#sx-m-id').value.trim();
                if (!name || !modelId) { alert('Model ID ve ad zorunlu.'); return; }
                const entry = { id: existing.id, providerId: provId, name, modelId, directMode: true };
                const idx = list.findIndex(m => m.id === existing.id);
                if (idx >= 0) list[idx] = entry; else list.push(entry);
                localStorage.setItem('sx_models', JSON.stringify(list));
                sxSyncConfigToProxy();
                overlay.remove();
                onSave && onSave();
                return;
            }

            // Bulk add from checklist
            if (checkedIds.size > 0) {
                checkedIds.forEach(id => {
                    const fm = allFetchedModels.find(m => m.id === id);
                    list.push({ id: 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), providerId: provId, name: fm ? (fm.name || id) : id, modelId: id, directMode: true });
                });
                localStorage.setItem('sx_models', JSON.stringify(list));
                sxSyncConfigToProxy();
                overlay.remove();
                onSave && onSave();
                return;
            }

            // Single manual add
            const manualId = (overlay.querySelector('#sx-m-id') || {}).value?.trim();
            const manualName = (overlay.querySelector('#sx-m-name') || {}).value?.trim();
            if (!manualId) { alert('Model ID gir veya listeden en az bir model sec.'); return; }
            list.push({ id: 'm_' + Date.now(), providerId: provId, name: manualName || manualId, modelId: manualId, directMode: true });
            localStorage.setItem('sx_models', JSON.stringify(list));
            sxSyncConfigToProxy();
            overlay.remove();
            onSave && onSave();
        };

        setTimeout(() => overlay.querySelector('#sx-m-prov').focus(), 50);
    }



    function sxEsc(str) {
        return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    // Inject Styles
    function injectStyles() {
        if (document.getElementById('sx-custom-styles')) return;
        const style = document.createElement('style');
        style.id = 'sx-custom-styles';
        style.textContent = `
            /* ── Layout ── */
            .sx-section { margin-top: 24px; margin-bottom: 8px; }
            .sx-section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
            .sx-section-title { font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 1px; }
            .sx-section-count { font-size: 11px; color: rgba(255,255,255,0.22); margin-left: 6px; }

            /* ── Buttons ── */
            .sx-btn { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.8); font-size: 12px; font-weight: 500; padding: 5px 12px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; font-family: inherit; transition: all 0.12s; line-height: 1.5; }
            .sx-btn:hover { background: rgba(255,255,255,0.09); border-color: rgba(255,255,255,0.2); color: #fff; }
            .sx-btn-primary { background: #fff; color: #0e0e11; font-weight: 600; border: none; padding: 5px 14px; }
            .sx-btn-primary:hover { background: #e8e8e8; }
            .sx-btn-danger { background: rgba(239,68,68,0.1); border-color: rgba(239,68,68,0.25); color: #f87171; }
            .sx-btn-danger:hover { background: rgba(239,68,68,0.2); }

            /* ── Provider Cards ── */
            .sx-card { display: flex; align-items: center; gap: 12px; padding: 13px 16px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; margin-bottom: 6px; transition: all 0.12s; }
            .sx-card:hover { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.1); }
            .sx-card-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
            .sx-card-dot-openai { background: #10b981; box-shadow: 0 0 6px rgba(16,185,129,0.5); }
            .sx-card-dot-anthropic { background: #f59e0b; box-shadow: 0 0 6px rgba(245,158,11,0.5); }
            .sx-card-info { flex: 1; min-width: 0; }
            .sx-card-name { font-size: 13px; font-weight: 500; color: rgba(255,255,255,0.9); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .sx-card-sub { font-size: 11px; color: rgba(255,255,255,0.28); font-family: ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
            .sx-card-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }

            /* ── Model Cards ── */
            .sx-model-card { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: transparent; border-bottom: 1px solid rgba(255,255,255,0.04); transition: background 0.1s; }
            .sx-model-card:first-child { border-radius: 10px 10px 0 0; }
            .sx-model-card:last-child { border-bottom: none; border-radius: 0 0 10px 10px; }
            .sx-model-card:only-child { border-radius: 10px; border-bottom: none; }
            .sx-model-card:hover { background: rgba(255,255,255,0.03); }
            .sx-models-list { border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; overflow: hidden; }
            .sx-model-name { font-size: 13px; color: rgba(255,255,255,0.88); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .sx-model-id { font-size: 10.5px; color: rgba(255,255,255,0.3); font-family: ui-monospace, monospace; flex: 1.2; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .sx-model-prov { font-size: 10.5px; color: rgba(255,255,255,0.22); flex-shrink: 0; }

            /* ── Badges ── */
            .sx-badge { font-size: 10px; font-weight: 600; text-transform: uppercase; padding: 2px 7px; border-radius: 4px; letter-spacing: 0.5px; flex-shrink: 0; }
            .sx-badge-openai { background: rgba(16,185,129,0.12); color: #34d399; border: 1px solid rgba(16,185,129,0.2); }
            .sx-badge-anthropic { background: rgba(245,158,11,0.12); color: #fbbf24; border: 1px solid rgba(245,158,11,0.2); }
            .sx-badge-active { background: rgba(99,102,241,0.12); color: #a5b4fc; border: 1px solid rgba(99,102,241,0.2); }

            /* ── Icon Buttons ── */
            .sx-icon-btn { background: none; border: none; color: rgba(255,255,255,0.25); cursor: pointer; padding: 4px 7px; border-radius: 5px; font-size: 12px; transition: all 0.1s; line-height: 1; }
            .sx-icon-btn:hover { color: rgba(255,255,255,0.75); background: rgba(255,255,255,0.07); }
            .sx-icon-btn.del:hover { color: #f87171; background: rgba(239,68,68,0.1); }

            /* ── Empty states ── */
            .sx-empty-hint { font-size: 12px; color: rgba(255,255,255,0.25); padding: 20px 16px; text-align: center; border: 1px dashed rgba(255,255,255,0.07); border-radius: 10px; margin-bottom: 6px; line-height: 1.6; }

            /* ── Modal ── */
            .sx-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.65); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 999999; }
            .sx-modal { background: #111114; border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; padding: 24px 26px; width: 560px; max-width: 96vw; max-height: 90vh; overflow-y: auto; box-shadow: 0 32px 64px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04) inset; font-family: inherit; }
            .sx-modal-title { font-size: 16px; font-weight: 700; color: rgba(255,255,255,0.95); margin-bottom: 20px; letter-spacing: -0.3px; }
            .sx-field { margin-bottom: 16px; }
            .sx-label { display: block; font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.35); text-transform: uppercase; letter-spacing: 0.7px; margin-bottom: 7px; }
            .sx-input, .sx-select { width: 100%; box-sizing: border-box; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.09); color: rgba(255,255,255,0.92); border-radius: 8px; padding: 9px 12px; font-size: 13px; font-family: inherit; outline: none; transition: all 0.12s; }
            .sx-input:focus, .sx-select:focus { border-color: rgba(255,255,255,0.3); background: rgba(255,255,255,0.06); box-shadow: 0 0 0 3px rgba(255,255,255,0.04); }
            .sx-select option { background: #111114; }
            .sx-preset-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; max-height: 180px; overflow-y: auto; padding-right: 2px; }
            .sx-preset-btn { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); color: rgba(255,255,255,0.65); font-size: 11px; font-weight: 500; padding: 7px 5px; border-radius: 6px; cursor: pointer; text-align: center; transition: all 0.12s; font-family: inherit; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .sx-preset-btn:hover { background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.9); border-color: rgba(255,255,255,0.15); }
            .sx-preset-btn.active { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.3); color: #fff; font-weight: 600; }
            .sx-test-ok { color: #34d399; font-weight: 600; }
            .sx-test-fail { color: #f87171; font-weight: 600; }
            .sx-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 22px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,0.06); }

            /* ── Model selector dropdown ── */
            [data-testid="model-selector-panel"] {
                display: flex !important;
                flex-direction: column !important;
            }
            [data-testid="model-selector-item"] {
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
            }
            [data-testid="model-selector-item"][style*="display: none"] {
                display: none !important;
            }

            .sx-model-dropdown { position: absolute; top: calc(100% + 4px); left: 0; right: 0; background: #131317; border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; padding: 6px; z-index: 1000; box-shadow: 0 16px 40px rgba(0,0,0,0.6); max-height: 280px; display: flex; flex-direction: column; }
            .sx-model-list { overflow-y: auto; max-height: 200px; }
            .sx-model-list-item { padding: 8px 10px; border-radius: 6px; cursor: pointer; }
            .sx-model-list-item:hover { background: rgba(255,255,255,0.06); }
            .sx-model-list-item.selected { background: rgba(255,255,255,0.1); }
            .sx-model-item-id { font-family: ui-monospace, monospace; font-size: 11.5px; color: rgba(255,255,255,0.88); }
            .sx-model-item-name { font-size: 10px; color: rgba(255,255,255,0.38); margin-top: 1px; }

            /* ── Test result inline ── */
            .sx-tc-result { font-size: 11px; min-width: 60px; text-align: right; }

            /* ── Divider ── */
            .sx-divider { height: 1px; background: rgba(255,255,255,0.05); margin: 20px 0; }
        `;
        document.head.appendChild(style);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Settings > Models Page — Right Panel Injection
    // ────────────────────────────────────────────────────────────────────────
    function trySXModelsSettingsInject() {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return;
        injectStyles();

        // ── Step 1: If already injected, just re-suppress Google content ──
        const existingWrap = dialog.querySelector('#sx-content-wrapper');
        if (existingWrap) {
            const rp = existingWrap.parentElement;
            if (rp) Array.from(rp.children).forEach(c => {
                if (c.id === 'sx-content-wrapper') return;
                c.style.setProperty('display', 'none', 'important');
            });
            return;
        }

        // ── Step 2: Find the RIGHT PANEL via Google-exclusive content ──
        // "Gemini Models" and "Model Credits" ONLY appear in the right content panel.
        // They never appear in the left navigation sidebar.
        let rightPanel = null;
        const MARKERS = ['Gemini Models', 'Model Credits', 'Your Plan'];

        outer: for (const marker of MARKERS) {
            for (const el of Array.from(dialog.querySelectorAll('*'))) {
                if (!el.offsetParent) continue;
                const txt = el.textContent.trim();
                if (txt !== marker) continue;
                // Walk up to the nearest scrollable ancestor → that's the right panel
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

        // ── Step 3: Nuke all Google content in the right panel ──
        Array.from(rightPanel.children).forEach(c => {
            c.style.setProperty('display', 'none', 'important');
        });

        // ── Step 4: Inject our custom UI inside a padded wrapper ──
        const sxWrap = document.createElement('div');
        sxWrap.id = 'sx-content-wrapper';
        sxWrap.style.cssText = 'padding: 0 32px 32px 32px; box-sizing: border-box; width: 100%;';
        rightPanel.appendChild(sxWrap);

        const sxHeader = document.createElement('div');
        sxHeader.id = 'sx-custom-engine-header';
        sxHeader.innerHTML =
            '<div style="padding:20px 0 14px 0;">' +
                '<div style="font-size:22px;font-weight:700;color:rgba(255,255,255,0.92);letter-spacing:-0.5px;">Models &amp; Usage</div>' +
                '<div style="font-size:13px;color:rgba(255,255,255,0.4);margin-top:4px;">Dogrudan provider baglantisi aktif.</div>' +
            '</div>';
        sxWrap.appendChild(sxHeader);

        const provSec = document.createElement('div');
        provSec.id = 'sx-providers-section';
        provSec.className = 'sx-section';
        sxWrap.appendChild(provSec);

        const modelsSec = document.createElement('div');
        modelsSec.id = 'sx-models-section';
        modelsSec.className = 'sx-section';
        sxWrap.appendChild(modelsSec);

        function renderProviders() {
            const providers = getSXProviders();
            const models = getSXModels();
            let html =
                '<div class="sx-section-header">' +
                    '<div style="display:flex;align-items:center;gap:6px;">' +
                        '<div class="sx-section-title">Providers</div>' +
                        '<span class="sx-section-count">(' + providers.length + ')</span>' +
                    '</div>' +
                    '<button type="button" class="sx-btn sx-btn-primary" id="sx-add-prov-btn">+ Add Provider</button>' +
                '</div>';
            if (!providers.length) {
                html += '<div class="sx-empty-hint">No providers yet.<br>Add OpenRouter, Kilo Code, Anthropic or any OpenAI-compatible provider.</div>';
            } else {
                providers.forEach(p => {
                    const meta = getSXProviderMeta(p);
                    const proto = meta.protocol || 'openai';
                    const dotColor = meta.dotColor;

                    const count = models.filter(m => m.providerId === p.id).length;
                    const countLabel = count === 1 ? '1 model' : `${count} models`;

                    html +=
                        '<div class="sx-card">' +
                            `<div class="sx-card-dot" style="background:${dotColor};box-shadow:0 0 8px ${dotColor}66;"></div>` +
                            '<div class="sx-card-info">' +
                                '<div style="display:flex;align-items:center;gap:8px;">' +
                                    '<div class="sx-card-name">' + sxEsc(p.name) + '</div>' +
                                    `<span style="font-size:10px;font-weight:600;color:rgba(255,255,255,0.45);background:rgba(255,255,255,0.06);padding:1px 6px;border-radius:4px;">${countLabel}</span>` +
                                '</div>' +
                                '<div class="sx-card-sub">' + sxEsc(p.baseUrl || '') + '</div>' +
                            '</div>' +
                            '<div class="sx-card-actions">' +
                                '<span id="sx-ti-' + p.id + '" class="sx-tc-result"></span>' +
                                '<button class="sx-btn sx-tc-btn" data-id="' + p.id + '" style="padding:4px 10px;font-size:11px;gap:4px;">⚡ Ping</button>' +
                                '<button class="sx-icon-btn edit-p" data-id="' + p.id + '" title="Edit">✎</button>' +
                                '<button class="sx-icon-btn del del-p" data-id="' + p.id + '" title="Delete">✕</button>' +
                            '</div>' +
                        '</div>';
                });
            }
            provSec.innerHTML = html;
            provSec.querySelector('#sx-add-prov-btn').onclick = () => sxOpenProviderModal(null, () => { renderProviders(); renderModels(); });
            provSec.querySelectorAll('.edit-p').forEach(b => {
                b.onclick = () => { const p = getSXProviders().find(x => x.id === b.dataset.id); if (p) sxOpenProviderModal(p, () => { renderProviders(); renderModels(); }); };
            });
            provSec.querySelectorAll('.del-p').forEach(b => {
                b.onclick = () => {
                    if (!confirm('Bu provider ve modellerini sil?')) return;
                    localStorage.setItem('sx_providers', JSON.stringify(getSXProviders().filter(x => x.id !== b.dataset.id)));
                    localStorage.setItem('sx_models', JSON.stringify(getSXModels().filter(x => x.providerId !== b.dataset.id)));
                    sxSyncConfigToProxy(true);
                    renderProviders(); renderModels();
                };
            });
            provSec.querySelectorAll('.sx-tc-btn').forEach(b => {
                b.onclick = async () => {
                    const p = getSXProviders().find(x => x.id === b.dataset.id); if (!p) return;
                    const res = provSec.querySelector('#sx-ti-' + p.id);
                    b.disabled = true; b.textContent = '...';
                    if (res) res.innerHTML = '<span style="font-size:11px;color:rgba(255,255,255,0.3)">...</span>';
                    try {
                        const r = await sxTestProvider(p.baseUrl, p.apiKey, p.protocol);
                        if (res) res.innerHTML = '<span class="sx-test-ok" style="font-size:11px;">✓ ' + r.ms + 'ms</span>';
                    } catch(e) {
                        if (res) res.innerHTML = '<span class="sx-test-fail" style="font-size:11px;">✗ fail</span>';
                    } finally { b.disabled = false; b.textContent = '⚡ Test'; }
                };
            });
        }

        function renderModels() {
            const models = getSXModels();
            const providers = getSXProviders();
            let html =
                '<div class="sx-section-header">' +
                    '<div style="display:flex;align-items:center;gap:6px;">' +
                        '<div class="sx-section-title">Models</div>' +
                        '<span class="sx-section-count">(' + models.length + ')</span>' +
                    '</div>' +
                    '<button type="button" class="sx-btn sx-btn-primary" id="sx-add-model-btn">+ Add Model</button>' +
                '</div>';
            if (!models.length) {
                html += '<div class="sx-empty-hint">No models yet.<br>Add a provider above, then add models from it.</div>';
            } else {
                html += '<div class="sx-models-list">';
                models.forEach(m => {
                    const p = providers.find(x => x.id === m.providerId);
                    const pName = p ? p.name : '?';
                    const proto = p ? (p.protocol || 'openai') : 'openai';
                    html +=
                        '<div class="sx-model-card">' +
                            '<div class="sx-card-dot sx-card-dot-' + proto + '" style="width:6px;height:6px;flex-shrink:0;"></div>' +
                            '<div class="sx-model-name">' + sxEsc(m.name) + '</div>' +
                            '<div class="sx-model-id">' + sxEsc(m.modelId) + '</div>' +
                            '<div class="sx-model-prov">' + sxEsc(pName) + '</div>' +
                            '<div class="sx-card-actions">' +
                                '<button class="sx-icon-btn edit-m" data-id="' + m.id + '" title="Edit">✎</button>' +
                                '<button class="sx-icon-btn del del-m" data-id="' + m.id + '" title="Delete">✕</button>' +
                            '</div>' +
                        '</div>';
                });
                html += '</div>';
            }
            modelsSec.innerHTML = html;
            modelsSec.querySelector('#sx-add-model-btn').onclick = () => sxOpenModelModal(null, () => renderModels());
            modelsSec.querySelectorAll('.edit-m').forEach(b => {
                b.onclick = () => { const m = getSXModels().find(x => x.id === b.dataset.id); if (m) sxOpenModelModal(m, () => renderModels()); };
            });
            modelsSec.querySelectorAll('.del-m').forEach(b => {
                b.onclick = () => {
                    if (!confirm('Bu modeli sil?')) return;
                    localStorage.setItem('sx_models', JSON.stringify(getSXModels().filter(x => x.id !== b.dataset.id)));
                    sxSyncConfigToProxy(true);
                    renderModels();
                };
            });
        }

        renderProviders();
        renderModels();
    }

    const _contextDetailsCache = {};

    function sxFetchContextDetails(convId, modelId, force = false) {
        const cid = (convId || 'new').replace(/^conv_/, '');
        const cacheKey = cid + '_' + (modelId || '');
        const cached = _contextDetailsCache[cacheKey];
        const now = Date.now();
        if (!force && cached && (now - cached._time < 3000)) {
            return Promise.resolve(cached.data);
        }
        return new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', `http://127.0.0.1:15725/sx/get-chat-context-details?convId=${encodeURIComponent(cid)}&modelId=${encodeURIComponent(modelId || '')}`, true);
            xhr.onload = () => {
                try {
                    const data = JSON.parse(xhr.responseText);
                    if (data && data.ok) {
                        _contextDetailsCache[cacheKey] = { data, _time: Date.now() };
                        resolve(data);
                        return;
                    }
                } catch(e) {}
                resolve(cached ? cached.data : null);
            };
            xhr.onerror = () => resolve(cached ? cached.data : null);
            xhr.timeout = 4000;
            xhr.send();
        });
    }

    function getDraftPromptText() {
        try {
            const editable = document.querySelector('[contenteditable="true"], div.cursor-text[role="combobox"], textarea');
            if (editable) {
                return (editable.innerText || editable.textContent || editable.value || '').trim();
            }
        } catch(e) {}
        return '';
    }

    function calculateLiveContextMetrics(cleanConvId, targetModel) {
        const isNewConv = (!cleanConvId || cleanConvId === 'new' || cleanConvId === 'draft');
        const cacheKey = (cleanConvId || 'new') + '_' + (targetModel?.id || '');
        const cached = _contextDetailsCache[cacheKey]?.data;

        const totalContext = cached ? cached.totalContext : (targetModel?.contextLength ? Number(targetModel.contextLength) : 262144);
        const baseUsed = (cached && !cached.isFreshChat) ? cached.usedTokens : 0;

        const draftText = getDraftPromptText();
        const draftChars = draftText.length;
        // ~3.2 chars/token for draft prompts & code
        const draftTokens = draftChars > 0 ? Math.ceil(draftChars / 3.2) : 0;

        const totalUsed = baseUsed + draftTokens;
        const isFresh = (baseUsed === 0 && draftTokens === 0);
        const pct = isFresh ? 0 : Math.min(100, (totalUsed / totalContext) * 100);

        function fmt(n) {
            if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
            if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
            return String(Math.round(n));
        }

        let tooltip = '';
        const percentDisplay = (pct > 0 && pct < 1) ? '<1%' : `${Math.round(pct)}%`;
        if (isFresh) {
            tooltip = `Context: Yeni Sohbet (0 / ${fmt(totalContext)})`;
        } else if (draftTokens > 0) {
            tooltip = `Context: ${fmt(totalUsed)} / ${fmt(totalContext)} (${percentDisplay}) [+${fmt(draftTokens)} taslak]`;
        } else {
            tooltip = `Context: ${fmt(totalUsed)} / ${fmt(totalContext)} (${percentDisplay})`;
        }

        return {
            isFresh,
            draftTokens,
            totalUsed,
            totalContext,
            totalContextFormatted: fmt(totalContext),
            usedTokensFormatted: fmt(totalUsed),
            percentNum: Math.round(pct),
            percentExact: pct,
            percentDisplay,
            tooltip,
            baseUsed,
            cachedData: cached
        };
    }

    function renderPopoverDetails(pop, data, liveMetrics) {
        if (!data || !data.items) return;
        const statText = pop.querySelector('#sx-ctx-stat-text');
        const progBar = pop.querySelector('#sx-ctx-progress-bar');
        const itemsList = pop.querySelector('#sx-ctx-items-list');

        function fmt(n) {
            if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
            if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
            return String(Math.round(n));
        }

        const totalUsed = liveMetrics?.draftTokens > 0 ? liveMetrics.totalUsed : data.usedTokens;
        const pctNum = liveMetrics?.draftTokens > 0 ? liveMetrics.percentNum : data.percentNum;
        const pctExact = liveMetrics?.draftTokens > 0 ? liveMetrics.percentExact : (data.percentNum || 0);
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
                html += `
                    <div style="display:flex;align-items:center;justify-content:space-between;font-size:12.5px;line-height:1.2;">
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="width:7.5px;height:7.5px;border-radius:2px;background:${item.color};flex-shrink:0;"></span>
                            <span style="color:#cbd5e1;font-weight:400;">${sxEsc(item.label)}</span>
                        </div>
                        <div style="display:flex;align-items:center;font-family:ui-monospace,monospace;font-size:12px;">
                            <span style="color:#94a3b8;min-width:48px;text-align:right;">${item.tokens}</span>
                            <span style="color:#64748b;min-width:44px;text-align:right;margin-left:10px;">${item.percent}</span>
                        </div>
                    </div>
                `;
            });
            itemsList.innerHTML = html;
        }
    }

    function toggleContextPopover(anchorEl) {
        let pop = document.getElementById('sx-context-popover');
        if (pop) {
            pop.remove();
            if (anchorEl) anchorEl.classList.remove('sx-active');
            return;
        }

        const sxModels = getSXModels();
        const activeId = localStorage.getItem('sx_active_model_id');
        const activeM = sxModels.find(m => m.id === activeId) || sxModels[0];
        if (!activeM) return;

        const convKey = getActiveConversationKey();
        const cleanConvId = (convKey || '').replace(/^conv_/, '');

        if (anchorEl) anchorEl.classList.add('sx-active');

        pop = document.createElement('div');
        pop.id = 'sx-context-popover';
        pop.style.cssText = `
            position: fixed;
            width: 336px;
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
        const popLeft = Math.max(10, Math.min(window.innerWidth - 350, rect.left - 10));
        pop.style.left = popLeft + 'px';
        pop.style.bottom = (window.innerHeight - rect.top + 8) + 'px';

        const fallbackTotal = formatContextSize(activeM.contextLength) || '256k';

        pop.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;" id="sx-ctx-popover-header">
                <span style="font-size:13px;color:#94a3b8;font-weight:600;letter-spacing:0.2px;">Context window</span>
                <div style="display:flex;align-items:center;gap:6px;">
                    <span id="sx-ctx-stat-text" style="font-size:12.5px;color:#f8fafc;font-family:ui-monospace,monospace;font-weight:600;">-- / ${fallbackTotal} (0%)</span>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#64748b;margin-left:2px;"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
            </div>

            <div style="width:100%;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;margin:11px 0 14px 0;overflow:hidden;">
                <div id="sx-ctx-progress-bar" style="width:0%;height:100%;background:#38bdf8;border-radius:2px;transition:width 0.35s ease;"></div>
            </div>

            <div id="sx-ctx-items-list" style="display:flex;flex-direction:column;gap:7.5px;">
                <div style="font-size:12px;color:#64748b;text-align:center;padding:10px 0;">Yükleniyor...</div>
            </div>
        `;

        document.body.appendChild(pop);

        pop.querySelector('#sx-ctx-popover-header').onclick = () => {
            pop.remove();
            if (anchorEl) anchorEl.classList.remove('sx-active');
        };

        const liveMetrics = calculateLiveContextMetrics(cleanConvId, activeM);
        const cacheKey = (cleanConvId || 'new') + '_' + (activeM.id || '');
        const currentData = _contextDetailsCache[cacheKey]?.data;
        if (currentData) {
            renderPopoverDetails(pop, currentData, liveMetrics);
        }

        sxFetchContextDetails(cleanConvId, activeM.id, true).then(data => {
            if (data && pop.isConnected) {
                const freshMetrics = calculateLiveContextMetrics(cleanConvId, activeM);
                renderPopoverDetails(pop, data, freshMetrics);
            }
        });
    }

    function updateContextRing(metrics) {
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

    function updateLiveContextUI() {
        const ctxBtn = document.getElementById('sx-context-btn');
        if (!ctxBtn) return;
        const sxModels = getSXModels();
        const activeId = localStorage.getItem('sx_active_model_id');
        const activeM = sxModels.find(m => m.id === activeId) || sxModels[0];
        const activeConvKey = getActiveConversationKey();
        const cleanConvId = activeConvKey.replace(/^conv_/, '');

        const metrics = calculateLiveContextMetrics(cleanConvId, activeM);
        updateContextRing(metrics);

        const pop = document.getElementById('sx-context-popover');
        if (pop && pop.isConnected) {
            const cacheKey = (cleanConvId || 'new') + '_' + (activeM?.id || '');
            const currentData = _contextDetailsCache[cacheKey]?.data;
            if (currentData) {
                renderPopoverDetails(pop, currentData, metrics);
            }
        }
    }

    // Instant live typing listener on prompt box (0ms keystroke latency)
    ['input', 'keyup', 'change', 'paste'].forEach(evName => {
        document.addEventListener(evName, (e) => {
            if (e.target && e.target.closest && e.target.closest('[contenteditable="true"], textarea, div.cursor-text')) {
                updateLiveContextUI();
            }
        }, true);
    });

    // ────────────────────────────────────────────────────────────────────────
    // Performance & Speed Monitor (TPS, TTFT, Latency)
    // ────────────────────────────────────────────────────────────────────────
    let _perfStatsCache = {};

    async function sxFetchPerfStats(convId) {
        try {
            const url = `http://127.0.0.1:15725/sx/get-chat-perf-stats?convId=${encodeURIComponent(convId || '')}`;
            const resp = await sxProxyFetch(url, 'GET');
            if (!resp.ok) return null;
            const data = await resp.json();
            if (data && data.ok) {
                _perfStatsCache[convId || 'new'] = data.stats;
                return data.stats;
            }
        } catch(e) {}
        return null;
    }

    function togglePerfPopover(anchorEl) {
        let pop = document.getElementById('sx-perf-popover');
        if (pop) {
            pop.remove();
            if (anchorEl) anchorEl.classList.remove('sx-active');
            return;
        }

        const convKey = getActiveConversationKey();
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

        function renderPerfDetails(stats) {
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
        }

        const cached = _perfStatsCache[cleanConvId] || _perfStatsCache['new'];
        if (cached) renderPerfDetails(cached);

        sxFetchPerfStats(cleanConvId).then(stats => {
            if (pop.isConnected) renderPerfDetails(stats);
        });
    }

    function updatePerfButtonUI() {
        const perfBtn = document.getElementById('sx-perf-btn');
        if (!perfBtn) return;
        const convKey = getActiveConversationKey();
        const cleanConvId = (convKey || '').replace(/^conv_/, '');
        const stats = _perfStatsCache[cleanConvId] || _perfStatsCache['new'];

        if (stats && stats.ttftMs) {
            perfBtn.title = `Model Performansı: ${stats.tps || 0} TPS, TTFT ${stats.ttftMs}ms (Tıkla)`;
        } else {
            perfBtn.title = 'Model Performansı (TTFT, TPS) (Tıkla)';
        }
    }

    document.addEventListener('click', (e) => {
        const pop = document.getElementById('sx-context-popover');
        if (pop && !pop.contains(e.target) && !e.target.closest('#sx-context-btn')) {
            pop.remove();
            const btn = document.getElementById('sx-context-btn');
            if (btn) btn.classList.remove('sx-active');
        }

        const perfPop = document.getElementById('sx-perf-popover');
        if (perfPop && !perfPop.contains(e.target) && !e.target.closest('#sx-perf-btn')) {
            perfPop.remove();
            const pBtn = document.getElementById('sx-perf-btn');
            if (pBtn) pBtn.classList.remove('sx-active');
        }
    });

    // ────────────────────────────────────────────────────────────────────────
    // Settings > Appearance Tab — Native Integration (Zero Conflict)
    // ────────────────────────────────────────────────────────────────────────
    function trySXAppearanceSettingsInject() {
        const bulky = document.getElementById('sx-theme-studio');
        if (bulky) bulky.remove();

        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) {
            const openPop = document.getElementById('sx-preset-dropdown-popover');
            if (openPop) openPop.remove();
            return;
        }

        // Check if on Appearance tab: look for "Dark Theme"
        const all = Array.from(dialog.querySelectorAll('*'));
        const darkThemeH3 = all.find(el => el.children.length === 0 && el.textContent.trim() === 'Dark Theme');
        if (!darkThemeH3) return;

        const card = darkThemeH3.closest('.border') || darkThemeH3.parentElement?.parentElement;
        if (!card) return;

        // 1. Locate the native Preset row
        const presetLabel = Array.from(card.querySelectorAll('*')).find(el => el.children.length === 0 && el.textContent.trim() === 'Preset');
        const presetRow = presetLabel ? presetLabel.closest('.flex.items-center.justify-between') || presetLabel.parentElement?.parentElement : null;
        if (!presetRow) return;

        // 2. Hide native Base-UI Combobox to prevent conflict & hardcoded default resets
        const nativeCombo = presetRow.querySelector('button[role="combobox"]');
        if (nativeCombo) {
            nativeCombo.style.setProperty('display', 'none', 'important');
        }

        // Also suppress native Base-UI listbox if it accidentally opens
        const nativeListbox = document.querySelector('[role="listbox"]');
        if (nativeListbox) {
            nativeListbox.style.setProperty('display', 'none', 'important');
        }

        const activeThemeId = localStorage.getItem('sx_active_theme_preset') || 'sx-signature';
        const curPreset = SX_THEME_PRESETS.find(x => x.id === activeThemeId) || SX_THEME_PRESETS[0];

        // 3. Inject or update SX Preset Combobox Button
        let sxBtn = presetRow.querySelector('#sx-preset-combobox-btn');
        if (!sxBtn) {
            sxBtn = document.createElement('button');
            sxBtn.id = 'sx-preset-combobox-btn';
            sxBtn.type = 'button';
            sxBtn.className = 'appearance-none px-3 py-1.5 text-sm bg-secondary text-secondary-foreground hover:text-foreground rounded-md border-none cursor-pointer flex items-center gap-2 justify-between min-w-[170px] transition-all';
            sxBtn.style.cssText = 'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);outline:none;font-weight:500;position:relative;cursor:pointer;user-select:none;';
            sxBtn.innerHTML = `
                <div style="display:flex;align-items:center;gap:7px;min-width:0;">
                    <span id="sx-preset-btn-dot" style="width:7px;height:7px;border-radius:50%;background:${curPreset.primary};box-shadow:0 0 5px ${curPreset.primary};flex-shrink:0;"></span>
                    <span class="sx-preset-btn-name truncate" style="font-size:13px;font-weight:600;color:rgba(255,255,255,0.95);">${curPreset.name}</span>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.6;flex-shrink:0;"><polyline points="6 9 12 15 18 9"></polyline></svg>
            `;

            if (nativeCombo && nativeCombo.parentElement) {
                nativeCombo.parentElement.appendChild(sxBtn);
            } else {
                presetRow.appendChild(sxBtn);
            }
        }

        if (!sxBtn.dataset.sxBound) {
            sxBtn.dataset.sxBound = 'true';
            sxBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleSXThemePresetPopover(sxBtn);
            });
        }

        // Keep button in sync with active preset
        const nameEl = sxBtn.querySelector('.sx-preset-btn-name');
        if (nameEl && nameEl.innerText !== curPreset.name) {
            nameEl.innerText = curPreset.name;
        }
        const dotEl = sxBtn.querySelector('#sx-preset-btn-dot');
        if (dotEl && dotEl.style.background !== curPreset.primary) {
            dotEl.style.background = curPreset.primary;
            dotEl.style.boxShadow = `0 0 5px ${curPreset.primary}`;
        }

        // 4. Hook native undo button in Preset row to reset to active SX preset
        const undoBtn = presetRow.querySelector('button:not(#sx-preset-combobox-btn)');
        if (undoBtn && !undoBtn.dataset.sxHooked) {
            undoBtn.dataset.sxHooked = 'true';
            undoBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                sxApplyThemePreset(curPreset, true);
            }, true);
        }

        // 5. Inject sleek quick-preset pills bar directly below Preset row
        let pillBar = card.querySelector('#sx-quick-presets-bar');
        if (!pillBar) {
            pillBar = document.createElement('div');
            pillBar.id = 'sx-quick-presets-bar';
            pillBar.style.cssText = 'display:flex;align-items:center;gap:5px;padding:6px 10px;margin:3px 0 6px 0;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.06);border-radius:8px;overflow-x:auto;flex-wrap:wrap;';

            const label = document.createElement('span');
            label.style.cssText = 'font-size:11px;font-weight:700;color:#38bdf8;display:flex;align-items:center;gap:3px;margin-right:3px;flex-shrink:0;user-select:none;';
            label.innerHTML = '⚡ <span>SX:</span>';
            pillBar.appendChild(label);

            SX_THEME_PRESETS.forEach(p => {
                const isMatch = (p.id === activeThemeId);
                const pill = document.createElement('button');
                pill.type = 'button';
                pill.className = 'sx-preset-pill';
                pill.dataset.sxId = p.id;
                pill.style.cssText = `display:inline-flex;align-items:center;gap:4.5px;background:${isMatch ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)'};border:1px solid ${isMatch ? p.primary : 'rgba(255,255,255,0.1)'};padding:3px 8px;border-radius:5px;cursor:pointer;font-size:11px;font-weight:500;color:${isMatch ? '#ffffff' : 'rgba(255,255,255,0.85)'};transition:all 0.15s ease;flex-shrink:0;`;
                pill.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:${p.primary};box-shadow:0 0 4px ${p.primary}88;"></span>${p.name.replace('SX ', '')}`;
                
                pill.addEventListener('mouseenter', () => {
                    pill.style.background = 'rgba(255,255,255,0.12)';
                    pill.style.borderColor = p.primary;
                    pill.style.color = '#ffffff';
                });
                pill.addEventListener('mouseleave', () => {
                    const currentId = localStorage.getItem('sx_active_theme_preset') || 'sx-signature';
                    const active = (p.id === currentId);
                    pill.style.background = active ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
                    pill.style.borderColor = active ? p.primary : 'rgba(255,255,255,0.1)';
                    pill.style.color = active ? '#ffffff' : 'rgba(255,255,255,0.85)';
                });
                pill.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    sxApplyThemePreset(p, true);
                });
                pillBar.appendChild(pill);
            });

            if (presetRow.parentElement) {
                if (presetRow.nextElementSibling) {
                    presetRow.parentElement.insertBefore(pillBar, presetRow.nextElementSibling);
                } else {
                    presetRow.parentElement.appendChild(pillBar);
                }
            }
        }
    }

    // Popover Dropdown Renderer for SX Presets
    function toggleSXThemePresetPopover(triggerBtn) {
        const existing = document.getElementById('sx-preset-dropdown-popover');
        if (existing) {
            existing.remove();
            return;
        }

        const rect = triggerBtn.getBoundingClientRect();
        const popover = document.createElement('div');
        popover.id = 'sx-preset-dropdown-popover';
        popover.style.cssText = `
            position: fixed;
            top: ${rect.bottom + 5}px;
            right: ${window.innerWidth - rect.right}px;
            min-width: 260px;
            background: #14171F;
            border: 1px solid rgba(255,255,255,0.14);
            border-radius: 8px;
            padding: 6px;
            box-shadow: 0 12px 30px -4px rgba(0,0,0,0.7), 0 6px 12px -4px rgba(0,0,0,0.5);
            z-index: 999999;
            display: flex;
            flex-direction: column;
            gap: 2px;
            font-family: inherit;
        `;

        const hdr = document.createElement('div');
        hdr.style.cssText = 'padding:6px 10px 4px 10px;font-size:10px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#38bdf8;display:flex;align-items:center;gap:5px;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:4px;user-select:none;';
        hdr.innerHTML = '<span>⚡</span> <span>SX Theme Presets</span>';
        popover.appendChild(hdr);

        const activeId = localStorage.getItem('sx_active_theme_preset') || 'sx-signature';

        SX_THEME_PRESETS.forEach(p => {
            const isMatch = (p.id === activeId);
            const item = document.createElement('div');
            item.className = 'sx-popover-item';
            item.style.cssText = `
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 10px;
                border-radius: 6px;
                cursor: pointer;
                transition: background 0.12s;
                user-select: none;
                ${isMatch ? 'background: rgba(56,189,248,0.1);' : ''}
            `;

            item.innerHTML = `
                <span style="width:8px;height:8px;border-radius:50%;background:${p.primary};box-shadow:0 0 6px ${p.primary}aa;flex-shrink:0;"></span>
                <span class="truncate" style="font-size:12.5px;font-weight:600;color:rgba(255,255,255,0.92);flex:1;min-width:0;">${p.name}</span>
                <span style="font-size:9px;font-weight:700;color:${p.tagColor};background:${p.tagColor}18;border:1px solid ${p.tagColor}33;padding:1px 5px;border-radius:4px;flex-shrink:0;">${p.badge}</span>
                ${isMatch ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="' + p.primary + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:4px;flex-shrink:0;"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
            `;

            item.addEventListener('mouseenter', () => {
                if (!isMatch) item.style.background = 'rgba(255,255,255,0.07)';
            });
            item.addEventListener('mouseleave', () => {
                if (!isMatch) item.style.background = 'transparent';
            });
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                sxApplyThemePreset(p, true);
                popover.remove();
            });

            popover.appendChild(item);
        });

        // Close on click outside or Escape
        function dismissPopover(ev) {
            if (!popover.contains(ev.target) && ev.target !== triggerBtn && !triggerBtn.contains(ev.target)) {
                popover.remove();
                document.removeEventListener('click', dismissPopover);
                document.removeEventListener('keydown', dismissKey);
            }
        }
        function dismissKey(ev) {
            if (ev.key === 'Escape') {
                popover.remove();
                document.removeEventListener('click', dismissPopover);
                document.removeEventListener('keydown', dismissKey);
            }
        }
        setTimeout(() => {
            document.addEventListener('click', dismissPopover);
            document.addEventListener('keydown', dismissKey);
        }, 10);

        document.body.appendChild(popover);
    }

    // ────────────────────────────────────────────────────────────────────────
    // DOM Hook Loop: empty state banner + sync trigger
    // ────────────────────────────────────────────────────────────────────────
    function hookDOM() {
        // ── 1. Model selector dropdown ──
        const sxPopperMenu = document.querySelector('div[data-radix-popper-content-wrapper] [role="menu"]');
        if (sxPopperMenu && !sxPopperMenu.closest('[data-sx-usage-panel]')) {
            const sxModels = getSXModels();
            let card = sxPopperMenu.querySelector('#sx-no-models-card');
            if (sxModels.length === 0) {
                Array.from(sxPopperMenu.children).forEach(el => {
                    if (el.id === 'sx-no-models-card') return;
                    el.style.cssText = 'display:none!important';
                });
                if (!card) {
                    card = document.createElement('div');
                    card.id = 'sx-no-models-card';
                    card.style.cssText = 'padding:24px 18px;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-width:240px;';
                    card.innerHTML =
                        '<div style="font-size:28px;line-height:1;margin-bottom:2px;">⚡</div>' +
                        '<div style="font-size:14px;font-weight:700;color:rgba(255,255,255,0.95);letter-spacing:-0.2px;">Henüz Model Eklenmedi</div>' +
                        '<div style="font-size:11px;color:rgba(255,255,255,0.45);line-height:1.5;max-width:200px;">Yapay zeka modelini kullanmak icin once bir provider ve model ekleyin.</div>' +
                        '<button id="sx-open-settings-btn" type="button" style="margin-top:4px;background:#fff;border:none;color:#111;font-size:12px;font-weight:700;padding:9px 20px;border-radius:7px;cursor:pointer;display:inline-flex;align-items:center;gap:7px;font-family:inherit;box-shadow:0 4px 14px rgba(0,0,0,0.35);letter-spacing:-0.1px;">Sec + Provider & Model Ekle</button>';
                    sxPopperMenu.prepend(card);
                    card.querySelector('#sx-open-settings-btn').onclick = (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        document.body.click();
                        setTimeout(() => {
                            window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma', ctrlKey: true, bubbles: true }));
                            setTimeout(() => {
                                const ps = document.getElementById('sx-providers-section');
                                if (ps) ps.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }, 450);
                        }, 80);
                    };
                }
            } else if (card) {
                card.remove();
                Array.from(sxPopperMenu.children).forEach(el => { el.style.cssText = ''; });
            }
        }

        // ── 1.1 Model selector search & provider grouping ──
        const modelPanel = document.querySelector('[data-testid="model-selector-panel"]');
        if (modelPanel && !modelPanel.closest('[data-sx-usage-panel]')) {
            const sxModels = getSXModels();
            if (sxModels.length > 0) {
                // Prepend search input at the very top of panel
                let searchWrap = modelPanel.querySelector('#sx-model-search-wrap');
                if (!searchWrap) {
                    searchWrap = document.createElement('div');
                    searchWrap.id = 'sx-model-search-wrap';
                    searchWrap.style.cssText = 'padding: 8px 8px 10px 8px; border-bottom: 1px solid rgba(255,255,255,0.06); background: inherit; position: sticky; top: 0; z-index: 10; box-sizing: border-box;';
                    searchWrap.innerHTML =
                        '<div style="display:flex;align-items:center;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:0 10px;gap:7px;height:32px;box-sizing:border-box;width:100%;transition:border-color 0.15s;">' +
                        '  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:rgba(255,255,255,0.3);flex-shrink:0;">' +
                        '    <circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>' +
                        '  </svg>' +
                        '  <input id="sx-model-search-input" type="text" placeholder="Search models..." style="background:transparent;border:none;outline:none;color:rgba(255,255,255,0.9);font-size:12.5px;width:100%;height:100%;font-family:inherit;line-height:normal;padding:0;margin:0;" autocomplete="off" spellcheck="false" />' +
                        '</div>';
                    modelPanel.prepend(searchWrap);

                    // Focus glow effect
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

                        modelPanel.querySelectorAll('.sx-provider-header').forEach(header => {
                            const pId = header.dataset.providerId;
                            const pItems = modelPanel.querySelectorAll(`.sx-custom-model-item[data-sx-provider="${pId}"]`);
                            const anyVisible = Array.from(pItems).some(i => !i.classList.contains('is-hidden'));
                            header.style.setProperty('display', anyVisible ? 'flex' : 'none', 'important');
                        });

                        let emptyMsg = modelPanel.querySelector('#sx-search-empty');
                        if (visibleCount === 0) {
                            if (!emptyMsg) {
                                emptyMsg = document.createElement('div');
                                emptyMsg.id = 'sx-search-empty';
                                emptyMsg.style.cssText = 'padding:20px 8px;text-align:center;color:rgba(255,255,255,0.3);font-size:12px;';
                                emptyMsg.innerText = 'No matching models';
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

                // Provider grouping & sorting
                const providers = getSXProviders();
                const providerMap = {};
                providers.forEach(p => {
                    providerMap[p.id] = getSXProviderMeta(p);
                });

                // Hide all native items to avoid duplicates/limits
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
                                height: 25px !important;
                                min-height: 25px !important;
                                padding: 0 6px !important;
                                margin: 0 !important;
                                border-radius: 4px !important;
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
                                font-weight: 500 !important;
                            }
                            .sx-custom-model-item .sx-model-title {
                                font-size: 11.5px !important;
                                line-height: normal !important;
                                color: rgba(255, 255, 255, 0.9) !important;
                                overflow: hidden !important;
                                text-overflow: ellipsis !important;
                                white-space: nowrap !important;
                                flex: 1 !important;
                                min-width: 0 !important;
                            }
                        `;
                        document.head.appendChild(st);
                    }

                    const activeId = localStorage.getItem('sx_active_model_id') || (sxModels[0] ? sxModels[0].id : null);

                    if (!listContainer.querySelector('.sx-custom-list-injected')) {
                        // Mark as injected
                        const marker = document.createElement('div');
                        marker.className = 'sx-custom-list-injected';
                        marker.style.display = 'none';
                        listContainer.appendChild(marker);
                        
                        // Group sxModels by provider
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
                            if (groupModels.length === 0) return;
                            
                            const pInfo = providerMap[pId] || { name: (pId === 'other' ? 'Other' : pId), dotColor: '#94a3b8' };
                            
                            // Create Header
                            const header = document.createElement('div');
                            header.className = 'sx-provider-header';
                            header.dataset.providerId = pId;
                            header.style.cssText = 'display:flex;align-items:center;gap:5px;padding:4px 6px 1px 6px;user-select:none;margin-top:2px;';
                            header.innerHTML =
                                `<span style="width:4px;height:4px;border-radius:50%;background:${pInfo.dotColor};box-shadow:0 0 5px ${pInfo.dotColor}88;flex-shrink:0;"></span>` +
                                `<span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:rgba(255,255,255,0.4);">${sxEsc(pInfo.name)}</span>` +
                                `<span style="font-size:8.5px;color:rgba(255,255,255,0.25);margin-left:auto;font-family:ui-monospace,monospace;">${groupModels.length}</span>`;
                            listContainer.appendChild(header);
                            
                            // Create Items
                            groupModels.forEach(m => {
                                const isVision = isVisionModel(m);
                                const isReasoning = /(?:omni|reasoning|r1|think|nemotron-3-nano)/i.test(`${m.modelId || ''} ${m.name || ''}`);
                                const isSelected = (m.id === activeId);
                                
                                // Clone native item shell to inherit exact Antigravity classes and attributes
                                const item = sampleNative ? sampleNative.cloneNode(false) : document.createElement('div');
                                item.removeAttribute('data-testid');
                                item.style.display = 'flex';
                                item.classList.add('sx-custom-model-item');
                                if (isSelected) item.classList.add('is-selected');
                                item.dataset.modelId = m.id;
                                item.dataset.modelLabel = m.name;
                                item.dataset.sxProvider = pId;
                                
                                let rightBadges = '';
                                let ctxTag = formatContextSize(m.contextLength);
                                if (!ctxTag) {
                                    const mLow = (m.modelId || m.name || '').toLowerCase();
                                    if (mLow.includes('1m') || mLow.includes('lightning') || mLow.includes('ultra')) ctxTag = '1M';
                                    else if (mLow.includes('256k') || mLow.includes('pro') || mLow.includes('nemotron') || mLow.includes('qwen') || mLow.includes('step')) ctxTag = '256k';
                                    else if (mLow.includes('128k') || mLow.includes('gpt-4o') || mLow.includes('claude-3') || mLow.includes('gemma')) ctxTag = '128k';
                                    else if (mLow.includes('64k') || mLow.includes('mini')) ctxTag = '64k';
                                    else if (mLow.includes('32k')) ctxTag = '32k';
                                    else ctxTag = '128k';
                                }
                                if (ctxTag) {
                                    rightBadges += `<span style="font-size:8.5px;font-weight:700;letter-spacing:0.2px;color:#a3e635;background:rgba(163,230,53,0.08);border:1px solid rgba(163,230,53,0.22);padding:0.5px 4px;border-radius:3px;line-height:normal;margin-right:4px;">${ctxTag}</span>`;
                                }
                                if (isReasoning) {
                                    rightBadges += '<span style="font-size:8.5px;font-weight:600;letter-spacing:0.2px;color:#fbbf24;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);padding:0.5px 4px;border-radius:3px;line-height:normal;margin-right:4px;">Reasoning</span>';
                                }
                                if (isVision) {
                                    rightBadges += '<span style="font-size:8.5px;font-weight:600;letter-spacing:0.2px;color:#38bdf8;background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.2);padding:0.5px 4px;border-radius:3px;line-height:normal;margin-right:4px;">Vision</span>';
                                }
                                rightBadges += `<span style="width:4px;height:4px;border-radius:50%;background:${pInfo.dotColor};opacity:0.8;display:inline-block;" title="${sxEsc(pInfo.name || '')}"></span>`;
                                
                                const checkSvg = `<svg class="sx-item-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="color:rgba(255,255,255,0.95);margin-left:4px;flex-shrink:0;${isSelected ? '' : 'visibility:hidden;'}"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

                                item.innerHTML = 
                                    `<span class="sx-model-title">${sxEsc(m.name)}</span>` +
                                    `<div style="display:flex;align-items:center;margin-left:auto;flex-shrink:0;">${rightBadges}${checkSvg}</div>`;
                                
                                item.addEventListener('click', () => {
                                    const curConvKey = getActiveConversationKey();
                                    if (curConvKey) {
                                        localStorage.setItem('sx_active_model_' + curConvKey, m.id);
                                    }
                                    localStorage.setItem('sx_active_model_id', m.id);
                                    sxNotifyActiveModel(m.id);
                                    listContainer.querySelectorAll('.sx-custom-model-item').forEach(el => {
                                        el.classList.remove('is-selected');
                                        const c = el.querySelector('.sx-item-check');
                                        if (c) c.style.visibility = 'hidden';
                                    });
                                    item.classList.add('is-selected');
                                    const c = item.querySelector('.sx-item-check');
                                    if (c) c.style.visibility = 'visible';

                                    // Immediately update the trigger button text
                                    const trig = document.querySelector('[data-testid="model-selector-trigger"]');
                                    if (trig) {
                                        const s = trig.querySelector('.truncate') || trig.querySelector('span') || trig;
                                        const pInfo = getSXProviderMeta(m.providerId);
                                        if (s) {
                                            s.dataset.sxKey = m.id + '_' + pInfo.name;
                                            s.style.setProperty('display', 'inline-flex', 'important');
                                            s.style.setProperty('align-items', 'center', 'important');
                                            s.innerHTML = 
                                                (pInfo.name ? `<span class="sx-prov-badge" style="display:inline-flex;align-items:center;gap:3.5px;padding:0.5px 5px;border-radius:4px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);font-size:9.5px;font-weight:700;color:${pInfo.dotColor};margin-right:6px;letter-spacing:0.3px;vertical-align:middle;line-height:normal;flex-shrink:0;"><span style="width:4px;height:4px;border-radius:50%;background:${pInfo.dotColor};"></span>${sxEsc(pInfo.name)}</span>` : '') +
                                                `<span class="sx-model-name-text" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:middle;font-size:12px;font-weight:600;color:rgba(255,255,255,0.95);">${sxEsc(m.name)}</span>`;
                                        }
                                        trig.setAttribute('aria-label', `Select model, current: ${m.name}`);
                                    }

                                    // Trigger React state & close popper
                                    if (sampleNative) sampleNative.click();
                                    setTimeout(hookDOM, 30);
                                });
                                
                                listContainer.appendChild(item);
                            });
                        });
                    } else {
                        // Sync selection checkmark on existing items
                        listContainer.querySelectorAll('.sx-custom-model-item').forEach(el => {
                            const sel = el.dataset.modelId === activeId;
                            el.classList.toggle('is-selected', sel);
                            const c = el.querySelector('.sx-item-check');
                            if (c) c.style.visibility = sel ? 'visible' : 'hidden';
                        });
                    }
                }
            }
        }

        // ── 2. Nuke any floating panel that shows Google quota info ──
        document.querySelectorAll('div[data-radix-popper-content-wrapper]').forEach(popper => {
            if (popper.querySelector('#sx-usage-replaced') || popper.querySelector('[role="menu"]')) return;
            const t = popper.textContent || '';
            if (t.includes('Gemini Models') || t.includes('Weekly Limit') || t.includes('Claude and GPT') || t.includes('Five Hour Limit') || t.includes('Model Credits')) {
                popper.setAttribute('data-sx-usage-panel', '1');
                const rep = document.createElement('div');
                rep.id = 'sx-usage-replaced';
                rep.style.cssText = 'padding:18px 20px;min-width:260px;text-align:center;';
                rep.innerHTML =
                    '<div style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px;">Antigravity Pro Engine</div>' +
                    '<div style="font-size:12px;color:rgba(255,255,255,0.35);line-height:1.5;">Kota takibi devre disi.<br>Dogrudan provider baglantisi aktif.</div>';
                Array.from(popper.children).forEach(el => { if (el !== rep) el.style.cssText = 'display:none!important'; });
                popper.appendChild(rep);
            }
        });

        // ── 2.5 Sync active model per conversation ──
        const currentConvKey = getActiveConversationKey();
        let savedConvModel = localStorage.getItem('sx_active_model_' + currentConvKey);

        // If this conversation doesn't have a model yet and it's a specific conversation (not conv_new):
        if (!savedConvModel && currentConvKey !== 'conv_new') {
            const fallbackModel = localStorage.getItem('sx_active_model_conv_new') || localStorage.getItem('sx_active_model_id');
            if (fallbackModel) {
                savedConvModel = fallbackModel;
                localStorage.setItem('sx_active_model_' + currentConvKey, fallbackModel);
                sxNotifyActiveModel(fallbackModel, false);
            }
        }

        if (savedConvModel) {
            const currentGlobalActive = localStorage.getItem('sx_active_model_id');
            if (savedConvModel !== currentGlobalActive) {
                localStorage.setItem('sx_active_model_id', savedConvModel);
                sxNotifyActiveModel(savedConvModel, true);
            }
        }

        // ── 3. Trigger button text cleanup & sync ──
        const trigger = document.querySelector('[data-testid="model-selector-trigger"]');
        if (trigger) {
            const sxModels = getSXModels();
            if (sxModels.length === 0) {
                const walker = document.createTreeWalker(trigger, NodeFilter.SHOW_TEXT);
                let node;
                while ((node = walker.nextNode())) {
                    if (node.nodeValue && (node.nodeValue.includes('No Models Configured') || node.nodeValue.includes('Setup Required') || node.nodeValue.includes('SX Custom Engine'))) {
                        node.nodeValue = 'Kurulum Gerekli';
                    }
                }
            } else {
                const curConv = getActiveConversationKey();
                const activeId = (curConv ? localStorage.getItem('sx_active_model_' + curConv) : null) || localStorage.getItem('sx_active_model_id');
                const activeM = sxModels.find(m => m.id === activeId) || sxModels[0];
                if (activeM) {
                    const pInfo = getSXProviderMeta(activeM.providerId);
                    const provName = pInfo.name;
                    const dotColor = pInfo.dotColor;

                    const s = trigger.querySelector('.truncate') || trigger.querySelector('span') || trigger;
                    const desiredKey = activeM.id + '_' + provName;
                    if (s && (s.dataset.sxKey !== desiredKey || s.innerText.includes('SX Custom Engine') || !s.querySelector('.sx-prov-badge'))) {
                        s.dataset.sxKey = desiredKey;
                        s.style.setProperty('display', 'inline-flex', 'important');
                        s.style.setProperty('align-items', 'center', 'important');
                        s.style.setProperty('max-width', 'none', 'important');
                        s.style.setProperty('overflow', 'visible', 'important');
                        s.innerHTML = 
                            (provName ? `<span class="sx-prov-badge" style="display:inline-flex;align-items:center;gap:3.5px;padding:0.5px 5px;border-radius:4px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);font-size:9.5px;font-weight:700;color:${dotColor};margin-right:6px;letter-spacing:0.3px;vertical-align:middle;line-height:normal;flex-shrink:0;"><span style="width:4px;height:4px;border-radius:50%;background:${dotColor};"></span>${sxEsc(provName)}</span>` : '') +
                            `<span class="sx-model-name-text" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:middle;font-size:12px;font-weight:600;color:rgba(255,255,255,0.95);">${sxEsc(activeM.name)}</span>`;
                    }

                    trigger.setAttribute('aria-label', `Select model, current: ${activeM.name}`);

                    // ── 3.04 Constrain trigger layout ──
                    if (trigger.parentElement) {
                        trigger.parentElement.style.setProperty('display', 'flex', 'important');
                        trigger.parentElement.style.setProperty('flex-direction', 'row', 'important');
                        trigger.parentElement.style.setProperty('flex-wrap', 'nowrap', 'important');
                        trigger.parentElement.style.setProperty('align-items', 'center', 'important');

                        trigger.style.setProperty('max-width', '450px', 'important');
                        trigger.style.setProperty('flex-shrink', '0', 'important');
                        trigger.style.setProperty('overflow', 'hidden', 'important');
                        trigger.style.setProperty('white-space', 'nowrap', 'important');

                        const nameSpan = trigger.querySelector('.sx-model-name-text');
                        if (nameSpan) {
                            nameSpan.style.setProperty('max-width', '320px', 'important');
                            nameSpan.style.setProperty('overflow', 'hidden', 'important');
                            nameSpan.style.setProperty('text-overflow', 'ellipsis', 'important');
                            nameSpan.style.setProperty('white-space', 'nowrap', 'important');
                            nameSpan.style.setProperty('display', 'inline-block', 'important');
                            nameSpan.style.setProperty('vertical-align', 'middle', 'important');
                        }
                    }
                }
            }
        }

        // ── 3.05 Context Trigger Button & Real-time Live Context Tracker ──
        const sxModelsList = getSXModels();
        const activeModelId = localStorage.getItem('sx_active_model_id');
        const activeModelObj = sxModelsList.find(m => m.id === activeModelId) || sxModelsList[0];

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
            // If button ended up outside actionContainer (e.g. sidebar), remove it immediately
            if (ctxBtn && ctxBtn.parentElement && ctxBtn.parentElement !== actionContainer) {
                ctxBtn.remove();
                ctxBtn = null;
            }

            const micWrapper = actionContainer.querySelector('div.flex.items-center:has(button[aria-label*="Record voice" i]), div.flex.items-center:has([data-tooltip-id*="record-tooltip"])') ||
                actionContainer.querySelector('button[aria-label*="Record voice" i]');
            const sendBtn = actionContainer.querySelector('[data-testid="send-button"], button[aria-label*="send" i], [data-tooltip-id*="send-tooltip"]');
            const cancelBtn = actionContainer.querySelector('button[aria-label*="Cancel" i], [data-tooltip-id*="cancel-tooltip"]');

            // Strictly anchor to the left of microphone, or send, or cancel
            const targetAnchor = micWrapper || sendBtn || cancelBtn;

            if (!ctxBtn) {
                ctxBtn = document.createElement('button');
                ctxBtn.id = 'sx-context-btn';
                ctxBtn.type = 'button';
                ctxBtn.title = 'Context Window (Tıkla)';
                ctxBtn.style.cssText = `
                    display: inline-flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    width: 28px !important;
                    height: 28px !important;
                    border-radius: 50% !important;
                    background: transparent !important;
                    border: none !important;
                    padding: 0 !important;
                    cursor: pointer !important;
                    user-select: none !important;
                    margin: 0 !important;
                    flex-shrink: 0 !important;
                    outline: none !important;
                    box-shadow: none !important;
                    transition: background-color 0.15s ease !important;
                    line-height: 0 !important;
                `;

                ctxBtn.addEventListener('mouseenter', () => {
                    ctxBtn.style.setProperty('background', 'rgba(255, 255, 255, 0.08)', 'important');
                });
                ctxBtn.addEventListener('mouseleave', () => {
                    ctxBtn.style.setProperty('background', 'transparent', 'important');
                });
                ctxBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleContextPopover(ctxBtn);
                });
            }

            ctxBtn.style.setProperty('border', 'none', 'important');
            ctxBtn.style.setProperty('box-shadow', 'none', 'important');
            ctxBtn.style.setProperty('border-radius', '50%', 'important');
            ctxBtn.style.setProperty('margin', '0', 'important');

            // ── Speed & Performance Monitor Button (Placed immediately to the left of Context Window) ──
            let perfBtn = document.getElementById('sx-perf-btn');
            if (perfBtn && perfBtn.parentElement && perfBtn.parentElement !== actionContainer) {
                perfBtn.remove();
                perfBtn = null;
            }

            if (!perfBtn) {
                perfBtn = document.createElement('button');
                perfBtn.id = 'sx-perf-btn';
                perfBtn.type = 'button';
                perfBtn.title = 'Model Performansı (TTFT, TPS) (Tıkla)';
                perfBtn.style.cssText = `
                    display: inline-flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    width: 28px !important;
                    height: 28px !important;
                    border-radius: 50% !important;
                    background: transparent !important;
                    border: none !important;
                    padding: 0 !important;
                    cursor: pointer !important;
                    user-select: none !important;
                    margin: 0 !important;
                    flex-shrink: 0 !important;
                    outline: none !important;
                    box-shadow: none !important;
                    transition: background-color 0.15s ease !important;
                    line-height: 0 !important;
                `;
                perfBtn.innerHTML = `
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;pointer-events:none;color:#94a3b8;transition:color 0.15s ease;">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                    </svg>
                `;

                perfBtn.addEventListener('mouseenter', () => {
                    perfBtn.style.setProperty('background', 'rgba(255, 255, 255, 0.08)', 'important');
                    const icon = perfBtn.querySelector('svg');
                    if (icon) icon.style.color = '#eab308';
                });
                perfBtn.addEventListener('mouseleave', () => {
                    perfBtn.style.setProperty('background', 'transparent', 'important');
                    const icon = perfBtn.querySelector('svg');
                    if (icon) icon.style.color = '#94a3b8';
                });
                perfBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    togglePerfPopover(perfBtn);
                });
            }

            perfBtn.style.setProperty('border', 'none', 'important');
            perfBtn.style.setProperty('box-shadow', 'none', 'important');
            perfBtn.style.setProperty('border-radius', '50%', 'important');
            perfBtn.style.setProperty('margin', '0', 'important');

            if (targetAnchor && targetAnchor.parentElement === actionContainer) {
                if (targetAnchor.previousElementSibling !== ctxBtn) {
                    actionContainer.insertBefore(ctxBtn, targetAnchor);
                }
            } else if (!actionContainer.contains(ctxBtn)) {
                actionContainer.appendChild(ctxBtn);
            }

            // Strictly place perfBtn immediately before ctxBtn (to its left)
            if (ctxBtn.previousElementSibling !== perfBtn) {
                actionContainer.insertBefore(perfBtn, ctxBtn);
            }

            // Real-time live context update (typing + active stats)
            updateLiveContextUI();
            updatePerfButtonUI();

            // Periodic & conversation switch detection
            const activeConvKey = getActiveConversationKey();
            const cleanConvId = activeConvKey.replace(/^conv_/, '');
            const now = Date.now();

            if (activeConvKey !== window._sxCurrentConvKey) {
                const prevKey = window._sxCurrentConvKey;
                window._sxCurrentConvKey = activeConvKey;
                console.log('[SX] Switched conversation from', prevKey, 'to', activeConvKey);

                let savedModel = localStorage.getItem('sx_active_model_' + activeConvKey);
                if (!savedModel && activeConvKey !== 'conv_new') {
                    savedModel = localStorage.getItem('sx_active_model_conv_new') || localStorage.getItem('sx_active_model_id');
                    if (savedModel) {
                        localStorage.setItem('sx_active_model_' + activeConvKey, savedModel);
                        sxNotifyActiveModel(savedModel, false);
                    }
                }
                if (savedModel && savedModel !== localStorage.getItem('sx_active_model_id')) {
                    localStorage.setItem('sx_active_model_id', savedModel);
                    sxNotifyActiveModel(savedModel, true);
                }

                updateLiveContextUI();
                updatePerfButtonUI();

                sxFetchContextDetails(cleanConvId, activeModelObj?.id, true).then(data => {
                    if (data && window._sxCurrentConvKey === activeConvKey) {
                        updateLiveContextUI();
                    }
                });
                sxFetchPerfStats(cleanConvId).then(() => {
                    if (window._sxCurrentConvKey === activeConvKey) {
                        updatePerfButtonUI();
                    }
                });
            } else {
                // If model is responding (stop/cancel button visible), poll frequently (1500ms) so tokens tick up live!
                const isModelResponding = !!(cancelBtn || actionContainer.querySelector('button[aria-label*="Cancel" i], [data-tooltip-id*="cancel-tooltip"]'));
                const pollInterval = isModelResponding ? 1500 : 4000;
                if (!window._lastContextFetchAuto || now - window._lastContextFetchAuto > pollInterval) {
                    window._lastContextFetchAuto = now;
                    sxFetchContextDetails(cleanConvId, activeModelObj?.id, isModelResponding).then(data => {
                        if (data && window._sxCurrentConvKey === activeConvKey) {
                            updateLiveContextUI();
                        }
                    });
                    sxFetchPerfStats(cleanConvId).then(() => {
                        if (window._sxCurrentConvKey === activeConvKey) {
                            updatePerfButtonUI();
                        }
                    });
                }
            }
        }

        
    const SX_PRO_LOGO_B64 = "data:image/png;base64,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";

        // ── 3.1 Antigravity Pro title & logo ──
        const titleItem = document.querySelector('[data-testid="title-menu-bar-item"]');
        if (titleItem && (titleItem.innerText.includes('Antigravity') || titleItem.innerText.includes('Custom')) && titleItem.innerText !== 'Antigravity Pro') {
            titleItem.innerText = 'Antigravity Pro';
        }
        if (document.title.includes('Antigravity') && document.title !== 'Antigravity Pro') {
            document.title = 'Antigravity Pro';
        }

        const logoSvg = document.querySelector('svg[viewBox="0 0 180 180"]');
        if (logoSvg && !document.getElementById('sx-pro-logo-img')) {
            const img = document.createElement('img');
            img.id = 'sx-pro-logo-img';
            img.src = SX_PRO_LOGO_B64;
            img.style.cssText = 'width:24px;height:24px;border-radius:6px;display:block;box-shadow:0 1px 6px rgba(0,0,0,0.5);';
            logoSvg.parentElement.replaceChild(img, logoSvg);
        }

        // ── 4. SX Development branding badges ──
        const titleBadge = document.getElementById('sx-titlebar-badge');
        if (titleBadge) titleBadge.remove();

        const settingsBtn = document.querySelector('[data-testid="settings-button"]');
        if (settingsBtn) {
            let sBadge = document.getElementById('sx-sidebar-badge');
            if (!sBadge) {
                sBadge = document.createElement('div');
                sBadge.id = 'sx-sidebar-badge';
                sBadge.style.cssText = 'padding:8px 10px 4px 10px;margin-top:6px;display:flex;align-items:center;justify-content:space-between;font-size:11px;border-top:1px solid rgba(255,255,255,0.06);user-select:none;';
                settingsBtn.parentElement.appendChild(sBadge);
            }
            sBadge.innerHTML = '<div style="display:flex;align-items:center;gap:5px;font-weight:700;"><span style="color:#38bdf8;text-shadow:0 0 10px rgba(56,189,248,0.35);">SX</span> <span style="color:#ffffff;">Development</span></div><span style="font-size:9.5px;background:rgba(56,189,248,0.12);color:#38bdf8;padding:1px 6px;border-radius:4px;font-weight:600;border:1px solid rgba(56,189,248,0.25);">Pro</span>';
        }

        const mPanel = document.querySelector('[data-testid="model-selector-panel"]');
        if (mPanel) {
            let fBadge = document.getElementById('sx-panel-footer-badge');
            if (!fBadge) {
                fBadge = document.createElement('div');
                fBadge.id = 'sx-panel-footer-badge';
                fBadge.style.cssText = 'margin-top:4px;padding:6px 10px;border-top:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between;font-size:10.5px;user-select:none;';
                mPanel.appendChild(fBadge);
            } else {
                if (fBadge.style.marginTop !== '4px') fBadge.style.marginTop = '4px';
            }
            fBadge.innerHTML = '<span style="font-weight:700;"><span style="color:#38bdf8;text-shadow:0 0 10px rgba(56,189,248,0.35);">SX</span> <span style="color:#ffffff;">Development</span></span><span style="font-size:9.5px;color:rgba(255,255,255,0.35);font-weight:500;">Custom Engine</span>';
        }

        // ── 5. Symmetric Quota Popover Style & Layout ──
        if (!document.getElementById('sx-custom-quota-style')) {
            const qStyle = document.createElement('style');
            qStyle.id = 'sx-custom-quota-style';
            qStyle.textContent = `
                #sx-panel-footer-badge {
                    margin-top: 4px !important;
                }
                div[role="group"]:has([data-testid="quota-progress-circle"]) > div[role="presentation"] {
                    display: none !important;
                }
                div[role="group"] > div.flex.items-center.justify-between:has([data-testid="quota-progress-circle"]) {
                    padding: 8px 12px !important;
                }
                div[role="group"] > div.flex.items-center.justify-between:has([data-testid="quota-progress-circle"]) .truncate {
                    font-size: 12px !important;
                    font-weight: 500 !important;
                    color: rgba(255, 255, 255, 0.9) !important;
                }
                div[role="group"] > div.flex.items-center.justify-between:has([data-testid="quota-progress-circle"]) .truncate:empty::before {
                    content: "Custom Quota" !important;
                }
            `;
            document.head.appendChild(qStyle);
        }

        const cqHeader = Array.from(document.querySelectorAll('*')).find(e => 
            e.childNodes.length && 
            Array.from(e.childNodes).some(n => n.nodeType === 3 && n.textContent.trim() === 'Custom Quota') &&
            e.getAttribute('role') === 'presentation'
        );
        if (cqHeader) {
            const row = cqHeader.nextElementSibling;
            if (row) {
                const span = row.querySelector('.truncate');
                if (span && !span.textContent.trim()) {
                    span.textContent = 'Custom Quota';
                }
                if (cqHeader.style.display !== 'none') {
                    cqHeader.style.display = 'none';
                }
            }
        }

        trySXModelsSettingsInject();
        trySXAppearanceSettingsInject();
    }

    // ── Startup: restore per-conversation models from proxy disk ──
    function sxRestoreConvModels() {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'http://127.0.0.1:15725/sx/get-conv-models', true);
        xhr.onload = function() {
            try {
                const data = JSON.parse(xhr.responseText);
                if (data.convModels) {
                    // Populate localStorage with all known conv->model mappings
                    Object.entries(data.convModels).forEach(([convKey, modelId]) => {
                        localStorage.setItem('sx_active_model_' + convKey, modelId);
                    });
                    console.log('[SX] Restored', Object.keys(data.convModels).length, 'conv model mappings from disk');
                }
                // Apply global active model
                const savedActiveId = localStorage.getItem('sx_active_model_id') || data.activeModelId;
                if (savedActiveId) {
                    localStorage.setItem('sx_active_model_id', savedActiveId);
                }
                // Apply current conversation's model if known
                const curKey = getActiveConversationKey();
                const curModel = localStorage.getItem('sx_active_model_' + curKey);
                if (curModel) {
                    sxNotifyActiveModel(curModel, true); // forceGlobal so we don't re-save
                } else if (savedActiveId) {
                    sxNotifyActiveModel(savedActiveId);
                }
            } catch(e) {}
        };
        xhr.onerror = function() {
            // Fallback: use localStorage
            try {
                const savedActiveId = localStorage.getItem('sx_active_model_id');
                if (savedActiveId) sxNotifyActiveModel(savedActiveId);
            } catch(e) {}
        };
        xhr.send();
    }
    sxRestoreConvModels();

    // ── Instant conversation navigation listener (URL + History API + Sidebar Clicks) ──
    let _sxLastUrl = window.location.href;
    function checkUrlChange() {
        const cur = window.location.href;
        if (cur !== _sxLastUrl) {
            _sxLastUrl = cur;
            const newConvKey = getActiveConversationKey();
            let saved = localStorage.getItem('sx_active_model_' + newConvKey);
            if (!saved && newConvKey !== 'conv_new') {
                saved = localStorage.getItem('sx_active_model_conv_new') || localStorage.getItem('sx_active_model_id');
                if (saved) {
                    localStorage.setItem('sx_active_model_' + newConvKey, saved);
                    sxNotifyActiveModel(saved, false);
                }
            }
            if (saved) {
                localStorage.setItem('sx_active_model_id', saved);
                sxNotifyActiveModel(saved, true);
            }
            hookDOM();
        }
    }
    setInterval(checkUrlChange, 90);

    // Hook HTML5 History API for instant client-side route transitions
    const _origPushState = history.pushState;
    if (_origPushState) {
        history.pushState = function(...args) {
            const ret = _origPushState.apply(this, args);
            setTimeout(checkUrlChange, 20);
            return ret;
        };
    }
    const _origReplaceState = history.replaceState;
    if (_origReplaceState) {
        history.replaceState = function(...args) {
            const ret = _origReplaceState.apply(this, args);
            setTimeout(checkUrlChange, 20);
            return ret;
        };
    }
    window.addEventListener('popstate', () => { setTimeout(checkUrlChange, 20); });

    // Catch sidebar conversation clicks and "New Conversation" clicks instantly
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
                        sxNotifyActiveModel(saved, true);
                    }
                }
            }
            setTimeout(checkUrlChange, 20);
            setTimeout(hookDOM, 40);
            setTimeout(hookDOM, 120);
            setTimeout(hookDOM, 300);
        }
    }, true);

    window.addEventListener('DOMContentLoaded', () => { setInterval(hookDOM, 150); });
    setInterval(hookDOM, 400);

    console.log('[SX Studio] Direct mode inject initialized successfully.');
})();
