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

  // --- Perspective / depth math (restored hyperbolic growth) ---
  focalOffset: 1.5,
  scaleConstant: 1.0,   // scale = scaleConstant / distance
  maxScale: 3.2,         // hard ceiling — once hit, a ring stops growing

  // Ring spacing — bumped up from the original so rings sit further
  // apart and the center stays clear of a big empty gap.
  baseRadiusPx: 300,
  minRadiusPx: 90,

  maxPhotoWidthPx: 110,
  minPhotoWidthPx: 14,
  ringFillFraction: 0.82,

  // Soft aspect-ratio caps (width / height). Extreme panoramas or
  // very tall portraits get gently cropped to fit; anything within
  // this range keeps its exact true proportions, uncropped.
  minAspect: 2 / 3,   // tallest allowed shape (portrait cap)
  maxAspect: 3 / 2,   // widest allowed shape (landscape cap)

  // Distant/not-yet-arrived rings fade out over this distance range.
  farFadeStartsAt: 3.0,
  farFadeEndsAt: 5.0,

  // How wide (in distance units) the post-plateau cleanup fade is.
  // This only ever applies BELOW the real growth-plateau point, so it
  // can never cut off an active "getting bigger" animation.
  passedFadeWindow: 0.18,

  perRingRotationOffsetDeg: 6,
  spinDegPerSecond: 3,
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
  updateTunnel();

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

function updateTunnel() {
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
      el.style.transform =
        'rotate(' + (photo.angleDeg + spin) + 'deg) translateY(' + (-radius) + 'px)';
    });

    if (Math.abs(distance - CONFIG.focalOffset) < closestDist) {
      closestDist = Math.abs(distance - CONFIG.focalOffset);
      closestVisibleYear = ring.year;
    }
  });

  if (closestVisibleYear !== null) {
    yearLabel.textContent = closestVisibleYear;
  }
}

init();
