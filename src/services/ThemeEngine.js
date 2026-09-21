/**
 * SX Core SDK - ThemeEngine
 * Dedicated theme engine managing SX custom presets, Jetbox provider sync, and CSS injection.
 */
export const SX_THEME_PRESETS = [
    {
        id: 'sx-matrix',
        name: 'SX Cyber Matrix',
        background: '#030805',
        foreground: '#E2FDF0',
        primary: '#00FF87',
        tagColor: '#00ff87'
    },
    {
        id: 'sx-synthwave',
        name: 'SX Quantum Synthwave',
        background: '#090614',
        foreground: '#FDF2F8',
        primary: '#FF2A85',
        tagColor: '#ff2a85'
    },
    {
        id: 'sx-signature',
        name: 'SX Development Pro',
        background: '#060B12',
        foreground: '#F0F9FF',
        primary: '#00E5FF',
        tagColor: '#00e5ff'
    },
    {
        id: 'sx-cyberpunk',
        name: 'SX Cyberpunk Neon',
        background: '#08090E',
        foreground: '#F1F5F9',
        primary: '#A855F7',
        tagColor: '#a855f7'
    },
    {
        id: 'sx-oled',
        name: 'SX OLED Pure Black',
        background: '#000000',
        foreground: '#F8FAFC',
        primary: '#10B981',
        tagColor: '#10b981'
    },
    {
        id: 'sx-crimson',
        name: 'SX Crimson Eclipse',
        background: '#11090D',
        foreground: '#FFF1F2',
        primary: '#F43F5E',
        tagColor: '#f43f5e'
    },
    {
        id: 'sx-amber',
        name: 'SX Sunset Amber',
        background: '#12100C',
        foreground: '#FEF3C7',
        primary: '#F59E0B',
        tagColor: '#f59e0b'
    },
    {
        id: 'sx-arctic',
        name: 'SX Arctic Glacier',
        background: '#0A1118',
        foreground: '#E6F4F8',
        primary: '#06B6D4',
        tagColor: '#06b6d4'
    },
    {
        id: 'sx-amethyst',
        name: 'SX Royal Amethyst',
        background: '#0F0B18',
        foreground: '#F3E8FF',
        primary: '#C084FC',
        tagColor: '#c084fc'
    },
    {
        id: 'sx-tokyo',
        name: 'SX Tokyo Neon',
        background: '#13141F',
        foreground: '#C0CAF5',
        primary: '#7AA2F7',
        tagColor: '#7aa2f7'
    }
];

export class ThemeEngine {
    constructor(eventBus, storageService, networkClient, logger) {
        this.bus = eventBus;
        this.storage = storageService;
        this.network = networkClient;
        this.logger = logger;
        this.currentThemeId = null;
        this._isApplying = false;
    }

    init() {
        this.patchNativeThemeDict();
        setInterval(() => this.patchNativeThemeDict(), 1000);

        this.bus.on('storage:get-theme', () => {
            this.patchNativeThemeDict();
        });

        this.bus.on('storage:theme-preset-changed', ({ val }) => {
            const found = SX_THEME_PRESETS.find(p => p.name === val || p.id === val);
            if (found) {
                this.storage.silentSetItem('sx_active_theme_preset', found.id);
                if (this.currentThemeId !== found.id) {
                    this.applyPreset(found, false);
                }
            } else {
                this.deactivateSXEffects();
            }
        });

        // Apply saved preset on start
        setTimeout(() => {
            try {
                const initialPreset = localStorage.getItem('theme-preset-dark') || 'SX Cyber Matrix';
                const foundInitial = SX_THEME_PRESETS.find(p => p.name === initialPreset || p.id === initialPreset);
                if (foundInitial) {
                    this.applyPreset(foundInitial, false);
                }
            } catch(e) {}
        }, 150);
    }

    patchNativeThemeDict() {
        try {
            if (typeof window.F$ !== 'undefined') {
                ['dark', 'light'].forEach(mode => {
                    if (window.F$[mode] && !window.F$[mode].__sxPatched) {
                        SX_THEME_PRESETS.forEach(p => {
                            window.F$[mode][p.name] = {
                                background: p.background,
                                foregroundOverride: p.foreground,
                                primary: p.primary
                            };
                        });
                        window.F$[mode] = new Proxy(window.F$[mode], {
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
                        Object.defineProperty(window.F$[mode], '__sxPatched', {
                            value: true,
                            enumerable: false,
                            configurable: true,
                            writable: true
                        });
                    }
                });
            }
        } catch(e) {}
    }

    applyPreset(presetOrId, saveToServer = true) {
        try {
            const preset = typeof presetOrId === 'string'
                ? SX_THEME_PRESETS.find(p => p.id === presetOrId || p.name === presetOrId) || SX_THEME_PRESETS[0]
                : presetOrId;
            if (!preset) return;

            if (this._isApplying) return;
            this._isApplying = true;

            try {
                this.currentThemeId = preset.id;
                window.__sxCurrentThemeId = preset.id;
                this.patchNativeThemeDict();

                this.storage.silentSetItem('sx_active_theme_preset', preset.id);
                this.storage.silentSetItem('theme-preset-dark', preset.name);

                const rgbStr = this._hexToRgbStr(preset.primary);

                // 1. Sync Jetbox Native Provider
                const provider = this._getAntigravityCustomThemeSeedsProvider();
                if (provider && typeof provider.pushUpdate === 'function') {
                    const curState = provider.getState() || {};
                    const curDark = curState.dark || {};
                    if (curDark.background !== preset.background ||
                        curDark.foregroundOverride !== preset.foreground ||
                        curDark.primary !== preset.primary) {
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
                }

                // 2. CSS variables
                const root = document.documentElement;
                if (root && root.style) {
                    root.style.setProperty('--background', preset.background);
                    root.style.setProperty('--foreground', preset.foreground);
                    root.style.setProperty('--primary', preset.primary);
                    root.style.setProperty('--sidebar-background', preset.background);
                    root.style.setProperty('--sx-accent-rgb', rgbStr);
                }

                // 3. Syntax Highlighting CSS Variables
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
                }

                // 4. Inject Dynamic SX Theme Engine Styles
                document.body?.classList.add('sx-theme-active');
                document.body?.setAttribute('data-sx-preset', preset.id);
                document.documentElement?.classList.add('sx-theme-active');

                let styleEl = document.getElementById('sx-theme-engine-styles');
                if (!styleEl) {
                    styleEl = document.createElement('style');
                    styleEl.id = 'sx-theme-engine-styles';
                    const target = document.head || document.documentElement;
                    if (target) target.appendChild(styleEl);
                }
                if (styleEl) styleEl.textContent = this._getThemeCSS(preset, rgbStr);

                // 5. Update combobox label in settings if open
                const d = document.querySelector('[role="dialog"]');
                if (d) {
                    const darkH3 = Array.from(d.querySelectorAll('*')).find(el => el.children.length === 0 && el.textContent.trim() === 'Dark Theme');
                    if (darkH3) {
                        const card = darkH3.closest('.border') || darkH3.parentElement.parentElement;
                        const comboBtn = card?.querySelector('button[role="combobox"] span');
                        if (comboBtn) comboBtn.innerText = preset.name;
                    }
                }

                // 6. Persist to proxy
                if (saveToServer) {
                    this.network.saveTheme({
                        background: preset.background,
                        foregroundOverride: preset.foreground,
                        primary: preset.primary
                    });
                }

                this.bus.emit('theme:applied', preset);
            } finally {
                this._isApplying = false;
            }
        } catch(e) {
            this.logger.error('ThemeEngine', 'Error applying theme', e);
            this._isApplying = false;
        }
    }

    deactivateSXEffects() {
        this.currentThemeId = null;
        window.__sxCurrentThemeId = null;
        try {
            if (document.body) {
                document.body.classList.remove('sx-theme-active');
                document.body.removeAttribute('data-sx-preset');
            }
            if (document.documentElement) {
                document.documentElement.classList.remove('sx-theme-active');
            }
            const styleEl = document.getElementById('sx-theme-engine-styles');
            if (styleEl) styleEl.remove();
        } catch(e) {}
    }

    _hexToRgbStr(hex) {
        if (!hex) return '56, 189, 248';
        let c = hex.replace('#', '');
        if (c.length === 3) c = c.split('').map(x => x + x).join('');
        const num = parseInt(c, 16);
        return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`;
    }

    _getAntigravityCustomThemeSeedsProvider() {
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

    _getThemeCSS(preset, rgbStr) {
        return `
            body.sx-theme-active, html.sx-theme-active {
                --background: ${preset.background} !important;
                --foreground: ${preset.foreground} !important;
                --primary: ${preset.primary} !important;
                --sidebar-background: ${preset.background} !important;
                --sx-accent-rgb: ${rgbStr} !important;
            }
            body.sx-theme-active {
                background-color: ${preset.background} !important;
                color: ${preset.foreground} !important;
            }
            body.sx-theme-active textarea {
                color: ${preset.foreground} !important;
                caret-color: ${preset.primary} !important;
            }
            body.sx-theme-active div[class*="bg-background"],
            body.sx-theme-active main,
            body.sx-theme-active nav,
            body.sx-theme-active aside {
                background-color: ${preset.background} !important;
            }

            /* SX Atmospheric Lighting Field (Top-Center Luminous Glow) */
            body.sx-theme-active .flex-1.flex.min-h-0.relative::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 460px;
                background: radial-gradient(ellipse 80% 380px at 50% -10%, rgba(var(--sx-accent-rgb), 0.16), rgba(var(--sx-accent-rgb), 0.04) 55%, transparent 85%);
                pointer-events: none;
                z-index: 0;
            }

            /* SX Subtle Tech Matrix / Grid Atmosphere */
            body.sx-theme-active .flex-1.flex.min-h-0.relative {
                background-image: radial-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px);
                background-size: 28px 28px;
            }

            /* Floating Prompt Card Glassmorphism & Cyber Glow */
            body.sx-theme-active .bg-card.rounded-\\[calc\\(theme\\(borderRadius\\.2xl\\)-1px\\)\\] {
                background: rgba(6, 10, 16, 0.74) !important;
                backdrop-filter: blur(20px) saturate(180%) !important;
                border: 1px solid rgba(var(--sx-accent-rgb), 0.28) !important;
                box-shadow: 0 12px 36px -4px rgba(0, 0, 0, 0.65), 0 0 20px -2px rgba(var(--sx-accent-rgb), 0.18) !important;
                transition: border-color 0.2s ease, box-shadow 0.2s ease;
            }
            body.sx-theme-active .bg-card.rounded-\\[calc\\(theme\\(borderRadius\\.2xl\\)-1px\\)\\]:focus-within {
                border-color: var(--primary) !important;
                box-shadow: 0 12px 36px -4px rgba(0, 0, 0, 0.75), 0 0 28px -2px rgba(var(--sx-accent-rgb), 0.35) !important;
            }

            /* Sleek Cyber Scrollbars */
            body.sx-theme-active *::-webkit-scrollbar {
                width: 6px;
                height: 6px;
            }
            body.sx-theme-active *::-webkit-scrollbar-track {
                background: transparent;
            }
            body.sx-theme-active *::-webkit-scrollbar-thumb {
                background: rgba(var(--sx-accent-rgb), 0.25);
                border-radius: 9999px;
            }
            body.sx-theme-active *::-webkit-scrollbar-thumb:hover {
                background: var(--primary);
                box-shadow: 0 0 10px var(--primary);
            }

            /* Developer Code Blocks Obsidian Glass */
            body.sx-theme-active pre {
                border: 1px solid rgba(var(--sx-accent-rgb), 0.20) !important;
                background: rgba(3, 7, 12, 0.65) !important;
                box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4) !important;
                border-radius: 8px !important;
            }

            /* Primary Buttons Glow */
            body.sx-theme-active button.bg-primary {
                box-shadow: 0 0 14px rgba(var(--sx-accent-rgb), 0.4) !important;
            }

            /* Active Sidebar Conversation */
            body.sx-theme-active .bg-secondary:not(button):not(input) {
                border-left: 2px solid var(--primary);
            }
        `;
    }
}
