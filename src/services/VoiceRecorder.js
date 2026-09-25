/**
 * SX Core SDK - VoiceRecorder
 * Real-time voice recording via Web Audio API, encoded to standard 16kHz mono WAV,
 * and transcribed via SX Proxy's Python SpeechRecognition service.
 * Inserts transcribed text directly into the chat prompt editor.
 */
export class VoiceRecorder {
    constructor(logger) {
        this.logger = logger;
        this.isRecording = false;
        this.isTranscribing = false;
        this.activeBtn = null;
        this.audioContext = null;
        this.mediaStream = null;
        this.scriptProcessor = null;
        this.sourceNode = null;
        this.recordedChunks = [];
        this.recordStartTime = 0;
        this.statusIndicator = null;
        this._hideTimeout = null;
    }

    init() {
        // Global capturing listener on voice recording buttons
        document.addEventListener('click', (e) => {
            const btn = e.target.closest(
                'button[aria-label*="Record voice" i], ' +
                '[data-tooltip-id*="record-tooltip"], ' +
                'button.sx-voice-btn, ' +
                'button[aria-label*="ses" i], ' +
                'button[aria-label*="voice" i]'
            );
            if (btn) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.toggleRecording(btn);
            }
        }, true);

        // Inject pulsing recording & spinner styles
        if (!document.getElementById('sx-voice-recorder-styles')) {
            const st = document.createElement('style');
            st.id = 'sx-voice-recorder-styles';
            st.textContent = `
                @keyframes sx-mic-pulse {
                    0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
                    70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
                }
                button.sx-recording {
                    background-color: #ef4444 !important;
                    color: #ffffff !important;
                    animation: sx-mic-pulse 1.4s infinite !important;
                }
                button.sx-recording svg {
                    color: #ffffff !important;
                    fill: #ffffff !important;
                }
                button.sx-transcribing {
                    background-color: #f59e0b !important;
                    color: #ffffff !important;
                    opacity: 0.85 !important;
                    pointer-events: none !important;
                }
                #sx-voice-status-pill {
                    position: fixed;
                    bottom: 80px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(15, 23, 42, 0.95);
                    border: 1px solid rgba(239, 68, 68, 0.4);
                    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
                    color: #f8fafc;
                    font-size: 12px;
                    font-weight: 500;
                    padding: 6px 16px;
                    border-radius: 20px;
                    z-index: 100005;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    backdrop-filter: blur(12px);
                    pointer-events: none;
                    transition: all 0.25s ease;
                }
            `;
            (document.head || document.documentElement)?.appendChild(st);
        }

        this.logger.info('VoiceRecorder', 'Native AudioContext VoiceRecorder initialized.');
    }

    async toggleRecording(btn) {
        if (this.isTranscribing) return;
        if (this.isRecording) {
            await this.stopRecordingAndTranscribe();
        } else {
            await this.startRecording(btn);
        }
    }

    async startRecording(btn) {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                alert('Mikrofon erişimi bu ortamda desteklenmiyor.');
                return;
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            this.mediaStream = stream;
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContextClass();

            this.sourceNode = this.audioContext.createMediaStreamSource(stream);
            this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
            this.recordedChunks = [];
            this.recordStartTime = Date.now();

            this.scriptProcessor.onaudioprocess = (e) => {
                if (!this.isRecording) return;
                const channelData = e.inputBuffer.getChannelData(0);
                this.recordedChunks.push(new Float32Array(channelData));
            };

            this.sourceNode.connect(this.scriptProcessor);
            this.scriptProcessor.connect(this.audioContext.destination);

            this.isRecording = true;
            this.activeBtn = btn;
            if (btn) {
                btn.classList.add('sx-recording');
                btn.setAttribute('aria-label', 'Stop recording');
                btn.title = 'Kaydı bitirmek için tekrar tıklayın';
            }

            this.showStatusPill('🔴 Dinleniyor... Bitirmek için mikrofona tekrar tıklayın');
            this.logger.info('VoiceRecorder', 'AudioContext recording started');
        } catch (err) {
            this.logger.error('VoiceRecorder', 'Failed to access microphone', err);
            this.hideStatusPill();
            alert('Mikrofon erişim hatası: ' + (err.message || err));
            this.cleanupAudio();
        }
    }

    async stopRecordingAndTranscribe() {
        this.isRecording = false;
        const btn = this.activeBtn;
        if (btn) {
            btn.classList.remove('sx-recording');
            btn.classList.add('sx-transcribing');
            btn.title = 'Metne dönüştürülüyor...';
        }

        const duration = (Date.now() - this.recordStartTime) / 1000;
        this.showStatusPill('⏳ Metne dönüştürülüyor...');
        this.isTranscribing = true;

        const sampleRate = this.audioContext ? this.audioContext.sampleRate : 44100;
        const chunks = this.recordedChunks;

        this.cleanupAudio();

        if (chunks.length === 0 || duration < 0.3) {
            this.hideStatusPill();
            if (btn) {
                btn.classList.remove('sx-transcribing');
                btn.title = 'Ses kaydı başlat';
            }
            this.isTranscribing = false;
            return;
        }

        try {
            let totalLength = 0;
            for (let i = 0; i < chunks.length; i++) {
                totalLength += chunks[i].length;
            }
            const merged = new Float32Array(totalLength);
            let offset = 0;
            for (let i = 0; i < chunks.length; i++) {
                merged.set(chunks[i], offset);
                offset += chunks[i].length;
            }

            const targetSampleRate = 16000;
            const resampled = this.resampleAudio(merged, sampleRate, targetSampleRate);
            const wavBlob = this.encodeWAV(resampled, targetSampleRate);

            const resp = await fetch('http://localhost:15725/sx/transcribe-audio?lang=tr-TR', {
                method: 'POST',
                headers: { 'Content-Type': 'audio/wav' },
                body: wavBlob
            });

            const data = await resp.json();
            if (data && data.ok && data.text) {
                const recognized = data.text.trim();
                this.insertTextIntoPrompt(recognized + ' ');
                this.showStatusPill(`✓ "${recognized}" eklendi`, 2500);
            } else if (data && data.text === '') {
                this.showStatusPill('⚠️ Ses algılanamadı', 2500);
            } else {
                this.showStatusPill('⚠️ ' + (data.error || 'Dönüştürme başarısız'), 2500);
            }
        } catch (err) {
            this.logger.error('VoiceRecorder', 'Transcription error', err);
            this.showStatusPill('⚠️ Sunucu bağlantı hatası', 2500);
        } finally {
            this.isTranscribing = false;
            if (btn) {
                btn.classList.remove('sx-transcribing');
                btn.setAttribute('aria-label', 'Record voice memo');
                btn.title = 'Ses kaydı başlat';
            }
            this.activeBtn = null;
        }
    }

    resampleAudio(samples, oldRate, newRate) {
        if (oldRate === newRate) return samples;
        const ratio = oldRate / newRate;
        const newLength = Math.round(samples.length / ratio);
        const result = new Float32Array(newLength);
        for (let i = 0; i < newLength; i++) {
            const originIndex = i * ratio;
            const index = Math.floor(originIndex);
            const frac = originIndex - index;
            const next = index + 1 < samples.length ? samples[index + 1] : samples[index];
            result[i] = samples[index] * (1 - frac) + next * frac;
        }
        return result;
    }

    encodeWAV(samples, sampleRate) {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);

        const writeString = (v, off, str) => {
            for (let i = 0; i < str.length; i++) {
                v.setUint8(off + i, str.charCodeAt(i));
            }
        };

        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(view, 36, 'data');
        view.setUint32(40, samples.length * 2, true);

        let offset = 44;
        for (let i = 0; i < samples.length; i++, offset += 2) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }

        return new Blob([view], { type: 'audio/wav' });
    }

    cleanupAudio() {
        if (this.sourceNode) {
            try { this.sourceNode.disconnect(); } catch(e) {}
            this.sourceNode = null;
        }
        if (this.scriptProcessor) {
            try { this.scriptProcessor.disconnect(); } catch(e) {}
            this.scriptProcessor = null;
        }
        if (this.mediaStream) {
            try {
                this.mediaStream.getTracks().forEach(t => t.stop());
            } catch(e) {}
            this.mediaStream = null;
        }
        if (this.audioContext) {
            try { this.audioContext.close(); } catch(e) {}
            this.audioContext = null;
        }
    }

    showStatusPill(text, autoHideMs = 0) {
        if (!this.statusIndicator) {
            this.statusIndicator = document.createElement('div');
            this.statusIndicator.id = 'sx-voice-status-pill';
            document.body.appendChild(this.statusIndicator);
        }
        this.statusIndicator.textContent = text;
        this.statusIndicator.style.display = 'flex';
        this.statusIndicator.style.opacity = '1';

        if (this._hideTimeout) clearTimeout(this._hideTimeout);
        if (autoHideMs > 0) {
            this._hideTimeout = setTimeout(() => {
                this.hideStatusPill();
            }, autoHideMs);
        }
    }

    hideStatusPill() {
        if (this.statusIndicator) {
            this.statusIndicator.style.opacity = '0';
            setTimeout(() => {
                if (this.statusIndicator && this.statusIndicator.style.opacity === '0') {
                    this.statusIndicator.style.display = 'none';
                }
            }, 300);
        }
    }

    insertTextIntoPrompt(text) {
        try {
            const editor = document.querySelector('[contenteditable="true"]') ||
                           document.querySelector('textarea.antigravity-prompt-input') ||
                           document.querySelector('textarea');
            if (editor) {
                editor.focus();
                if (editor.isContentEditable) {
                    document.execCommand('insertText', false, text);
                } else {
                    const start = editor.selectionStart || 0;
                    const end = editor.selectionEnd || 0;
                    const val = editor.value || '';
                    editor.value = val.substring(0, start) + text + val.substring(end);
                    editor.selectionStart = editor.selectionEnd = start + text.length;
                    editor.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
        } catch(e) {
            this.logger.error('VoiceRecorder', 'Error inserting recognized text', e);
        }
    }
}
