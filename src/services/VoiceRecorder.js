/**
 * SX Core SDK - VoiceRecorder
 * Real-time Streaming Speech-to-Text with native Google Antigravity UI:
 * - Live real-time transcription: Transcribes as you speak via Voice Activity Detection (VAD)
 * - Automatic speech pause detection (~480ms) + continuous speech slicing (3.8s max)
 * - Exact Antigravity 3-bar animated waveform visualizer (cEa)
 * - Sequential queue to preserve word order
 * - Facebook Lexical beforeinput event insertion
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
        this.visualizerBars = null;
        this.animFrameId = null;

        // Streaming VAD state
        this.segmentChunks = [];
        this.hasSpeech = false;
        this.speechStartTime = 0;
        this.lastSpeechTime = 0;
        this.noiseFloor = 0.015;
        this.transcriptionQueue = [];
        this.isProcessingQueue = false;
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

        this.logger.info('VoiceRecorder', 'Live streaming voice recorder initialized.');
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
        this.segmentChunks = [];
        this.transcriptionQueue = [];
        this.hasSpeech = false;
        this.speechStartTime = 0;
        this.lastSpeechTime = 0;
        this.noiseFloor = 0.015;

        if (btn) {
            if (!btn._origHtml) {
                btn._origHtml = btn.innerHTML;
            }
            btn.classList.remove('bg-transparent', 'hover:bg-secondary');
            btn.classList.add('bg-red-500', 'text-white');
            btn.setAttribute('aria-label', 'Stop recording');
            btn.title = 'Stop Recording';

            // Native Antigravity 3-bar waveform structure
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
                                class SXStreamRecorderProcessor extends AudioWorkletProcessor {
                                    process(inputs) {
                                        const input = inputs[0];
                                        if (input && input[0]) {
                                            this.port.postMessage(input[0]);
                                        }
                                        return true;
                                    }
                                }
                                registerProcessor('sx-stream-recorder-processor', SXStreamRecorderProcessor);
                            `;
                            const blob = new Blob([workletCode], { type: 'application/javascript' });
                            const url = URL.createObjectURL(blob);
                            await this.audioContext.audioWorklet.addModule(url);
                            URL.revokeObjectURL(url);
                            const workletNode = new AudioWorkletNode(this.audioContext, 'sx-stream-recorder-processor');
                            workletNode.port.onmessage = (e) => {
                                if (!this.isRecording) return;
                                this.onAudioChunk(e.data);
                            };
                            this.sourceNode.connect(workletNode);
                            this.workletNode = workletNode;
                            workletReady = true;
                        } catch(err) {}
                    }

                    if (!workletReady) {
                        this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
                        this.scriptProcessor.onaudioprocess = (e) => {
                            if (!this.isRecording) return;
                            const data = e.inputBuffer.getChannelData(0);
                            this.onAudioChunk(data);
                        };
                        this.sourceNode.connect(this.scriptProcessor);
                        this.muteGain = this.audioContext.createGain();
                        this.muteGain.gain.value = 0;
                        this.scriptProcessor.connect(this.muteGain);
                        this.muteGain.connect(this.audioContext.destination);
                    }

                    // 2. Native Antigravity cEa 3-bar Audio Visualizer FFT + VAD
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

                        // VAD check on every frame
                        this.checkVoiceActivity(rms);

                        this.animFrameId = requestAnimationFrame(updateVisualizer);
                    };
                    this.animFrameId = requestAnimationFrame(updateVisualizer);
                }
                this.logger.info('VoiceRecorder', 'Live streaming microphone active with real-time transcription.');
            }
        } catch(e) {
            this.logger.error('VoiceRecorder', 'Audio capture failed:', e);
            this.resetButton(btn);
            this.isRecording = false;
        }
    }

    onAudioChunk(data) {
        if (!this.isRecording) return;
        this.segmentChunks.push(new Float32Array(data));
    }

    checkVoiceActivity(rms) {
        const now = performance.now();
        const threshold = Math.max(0.025, this.noiseFloor * 2.2);

        if (rms > threshold) {
            if (!this.hasSpeech) {
                this.hasSpeech = true;
                this.speechStartTime = now;
            }
            this.lastSpeechTime = now;
        } else {
            // Adapt noise floor slowly during silence
            this.noiseFloor = this.noiseFloor * 0.98 + rms * 0.02;

            if (this.hasSpeech) {
                const pauseDuration = now - this.lastSpeechTime;
                const speechDuration = this.lastSpeechTime - this.speechStartTime;

                // Natural pause (~480ms after >= 320ms speech) triggers live transcription
                if (pauseDuration >= 480 && speechDuration >= 320) {
                    this.flushSegment();
                }
            }
        }

        // Long continuous speech (> 3800ms) without pause is sliced automatically
        if (this.hasSpeech && (now - this.speechStartTime >= 3800)) {
            this.flushSegment();
            this.hasSpeech = true;
            this.speechStartTime = now;
            this.lastSpeechTime = now;
        }
    }

    flushSegment() {
        if (!this.segmentChunks.length) return;
        const chunks = this.segmentChunks;
        this.segmentChunks = [];
        this.hasSpeech = false;

        let totalLen = 0;
        for (let i = 0; i < chunks.length; i++) totalLen += chunks[i].length;

        const sampleRate = this.audioContext ? this.audioContext.sampleRate : 44100;
        // Require at least ~0.25 seconds of audio
        if (totalLen >= sampleRate * 0.25) {
            const merged = new Float32Array(totalLen);
            let off = 0;
            for (let i = 0; i < chunks.length; i++) {
                merged.set(chunks[i], off);
                off += chunks[i].length;
            }
            const resampled = this.resampleAudio(merged, sampleRate, 16000);
            const wavBlob = this.encodeWAV(resampled, 16000);
            this.enqueueTranscription(wavBlob);
        }
    }

    enqueueTranscription(wavBlob) {
        this.transcriptionQueue.push(wavBlob);
        this.processQueue();
    }

    async processQueue() {
        if (this.isProcessingQueue || !this.transcriptionQueue.length) return;
        this.isProcessingQueue = true;

        while (this.transcriptionQueue.length > 0) {
            const wavBlob = this.transcriptionQueue.shift();
            try {
                const resp = await fetch('http://localhost:15725/sx/transcribe-audio?lang=tr-TR', {
                    method: 'POST',
                    headers: { 'Content-Type': 'audio/wav' },
                    body: wavBlob
                });
                const res = await resp.json();
                if (res && res.ok && res.text) {
                    const text = res.text.trim();
                    if (text) {
                        this.insertTextIntoPrompt(text + ' ');
                    }
                }
            } catch(e) {
                this.logger.error('VoiceRecorder', 'Live transcription request failed:', e);
            }
        }

        this.isProcessingQueue = false;
    }

    async stopRecording(btn = null) {
        this.isRecording = false;
        const targetBtn = btn || this.activeBtn;

        if (this.animFrameId) {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
        this.visualizerBars = null;

        // Flush any remaining audio in the buffer
        this.flushSegment();

        // If background transcription queue is still finishing, show brief spinner
        if (targetBtn && (this.isProcessingQueue || this.transcriptionQueue.length > 0)) {
            targetBtn.innerHTML = `
                <svg class="animate-spin w-3.5 h-3.5 text-white pointer-events-none" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            `;
            let waitCount = 0;
            while ((this.isProcessingQueue || this.transcriptionQueue.length > 0) && waitCount < 30) {
                await new Promise(r => setTimeout(r, 100));
                waitCount++;
            }
        }

        this.cleanupAudio();

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
