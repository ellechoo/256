/* =====================================================================
   FLAT MODE — separate script. Does not touch script.js state.

   Loads dataset.json independently so the tunnel and flat view share
   no variables. Builds 31+ concentric rings, 1995 innermost, 2026
   outermost, photos on each ring evenly spaced at equal angular
   intervals.

   ZOOM & PAN
   ----------
   The whole ring system lives inside #flat-stage, a 0x0 element
   pinned to the center of the viewport. Scaling/translating the stage
   scales/translates every ring uniformly.

   Wheel (or trackpad pinch) zooms toward the cursor position. Click
   and drag pans. Double-click resets the view.
   ===================================================================== */

(function () {
  'use strict';

  // ---------- DOM ----------
  const flatViewport = document.getElementById('flat-viewport');
  const flatStage    = document.getElementById('flat-stage');
  const modeToggle   = document.getElementById('mode-toggle');

  if (!flatViewport || !flatStage || !modeToggle) return;

  // ---------- Tunables ----------
    // Design canvas min dimension. We build everything in "design units"
  // that are ~6x larger than screen pixels, then scale the whole stage
  // down. This gives every <img> a CSS size around 96px instead of
  // ~16px, so the browser has plenty of pixel data when you zoom in.
  const DESIGN_SIZE = 6000;

  const FLAT_CONFIG = {
    innerRadiusFrac: 0.05,
    outerRadiusFrac: 0.46,     // was 0.44 — bigger overall canvas
    photoSizeFrac:   0.012,    // was 0.016 — smaller photos

    // These are in DESIGN units, not screen px. The visual at 1x zoom
    // is identical to before; only the underlying raster is bigger.
    photoSizeMin:    60,
    photoSizeMax:    180,

    minScale: 0.4,
    maxScale: 10,

    wheelIntensity:      0.002,
    wheelPinchIntensity: 0.010,

    perRingRotationOffsetDeg: 137.50776405003785,
  };

    // ---------- Camera filter categories ----------
  const CATEGORIES = [
    { id: 'all',        label: 'All'        },
    { id: 'film',       label: 'Film'       },
    { id: 'compact',    label: 'Compact'    },
    { id: 'dslr',       label: 'DSLR'       },
    { id: 'mirrorless', label: 'Mirrorless' },
    { id: 'phone',      label: 'Phone'      },
    { id: 'pro',        label: 'Pro'        },
    { id: 'other',      label: 'Other'      },
  ];

  // ---------- State ----------
  let flatYearsData  = null;
  let isFlatMode     = false;
  let savedScrollY   = 0;

  // Radius of the outermost ring in stage-local px. Used to clamp
  // panning so the user can't drag the whole thing off-screen.
  let contentRadius  = 0;
  let baseScale      = 1;   // design units -> screen px, recomputed on build

  // The view transform. Applied to #flat-stage.
  const view = { scale: 1, tx: 0, ty: 0 };

  // Active drag state (null when not dragging).
  let dragState = null;

  let activeFilter = 'all';
  let chipEls      = [];

  // ---------- Utility ----------
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // ---------- Data ----------
  async function loadData() {
    const res  = await fetch('data/dataset.json');
    const data = await res.json();
    flatYearsData = data.years;
  }

  // ---------- Camera classifier ----------
  //
  // Order matters: we check for the most specific markers first
  // (scans, phones, pro gear), then mirrorless before DSLR, then
  // broad compact patterns, and finally fall back to "film era" for
  // anything pre-2003 that didn't match a digital pattern.
  function classifyDevice(deviceStr, year) {
    const s = (deviceStr || '').toLowerCase();
    const isPreDigital = year < 2003;

    // 1. No device info at all
    if (!s) return isPreDigital ? 'film' : 'other';

    // 2. Explicit film / scanner markers
    if (/noritsu|coolscan|film scanner|slide scanner/.test(s)) return 'film';

    // 3. Phones (before compact — "nokia" overlaps nothing but
    //    several brands appear in both buckets)
    if (/iphone|samsung sm-|galaxy|google pixel|pixel \d|huawei|motorola|moto |oneplus|htc |xiaomi|hmd |nokia|micromax|sony ericsson|blackberry/.test(s))
      return 'phone';

    // 4. Pro / medium format
    if (/hasselblad|leica/.test(s)) return 'pro';

    // 5. Mirrorless (before DSLR — some "EOS R" overlaps)
    if (/ilce-|eos r\d|eos r\b|nikon z|e-m1|e-m5|e-m10|om-d|om-1|x-t\d|x-pro|finepix x/.test(s))
      return 'mirrorless';

    // 6. DSLR
    if (/eos \d|eos-\d|nikon d\d|dslr-a|slt-a|pentax k/.test(s)) return 'dslr';

    // 7. Compact digital — broad pattern set
    if (/powershot|ixus|coolpix|cybershot|cyber-shot|dsc|stylus|finepix|dimage|optio|lumix|vlux|easyshare|photosmart|mavica|exilim|handycam|photopc|kodak|polaroid|benq|seiko|olympus|general imaging|traveler/.test(s))
      return 'compact';

    // 8. Pre-2003 fallback — treat as film era
    if (isPreDigital) return 'film';

    // 9. Everything else
    return 'other';
  }

  // ---------- Chip UI ----------
  function buildChips() {
    const container = document.createElement('div');
    container.id = 'flat-filters';

    CATEGORIES.forEach(cat => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'flat-chip';
      btn.dataset.category = cat.id;
      btn.textContent = cat.label;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        activeFilter = cat.id;
        applyFilter();
      });
      container.appendChild(btn);
      chipEls.push(btn);
    });

    flatViewport.appendChild(container);
  }

  function applyFilter() {
    // Chips
    chipEls.forEach(el => {
      el.classList.toggle('is-active', el.dataset.category === activeFilter);
    });
    // Photos
    const photos = flatStage.querySelectorAll('.flat-photo');
    photos.forEach(p => {
      const match = activeFilter === 'all'
        || p.dataset.category === activeFilter;
      p.classList.toggle('is-dimmed', !match);
    });
  }

  // ---------- Build ----------
  function buildFlatView() {
    if (!flatYearsData) return;

    flatStage.innerHTML = '';

    const total = flatYearsData.length;
    if (total === 0) return;

    const vmin = Math.min(window.innerWidth, window.innerHeight);
    baseScale = vmin / DESIGN_SIZE;

    const innerR  = DESIGN_SIZE * FLAT_CONFIG.innerRadiusFrac;
    const outerR  = DESIGN_SIZE * FLAT_CONFIG.outerRadiusFrac;
    const spacing = (outerR - innerR) / Math.max(1, total - 1);

    const photoSize = clamp(
      DESIGN_SIZE * FLAT_CONFIG.photoSizeFrac,
      FLAT_CONFIG.photoSizeMin,
      FLAT_CONFIG.photoSizeMax
    );

    contentRadius = outerR;

    flatYearsData.forEach((yearEntry, dataIndex) => {
      const positionFromCenter = (total - 1) - dataIndex;
      const radius = innerR + positionFromCenter * spacing;

      const ring = document.createElement('div');
      ring.className = 'flat-ring';
      ring.dataset.year = yearEntry.year;

      const circle = document.createElement('div');
      circle.className = 'flat-ring-circle';
      const d = radius * 2;
      circle.style.width      = d + 'px';
      circle.style.height     = d + 'px';
      circle.style.left       = '50%';
      circle.style.top        = '50%';
      circle.style.marginLeft = (-radius) + 'px';
      circle.style.marginTop  = (-radius) + 'px';
      ring.appendChild(circle);

      const n = yearEntry.photos.length;
      yearEntry.photos.forEach((photo, photoIndex) => {
        const ringOffsetDeg = dataIndex * FLAT_CONFIG.perRingRotationOffsetDeg;
        
        const angleDeg = (360 / n) * photoIndex + ringOffsetDeg;

        const wrap = document.createElement('div');
        wrap.className = 'flat-photo';
        wrap.dataset.category =
          classifyDevice(photo.device, yearEntry.year);
        
        wrap.style.width      = photoSize + 'px';
        wrap.style.height     = photoSize + 'px';
        wrap.style.marginLeft = (-photoSize / 2) + 'px';
        wrap.style.marginTop  = (-photoSize / 2) + 'px';
        wrap.style.transform =
          'rotate(' + angleDeg + 'deg) translateY(' + (-radius) + 'px)';

        const img = document.createElement('img');
        img.src     = 'photos/' + encodeURIComponent(photo.file);
        img.alt     = photo.file + ' (' + yearEntry.year + ')';
        img.loading = 'lazy';
        wrap.appendChild(img);

        ring.appendChild(wrap);
      });

     flatStage.appendChild(ring);
    });

    applyView();
    applyFilter();
  }

  // ---------- View application ----------
  function applyView() {
    flatStage.style.transform =
      'translate(' + view.tx + 'px,' + view.ty + 'px)' +
      ' scale(' + (baseScale * view.scale) + ')';
  }

  function clampView() {
    view.scale = clamp(view.scale, FLAT_CONFIG.minScale, FLAT_CONFIG.maxScale);

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r  = contentRadius * baseScale * view.scale;   // screen px
    const maxTx = vw * 0.5 + r * 0.9;
    const maxTy = vh * 0.5 + r * 0.9;
    view.tx = clamp(view.tx, -maxTx, maxTx);
    view.ty = clamp(view.ty, -maxTy, maxTy);
  }

  function resetView() {
    view.scale = 1;
    view.tx    = 0;
    view.ty    = 0;
    applyView();
  }

  // ---------- Wheel zoom (toward cursor) ----------
  function onWheel(e) {
    if (!isFlatMode) return;
    e.preventDefault();

    const intensity = e.ctrlKey
      ? FLAT_CONFIG.wheelPinchIntensity
      : FLAT_CONFIG.wheelIntensity;
    const factor = Math.exp(-e.deltaY * intensity);

    // Cursor position relative to viewport center.
    const rect = flatViewport.getBoundingClientRect();
    const mx   = e.clientX - rect.left - rect.width  * 0.5;
    const my   = e.clientY - rect.top  - rect.height * 0.5;

    const oldScale = view.scale;
    const newScale = clamp(
      oldScale * factor,
      FLAT_CONFIG.minScale,
      FLAT_CONFIG.maxScale
    );

    // Keep the stage-point under the cursor pinned to the cursor.
    const k = newScale / oldScale;
    view.tx = mx - (mx - view.tx) * k;
    view.ty = my - (my - view.ty) * k;
    view.scale = newScale;

    clampView();
    applyView();
  }

  // ---------- Pointer drag (pan) ----------
  function onPointerDown(e) {
    if (!isFlatMode) return;
    if (e.button !== 0) return;   // left-click / primary touch only
    if (e.target.closest('#flat-filters')) return;   // ← add this

    dragState = {
      pointerId: e.pointerId,
      startX:    e.clientX,
      startY:    e.clientY,
      startTx:   view.tx,
      startTy:   view.ty,
    };

    try { flatViewport.setPointerCapture(e.pointerId); } catch (_) {}
    flatViewport.classList.add('is-dragging');
  }

  function onPointerMove(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    view.tx = dragState.startTx + (e.clientX - dragState.startX);
    view.ty = dragState.startTy + (e.clientY - dragState.startY);
    clampView();
    applyView();
  }

  function onPointerUp(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    try { flatViewport.releasePointerCapture(e.pointerId); } catch (_) {}
    dragState = null;
    flatViewport.classList.remove('is-dragging');
  }

  // ---------- Mode switching ----------
  function enterFlatMode() {
    if (isFlatMode) return;
    savedScrollY = window.scrollY;

    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow            = 'hidden';

    document.body.classList.add('mode-flat');
    modeToggle.textContent = 'Tunnel';
    modeToggle.setAttribute('aria-pressed', 'true');
    flatViewport.setAttribute('aria-hidden', 'false');

    isFlatMode = true;
    buildFlatView();
  }

  function exitFlatMode() {
    if (!isFlatMode) return;

    // Cancel any in-progress drag cleanly.
    if (dragState) {
      try { flatViewport.releasePointerCapture(dragState.pointerId); } catch (_) {}
      dragState = null;
      flatViewport.classList.remove('is-dragging');
    }

    document.body.classList.remove('mode-flat');
    flatViewport.setAttribute('aria-hidden', 'true');

    document.documentElement.style.overflow = '';
    document.body.style.overflow            = '';
    window.scrollTo(0, savedScrollY);

    modeToggle.textContent = 'Flat';
    modeToggle.setAttribute('aria-pressed', 'false');

    isFlatMode = false;
  }

  modeToggle.addEventListener('click', function () {
    if (isFlatMode) exitFlatMode();
    else            enterFlatMode();
  });

  window.addEventListener('resize', function () {
    if (isFlatMode) {
      clampView();
      buildFlatView();
    }
  });

  // ---------- Event wiring ----------
  flatViewport.addEventListener('wheel',       onWheel, { passive: false });
  flatViewport.addEventListener('pointerdown', onPointerDown);
  flatViewport.addEventListener('pointermove', onPointerMove);
  flatViewport.addEventListener('pointerup',   onPointerUp);
  flatViewport.addEventListener('pointercancel', onPointerUp);
  flatViewport.addEventListener('dblclick',    function () {
    if (isFlatMode) resetView();
  });

  buildChips();

  // ---------- Boot ----------
  loadData().catch(function (err) {
    console.warn('[flat.js] Could not load dataset.json:', err);
  });
})();