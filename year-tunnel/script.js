/* =====================================================================
   TUNNEL THROUGH TIME — year-ring scroll visualization
   =====================================================================

   THE CORE IDEA
   --------------
   Every year is a "ring" of photos arranged in a circle, each photo
   rotated so its bottom edge faces the ring's center (like numbers
   around a clock, or petals on a flower).

   Ring 0 = the most recent year (e.g. 2026) = the tunnel entrance.
   Ring 1 = one year back, etc, receding toward a vanishing point.

   Scroll position maps to a continuous "depth" number. Every ring's
   apparent size/opacity is a function of (ringIndex - depth) — its
   distance from the viewer right now. Every ring reaches the SAME
   peak size at the moment it's "in focus" (distance == focalOffset),
   so ring N always ends up exactly where ring N-1 started, and the
   very first ring at rest looks identical to how the next ring will
   look when it takes over — nothing is uniquely oversized at start.

   On top of that positional animation, every ring also has a slow,
   continuous spin (alternating direction ring to ring) that runs at
   all times, independent of scroll.
   ===================================================================== */

const CONFIG = {
  // Scroll distance (in viewport heights) to walk through one year.
  vhPerYear: 100,

  // --- Perspective math ---
  // distance = (ringIndex - depth + focalOffset)
  // Every ring hits its own peak size when distance == focalOffset.
  // Raising this number makes every ring's peak size smaller/less
  // zoomed (this is what keeps the resting/entrance view from feeling
  // too cropped-in).
  focalOffset: 1.5,
  scaleConstant: 1.0,
  maxScale: 3.2,

  baseRadiusPx: 230,
  minRadiusPx: 40,      // keeps the very center of the screen always clear

  // A photo's WIDTH (tangential/circumferential dimension) is capped
  // at this, but shrinks automatically when a ring has more photos —
  // see baselinePhotoWidth(). Height is derived per-photo from its own
  // true aspect ratio, never cropped.
  maxPhotoWidthPx: 100,
  minPhotoWidthPx: 14,
  ringFillFraction: 0.82, // <1 leaves a gap between adjacent photos

  nearFadeFullyOpaqueAt: 1.5,
  nearFadeInvisibleAt: 0.0,
  farFadeStartsAt: 3.0,
  farFadeEndsAt: 5.0,

  perRingRotationOffsetDeg: 6,

  // Continuous idle spin, always running. Alternates direction by ring
  // index (even = clockwise, odd = counterclockwise).
  spinDegPerSecond: 3,
};

let yearsData = [];
let ringEls = [];        // { container, year, spinDir, photos: [{el, img, angleDeg, aspect, aspectKnown}] }
let currentDepth = 0;
let lastFrameTime = null;
let spinAccumDeg = [];   // per-ring accumulated spin offset (degrees), grows every frame

const stage = document.getElementById('tunnel-stage');
const yearLabel = document.getElementById('year-label-text');
const spacer = document.getElementById('scroll-spacer');

// -----------------------------------------------------------------
// Load data, build DOM
// -----------------------------------------------------------------

async function init() {
  const res = await fetch('data/dataset.json');
  const data = await res.json();
  yearsData = data.years; // newest first

  buildRings();
  sizeScrollSpacer();

  window.addEventListener('resize', sizeScrollSpacer);

  lastFrameTime = performance.now();
  requestAnimationFrame(frameLoop);
}

function buildRings() {
  yearsData.forEach((yearEntry, ringIndex) => {
    const ring = document.createElement('div');
    ring.className = 'ring';
    ring.dataset.year = yearEntry.year;

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
        aspect: 1,        // width / height — placeholder until the real
        aspectKnown: false, // image loads and we learn its true ratio
      };

      img.addEventListener('load', () => {
        if (img.naturalWidth && img.naturalHeight) {
          photoState.aspect = img.naturalWidth / img.naturalHeight;
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
      spinDir: (ringIndex % 2 === 0) ? 1 : -1, // even index = clockwise
    });
    spinAccumDeg.push(0);
  });
}

// -----------------------------------------------------------------
// Scroll -> depth
// -----------------------------------------------------------------

function pixelsPerYear() {
  return window.innerHeight * (CONFIG.vhPerYear / 100);
}

function sizeScrollSpacer() {
  const totalYears = yearsData.length + 1;
  spacer.style.height = (totalYears * pixelsPerYear()) + 'px';
}

// -----------------------------------------------------------------
// Continuous animation loop — runs every frame regardless of scroll,
// so the idle spin never stops.
// -----------------------------------------------------------------

function frameLoop(now) {
  const deltaSec = Math.min((now - lastFrameTime) / 1000, 0.1); // clamp for tab-switch gaps
  lastFrameTime = now;

  ringEls.forEach((ring, i) => {
    spinAccumDeg[i] += CONFIG.spinDegPerSecond * ring.spinDir * deltaSec;
  });

  currentDepth = window.scrollY / pixelsPerYear();
  updateTunnel();

  requestAnimationFrame(frameLoop);
}

// -----------------------------------------------------------------
// Core per-frame update
// -----------------------------------------------------------------

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function opacityForDistance(dist) {
  if (dist <= CONFIG.nearFadeInvisibleAt) return 0;
  if (dist < CONFIG.nearFadeFullyOpaqueAt) {
    return clamp(
      (dist - CONFIG.nearFadeInvisibleAt) /
      (CONFIG.nearFadeFullyOpaqueAt - CONFIG.nearFadeInvisibleAt),
      0, 1
    );
  }
  if (dist <= CONFIG.farFadeStartsAt) return 1;
  if (dist < CONFIG.farFadeEndsAt) {
    return clamp(
      1 - (dist - CONFIG.farFadeStartsAt) /
          (CONFIG.farFadeEndsAt - CONFIG.farFadeStartsAt),
      0, 1
    );
  }
  return 0;
}

// Width (tangential dimension) for a photo in a ring of n photos, at
// the "reference" scale of 1.0 — computed from baseRadiusPx so caps
// apply consistently, then scaled linearly at the call site alongside
// everything else in the ring (so size grows/shrinks proportionally
// with depth, not quadratically).
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

    const rawScale = CONFIG.scaleConstant / Math.max(distance, 0.001);
    const scale = clamp(rawScale, 0.001, CONFIG.maxScale);

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
