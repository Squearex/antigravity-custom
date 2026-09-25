/**
 * ============================================================================
 * ⚡ ANTIGRAVITY CUSTOM (SX CORE SDK) BUILD & OBFUSCATION PIPELINE ⚡
 * ============================================================================
 * Compiles modular source code into production-ready, heavily obfuscated,
 * protected binaries and runtime bundles for distribution.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const SRC_DIR = path.join(ROOT_DIR, 'src');

console.log('\x1b[36m\x1b[1m🚀 Başlatılıyor: SX Core SDK Build & Obfuscation Pipeline...\x1b[0m\n');

// 1. Bundle Frontend with esbuild
console.log('\x1b[33m[1/5]\x1b[0m Frontend kaynak kodları paketleniyor (esbuild)...');
const rawInjectPath = path.join(DIST_DIR, 'sx-inject.raw.js');
try {
    execSync(`npx esbuild "${path.join(SRC_DIR, 'index.js')}" --bundle --format=iife --outfile="${rawInjectPath}"`, {
        cwd: ROOT_DIR,
        stdio: 'inherit'
    });
    console.log('\x1b[32m✓\x1b[0m sx-inject.raw.js başarıyla oluşturuldu.');
} catch (e) {
    console.error('\x1b[31m✕ Hata:\x1b[0m esbuild paketleme başarısız oldu:', e.message);
    process.exit(1);
}

// 2. Obfuscate Frontend Bundle
console.log('\x1b[33m[2/5]\x1b[0m Frontend paketi gizleniyor/obfuscate ediliyor (javascript-obfuscator)...');
const finalInjectPath = path.join(DIST_DIR, 'sx-inject.js');
try {
    execSync(
        `npx javascript-obfuscator "${rawInjectPath}" --output "${finalInjectPath}" ` +
        `--compact true ` +
        `--string-array true ` +
        `--string-array-encoding base64 ` +
        `--string-array-threshold 0.85 ` +
        `--identifier-names-generator hexadecimal ` +
        `--rename-globals false`,
        { cwd: ROOT_DIR, stdio: 'inherit' }
    );
    if (fs.existsSync(rawInjectPath)) fs.unlinkSync(rawInjectPath);
    console.log('\x1b[32m✓\x1b[0m sx-inject.js kaynak kodları başarıyla gizlendi ve şifrelendi.');
} catch (e) {
    console.error('\x1b[31m✕ Hata:\x1b[0m Frontend obfuscation başarısız oldu:', e.message);
    process.exit(1);
}

// 3. Obfuscate Backend Proxy
console.log('\x1b[33m[3/5]\x1b[0m Backend Proxy motoru gizleniyor/obfuscate ediliyor...');
const proxySrc = path.join(SRC_DIR, 'server', 'sxProxy.js');
const proxyDst = path.join(DIST_DIR, 'sxProxy.js');
try {
    execSync(
        `npx javascript-obfuscator "${proxySrc}" --output "${proxyDst}" ` +
        `--target node ` +
        `--compact true ` +
        `--string-array true ` +
        `--string-array-encoding base64 ` +
        `--string-array-threshold 0.85 ` +
        `--identifier-names-generator hexadecimal ` +
        `--rename-globals false`,
        { cwd: ROOT_DIR, stdio: 'inherit' }
    );
    console.log('\x1b[32m✓\x1b[0m sxProxy.js kaynak kodları başarıyla gizlendi ve şifrelendi.');
} catch (e) {
    console.error('\x1b[31m✕ Hata:\x1b[0m Backend proxy obfuscation başarısız oldu:', e.message);
    process.exit(1);
}

// 4. Obfuscate Python Speech Worker
console.log('\x1b[33m[4/5]\x1b[0m Python ses tanıma motoru şifreleniyor...');
const pySrcCode = `import sys
import os
import json
import speech_recognition as sr

def main():
    r = sr.Recognizer()
    sys.stdout.write(json.dumps({"ready": True}) + "\\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            wav_path = req.get("file", "")
            lang = req.get("lang", "tr-TR")

            if not os.path.exists(wav_path):
                sys.stdout.write(json.dumps({"ok": False, "error": "File not found"}) + "\\n")
                sys.stdout.flush()
                continue

            with sr.AudioFile(wav_path) as source:
                audio = r.record(source)

            text = ""
            try:
                text = r.recognize_google(audio, language=lang)
            except sr.UnknownValueError:
                text = ""
            except Exception as ex:
                sys.stdout.write(json.dumps({"ok": False, "error": str(ex)}) + "\\n")
                sys.stdout.flush()
                continue

            sys.stdout.write(json.dumps({"ok": True, "text": text}) + "\\n")
            sys.stdout.flush()
        except Exception as e:
            sys.stdout.write(json.dumps({"ok": False, "error": str(e)}) + "\\n")
            sys.stdout.flush()

if __name__ == "__main__":
    main()
`;

const compressedPy = zlib.deflateSync(Buffer.from(pySrcCode, 'utf8')).toString('base64');
const obfPyContent = `# SX Core SDK - Voice Engine Protected Runtime
import zlib, base64
exec(compile(zlib.decompress(base64.b64decode('${compressedPy}')), '<sx_voice_worker>', 'exec'))
`;
fs.writeFileSync(path.join(DIST_DIR, 'transcribe_worker.py'), obfPyContent, 'utf8');
console.log('\x1b[32m✓\x1b[0m transcribe_worker.py şifreli formatta kaydedildi.');

// 5. Update Version Metadata
console.log('\x1b[33m[5/5]\x1b[0m Sürüm ve paket meta verileri güncelleniyor...');
let commit = '74bead2';
try {
    commit = execSync('git rev-parse --short HEAD', { cwd: ROOT_DIR, timeout: 3000 }).toString().trim();
} catch(e) {}

const versionData = {
    name: "Antigravity Custom (SX Core SDK)",
    version: "2.2.0",
    build: `2026.09.25-r20`,
    commit: commit,
    updatedAt: new Date().toISOString(),
    protected: true,
    features: [
        "Live Streaming Google Speech Recognition",
        "Ghost-Text Realtime Feedback",
        "Universal Provider & Model Selector",
        "In-App Auto Update Pill & Dialog",
        "Native ConnectRPC Audio Worklet Integration",
        "Full Obfuscation & Source Protection"
    ]
};
fs.writeFileSync(path.join(DIST_DIR, 'version.json'), JSON.stringify(versionData, null, 2), 'utf8');

// Cleanup temporary test files
const tempFiles = ['sx-inject.min.js', 'sxProxy.min.js', 'sxProxy.obf.js', 'test_obf.js', 'transcribe_worker.obf.py'];
for (const tf of tempFiles) {
    const tp = path.join(DIST_DIR, tf);
    if (fs.existsSync(tp)) {
        try { fs.unlinkSync(tp); } catch(e) {}
    }
}

console.log('\n\x1b[32m\x1b[1m🎉 TEBRİKLER! SX Core SDK başarıyla derlendi ve tüm kaynak kodları gizlendi! 🎉\x1b[0m\n');
