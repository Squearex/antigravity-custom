/**
 * SX Core SDK - ThemeEngine
 * Dedicated theme engine managing SX custom presets, Jetbox provider sync, and CSS injection.
 */
import { NATIVE_DARK_THEMES, NATIVE_LIGHT_THEMES } from './StorageService.js';

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
                // User (or app) switched to a native theme: clear the SX marker so
                // boot doesn't resurrect the old SX theme against explicit intent.
                this.storage.silentSetItem('sx_active_theme_preset', '');
                this.deactivateSXEffects();
            }
        });

        this.bus.on('storage:theme-mode-changed', ({ val }) => {
            if (val === 'light') {
                this.deactivateSXEffects();
            } else if (val === 'dark') {
                const savedId = localStorage.getItem('sx_active_theme_preset');
                const found = savedId && SX_THEME_PRESETS.find(p => p.id === savedId);
                if (found) {
                    this.applyPreset(found, false);
                }
            }
        });

        this.bus.on('storage:theme-preset-light-changed', () => {
            this.deactivateSXEffects();
        });

        // Apply saved preset on start. Prefer the SX marker: the app may reset
        // theme-preset-dark to a native default on boot, which must not wipe
        // the user's last SX theme.
        setTimeout(() => {
            try {
                const isLight = document.documentElement.classList.contains('light') || 
                                document.body?.classList.contains('light') ||
                                (document.documentElement.getAttribute('data-theme') === 'light');
                if (isLight) {
                    this.deactivateSXEffects();
                    return;
                }

                const savedId = localStorage.getItem('sx_active_theme_preset') || '';
                const darkVal = localStorage.getItem('theme-preset-dark') || '';
                const savedPreset = savedId && SX_THEME_PRESETS.find(p => p.id === savedId);
                let foundInitial = null;
                if (savedPreset && darkVal !== savedPreset.name) {
                    foundInitial = savedPreset;
                } else {
                    foundInitial = SX_THEME_PRESETS.find(p => p.name === darkVal || p.id === darkVal);
                }
                if (foundInitial) {
                    this.applyPreset(foundInitial, false);
                }
            } catch(e) {}
        }, 150);

        // Auto-detect mode switch (e.g. user toggles Light/Dark in Settings)
        try {
            const checkMode = () => {
                const isLight = document.documentElement.classList.contains('light') || 
                                document.body?.classList.contains('light') ||
                                (document.documentElement.getAttribute('data-theme') === 'light');
                const isDark = document.documentElement.classList.contains('dark') || 
                               document.body?.classList.contains('dark') ||
                               (document.documentElement.getAttribute('data-theme') === 'dark');
                if (isLight && !isDark) {
                    this.deactivateSXEffects();
                }
            };

            const modeObs = new MutationObserver(checkMode);
            if (document.documentElement) {
                modeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
            }
            if (document.body) {
                modeObs.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
            }
            checkMode();
        } catch(e) {}
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
                if (NATIVE_DARK_THEMES.has(preset.name)) {
                    this.storage.silentSetItem('theme-preset-dark', preset.name);
                } else {
                    this.storage.silentSetItem('theme-preset-dark', 'Default Dark');
                }

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

                // 2. Clear any inline CSS variables so stylesheet rules take effect cleanly without leaking into light theme
                const root = document.documentElement;
                if (root && root.style) {
                    const rootProps = ['--background', '--foreground', '--primary', '--sidebar-background', '--sx-accent-rgb'];
                    rootProps.forEach(p => root.style.removeProperty(p));
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
                const synProps = [
                    '--syntax-comment', '--syntax-punctuation', '--syntax-property',
                    '--syntax-tag', '--syntax-constant', '--syntax-number', '--syntax-string',
                    '--syntax-attr-name', '--syntax-builtin', '--syntax-operator',
                    '--syntax-variable', '--syntax-attr-value', '--syntax-keyword', '--syntax-function'
                ];
                synProps.forEach(p => document.body.style.removeProperty(p));
            }
            if (document.documentElement) {
                document.documentElement.classList.remove('sx-theme-active');
                const rootProps = ['--background', '--foreground', '--primary', '--sidebar-background', '--sx-accent-rgb'];
                rootProps.forEach(p => document.documentElement.style.removeProperty(p));
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
            html.dark.sx-theme-active, body.dark.sx-theme-active, html.dark body.sx-theme-active {
                --background: ${preset.background} !important;
                --foreground: ${preset.foreground} !important;
                --primary: ${preset.primary} !important;
                --sidebar-background: ${preset.background} !important;
                --sx-accent-rgb: ${rgbStr} !important;
            }
            html.dark body.sx-theme-active, body.dark.sx-theme-active {
                background-color: ${preset.background} !important;
                color: ${preset.foreground} !important;
            }
            html.dark.sx-theme-active textarea, body.dark.sx-theme-active textarea {
                color: ${preset.foreground} !important;
                caret-color: ${preset.primary} !important;
            }
            html.dark.sx-theme-active div[class*="bg-background"],
            html.dark.sx-theme-active main,
            html.dark.sx-theme-active nav,
            html.dark.sx-theme-active aside,
            body.dark.sx-theme-active div[class*="bg-background"],
            body.dark.sx-theme-active main,
            body.dark.sx-theme-active nav,
            body.dark.sx-theme-active aside {
                background-color: ${preset.background} !important;
            }

            /* SX Atmospheric Lighting Field (Expanded, Softer Luminous Glow) */
            html.dark.sx-theme-active .relative.z-0.flex-1.flex.min-h-0.h-full,
            body.dark.sx-theme-active .relative.z-0.flex-1.flex.min-h-0.h-full {
                position: relative;
                overflow: hidden;
                background-color: var(--background) !important;
                background-image: 
                    radial-gradient(ellipse 130% 90% at 50% 15%, rgba(var(--sx-accent-rgb), 0.05) 0%, transparent 80%),
                    radial-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px) !important;
                background-size: 100% 100%, 28px 28px !important;
            }
            html.dark.sx-theme-active .relative.z-0.flex-1.flex.min-h-0.h-full::before,
            body.dark.sx-theme-active .relative.z-0.flex-1.flex.min-h-0.h-full::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 100%;
                max-height: 1050px;
                background: radial-gradient(ellipse 110% 800px at 50% -2%, rgba(var(--sx-accent-rgb), 0.16) 0%, rgba(var(--sx-accent-rgb), 0.08) 35%, rgba(var(--sx-accent-rgb), 0.03) 65%, transparent 95%);
                pointer-events: none;
                z-index: 0;
            }

            /* Transparent Sticky Chat Message Headers (Prevents dark block artifacts) */
            html.dark body.sx-theme-active div.sticky.top-0,
            body.dark.sx-theme-active div.sticky.top-0 {
                background: transparent !important;
            }
            html.dark body.sx-theme-active div.sticky.top-0::after,
            body.dark.sx-theme-active div.sticky.top-0::after {
                display: none !important;
            }

            /* Message Actions Container (Eliminates dark box and dark shadow bleed) */
            html.dark body.sx-theme-active [class*="group/user-input-step"] .user-input-buttons-shadow,
            html.dark body.sx-theme-active [data-testid="user-input-step"] .user-input-buttons-shadow,
            body.dark.sx-theme-active [class*="group/user-input-step"] .user-input-buttons-shadow,
            body.dark.sx-theme-active [data-testid="user-input-step"] .user-input-buttons-shadow {
                box-shadow: none !important;
            }

            /* Assistant Message Timestamp & Performance Metrics */
            html.dark body.sx-theme-active .flex.w-full.items-start.gap-1 > .grow,
            body.dark.sx-theme-active .flex.w-full.items-start.gap-1 > .grow {
                opacity: 0.85 !important;
                transition: opacity 0.15s ease;
            }
            html.dark body.sx-theme-active .flex.w-full.items-start.gap-1:hover > .grow,
            body.dark.sx-theme-active .flex.w-full.items-start.gap-1:hover > .grow {
                opacity: 1 !important;
            }
            .sx-msg-perf-metrics {
                user-select: none;
                cursor: default;
                display: inline-flex;
                align-items: center;
                gap: 5px;
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                font-size: 11px;
                margin-left: 8px;
                line-height: 1;
            }

            /* Floating Prompt Card Glassmorphism & Cyber Glow */
            html.dark body.sx-theme-active .bg-card.rounded-\\[calc\\(theme\\(borderRadius\\.2xl\\)-1px\\)\\],
            body.dark.sx-theme-active .bg-card.rounded-\\[calc\\(theme\\(borderRadius\\.2xl\\)-1px\\)\\] {
                background: rgba(6, 10, 16, 0.74) !important;
                backdrop-filter: blur(20px) saturate(180%) !important;
                border: 1px solid rgba(var(--sx-accent-rgb), 0.28) !important;
                box-shadow: 0 12px 36px -4px rgba(0, 0, 0, 0.65), 0 0 20px -2px rgba(var(--sx-accent-rgb), 0.18) !important;
                transition: border-color 0.2s ease, box-shadow 0.2s ease;
            }
            html.dark body.sx-theme-active .bg-card.rounded-\\[calc\\(theme\\(borderRadius\\.2xl\\)-1px\\)\\]:focus-within,
            body.dark.sx-theme-active .bg-card.rounded-\\[calc\\(theme\\(borderRadius\\.2xl\\)-1px\\)\\]:focus-within {
                border-color: var(--primary) !important;
                box-shadow: 0 12px 36px -4px rgba(0, 0, 0, 0.75), 0 0 28px -2px rgba(var(--sx-accent-rgb), 0.35) !important;
            }

            /* Sleek Cyber Scrollbars */
            html.dark body.sx-theme-active *::-webkit-scrollbar,
            body.dark.sx-theme-active *::-webkit-scrollbar {
                width: 6px;
                height: 6px;
            }
            html.dark body.sx-theme-active *::-webkit-scrollbar-track,
            body.dark.sx-theme-active *::-webkit-scrollbar-track {
                background: transparent;
            }
            html.dark body.sx-theme-active *::-webkit-scrollbar-thumb,
            body.dark.sx-theme-active *::-webkit-scrollbar-thumb {
                background: rgba(var(--sx-accent-rgb), 0.25);
                border-radius: 9999px;
            }
            html.dark body.sx-theme-active *::-webkit-scrollbar-thumb:hover,
            body.dark.sx-theme-active *::-webkit-scrollbar-thumb:hover {
                background: var(--primary);
                box-shadow: 0 0 10px var(--primary);
            }
            html.dark body.sx-theme-active ::-webkit-scrollbar-button,
            body.dark.sx-theme-active ::-webkit-scrollbar-button {
                display: block !important;
                height: 0px !important;
                width: 0px !important;
                border-width: 0px !important;
                border: none !important;
                background: transparent !important;
            }
            html.dark body.sx-theme-active ::-webkit-scrollbar-corner,
            body.dark.sx-theme-active ::-webkit-scrollbar-corner {
                background: transparent !important;
            }

            /* Developer Code Blocks Obsidian Glass (Only standalone markdown blocks, NOT terminal cards) */
            html.dark body.sx-theme-active .prose pre,
            html.dark body.sx-theme-active pre:not([class*="group/run-command"] pre):not(.group\\/run-command pre),
            body.dark.sx-theme-active .prose pre,
            body.dark.sx-theme-active pre:not([class*="group/run-command"] pre):not(.group\\/run-command pre) {
                border: 1px solid rgba(var(--sx-accent-rgb), 0.20) !important;
                background: rgba(3, 7, 12, 0.65) !important;
                box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4) !important;
                border-radius: 8px !important;
            }

            /* Unified Run Command Terminal Card */
            html.dark body.sx-theme-active [class*="group/run-command"],
            html.dark body.sx-theme-active .group\\/run-command,
            body.dark.sx-theme-active [class*="group/run-command"],
            body.dark.sx-theme-active .group\\/run-command {
                border: 1px solid rgba(255, 255, 255, 0.08) !important;
                background: rgba(10, 13, 20, 0.88) !important;
                backdrop-filter: blur(16px) !important;
                border-radius: 8px !important;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5) !important;
                overflow: hidden !important;
                margin-top: 4px !important;
                margin-bottom: 4px !important;
            }

            /* Command header */
            html.dark body.sx-theme-active [class*="group/run-command"] > div:first-child,
            html.dark body.sx-theme-active .group\\/run-command > div:first-child,
            body.dark.sx-theme-active [class*="group/run-command"] > div:first-child,
            body.dark.sx-theme-active .group\\/run-command > div:first-child {
                background: rgba(255, 255, 255, 0.02) !important;
                padding: 2px 4px !important;
            }

            /* Reset inner pre inside command blocks */
            html.dark body.sx-theme-active [class*="group/run-command"] pre,
            html.dark body.sx-theme-active .group\\/run-command pre,
            body.dark.sx-theme-active [class*="group/run-command"] pre,
            body.dark.sx-theme-active .group\\/run-command pre {
                border: none !important;
                background: transparent !important;
                box-shadow: none !important;
                border-radius: 0 !important;
                margin: 0 !important;
                padding: 6px 10px !important;
                scrollbar-width: thin !important;
                scrollbar-color: rgba(255, 255, 255, 0.18) transparent !important;
            }

            /* Clean divider line */
            html.dark body.sx-theme-active [class*="group/run-command"] .border-t,
            html.dark body.sx-theme-active .group\\/run-command .border-t,
            body.dark.sx-theme-active [class*="group/run-command"] .border-t,
            body.dark.sx-theme-active .group\\/run-command .border-t {
                border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
                padding-top: 0 !important;
                margin-top: 0 !important;
            }

            /* Primary Buttons Glow */
            html.dark body.sx-theme-active button.bg-primary,
            body.dark.sx-theme-active button.bg-primary {
                box-shadow: 0 0 14px rgba(var(--sx-accent-rgb), 0.4) !important;
            }

            /* Active Sidebar Conversation */
            html.dark body.sx-theme-active .bg-secondary:not(button):not(input),
            body.dark.sx-theme-active .bg-secondary:not(button):not(input) {
                border-left: 2px solid var(--primary);
            }

            /* Symmetrical View Usage and Quota Submenu Alignment */
            [role="menu"][data-nested] {
                width: 320px !important;
                background: hsl(var(--popover, var(--card, 222 47% 11%))) !important;
                border: 1px solid hsl(var(--border, rgba(255, 255, 255, 0.12))) !important;
                border-radius: 10px !important;
                box-shadow: 0 10px 30px -4px rgba(0, 0, 0, 0.45) !important;
                backdrop-filter: blur(20px) !important;
            }
            [role="menu"][data-nested] [role="group"] {
                gap: 0 !important;
            }
            [role="menu"][data-nested] [role="presentation"] {
                padding: 6px 10px !important;
                font-size: 11px !important;
                font-weight: 600 !important;
                color: rgba(255, 255, 255, 0.45) !important;
                display: flex !important;
                align-items: center !important;
                justify-content: space-between !important;
                text-transform: uppercase !important;
                letter-spacing: 0.6px !important;
            }
            [role="menu"][data-nested] .flex.items-center.justify-between.px-2 {
                border-top: 1px solid rgba(255, 255, 255, 0.08) !important;
                padding: 6px 10px !important;
                margin-top: 0 !important;
            }
            [role="menu"][data-nested] span.text-foreground.truncate {
                font-size: 11px !important;
                font-weight: 600 !important;
                color: rgba(255, 255, 255, 0.9) !important;
            }
            [role="menu"][data-nested] span.text-xs.text-foreground {
                font-size: 11px !important;
                font-weight: 600 !important;
                font-family: ui-monospace, monospace !important;
                color: #a3e635 !important;
            }
        `;
    }
}
