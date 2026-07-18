#!/usr/bin/env node
/* =========================================================
   build-photos.js
   Reads every image in images/chroma/, extracts colour data,
   generates web-sized thumbnails, auto-tags (pixel + optional AI),
   and writes photos.json — sorted rainbow-by-hue.

   Run:  node build-photos.js
   Needs: npm install sharp

   Optional AI tagging (Google Gemini, free tier):
     get a key at https://aistudio.google.com/apikey
     macOS/Linux :  export GEMINI_API_KEY=your_key
     Windows PS  :  $env:GEMINI_API_KEY = "your_key"
   Without a key, AI tagging is skipped and pixel tags still work.

   Re-running is safe:
     - manual tags you added in photos.json are PRESERVED
     - AI tags are CACHED — a photo already tagged is not re-sent
     - thumbnails are only regenerated if missing
   ========================================================= */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const tagger = require('./tagger');

const CHROMA_DIR  = path.join(__dirname, 'images', 'chroma');
const THUMB_DIR   = path.join(CHROMA_DIR, 'thumbs');
const OUT_FILE    = path.join(__dirname, 'photos.json');
const EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
const THUMB_WIDTH = 900;
const FORCE_RETAG = process.argv.includes('--retag');
// pace requests to stay under the free-tier RPM ceiling (Flash-Lite = 15/min).
// ~4.2s between calls => ~14/min, comfortably under the limit.
const AI_DELAY_MS = Number(process.env.AI_DELAY_MS || 4200);

/* ---------- colour helpers ---------- */

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s, l };
}

// average colour by averaging a small raw buffer (correct averaging)
async function colourStats(file) {
  const size = 32;
  const { data, info } = await sharp(file)
    .resize(size, size, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  let rs = 0, gs = 0, bs = 0, n = 0, peak = 0;
  for (let i = 0; i < data.length; i += ch) {
    rs += data[i]; gs += data[i + 1]; bs += data[i + 2]; n++;
    const { s } = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (s > peak) peak = s;
  }
  const avg = rgbToHsl(rs / n, gs / n, bs / n);
  return { hsl: avg, peak };
}

/* ---------- pixel-based auto tags (consistent, no AI) ---------- */
function pixelTags(hsl, peak) {
  const t = [];
  if (peak < 0.10) t.push('black & white');
  if (hsl.l < 0.18 && peak < 0.45) t.push('night');
  if (hsl.l > 0.78) t.push('bright');
  return t;
}

/* ---------- main ---------- */
async function main() {
  if (!fs.existsSync(CHROMA_DIR)) {
    console.error('No images/chroma/ folder found. Create it and add photos.');
    process.exit(1);
  }
  if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR, { recursive: true });

  // load previous manifest: preserve manual tags AND cache AI tags
  const prev = {};
  if (fs.existsSync(OUT_FILE)) {
    try {
      JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')).photos
        .forEach(p => { prev[p.src] = p; });
      console.log('Found photos.json — preserving manual tags and cached AI tags.');
    } catch (e) { console.warn('Could not parse existing photos.json, starting fresh.'); }
  }

  const aiOn = tagger.isKeyPresent();
  if (aiOn) {
    try {
      const model = await tagger.resolveModel();
      console.log(FORCE_RETAG
        ? `AI tagging: ON — model "${model}", --retag -> re-tagging ALL photos.`
        : `AI tagging: ON — model "${model}". New/untagged photos will be sent; done ones cached.`);
    } catch (e) {
      console.error('AI tagging: could not select a model — ' + e.message);
      console.error('Pixel tags will still be written. Set GEMINI_MODEL to override.');
    }
  } else {
    console.log('AI tagging: OFF (no GEMINI_API_KEY). Pixel tags only.');
  }

  const files = fs.readdirSync(CHROMA_DIR)
    .filter(f => EXTS.has(path.extname(f).toLowerCase())).sort();
  if (!files.length) { console.error('No images in images/chroma/.'); process.exit(1); }

  const photos = [];
  let aiCalls = 0;

  for (const f of files) {
    const abs = path.join(CHROMA_DIR, f);
    const src = 'images/chroma/' + f;
    const old = prev[src];
    try {
      const meta = await sharp(abs).metadata();
      const { hsl, peak } = await colourStats(abs);

      // thumbnail (skip if it already exists)
      let thumb = src;
      const thumbName = path.parse(f).name + '.jpg';
      const thumbPath = path.join(THUMB_DIR, thumbName);
      if (meta.width > THUMB_WIDTH) {
        if (!fs.existsSync(thumbPath)) {
          await sharp(abs).resize(THUMB_WIDTH)
            .jpeg({ quality: 78, mozjpeg: true }).toFile(thumbPath);
        }
        thumb = 'images/chroma/thumbs/' + thumbName;
      }

      const pix = pixelTags(hsl, peak);

      // AI tags: reuse cached only if a prior run actually completed tagging
      // for this photo (_aiDone). An empty _ai from a real run is respected;
      // a missing flag means "never tagged" -> call Gemini. --retag forces all.
      const cached = !FORCE_RETAG && old && old._aiDone === true;
      let aiTags = cached ? (old._ai || []) : null;
      let aiDone = cached;
      if (aiTags === null && aiOn) {
        try {
          const buf = fs.existsSync(thumbPath)
            ? fs.readFileSync(thumbPath)
            : await sharp(abs).resize(THUMB_WIDTH).jpeg({ quality: 78 }).toBuffer();
          aiTags = await tagImage(buf);
          aiDone = true;
          aiCalls++;
          process.stdout.write('*');           // '*' = AI-tagged this run
          // pace to stay under the free-tier RPM ceiling
          if (AI_DELAY_MS > 0) await sleep(AI_DELAY_MS);
        } catch (e) {
          console.warn(`\n  AI tag failed for ${f}: ${e.message}`);
          aiTags = [];
          aiDone = false;                        // allow retry next run
        }
      }
      if (aiTags === null) aiTags = [];

      // manual tags = anything the user added that wasn't auto/ai
      const priorAuto = old ? [].concat(old._auto || [], old._ai || []) : [];
      const manual = old && old.tags
        ? old.tags.filter(t => !priorAuto.includes(t))
        : [];

      const tags = Array.from(new Set([...pix, ...aiTags, ...manual]));
      const alt = (old && old.alt) || '';
      // 'feature' is a manual flag you set in photos.json to make a photo
      // large (true) or small (false) in the gallery. Preserved on rebuild.
      const feature = (old && old.feature !== undefined) ? old.feature : undefined;

      photos.push({
        src, thumb,
        w: meta.width, h: meta.height,
        hue: Math.round(hsl.h),
        light: +hsl.l.toFixed(3),
        sat: +hsl.s.toFixed(3),
        peakSat: +peak.toFixed(3),
        bw: peak < 0.10,
        alt,
        ...(feature !== undefined ? { feature } : {}),
        tags,
        _auto: pix,        // internal: pixel tags
        _ai: aiTags,       // internal: cached AI tags
        _aiDone: aiDone    // internal: did AI tagging actually complete?
      });
      if (cached || !aiOn) process.stdout.write('.');

      // save progress every 10 AI calls so a mid-run quota cutoff isn't lost
      if (aiDone && !cached && aiCalls % 10 === 0) {
        writeManifest(photos.slice(), false);
      }
    } catch (e) {
      console.warn(`\nSkipped ${f}: ${e.message}`);
    }
  }

  writeManifest(photos, true);

  console.log(`\n\nWrote ${OUT_FILE}`);
  console.log(`  ${photos.length} photos, sorted rainbow-by-hue.`);
  console.log(`  AI calls this run: ${aiCalls} (rest cached or AI off).`);
  const vocab = Array.from(new Set(photos.flatMap(p => p.tags))).sort();
  console.log(`  Tags in use: ${vocab.join(', ') || '(none yet)'}`);
  console.log(`\nSkim photos.json to fix any AI mistakes, then add extra`);
  console.log(`tags by hand if you like. Re-run anytime — nothing re-tags twice.`);
}

// write photos.json. `final` sorts; incremental saves keep insertion order.
function writeManifest(photos, final) {
  const list = photos.slice();
  if (final) {
    list.sort((a, b) => {
      if (a.bw && b.bw) return a.light - b.light;
      if (a.bw) return 1;
      if (b.bw) return -1;
      if (a.hue !== b.hue) return a.hue - b.hue;
      return a.light - b.light;
    });
  }
  const vocab = Array.from(new Set(list.flatMap(p => p.tags))).sort();
  fs.writeFileSync(OUT_FILE, JSON.stringify({
    generated: new Date().toISOString(),
    count: list.length,
    tags: vocab,
    photos: list
  }, null, 2));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// bring tagImage into scope
const { tagImage } = tagger;
main();
