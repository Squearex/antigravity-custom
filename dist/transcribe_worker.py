import sys
import os
import json
import speech_recognition as sr

def main():
    r = sr.Recognizer()
    # Ready signal to parent process
    sys.stdout.write(json.dumps({"ready": True}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            wav_path = req.get("file", "")
            lang = req.get("lang", "tr-TR")

            if not os.path.exists(wav_path):
                sys.stdout.write(json.dumps({"ok": False, "error": "File not found"}) + "\n")
                sys.stdout.flush()
                continue

            with sr.AudioFile(wav_path) as source:
                audio = r.record(source)

            text = ""
            try:
                text = r.recognize_google(audio, language=lang)
            except sr.UnknownValueError:
                text = ""
            except Exception as ex:
                sys.stdout.write(json.dumps({"ok": False, "error": str(ex)}) + "\n")
                sys.stdout.flush()
                continue

            sys.stdout.write(json.dumps({"ok": True, "text": text}) + "\n")
            sys.stdout.flush()
        except Exception as e:
            sys.stdout.write(json.dumps({"ok": False, "error": str(e)}) + "\n")
            sys.stdout.flush()

if __name__ == "__main__":
    main()
