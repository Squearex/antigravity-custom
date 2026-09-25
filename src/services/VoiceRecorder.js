/**
 * SX Core SDK - VoiceRecorder
 * Bridges Antigravity native voice transcription system to Google Speech API:
 * - Native Antigravity iI hook captures microphone and audio processor
 * - Native Antigravity tz button & cEa 3-bar waveform visualizer
 * - Native Antigravity hI ghost-text renders interim words in light opacity (different color)
 * - FetchInterceptor handles ConnectRPC StreamAudioTranscription and streams Google Speech API results
 */
export class VoiceRecorder {
    constructor(logger) {
        this.logger = logger;
    }

    init() {
        window.__SX_VOICE_RECORDER__ = this;
        // Native Antigravity microphone system is fully enabled without click hijacking.
        // ConnectRPC calls (StreamAudioTranscription, SendAudioChunk, EndAudioSession)
        // are intercepted and fulfilled by FetchInterceptor with Google Speech Recognition.
        this.logger.info('VoiceRecorder', 'Native Antigravity voice transcription bridge active.');
    }
}
