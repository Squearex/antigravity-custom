#!/usr/bin/env node
/**
 * ============================================================================
 * ⚡ ANTIGRAVITY CUSTOM (SX CORE SDK) INSTALLER ⚡
 * Cross-Platform Installer & Auto-Patcher for Windows & Linux
 * ============================================================================
 *
 * Usage:
 *   node installer.js             -> Auto-detects Antigravity and installs SX
 *   node installer.js --uninstall -> Restores vanilla Antigravity
 *   node installer.js --status    -> Checks installation status
 *   node installer.js --path <dir>-> Installs to custom Antigravity app directory
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const IS_WIN = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';
const IS_DARWIN = process.platform === 'darwin';

// ANSI colors
const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
    emerald: '\x1b[38;2;52;211;153m'
};

function printBanner() {
    console.log(`
${c.emerald}${c.bold}========================================================================${c.reset}
${c.cyan}${c.bold}       ⚡ ANTIGRAVITY CUSTOM (SX CORE SDK) - AUTOMATED INSTALLER ⚡      ${c.reset}
${c.emerald}         Cross-Platform Auto-Detection, Patching & Live Voice Engine    ${c.reset}
${c.emerald}${c.bold}========================================================================${c.reset}
${c.dim}OS: ${process.platform} (${os.release()}) | Node: ${process.version}${c.reset}
`);
}

// Candidate locations where Antigravity / Antigravity-Custom resources/app resides
function getStandardAppPaths() {
    const candidates = [];
    const homedir = os.homedir();

    if (IS_WIN) {
        const localApp = process.env.LOCALAPPDATA || path.join(homedir, 'AppData', 'Local');
        const progFiles = process.env.PROGRAMFILES || 'C:\\Program Files';
        const progFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';

        candidates.push(
            path.join(localApp, 'Programs', 'Antigravity-Custom', 'resources', 'app'),
            path.join(localApp, 'Programs', 'Antigravity', 'resources', 'app'),
            path.join(localApp, 'Programs', 'antigravity', 'resources', 'app'),
            path.join(progFiles, 'Antigravity', 'resources', 'app'),
            path.join(progFilesX86, 'Antigravity', 'resources', 'app')
        );
    } else if (IS_LINUX) {
        try {
            const whichOut = execSync('which antigravity 2>/dev/null || which Antigravity 2>/dev/null', { timeout: 2000, encoding: 'utf8' }).trim();
            if (whichOut && fs.existsSync(whichOut)) {
                const realBin = fs.realpathSync(whichOut);
                const binDir = path.dirname(realBin);
                candidates.push(
                    path.join(binDir, 'resources', 'app'),
                    path.join(binDir, 'resources')
                );
                try {
                    const text = fs.readFileSync(realBin, 'utf8');
                    const matches = text.match(/(?:\/opt\/[^\s"']+|\/[^\s"']+\/antigravity)/gi);
                    if (matches) {
                        for (const m of matches) {
                            candidates.push(
                                path.join(path.dirname(m), 'resources', 'app'),
                                path.join(path.dirname(m), 'resources')
                            );
                        }
                    }
                } catch(e) {}
            }
        } catch(e) {}

        candidates.push(
            '/opt/Antigravity/resources/app',
            '/opt/antigravity/resources/app',
            '/opt/google/antigravity/resources/app',
            '/usr/lib/antigravity/resources/app',
            '/usr/lib/Antigravity/resources/app',
            '/usr/share/antigravity/resources/app',
            path.join(homedir, '.antigravity', 'resources', 'app'),
            path.join(homedir, '.local', 'share', 'antigravity', 'resources', 'app'),
            path.join(homedir, '.local', 'share', 'Antigravity', 'resources', 'app'),
            path.join(homedir, 'Applications', 'Antigravity', 'resources', 'app'),
            path.join(homedir, 'Applications', 'antigravity', 'resources', 'app'),
            '/var/lib/flatpak/app/google.antigravity/current/active/files/share/antigravity/resources/app'
        );
    } else if (IS_DARWIN) {
        candidates.push(
            '/Applications/Antigravity.app/Contents/Resources/app',
            path.join(homedir, 'Applications', 'Antigravity.app', 'Contents', 'Resources', 'app')
        );
    }

    return candidates;
}

// Pure Node.js zero-dependency ASAR extractor (for clean Linux & package installations)
function extractAsar(asarPath, outputDir) {
    const fd = fs.openSync(asarPath, 'r');
    const headerBuf = Buffer.alloc(16);
    fs.readSync(fd, headerBuf, 0, 16, 0);
    const headerSize = headerBuf.readUInt32LE(4);
    const jsonSize = headerBuf.readUInt32LE(12);
    const jsonBuf = Buffer.alloc(jsonSize);
    fs.readSync(fd, jsonBuf, 0, jsonSize, 16);
    const header = JSON.parse(jsonBuf.toString('utf8'));
    const baseOffset = 8 + headerSize;

    function walkTree(node, currentPath) {
        if (node.files) {
            fs.mkdirSync(currentPath, { recursive: true });
            for (const name of Object.keys(node.files)) {
                walkTree(node.files[name], path.join(currentPath, name));
            }
        } else if (typeof node.size === 'number' && typeof node.offset !== 'undefined') {
            const fileOffset = baseOffset + parseInt(node.offset, 10);
            const data = Buffer.alloc(node.size);
            fs.readSync(fd, data, 0, node.size, fileOffset);
            fs.mkdirSync(path.dirname(currentPath), { recursive: true });
            fs.writeFileSync(currentPath, data);
        }
    }
    walkTree(header, outputDir);
    fs.closeSync(fd);
}

// Find existing Antigravity installation (handles unpacked app & packed app.asar)
function detectAntigravity(customPath = null) {
    if (customPath) {
        const resolved = path.resolve(customPath);
        const checkList = [
            resolved,
            path.join(resolved, 'resources', 'app'),
            path.join(resolved, 'app')
        ];
        for (const target of checkList) {
            if (fs.existsSync(path.join(target, 'dist', 'main.js'))) {
                return target;
            }
            const asarPath = path.join(path.dirname(target), 'app.asar');
            if (fs.existsSync(asarPath)) {
                console.log(`${c.cyan}📦 Bilgi:${c.reset} 'app.asar' paketi tespit edildi, ayıklanıyor (${target})...`);
                try {
                    extractAsar(asarPath, target);
                    if (fs.existsSync(path.join(target, 'dist', 'main.js'))) {
                        return target;
                    }
                } catch(e) {}
            }
        }
        console.error(`${c.red}✕ Hata:${c.reset} Belirtilen konumda geçerli bir Antigravity kurulumu bulunamadı: ${customPath}`);
        process.exit(1);
    }

    const candidates = getStandardAppPaths();
    for (const p of candidates) {
        const mainJs = path.join(p, 'dist', 'main.js');
        if (fs.existsSync(mainJs)) {
            return p;
        }
        // If directory doesn't have dist/main.js, check if sibling app.asar exists
        const parentDir = p.endsWith('app') ? path.dirname(p) : p;
        const asarPath = path.join(parentDir, 'app.asar');
        const targetApp = path.join(parentDir, 'app');
        if (fs.existsSync(asarPath)) {
            console.log(`${c.cyan}📦 Bilgi:${c.reset} 'app.asar' paketi tespit edildi, ayıklanıyor (${targetApp})...`);
            try {
                extractAsar(asarPath, targetApp);
                if (fs.existsSync(path.join(targetApp, 'dist', 'main.js'))) {
                    console.log(`${c.green}✓${c.reset} 'app.asar' başarıyla ayıklandı.`);
                    return targetApp;
                }
            } catch(e) {
                console.error(`${c.yellow}⚠️ Uyarı:${c.reset} asar ayıklanamadı:`, e.message);
            }
        }
    }

    return null;
}

// Find Python binary on Windows or Linux
function detectPython() {
    const isWin = IS_WIN;
    const candidates = isWin ? [
        'python.exe',
        'python3.exe',
        'py.exe',
        'C:\\Python314\\python.exe',
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python313', 'python.exe'),
        'python'
    ] : [
        '/usr/bin/python3',
        '/usr/local/bin/python3',
        '/bin/python3',
        'python3',
        'python'
    ];

    for (const bin of candidates) {
        try {
            const res = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 3000 });
            if (res.status === 0) {
                return bin;
            }
        } catch(e) {}
    }
    return null;
}

// Check and install speech_recognition python package
function setupPythonSpeech(pyBin) {
    if (!pyBin) {
        console.log(`${c.yellow}⚠️ Uyarı:${c.reset} Sistemde Python 3 bulunamadı. Canlı ses tanıma için Python 3 ve SpeechRecognition paketi önerilir.`);
        return false;
    }

    try {
        const testRes = spawnSync(pyBin, ['-c', 'import speech_recognition; print("OK")'], { encoding: 'utf8', timeout: 4000 });
        if (testRes.status === 0 && testRes.stdout.includes('OK')) {
            console.log(`${c.green}✓${c.reset} Python SpeechRecognition paketi hazır (${pyBin}).`);
            return true;
        }
    } catch(e) {}

    console.log(`${c.cyan}📦 Bilgi:${c.reset} Sesli dikte için 'SpeechRecognition' paketi kuruluyor (${pyBin})...`);
    try {
        const installRes = spawnSync(pyBin, ['-m', 'pip', 'install', 'SpeechRecognition'], { stdio: 'inherit', timeout: 60000 });
        if (installRes.status === 0) {
            console.log(`${c.green}✓${c.reset} SpeechRecognition paketi başarıyla yüklendi.`);
            return true;
        }
    } catch(e) {
        console.log(`${c.yellow}⚠️ Uyarı:${c.reset} SpeechRecognition otomatik kurulamadı. 'pip install SpeechRecognition' komutuyla manuel kurabilirsiniz.`);
    }
    return false;
}

// Hook content to be injected into main.js
function getTopHookMainJs() {
    return `
// ANTIGRAVITY CUSTOM (SX CORE SDK) HOOK
const { startInternalProxy, inMemoryConfig } = require("./sxProxy");
startInternalProxy();
try {
    electron_1.app.setPath('userData', path.join(electron_1.app.getPath('appData'), 'Antigravity-Custom'));
} catch(e) {}
`;
}

function getIpcHookMainJs() {
    return `
    // SX Core SDK IPC Handlers
    try {
        electron_1.ipcMain.on('sx:get-inject-script', (event) => {
            try {
                const p = path.join(__dirname, 'sx-inject.js');
                event.returnValue = fs.readFileSync(p, 'utf8');
            } catch(e) {
                console.error('[SX IPC Error]', e);
                event.returnValue = '';
            }
        });
        electron_1.ipcMain.on('sx:get-saved-config', (event) => {
            try {
                const cfgPath = path.join(electron_1.app.getPath('userData'), 'sx_custom_models.json');
                if (fs.existsSync(cfgPath)) {
                    event.returnValue = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
                    return;
                }
            } catch(e) {}
            event.returnValue = inMemoryConfig || { providers: [], models: [] };
        });
        electron_1.ipcMain.on('sx:save-config', (event, newConfig) => {
            try {
                const cfgPath = path.join(electron_1.app.getPath('userData'), 'sx_custom_models.json');
                fs.writeFileSync(cfgPath, JSON.stringify(newConfig, null, 2), 'utf8');
                event.returnValue = true;
            } catch(e) {
                event.returnValue = false;
            }
        });
        electron_1.ipcMain.on('sx:reload-app', () => {
            try {
                electron_1.app.relaunch();
                electron_1.app.exit(0);
            } catch(e) {}
        });
    } catch(e) {}
`;
}

function getPreloadHook() {
    return `
// ============================================================================
// ANTIGRAVITY CUSTOM - DIRECT MODE INJECTION
// ============================================================================
try {
    try { electron_1.ipcRenderer.setMaxListeners(50); } catch(e) {}
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
}

// Perform Installation
function install(targetAppDir) {
    console.log(`${c.cyan}🚀 Kurulum Başlatılıyor...${c.reset}`);
    console.log(`Hedef Dizin: ${c.bold}${targetAppDir}${c.reset}\n`);

    const sourceDist = path.resolve(__dirname, 'dist');
    const targetDist = path.join(targetAppDir, 'dist');
    const mainJsPath = path.join(targetDist, 'main.js');
    const preloadJsPath = path.join(targetDist, 'preload.js');

    if (!fs.existsSync(mainJsPath) || !fs.existsSync(preloadJsPath)) {
        console.error(`${c.red}✕ Hata:${c.reset} 'main.js' veya 'preload.js' bulunamadı: ${targetDist}`);
        process.exit(1);
    }

    // Permission check for Linux root/opt directory writes
    try {
        fs.accessSync(targetAppDir, fs.constants.W_OK);
        fs.accessSync(targetDist, fs.constants.W_OK);
        fs.accessSync(mainJsPath, fs.constants.W_OK);
    } catch(e) {
        if (IS_LINUX && process.getuid && process.getuid() !== 0) {
            console.error(`\n${c.yellow}🔒 Yetki Hatası:${c.reset} '${targetAppDir}' dizinine yazma izniniz yok.`);
            console.log(`Lütfen kurulum komutunu ${c.bold}sudo${c.reset} ile çalıştırın:`);
            console.log(`  ${c.cyan}sudo ./install.sh${c.reset}\n`);
            process.exit(13);
        }
    }

    // 1. Backups
    const mainOrig = path.join(targetDist, 'main.js.orig');
    const preloadOrig = path.join(targetDist, 'preload.js.orig');

    if (!fs.existsSync(mainOrig)) {
        fs.copyFileSync(mainJsPath, mainOrig);
        console.log(`${c.green}✓${c.reset} Orijinal main.js yedeklendi (main.js.orig).`);
    }
    if (!fs.existsSync(preloadOrig)) {
        fs.copyFileSync(preloadJsPath, preloadOrig);
        console.log(`${c.green}✓${c.reset} Orijinal preload.js yedeklendi (preload.js.orig).`);
    }

    // 2. Clean any source code directories from target app to protect IP
    const targetSrc = path.join(targetAppDir, 'src');
    if (fs.existsSync(targetSrc) && targetAppDir !== path.resolve(__dirname)) {
        try {
            fs.rmSync(targetSrc, { recursive: true, force: true });
            console.log(`${c.green}✓${c.reset} Hedef dizindeki kaynak kodlar (src/) gizlendi ve temizlendi.`);
        } catch(e) {}
    }

    // 3. Copy Obfuscated SX Assets into dist
    const filesToCopy = [
        'sxProxy.js',
        'sx-inject.js',
        'transcribe_worker.py'
    ];

    for (const f of filesToCopy) {
        const srcFile = path.join(sourceDist, f);
        const dstFile = path.join(targetDist, f);
        if (fs.existsSync(srcFile)) {
            fs.copyFileSync(srcFile, dstFile);
            console.log(`${c.green}✓${c.reset} Kopyalandı (Şifrelenmiş): dist/${f}`);
        } else {
            console.log(`${c.yellow}⚠️ Uyarı:${c.reset} Kaynak dosya bulunamadı: dist/${f}`);
        }
    }

    // Save version and source repository link for auto-updates
    try {
        const vSrc = path.join(sourceDist, 'version.json');
        let vData = {};
        if (fs.existsSync(vSrc)) vData = JSON.parse(fs.readFileSync(vSrc, 'utf8'));
        vData.sourceRepo = path.resolve(__dirname);
        vData.installedAt = new Date().toISOString();
        fs.writeFileSync(path.join(targetDist, 'version.json'), JSON.stringify(vData, null, 2), 'utf8');
        console.log(`${c.green}✓${c.reset} Sürüm ve güncelleme köprüsü yapılandırıldı (version.json).`);
    } catch(e) {}

    // 3. Patch main.js
    let mainContent = fs.readFileSync(mainJsPath, 'utf8');
    let mainModified = false;

    if (!mainContent.includes('sxProxy')) {
        const topHook = getTopHookMainJs();
        const anchor = 'const path = __importStar(require("path"));';
        const altAnchor = 'const path_1 = __importDefault(require("path"));';

        if (mainContent.includes(anchor)) {
            mainContent = mainContent.replace(anchor, anchor + topHook);
            mainModified = true;
        } else if (mainContent.includes(altAnchor)) {
            mainContent = mainContent.replace(altAnchor, altAnchor + topHook);
            mainModified = true;
        } else {
            mainContent = topHook + mainContent;
            mainModified = true;
        }
    }

    if (!mainContent.includes('sx:get-inject-script')) {
        const ipcHook = getIpcHookMainJs();
        const ipcAnchor = '(0, ipcHandlers_1.registerIpcHandlers)(storageManager);';
        const altIpcAnchor = 'registerIpcHandlers)(storageManager);';

        if (mainContent.includes(ipcAnchor)) {
            mainContent = mainContent.replace(ipcAnchor, ipcAnchor + ipcHook);
            mainModified = true;
        } else if (mainContent.includes(altIpcAnchor)) {
            mainContent = mainContent.replace(altIpcAnchor, altIpcAnchor + ipcHook);
            mainModified = true;
        } else {
            // Append right before createWindow or app.whenReady
            mainContent = mainContent + '\n' + ipcHook;
            mainModified = true;
        }
    }

    if (mainModified) {
        fs.writeFileSync(mainJsPath, mainContent, 'utf8');
        console.log(`${c.green}✓${c.reset} main.js başarıyla yamalandı.`);
    } else {
        console.log(`${c.cyan}ℹ${c.reset} main.js zaten yamalanmış.`);
    }

    // 4. Patch preload.js
    let preloadContent = fs.readFileSync(preloadJsPath, 'utf8');
    if (!preloadContent.includes('sx:get-inject-script')) {
        preloadContent += getPreloadHook();
        fs.writeFileSync(preloadJsPath, preloadContent, 'utf8');
        console.log(`${c.green}✓${c.reset} preload.js başarıyla yamalandı.`);
    } else {
        console.log(`${c.cyan}ℹ${c.reset} preload.js zaten yamalanmış.`);
    }

    // 5. Python Speech Setup & Bytecode Compilation
    const pyBin = detectPython();
    setupPythonSpeech(pyBin);
    if (pyBin) {
        try {
            spawnSync(pyBin, ['-m', 'compileall', '-b', targetDist], { timeout: 10000 });
            const pycPath = path.join(targetDist, 'transcribe_worker.pyc');
            if (fs.existsSync(pycPath)) {
                console.log(`${c.green}✓${c.reset} Python ses motoru yerel bytecode (.pyc) olarak derlendi.`);
                try { fs.unlinkSync(path.join(targetDist, 'transcribe_worker.py')); } catch(e) {}
                console.log(`${c.green}✓${c.reset} transcribe_worker.py silindi, sadece ikili .pyc dosyası korundu.`);
            }
        } catch(e) {}
    }

    // 6. Disable sibling app.asar so Electron executes the patched app directory!
    const resourcesDir = path.dirname(targetAppDir);
    const asarPath = path.join(resourcesDir, 'app.asar');
    const asarOrig = path.join(resourcesDir, 'app.asar.orig');
    if (fs.existsSync(asarPath)) {
        try {
            fs.renameSync(asarPath, asarOrig);
            console.log(`${c.green}✓${c.reset} app.asar devre dışı bırakıldı (app.asar.orig) - Electron doğrudan yamalı 'app' klasörünü çalıştıracak.`);
        } catch(e) {
            console.log(`${c.yellow}⚠️ Uyarı:${c.reset} app.asar yeniden adlandırılamadı:`, e.message);
        }
    }

    console.log(`
${c.emerald}${c.bold}========================================================================${c.reset}
${c.green}${c.bold}🎉 TEBRİKLER! ANTIGRAVITY CUSTOM (SX) KURULUMU TAMAMLANDI! 🎉${c.reset}
${c.emerald}========================================================================${c.reset}
${c.cyan}Özellikler:${c.reset}
  • Canlı Mikrofon & Akıcı Dikte (Google Speech API + Ghost-Text)
  • Gelişmiş Model Hub & Özelleştirilebilir Sağlayıcılar (19+ Preset)
  • Performans ve Token Takip Paneli (TTFT, TPS, Context Usage)
  • Otomatik Güncelleme Bildirimi ve Tek Tıkla Güncelleme Butonu
  • Windows ve Linux tam uyumluluk

Antigravity'yi başlatıp hemen kullanmaya başlayabilirsiniz!
`);
}

// Perform Uninstall
function uninstall(targetAppDir) {
    console.log(`${c.yellow}🔄 Orijinal Duruma Geri Döndürülüyor (Uninstall)...${c.reset}`);
    const targetDist = path.join(targetAppDir, 'dist');
    const mainJsPath = path.join(targetDist, 'main.js');
    const preloadJsPath = path.join(targetDist, 'preload.js');
    const mainOrig = path.join(targetDist, 'main.js.orig');
    const preloadOrig = path.join(targetDist, 'preload.js.orig');

    if (fs.existsSync(mainOrig)) {
        fs.copyFileSync(mainOrig, mainJsPath);
        console.log(`${c.green}✓${c.reset} main.js orijinal haline geri yüklendi.`);
    }

    if (fs.existsSync(preloadOrig)) {
        fs.copyFileSync(preloadOrig, preloadJsPath);
        console.log(`${c.green}✓${c.reset} preload.js orijinal haline geri yüklendi.`);
    }

    const filesToRemove = [
        'sxProxy.js',
        'sx-inject.js',
        'transcribe_worker.py',
        'transcribe_worker.pyc',
        'version.json'
    ];

    for (const f of filesToRemove) {
        const p = path.join(targetDist, f);
        if (fs.existsSync(p)) {
            try { fs.unlinkSync(p); } catch(e) {}
        }
    }

    console.log(`${c.green}✓${c.reset} SX Core SDK dosyaları kaldırıldı. Antigravity orijinal haline döndü.\n`);
}

// Show Status
function status(targetAppDir) {
    console.log(`${c.cyan}📊 Durum Raporu:${c.reset}`);
    if (!targetAppDir) {
        console.log(`${c.red}✕ Antigravity bulunamadı.${c.reset}`);
        return;
    }

    console.log(`Konum: ${targetAppDir}`);
    const mainJs = path.join(targetAppDir, 'dist', 'main.js');
    const preloadJs = path.join(targetAppDir, 'dist', 'preload.js');
    const isPatched = fs.existsSync(mainJs) && fs.readFileSync(mainJs, 'utf8').includes('sxProxy');
    const isPreloadPatched = fs.existsSync(preloadJs) && fs.readFileSync(preloadJs, 'utf8').includes('sx:get-inject-script');

    console.log(`main.js: ${isPatched ? c.green + 'Yamalı (SX Aktif)' : c.yellow + 'Orijinal'}${c.reset}`);
    console.log(`preload.js: ${isPreloadPatched ? c.green + 'Yamalı (SX Aktif)' : c.yellow + 'Orijinal'}${c.reset}`);

    const py = detectPython();
    console.log(`Python: ${py ? c.green + py : c.yellow + 'Bulunamadı'}${c.reset}`);
}

// CLI Argument Parsing
function main() {
    printBanner();

    const args = process.argv.slice(2);
    let customPath = null;
    let action = 'install';

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--path' || arg === '-p') {
            customPath = args[++i];
        } else if (arg === '--uninstall' || arg === '-u') {
            action = 'uninstall';
        } else if (arg === '--status' || arg === '-s') {
            action = 'status';
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
Kullanım:
  node installer.js [seçenekler]

Seçenekler:
  --install              Varsayılan eylem: SX Core SDK'yı Antigravity'ye kurar.
  --uninstall, -u        Yamaları kaldırır ve Antigravity'yi orijinal durumuna döndürür.
  --status, -s           Mevcut kurulum durumunu gösterir.
  --path, -p <dizin>     Özel bir Antigravity kurulum dizini belirtir.
  --help, -h             Bu yardım mesajını gösterir.
`);
            process.exit(0);
        }
    }

    const detected = detectAntigravity(customPath);

    if (!detected && action !== 'status') {
        console.error(`${c.red}✕ Hata:${c.reset} Sistemde kurulu bir Antigravity bulunamadı.`);
        console.log(`Eğer Antigravity farklı bir dizine kuruluysa:
  ${c.cyan}node installer.js --path "KURULUM_DIZINI"${c.reset}
komutu ile hedefi belirtebilirsiniz.\n`);
        process.exit(1);
    }

    if (action === 'install') {
        install(detected);
    } else if (action === 'uninstall') {
        uninstall(detected);
    } else if (action === 'status') {
        status(detected);
    }
}

main();
