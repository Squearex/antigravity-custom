/**
 * SX Core SDK - VoiceRecorder
 * Exact match with Google Antigravity native microphone UX and waveform animation:
 * - Idle: Native transparent mic icon (U / 'mic')
 * - Recording: bg-red-500 text-white with live 3-bar animated audio waveform (cEa)
 * - Finalizing: Smooth spinner while transcribing
 * - Audio: Modern AudioWorkletNode (with ScriptProcessorNode fallback) + AnalyserNode FFT
 * - Text insertion: Facebook Lexical beforeinput event
 */
export class VoiceRecorder {
    constructor(logger) {
        this.logger = logger;
        this.isRecording = false;
        this.activeBtn = null;
        this.audioContext = null;
        this.mediaStream = null;
        this.scriptProcessor = null;
        this.workletNode = null;
        this.sourceNode = null;
        this.analyserNode = null;
        this.muteGain = null;
        this.recordedChunks = [];
        this.visualizerBars = null;
        this.animFrameId = null;
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

        this.logger.info('VoiceRecorder', 'Voice recorder initialized with native waveform UX & Google Speech API.');
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
            if (!btn._origHtml) {
                btn._origHtml = btn.innerHTML;
            }
            btn.classList.remove('bg-transparent', 'hover:bg-secondary');
            btn.classList.add('bg-red-500', 'text-white');
            btn.setAttribute('aria-label', 'Stop recording');
            btn.title = 'Stop Recording';

            // Exact Antigravity cEa 3-bar waveform structure
            btn.innerHTML = `
                <div class="flex items-center justify-center gap-[2px] w-4 h-4 pointer-events-none" aria-hidden="true">
                    <div class="sx-wave-bar w-[2px] rounded-full bg-white transition-[height] duration-75" style="height: 4px;"></div>
                    <div class="sx-wave-bar w-[2px] rounded-full bg-white transition-[height] duration-75" style="height: 5px;"></div>
                    <div class="sx-wave-bar w-[2px] rounded-full bg-white transition-[height] duration-75" style="height: 4px;"></div>
                </div>
            `;
            this.visualizerBars = Array.from(btn.querySelectorAll('.sx-wave-bar'));
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
                    if (this.audioContext.state === 'suspended') {
                        this.audioContext.resume().catch(() => {});
                    }
                    this.sourceNode = this.audioContext.createMediaStreamSource(stream);

                    // 1. Audio Recording Pipeline (AudioWorklet with ScriptProcessor fallback)
                    let workletReady = false;
                    if (this.audioContext.audioWorklet) {
                        try {
                            const workletCode = `
                                class SXRecorderProcessor extends AudioWorkletProcessor {
                                    process(inputs) {
                                        const input = inputs[0];
                                        if (input && input[0]) {
                                            this.port.postMessage(input[0]);
                                        }
                                        return true;
                                    }
                                }
                                registerProcessor('sx-recorder-processor', SXRecorderProcessor);
                            `;
                            const blob = new Blob([workletCode], { type: 'application/javascript' });
                            const url = URL.createObjectURL(blob);
                            await this.audioContext.audioWorklet.addModule(url);
                            URL.revokeObjectURL(url);
                            const workletNode = new AudioWorkletNode(this.audioContext, 'sx-recorder-processor');
                            workletNode.port.onmessage = (e) => {
                                if (!this.isRecording) return;
                                this.recordedChunks.push(new Float32Array(e.data));
                            };
                            this.sourceNode.connect(workletNode);
                            this.workletNode = workletNode;
                            workletReady = true;
                        } catch(err) {
                            // Fallback to ScriptProcessor below
                        }
                    }

                    if (!workletReady) {
                        this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
                        this.scriptProcessor.onaudioprocess = (e) => {
                            if (!this.isRecording) return;
                            const data = e.inputBuffer.getChannelData(0);
                            this.recordedChunks.push(new Float32Array(data));
                        };
                        this.sourceNode.connect(this.scriptProcessor);
                        this.muteGain = this.audioContext.createGain();
                        this.muteGain.gain.value = 0;
                        this.scriptProcessor.connect(this.muteGain);
                        this.muteGain.connect(this.audioContext.destination);
                    }

                    // 2. Native Antigravity cEa 3-bar Audio Visualizer FFT
                    this.analyserNode = this.audioContext.createAnalyser();
                    this.analyserNode.fftSize = 64;
                    this.analyserNode.smoothingTimeConstant = 0.8;
                    this.analyserNode.minDecibels = -60;
                    this.analyserNode.maxDecibels = -25;
                    this.sourceNode.connect(this.analyserNode);

                    const freqData = new Uint8Array(this.analyserNode.frequencyBinCount);
                    let smoothedVol = 0;
                    let maxSeen = 0.25;

                    const updateVisualizer = () => {
                        if (!this.isRecording || !this.analyserNode) return;
                        this.analyserNode.getByteFrequencyData(freqData);
                        let sumSq = 0;
                        for (let i = 0; i < freqData.length; i++) sumSq += freqData[i] * freqData[i];
                        const rms = Math.sqrt(sumSq / freqData.length) / 255;
                        maxSeen = Math.max(0.25, maxSeen * 0.995, rms);
                        let normalized = Math.min(1, rms / maxSeen);
                        normalized *= normalized;
                        smoothedVol = normalized > smoothedVol
                            ? smoothedVol + (normalized - smoothedVol) * 0.6
                            : smoothedVol + (normalized - smoothedVol) * 0.15;

                        const heights = [
                            Math.max(3, Math.min(14, 4 + smoothedVol * 8)),
                            Math.max(4, Math.min(16, 5 + smoothedVol * 12)),
                            Math.max(3, Math.min(14, 4 + smoothedVol * 8))
                        ];
                        if (this.visualizerBars) {
                            for (let i = 0; i < this.visualizerBars.length; i++) {
                                const bar = this.visualizerBars[i];
                                if (bar) bar.style.height = `${heights[i]}px`;
                            }
                        }
                        this.animFrameId = requestAnimationFrame(updateVisualizer);
                    };
                    this.animFrameId = requestAnimationFrame(updateVisualizer);
                }
                this.logger.info('VoiceRecorder', 'Microphone capture active with live waveform.');
            }
        } catch(e) {
            this.logger.error('VoiceRecorder', 'Audio capture failed:', e);
            this.resetButton(btn);
            this.isRecording = false;
        }
    }

    async stopRecording(btn = null) {
        this.isRecording = false;
        const targetBtn = btn || this.activeBtn;

        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
        this.visualizerBars = null;

        if (targetBtn) {
            // Show subtle spinner while finalizing transcription
            targetBtn.innerHTML = `
                <svg class="animate-spin w-3.5 h-3.5 text-white pointer-events-none" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            `;
            targetBtn.setAttribute('aria-label', 'Finalizing transcription...');
            targetBtn.title = 'Finalizing...';
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
            this.resetButton(targetBtn);
        }
        this.activeBtn = null;
    }

    resetButton(btn) {
        if (!btn) return;
        btn.classList.remove('bg-red-500', 'text-white');
        btn.classList.add('bg-transparent', 'hover:bg-secondary');
        if (btn._origHtml) {
            btn.innerHTML = btn._origHtml;
        }
        btn.setAttribute('aria-label', 'Record voice memo');
        btn.title = 'Record Audio';
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
        if (this.analyserNode) {
            try { this.analyserNode.disconnect(); } catch (e) {}
            this.analyserNode = null;
        }
        if (this.workletNode) {
            try { this.workletNode.disconnect(); } catch (e) {}
            this.workletNode = null;
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
                const sel = window.getSelection();
                if (sel) {
                    const range = document.createRange();
                    range.selectNodeContents(editor);
                    range.collapse(false);
                    sel.removeAllRanges();
                    sel.addRange(range);
                }

                let dispatched = false;
                try {
                    const ev = new InputEvent('beforeinput', {
                        bubbles: true,
                        cancelable: true,
                        inputType: 'insertText',
                        data: text
                    });
                    dispatched = editor.dispatchEvent(ev);
                } catch(e) {}

                if (!dispatched || !editor.innerText.includes(text.trim())) {
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
