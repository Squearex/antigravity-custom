# ⚡ Antigravity Custom (SX Core SDK)

Antigravity için geliştirilmiş yapay zeka model ve sağlayıcı yönetim motoru, ultra-akıcı canlı Türkçe/İngilizce sesli dikte sistemi ve performans takip modülü.

[![GitHub Release](https://img.shields.io/github/v/release/Squearex/antigravity-custom?color=emerald&label=Release)](https://github.com/Squearex/antigravity-custom/releases/latest)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-blue)
![License](https://img.shields.io/badge/Runtime-Protected%20Bytecode-purple)

---

## 🌟 Temel Özellikler

- 🎙️ **Canlı ve Akıcı Sesli Dikte**: Google Speech API ile entegre, konuşma anında silik önizleme (ghost-text) ile anlık yazıya döküm. Butona tıklandığı anda gecikmesiz başlar ve duraksamaları anlık yakalar.
- 🧠 **Evrensel Model & Sağlayıcı Hub'ı**: OpenRouter, DeepSeek, Claude 3.5, OpenAI GPT-4o, Ollama, Groq ve 19+ sağlayıcıyı Antigravity içerisinden doğrudan kullanabilme.
- ⚡ **Arayüz İçi Tek Tıkla Güncelleme**: GitHub üzerinde yeni bir release yayınlandığında arayüzde beliren canlı hap butonu (`⚡ SX Güncelle`) ile tek tıkla güncelleme ve yeniden başlatma.
- 📊 **Gerçek Zamanlı Metrikler**: TTFT (Time To First Token), TPS (Tokens Per Second) ve Context Window doluluk yüzdesi takibi.
- 🛡️ **Tam Koruma ve Gizleme (Obfuscated Runtime)**: Çalışma ortamı tersine mühendisliğe karşı tamamen şifrelenmiş, Python motoru yerel `.pyc` bytecode formatında çalışır.

---

## 🚀 Hızlı Kurulum

Kurulum aracı sisteminizdeki Antigravity kurulumunu (Windows veya Linux) **otomatik olarak tespit eder**, orijinal dosyaları yedekler ve SX Core SDK'yı sorunsuz şekilde entegre eder.

### 🐧 Linux (Tek Satır Kurulum)
Terminalinizi açın ve aşağıdaki komutu yapıştırın:

```bash
mkdir -p sx-installer && cd sx-installer && curl -sSL https://github.com/Squearex/antigravity-custom/releases/latest/download/antigravity-custom-v2.2.0.tar.gz | tar -xz && chmod +x install.sh && ./install.sh
```

> **Not:** Linux üzerinde Antigravity yolu (`which antigravity`, `/opt/Antigravity`, `/usr/lib/antigravity`, `~/.local/share/antigravity` veya Flatpak) otomatik olarak taranır ve bulunur.

---

### 🪟 Windows (Tek Tıkla Kurulum)

1. [**En Son Sürümü İndir (Releases)**](https://github.com/Squearex/antigravity-custom/releases/latest) bağlantısından **`antigravity-custom-v2.2.0.zip`** dosyasını indirin.
2. Zip arşivini bir klasöre çıkartın.
3. Klasör içindeki **`install.bat`** dosyasına çift tıklayın.

*Veya PowerShell ile tek satırda kurmak için:*
```powershell
irm https://github.com/Squearex/antigravity-custom/releases/latest/download/antigravity-custom-v2.2.0.zip -OutFile sx.zip; Expand-Archive sx.zip -DestinationPath sx -Force; cd sx; .\install.bat
```

---

## 🔄 Güncellemeler Nasıl Yapılır?

GitHub Releases üzerinde yeni bir sürüm yayınlandığında:
1. Antigravity arayüzündeki işlem çubuğunda yeşil **`⚡ SX Güncelle`** butonu otomatik olarak görünür.
2. Butona tıkladığınızda açılan pencerede yenilikleri inceleyip **"🚀 Şimdi Güncelle ve Yeniden Başlat"** butonuna basarak tek tıkla güncelleyebilirsiniz.

---

## 🗑️ Kaldırma (Uninstall / Orijinale Dönüş)

Antigravity'yi hiçbir veri kaybetmeden orijinal haline döndürmek için indirilen klasörde:

* **Linux:** `./uninstall.sh`
* **Windows:** `uninstall.bat`
* **Veya Komut Satırı:** `node installer.js --uninstall`

---

## 📊 Kurulum Durumunu Kontrol Etme

```bash
node installer.js --status
```
