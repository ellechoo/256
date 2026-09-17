/* =====================================================================
   TUNNEL THROUGH TIME — year-ring scroll visualization
   =====================================================================

   Every year is a "ring" of photos arranged in a circle, each photo
   rotated so its bottom edge faces the ring's center.

   Ring 0 = the most recent year (e.g. 2026), ring 1 = one year back,
   etc, receding toward a vanishing point.

   Scroll position maps to a continuous "depth" number. Every ring's
   "distance" from the viewer is (ringIndex - depth + focalOffset).
   Distance falls as you scroll toward a ring; scale grows the whole
   time distance is falling (true 1/distance perspective — this is
   the "hyperbolic" growth curve, restored here because it's the one
   that felt right for scroll speed/rate).

   OPACITY / FADE — the important fix in this version:
   A ring should NEVER fade while it's still visibly growing. The
   growth formula (scaleConstant / distance) keeps increasing scale
   for as long as distance keeps falling — it doesn't "finish" at
   some arbitrary reference point, only once it's clamped at
   maxScale (the hard ceiling) does it actually stop changing size.
   So the fade-out for a passed ring is tied to that REAL plateau
   point (scaleConstant / maxScale), not to focalOffset. Below that
   plateau distance, the ring is well and truly done growing — THAT's
   when it's safe to fade it out quickly, to make room for the next
   ring, without ever interrupting an active grow animation.

   Distant (not-yet-arrived) rings still fade out normally the
   further out they are — that's unrelated and unaffected.

   STACKING: each ring gets a FIXED z-index based on its year index,
   set once at build time, so closer rings always render in front —
   this doesn't depend on scroll position.
   ===================================================================== */

const CONFIG = {
  vhPerYear: 100,

  focalOffset: 1.5,
  scaleConstant: 1.0,
  maxScale: 3.2,

  baseRadiusPx: 300,
  minRadiusPx: 24,        // was 90 — lets inner rings shrink below 90px so they stop piling up

  maxPhotoWidthPx: 110,
  minPhotoWidthPx: 14,
  ringFillFraction: 0.82,

  minAspect: 2 / 3,
  maxAspect: 3 / 2,

  farFadeStartsAt: 3.0,
  farFadeEndsAt: 6.5,     // was 5.0 — extends visible range by one ring so a 5th inner layer appears

  passedFadeWindow: 0.18,

  perRingRotationOffsetDeg: 6,
  spinDegPerSecond: 3,

  // Photo hover / press feedback (in-ring, not in-modal)
  photoHoverScale: 1.12,     // how much a hovered photo grows
  photoPressedScale: 0.94,   // dip on click for tactile feedback
  photoScaleLerp: 14,        // higher = snappier; ~10–20 feels natural


    // Year N is "current" for depth in [N + yearStartOffset, N + 1 + yearStartOffset).
  // Positive = the label LAGS: it switches to the next year only after
  // that next ring has visibly grown and the old one is already fading.
  // Negative = the label LEADS: switches while the old ring is still big.
  //
  //   0.0  = switch exactly when the next year hits the focal plane.
  //   0.3  = current setting — old ring is mid-fade when the switch happens.
  //   0.4  = old ring fully faded at the switch (cleanest handoff).
  //   0.5+ = next ring is well past focal before the label catches up.
  yearStartOffset: 0.2,

  initialDepthOffset: 0.5,

};

let yearsData = [];
let ringEls = [];
let currentDepth = 0;
let lastFrameTime = null;
let spinAccumDeg = [];

const stage = document.getElementById('tunnel-stage');
const yearLabel = document.getElementById('year-label-text');
const spacer = document.getElementById('scroll-spacer');

async function init() {
  const res = await fetch('data/dataset.json');
  const data = await res.json();
  yearsData = data.years;

  buildRings();
  buildTimeline();
  setupModalListeners();  
  sizeScrollSpacer();

  // Land in the middle of the (very large but finite) buffer, at a
  // scroll position that's mathematically identical to depth=0 (a
  // whole number of full cycles in) — so the very first thing shown
  // is exactly the normal starting view, with huge scroll room in
  // BOTH directions before ever reaching a real edge. See the
  // "SEAMLESS LOOPING" comment block below for how this works.
  window.scrollTo(
    0,
    (BUFFER_CYCLES * yearsData.length + CONFIG.initialDepthOffset) * pixelsPerYear()
  );

  window.addEventListener('resize', sizeScrollSpacer);

  lastFrameTime = performance.now();
  requestAnimationFrame(frameLoop);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function buildRings() {
  const totalRings = yearsData.length;

  yearsData.forEach((yearEntry, ringIndex) => {
    const ring = document.createElement('div');
    ring.className = 'ring';
    ring.dataset.year = yearEntry.year;

    // Fixed stacking order: closer rings (lower index) always render
    // in front, regardless of scroll position — this was the bug
    // behind rings overlapping in the wrong visual order.
    ring.style.zIndex = String(totalRings - ringIndex);

    const n = yearEntry.photos.length;

    const photoEls = yearEntry.photos.map((photo, photoIndex) => {
      const angleDeg = (360 / n) * photoIndex
        + ringIndex * CONFIG.perRingRotationOffsetDeg;

      const wrap = document.createElement('div');
      wrap.className = 'ring-photo';

      const img = document.createElement('img');
      img.alt = photo.file + ' (' + yearEntry.year + ')';
      img.loading = 'lazy';

      const photoState = {
        el: wrap,
        img,
        angleDeg,
        aspect: 1,
        aspectKnown: false,
        
        hoverScale: 1,
        targetScale: 1,
        isHovering: false,

        // NEW — position within the tunnel, used by the modal carousel
        ringIndex,
        photoIndex,
      };

      img.addEventListener('load', () => {
        if (img.naturalWidth && img.naturalHeight) {
          const trueAspect = img.naturalWidth / img.naturalHeight;
          photoState.aspect = clamp(trueAspect, CONFIG.minAspect, CONFIG.maxAspect);
          photoState.aspectKnown = true;
        }
      });

      img.src = 'photos/' + encodeURIComponent(photo.file);

      wrap.appendChild(img);

      wrap.style.cursor = 'pointer';

        wrap.addEventListener('click', (e) => {
        e.stopPropagation();
        openPhotoModal(photoState);
      });

            wrap.addEventListener('pointerenter', () => {
        photoState.isHovering = true;
        photoState.targetScale = CONFIG.photoHoverScale;
      });

      wrap.addEventListener('pointerleave', () => {
        photoState.isHovering = false;
        photoState.targetScale = 1;
      });

      wrap.addEventListener('pointerdown', () => {
        photoState.targetScale = CONFIG.photoPressedScale;
      });

      // Snap back to hover-scale (or rest) on release, wherever it lands.
      // pointerleave already covers the drag-off case, so this only needs
      // to handle "release while still on the photo".
      wrap.addEventListener('pointerup', () => {
        photoState.targetScale = photoState.isHovering
          ? CONFIG.photoHoverScale
          : 1;
      });

      wrap.addEventListener('pointercancel', () => {
        photoState.targetScale = photoState.isHovering
          ? CONFIG.photoHoverScale
          : 1;
      });

      ring.appendChild(wrap);

      return photoState;
    });

    stage.appendChild(ring);
    ringEls.push({
      container: ring,
      photos: photoEls,
      year: yearEntry.year,
      spinDir: (ringIndex % 2 === 0) ? 1 : -1,
    });
    spinAccumDeg.push(0);
  });
}

function pixelsPerYear() {
  return window.innerHeight * (CONFIG.vhPerYear / 100);
}

/* =====================================================================
   SEAMLESS LOOPING

   Instead of a hard scroll boundary + a jump-cut, each ring's
   "distance" (see updateTunnel) wraps around every full cycle through
   all the years — so ring 0 (2026) doesn't just appear once near the
   start of the page, it periodically comes back into focus every
   `yearsData.length` years' worth of scrolling, seamlessly, with no
   special-cased jump.

   To make that feel genuinely endless rather than just "loops after
   one lap," the actual scrollable page is sized to hold many, many
   laps (BUFFER_CYCLES in each direction), and the initial scroll
   position starts BUFFER_CYCLES laps in — which, thanks to the
   periodic wrap, renders EXACTLY like depth=0 (2026 in focus). That
   gives huge scroll room in both directions before ever reaching a
   real edge; a real user would have to scroll continuously for an
   unreasonable amount of time to exhaust it.
   ===================================================================== */
const BUFFER_CYCLES = 40; // laps of headroom in EACH direction

function sizeScrollSpacer() {
  const totalYears = yearsData.length;
  const totalCycles = BUFFER_CYCLES * 2;
  spacer.style.height = (totalCycles * totalYears * pixelsPerYear()) + 'px';
}

function frameLoop(now) {
  const deltaSec = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;

  ringEls.forEach((ring, i) => {
    spinAccumDeg[i] += CONFIG.spinDegPerSecond * ring.spinDir * deltaSec;
  });

  currentDepth = window.scrollY / pixelsPerYear();
  updateTunnel(deltaSec);

  updateTimelineActive();

  requestAnimationFrame(frameLoop);
}

// The distance at which scale = scaleConstant/distance FIRST reaches
// maxScale — i.e. the real point where a ring stops growing. Below
// this, size no longer changes, so it's safe to fade out.
function plateauDistance() {
  return CONFIG.scaleConstant / CONFIG.maxScale;
}

function opacityForDistance(dist) {
  const plateau = plateauDistance();

  if (dist > plateau) {
    // Scale is still actively increasing here — NEVER fade in this
    // zone, no matter how close/large the ring has gotten. Only the
    // far side (distant, not-yet-arrived rings) can reduce opacity.
    if (dist <= CONFIG.farFadeStartsAt) return 1;
    if (dist < CONFIG.farFadeEndsAt) {
      return clamp(
        1 - (dist - CONFIG.farFadeStartsAt) / (CONFIG.farFadeEndsAt - CONFIG.farFadeStartsAt),
        0, 1
      );
    }
    return 0;
  }

  // Growth has genuinely plateaued (maxed out) — quick cleanup fade.
  const floor = plateau - CONFIG.passedFadeWindow;
  if (dist > floor) {
    return clamp((dist - floor) / (plateau - floor), 0, 1);
  }
  return 0;
}

function scaleForDistance(distance) {
  const raw = CONFIG.scaleConstant / Math.max(distance, 0.001);
  return clamp(raw, 0.001, CONFIG.maxScale);
}

function baselinePhotoWidth(n) {
  const circumference = 2 * Math.PI * CONFIG.baseRadiusPx;
  const share = (circumference / n) * CONFIG.ringFillFraction;
  return clamp(share, CONFIG.minPhotoWidthPx, CONFIG.maxPhotoWidthPx);
}

function updateTunnel(deltaSec) {
  const totalYears = yearsData.length;

  ringEls.forEach((ring, ringIndex) => {
    const rawDistance = (ringIndex - currentDepth) + CONFIG.focalOffset;
    const distance = rawDistance - totalYears * Math.round(rawDistance / totalYears);

    const opacity = opacityForDistance(distance);

    if (opacity <= 0) {
      ring.container.style.opacity = 0;
      ring.container.style.pointerEvents = 'none';
      return;
    }

    const scale = scaleForDistance(distance);
    const radius = Math.max(CONFIG.baseRadiusPx * scale, CONFIG.minRadiusPx);
    const n = ring.photos.length;
    const photoWidth = baselinePhotoWidth(n) * scale;

    ring.container.style.opacity = opacity;
    ring.container.style.pointerEvents = opacity > 0.05 ? 'auto' : 'none';

    const spin = spinAccumDeg[ringIndex];

    ring.photos.forEach(photo => {
      const w = photoWidth;
      const h = w / (photo.aspectKnown ? photo.aspect : 1);

      const el = photo.el;
      el.style.width = w + 'px';
      el.style.height = h + 'px';
      el.style.marginLeft = (-w / 2) + 'px';
      el.style.marginTop = (-h / 2) + 'px';

      const k = Math.min(1, deltaSec * CONFIG.photoScaleLerp);
      photo.hoverScale += (photo.targetScale - photo.hoverScale) * k;

      el.style.transform =
        'rotate(' + (photo.angleDeg + spin) + 'deg)' +
        ' translateY(' + (-radius) + 'px)' +
        ' scale(' + photo.hoverScale + ')';
    });
  });

  if (!isModalOpen) {
    // Year N is current for depth in [N + yearStartOffset, N + 1 + yearStartOffset).
    //
    // Normally the modulo wraps negative indices back to the last year
    // (1995) — which is correct for the seamless loop, but jarring when
    // the user scrolls UP from the opening position: 1995 briefly becomes
    // the label while 2026 is still the visually dominant ring. So we
    // clamp below zero to year 0 instead of wrapping. Forward wrapping
    // (past the end of a lap) still works normally.
    const shifted = currentDepth - CONFIG.yearStartOffset;
    const rawIndex = Math.floor(shifted);
    const activeIndex = rawIndex < 0
      ? 0
      : ((rawIndex % totalYears) + totalYears) % totalYears;
    yearLabel.textContent = '09.03.' + yearsData[activeIndex].year;
  }
  
}

/* =====================================================================
   MINIMALIST YEAR TIMELINE — fixed rail on the far left

   Purely additive: it only READS currentDepth to mark the active dot,
   and writes to window.scrollTo on click. It never touches ring math,
   distances, scales, opacity, or stacking — the tunnel is unchanged.
   ===================================================================== */

const timelineEl = document.getElementById('timeline');
let timelineDots = [];
let lastActiveRingIndex = -1;

function buildTimeline() {
  // yearsData[0] is the most recent year, so appending in order puts
  // 2026 at the top of the rail and 1995 at the bottom — matching the
  // scroll direction (depth 0 = 2026 in focus).
  yearsData.forEach((yearEntry, ringIndex) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'tl-dot';
    dot.dataset.index = String(ringIndex);
    dot.setAttribute('aria-label', String(yearEntry.year));

    const label = document.createElement('span');
    label.className = 'tl-label';
    label.textContent = yearEntry.year;
    dot.appendChild(label);

    // depth == ringIndex is exactly when this ring sits at the focal
    // plane. We jump to the SAME lap the user is currently on (not lap
    // zero), so clicking a dot never eats into the scroll buffer that
    // makes the infinite loop feel seamless in both directions.
    dot.addEventListener('click', () => {
      const totalYears = yearsData.length;
      // Land at the START of this year's window (the moment the label
      // switches to it), in whichever lap the user is currently on.
      const currentLap = Math.floor((currentDepth - CONFIG.yearStartOffset) / totalYears);

      const targetDepth = currentLap * totalYears + ringIndex + CONFIG.initialDepthOffset;
      
      window.scrollTo({
        top: targetDepth * pixelsPerYear(),
        behavior: 'smooth',
      });
    });

    timelineEl.appendChild(dot);
    timelineDots.push(dot);
  });
}

function updateTimelineActive() {
  const totalYears = yearsData.length;
  // Must match the label's calculation in updateTunnel exactly, or the
  // dot and the header text can disagree during the transition zone.
  const shifted = currentDepth - CONFIG.yearStartOffset;
  const rawIndex = Math.floor(shifted);
  const idx = rawIndex < 0
    ? 0
    : ((rawIndex % totalYears) + totalYears) % totalYears;

  if (idx === lastActiveRingIndex) return;   // no DOM churn per frame

  if (lastActiveRingIndex >= 0) {
    timelineDots[lastActiveRingIndex].classList.remove('is-active');
  }
  timelineDots[idx].classList.add('is-active');

  lastActiveRingIndex = idx;
}

/* =====================================================================
   PHOTO DETAIL MODAL  — with prev/next carousel within the same year
   Reads only. Never touches tunnel math, ring scaling, ring opacity,
   spin, or stacking.
   ===================================================================== */

const modalEl       = document.getElementById('photo-modal');
const modalBackdrop = modalEl.querySelector('.modal-backdrop');
const modalClose    = modalEl.querySelector('.modal-close');
const modalPhoto    = modalEl.querySelector('.modal-photo');
const modalTitle    = modalEl.querySelector('.meta-title');
const modalMetaList = modalEl.querySelector('.meta-list');
const modalNavPrev  = modalEl.querySelector('.modal-nav-prev');
const modalNavNext  = modalEl.querySelector('.modal-nav-next');

const hexBands      = [
  modalEl.querySelector('.swatch-1'),
  modalEl.querySelector('.swatch-2'),
  modalEl.querySelector('.swatch-3'),
];

let isModalOpen      = false;
let lastFocusedEl    = null;
let modalRingIndex   = -1;
let modalPhotoIndex  = -1;

function openPhotoModal(photoState) {
  if (isModalOpen) return;
  isModalOpen = true;

  modalRingIndex  = photoState.ringIndex;
  modalPhotoIndex = photoState.photoIndex;

  // Hide arrows for single-photo years
  const total = ringEls[modalRingIndex].photos.length;
  const multi = total > 1;
  modalNavPrev.classList.toggle('is-hidden', !multi);
  modalNavNext.classList.toggle('is-hidden', !multi);

  fillModal();

  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';

  lastFocusedEl = document.activeElement;
  modalEl.classList.add('is-open');
  modalEl.setAttribute('aria-hidden', 'false');
  modalClose.focus();
}

function closePhotoModal() {
  if (!isModalOpen) return;
  isModalOpen = false;

  modalEl.classList.remove('is-open');
  modalEl.setAttribute('aria-hidden', 'true');

  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';

  if (lastFocusedEl && lastFocusedEl.focus) lastFocusedEl.focus();
}

// Refresh every modal slot from the current ringIndex/photoIndex.
function fillModal() {
  const state     = ringEls[modalRingIndex].photos[modalPhotoIndex];
  const yearEntry = yearsData[modalRingIndex];
  const photo     = yearEntry.photos[modalPhotoIndex];

  // Keep the header label showing the year of the photo currently in
  // the modal, matching the "09.03.YYYY" format used on the tunnel.
  yearLabel.textContent = '09.03.' + yearEntry.year;

  modalPhoto.src = state.img.src;
  modalPhoto.alt = state.img.alt;

  modalTitle.textContent =
    photo.title ||
    (photo.file || '').replace(/\.[^.]+$/, '') ||
    String(yearEntry.year);

  const fields = {
    photographer: photo.photographer,
    datetime:     photo.datetime || photo.date || photo.datetimeOriginal,
    device:       photo.device,
    location:     photo.location || photo.gps,
  };
  modalMetaList.querySelectorAll('.meta-row').forEach(row => {
    const dd = row.querySelector('dd');
    const val = fields[dd.dataset.field];
    if (val) {
      dd.textContent = val;
      row.style.display = '';
    } else {
      dd.textContent = '';
      row.style.display = 'none';
    }
  });

  const pal = Array.isArray(photo.palette) ? photo.palette : [];
  for (let i = 0; i < 3; i++) {
    const swatch = hexBands[i];
    const label  = swatch.querySelector('.swatch-label');
    const hex    = (pal[i] && pal[i].hex) ? pal[i].hex : '#eeeeee';
    swatch.style.background = hex;
    label.textContent = hex.toUpperCase();
    label.style.color = textColorFor(hex);
  }
}

// Wrap around at either end so the carousel feels continuous, matching
// the ring it mirrors.
function goToPhoto(index) {
  const total = ringEls[modalRingIndex].photos.length;
  modalPhotoIndex = ((index % total) + total) % total;
  fillModal();
}
function prevPhoto() { goToPhoto(modalPhotoIndex - 1); }
function nextPhoto() { goToPhoto(modalPhotoIndex + 1); }

function textColorFor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.9)';
}

function setupModalListeners() {
  modalClose.addEventListener('click', closePhotoModal);
  modalBackdrop.addEventListener('click', closePhotoModal);

  // Nav buttons live inside .modal-wrap, not over the backdrop, so
  // clicking them never reaches the backdrop listener — no
  // stopPropagation needed, but harmless to keep it explicit.
  modalNavPrev.addEventListener('click', (e) => { e.stopPropagation(); prevPhoto(); });
  modalNavNext.addEventListener('click', (e) => { e.stopPropagation(); nextPhoto(); });

  document.addEventListener('keydown', e => {
    if (!isModalOpen) return;
    if (e.key === 'Escape')      closePhotoModal();
    else if (e.key === 'ArrowLeft')  prevPhoto();
    else if (e.key === 'ArrowRight') nextPhoto();
  });
}

init();
