/**
 * SX Core SDK - StreamAdapter
 * Handles ConnectRPC/gRPC frame encoding and converts external SSE streams (OpenAI/Anthropic)
 * into native Antigravity binary frames with thought/reasoning extraction.
 */
export class StreamAdapter {
    static encodeFrame(flag, payloadU8) {
        const frame = new Uint8Array(5 + payloadU8.length);
        frame[0] = flag;
        frame[1] = (payloadU8.length >>> 24) & 0xff;
        frame[2] = (payloadU8.length >>> 16) & 0xff;
        frame[3] = (payloadU8.length >>> 8) & 0xff;
        frame[4] = payloadU8.length & 0xff;
        frame.set(payloadU8, 5);
        return frame;
    }

    static frameJSON(obj, flag = 0) {
        const jsonBytes = new TextEncoder().encode(JSON.stringify(obj));
        return StreamAdapter.encodeFrame(flag, jsonBytes);
    }

    static makeAGChunk(text, thought) {
        const part = thought ? { text, thought: true } : { text };
        return StreamAdapter.frameJSON({
            candidates: [{ content: { role: 'model', parts: [part] } }]
        });
    }

    static makeAGFinish() {
        return StreamAdapter.frameJSON({
            candidates: [{ content: { role: 'model', parts: [{ text: '' }] }, finishReason: 'STOP' }]
        });
    }

    static makeAGError(msg) {
        return StreamAdapter.frameJSON({
            error: { code: 500, message: msg }
        });
    }

    /**
     * Converts OpenAI or Anthropic streaming responses into Antigravity Connect protocol responses
     */
    static async directStream(provider, modelId, reqJson, reqContentType, origFetch) {
        const contents = reqJson?.contents || [];
        const systemInstruction = reqJson?.systemInstruction;
        const systemParts = systemInstruction?.parts || [];
        let systemText = systemParts.map(p => p.text || '').filter(Boolean).join('\n');

        const messages = [];
        for (const c of contents) {
            if (!c.parts || !Array.isArray(c.parts)) continue;
            const text = c.parts.map(p => p.text || '').join('');
            if (!text.trim()) continue;
            messages.push({ role: c.role === 'user' ? 'user' : 'assistant', content: text });
        }
        if (!messages.length) messages.push({ role: 'user', content: 'Hello' });

        const proto = (provider.protocol || 'openai').toLowerCase();
        let apiUrl, headers, body;

        if (proto === 'anthropic') {
            apiUrl = (provider.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '') + '/v1/messages';
            headers = {
                'Content-Type': 'application/json',
                'x-api-key': provider.apiKey || '',
                'anthropic-version': '2023-06-01',
            };
            body = JSON.stringify({
                model: modelId,
                max_tokens: 16000,
                stream: true,
                system: systemText || undefined,
                messages
            });
        } else {
            const cleanBase = (provider.baseUrl || 'https://api.openai.com/v1').replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '');
            apiUrl = cleanBase + '/chat/completions';
            headers = {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + (provider.apiKey || ''),
            };
            const oaMsgs = systemText ? [{ role: 'system', content: systemText }, ...messages] : messages;
            body = JSON.stringify({
                model: modelId,
                stream: true,
                messages: oaMsgs
            });
        }

        const apiResp = await origFetch(apiUrl, { method: 'POST', headers, body });
        if (!apiResp.ok) {
            const errTxt = await apiResp.text().catch(() => 'HTTP ' + apiResp.status);
            const errStream = new ReadableStream({
                start(ctrl) {
                    ctrl.enqueue(StreamAdapter.makeAGError(errTxt));
                    ctrl.close();
                }
            });
            return new Response(errStream, {
                status: 200,
                headers: { 'Content-Type': reqContentType || 'application/connect+json', 'Cache-Control': 'no-cache' }
            });
        }

        const isAnthropicProto = (proto === 'anthropic');
        const stream = new ReadableStream({
            async start(ctrl) {
                const reader = apiResp.body.getReader();
                const dec = new TextDecoder();
                let buf = '';
                let inThink = false;
                const send = (txt, thought) => ctrl.enqueue(StreamAdapter.makeAGChunk(txt, thought));

                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buf += dec.decode(value, { stream: true });
                        const lines = buf.split('\n');
                        buf = lines.pop();
                        for (const line of lines) {
                            if (!line.startsWith('data: ')) continue;
                            const raw = line.slice(6).trim();
                            if (raw === '[DONE]') continue;
                            try {
                                const ev = JSON.parse(raw);
                                if (isAnthropicProto) {
                                    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
                                        send(ev.delta.text, false);
                                    } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta') {
                                        send(ev.delta.thinking, true);
                                    } else if (ev.type === 'message_stop') {
                                        ctrl.enqueue(StreamAdapter.makeAGFinish());
                                    }
                                } else {
                                    const delta = (ev.choices || [{}])[0]?.delta || {};
                                    if (delta.reasoning_content) send(delta.reasoning_content, true);
                                    if (delta.content) {
                                        let txt = delta.content;
                                        while (txt) {
                                            if (inThink) {
                                                if (txt.includes('</think>')) {
                                                    const idx = txt.indexOf('</think>');
                                                    send(txt.slice(0, idx), true);
                                                    inThink = false;
                                                    txt = txt.slice(idx + 8);
                                                } else { send(txt, true); txt = ''; }
                                            } else {
                                                if (txt.includes('<think>')) {
                                                    const idx = txt.indexOf('<think>');
                                                    if (idx > 0) send(txt.slice(0, idx), false);
                                                    inThink = true;
                                                    txt = txt.slice(idx + 7);
                                                } else { send(txt, false); txt = ''; }
                                            }
                                        }
                                    }
                                    if ((ev.choices || [{}])[0]?.finish_reason) {
                                        ctrl.enqueue(StreamAdapter.makeAGFinish());
                                    }
                                }
                            } catch(e) {}
                        }
                    }
                } catch(e) {
                    ctrl.enqueue(StreamAdapter.makeAGError('Stream error: ' + e.message));
                }
                
                if ((reqContentType || '').includes('connect')) {
                    ctrl.enqueue(StreamAdapter.frameJSON({ flags: 0, metadata: {} }, 2));
                } else if ((reqContentType || '').includes('grpc')) {
                    ctrl.enqueue(StreamAdapter.frameJSON({ "grpc-status": "0", "grpc-message": "OK" }, 0x80));
                }
                ctrl.close();
            }
        });

        return new Response(stream, {
            status: 200,
            headers: { 'Content-Type': reqContentType || 'application/connect+json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' }
        });
    }
}
