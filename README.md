# ⚡ Antigravity Custom (SX Core SDK)

Antigravity için geliştirilmiş gelişmiş yapay zeka sağlayıcı motoru, canlı Türkçe/İngilizce sesli dikte sistemi ve performans takip modülü.

![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-emerald)
![Version](https://img.shields.io/badge/Version-v2.2.0-blue)
![License](https://img.shields.io/badge/Protection-Obfuscated%20Bytecode-purple)

---

## 🌟 Temel Özellikler

- 🎙️ **Canlı ve Akıcı Sesli Dikte**: Google Speech API ile entegre, konuşma anında silik önizleme (ghost-text) ile anlık yazıya döküm. Butona tıklandığı anda dinlemeye başlar ve duraksamaları anlık yakalar.
- 🧠 **Evrensel Model & Sağlayıcı Hub'ı**: OpenRouter, DeepSeek, Claude 3.5, OpenAI GPT-4o, Ollama, Groq ve 19+ sağlayıcıyı Antigravity içerisinden doğrudan kullanabilme.
- ⚡ **Arayüz İçi Tek Tıkla Güncelleme**: GitHub üzerinde yeni bir sürüm çıktığında arayüzde beliren canlı hap butonu (`SX Güncelle`) ile tek tıkla güncelleme ve yeniden başlatma.
- 📊 **Gerçek Zamanlı Metrikler**: TTFT (Time To First Token), TPS (Tokens Per Second) ve Context Window doluluk yüzdesi takibi.
- 🛡️ **Tam Koruma ve Gizleme (Obfuscated Runtime)**: Kaynak kodlar tersine mühendisliğe karşı tamamen şifrelenmiş, Python motoru makineye özel `.pyc` bytecode formatında çalışır.

---

## 🚀 Hızlı Kurulum

Kurulum aracı sisteminizdeki Antigravity kurulumunu (Windows veya Linux) **otomatik olarak tespit eder**, orijinal dosyaları yedekler ve SX Core SDK'yı sorunsuz şekilde entegre eder.

### 🐧 Linux (Tek Satır Kurulum)
Terminalinizi açın ve aşağıdaki komutu yapıştırın:

```bash
git clone https://github.com/Squearex/antigravity-custom.git && cd antigravity-custom && chmod +x install.sh && ./install.sh
```

> **Not:** Linux üzerinde Antigravity yolu (`which antigravity`, `/opt/Antigravity`, `/usr/lib/antigravity`, `~/.local/share/antigravity` veya Flatpak) otomatik olarak taranır ve bulunur.

---

### 🪟 Windows (Tek Tıkla Kurulum)

1. Projeyi indirin veya klonlayın:
   ```powershell
   git clone https://github.com/Squearex/antigravity-custom.git
   cd antigravity-custom
   ```
2. Klasör içindeki **`install.bat`** dosyasına çift tıklayın (veya PowerShell'de `node installer.js` çalıştırın).

---

## 🔄 Güncellemeler Nasıl Yapılır?

GitHub reposuna yeni bir sürüm veya commit geldiğinde:
1. Antigravity arayüzündeki işlem çubuğunda yeşil **`⚡ SX Güncelle`** butonu otomatik olarak yanıp söner.
2. Butona tıkladığınızda açılan pencerede değişiklikleri görüp **"🚀 Şimdi Güncelle ve Yeniden Başlat"** butonuna basarak tek tıkla güncelleyebilirsiniz.
3. Veya terminalden reponun bulunduğu dizinde `git pull origin main && node installer.js` çalıştırabilirsiniz.

---

## 🗑️ Kaldırma (Uninstall / Geri Döndürme)

Antigravity'yi hiçbir veri kaybetmeden orijinal haline döndürmek için:

* **Linux:**
  ```bash
  ./uninstall.sh
  ```
* **Windows:**
  **`uninstall.bat`** dosyasına çift tıklayın (veya `node installer.js --uninstall`).

---

## 📊 Kurulum Durumunu Kontrol Etme

```bash
node installer.js --status
```

---

## 🛠️ Geliştiriciler İçin (Build & Obfuscation)

Kaynak kodları düzenledikten sonra tüm paketleri esbuild + javascript-obfuscator + bytecode derleme sürecinden geçirip dağıtıma hazır hale getirmek için:

```bash
npm run build
```
