/**
 * SX Core SDK - VoiceRecorder
 * Real-time Speech-to-Text directly into the chat prompt editor.
 * Captures microphone audio using Web Audio API (16kHz mono WAV),
 * transcribes via local Google Speech Recognition service,
 * and seamlessly inserts text into the Lexical contenteditable prompt.
 * Pulses the microphone red while recording.
 */
export class VoiceRecorder {
    constructor(logger) {
        this.logger = logger;
        this.isRecording = false;
        this.activeBtn = null;
        this.audioContext = null;
        this.mediaStream = null;
        this.scriptProcessor = null;
        this.sourceNode = null;
        this.muteGain = null;
        this.recordedChunks = [];
    }

    init() {
        window.__SX_VOICE_RECORDER__ = this;

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
                    0% {
                        box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7);
                        transform: scale(1);
                    }
                    50% {
                        box-shadow: 0 0 0 9px rgba(239, 68, 68, 0);
                        transform: scale(1.08);
                    }
                    100% {
                        box-shadow: 0 0 0 0 rgba(239, 68, 68, 0);
                        transform: scale(1);
                    }
                }
                button.sx-recording {
                    background-color: #ef4444 !important;
                    color: #ffffff !important;
                    animation: sx-mic-pulse 1.3s infinite !important;
                    border-radius: 9999px !important;
                }
                button.sx-recording svg {
                    color: #ffffff !important;
                    fill: #ffffff !important;
                }
                button.sx-transcribing {
                    background-color: #f59e0b !important;
                    color: #ffffff !important;
                    border-radius: 9999px !important;
                    opacity: 0.8 !important;
                    cursor: wait !important;
                }
                button.sx-transcribing svg {
                    color: #ffffff !important;
                    fill: #ffffff !important;
                }
            `;
            (document.head || document.documentElement)?.appendChild(st);
        }

        this.logger.info('VoiceRecorder', 'Voice recorder initialized with Web Audio & Google Speech API.');
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
        this.recordedChunks = [];

        if (btn) {
            btn.classList.remove('sx-transcribing');
            btn.classList.add('sx-recording');
            btn.setAttribute('aria-label', 'Stop recording');
            btn.title = 'Kaydı bitirmek için tekrar tıklayın';
        }

        const editor = document.querySelector('div[contenteditable="true"]') ||
                       document.querySelector('[contenteditable="true"]') ||
                       document.querySelector('textarea.antigravity-prompt-input') ||
                       document.querySelector('textarea');
        if (editor) editor.focus();

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

                    // Mute gain node to prevent speaker feedback loop
                    this.muteGain = this.audioContext.createGain();
                    this.muteGain.gain.value = 0;
                    this.scriptProcessor.connect(this.muteGain);
                    this.muteGain.connect(this.audioContext.destination);
                }
                this.logger.info('VoiceRecorder', 'Microphone capture active.');
            }
        } catch(e) {
            this.logger.error('VoiceRecorder', 'Audio capture failed:', e);
            if (btn) btn.classList.remove('sx-recording');
            this.isRecording = false;
        }
    }

    async stopRecording(btn = null) {
        this.isRecording = false;
        const targetBtn = btn || this.activeBtn;
        if (targetBtn) {
            targetBtn.classList.remove('sx-recording');
            targetBtn.classList.add('sx-transcribing');
            targetBtn.setAttribute('aria-label', 'Transcribing...');
            targetBtn.title = 'Ses metne dönüştürülüyor...';
        }

        const sampleRate = this.audioContext ? this.audioContext.sampleRate : 44100;
        const chunks = [...this.recordedChunks];
        this.cleanupAudio();

        if (chunks && chunks.length > 0) {
            try {
                let totalLen = 0;
                for (let i = 0; i < chunks.length; i++) totalLen += chunks[i].length;
                
                // Minimum ~0.25 seconds of audio to attempt transcription
                if (totalLen > 3000) {
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
                        const recognized = res.text.trim();
                        if (recognized) {
                            this.insertTextIntoPrompt(recognized + ' ');
                        }
                    }
                }
            } catch(e) {
                this.logger.error('VoiceRecorder', 'Backend transcription error', e);
            }
        }

        if (targetBtn) {
            targetBtn.classList.remove('sx-transcribing');
            targetBtn.setAttribute('aria-label', 'Record voice memo');
            targetBtn.title = 'Ses kaydı başlat';
        }
        this.activeBtn = null;
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
        view.setUint16(20, 1, true); // PCM
        view.setUint16(22, 1, true); // mono
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true); // 16-bit
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
        if (this.muteGain) {
            try { this.muteGain.disconnect(); } catch (e) {}
            this.muteGain = null;
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
            const editor = document.querySelector('div[contenteditable="true"]') ||
                           document.querySelector('[contenteditable="true"]') ||
                           document.querySelector('textarea.antigravity-prompt-input') ||
                           document.querySelector('textarea');
            if (!editor) return;

            editor.focus();

            if (editor.isContentEditable) {
                // Focus end of content in Lexical editor
                const sel = window.getSelection();
                if (sel) {
                    const range = document.createRange();
                    range.selectNodeContents(editor);
                    range.collapse(false);
                    sel.removeAllRanges();
                    sel.addRange(range);
                }

                // Lexical / React contenteditable requires beforeinput event
                let handled = false;
                try {
                    const ev = new InputEvent('beforeinput', {
                        bubbles: true,
                        cancelable: true,
                        inputType: 'insertText',
                        data: text
                    });
                    handled = editor.dispatchEvent(ev);
                } catch(e) {}

                // Fallback to execCommand if not handled or not inserted
                if (!handled || !editor.innerText.includes(text.trim())) {
                    document.execCommand('insertText', false, text);
                }
            } else {
                const start = editor.selectionStart || 0;
                const end = editor.selectionEnd || 0;
                const val = editor.value || '';
                editor.value = val.substring(0, start) + text + val.substring(end);
                editor.selectionStart = editor.selectionEnd = start + text.length;
                editor.dispatchEvent(new Event('input', { bubbles: true }));
            }
        } catch(e) {
            this.logger.error('VoiceRecorder', 'Error inserting recognized text', e);
        }
    }
}
