// Spoken translation for ALL three languages on ANY device.
// The browser sends the translated sentence, this server asks Azure Speech for natural voice audio, and returns an MP3.
// Nothing is stored. Engine order:
//   1. Azure Speech (natural voices) if AZURE_SPEECH_KEY is set in .env
//   2. eSpeak NG (free, open source, offline, no account or card) if it is installed on this laptop
//   3. otherwise the app falls back to the browser's own voices
const express = require('express');
const { spawn, spawnSync } = require('child_process');
const activity = require('./activity');
const { verifyToken } = require('./routes');

const VOICES = {
  en: { locale: 'en-IN', name: 'en-IN-NeerjaNeural' },
  hi: { locale: 'hi-IN', name: 'hi-IN-SwaraNeural' },
  kn: { locale: 'kn-IN', name: 'kn-IN-SapnaNeural' }
};

const hits = new Map(); // simple per-user limit: 40 sentences per minute
function allowed(userId) {
  const now = Date.now();
  const list = (hits.get(userId) || []).filter((t) => now - t < 60000);
  if (list.length >= 40) return false;
  list.push(now); hits.set(userId, list);
  return true;
}

const xml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const azureOn = () => !!(process.env.AZURE_SPEECH_KEY && (process.env.AZURE_SPEECH_REGION || process.env.AZURE_SPEECH_ENDPOINT));

// ---- eSpeak NG (open source) ----
const ESPEAK_VOICE = { en: 'en-in', hi: 'hi', kn: 'kn' };
let espeakPath;            // undefined = not checked yet, null = not installed
function findEspeak() {
  if (espeakPath !== undefined) return espeakPath;
  const list = [process.env.ESPEAK_PATH, 'espeak-ng', 'C:\\Program Files\\eSpeak NG\\espeak-ng.exe', 'C:\\Program Files (x86)\\eSpeak NG\\espeak-ng.exe', '/opt/homebrew/bin/espeak-ng', '/usr/local/bin/espeak-ng', '/usr/bin/espeak-ng'].filter(Boolean);
  espeakPath = null;
  for (const c of list) {
    try { const r = spawnSync(c, ['--version'], { timeout: 4000 }); if (r.status === 0) { espeakPath = c; break; } } catch (e) {}
  }
  console.log(espeakPath ? `Voice: eSpeak NG found (${espeakPath})` : 'Voice: eSpeak NG not found, browser voices will be used');
  return espeakPath;
}
function espeakWav(text, lang) {
  return new Promise((resolve, reject) => {
    const p = spawn(findEspeak(), ['-v', ESPEAK_VOICE[lang], '-s', '145', '--stdin', '--stdout']);
    const out = []; const timer = setTimeout(() => { p.kill(); reject(new Error('timeout')); }, 10000);
    p.stdout.on('data', (d) => out.push(d));
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code) => { clearTimeout(timer); const b = Buffer.concat(out); code === 0 && b.length > 100 ? resolve(b) : reject(new Error('espeak failed')); });
    p.stdin.on('error', () => {});
    p.stdin.end(text, 'utf8');
  });
}
const engine = () => (azureOn() ? 'azure' : findEspeak() ? 'espeak' : null);
const configured = () => engine() !== null;

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const user = verifyToken(h.startsWith('Bearer ') ? h.slice(7) : '');
  if (!user) return res.status(401).json({ error: 'Please log in again.' });
  req.user = user; next();
}

const router = express.Router();

router.get('/tts/status', auth, (req, res) => res.json({ enabled: configured(), engine: engine() }));

router.post('/tts', auth, express.json({ limit: '10kb' }), async (req, res) => {
  if (!configured()) return res.status(503).json({ error: 'Voice service is not set up.' });
  const { text, lang } = req.body || {};
  const v = VOICES[lang];
  const clean = String(text || '').trim().slice(0, 400);
  if (!v || !clean) return res.status(400).json({ error: 'Invalid voice request.' });
  if (!allowed(req.user.id)) return res.status(429).json({ error: 'Too many voice requests. Please wait a moment.' });

  if (engine() === 'espeak') {
    try {
      const wav = await espeakWav(clean, lang);
      activity.log('Voice', `Spoken translation made with open-source eSpeak NG (${lang}, ${clean.length} characters, audio not stored)`, 'translate');
      res.setHeader('Content-Type', 'audio/wav'); res.setHeader('Cache-Control', 'no-store');
      return res.send(wav);
    } catch (e) {
      activity.log('Voice', 'eSpeak NG failed. Browser voice will be used instead', 'translate');
      return res.status(502).json({ error: 'Voice engine error.' });
    }
  }

  const endpoint = process.env.AZURE_SPEECH_ENDPOINT || `https://${process.env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const ssml = `<speak version='1.0' xml:lang='${v.locale}'><voice xml:lang='${v.locale}' name='${v.name}'>${xml(clean)}</voice></speak>`;
  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': process.env.AZURE_SPEECH_KEY,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'pulscare-prototype'
      },
      body: ssml,
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) {
      activity.log('Voice', `Voice service returned ${r.status}. Browser voice will be used instead`, 'translate');
      return res.status(502).json({ error: 'Voice service error.' });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    activity.log('Voice', `Spoken translation made (${lang}, ${clean.length} characters, audio not stored)`, 'translate');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buf);
  } catch (e) {
    activity.log('Voice', 'Voice service unreachable. Browser voice will be used instead', 'translate');
    res.status(502).json({ error: 'Voice service unreachable.' });
  }
});

module.exports = { router };