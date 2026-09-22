const http = require('http');

http.get('http://127.0.0.1:61772/json', res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const targets = JSON.parse(data);
        const app = targets.find(t => t.url.includes('61774'));
        if (!app) return console.log('App not found');
        const ws = new WebSocket(app.webSocketDebuggerUrl);
        ws.onopen = () => {
            ws.send(JSON.stringify({
                id: 1,
                method: 'Runtime.evaluate',
                params: {
                    expression: `(() => {
                        return {
                            hasSpeechRec: 'SpeechRecognition' in window,
                            hasWebkitSpeechRec: 'webkitSpeechRecognition' in window,
                            hasAudioContext: 'AudioContext' in window,
                            hasMediaDevices: !!navigator.mediaDevices?.getUserMedia
                        };
                    })()`,
                    returnByValue: true
                }
            }));
        };
        ws.onmessage = (msg) => {
            console.log(JSON.stringify(JSON.parse(msg.data).result.result.value, null, 2));
            ws.close();
            process.exit(0);
        };
    });
});
