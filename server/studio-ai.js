import WebSocket from 'ws';
import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';

export const introVoices = ['marin', 'cedar', 'coral', 'sage'];
export const voiceDisclosure = 'This introduction uses an AI-generated voice.';
const unavailable = () => Object.assign(new Error('Intro generation is unavailable. Ask the administrator to check the voice service configuration.'), { status: 503 });

// A short, server-only Realtime session. No retries: an uncertain failure may
// already have incurred provider usage. Keep partial audio out of the library.
export function generateIntro({ instructions, text, voice = 'marin', audio = false, userId }, { apiKey = process.env.OPENAI_API_KEY, Socket = WebSocket, timeout = 120000, extraCAFile = process.env.NODE_EXTRA_CA_CERTS } = {}) {
  if (!apiKey) return Promise.reject(unavailable());
  return new Promise((resolve, reject) => {
    // Node initializes trust before --env-file loads NODE_EXTRA_CA_CERTS.
    // Honor that explicit local bundle here while retaining the normal roots.
    let ca;
    try { if (extraCAFile) ca = [...rootCertificates, readFileSync(extraCAFile, 'utf8')]; }
    catch { reject(unavailable()); return; }
    const socket = new Socket('wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1-mini', {
      ...(ca ? { ca } : {}),
      headers: { Authorization: `Bearer ${apiKey}`, 'OpenAI-Safety-Identifier': userId },
      handshakeTimeout: 15000, maxPayload: 1024 * 1024,
    });
    const chunks = [];
    let bytes = 0, output = '', settled = false, requested = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.close();
      if (error) reject(unavailable()); else resolve(value);
    };
    const timer = setTimeout(() => { finish(true); socket.terminate(); }, timeout);
    const send = event => socket.send(JSON.stringify(event));
    socket.on('message', raw => {
      try {
        const event = JSON.parse(raw.toString());
        if (event.type === 'session.created') send({ type: 'session.update', session: {
          type: 'realtime', output_modalities: [audio ? 'audio' : 'text'], instructions,
          audio: { input: { turn_detection: null }, output: { format: { type: 'audio/pcm', rate: 24000 }, voice } },
        } });
        if (event.type === 'session.updated' && !requested) {
          requested = true;
          send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
          send({ type: 'response.create', response: { output_modalities: [audio ? 'audio' : 'text'], max_output_tokens: audio ? 3000 : 400 } });
        }
        if (event.type === 'response.output_audio.delta') {
          const chunk = Buffer.from(event.delta, 'base64'); bytes += chunk.length;
          if (bytes > 6 * 1024 * 1024) return finish(true);
          chunks.push(chunk);
        }
        if (event.type === 'response.output_text.delta') { output += event.delta; if (output.length > 6000) return finish(true); }
        if (event.type === 'error') return finish(true);
        if (event.type === 'response.done') {
          if (event.response?.status !== 'completed' || (audio ? !bytes || bytes % 2 : !output.trim())) return finish(true);
          finish(false, audio ? Buffer.concat(chunks) : output.trim());
        }
      } catch { finish(true); }
    });
    socket.on('error', () => finish(true));
    socket.on('close', () => { if (!settled) finish(true); });
  });
}
