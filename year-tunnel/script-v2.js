/* Tunnel script for version 2. It preserves the existing tunnel and pauses
   its animation work whenever the separate Flat view is open. */
const CONFIG = {
  vhPerYear: 100, focalOffset: 1.5, scaleConstant: 1, maxScale: 3.2,
  baseRadiusPx: 300, minRadiusPx: 24, maxPhotoWidthPx: 110,
  minPhotoWidthPx: 14, ringFillFraction: 0.82, minAspect: 2 / 3,
  maxAspect: 3 / 2, farFadeStartsAt: 3, farFadeEndsAt: 6.5,
  passedFadeWindow: 0.18, perRingRotationOffsetDeg: 6, spinDegPerSecond: 3,
  photoHoverScale: 1.12, photoPressedScale: 0.94, photoScaleLerp: 14,
  yearStartOffset: 0.2, initialDepthOffset: 0.5,
};

let yearsData = [];
let ringEls = [];
let currentDepth = 0;
let lastFrameTime = null;
let spinAccumDeg = [];
/* Set true while transition.js is driving currentDepth by hand (the
   tunnel<->flat mode-switch animation). While paused, frameLoop hands
   rendering entirely to the transition driver so the two don't fight
   over the same frame. */
let tunnelPaused = false;
const stage = document.getElementById('tunnel-stage');
const spacer = document.getElementById('scroll-spacer');
const timelineEl = document.getElementById('timeline');
const BUFFER_CYCLES = 40;
let timelineDots = [];
let lastActiveRingIndex = -1;

function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
function pixelsPerYear() { return window.innerHeight * (CONFIG.vhPerYear / 100); }
function plateauDistance() { return CONFIG.scaleConstant / CONFIG.maxScale; }
function scaleForDistance(distance) { return clamp(CONFIG.scaleConstant / Math.max(distance, 0.001), 0.001, CONFIG.maxScale); }
function baselinePhotoWidth(count) {
  return clamp((2 * Math.PI * CONFIG.baseRadiusPx / count) * CONFIG.ringFillFraction, CONFIG.minPhotoWidthPx, CONFIG.maxPhotoWidthPx);
}

function opacityForDistance(distance) {
  const plateau = plateauDistance();
  if (distance > plateau) {
    if (distance <= CONFIG.farFadeStartsAt) return 1;
    if (distance < CONFIG.farFadeEndsAt) return clamp(1 - (distance - CONFIG.farFadeStartsAt) / (CONFIG.farFadeEndsAt - CONFIG.farFadeStartsAt), 0, 1);
    return 0;
  }
  const floor = plateau - CONFIG.passedFadeWindow;
  return distance > floor ? clamp((distance - floor) / (plateau - floor), 0, 1) : 0;
}

function sizeScrollSpacer() {
  spacer.style.height = (BUFFER_CYCLES * 2 * yearsData.length * pixelsPerYear()) + 'px';
}

function buildRings() {
  const total = yearsData.length;
  yearsData.forEach((entry, ringIndex) => {
    const ring = document.createElement('div');
    ring.className = 'ring';
    ring.dataset.year = entry.year;
    ring.style.zIndex = String(total - ringIndex);
    const photos = entry.photos.map((photo, photoIndex) => {
      const wrap = document.createElement('div');
      wrap.className = 'ring-photo';
      wrap.style.cursor = 'pointer';
      const image = document.createElement('img');
      image.alt = photo.file + ' (' + entry.year + ')';
      image.loading = 'lazy';
      const state = {
        el: wrap, img: image,
        angleDeg: (360 / entry.photos.length) * photoIndex + ringIndex * CONFIG.perRingRotationOffsetDeg,
        aspect: 1, aspectKnown: false, hoverScale: 1, targetScale: 1,
        isHovering: false, ringIndex, photoIndex,
      };
      image.addEventListener('load', () => {
        if (image.naturalWidth && image.naturalHeight) {
          state.aspect = clamp(image.naturalWidth / image.naturalHeight, CONFIG.minAspect, CONFIG.maxAspect);
          state.aspectKnown = true;
        }
      });
      image.src = 'photos/' + encodeURIComponent(photo.file);
      wrap.appendChild(image);
      wrap.addEventListener('click', event => { event.stopPropagation(); openPhotoModal(state); });
      wrap.addEventListener('pointerenter', () => { state.isHovering = true; state.targetScale = CONFIG.photoHoverScale; });
      wrap.addEventListener('pointerleave', () => { state.isHovering = false; state.targetScale = 1; });
      wrap.addEventListener('pointerdown', () => { state.targetScale = CONFIG.photoPressedScale; });
      wrap.addEventListener('pointerup', () => { state.targetScale = state.isHovering ? CONFIG.photoHoverScale : 1; });
      wrap.addEventListener('pointercancel', () => { state.targetScale = state.isHovering ? CONFIG.photoHoverScale : 1; });
      ring.appendChild(wrap);
      return state;
    });
    stage.appendChild(ring);
    ringEls.push({ container: ring, photos, year: entry.year, spinDir: ringIndex % 2 === 0 ? 1 : -1 });
    spinAccumDeg.push(0);
  });
}

function updateTunnel(deltaSec, globalScale, globalOpacity) {
  if (globalScale === undefined) globalScale = 1;
  if (globalOpacity === undefined) globalOpacity = 1;
  const total = yearsData.length;
  ringEls.forEach((ring, ringIndex) => {
    const raw = ringIndex - currentDepth + CONFIG.focalOffset;
    const distance = raw - total * Math.round(raw / total);
    const opacity = opacityForDistance(distance) * globalOpacity;
    if (opacity <= 0) {
      ring.container.style.opacity = 0;
      ring.container.style.pointerEvents = 'none';
      return;
    }
    // globalScale ramps 1 -> 0 (or 0 -> 1) during the tunnel<->flat
    // transition's collapse/emerge beat, uniformly shrinking every ring
    // toward the vanishing point at the viewport's center regardless of
    // its individual depth. minRadiusPx is scaled along with it so rings
    // actually converge on the center point instead of stalling at the
    // usual floor.
    const scale = scaleForDistance(distance) * globalScale;
    const radius = Math.max(CONFIG.baseRadiusPx * scale, CONFIG.minRadiusPx * globalScale);
    const width = baselinePhotoWidth(ring.photos.length) * scale;
    ring.container.style.opacity = opacity;
    ring.container.style.pointerEvents = (globalScale < 1 || globalOpacity < 1)
      ? 'none'
      : (opacity > 0.05 ? 'auto' : 'none');
    ring.photos.forEach(photo => {
      const height = width / (photo.aspectKnown ? photo.aspect : 1);
      photo.el.style.width = width + 'px';
      photo.el.style.height = height + 'px';
      photo.el.style.marginLeft = -width / 2 + 'px';
      photo.el.style.marginTop = -height / 2 + 'px';
      photo.hoverScale += (photo.targetScale - photo.hoverScale) * Math.min(1, deltaSec * CONFIG.photoScaleLerp);
      photo.el.style.transform = 'rotate(' + (photo.angleDeg + spinAccumDeg[ringIndex]) + 'deg) translateY(' + -radius + 'px) scale(' + photo.hoverScale + ')';
    });
  });
}

function activeYearIndex() {
  const raw = Math.floor(currentDepth - CONFIG.yearStartOffset);
  return raw < 0 ? 0 : ((raw % yearsData.length) + yearsData.length) % yearsData.length;
}

function buildTimeline() {
  yearsData.forEach((entry, index) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'tl-dot';
    dot.setAttribute('aria-label', String(entry.year));
    dot.innerHTML = '<span class="tl-label">' + entry.year + '</span>';
    dot.addEventListener('click', () => {
      // If a photo is open, clicking a year on the rail should close
      // it and jump straight there, rather than requiring a separate
      // close first (the rail is the one thing still meant to be
      // usable -- see body.modal-open in style-v2.css).
      if (isModalOpen) closePhotoModal();
      const lap = Math.floor((currentDepth - CONFIG.yearStartOffset) / yearsData.length);
      window.scrollTo({ top: (lap * yearsData.length + index + CONFIG.initialDepthOffset) * pixelsPerYear(), behavior: 'smooth' });
    });
    timelineEl.appendChild(dot);
    timelineDots.push(dot);
  });
}

function updateTimelineActive() {
  const index = activeYearIndex();
  if (index === lastActiveRingIndex) return;
  if (lastActiveRingIndex >= 0) timelineDots[lastActiveRingIndex].classList.remove('is-active');
  timelineDots[index].classList.add('is-active');
  lastActiveRingIndex = index;
}

const aboutPanel = document.getElementById('about-panel');
const aboutToggle = document.getElementById('about-toggle');

const modalEl = document.getElementById('photo-modal');
const modalBackdrop = modalEl.querySelector('.modal-backdrop');
const modalClose = modalEl.querySelector('.modal-close');
const modalPhoto = modalEl.querySelector('.modal-photo');
const modalTitle = modalEl.querySelector('.meta-title');
const modalMetaList = modalEl.querySelector('.meta-list');
const modalNavPrev = modalEl.querySelector('.modal-nav-prev');
const modalNavNext = modalEl.querySelector('.modal-nav-next');
const hexBands = [modalEl.querySelector('.swatch-1'), modalEl.querySelector('.swatch-2'), modalEl.querySelector('.swatch-3')];
let isModalOpen = false;
let lastFocusedEl = null;
let modalRingIndex = -1;
let modalPhotoIndex = -1;
// Whether the currently-open photo has siblings to step through with the
// </>/ArrowLeft/ArrowRight nav -- true for a tunnel photo from a
// multi-photo ring, always false for a flat-mode photo opened via
// openStandalonePhotoModal() (see below): flat tiles aren't part of an
// orderable sequence the way a ring's photos are, each one is its own
// thing, so there's nothing sensible to page to.
let modalCanNav = false;

function textColorFor(hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.9)';
}

// Fills the modal's photo/title/meta/swatches from a plain photo record
// -- used both by fillModal() (the tunnel path, which resolves the photo
// and its already-loaded <img> off the current ring/index) and directly
// by openStandalonePhotoModal() (the flat path, which has no ring index
// to resolve, just the photo object flat-v2.js already has in hand).
function fillModalFrom(photo, year, imgSrc, imgAlt) {
  modalPhoto.src = imgSrc;
  modalPhoto.alt = imgAlt;
  modalTitle.textContent = photo.title || (photo.file || '').replace(/\.[^.]+$/, '') || String(year);
  const fields = { photographer: photo.photographer, datetime: photo.datetime || photo.date || photo.datetimeOriginal, device: photo.device, location: photo.location || photo.gps };
  modalMetaList.querySelectorAll('.meta-row').forEach(row => {
    const value = fields[row.querySelector('dd').dataset.field];
    row.querySelector('dd').textContent = value || '';
    row.style.display = value ? '' : 'none';
  });
  const palette = Array.isArray(photo.palette) ? photo.palette : [];
  hexBands.forEach((band, index) => {
    const hex = palette[index] && palette[index].hex ? palette[index].hex : '#eeeeee';
    band.style.background = hex;
    const label = band.querySelector('.swatch-label');
    label.textContent = hex.toUpperCase();
    label.style.color = textColorFor(hex);
  });
}

function fillModal() {
  const state = ringEls[modalRingIndex].photos[modalPhotoIndex];
  const entry = yearsData[modalRingIndex];
  const photo = entry.photos[modalPhotoIndex];
  fillModalFrom(photo, entry.year, state.img.src, state.img.alt);
}

// Shared tail of opening the modal, regardless of which path (tunnel
// ring photo or flat standalone photo) is opening it.
function activateModal() {
  lastFocusedEl = document.activeElement;
  document.documentElement.style.overflow = 'hidden';
  document.body.style.overflow = 'hidden';
  document.body.classList.add('modal-open');
  modalEl.classList.add('is-open');
  modalEl.setAttribute('aria-hidden', 'false');
  modalClose.focus();
}

function openPhotoModal(state) {
  if (isModalOpen) return;
  isModalOpen = true;
  modalRingIndex = state.ringIndex;
  modalPhotoIndex = state.photoIndex;
  const multiple = ringEls[modalRingIndex].photos.length > 1;
  modalCanNav = multiple;
  modalNavPrev.classList.toggle('is-hidden', !multiple);
  modalNavNext.classList.toggle('is-hidden', !multiple);
  fillModal();
  activateModal();
}

// The flat-mode equivalent of openPhotoModal() -- same popup, same
// close button / backdrop-click / Escape / background-blur behavior,
// just handed a photo directly instead of a tunnel ring index, and
// always without the </> nav (see modalCanNav above). Exposed to
// flat-v2.js as window.TunnelBridge.openPhotoModal().
function openStandalonePhotoModal(photo, year, imgSrc, imgAlt) {
  if (isModalOpen) return;
  isModalOpen = true;
  modalRingIndex = -1;
  modalPhotoIndex = -1;
  modalCanNav = false;
  modalNavPrev.classList.add('is-hidden');
  modalNavNext.classList.add('is-hidden');
  fillModalFrom(photo, year, imgSrc, imgAlt);
  activateModal();
}

function closePhotoModal() {
  if (!isModalOpen) return;
  isModalOpen = false;
  modalEl.classList.remove('is-open');
  modalEl.setAttribute('aria-hidden', 'true');
  // Flat mode holds documentElement/body overflow hidden itself for the
  // entire time it's active (see showFlatChrome()/finalizeExit() in
  // flat-v2.js), so its own canvas can pan/zoom without the page's
  // native scroll fighting it. Clearing it unconditionally here would
  // undo that the instant a flat-mode photo's modal closes, even though
  // flat mode itself hasn't ended -- body.modal-open hides the mode
  // switch (see style-v2.css) so the mode can't actually change while
  // the modal is open, meaning whatever mode-flat reads right now is
  // whichever mode was active for the whole time the modal was up.
  const stillFlat = document.body.classList.contains('mode-flat');
  document.documentElement.style.overflow = stillFlat ? 'hidden' : '';
  document.body.style.overflow = stillFlat ? 'hidden' : '';
  document.body.classList.remove('modal-open');
  if (lastFocusedEl && lastFocusedEl.focus) lastFocusedEl.focus();
}

function moveModalPhoto(direction) {
  const count = ringEls[modalRingIndex].photos.length;
  modalPhotoIndex = (modalPhotoIndex + direction + count) % count;
  fillModal();
}

function setupModalListeners() {
  modalClose.addEventListener('click', closePhotoModal);
  modalBackdrop.addEventListener('click', closePhotoModal);
  modalNavPrev.addEventListener('click', event => { event.stopPropagation(); moveModalPhoto(-1); });
  modalNavNext.addEventListener('click', event => { event.stopPropagation(); moveModalPhoto(1); });
  document.addEventListener('keydown', event => {
    if (!isModalOpen) return;
    if (event.key === 'Escape') closePhotoModal();
    // A standalone flat photo has no ring/index to page through --
    // moveModalPhoto() would be operating on stale/invalid tunnel state,
    // so the arrow keys are simply inert while one is open (matching
    // the nav buttons themselves already being hidden for it).
    if (!modalCanNav) return;
    if (event.key === 'ArrowLeft') moveModalPhoto(-1);
    if (event.key === 'ArrowRight') moveModalPhoto(1);
  });
}

function closeAboutPanel() {
  if (!aboutPanel.classList.contains('is-open')) return;
  aboutPanel.classList.remove('is-open');
  aboutToggle.setAttribute('aria-expanded', 'false');
}

// Always starts collapsed and only opens on an explicit click -- never
// auto-opens itself. Closes itself again the instant the user starts
// scrolling (a real 'scroll' event, not frameLoop's own per-frame read
// of window.scrollY) so the description doesn't sit open on top of
// photos flying past underneath it while they're mid-scroll. That same
// listener also quietly closes it for the handful of *programmatic*
// scrolls elsewhere in the app (initial scroll position, the
// tunnel<->flat transition's own scrollTo calls) -- harmless, since
// this panel is tunnel-only chrome that's already hidden/faded during
// those moments anyway.
function setupAboutPanel() {
  aboutToggle.addEventListener('click', () => {
    const open = aboutPanel.classList.toggle('is-open');
    aboutToggle.setAttribute('aria-expanded', String(open));
  });
  window.addEventListener('scroll', closeAboutPanel, { passive: true });
}

function frameLoop(now) {
  /* Flat mode has its own static rendering and gesture loop. Do not keep
     rotating or restyling 254 tunnel images underneath it — unless a
     mode transition is in flight, in which case both viewports need to
     keep rendering for the crossfade. */
  if (document.body.classList.contains('mode-flat') && !document.body.classList.contains('mode-transitioning')) {
    lastFrameTime = now;
    requestAnimationFrame(frameLoop);
    return;
  }
  const delta = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;
  if (tunnelPaused) {
    // transition.js owns currentDepth and rendering entirely right now.
    requestAnimationFrame(frameLoop);
    return;
  }
  ringEls.forEach((ring, index) => { spinAccumDeg[index] += CONFIG.spinDegPerSecond * ring.spinDir * delta; });
  currentDepth = window.scrollY / pixelsPerYear();
  updateTunnel(delta);
  updateTimelineActive();
  requestAnimationFrame(frameLoop);
}

async function init() {
  const response = await fetch('data/dataset.json');
  yearsData = (await response.json()).years;
  buildRings();
  buildTimeline();
  setupModalListeners();
  setupAboutPanel();
  sizeScrollSpacer();
  window.scrollTo(0, (BUFFER_CYCLES * yearsData.length + CONFIG.initialDepthOffset) * pixelsPerYear());
  window.addEventListener('resize', sizeScrollSpacer);
  lastFrameTime = performance.now();
  requestAnimationFrame(frameLoop);
}

init();

/* Bridge used by transition.js to drive the tunnel by hand during the
   tunnel<->flat mode-switch animation, without duplicating any of the
   tunnel's rendering math. */
window.TunnelBridge = {
  getYearsCount: () => yearsData.length,
  getCurrentDepth: () => currentDepth,
  setCurrentDepth: (depth) => { currentDepth = depth; },
  pixelsPerYear,
  setPaused: (paused) => { tunnelPaused = paused; },
  // Renders one frame at the given global scale/opacity (both default to
  // 1 for a normal frame; ramp them toward 0 to collapse the whole
  // tunnel into its vanishing point).
  renderFrame: (globalScale, globalOpacity) => {
    updateTunnel(0.016, globalScale, globalOpacity);
    updateTimelineActive();
  },
  setScrollToDepth: (depth) => { window.scrollTo(0, depth * pixelsPerYear()); },
  getViewportEl: () => document.getElementById('tunnel-viewport'),
  // Lets flat-v2.js reuse this exact modal (same close button, backdrop
  // click-to-close, Escape, background blur) for a flat-mode photo tile
  // click -- always without the </> nav, since a flat tile isn't part of
  // an orderable sequence. See openStandalonePhotoModal() above.
  openPhotoModal: openStandalonePhotoModal,
};