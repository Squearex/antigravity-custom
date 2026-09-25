/**
 * SX Core SDK - VoiceRecorder
 * Real-time Speech-to-Text directly in the chat prompt editor.
 * Uses Google Web Speech API (webkitSpeechRecognition) for live transcription,
 * with automatic fallback to local Google Speech API service.
 * Pulses the microphone red while recording.
 */
export class VoiceRecorder {
    constructor(logger) {
        this.logger = logger;
        this.isRecording = false;
        this.activeBtn = null;
        this.recognition = null;
        this.audioContext = null;
        this.mediaStream = null;
        this.scriptProcessor = null;
        this.sourceNode = null;
        this.recordedChunks = [];
        this.totalRecognized = '';
        this.lastInterim = '';
    }

    init() {
        document.addEventListener('click', (e) => {
            const btn = e.target.closest(
                'button[data-tooltip-id*="record-tooltip"], ' +
                'button[data-tooltip-id*="input-send-button-record-tooltip"], ' +
                'button[aria-label*="Record voice" i], ' +
                'button.sx-voice-btn, ' +
                'button[aria-label*="ses" i], ' +
                'button[aria-label*="voice" i]'
            );
            if (btn) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                this.toggleRecording(btn);
            }
        }, true);

        if (!document.getElementById('sx-voice-recorder-styles')) {
            const st = document.createElement('style');
            st.id = 'sx-voice-recorder-styles';
            st.textContent = `
                @keyframes sx-mic-pulse {
                    0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
                    70% { box-shadow: 0 0 0 9px rgba(239, 68, 68, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
                }
                button.sx-recording {
                    background-color: #ef4444 !important;
                    color: #ffffff !important;
                    animation: sx-mic-pulse 1.3s infinite !important;
                }
                button.sx-recording svg {
                    color: #ffffff !important;
                    fill: #ffffff !important;
                }
            `;
            (document.head || document.documentElement)?.appendChild(st);
        }

        this.logger.info('VoiceRecorder', 'Voice recorder initialized with Google SpeechRecognition.');
    }

    async toggleRecording(btn) {
        if (this.isRecording) {
            await this.stopRecording(btn);
        } else {
            await this.startRecording(btn);
        }
    }

    async startRecording(btn) {
        this.isRecording = true;
        this.activeBtn = btn;
        this.totalRecognized = '';
        this.lastInterim = '';
        this.recordedChunks = [];

        if (btn) {
            btn.classList.add('sx-recording');
            btn.setAttribute('aria-label', 'Stop recording');
            btn.title = 'Kaydı bitirmek için tekrar tıklayın';
        }

        const editor = document.querySelector('[contenteditable="true"]') ||
                       document.querySelector('textarea.antigravity-prompt-input') ||
                       document.querySelector('textarea');
        if (editor) editor.focus();

        // 1. Google SpeechRecognition (Chromium Web Speech API)
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SR) {
            try {
                this.recognition = new SR();
                this.recognition.continuous = true;
                this.recognition.interimResults = true;
                this.recognition.lang = navigator.language || 'tr-TR';

                let finalOffset = 0;
                this.recognition.onresult = (event) => {
                    let interimStr = '';
                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        const transcript = event.results[i][0].transcript;
                        if (event.results[i].isFinal) {
                            const trimmed = transcript.trim();
                            if (trimmed) {
                                this.insertTextIntoPrompt(trimmed + ' ');
                                this.totalRecognized += trimmed + ' ';
                                this.lastInterim = '';
                            }
                        } else {
                            interimStr += transcript;
                        }
                    }
                    this.lastInterim = interimStr.trim();
                };

                this.recognition.onerror = (e) => {
                    this.logger.warn('VoiceRecorder', 'SpeechRecognition event:', e.error);
                };

                this.recognition.onend = () => {
                    if (this.isRecording && this.recognition) {
                        try { this.recognition.start(); } catch(err) {}
                    }
                };

                this.recognition.start();
                this.logger.info('VoiceRecorder', 'Live SpeechRecognition active.');
            } catch(e) {
                this.logger.warn('VoiceRecorder', 'SpeechRecognition start error:', e);
            }
        }

        // 2. Parallel Web Audio capture for backup transcription
        try {
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        channelCount: 1,
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });
                this.mediaStream = stream;
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx) {
                    this.audioContext = new AudioCtx();
                    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
                    this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
                    this.scriptProcessor.onaudioprocess = (e) => {
                        if (!this.isRecording) return;
                        const data = e.inputBuffer.getChannelData(0);
                        this.recordedChunks.push(new Float32Array(data));
                    };
                    this.sourceNode.connect(this.scriptProcessor);
                    this.scriptProcessor.connect(this.audioContext.destination);
                }
            }
        } catch(e) {
            this.logger.warn('VoiceRecorder', 'Audio capture notice:', e);
        }
    }

    async stopRecording(btn = null) {
        this.isRecording = false;
        const targetBtn = btn || this.activeBtn;
        if (targetBtn) {
            targetBtn.classList.remove('sx-recording');
            targetBtn.setAttribute('aria-label', 'Record voice memo');
            targetBtn.title = 'Ses kaydı başlat';
        }
        this.activeBtn = null;

        // If there was any pending interim text spoken just before clicking stop, commit it
        if (this.lastInterim) {
            this.insertTextIntoPrompt(this.lastInterim + ' ');
            this.totalRecognized += this.lastInterim + ' ';
            this.lastInterim = '';
        }

        if (this.recognition) {
            try { this.recognition.stop(); } catch(e) {}
            this.recognition = null;
        }

        const sampleRate = this.audioContext ? this.audioContext.sampleRate : 44100;
        const chunks = this.recordedChunks;
        this.cleanupAudio();

        // If live SpeechRecognition captured speech, we are done!
        if (this.totalRecognized.trim().length > 0) {
            return;
        }

        // Fallback: If live recognition didn't yield text, transcribe via Google Speech API in proxy
        if (chunks && chunks.length > 0) {
            try {
                let totalLen = 0;
                for (let i = 0; i < chunks.length; i++) totalLen += chunks[i].length;
                if (totalLen > 1000) {
                    const merged = new Float32Array(totalLen);
                    let off = 0;
                    for (let i = 0; i < chunks.length; i++) {
                        merged.set(chunks[i], off);
                        off += chunks[i].length;
                    }
                    const resampled = this.resampleAudio(merged, sampleRate, 16000);
                    const wavBlob = this.encodeWAV(resampled, 16000);

                    const resp = await fetch('http://localhost:15725/sx/transcribe-audio?lang=tr-TR', {
                        method: 'POST',
                        headers: { 'Content-Type': 'audio/wav' },
                        body: wavBlob
                    });
                    const res = await resp.json();
                    if (res && res.ok && res.text) {
                        this.insertTextIntoPrompt(res.text.trim() + ' ');
                    }
                }
            } catch(e) {
                this.logger.error('VoiceRecorder', 'Backend transcription error', e);
            }
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
            view.setInt16(offset, s < 0 ? s * 32768 : s * 32767, true);
        }
        return new Blob([view], { type: 'audio/wav' });
    }

    cleanupAudio() {
        if (this.sourceNode) {
            try { this.sourceNode.disconnect(); } catch (e) {}
            this.sourceNode = null;
        }
        if (this.scriptProcessor) {
            try { this.scriptProcessor.disconnect(); } catch (e) {}
            this.scriptProcessor = null;
        }
        if (this.mediaStream) {
            try {
                this.mediaStream.getTracks().forEach((t) => t.stop());
            } catch (e) {}
            this.mediaStream = null;
        }
        if (this.audioContext) {
            try { this.audioContext.close(); } catch (e) {}
            this.audioContext = null;
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
