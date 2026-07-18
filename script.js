/* =========================================================
   Harigovind Sajimon — portfolio behaviour
   Plain vanilla JS. No framework, no build step.
   Replaces the Claude Design <x-dc> runtime entirely.
   ========================================================= */

(function () {
  'use strict';

  var body    = document.body;
  var stage   = document.getElementById('stage');
  var buttons = document.querySelectorAll('[data-mode-btn]');

  /* read the transition duration from CSS so JS + CSS stay in sync */
  function transitionMs() {
    var raw = getComputedStyle(body).getPropertyValue('--dur').trim(); // e.g. "600ms"
    var n = parseFloat(raw);
    return isNaN(n) ? 600 : n;
  }

  var blurTimer = null;
  /* assigned later once the rail is set up; called after a mode switch
     since the rail's dimensions only exist while its panel is visible */
  var layoutRail = null;
  var onRailScroll = null;

  function switchTo(mode) {
    if (mode === body.getAttribute('data-mode')) return;

    /* set the mode — CSS variables + panel visibility follow automatically */
    body.setAttribute('data-mode', mode);

    /* update the switch buttons' selected state */
    buttons.forEach(function (btn) {
      btn.setAttribute('aria-selected', String(btn.dataset.modeBtn === mode));
    });

    /* fire the mid-transition blur on the content wrapper */
    clearTimeout(blurTimer);
    stage.classList.remove('is-switching');
    /* force reflow so the animation restarts even on rapid toggles */
    void stage.offsetWidth;
    stage.classList.add('is-switching');
    blurTimer = setTimeout(function () {
      stage.classList.remove('is-switching');
    }, transitionMs() + 60);

    if (mode === 'read' && layoutRail) { layoutRail(); onRailScroll(); }
  }

  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      switchTo(btn.dataset.modeBtn);
    });
  });

  /* ---------- Forge: cars gallery + alphabet ----------
     Reads forge.json. Cars is a mixed gallery of images and looping videos.
     Alphabet cells show a thumbnail, play their video on hover, and open it
     in the Forge lightbox on click. Videos are muted (required for autoplay),
     load lazily (preload="none") so the page stays fast, and fall back to
     tap-to-play on touch devices where hover doesn't exist. */
  var carsGrid = document.getElementById('forgeCars');
  var glyphGrid = document.getElementById('glyphGrid');
  var isTouch = window.matchMedia('(hover: none)').matches;

  if (carsGrid || glyphGrid) {
    fetch('forge.json')
      .then(function (r) { return r.json(); })
      .then(function (d) { initForge(d); })
      .catch(function (e) { console.warn('Forge: could not load forge.json', e); });
  }

  function initForge(data) {
    if (carsGrid && data.cars) buildCars(data.cars);
    if (glyphGrid && data.alphabet) buildAlphabet(data.alphabet);
  }

  function playSafe(video) {
    var p = video.play();
    if (p && p.catch) p.catch(function () {});   // ignore autoplay rejections
  }

  /* Ambient car videos play only while visible. This prevents many videos
     playing at once (which browsers throttle, causing the random-pause bug)
     and saves battery on mobile. The lightbox pauses all of these while open. */
  var ambientObserver = ('IntersectionObserver' in window)
    ? new IntersectionObserver(function (entries) {
        // if the lightbox is open, leave everything paused
        var lbOpen = flb && flb.classList.contains('is-open');
        entries.forEach(function (en) {
          var v = en.target;
          if (en.isIntersecting && !lbOpen) playSafe(v);
          else v.pause();
        });
      }, { threshold: 0.25 })
    : null;

  function observeAmbient(v) {
    if (ambientObserver) ambientObserver.observe(v);
    else playSafe(v);   // no observer support: fall back to plain play
  }

  function buildCars(cars) {
    var frag = document.createDocumentFragment();
    cars.forEach(function (item, i) {
      var cell = document.createElement('button');
      cell.type = 'button';
      var shape = item.shape || 'landscape';
      cell.className = 'fcar fcar--' + shape;
      cell.setAttribute('aria-label', item.alt || 'Car work');

      if (item.type === 'video' && item.video) {
        var v = document.createElement('video');
        v.src = item.video;
        if (item.poster) v.poster = item.poster;   // optional, usually omitted
        v.muted = true; v.loop = true; v.playsInline = true;
        v.setAttribute('playsinline', '');
        v.setAttribute('data-ambient', '');        // ambient loop (resumes after lightbox)
        v.preload = 'metadata';
        // NOT autoplay — an observer plays it only while it's on screen, so we
        // never have many videos competing (the cause of random pausing) and we
        // save battery/bandwidth on mobile.
        v.className = 'fcar__media';
        if (item.focus) v.style.objectPosition = item.focus;
        cell.appendChild(v);
        cell.dataset.video = item.video;
        observeAmbient(v);
      } else if (item.type === 'image' && item.image) {
        var img = document.createElement('img');
        img.src = item.image; img.alt = item.alt || '';
        img.loading = 'lazy'; img.className = 'fcar__media';
        if (item.focus) img.style.objectPosition = item.focus;
        // a missing image falls back to the cell tint instead of a broken icon
        img.addEventListener('error', function () { img.style.display = 'none'; });
        cell.appendChild(img);
        // images are their own content — they do NOT open a video
      }

      // only video cells open the lightbox
      if (cell.dataset.video) {
        cell.addEventListener('click', function () {
          openForgeLightbox(cell.dataset.video, item.alt || '');
        });
      } else {
        cell.style.cursor = 'default';
      }
      frag.appendChild(cell);
    });
    carsGrid.innerHTML = '';
    carsGrid.appendChild(frag);
  }

  function buildAlphabet(letters) {
    var frag = document.createDocumentFragment();
    letters.forEach(function (L) {
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'glyph';
      cell.setAttribute('aria-label', 'Letter ' + L.char + ' — 3D animation');
      cell.dataset.video = L.video || '';

      // thumbnail (always present, shown at rest)
      var img = document.createElement('img');
      img.src = L.image; img.alt = L.char;
      img.loading = 'lazy'; img.className = 'glyph__thumb';
      // if a still is missing (e.g. no c.jpg), hide the broken image so the
      // cell's tint shows instead — hover video and label still work
      img.addEventListener('error', function () { img.style.display = 'none'; });
      cell.appendChild(img);

      // hover video (created lazily on first hover so 26 videos don't preload)
      var vid = null;
      function ensureVideo() {
        if (vid || !L.video) return;
        vid = document.createElement('video');
        vid.src = L.video;
        vid.muted = true; vid.loop = true; vid.playsInline = true;
        vid.setAttribute('playsinline', '');
        vid.preload = 'auto';
        vid.className = 'glyph__video';
        cell.appendChild(vid);
        vid.load();                        // kick off loading so play() works
      }

      if (!isTouch) {
        cell.addEventListener('mouseenter', function () {
          ensureVideo();
          if (vid) { cell.classList.add('is-playing'); playSafe(vid); }
        });
        cell.addEventListener('mouseleave', function () {
          if (vid) { cell.classList.remove('is-playing'); vid.pause(); vid.currentTime = 0; }
        });
      }

      // click opens the full video in the Forge lightbox
      cell.addEventListener('click', function () {
        if (L.video) openForgeLightbox(L.video, 'Letter ' + L.char);
      });

      // small char label overlay so the grid still reads as an alphabet
      var tag = document.createElement('span');
      tag.className = 'glyph__char';
      tag.textContent = L.char;
      cell.appendChild(tag);

      frag.appendChild(cell);
    });
    glyphGrid.innerHTML = '';
    glyphGrid.appendChild(frag);
  }

  /* ---------- Forge lightbox (video player, separate from Chroma) ---------- */
  var flb = document.getElementById('forgeLightbox');
  var flbVideo = flb && document.getElementById('forgeLightboxVideo');
  var flbCap = flb && document.getElementById('forgeLightboxCap');

  function allCellVideos() {
    return Array.prototype.slice.call(
      document.querySelectorAll('.fcar video, .glyph video')
    );
  }

  function openForgeLightbox(src, caption) {
    if (!flb) return;
    // pause every background cell video so nothing competes with the lightbox
    // (competing videos are what caused the random pausing, esp. on mobile)
    allCellVideos().forEach(function (v) { v.pause(); });

    flbVideo.src = src;
    flbVideo.muted = false;          // sound on when explicitly opened
    flbCap.textContent = caption || '';
    flb.classList.add('is-open');
    flb.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    playSafe(flbVideo);
  }
  function closeForgeLightbox() {
    if (!flb) return;
    flbVideo.pause();
    flbVideo.removeAttribute('src');
    flbVideo.load();
    flb.classList.remove('is-open');
    flb.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    // resume the ambient car loops that were playing at rest
    allCellVideos().forEach(function (v) {
      if (v.hasAttribute('data-ambient')) playSafe(v);
    });
  }
  if (flb) {
    document.getElementById('forgeLightboxClose').addEventListener('click', closeForgeLightbox);
    flb.addEventListener('click', function (e) { if (e.target === flb) closeForgeLightbox(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && flb.classList.contains('is-open')) closeForgeLightbox();
    });
  }


  /* ---------- Chroma: photo field + tag filters ----------
     Reads photos.json (built by build-photos.js / build-photos.ps1) and
     renders one tile per photo plus a tag-filter chip row. Tile width
     follows each photo's real aspect ratio via the --ar custom property;
     see .chroma__field / .tile in styles.css. */
  var chromaField   = document.getElementById('chromaField');
  var chromaFilters = document.getElementById('chromaFilters');
  var chromaCaption = document.getElementById('chromaCaption');

  if (chromaField) {
    fetch('photos.json')
      .then(function (res) { return res.json(); })
      .then(function (data) { initChroma(data); })
      .catch(function (err) { console.warn('Chroma: could not load photos.json', err); });
  }

  function initChroma(data) {
    var photos = (data && data.photos) || [];
    if (!photos.length) return;

    var activeTags = new Set();

    var frag = document.createDocumentFragment();
    photos.forEach(function (p, i) {
      var tile = document.createElement('div');
      tile.className = 'tile';
      tile.style.setProperty('--hue', (p.hue != null ? p.hue : 240));
      if (p.bw) tile.classList.add('is-bw');       // no hue tint for greyscale

      /* Gapless justified grid (like the reference). Each tile spans grid cells
         based on its orientation so tall/wide/large tiles interlock and dense
         packing leaves NO holes:
           portrait  -> 1 col x 2 rows (tall)
           landscape -> 2 col x 1 row  (wide)
           square-ish-> 1 x 1
         A deterministic slice of photos become 2x2 "feature" tiles for rhythm.
         Seeded from the index so the layout is stable across reloads. */
      var seed = (i * 2654435761) % 4294967296;
      var r = (seed % 1000) / 1000;                 // 0..1, stable per photo
      var ratio = (p.w && p.h) ? (p.w / p.h) : 1;

      var cw = 1, ch = 1;
      var forceFeature = (p.feature === true);
      var forceMinor = (p.feature === false);

      if (forceFeature) {
        cw = 2; ch = 2;                              // hero
      } else if (forceMinor) {
        cw = 1; ch = 1;                              // small
      } else if (ratio >= 1.35) {
        // landscape: mostly wide (2x1), but a good share stay 1x1 so the grid
        // has enough single-width tiles to backfill holes (gapless packing)
        if (r < 0.55) { cw = 2; ch = 1; }
        else if (r < 0.65) { cw = 2; ch = 2; }       // occasional big landscape
        else { cw = 1; ch = 1; }
      } else if (ratio <= 0.72) {
        // portrait: mostly tall (1x2), some 1x1
        if (r < 0.6) { cw = 1; ch = 2; }
        else if (r < 0.68) { cw = 2; ch = 2; }       // occasional big portrait
        else { cw = 1; ch = 1; }
      } else {
        cw = 1; ch = 1;                             // square-ish
        if (r < 0.08) { cw = 2; ch = 2; }           // rare square feature
      }

      tile.style.setProperty('--cw', cw);
      tile.style.setProperty('--ch', ch);
      if (forceFeature) tile.classList.add('is-feature');

      tile.dataset.tags = (p.tags || []).join('|');
      tile.dataset.index = i;
      tile.setAttribute('role', 'button');
      tile.setAttribute('tabindex', '0');
      var lbl = (p.tags && p.tags.length) ? p.tags.slice(0, 2).join(' · ') : 'photograph';
      tile.setAttribute('aria-label', 'Open photograph: ' + lbl);

      var img = document.createElement('img');
      img.src = p.thumb || p.src;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = p.alt || ('Chroma photograph' + (p.tags && p.tags.length ? ', ' + p.tags.join(', ') : ''));
      img.addEventListener('load', function () { this.classList.add('is-loaded'); });
      tile.appendChild(img);


      if (p.tags && p.tags.length) {
        var cap = document.createElement('span');
        cap.className = 'tile__cap';
        cap.textContent = p.tags.slice(0, 2).join(' · ');
        tile.appendChild(cap);
      }

      tile.addEventListener('click', function () { openLightbox(i); });
      tile.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLightbox(i); }
      });

      frag.appendChild(tile);
    });
    chromaField.appendChild(frag);
    var tiles = chromaField.querySelectorAll('.tile');

    initLightbox(photos, function () { return activeTags; });

    /* tag chips, built from the manifest's vocabulary, with live counts */
    if (chromaFilters && data.tags && data.tags.length) {
      var counts = {};
      data.tags.forEach(function (t) { counts[t] = 0; });
      photos.forEach(function (p) {
        (p.tags || []).forEach(function (t) { if (counts[t] !== undefined) counts[t]++; });
      });

      var allChip = document.createElement('button');
      allChip.type = 'button';
      allChip.className = 'chip';
      allChip.textContent = 'All (' + photos.length + ')';
      allChip.setAttribute('aria-pressed', 'true');
      allChip.addEventListener('click', function () {
        activeTags.clear();
        applyFilter();
      });
      chromaFilters.appendChild(allChip);

      data.tags.forEach(function (tag) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'chip';
        chip.textContent = tag + ' (' + counts[tag] + ')';
        chip.dataset.tag = tag;
        chip.setAttribute('aria-pressed', 'false');
        chip.addEventListener('click', function () {
          if (activeTags.has(tag)) activeTags.delete(tag); else activeTags.add(tag);
          applyFilter();
        });
        chromaFilters.appendChild(chip);
      });
    }

    function applyFilter() {
      var chips = chromaFilters ? chromaFilters.querySelectorAll('.chip') : [];
      chips.forEach(function (chip) {
        var pressed = chip.dataset.tag ? activeTags.has(chip.dataset.tag) : activeTags.size === 0;
        chip.setAttribute('aria-pressed', String(pressed));
      });

      var visible = 0;
      tiles.forEach(function (tile) {
        var tags = tile.dataset.tags ? tile.dataset.tags.split('|') : [];
        var show = activeTags.size === 0 || tags.some(function (t) { return activeTags.has(t); });
        tile.classList.toggle('is-hidden', !show);
        tile.style.width = '';
        if (show) visible++;
      });


      if (chromaCaption) {
        chromaCaption.textContent = activeTags.size === 0
          ? 'Sorted by hue, not by date'
          : visible + ' of ' + photos.length + ' — sorted by hue';
      }
    }
  }

  /* ---------- Chroma lightbox (full-size popup) ---------- */
  var lb = document.getElementById('lightbox');
  var lbImg = lb && document.getElementById('lightboxImg');
  var lbCap = lb && document.getElementById('lightboxCap');
  var lbCount = lb && document.getElementById('lightboxCount');
  var lbPhotos = [];
  var lbGetActiveTags = function () { return new Set(); };
  var lbList = [];
  var lbPos = 0;

  function initLightbox(photos, getActiveTags) {
    lbPhotos = photos;
    if (getActiveTags) lbGetActiveTags = getActiveTags;
  }
  function lbBuildList() {
    var active = lbGetActiveTags();
    lbList = [];
    lbPhotos.forEach(function (p, i) {
      var tags = p.tags || [];
      if (!active || active.size === 0 || tags.some(function (t) { return active.has(t); })) {
        lbList.push(i);
      }
    });
  }
  function openLightbox(photoIndex) {
    if (!lb) return;
    lbBuildList();
    lbPos = lbList.indexOf(photoIndex);
    if (lbPos < 0) lbPos = 0;
    showLightbox();
    lb.classList.add('is-open');
    lb.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
  function showLightbox() {
    var p = lbPhotos[lbList[lbPos]];
    if (!p) return;
    lbImg.src = p.src || p.thumb;
    lbImg.alt = p.alt || (p.tags || []).join(', ');
    lbCap.textContent = (p.tags || []).join(' · ');
    lbCount.textContent = (lbPos + 1) + ' / ' + lbList.length;
  }
  function closeLightbox() {
    lb.classList.remove('is-open');
    lb.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  function lbNext() { lbPos = (lbPos + 1) % lbList.length; showLightbox(); }
  function lbPrev() { lbPos = (lbPos - 1 + lbList.length) % lbList.length; showLightbox(); }

  if (lb) {
    document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
    document.getElementById('lightboxNext').addEventListener('click', lbNext);
    document.getElementById('lightboxPrev').addEventListener('click', lbPrev);
    lb.addEventListener('click', function (e) { if (e.target === lb) closeLightbox(); });
    document.addEventListener('keydown', function (e) {
      if (!lb.classList.contains('is-open')) return;
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowRight') lbNext();
      else if (e.key === 'ArrowLeft') lbPrev();
    });
  }

  /* ---------- Project data ----------
     Sourced from github.com/heli0hari/portfolio (script.js `projects` array),
     condensed for this site's lighter-weight modal. */
  /* Project case studies are loaded from projects.json (ported from the old
     portfolio). Rendered by renderBlocks() into the instrument-panel language. */
  var projectData = {};
  fetch('projects.json')
    .then(function (r) { return r.json(); })
    .then(function (d) { projectData = d; })
    .catch(function (e) { console.warn('[projects]', e.message); });

  /* ---------- Project detail modal ---------- */
  var modal = document.getElementById('projectModal');
  var modalPanel      = modal && modal.querySelector('.project-modal__panel');
  var modalScroll      = modal && modal.querySelector('.project-modal__scroll');
  var modalPlate       = document.getElementById('projectModalPlate');
  var modalPlateLabel  = document.getElementById('projectModalPlateLabel');
  var modalMeta        = document.getElementById('projectModalMeta');
  var modalTitle       = document.getElementById('projectModalTitle');
  var modalDesc        = document.getElementById('projectModalDesc');
  var modalTags        = document.getElementById('projectModalTags');
  var modalContent     = document.getElementById('projectModalContent');
  var modalLastFocused = null;

  function modalFocusables() {
    return modalPanel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  }

  function onModalKeydown(e) {
    if (e.key === 'Escape' || e.key === 'Esc') { closeProject(); return; }
    if (e.key !== 'Tab') return;
    var els = modalFocusables();
    if (!els.length) return;
    var first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }


  /* ---------- Case study block renderer ----------
     Renders the ported content blocks in the site's instrument-panel language:
     rounded cards, hairline borders, tiny uppercase labels, generous padding. */
  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.innerHTML = text;
    return e;
  }

  function renderBlocks(blocks, into) {
    into.innerHTML = '';
    into.classList.add('cs');       // keep the element's existing classes
    (blocks || []).forEach(function (b) {
      var v = b.value;
      var node = null;

      switch (b.type) {
        case 'heading': {
          node = mk('h2');
          node.innerHTML = v;
          break;
        }
        case 'subheading': {
          node = mk('h3');
          node.innerHTML = v;
          break;
        }

        case 'paragraph': {
          node = mk('p');
          node.innerHTML = v;           // old content contains inline links
          break;
        }

        case 'quote': {
          node = mk('blockquote', 'cs-quote');
          node.appendChild(mk('p', null, v.text || v));
          if (v.author) node.appendChild(mk('cite', null, v.author));
          break;
        }

        case 'image': {
          node = mk('figure', 'cs-figure');
          var img = mk('img');
          img.src = v.src; img.alt = v.alt || ''; img.loading = 'lazy';
          node.appendChild(img);
          if (v.caption) node.appendChild(mk('figcaption', null, v.caption));
          break;
        }

        case 'table': {
          node = mk('div', 'cs-card');
          if (v.title) node.appendChild(mk('div', 'cs-label', v.title));
          
          // Create the new responsive wrapper
          var tableWrap = mk('div', 'cs-table-wrap');
          var t = mk('table', 'cs-table');
          
          if (Array.isArray(v)) {
            v.forEach(function (row, i) {
              var tr = mk('tr');
              row.forEach(function (cell) { 
                var cellNode = mk(i === 0 ? 'th' : 'td');
                cellNode.innerHTML = cell;
                tr.appendChild(cellNode); 
              });
              t.appendChild(tr);
            });
          } else {
            if (v.headers) {
              var tr = mk('tr');
              v.headers.forEach(function (h) { var th = mk('th'); th.innerHTML = h; tr.appendChild(th); });
              t.appendChild(tr);
            }
            (v.rows || []).forEach(function (row) {
              var tr2 = mk('tr');
              row.forEach(function (cell) { var td = mk('td'); td.innerHTML = cell; tr2.appendChild(td); });
              t.appendChild(tr2);
            });
          }
          
          // Inject the table into the wrapper, and the wrapper into the card
          tableWrap.appendChild(t);
          node.appendChild(tableWrap);
          break;
        }

        case 'gallery': {
          node = mk('div', 'cs-pair');
          (v.images || v || []).forEach(function (im) {
            var f = mk('figure', 'cs-figure');
            var i3 = mk('img'); i3.src = im.src || im; i3.alt = im.alt || ''; i3.loading = 'lazy';
            f.appendChild(i3);
            node.appendChild(f);
          });
          break;
        }

        case 'list': {
          node = mk('ul', 'cs-list');
          (v.items || v).forEach(function (it) { 
            var li = mk('li');
            li.innerHTML = it;
            node.appendChild(li); 
          });
          break;
        }

        case 'lined-list': {
          node = mk('ul', 'cs-lined');
          (v.items || v).forEach(function (it) {
            var li = mk('li');
            li.innerHTML = (typeof it === 'string') ? it
              : ('<strong>' + (it.title || '') + '</strong> ' + (it.text || it.description || ''));
            node.appendChild(li);
          });
          break;
        }

        case 'box-list': {
          node = mk('ul', 'cs-boxes');
          (v.items || v).forEach(function (it) {
            var li = mk('li');
            li.innerHTML = (typeof it === 'string') ? it
              : ('<strong>' + (it.title || '') + '</strong><br>' + (it.text || it.description || ''));
            node.appendChild(li);
          });
          break;
        }

        case 'comparison': {
          node = mk('div', 'cs-compare');
          if (v.title) node.appendChild(mk('div', 'cs-compare__title', v.title));
          var cols = mk('div', 'cs-compare__cols');
          [v.left, v.right].forEach(function (side) {
            if (!side) return;
            var c = mk('div', 'cs-compare__col');
            c.appendChild(mk('h4', null, side.title));
            var ul = mk('ul');
            (side.items || []).forEach(function (it) { ul.appendChild(mk('li', null, it)); });
            c.appendChild(ul);
            cols.appendChild(c);
          });
          node.appendChild(cols);
          break;
        }

        case 'table': {
          node = mk('div', 'cs-card');
          if (v.title) node.appendChild(mk('div', 'cs-label', v.title));
          var t = mk('table', 'cs-table');
          if (v.headers) {
            var tr = mk('tr');
            v.headers.forEach(function (h) { tr.appendChild(mk('th', null, h)); });
            t.appendChild(tr);
          }
          (v.rows || []).forEach(function (row) {
            var tr2 = mk('tr');
            row.forEach(function (cell) { tr2.appendChild(mk('td', null, cell)); });
            t.appendChild(tr2);
          });
          node.appendChild(t);
          break;
        }

        /* architecture, concept-grid, snake-flow, flow, horizontal-flow all
           become node panels — a grid of bordered cards */
        case 'architecture': {
          node = mk('div', 'cs-arch');
          if (v.title) node.appendChild(mk('div', 'cs-label', v.title));
          var layers = Array.isArray(v) ? v : (v.layers || v.items || []);
          layers.forEach(function (layer, li) {
            var row = mk('div', 'cs-arch__layer');
            if (layer && !Array.isArray(layer) && (layer.text || layer.highlight)) {
              var hero = mk('div', 'cs-arch__node cs-arch__node--hero');
              hero.innerHTML = layer.text || '';
              row.appendChild(hero);
            } else {
              var groups = Array.isArray(layer) ? layer : [layer];
              groups.forEach(function (group) {
                var col = mk('div', 'cs-arch__group');
                var cells = Array.isArray(group) ? group : [group];
                cells.forEach(function (cell) {
                  var n = mk('div', 'cs-arch__node');
                  if (cell && cell.highlight) n.classList.add('cs-arch__node--hero');
                  n.innerHTML = (cell && cell.text != null) ? cell.text : (cell || '');
                  col.appendChild(n);
                });
                row.appendChild(col);
              });
            }
            node.appendChild(row);
            if (li < layers.length - 1) {
              var conn = mk('div', 'cs-arch__connector');
              conn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16M6 14l6 6 6-6"/></svg>';
              node.appendChild(conn);
            }
          });
          break;
        }

        case 'concept-grid': {
          node = mk('div', 'cs-concept');
          if (v.title) node.appendChild(mk('div', 'cs-label', v.title));
          var cg = mk('div', 'cs-concept__grid');
          var citems = Array.isArray(v) ? v : (v.items || []);
          citems.forEach(function (it) {
            var card = mk('div', 'cs-concept__card');
            card.appendChild(mk('div', 'cs-concept__t', it.title || it.name || ''));
            if (it.description || it.text) card.appendChild(mk('div', 'cs-concept__d', it.description || it.text));
            cg.appendChild(card);
          });
          node.appendChild(cg);
          break;
        }

        case 'snake-flow':
        case 'flow':
        case 'horizontal-flow': {
          var steps = Array.isArray(v) ? v : (v.items || v.steps || []);
          var last = String(steps[steps.length - 1] || '').toLowerCase();
          var isLoop = /repeat|cycle|loop|back to|returns to/.test(last);

          node = mk('div', 'cs-flow' + (isLoop ? ' cs-flow--loop' : ''));
          if (v.title) node.appendChild(mk('div', 'cs-label', v.title));

          var track = mk('div', 'cs-flow__track');
          steps.forEach(function (it, i) {
            var step = mk('div', 'cs-flow__step');
            var num = mk('span', 'cs-flow__num', isLoop ? String(i + 1) : String(i + 1));
            var txt = mk('span', 'cs-flow__txt');
            txt.innerHTML = (typeof it === 'string') ? it : (it.title || it.label || it.text || '');
            step.appendChild(num);
            step.appendChild(txt);
            // the final step of a loop is the "return" marker
            if (isLoop && i === steps.length - 1) step.classList.add('cs-flow__step--return');
            track.appendChild(step);

            if (i < steps.length - 1) {
              var conn = mk('span', 'cs-flow__arrow');
              conn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
              track.appendChild(conn);
            }
          });
          node.appendChild(track);

          // for loops, add an explicit "returns to start" ribbon
          if (isLoop) {
            var ribbon = mk('div', 'cs-flow__loopback');
            ribbon.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.4 2.6L3 8"/><path d="M3 3v5h5"/></svg><span>Loops back to the start — the cycle repeats</span>';
            node.appendChild(ribbon);
          }
          break;
        }

        case 'roadmap': {
          node = mk('div', 'cs-road');
          (v.phases || v.items || v).forEach(function (ph) {
            var item = mk('div', 'cs-road__item');
            item.appendChild(mk('div', 'cs-road__phase', ph.phase || ph.title || ''));
            var bod = mk('div', 'cs-road__body');
            if (ph.title && ph.phase) bod.appendChild(mk('h4', null, ph.title));
            var ul2 = mk('ul');
            (ph.items || ph.points || []).forEach(function (p2) { ul2.appendChild(mk('li', null, p2)); });
            bod.appendChild(ul2);
            item.appendChild(bod);
            node.appendChild(item);
          });
          break;
        }

        case 'iframe': {
          node = mk('div', 'cs-frame');
          var fr = mk('iframe');
          fr.src = v.src; fr.title = v.title || 'Embedded content';
          fr.loading = 'lazy';
          fr.setAttribute('allowfullscreen', '');
          node.appendChild(fr);
          break;
        }

        case 'video': {
          node = mk('video', 'cs-video');
          node.src = v.src || v;
          node.controls = true; node.muted = true; node.loop = true;
          node.setAttribute('playsinline', '');
          if (v.poster) node.poster = v.poster;
          break;
        }

        case 'mobile-demo': {
          node = mk('div', 'cs-phone');
          if (v.video || (v.src && /\.(mp4|webm)$/i.test(v.src))) {
            var mv = mk('video');
            mv.src = v.video || v.src;
            mv.autoplay = true; mv.muted = true; mv.loop = true;
            mv.setAttribute('playsinline', '');
            node.appendChild(mv);
          } else {
            var mi = mk('img');
            mi.src = v.src || v.image; mi.alt = v.alt || ''; mi.loading = 'lazy';
            node.appendChild(mi);
          }
          break;
        }

        default: {
          // unknown block: render any text we can find rather than dropping it
          if (typeof v === 'string') node = mk('p', null, v);
          break;
        }
      }

      if (node) into.appendChild(node);
    });
  }

  function openProject(id) {
    var data = projectData[id];
    if (!modal || !data) return;

    modalLastFocused = document.activeElement;

    // Update Top Navigation
    var modalTopCat = document.getElementById('projectModalTopCat');
    if (modalTopCat) modalTopCat.textContent = data.category;

    // Handle Hero Image
    modalPlate.style.setProperty('--phue', data.hue);
    var existingHero = modalPlate.querySelector('img');
    if (existingHero) existingHero.remove();
    if (data.image) {
      var hero = document.createElement('img');
      hero.src = data.image;
      hero.alt = data.title;
      hero.className = 'project-modal__hero';
      modalPlate.appendChild(hero);
      modalPlateLabel.style.display = 'none';
    } else {
      modalPlateLabel.style.display = '';
      modalPlateLabel.textContent = data.title;
    }

    // Flatten tags into the Meta Row (Year · Category · Tags...)
    modalMeta.innerHTML = '';
    var metaArr = [data.year, data.category].concat(data.tags || []);
    metaArr.forEach(function (text, i) {
      if (i > 0) {
        var dot = document.createElement('span');
        dot.className = 'metarow__dot';
        dot.textContent = '·';
        modalMeta.appendChild(dot);
      }
      var span = document.createElement('span');
      span.textContent = text;
      modalMeta.appendChild(span);
    });

    modalTitle.textContent = data.title;
    modalDesc.textContent = data.description;

    renderBlocks(data.content, modalContent);

    // Setup Next Project Footer Button
    var keys = Object.keys(projectData);
    var currIdx = keys.indexOf(id);
    var nextIdx = (currIdx + 1) % keys.length;
    var nextId = keys[nextIdx];
    var nextBtn = document.getElementById('projectModalNextTitle');
    
    if (nextBtn) {
      nextBtn.textContent = projectData[nextId].title;
      nextBtn.onclick = function() {
        if (modalScroll) modalScroll.scrollTop = 0;
        openProject(nextId);
      };
    }

    modal.setAttribute('aria-hidden', 'false');
    body.classList.add('modal-open');
    document.addEventListener('keydown', onModalKeydown);
    if (modalScroll) modalScroll.scrollTop = 0;
    requestAnimationFrame(function () { modal.focus(); });
  }

  function closeProject() {
    if (!modal || modal.getAttribute('aria-hidden') === 'true') return;
    modal.setAttribute('aria-hidden', 'true');
    body.classList.remove('modal-open');
    document.removeEventListener('keydown', onModalKeydown);
    if (modalLastFocused && typeof modalLastFocused.focus === 'function') modalLastFocused.focus();
  }

  if (modal) {
    modal.querySelectorAll('[data-modal-close]').forEach(function (el) {
      el.addEventListener('click', closeProject);
    });
    document.querySelectorAll('.readlink[data-project]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        openProject(el.dataset.project);
      });
    });
  }

  /* ---------- Rail: pinned scroll-jack (desktop) + fallback drag/scroll (mobile) ---------- */
  var railSection = document.getElementById('railSection');
  var railPin      = document.querySelector('.rail__pin');
  var railTrack    = document.querySelector('.rail__track');
  var railHint     = document.getElementById('railHint');

  if (railSection && railPin && railTrack) {
    var desktopMQ = window.matchMedia('(min-width: 721px)');
    var reduceMQ  = window.matchMedia('(prefers-reduced-motion: reduce)');
    var railPinned = false;
    var railMax = 0;

    function railShouldPin() { return desktopMQ.matches && !reduceMQ.matches; }

    /* recompute pin state + the extra scroll height the section needs to
       hold to have room to reveal every card before releasing the page */
    layoutRail = function () {
      var shouldPin = railShouldPin();
      if (shouldPin !== railPinned) {
        railPinned = shouldPin;
        railSection.classList.toggle('is-pinned', railPinned);
        railTrack.style.transform = '';
        railTrack.scrollLeft = 0;
        railSection.style.height = '';
        if (railHint) railHint.textContent = railPinned ? 'Scroll to explore ↓' : 'Drag or scroll →';
      }
      if (!railPinned) return;
      /* railTrack itself is sized to its full content (width: max-content),
         so measure overflow against the clipping pin container, not the track */
      railMax = Math.max(0, railTrack.scrollWidth - railPin.clientWidth);
      railSection.style.height = (window.innerHeight + railMax) + 'px';
    };

    /* translate the track horizontally in proportion to how far we've
       scrolled through the section's pinned range */
    onRailScroll = function () {
      if (!railPinned || body.getAttribute('data-mode') !== 'read') return;
      var total = railSection.offsetHeight - window.innerHeight;
      if (total <= 0) { railTrack.style.transform = ''; return; }
      var progress = Math.min(1, Math.max(0, -railSection.getBoundingClientRect().top / total));
      railTrack.style.transform = 'translate3d(' + (-progress * railMax).toFixed(1) + 'px,0,0)';
    };

    layoutRail();
    onRailScroll();
    window.addEventListener('scroll', onRailScroll, { passive: true });
    window.addEventListener('resize', function () { layoutRail(); onRailScroll(); });
    var onMQChange = function () { layoutRail(); onRailScroll(); };
    [desktopMQ, reduceMQ].forEach(function (mq) {
      if (mq.addEventListener) mq.addEventListener('change', onMQChange);
      else mq.addListener(onMQChange); // Safari < 14
    });

    /* drag-to-scroll + wheel-to-horizontal only apply in the unpinned
       (mobile / reduced-motion) fallback, where the track scrolls itself */
    var down = false, startX = 0, startScroll = 0, moved = false, downTarget = null;

    railTrack.addEventListener('pointerdown', function (e) {
      downTarget = e.target.closest('[data-project]');
      if (railPinned || e.pointerType === 'touch') return; // page scroll drives it when pinned; native touch handles itself
      down = true; moved = false;
      startX = e.clientX;
      startScroll = railTrack.scrollLeft;
      railTrack.setPointerCapture(e.pointerId);
      railTrack.style.cursor = 'grabbing';
      railTrack.style.scrollSnapType = 'none';   // don't fight the drag with snap
    });
    railTrack.addEventListener('pointermove', function (e) {
      if (!down) return;
      var dx = e.clientX - startX;
      if (Math.abs(dx) > 4) moved = true;
      railTrack.scrollLeft = startScroll - dx;
    });
    function endDrag() {
      down = false;
      railTrack.style.cursor = '';
      railTrack.style.scrollSnapType = '';
    }
    railTrack.addEventListener('pointerup', endDrag);
    railTrack.addEventListener('pointercancel', endDrag);

    /* vertical wheel/trackpad scroll → horizontal rail scroll, released
       at either end so the page keeps scrolling past the section normally */
    railTrack.addEventListener('wheel', function (e) {
      if (railPinned) return; // native page scroll already drives progress
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // native horizontal gesture, leave it alone
      var atStart = railTrack.scrollLeft <= 0;
      var atEnd = railTrack.scrollLeft + railTrack.clientWidth >= railTrack.scrollWidth - 1;
      if ((atStart && e.deltaY < 0) || (atEnd && e.deltaY > 0)) return;
      e.preventDefault();
      railTrack.scrollLeft += e.deltaY;
    }, { passive: false });

    /* prevent a drag from firing the card's link; open the modal on a real
       click — uses the target captured on pointerdown, not e.target, because
       setPointerCapture retargets the synthetic click to railTrack itself */
    railTrack.addEventListener('click', function (e) {
      if (moved) { e.preventDefault(); moved = false; downTarget = null; return; }
      if (downTarget) {
        e.preventDefault();
        openProject(downTarget.dataset.project);
      }
      downTarget = null;
    }, true);
  }
// === CONTACT MODAL (added / updated) ===
document.addEventListener('DOMContentLoaded', function() {
  var contactModal = document.getElementById('contactModal');
  var contactBtn = document.querySelector('.cta__primary');
  var projectModal = document.getElementById('projectModal');

  // Open contact modal
  if (contactBtn && contactModal) {
    contactBtn.addEventListener('click', function(e) {
      e.preventDefault();
      contactModal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
    });
  }

  // Close contact modal via back button (data-modal-close)
  if (contactModal) {
    contactModal.querySelectorAll('[data-modal-close]').forEach(function (el) {
      el.addEventListener('click', function () {
        contactModal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
      });
    });

    // Also allow clicking the backdrop (outside the scroll area)
    contactModal.addEventListener('click', function (e) {
      if (e.target === contactModal) {
        contactModal.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
      }
    });
  }
});
})();
