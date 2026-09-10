/* =====================================================================
   TUNNEL THROUGH TIME — year-ring scroll visualization
   =====================================================================

   THE CORE IDEA
   --------------
   Every year is a "ring" of photos arranged in a circle, each photo
   rotated so its bottom edge faces the ring's center (like numbers
   around a clock, or petals on a flower).

   Ring 0 = the most recent year (e.g. 2026) = the tunnel entrance,
   largest and closest. Ring 1 = one year back = a bit smaller/further.
   And so on, receding toward a vanishing point in the center.

   As the user scrolls, we compute a single continuous number called
   "depth" (0, 1, 2, 3...) representing how far into the tunnel the
   viewer has walked. Every ring's size/position/opacity is a function
   of (ringIndex - depth) — its distance from the viewer right now.

   Scrolling down increases depth → everything grows/approaches → the
   front-most ring eventually grows past the viewer and fades out →
   the next ring has, by design, arrived at exactly the size/position
   the previous front ring started at. Scrolling up does the reverse.
   ===================================================================== */

const CONFIG = {
  // How much scroll distance (in "viewport heights") it takes to walk
  // through exactly one year. Bigger = slower, more gradual scroll.
  vhPerYear: 100,

  // --- Perspective math tuning ---
  // A ring's "distance from camera" is (ringIndex - depth + focalOffset).
  // focalOffset keeps that value from ever hitting exactly zero (which
  // would mean infinite scale) and sets how large a ring appears right
  // as it's "at the entrance."
  focalOffset: 0.55,

  // Scale = scaleConstant / distance. Bigger scaleConstant = bigger
  // rings overall.
  scaleConstant: 1.0,

  // Hard cap so a ring can never explode to a silly size while it's
  // passing very close to the camera (opacity should already have
  // faded it out before this becomes visible, but this is a safety net).
  maxScale: 3.2,

  // Base (scale = 1) sizing.
  baseRadiusPx: 230,
  baseImgWidthPx: 78,
  baseImgHeightPx: 104,

  // Opacity fades out a ring in TWO situations:
  // 1) It's passing very close to / has passed the camera (near fade)
  // 2) It's too deep in the tunnel to matter (far fade)
  nearFadeFullyOpaqueAt: 0.55,   // distance >= this -> fully opaque
  nearFadeInvisibleAt: 0.0,      // distance <= this -> fully transparent
  farFadeStartsAt: 3.0,          // distance <= this -> still fully opaque
  farFadeEndsAt: 5.0,            // distance >= this -> fully transparent

  // Small per-ring rotational offset (degrees) purely for visual
  // character, so rings don't all align in perfectly straight radial
  // spokes. Set to 0 to disable.
  perRingRotationOffsetDeg: 6,
};

let yearsData = [];      // loaded from data/dataset.json, index 0 = newest
let ringEls = [];        // { container, photos: [{el, angleDeg}] }
let currentDepth = 0;
let targetScrollY = 0;
let rafPending = false;

const stage = document.getElementById('tunnel-stage');
const yearLabel = document.getElementById('year-label-text');
const spacer = document.getElementById('scroll-spacer');

// -----------------------------------------------------------------
// Load data, build DOM
// -----------------------------------------------------------------

async function init() {
  const res = await fetch('data/dataset.json');
  const data = await res.json();
  yearsData = data.years; // [{year, photos: [{file, hex, palette}]}, ...] newest first

  buildRings();
  sizeScrollSpacer();
  updateTunnel(); // initial paint

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => {
    sizeScrollSpacer();
    updateTunnel();
  });
}

function buildRings() {
  yearsData.forEach((yearEntry, ringIndex) => {
    const ring = document.createElement('div');
    ring.className = 'ring';
    ring.dataset.year = yearEntry.year;

    const photoEls = yearEntry.photos.map((photo, photoIndex) => {
      const n = yearEntry.photos.length;
      const angleDeg = (360 / n) * photoIndex
        + ringIndex * CONFIG.perRingRotationOffsetDeg;

      const wrap = document.createElement('div');
      wrap.className = 'ring-photo';

      const img = document.createElement('img');
      img.src = 'photos/' + encodeURIComponent(photo.file);
      img.alt = photo.file + ' (' + yearEntry.year + ')';
      img.loading = 'lazy';
      wrap.appendChild(img);

      ring.appendChild(wrap);

      return { el: wrap, angleDeg };
    });

    stage.appendChild(ring);
    ringEls.push({ container: ring, photos: photoEls, year: yearEntry.year });
  });
}

// -----------------------------------------------------------------
// Scroll -> depth
// -----------------------------------------------------------------

function pixelsPerYear() {
  return window.innerHeight * (CONFIG.vhPerYear / 100);
}

function sizeScrollSpacer() {
  // +1 extra "year" of scroll room at the end so the final ring has
  // space to fully fade out rather than hitting the scroll limit abruptly.
  const totalYears = yearsData.length + 1;
  spacer.style.height = (totalYears * pixelsPerYear()) + 'px';
}

function onScroll() {
  if (!rafPending) {
    rafPending = true;
    requestAnimationFrame(() => {
      updateTunnel();
      rafPending = false;
    });
  }
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

function updateTunnel() {
  currentDepth = window.scrollY / pixelsPerYear();

  let closestVisibleYear = null;
  let closestDist = Infinity;

  ringEls.forEach((ring, ringIndex) => {
    const distance = (ringIndex - currentDepth) + CONFIG.focalOffset;
    const opacity = opacityForDistance(distance);

    // Skip heavy work entirely for fully-invisible rings.
    if (opacity <= 0) {
      ring.container.style.opacity = 0;
      ring.container.style.pointerEvents = 'none';
      return;
    }

    const rawScale = CONFIG.scaleConstant / Math.max(distance, 0.001);
    const scale = clamp(rawScale, 0.001, CONFIG.maxScale);

    const radius = CONFIG.baseRadiusPx * scale;
    const imgW = CONFIG.baseImgWidthPx * scale;
    const imgH = CONFIG.baseImgHeightPx * scale;

    ring.container.style.opacity = opacity;
    ring.container.style.pointerEvents = opacity > 0.05 ? 'auto' : 'none';

    ring.photos.forEach(photo => {
      const el = photo.el;
      el.style.width = imgW + 'px';
      el.style.height = imgH + 'px';
      el.style.marginLeft = (-imgW / 2) + 'px';
      el.style.marginTop = (-imgH / 2) + 'px';
      // rotate() places the photo at angleDeg around the ring center
      // AND, as a side effect of composing rotate+translate this way,
      // rotates the photo itself by the same angle — which is exactly
      // what makes its bottom edge face the center. See project notes.
      el.style.transform =
        'rotate(' + photo.angleDeg + 'deg) translateY(' + (-radius) + 'px)';
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
