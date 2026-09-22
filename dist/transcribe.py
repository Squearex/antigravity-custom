import sys
import os
import json
import speech_recognition as sr

def main():
    if len(sys.argv) < 2:
        print(json.dumps({'ok': False, 'error': 'Missing audio file path'}))
        return

    wav_path = sys.argv[1]
    lang = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else 'tr-TR'

    if not os.path.exists(wav_path):
        print(json.dumps({'ok': False, 'error': 'File not found'}))
        return

    r = sr.Recognizer()
    try:
        with sr.AudioFile(wav_path) as source:
            audio = r.record(source)
        
        # Primary recognition in requested language (default tr-TR)
        try:
            text = r.recognize_google(audio, language=lang)
        except sr.UnknownValueError:
            # If not detected and lang was tr-TR, fallback to en-US
            if lang != 'en-US':
                try:
                    text = r.recognize_google(audio, language='en-US')
                except sr.UnknownValueError:
                    text = ''
            else:
                text = ''
        
        print(json.dumps({'ok': True, 'text': text}))
    except Exception as e:
        print(json.dumps({'ok': False, 'error': str(e)}))

if __name__ == '__main__':
    main()
