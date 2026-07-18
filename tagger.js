/* =========================================================
   tagger.js
   Optional AI tagging for Chroma photos, via the Google Gemini API.
   Used by build-photos.js. Safe to omit — if no API key is set, the
   build simply skips AI tags and keeps the pixel-computed ones.

   Get a free key: https://aistudio.google.com/apikey
   Then set it before running the build:
     macOS/Linux :  export GEMINI_API_KEY=your_key_here
     Windows PS  :  $env:GEMINI_API_KEY = "your_key_here"

   Only the thumbnail is sent (small, fast, cheap). Results are cached
   in photos.json, so re-running never re-tags a photo already done.
   ========================================================= */

const fs = require('fs');

/* ---- controlled vocabulary (approved) ----
   AI may ONLY choose from this list. 'night' and 'black & white' are
   intentionally NOT here — those stay computed from pixels for consistency. */
const VOCAB = [
  // setting
  'sky', 'sea', 'beach', 'forest', 'park', 'mountain', 'water',
  'city', 'street', 'architecture', 'interior',
  // subject
  'people', 'portrait', 'crowd', 'animal', 'car', 'food', 'plant',
  // occasion / scene
  'wedding', 'concert', 'nightlife', 'festival', 'christmas', 'market', 'fairground',
  // light / treatment
  'silhouette', 'sunset', 'neon'
];

/* Model selection.
   Google retires/renames free models often, so instead of hard-coding one we
   ask the account which models it can actually use (ListModels) and pick the
   best available vision-capable Flash/Lite model. Override with GEMINI_MODEL. */
const MODELS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
// preference order: cheapest/highest-limit first, newest generations included.
// matched as substrings against whatever the account actually lists.
const MODEL_PREFERENCE = [
  'flash-lite-latest', 'flash-latest',
  '3.1-flash-lite', '3-flash-lite', '3.1-flash', '3-flash',
  '2.5-flash-lite', '2.5-flash'
];

let RESOLVED_MODEL = null;   // filled by resolveModel()

async function listModels() {
  const key = process.env.GEMINI_API_KEY;
  const res = await fetch(MODELS_ENDPOINT + '?key=' + key + '&pageSize=200');
  if (!res.ok) throw new Error('ListModels ' + res.status + ': ' + (await res.text()).slice(0, 160));
  const data = await res.json();
  return (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''));
}

async function resolveModel() {
  if (RESOLVED_MODEL) return RESOLVED_MODEL;

  // explicit override always wins
  if (process.env.GEMINI_MODEL) {
    RESOLVED_MODEL = process.env.GEMINI_MODEL;
    return RESOLVED_MODEL;
  }

  const available = await listModels();
  // exclude non-text models (image/tts/embedding/vision-preview-only variants)
  const usable = available.filter(n =>
    !/image|imagen|tts|embedding|aqa|learnlm|nano-banana|veo|lyria/i.test(n));

  for (const pref of MODEL_PREFERENCE) {
    const hit = usable.find(n => n.includes(pref));
    if (hit) { RESOLVED_MODEL = hit; return hit; }
  }
  // last resort: any Flash-ish model the account has
  const anyFlash = usable.find(n => /flash/i.test(n));
  if (anyFlash) { RESOLVED_MODEL = anyFlash; return anyFlash; }

  throw new Error('No usable generateContent model found on this account. '
    + 'Available: ' + available.join(', '));
}

const PROMPT =
  'You are tagging a photograph for a photography portfolio filter. ' +
  'Choose ONLY tags from this exact list that clearly and confidently apply:\n' +
  VOCAB.join(', ') + '\n\n' +
  'Rules:\n' +
  '- Use only tags from the list above. Never invent tags or synonyms.\n' +
  '- Pick the 2-5 that genuinely describe the photo. Fewer is better than wrong.\n' +
  '- "portrait" = one clearly posed/close person. "people" = people present. ' +
  '"crowd" = many people.\n' +
  '- Only "sea" for actual ocean/coast; use "water" for lakes/rivers/ponds.\n' +
  '- Respond with ONLY a JSON array of strings, e.g. ["forest","people"]. No prose.';

function isKeyPresent() {
  return !!process.env.GEMINI_API_KEY;
}

/* Tag one image (buffer of the thumbnail JPEG). Returns array of tags.
   Retries on 429 (rate limit) with exponential backoff. */
async function tagImage(jpegBuffer, opts) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return [];
  const maxRetries = (opts && opts.maxRetries != null) ? opts.maxRetries : 5;

  const body = {
    contents: [{
      parts: [
        { text: PROMPT },
        { inline_data: { mime_type: 'image/jpeg', data: jpegBuffer.toString('base64') } }
      ]
    }],
    generationConfig: { temperature: 0, maxOutputTokens: 100 }
  };

  let attempt = 0;
  const model = await resolveModel();
  const endpoint = MODELS_ENDPOINT + '/' + model + ':generateContent';
  for (;;) {
    const res = await fetch(endpoint + '?key=' + key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (res.status === 429) {
      if (attempt >= maxRetries) {
        throw new Error('rate limited (429) after ' + maxRetries + ' retries — daily quota may be exhausted');
      }
      // honour Retry-After if present, else exponential backoff w/ jitter
      const ra = parseFloat(res.headers.get('retry-after'));
      const waitMs = !isNaN(ra)
        ? ra * 1000
        : Math.min(60000, 2000 * Math.pow(2, attempt)) + Math.random() * 1000;
      await sleep(waitMs);
      attempt++;
      continue;
    }

    if (!res.ok) {
      const txt = await res.text();
      throw new Error('Gemini ' + res.status + ': ' + txt.slice(0, 160).replace(/\s+/g, ' '));
    }

    const data = await res.json();
    const parts = (((data.candidates || [])[0] || {}).content || {}).parts;
    const raw = (parts && parts[0] && parts[0].text) ? parts[0].text : '[]';
    return parseTags(raw);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* Pull a clean, vocabulary-constrained tag array out of the model reply. */
function parseTags(raw) {
  let arr = [];
  try {
    // strip code fences if present, grab the first [...] block
    const m = raw.replace(/```json|```/g, '').match(/\[[\s\S]*\]/);
    arr = m ? JSON.parse(m[0]) : [];
  } catch (e) {
    arr = [];
  }
  const allow = new Set(VOCAB);
  return Array.from(new Set(
    arr.map(t => String(t).toLowerCase().trim()).filter(t => allow.has(t))
  ));
}

module.exports = { VOCAB, isKeyPresent, tagImage, parseTags, resolveModel, listModels };
