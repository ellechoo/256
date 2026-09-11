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

function sizeScrollSpacer() {
  const totalYears = yearsData.length + 1;
  spacer.style.height = (totalYears * pixelsPerYear()) + 'px';
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
  let closestVisibleYear = null;
  let closestDist = Infinity;

  ringEls.forEach((ring, ringIndex) => {
    const distance = (ringIndex - currentDepth) + CONFIG.focalOffset;
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

      // Frame-rate-independent lerp toward targetScale
      const k = Math.min(1, deltaSec * CONFIG.photoScaleLerp);
      photo.hoverScale += (photo.targetScale - photo.hoverScale) * k;

      el.style.transform =
        'rotate(' + (photo.angleDeg + spin) + 'deg)' +
        ' translateY(' + (-radius) + 'px)' +
        ' scale(' + photo.hoverScale + ')';

    });

    if (Math.abs(distance - CONFIG.focalOffset) < closestDist) {
      closestDist = Math.abs(distance - CONFIG.focalOffset);
      closestVisibleYear = ring.year;
    }
  });

  if (closestVisibleYear !== null) {
    yearLabel.textContent = '09.03.' + closestVisibleYear;
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
    // plane, so scrollY = ringIndex * pixelsPerYear() puts it in focus.
    dot.addEventListener('click', () => {
      window.scrollTo({
        top: ringIndex * pixelsPerYear(),
        behavior: 'smooth',
      });
    });

    timelineEl.appendChild(dot);
    timelineDots.push(dot);
  });
}

function updateTimelineActive() {
  const idx = clamp(Math.round(currentDepth), 0, yearsData.length - 1);
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
  modalEl.querySelector('.hex-band-1'),
  modalEl.querySelector('.hex-band-2'),
  modalEl.querySelector('.hex-band-3'),
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

  // Palette straight from dataset.json — index 0 = largest band.
  const pal = Array.isArray(photo.palette) ? photo.palette : [];
  for (let i = 0; i < 3; i++) {
    const band  = hexBands[i];
    const label = band.querySelector('.hex-label');
    const hex   = (pal[i] && pal[i].hex) ? pal[i].hex : '#eeeeee';
    band.style.background = hex;
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
