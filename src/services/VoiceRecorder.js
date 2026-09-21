/**
 * SX Core SDK - VoiceRecorder
 * Real-time Speech-to-Text directly in the browser via SpeechRecognition / webkitSpeechRecognition.
 * Transcribes voice directly into the prompt editor with zero-latency without requiring Google Cloud audio models.
 */
export class VoiceRecorder {
    constructor(logger) {
        this.logger = logger;
        this.isRecording = false;
        this.recognition = null;
        this.activeBtn = null;
        this.originalContent = '';
    }

    init() {
        // Global capturing listener on voice recording buttons
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('button[aria-label*="Record voice" i], [data-tooltip-id*="record-tooltip"], button.sx-voice-btn');
            if (btn) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.toggleRecording(btn);
            }
        }, true);

        // Inject pulsing recording styles
        if (!document.getElementById('sx-voice-recorder-styles')) {
            const st = document.createElement('style');
            st.id = 'sx-voice-recorder-styles';
            st.textContent = `
                @keyframes sx-mic-pulse {
                    0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
                    70% { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
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
            `;
            (document.head || document.documentElement)?.appendChild(st);
        }

        this.logger.info('VoiceRecorder', 'Voice recorder initialized with SpeechRecognition support.');
    }

    toggleRecording(btn) {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            this.startRecording(btn);
        }
    }

    startRecording(btn) {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
            alert('Tarayıcınızda veya sisteminizde ses tanıma (SpeechRecognition) desteklenmiyor.');
            return;
        }

        try {
            this.recognition = new SR();
            this.recognition.continuous = true;
            this.recognition.interimResults = true;
            this.recognition.lang = navigator.language || 'tr-TR';

            this.activeBtn = btn;
            this.isRecording = true;
            if (btn) {
                btn.classList.add('sx-recording');
                btn.setAttribute('aria-label', 'Stop recording');
                btn.title = 'Kaydı durdurmak için tıklayın';
            }

            const editor = document.querySelector('[contenteditable="true"]');
            if (editor) editor.focus();

            let lastFinalText = '';

            this.recognition.onresult = (event) => {
                let interim = '';
                let newFinal = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        newFinal += event.results[i][0].transcript;
                    } else {
                        interim += event.results[i][0].transcript;
                    }
                }

                if (newFinal && newFinal !== lastFinalText) {
                    lastFinalText = newFinal;
                    this.insertTextIntoPrompt(newFinal.trim() + ' ');
                }
            };

            this.recognition.onerror = (event) => {
                this.logger.error('VoiceRecorder', 'Speech recognition error', event.error);
                if (event.error !== 'no-speech') {
                    this.stopRecording();
                }
            };

            this.recognition.onend = () => {
                if (this.isRecording) {
                    // Automatically restart if still in recording state
                    try {
                        this.recognition.start();
                    } catch(e) {
                        this.stopRecording();
                    }
                } else {
                    this.stopRecording();
                }
            };

            this.recognition.start();
            this.logger.info('VoiceRecorder', 'Speech recording started');
        } catch(e) {
            this.logger.error('VoiceRecorder', 'Failed to start recording', e);
            this.stopRecording();
        }
    }

    stopRecording() {
        this.isRecording = false;
        if (this.recognition) {
            try { this.recognition.stop(); } catch(e) {}
            this.recognition = null;
        }
        if (this.activeBtn) {
            this.activeBtn.classList.remove('sx-recording');
            this.activeBtn.setAttribute('aria-label', 'Record voice memo');
            this.activeBtn.title = 'Ses kaydı başlat';
            this.activeBtn = null;
        }
        this.logger.info('VoiceRecorder', 'Speech recording stopped');
    }

    insertTextIntoPrompt(text) {
        try {
            const editor = document.querySelector('[contenteditable="true"]');
            if (editor) {
                editor.focus();
                // Use execCommand to preserve React / Lexical cursor and state
                document.execCommand('insertText', false, text);
            }
        } catch(e) {
            this.logger.error('VoiceRecorder', 'Error inserting recognized text', e);
        }
    }
}
