/**
 * SX Core SDK - Main Entry Point
 * Bootstraps the modular SDK architecture, initializes services, and registers inter-module events.
 */
import { EventBus } from './core/EventBus.js';
import { Logger } from './core/Logger.js';
import { Container } from './core/Container.js';
import { StateStore } from './core/StateStore.js';
import { StorageService } from './services/StorageService.js';
import { NetworkClient } from './services/NetworkClient.js';
import { ThemeEngine, SX_THEME_PRESETS } from './services/ThemeEngine.js';
import { ModelManager } from './services/ModelManager.js';
import { QuotaMonitor } from './services/QuotaMonitor.js';
import { PerfMonitor } from './services/PerfMonitor.js';
import { FetchInterceptor } from './services/FetchInterceptor.js';
import { VoiceRecorder } from './services/VoiceRecorder.js';
import { UIInjector } from './services/UIInjector.js';
import { ModelMetaResolver } from './services/ModelMetaResolver.js';

// Bump on every release so console/deploy skew is visible.
export const SX_BUILD = '2026.09.22-r12';

(function bootstrapSX() {
    const logger = new Logger('SX');
    logger.info('Core', `Bootstrapping SX Core SDK v2.0 (build ${SX_BUILD})...`);
    window.__SX_BUILD = SX_BUILD;

    const bus = new EventBus();
    const container = new Container();

    // 1. Core infrastructure
    container.register('bus', bus);
    container.register('logger', logger);

    // 2. Services
    const storage = new StorageService(bus, logger);
    const network = new NetworkClient(logger);
    const state = new StateStore(bus, logger);
    const metaResolver = new ModelMetaResolver(network, logger);
    const models = new ModelManager(bus, state, network, logger, metaResolver);
    const theme = new ThemeEngine(bus, storage, network, logger);
    const quota = new QuotaMonitor(network, models, logger);
    const perf = new PerfMonitor(network, models, logger);
    const fetchInterceptor = new FetchInterceptor(models, logger);
    const voice = new VoiceRecorder(logger);
    const ui = new UIInjector(bus, state, models, theme, quota, perf, network, logger, metaResolver);

    container.register('storage', storage);
    container.register('network', network);
    container.register('state', state);
    container.register('metaResolver', metaResolver);
    container.register('models', models);
    container.register('theme', theme);
    container.register('quota', quota);
    container.register('perf', perf);
    container.register('fetchInterceptor', fetchInterceptor);
    container.register('voice', voice);
    container.register('ui', ui);

    // 3. Initialize in sequence
    storage.init();
    state.init();
    models.init();
    theme.init();
    quota.init();
    perf.init();
    fetchInterceptor.init();
    voice.init();
    ui.init();

    // 4. Initial config sync with proxy
    network.fetchPersistedConfig().then(cfg => {
        if (cfg) {
            if (Array.isArray(cfg.providers) && cfg.providers.length > 0) {
                state.setProviders(cfg.providers);
            }
            if (Array.isArray(cfg.models) && cfg.models.length > 0) {
                state.setModels(cfg.models);
            }
        }
        // 4b. Guarantee metadata for stored models (offline KB + OpenRouter catalog)
        metaResolver.backfillStored(state.getModels()).then(({ list, changed }) => {
            if (changed) {
                state.setModels(list);
                logger.info('Core', 'Model metadata backfilled from knowledge sources.');
            }
        }).catch(e => logger.warn('Core', 'Metadata backfill failed', e.message));
    });

    // Warm catalogs in background for instant lookups (Zen + models.dev + OpenRouter)
    metaResolver.ensureZenCatalog().catch(() => {});
    metaResolver.ensureModelsDev().catch(() => {});
    metaResolver.ensureOpenRouterCatalog().catch(() => {});

    // 5. Global exports for debugging & backwards compatibility
    window.SX_SDK = {
        bus,
        container,
        state,
        models,
        theme,
        quota,
        perf,
        network,
        metaResolver
    };
    window.SX_THEME_PRESETS = SX_THEME_PRESETS;
    window.sxApplyThemePreset = (p, s = true) => theme.applyPreset(p, s);

    logger.info('Core', 'SX Core SDK initialized successfully.');
})();
