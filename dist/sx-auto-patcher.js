const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const targetAppDir = process.argv[2] || path.resolve(__dirname, '..', '..', '..');
const oldPid = parseInt(process.argv[3], 10);
const coreDir = path.join(process.env.APPDATA || '', 'Antigravity-Custom', 'sx_core');

console.log('[SX Auto-Patcher] Target App Dir:', targetAppDir, 'Old PID:', oldPid);

function isPidRunning(pid) {
    if (!pid || isNaN(pid)) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return false;
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForOldProcessExit() {
    if (!oldPid || isNaN(oldPid)) return;
    console.log('[SX Auto-Patcher] Waiting for PID', oldPid, 'to exit...');
    let waited = 0;
    while (isPidRunning(oldPid) && waited < 30000) {
        await sleep(500);
        waited += 500;
    }
    console.log('[SX Auto-Patcher] Old process exited or wait timeout reached.');
}

async function waitForInstallerAndApplyPatch() {
    const mainJsPath = path.join(targetAppDir, 'resources', 'app', 'dist', 'main.js');
    const preloadJsPath = path.join(targetAppDir, 'resources', 'app', 'dist', 'preload.js');
    const packageJsonPath = path.join(targetAppDir, 'resources', 'app', 'package.json');
    const distDir = path.join(targetAppDir, 'resources', 'app', 'dist');

    console.log('[SX Auto-Patcher] Watching for installer completion at:', mainJsPath);

    // Wait until mainJsPath exists and is writable
    let ready = false;
    let attempts = 0;
    while (!ready && attempts < 120) {
        await sleep(500);
        attempts++;
        try {
            if (fs.existsSync(mainJsPath)) {
                const fd = fs.openSync(mainJsPath, 'r+');
                fs.closeSync(fd);
                ready = true;
            }
        } catch (e) {
            // File is locked while installer is replacing it
        }
    }

    if (!ready) {
        console.error('[SX Auto-Patcher] Timeout waiting for installer.');
        return;
    }

    // Wait 1.5 seconds to let the installer finish copying all assets
    await sleep(1500);

    // 1. Copy persistent sxProxy.js and sx-inject.js into dist
    try {
        const sxProxySrc = path.join(coreDir, 'sxProxy.js');
        const sxInjectSrc = path.join(coreDir, 'sx-inject.js');
        if (fs.existsSync(sxProxySrc)) {
            fs.copyFileSync(sxProxySrc, path.join(distDir, 'sxProxy.js'));
        }
        if (fs.existsSync(sxInjectSrc)) {
            fs.copyFileSync(sxInjectSrc, path.join(distDir, 'sx-inject.js'));
        }
        console.log('[SX Auto-Patcher] sxProxy and sx-inject copied into dist.');
    } catch (e) {
        console.error('[SX Auto-Patcher] Error copying sx files:', e);
    }

    // 2. Patch main.js
    try {
        let mainContent = fs.readFileSync(mainJsPath, 'utf8');
        if (!mainContent.includes('sxProxy')) {
            console.log('[SX Auto-Patcher] Injecting sxProxy hook into main.js...');
            const topHook = `
// ANTIGRAVITY CUSTOM HOOK
const { startInternalProxy, inMemoryConfig } = require("./sxProxy");
electron_1.app.name = 'Antigravity Pro';
electron_1.app.setPath('userData', path_1.default.join(electron_1.app.getPath('appData'), 'Antigravity-Custom'));
`;
            const anchor = 'const path_1 = __importDefault(require("path"));';
            if (mainContent.includes(anchor)) {
                mainContent = mainContent.replace(anchor, anchor + topHook);
            } else {
                mainContent = topHook + mainContent;
            }

            const ipchook = `
    electron_1.ipcMain.on('sx:get-inject-script', (event) => {
        try {
            const p = path_1.default.join(__dirname, 'sx-inject.js');
            event.returnValue = fs.readFileSync(p, 'utf8');
        } catch(e) {
            console.error('[SX IPC Error]', e);
            event.returnValue = '';
        }
    });
    electron_1.ipcMain.on('sx:get-saved-config', (event) => {
        try {
            const cfgPath = path_1.default.join(electron_1.app.getPath('userData'), 'sx_custom_models.json');
            if (fs.existsSync(cfgPath)) {
                event.returnValue = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
                return;
            }
        } catch(e) {
            console.error('[SX Get Config Error]', e);
        }
        event.returnValue = inMemoryConfig || { providers: [], models: [] };
    });
    electron_1.ipcMain.on('sx:save-config', (event, newConfig) => {
        try {
            const cfgPath = path_1.default.join(electron_1.app.getPath('userData'), 'sx_custom_models.json');
            fs.writeFileSync(cfgPath, JSON.stringify(newConfig, null, 2), 'utf8');
            event.returnValue = true;
        } catch(e) {
            console.error('[SX Save Config Error]', e);
            event.returnValue = false;
        }
    });
`;
            const ipcAnchor = "(0, ipcHandlers_1.registerIpcHandlers)(storageManager);";
            if (mainContent.includes(ipcAnchor)) {
                mainContent = mainContent.replace(ipcAnchor, ipcAnchor + ipchook);
            }
            fs.writeFileSync(mainJsPath, mainContent, 'utf8');
            console.log('[SX Auto-Patcher] main.js successfully patched.');
        }
    } catch (e) {
        console.error('[SX Auto-Patcher] Error patching main.js:', e);
    }

    // 3. Patch preload.js
    try {
        let preloadContent = fs.readFileSync(preloadJsPath, 'utf8');
        if (!preloadContent.includes('sx:get-inject-script')) {
            console.log('[SX Auto-Patcher] Injecting UI loader hook into preload.js...');
            const preloadHook = `
// ============================================================================
// ANTIGRAVITY CUSTOM - DIRECT MODE INJECTION
// ============================================================================
try {
    const scriptContent = electron_1.ipcRenderer.sendSync('sx:get-inject-script');
    let savedConfig = { providers: [], models: [] };
    try {
        savedConfig = electron_1.ipcRenderer.sendSync('sx:get-saved-config') || savedConfig;
    } catch(e) {}
    if (scriptContent) {
        electron_1.webFrame.executeJavaScript(\`window.__SX_SAVED_CONFIG__ = \${JSON.stringify(savedConfig)};\`);
        electron_1.webFrame.executeJavaScript(scriptContent);
    }
} catch (e) {
    console.error('[SX Preload Loader Error]', e);
}
`;
            preloadContent += preloadHook;
            fs.writeFileSync(preloadJsPath, preloadContent, 'utf8');
            console.log('[SX Auto-Patcher] preload.js successfully patched.');
        }
    } catch (e) {
        console.error('[SX Auto-Patcher] Error patching preload.js:', e);
    }

    // 4. Update package.json
    try {
        if (fs.existsSync(packageJsonPath)) {
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            pkg.name = 'antigravity-sx';
            pkg.productName = 'Antigravity Pro';
            fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2), 'utf8');
            console.log('[SX Auto-Patcher] package.json updated.');
        }
    } catch (e) {
        console.error('[SX Auto-Patcher] Error updating package.json:', e);
    }

    // 5. Ensure Antigravity is relaunched if it hasn't started yet
    await sleep(2000);
    const exePath = path.join(targetAppDir, 'Antigravity.exe');
    if (fs.existsSync(exePath)) {
        console.log('[SX Auto-Patcher] Launching updated Antigravity application...');
        const child = spawn(exePath, [], { detached: true, stdio: 'ignore' });
        child.unref();
    }
    console.log('[SX Auto-Patcher] All tasks complete.');
}

async function run() {
    await waitForOldProcessExit();
    await waitForInstallerAndApplyPatch();
}

run();
