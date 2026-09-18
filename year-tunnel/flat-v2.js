/* FLAT MODE — VERSION 2: color tiles, hover previews, and device groups. */
(function () {
  'use strict';
  const viewport = document.getElementById('flat-viewport');
  const stage = document.getElementById('flat-stage');
  const modeSwitch = document.getElementById('mode-switch');
  const modeSwitchYear = document.getElementById('mode-switch-year');
  const modeSwitchDevice = document.getElementById('mode-switch-device');
  const modeSwitchHighlight = document.getElementById('mode-switch-highlight');
  if (!viewport || !stage || !modeSwitch || !modeSwitchYear || !modeSwitchDevice || !modeSwitchHighlight) return;

  // Slides/resizes the black pill behind whichever word is currently
  // pressed to exactly match that button's own box, so "Device" (the
  // longer word) gets a visibly wider pill than "Year". Measured live
  // off the real rendered buttons rather than hardcoded, so it's
  // correct regardless of font metrics. offsetLeft/offsetWidth are
  // relative to #mode-switch (the nearest positioned ancestor), which
  // is exactly the coordinate space #mode-switch-highlight is
  // positioned in, so no further conversion is needed.
  function syncModeSwitchHighlight() {
    const active = modeSwitchDevice.getAttribute('aria-pressed') === 'true' ? modeSwitchDevice : modeSwitchYear;
    modeSwitchHighlight.style.left = active.offsetLeft + 'px';
    modeSwitchHighlight.style.width = active.offsetWidth + 'px';
  }
  syncModeSwitchHighlight();
  // Re-measure once more after the page finishes loading and once web
  // fonts swap in -- Inter loads with font-display: swap, so the very
  // first measurement above may be taken against fallback-font metrics
  // that are a few pixels off from Inter's actual glyph widths.
  window.addEventListener('load', syncModeSwitchHighlight);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(syncModeSwitchHighlight);

  const CONFIG = {
    design: 6000, allInner: .05, allOuter: .46, packPaddingPx: 110, packIterations: 420,
    packPullX: .997, packPullY: .984,
    deviceFocusFillPx: 400, deviceFocusMinScale: 1.3, deviceFocusMaxScale: 4.2,
    flightDurationMs: 800,
    photoFraction: .012, photoMin: 60, photoMax: 180,

    // A photo tile no longer fills its whole negative-space band edge
    // to edge -- it's sized to this fraction of the band's width, so
    // there's a small, even gap above and below the circle instead of
    // it just barely grazing both bounding rings.
    photoBandFill: .82,

    deviceMinScale: .85, devicePanBaseScale: .6, maxScale: 8,
    deviceAllZone: .20,

    // The zoomed-out "All" view is deliberately nudged south a little:
    // the camera/POV sits a bit higher than dead-center on the cluster,
    // which reads as slightly friendlier than a perfectly centered shot.
    // In screen pixels (view.tx/view.ty are already screen-space), not
    // world units, so it stays a constant, subtle nudge regardless of
    // viewport size.
    allViewSouthNudgePx: 70,

    pinchIntensity: .010, trackpadPanIntensity: 1,
    spinDegPerSecond: 1.5,

    // Preview aspect — must match script-v2.js's minAspect / maxAspect
    // so a photo previews the same shape in both modes.
    previewWidth: 178,
    previewMinAspect: 2 / 3,
    previewMaxAspect: 3 / 2,
  };

  const CATEGORIES = [
    ['film', 'Film'], ['compact', 'Compact'], ['dslr', 'DSLR'],
    ['mirrorless', 'Mirrorless'], ['phone', 'Phone'], ['pro', 'Pro'], ['other', 'Other'],
  ];

  // Short blurbs for the device-group hover popup — kept in sync with
  // the actual matching patterns in classifyDevice() below, so these
  // stay accurate to what's really in each group rather than becoming
  // a vague label.
  const CATEGORY_DESCRIPTIONS = {
    film: 'Photos shot on film. Most were digitized later by a scanner (Noritsu, Coolscan) rather than a camera. Early, pre-2003 photos with no camera metadata default here too.',
    compact: 'Pocket point-and-shoot digital cameras, including Canon PowerShot & IXUS, Nikon Coolpix, Sony Cyber-shot, Olympus Stylus, Fujifilm FinePix, Kodak EasyShare, and Casio Exilim, from the early digital-camera years.',
    dslr: 'Digital SLRs with interchangeable lenses, including Canon EOS, Nikon D-series, Sony Alpha (DSLR-A / SLT-A), and Pentax K-series bodies.',
    mirrorless: 'Modern mirrorless interchangeable-lens cameras, including Sony Alpha (ILCE), Canon EOS R, Nikon Z, Olympus OM-D / OM-1, and Fujifilm X-series.',
    phone: 'Smartphone cameras, including iPhone, Galaxy, and Pixel, standing in for however most day-to-day photos get taken now.',
    pro: 'High-end professional and medium-format cameras: Hasselblad and Leica.',
    other: 'Everything that didn\'t match a known camera pattern, usually a device string this classifier doesn\'t recognize.',
  };
  let years = [], isFlat = false, baseScale = 1;
  let contentBounds = { x: 0, y: 0 };
  let highlightedFill = null, gesture = null, activeDeviceIndex = -1, homeDeviceIndex = 0;
  let deviceGroups = [];
  let ringSpinners = [], lastSpinTime = 0;
  let revealedGroupId = null;

  // GPS toggle state (add-on). gpsTiles is every geotagged photo's tile
  // element + continent, rebuilt alongside the rest of the view each time
  // buildDeviceGroups() runs. gpsGroups is the same data regrouped by
  // continent, chronological, and only for continents with 2+ photos --
  // a lone photo (Oceania, currently) still gets recolored but has no
  // thread, same as the rest of the dataset just doesn't have one yet.
  // gpsPaths holds the one persistent <path> per continent thread so
  // updateGpsLines() only ever rewrites its `d` attribute, never rebuilds
  // DOM nodes on a 60fps loop. gpsExcluded holds the continents the user
  // has clicked off in the color key -- their thread stops drawing (its
  // <path> is set back to empty) until clicked again. It's a plain
  // module-level Set rather than something rebuilt with the rest of the
  // view, so a click's effect survives a resize/re-entering flat mode.
  let gpsOn = false;
  let gpsTiles = [];
  let gpsGroups = new Map();
  let gpsPaths = new Map();
  let gpsExcluded = new Set();

  const pointers = new Map(), view = { scale: 1, tx: 0, ty: 0 };
  const sessionOffsets = new Map();
  let lastPointer = null;

  const preview = document.createElement('div');
  preview.id = 'flat-preview-v2';
  preview.innerHTML = '<img alt=""><span></span>';
  const previewImage = preview.querySelector('img');
  const previewText = preview.querySelector('span');

  const devicePreview = document.createElement('div');
  devicePreview.id = 'flat-device-preview-v2';
  devicePreview.innerHTML = '<strong></strong><p></p>';
  const devicePreviewTitle = devicePreview.querySelector('strong');
  const devicePreviewText = devicePreview.querySelector('p');

  const deviceNav = document.createElement('div');
  deviceNav.id = 'flat-device-nav-v2';
  deviceNav.innerHTML = '<button type="button" aria-label="Previous device group">&lsaquo;</button><span>Device group</span><button type="button" aria-label="Next device group">&rsaquo;</button>';
  const previousDeviceButton = deviceNav.querySelector('button:first-child');
  const deviceName = deviceNav.querySelector('span');
  const nextDeviceButton = deviceNav.querySelector('button:last-child');

  // GPS toggle button + its color key (add-on). The key's rows are filled
  // in by updateGpsKey() once the dataset is loaded, so it only ever lists
  // continents that actually have a geotagged photo in this dataset rather
  // than all seven regardless (nothing would ever explain a color that
  // can't appear anywhere on screen).
  const gpsToggle = document.createElement('button');
  gpsToggle.type = 'button';
  gpsToggle.id = 'flat-gps-toggle-v2';
  gpsToggle.setAttribute('aria-pressed', 'false');
  gpsToggle.textContent = 'GPS';

  const gpsKey = document.createElement('div');
  gpsKey.id = 'flat-gps-key-v2';
  gpsKey.setAttribute('aria-hidden', 'true');

  // Screen-space SVG overlay for the continent "threads" -- a sibling of
  // #flat-stage rather than a child of it, since the thread endpoints are
  // read straight off each tile's real on-screen position every frame
  // (see updateGpsLines()) rather than recomputed from the stage's own
  // world-space/zoom math, so it must NOT inherit the stage's transform.
  const gpsLines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  gpsLines.id = 'flat-gps-lines-v2';
  gpsLines.setAttribute('aria-hidden', 'true');

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  // A full circle expressed as its own SVG path subpath (two half-circle
  // arcs). Used to build the donut/annulus hover-fill below -- two of
  // these (outer, inner) combined under fill-rule="evenodd" paint solid
  // everywhere between them and leave the inner disc hollow.
  function circlePathD(cx, cy, r) {
    return 'M ' + (cx + r) + ' ' + cy +
      ' A ' + r + ' ' + r + ' 0 1 0 ' + (cx - r) + ' ' + cy +
      ' A ' + r + ' ' + r + ' 0 1 0 ' + (cx + r) + ' ' + cy + ' Z';
  }
  function ringFillPathD(cx, cy, outerR, innerR) {
    if (innerR <= 0) return circlePathD(cx, cy, outerR);
    return circlePathD(cx, cy, outerR) + ' ' + circlePathD(cx, cy, innerR);
  }

  function classifyDevice(device, year) {
    const value = (device || '').toLowerCase();
    if (!value) return year < 2003 ? 'film' : 'other';
    if (/noritsu|coolscan|film scanner|slide scanner/.test(value)) return 'film';
    if (/iphone|samsung sm-|galaxy|google pixel|pixel \d|huawei|motorola|moto |oneplus|htc |xiaomi|hmd |nokia|micromax|sony ericsson|blackberry/.test(value)) return 'phone';
    if (/hasselblad|leica/.test(value)) return 'pro';
    if (/ilce-|eos r\d|eos r\b|nikon z|e-m1|e-m5|e-m10|om-d|om-1|x-t\d|x-pro|finepix x/.test(value)) return 'mirrorless';
    if (/eos \d|eos-\d|nikon d\d|dslr-a|slt-a|pentax k/.test(value)) return 'dslr';
    if (/powershot|ixus|coolpix|cybershot|cyber-shot|dsc|stylus|finepix|dimage|optio|lumix|vlux|easyshare|photosmart|mavica|exilim|handycam|photopc|kodak|polaroid|benq|seiko|olympus|general imaging|traveler/.test(value)) return 'compact';
    return year < 2003 ? 'film' : 'other';
  }

  // GPS TOGGLE (add-on, flat mode only) -- classifies each geotagged photo
  // into a continent from its raw "lat, lon" `location` string, purely by
  // coordinate bounding boxes (no reverse-geocoding service, this is an
  // offline dataset). Good enough to sort a photo into the right
  // landmass; it is not meant to be authoritative at a coastline. Order
  // matters -- more specific/overlap-prone boxes are checked first (e.g.
  // Europe before the broad North America catch, so Iceland's longitude
  // doesn't get swallowed by Greenland/Canada's).
  //
  // Antarctica has no photos in this dataset (nothing on Commons is dated
  // September 3 there), so it isn't given a color slot at all -- classify
  // still recognizes lat <= -60 as Antarctica for correctness, it just
  // has nowhere to display since it's not in this list, and that freed
  // slot went to Oceania instead of a color adjacent to Africa's green.
  const CONTINENTS = [
    ['europe', 'Europe', '#3987e5'],
    ['northamerica', 'North America', '#d95926'],
    ['asia', 'Asia', '#d55181'],
    ['southamerica', 'South America', '#c98500'],
    ['africa', 'Africa', '#008300'],
    ['oceania', 'Oceania', '#9085e9'],
  ];
  const CONTINENT_COLOR = new Map(CONTINENTS.map(([id, , color]) => [id, color]));

  function classifyContinent(lat, lon) {
    if (lat <= -60) return 'antarctica';
    if (lat >= 34 && lat <= 72 && lon >= -25 && lon <= 60) return 'europe';
    if (lat >= -60 && lat <= 13 && lon >= -82 && lon <= -34) return 'southamerica';
    if (lat >= 5 && lon <= -30) return 'northamerica';
    if (lat >= -35 && lat <= 37 && lon >= -20 && lon <= 52) return 'africa';
    if (lat >= -50 && lat <= -8 && ((lon >= 110 && lon <= 180) || (lon >= -180 && lon <= -150))) return 'oceania';
    return 'asia';
  }

  // Dataset locations are always a plain "lat, lon" string under `location`
  // -- `gps` is kept as a fallback key only for forward-compatibility with
  // however fillModal() in script-v2.js reads a photo's location.
  function parseLocation(photo) {
    const raw = photo.location || photo.gps;
    if (!raw) return null;
    const m = /^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/.exec(raw);
    if (!m) return null;
    return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  }

  // Takes the specific fill <path> for the hovered ring (there's one
  // per year, living in that group's shared fills layer -- see
  // buildRingFills) rather than the ring div itself, since the fill is
  // no longer a descendant of the ring it belongs to.
  function activateRing(fillEl, year) {
    if (!fillEl) return;
    if (highlightedFill && highlightedFill !== fillEl) highlightedFill.classList.remove('is-highlighted');
    highlightedFill = fillEl;
    fillEl.classList.add('is-highlighted');
  }

  function clearRing(fillEl) {
    if (fillEl && highlightedFill !== fillEl) return;
    if (highlightedFill) highlightedFill.classList.remove('is-highlighted');
    highlightedFill = null;
  }

  function positionPreview(point) {
    lastPointer = point;
    // Measure the preview's actual rendered size — it now varies with
    // the photo's aspect, so the old hard-coded 202 / 222 constants
    // would clamp wrong for tall or wide previews.
    const w = preview.offsetWidth  || (CONFIG.previewWidth + 12);
    const h = preview.offsetHeight || (CONFIG.previewWidth + 12);
    preview.style.left = clamp(point.x + 18, 12, window.innerWidth  - w - 12) + 'px';
    preview.style.top  = clamp(point.y + 18, 12, window.innerHeight - h - 12) + 'px';
  }

  function positionDevicePreview(point) {
    const w = devicePreview.offsetWidth  || 240;
    const h = devicePreview.offsetHeight || 60;
    devicePreview.style.left = clamp(point.x + 18, 12, window.innerWidth  - w - 12) + 'px';
    devicePreview.style.top  = clamp(point.y + 18, 12, window.innerHeight - h - 12) + 'px';
  }

  function showDevicePreview(groupId, label, event) {
    devicePreviewTitle.textContent = label;
    devicePreviewText.textContent = CATEGORY_DESCRIPTIONS[groupId] || '';
    if (event) positionDevicePreview({ x: event.clientX, y: event.clientY });
    devicePreview.classList.add('is-visible');
  }

  function showPreview(photo, year, fillEl, event) {
    activateRing(fillEl, year);
    previewText.textContent = '09.03.' + year;
    previewImage.src = 'photos/' + encodeURIComponent(photo.file);
    previewImage.alt = photo.file + ' (' + year + ')';
    if (event) positionPreview({ x: event.clientX, y: event.clientY });
    preview.classList.add('is-visible');

    // Size the preview to the photo's real aspect, clamped to the same
    // range the tunnel uses so portraits and landscapes look right
    // without extreme panoramas blowing up the box.
    const applyAspect = () => {
      const w = previewImage.naturalWidth;
      const h = previewImage.naturalHeight;
      if (!w || !h) return;
      const aspect = clamp(w / h, CONFIG.previewMinAspect, CONFIG.previewMaxAspect);
      previewImage.style.height = Math.round(CONFIG.previewWidth / aspect) + 'px';
      // Re-clamp position in case the new size pushed it off-screen.
      if (lastPointer) positionPreview(lastPointer);
    };

    if (previewImage.complete && previewImage.naturalWidth) {
      applyAspect();
    } else {
      // Square while loading, then snap to the true aspect.
      previewImage.style.height = CONFIG.previewWidth + 'px';
      previewImage.addEventListener('load', applyAspect, { once: true });
    }
  }

  function leaveRing(ring, fillEl, event) {
    if (ring.contains(event.relatedTarget)) return;
    preview.classList.remove('is-visible');
    clearRing(fillEl);
  }

  let flying = false, flightId = 0;
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  function flyTo(targetWorldX, targetWorldY, targetScale, duration) {
    const startTx = view.tx, startTy = view.ty, startScale = view.scale;
    const targetTx = -targetWorldX * baseScale * targetScale;
    const targetTy = -targetWorldY * baseScale * targetScale;
    const startTime = performance.now();
    const thisFlight = ++flightId;
    flying = true;
    (function step(now) {
      if (thisFlight !== flightId) return;
      const t = Math.min(1, (now - startTime) / duration);
      const eased = easeInOutCubic(t);
      view.tx = startTx + (targetTx - startTx) * eased;
      view.ty = startTy + (targetTy - startTy) * eased;
      view.scale = startScale + (targetScale - startScale) * eased;
      applyView();
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        flying = false;
        // applyView()'s own updateDeviceFocus() call just above ran
        // while `flying` was still true, so it no-op'd -- the "is All
        // view" class (and the prominent-ring styling that depends on
        // it) never actually got applied on arrival. Run it once more
        // now that the flight has genuinely finished, so landing on
        // "All" via the arrow button looks right immediately instead
        // of only after the next manual pan/zoom nudges it.
        updateDeviceFocus();
      }
    })(startTime);
  }
  function scaleForGroup(group) {
    const raw = CONFIG.deviceFocusFillPx / (group.radius * baseScale);
    return clamp(raw, CONFIG.deviceFocusMinScale, CONFIG.deviceFocusMaxScale);
  }

  // flyTo() takes a world-space point to center on; the "All" view's
  // south nudge is specified in constant screen pixels instead (see
  // CONFIG.allViewSouthNudgePx), so this converts that pixel amount
  // into the world-space Y that lands there once flyTo does its own
  // -worldY * baseScale * scale conversion.
  function allViewWorldY() {
    return -CONFIG.allViewSouthNudgePx / (baseScale * minimumScale());
  }
  
  function updateDeviceFocus() {
    if (!deviceGroups.length || flying) return;
    const inAllZone = view.scale <= minimumScale() + CONFIG.deviceAllZone;
    viewport.classList.toggle('is-all-view', inAllZone);
    if (inAllZone) {
      activeDeviceIndex = deviceGroups.length;
      deviceName.textContent = 'All';
      setRevealedGroup(null);
      return;
    }

    const localX = -view.tx / (baseScale * view.scale);
    const localY = -view.ty / (baseScale * view.scale);
    let closest = 0, closestDistance = Infinity;
    deviceGroups.forEach((group, index) => {
      const distance = Math.hypot(localX - group.x, localY - group.y);
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = index;
      }
    });
    setRevealedGroup(deviceGroups[closest].id);
    activeDeviceIndex = closest;
    deviceName.textContent = deviceGroups[closest].label;
  }

  // Reveals the focused group's photos and hides everyone else's.
  // Image srcs are assigned lazily the first time a group is revealed,
  // and never cleared — so re-visiting a group is instant.
  function setRevealedGroup(groupId) {
    if (groupId === revealedGroupId) return;

    stage.querySelectorAll('.flat-photo-v2.is-revealed').forEach(el => {
      el.classList.remove('is-revealed');
    });

    if (groupId) {
      stage.querySelectorAll('.flat-photo-v2[data-group="' + groupId + '"]').forEach(el => {
        el.classList.add('is-revealed');
        const img = el.firstElementChild;
        if (img && !img.src && img.dataset.src) {
          img.src = img.dataset.src;
        }
      });
    }

    revealedGroupId = groupId;
  }

  function focusDevice(index) {
    if (!deviceGroups.length) return;
    const totalStops = deviceGroups.length + 1;   // +1 for the zoomed-out "All" stop
    activeDeviceIndex = ((index % totalStops) + totalStops) % totalStops;
    if (activeDeviceIndex === deviceGroups.length) {
      deviceName.textContent = 'All';
      setRevealedGroup(null);
      flyTo(0, allViewWorldY(), minimumScale(), CONFIG.flightDurationMs);
      return;
    }
    const group = deviceGroups[activeDeviceIndex];
    deviceName.textContent = group.label;
    setRevealedGroup(group.id);
    flyTo(group.x, group.y, scaleForGroup(group), CONFIG.flightDurationMs);
  }

  function buildControls() {
    previousDeviceButton.addEventListener('click', event => {
      event.stopPropagation();
      focusDevice(activeDeviceIndex - 1);
    });
    nextDeviceButton.addEventListener('click', event => {
      event.stopPropagation();
      focusDevice(activeDeviceIndex + 1);
    });
    gpsToggle.addEventListener('click', event => {
      event.stopPropagation();
      gpsOn = !gpsOn;
      gpsToggle.setAttribute('aria-pressed', String(gpsOn));
      document.body.classList.toggle('gps-on', gpsOn);
      gpsKey.classList.toggle('is-visible', gpsOn);
      gpsKey.setAttribute('aria-hidden', String(!gpsOn));
    });
    // Delegated rather than bound per-row, since updateGpsKey() rebuilds
    // the key's rows from scratch (innerHTML) every time the view does --
    // a listener on the stable #flat-gps-key-v2 container survives that,
    // where one attached to an individual row wouldn't.
    gpsKey.addEventListener('click', event => {
      event.stopPropagation();
      const row = event.target.closest('[data-continent]');
      if (!row) return;
      const continent = row.dataset.continent;
      if (gpsExcluded.has(continent)) gpsExcluded.delete(continent);
      else gpsExcluded.add(continent);
      row.setAttribute('aria-pressed', String(!gpsExcluded.has(continent)));
    });
    viewport.append(preview, devicePreview, deviceNav, gpsToggle, gpsKey, gpsLines);
  }

  // Per-ring start angle. Stable within a session, fresh on reload.
  // Keyed by group+year so the same year in two different device
  // clusters doesn't accidentally inherit the same offset.
  function ringOffset(groupId, year) {
    const key = groupId + '|' + year;
    if (!sessionOffsets.has(key)) {
      sessionOffsets.set(key, Math.random() * 360);
    }
    return sessionOffsets.get(key);
  }

    function addRing(parent, entry, yearIndex, radius, centerX, centerY, rotationOffset, groupId, ringGap, fillEl) {
    const ring = document.createElement('div');
    ring.className = 'flat-ring-v2';
    ring.dataset.year = entry.year;
    ring.style.transform = 'translate(' + centerX + 'px,' + centerY + 'px)';

    // The visible outline drawn below, at `radius`, is this year's own
    // ring position (unchanged from before). But the year's *negative
    // space* -- where its photos actually live -- is the band between
    // that outline and the previous ring in toward the center (or the
    // group's extra innermost boundary ring for the very first year).
    // Since every ring in a group is spaced exactly `ringGap` apart,
    // that band is always `ringGap` wide, centered half a gap inward
    // from this ring's own outline.
    const photoBandWidth = ringGap;
    const photoRadius = radius - ringGap / 2;

    // The hover fill for this year (the donut-shaped highlight over its
    // negative-space band) is NOT built here -- it lives in a shared
    // layer built once per group, appended to the stage before any
    // ring in that group (see buildRingFills / buildDeviceGroups), so
    // that a lit-up ring can never paint over a neighboring ring's
    // outline or year-number label. `fillEl` is just that pre-built
    // element, passed in so the interaction handlers below can toggle
    // its highlight.

    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    hit.classList.add('flat-ring-hit-v2');
    hit.setAttribute('viewBox', '0 0 ' + (radius * 2 + 20) + ' ' + (radius * 2 + 20));
    hit.style.width = radius * 2 + 20 + 'px';
    hit.style.height = radius * 2 + 20 + 'px';
    hit.style.marginLeft = -radius - 10 + 'px';
    hit.style.marginTop = -radius - 10 + 'px';

    // Visible outline with a gap at the bottom where the year label sits.
    // Font size scales gently with ring radius so the innermost and
    // outermost rings look proportionally consistent.
    const yearText = String(entry.year);
    
    const yearFontSize = 28;
    
    const estimatedLabelWidth = yearText.length * yearFontSize * 0.6 + 28;
    const gapWidth = estimatedLabelWidth + 6;
    const circumference = 2 * Math.PI * radius;
    const gapAngle = (gapWidth / circumference) * 360;

    const outline = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    outline.classList.add('flat-ring-outline-v2');
    outline.setAttribute('cx', radius + 10);
    outline.setAttribute('cy', radius + 10);
    outline.setAttribute('r', radius);
    outline.setAttribute('stroke-dasharray', (circumference - gapWidth) + ' ' + gapWidth);

    // Dash pattern starts at 3 o'clock; shift so the gap lands centered
    // on 12 o'clock (top of the ring) where the year label sits.
    outline.setAttribute('stroke-dashoffset', String(circumference * (0.25 - gapAngle / 720)));

    hit.appendChild(outline);

    // The hover target now tracks the photo band (photoRadius) rather
    // than the outline itself, so hovering anywhere in the negative
    // space where the photos actually sit -- not just exactly on the
    // boundary line -- highlights the ring. Its stroke is widened to
    // roughly the band's width so it covers that whole space.
    const hitCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    hitCircle.classList.add('flat-ring-hit-circle-v2');
    hitCircle.setAttribute('cx', radius + 10);
    hitCircle.setAttribute('cy', radius + 10);
    hitCircle.setAttribute('r', photoRadius);
    hitCircle.style.strokeWidth = Math.max(20, photoBandWidth) + 'px';
    hitCircle.addEventListener('pointerenter', () => activateRing(fillEl, entry.year));
    hitCircle.addEventListener('pointerleave', event => leaveRing(ring, fillEl, event));
    hit.appendChild(hitCircle);
    ring.appendChild(hit);

    // Year label straddles the gap at the bottom of the ring. The
    // black background covers the whole span of the gap so a passing
    // tile doesn't punch through the year while it rotates by.
    const yearLabel = document.createElement('div');
    yearLabel.className = 'flat-year-label-v2';
    yearLabel.textContent = yearText;
    yearLabel.style.top = -radius + 'px';
    yearLabel.style.fontSize = yearFontSize + 'px';
    ring.appendChild(yearLabel);



    // Sized a little smaller than the negative-space band (ringGap
    // wide) itself, so there's a bit of breathing room above and below
    // each circle instead of it exactly touching both bounding rings.
    // Still centered on the same photoRadius, so the gap is even on
    // both sides.
    const tileSize = photoBandWidth * CONFIG.photoBandFill;
    const tileData = [];
    entry.photos.forEach((photo, photoIndex) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'flat-photo-v2';
      tile.dataset.category = classifyDevice(photo.device, entry.year);
      tile.style.width = tileSize + 'px';
      tile.style.height = tileSize + 'px';
      tile.style.marginLeft = -tileSize / 2 + 'px';
      tile.style.marginTop = -tileSize / 2 + 'px';

      tile.dataset.group = groupId;

      const img = document.createElement('img');
      img.alt = '';
      img.dataset.src = 'photos/' + encodeURIComponent(photo.file);
      tile.appendChild(img);

      // GPS toggle add-on: a geotagged photo's tile gets a CSS custom
      // property holding its continent's color. style-v2.css reads it
      // (via body.gps-on rules) to recolor the WHOLE tile while it's
      // just a plain circle, and to recolor its border instead once it's
      // the revealed group's actual photo (a solid fill would be
      // invisible under the real image). The tile's plain default
      // background (white, whenever GPS mode is off or a photo has no
      // location) lives in style-v2.css now instead of being set here,
      // so there's nothing to override when GPS mode is off.
      const coord = parseLocation(photo);
      if (coord) {
        const continent = classifyContinent(coord.lat, coord.lon);
        const color = CONTINENT_COLOR.get(continent);
        // classifyContinent() can still return 'antarctica' (correct --
        // lat <= -60 really is Antarctica), but it has no color slot
        // since nothing in this dataset is ever there; skip rather than
        // set an invalid custom-property value on the rare chance it
        // ever does classify that way.
        if (color) {
          tile.dataset.continent = continent;
          tile.style.setProperty('--tile-continent-color', color);
          gpsTiles.push({ el: tile, year: entry.year, continent });
        }
      }

      const angle = 360 / entry.photos.length * photoIndex + rotationOffset;

      tile.style.transform = 'rotate(' + angle + 'deg) translateY(' + -photoRadius + 'px)';
      tile.setAttribute('aria-label', photo.file + ', September 3, ' + entry.year);
      tile.addEventListener('pointerenter', event => showPreview(photo, entry.year, fillEl, event));

      tile.addEventListener('pointermove', event => positionPreview({ x: event.clientX, y: event.clientY }));


      tile.addEventListener('pointerleave', event => leaveRing(ring, fillEl, event));
      tile.addEventListener('focus', () => showPreview(photo, entry.year, fillEl));
      tile.addEventListener('blur', () => {
        preview.classList.remove('is-visible');
        clearRing(fillEl);
      });
      // Same photo-detail popup the tunnel uses (close button, click the
      // backdrop to dismiss, Escape, blurred background -- all of that
      // lives in script-v2.js's modal and is untouched here), reused via
      // the TunnelBridge rather than built a second time. Always opened
      // without the </> nav: a flat tile isn't a step in an orderable
      // sequence the way a tunnel ring's photos are, each one here is
      // standalone. This fires for a tile whether or not its group is
      // currently revealed, same as the hover preview above already
      // does off the same `photo` object regardless of reveal state.
      tile.addEventListener('click', event => {
        event.stopPropagation();
        if (window.TunnelBridge && window.TunnelBridge.openPhotoModal) {
          window.TunnelBridge.openPhotoModal(
            photo,
            entry.year,
            'photos/' + encodeURIComponent(photo.file),
            photo.file + ' (' + entry.year + ')'
          );
        }
      });
      ring.appendChild(tile);
      tileData.push({ el: tile, baseAngle: angle });
    });
    ringSpinners.push({
      tiles: tileData,
      radius: photoRadius,
      direction: yearIndex % 2 === 0 ? 1 : -1,
      spin: 0,
    });
    parent.appendChild(ring);
    return ring;
  }

  // A plain, static outline with no year, label, or photos of its own --
  // added just inside each group's smallest year ring so that year gets
  // a negative-space band to sit in too, the same as every other year.
  // It also doubles as the hit area for the group-name hover/focus
  // popup: a filled (but invisible) circle the same size as the outline,
  // covering the whole inner disc the device-name label sits inside of
  // rather than just the label's own text box -- moving the pointer
  // anywhere in that empty space opens the popup, not only when it's
  // exactly over the letters. groupId/label are only used to wire that
  // trigger; passing them in keeps that logic next to the radius/shape
  // math it depends on, the same way addRing() already wires its own
  // hover handlers right where its geometry is built.
  function addBoundaryRing(parent, radius, centerX, centerY, groupId, label) {
    const ring = document.createElement('div');
    ring.className = 'flat-ring-v2 flat-ring-boundary-v2';
    ring.style.transform = 'translate(' + centerX + 'px,' + centerY + 'px)';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('flat-ring-hit-v2');
    svg.setAttribute('viewBox', '0 0 ' + (radius * 2 + 20) + ' ' + (radius * 2 + 20));
    svg.style.width = radius * 2 + 20 + 'px';
    svg.style.height = radius * 2 + 20 + 'px';
    svg.style.marginLeft = -radius - 10 + 'px';
    svg.style.marginTop = -radius - 10 + 'px';

    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    hit.classList.add('flat-group-hit-v2');
    hit.setAttribute('cx', radius + 10);
    hit.setAttribute('cy', radius + 10);
    hit.setAttribute('r', radius);
    hit.addEventListener('pointerenter', event => showDevicePreview(groupId, label, event));
    hit.addEventListener('pointermove', event => positionDevicePreview({ x: event.clientX, y: event.clientY }));
    hit.addEventListener('pointerleave', () => devicePreview.classList.remove('is-visible'));
    svg.appendChild(hit);

    const outline = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    outline.classList.add('flat-ring-outline-v2');
    outline.setAttribute('cx', radius + 10);
    outline.setAttribute('cy', radius + 10);
    outline.setAttribute('r', radius);
    svg.appendChild(outline);
    ring.appendChild(svg);

    parent.appendChild(ring);
    return ring;
  }

  // Every year in a group gets its hover-fill donut built here, all at
  // once, in one shared SVG layer appended to the stage before any of
  // that group's actual rings (outlines, year labels, photos). DOM
  // paint order is back-to-front, so this guarantees every fill paints
  // *underneath* every outline and year label -- including a neighbor
  // ring's, at the shared boundary line two adjacent years' bands meet
  // at -- rather than the two being interleaved ring-by-ring, which is
  // what let a hovered ring's fill cover the ring just inside it.
  // Returns a year -> <path> map so addRing's interaction handlers can
  // toggle the right one.
  function buildRingFills(parent, chronological, startRadius, ringGap, groupRadius, centerX, centerY) {
    const wrap = document.createElement('div');
    wrap.className = 'flat-ring-v2 flat-ring-fills-v2';
    wrap.style.transform = 'translate(' + centerX + 'px,' + centerY + 'px)';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('flat-ring-hit-v2');
    svg.setAttribute('viewBox', '0 0 ' + (groupRadius * 2 + 20) + ' ' + (groupRadius * 2 + 20));
    svg.style.width = groupRadius * 2 + 20 + 'px';
    svg.style.height = groupRadius * 2 + 20 + 'px';
    svg.style.marginLeft = -groupRadius - 10 + 'px';
    svg.style.marginTop = -groupRadius - 10 + 'px';
    wrap.appendChild(svg);

    // One shared coordinate space (sized to the group's own outermost
    // ring) instead of each ring's private, differently-sized box, so
    // a single constant center point works for every year's path here.
    const cx = groupRadius + 10, cy = groupRadius + 10;
    const fillEls = new Map();
    chronological.forEach(([year], yearIndex) => {
      const outerR = startRadius + yearIndex * ringGap;
      const innerR = Math.max(0, outerR - ringGap);
      const fill = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      fill.classList.add('flat-ring-fill-v2');
      fill.dataset.year = year;
      fill.setAttribute('d', ringFillPathD(cx, cy, outerR, innerR));
      svg.appendChild(fill);
      fillEls.set(year, fill);
    });

    parent.appendChild(wrap);
    return fillEls;
  }

  function packDeviceCircles(groups) {
    // Force-based packing: golden-angle spiral seed, then resolve
    // overlaps while an anisotropic pull settles everything into a
    // wide organic cluster (X barely reined in, Y pulled in harder).
    const n = groups.length;
    groups.forEach((g, i) => {
      const angle = i * 2.399963;
      const spiralR = Math.sqrt(i + 1) * (g.radius * 0.7 + 50);
      g.x = Math.cos(angle) * spiralR;
      g.y = Math.sin(angle) * spiralR;
    });
    for (let iter = 0; iter < CONFIG.packIterations; iter++) {
      groups.forEach(g => {
        g.x *= CONFIG.packPullX;
        g.y *= CONFIG.packPullY;
      });
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = groups[i], b = groups[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 0.01;
          const minDist = a.radius + b.radius + CONFIG.packPaddingPx;
          if (dist < minDist) {
            const overlap = (minDist - dist) / 2;
            const nx = dx / dist, ny = dy / dist;
            a.x -= nx * overlap; a.y -= ny * overlap;
            b.x += nx * overlap; b.y += ny * overlap;
          }
        }
      }
    }
  }

  function buildDeviceGroups() {
    deviceGroups = [];
    activeDeviceIndex = -1;
    gpsTiles = [];
    const groups = CATEGORIES.map(([id, label], order) => ({ id, label, order, byYear: new Map() }));
    const groupById = new Map(groups.map(group => [group.id, group]));
    years.forEach(entry => entry.photos.forEach(photo => {
      const group = groupById.get(classifyDevice(photo.device, entry.year));
      if (!group.byYear.has(entry.year)) group.byYear.set(entry.year, []);
      group.byYear.get(entry.year).push(photo);
    }));
    const chronologicalAll = [...years].sort((a, b) => a.year - b.year);
    const ringGap = CONFIG.design * (CONFIG.allOuter - CONFIG.allInner) / Math.max(1, chronologicalAll.length - 1);
    const startRadius = CONFIG.design * CONFIG.allInner;
    const active = groups.filter(group => group.byYear.size).map(group => {
      const chronological = Array.from(group.byYear.entries()).sort((a, b) => a[0] - b[0]);
      return { ...group, chronological, radius: startRadius + ringGap * (chronological.length - 1) };
    });
    packDeviceCircles(active);

    // Pass 1: every group's hover-fill layer, all appended before any
    // group's outlines/labels/photos. See buildRingFills for why this
    // has to be a separate first pass rather than folded into the loop
    // below (a fill built inline, ring-by-ring, would still paint over
    // *other* groups' or even that same group's earlier rings).
    const fillElsByGroup = new Map();
    active.forEach(group => {
      fillElsByGroup.set(group.id, buildRingFills(stage, group.chronological, startRadius, ringGap, group.radius, group.x, group.y));
    });

    let maxX = 0, maxY = 0;
    active.forEach(group => {
      const { x, y, radius, label } = group;
      // Pointer hover is now handled by the hit circle addBoundaryRing()
      // builds below (the whole inner disc, not just this text), so the
      // label itself only still needs tabindex + focus/blur for keyboard
      // access -- someone tabbing to it should still get the same popup
      // a mouse hovering the circle would.
      const deviceLabel = document.createElement('div');
      deviceLabel.className = 'flat-device-label-v2';
      deviceLabel.textContent = label;
      deviceLabel.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      deviceLabel.setAttribute('tabindex', '0');
      deviceLabel.addEventListener('focus', () => showDevicePreview(group.id, label));
      deviceLabel.addEventListener('blur', () => devicePreview.classList.remove('is-visible'));
      stage.appendChild(deviceLabel);

      const groupRingEls = [];

      // One extra ring just inside the group's smallest year, purely so
      // that year also gets a negative-space band to sit in (its own
      // ring, at startRadius, would otherwise have nothing bounding it
      // on the inside). Also the hover trigger for the group-name popup
      // -- see addBoundaryRing().
      const boundaryRingEl = addBoundaryRing(stage, Math.max(0, startRadius - ringGap), x, y, group.id, label);
      groupRingEls.push(boundaryRingEl);

      const fillEls = fillElsByGroup.get(group.id);
      group.chronological.forEach(([year, photos], yearIndex) => {
        const ringEl = addRing(stage, { year, photos }, yearIndex, startRadius + yearIndex * ringGap, x, y, ringOffset(group.id, year), group.id, ringGap, fillEls.get(year));
        groupRingEls.push(ringEl);
      });

      deviceGroups.push({ id: group.id, label: group.label, order: group.order, x, y, radius: group.radius, ringEls: groupRingEls, labelEl: deviceLabel });
      maxX = Math.max(maxX, Math.abs(x) + radius);
      maxY = Math.max(maxY, Math.abs(y) + radius + 130);
    });
    deviceGroups.sort((a, b) => a.order - b.order);
    contentBounds = { x: maxX, y: maxY };
    
    // Film is always the startup group, regardless of where the
    // packing algorithm happened to settle it.
    const filmIndex = deviceGroups.findIndex(g => g.id === 'film');
    homeDeviceIndex = filmIndex >= 0 ? filmIndex : 0;

    rebuildGpsGroups();
    updateGpsKey();
  }

  // Regroups gpsTiles (rebuilt just above, fresh DOM every time) by
  // continent, chronological, keeping only continents with 2+ geotagged
  // photos -- a single photo (Oceania, currently) still gets its core dot
  // via CSS, it just has nothing to draw a line to. Also drops every old
  // <path>: buildDeviceGroups() replaces the whole stage's DOM on every
  // call (dataset load, resize, re-entering flat mode), so any <path>
  // left over from before would be threading tile elements that no longer
  // exist.
  function rebuildGpsGroups() {
    const byContinent = new Map();
    gpsTiles.forEach(t => {
      if (!byContinent.has(t.continent)) byContinent.set(t.continent, []);
      byContinent.get(t.continent).push(t);
    });
    gpsGroups = new Map();
    byContinent.forEach((list, continent) => {
      if (list.length < 2) return;
      list.sort((a, b) => a.year - b.year);
      gpsGroups.set(continent, list);
    });
    gpsLines.replaceChildren();
    gpsPaths = new Map();
  }

  // Fills in the color key from whichever continents are actually present
  // in this dataset (in the fixed CONTINENTS order), rather than always
  // listing all six -- so it never explains a color that has nothing to
  // show for it. A continent with just one photo (no thread) still gets a
  // row, since its tile color alone is still something the key should
  // name. Each row is its own <button>, clickable to toggle that
  // continent's thread on/off (see the delegated click handler in
  // buildControls()) -- aria-pressed carries the selected/deselected
  // state and is what style-v2.css dims on. Rebuilding this wholesale
  // (rather than patching individual rows) is fine even though it runs on
  // every buildDeviceGroups() call: gpsExcluded is what actually holds
  // the user's chosen state, and it isn't touched here, so a rebuilt row
  // just re-renders the same selected/deselected look it already had.
  function updateGpsKey() {
    const present = new Set(gpsTiles.map(t => t.continent));
    gpsKey.innerHTML = CONTINENTS
      .filter(([id]) => present.has(id))
      .map(([id, label, color]) =>
        '<button type="button" class="flat-gps-key-row-v2" data-continent="' + id + '" aria-pressed="' + String(!gpsExcluded.has(id)) + '">' +
          '<span class="flat-gps-key-swatch-v2" style="background:' + color + '"></span>' +
          '<span>' + label + '</span>' +
        '</button>'
      ).join('');
  }

  // Reads each geotagged tile's REAL current screen position (however it
  // got there -- spin, pan, zoom, or an entrance/exit flight, all read
  // straight off the rendered DOM rather than re-derived from world-space
  // math) and redraws that continent's thread through them in year order.
  // Called every frame from spinLoop() while the toggle is on, which is
  // the whole point: the same continuous tile motion that already existed
  // just carries the lines along with it.
  function updateGpsLines() {
    if (!gpsGroups.size) return;
    gpsGroups.forEach((list, continent) => {
      let path = gpsPaths.get(continent);
      if (gpsExcluded.has(continent)) {
        // Deselected in the key: clear the path rather than removing the
        // element, so re-selecting it doesn't need to recreate anything
        // and the very next frame just fills `d` back in.
        if (path) path.setAttribute('d', '');
        return;
      }
      if (!path) {
        path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'flat-gps-thread-v2');
        path.setAttribute('stroke', CONTINENT_COLOR.get(continent));
        gpsLines.appendChild(path);
        gpsPaths.set(continent, path);
      }
      let d = '';
      list.forEach((tile, i) => {
        const rect = tile.el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        d += (i === 0 ? 'M ' : 'L ') + x + ' ' + y + ' ';
      });
      path.setAttribute('d', d.trim());
    });
  }

  function buildView() {
    stage.replaceChildren();
    ringSpinners = [];
    revealedGroupId = null;
    if (!years.length) return;
    baseScale = Math.min(window.innerWidth, window.innerHeight) / CONFIG.design;
    buildDeviceGroups();
    clampView();
    applyView();
  }

  function minimumScale() { return CONFIG.deviceMinScale; }
  function applyView() {
    stage.style.transform = 'translate(' + view.tx + 'px,' + view.ty + 'px) scale(' + baseScale * view.scale + ')';
    updateDeviceFocus();
  }

  function spinLoop(now) {
    const dt = Math.min((now - lastSpinTime) / 1000, 0.1);
    lastSpinTime = now;
    if (isFlat) {
      ringSpinners.forEach(spinner => {
        spinner.spin += CONFIG.spinDegPerSecond * spinner.direction * dt;
        spinner.tiles.forEach(({ el, baseAngle }) => {
          el.style.transform =
            'rotate(' + (baseAngle + spinner.spin) + 'deg)' +
            ' translateY(' + -spinner.radius + 'px)';
        });
      });
      // Runs after the spin/pan/zoom writes just above, so this is one
      // batched layout read per frame (getBoundingClientRect inside
      // updateGpsLines) rather than interleaved read/write thrashing.
      if (gpsOn) updateGpsLines();
    }
    requestAnimationFrame(spinLoop);
  }

  function clampView() {
    view.scale = clamp(view.scale, minimumScale(), CONFIG.maxScale);
    const travelX = contentBounds.x * baseScale * view.scale;
    const travelY = contentBounds.y * baseScale * view.scale;
    view.tx = clamp(view.tx, -travelX, travelX);
    view.ty = clamp(view.ty, -travelY, travelY);
  }
  // Double-click resets the camera back to whatever group (or "All")
  // is currently focused, not always the very first "film" stop --
  // it's meant to un-do drift from panning/zooming around within the
  // current group, landing back on that group's own default framing.
  // Only the very first time flat mode is entered, before the user has
  // focused anything, is there no "current" group yet, so that one
  // case still falls back to the home group.
  function resetView() {
    if (!deviceGroups.length) return;
    const index = activeDeviceIndex >= 0 ? activeDeviceIndex : homeDeviceIndex;
    focusDevice(index);
  }

  function pairMetrics() {
    const [one, two] = Array.from(pointers.values());
    return {
      x: (one.x + two.x) / 2,
      y: (one.y + two.y) / 2,
      distance: Math.hypot(two.x - one.x, two.y - one.y) || 1,
    };
  }
  function beginMulti() {
    const metric = pairMetrics();
    gesture = { type: 'multi', ...metric, scale: view.scale, tx: view.tx, ty: view.ty };
    viewport.classList.add('is-dragging');
  }
  function onPointerDown(event) {
    // Photo tiles need to be excluded the same way the other buttons
    // already are: viewport.setPointerCapture() below redirects the
    // pointer's subsequent events to `viewport` itself, and in real
    // browsers that also breaks native `click` synthesis on whatever was
    // actually pressed (the click ends up not firing on the tile at
    // all) -- a jsdom test dispatching a synthetic click straight at the
    // tile can't catch this, since it skips pointer capture entirely.
    // Letting the tile handle its own pointerdown means a drag/pan
    // gesture can no longer be STARTED with the very first touch on a
    // tile (same trade-off device-nav/gps-toggle/gps-key already make),
    // but dragging from anywhere else still works normally.
    if (!isFlat || event.target.closest('#flat-device-nav-v2') || event.target.closest('#flat-gps-toggle-v2') || event.target.closest('#flat-gps-key-v2') || event.target.closest('.flat-photo-v2')) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { viewport.setPointerCapture(event.pointerId); } catch (_) {}
    if (pointers.size === 1) {
      gesture = { type: 'single', id: event.pointerId, x: event.clientX, y: event.clientY, tx: view.tx, ty: view.ty };
      viewport.classList.add('is-dragging');
    } else beginMulti();
  }
  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gesture && gesture.type === 'single' && gesture.id === event.pointerId) {
      view.tx = gesture.tx + event.clientX - gesture.x;
      view.ty = gesture.ty + event.clientY - gesture.y;
    } else if (gesture && gesture.type === 'multi' && pointers.size >= 2) {
      const metric = pairMetrics();
      const nextScale = clamp(gesture.scale * metric.distance / gesture.distance, minimumScale(), CONFIG.maxScale);
      const ratio = nextScale / gesture.scale;
      view.scale = nextScale;
      view.tx = metric.x - (gesture.x - gesture.tx) * ratio;
      view.ty = metric.y - (gesture.y - gesture.ty) * ratio;
    } else return;
    clampView();
    applyView();
  }
  function onPointerUp(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    try { viewport.releasePointerCapture(event.pointerId); } catch (_) {}
    if (pointers.size === 1) {
      const [id, point] = Array.from(pointers.entries())[0];
      gesture = { type: 'single', id, x: point.x, y: point.y, tx: view.tx, ty: view.ty };
    } else {
      gesture = null;
      viewport.classList.remove('is-dragging');
    }
  }
  function onWheel(event) {
    if (!isFlat) return;
    event.preventDefault();
    if (event.ctrlKey) {
      // Browsers set ctrlKey on the wheel event a trackpad pinch
      // produces specifically so it can be told apart from an
      // ordinary two-finger scroll/swipe (which reports ctrlKey:
      // false) -- that's the real signal for "the user is pinching",
      // not just "a wheel event happened". Zoom, centered on the
      // cursor, same as before.
      const nextScale = clamp(view.scale * Math.exp(-event.deltaY * CONFIG.pinchIntensity), minimumScale(), CONFIG.maxScale);
      const ratio = nextScale / view.scale;
      const x = event.clientX - window.innerWidth / 2;
      const y = event.clientY - window.innerHeight / 2;
      view.tx = x - (x - view.tx) * ratio;
      view.ty = y - (y - view.ty) * ratio;
      view.scale = nextScale;
    } else {
      // A plain two-finger swipe now pans instead of zooming, so it
      // reads as a smoother version of click-and-drag rather than a
      // separate zoom gesture. (An ordinary mouse scroll wheel is
      // indistinguishable from a trackpad swipe at the wheel-event
      // level, so it now pans too -- there's no reliable way to tell
      // the two apart from here.) The sign matches the browser's own
      // scrollLeft/scrollTop += delta convention, which -- with
      // natural scrolling, the default -- already tracks the fingers
      // the same way a drag does.
      view.tx -= event.deltaX * CONFIG.trackpadPanIntensity;
      view.ty -= event.deltaY * CONFIG.trackpadPanIntensity;
    }
    clampView();
    applyView();
  }

  // Mode switching itself (the toggle click) is owned by transition.js,
  // which orchestrates the tunnel<->flat animation and calls the
  // entrance/exit primitives below through window.Flat. Flat mode never
  // snaps in/out on its own anymore.

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInCubic(t) { return t * t * t; }
  // A gentle overshoot-then-settle curve, used so each ring "pops" open
  // a touch past full size before relaxing back — it reads as growth
  // with a little life in it rather than a flat linear scale-up.
  function easeOutBack(t) {
    const c = 1.4;
    const p = t - 1;
    return 1 + c * p * p * p + c * p * p;
  }

  function showFlatChrome() {
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    document.body.classList.add('mode-flat');
    viewport.setAttribute('aria-hidden', 'false');
    modeSwitch.classList.add('is-device');
    modeSwitchYear.setAttribute('aria-pressed', 'false');
    modeSwitchDevice.setAttribute('aria-pressed', 'true');
    syncModeSwitchHighlight();
    isFlat = true;
  }

  // Lays out the flat DOM and camera at rest on `targetId` (or the home
  // group if targetId doesn't exist), but does NOT reveal anything yet —
  // every ring is left fully hidden so playEntrance() can animate it in.
  // Returns the id of the group the entrance should grow from the
  // center of the screen (the group the camera is centered on).
  function prepareEntrance(targetId) {
    showFlatChrome();
    viewport.style.pointerEvents = 'none';
    buildView();
    const group = deviceGroups.find(g => g.id === targetId) || deviceGroups[homeDeviceIndex] || null;
    if (group) {
      view.scale = scaleForGroup(group);
      view.tx = -group.x * baseScale * view.scale;
      view.ty = -group.y * baseScale * view.scale;
    } else {
      view.scale = minimumScale();
      view.tx = 0;
      view.ty = CONFIG.allViewSouthNudgePx;
    }
    clampView();
    applyView();
    return group ? group.id : null;
  }

  // Same idea, but at rest in the fully-zoomed-out "All" view. Returns
  // the id of whichever group sits closest to the world origin, since
  // that's the one the transition should grow from the screen's center.
  function prepareAllViewEntrance() {
    showFlatChrome();
    viewport.style.pointerEvents = 'none';
    buildView();
    view.scale = minimumScale();
    view.tx = 0;
    view.ty = CONFIG.allViewSouthNudgePx;
    clampView();
    applyView();
    return getClosestGroupToView();
  }

  function getClosestGroupToView() {
    if (!deviceGroups.length) return null;
    const localX = -view.tx / (baseScale * view.scale);
    const localY = -view.ty / (baseScale * view.scale);
    let closest = deviceGroups[0], best = Infinity;
    deviceGroups.forEach(group => {
      const distance = Math.hypot(localX - group.x, localY - group.y);
      if (distance < best) { best = distance; closest = group; }
    });
    return closest.id;
  }

  // Grows anchorId's rings out from the screen's center (the camera is
  // already centered on it) while every other group's rings fly in from
  // just off-screen to their packed positions. Returns a promise that
  // resolves once everything has settled.
  function playEntrance(anchorId, duration) {
    return new Promise(resolve => {
      const anchor = deviceGroups.find(g => g.id === anchorId) || null;
      const others = deviceGroups.filter(g => g.id !== anchorId);
      if (anchor) setRevealedGroup(anchor.id);

      const span = (Math.max(window.innerWidth, window.innerHeight) / (baseScale * view.scale)) * 0.85;
      const starts = others.map(group => {
        let dx = anchor ? group.x - anchor.x : group.x;
        let dy = anchor ? group.y - anchor.y : group.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        return { group, sx: group.x + dx * span, sy: group.y + dy * span };
      });

      // Initial (pre-first-frame) state: anchor collapsed to a point at
      // its own center, everyone else parked off-screen — set
      // synchronously so there's no one-frame flash of the finished
      // layout before the animation takes over.
      if (anchor) {
        anchor.ringEls.forEach(ring => {
          ring.style.transform = 'translate(' + anchor.x + 'px,' + anchor.y + 'px) scale(0)';
          ring.style.opacity = '0';
        });
        anchor.labelEl.style.opacity = '0';
      }
      starts.forEach(({ group, sx, sy }) => {
        group.ringEls.forEach(ring => {
          ring.style.transform = 'translate(' + sx + 'px,' + sy + 'px)';
          ring.style.opacity = '0';
        });
        group.labelEl.style.opacity = '0';
      });

      const anchorStagger = anchor ? Math.min(22, duration / (anchor.ringEls.length + 1) / 2) : 0;
      const start = performance.now();
      function step(now) {
        const t = Math.min(1, (now - start) / duration);
        if (anchor) {
          const span2 = Math.max(1, duration - anchorStagger * anchor.ringEls.length);
          anchor.ringEls.forEach((ring, i) => {
            const localT = clamp((t * duration - i * anchorStagger) / span2, 0, 1);
            const p = easeOutBack(localT);
            ring.style.transform = 'translate(' + anchor.x + 'px,' + anchor.y + 'px) scale(' + Math.max(0, p) + ')';
            ring.style.opacity = String(clamp(localT * 1.6, 0, 1));
          });
          const labelT = easeOutCubic(t);
          anchor.labelEl.style.opacity = String(labelT);
        }
        starts.forEach(({ group, sx, sy }) => {
          const p = easeOutCubic(t);
          const x = sx + (group.x - sx) * p;
          const y = sy + (group.y - sy) * p;
          group.ringEls.forEach(ring => {
            ring.style.transform = 'translate(' + x + 'px,' + y + 'px)';
            ring.style.opacity = String(p);
          });
          group.labelEl.style.transform = 'translate(' + x + 'px,' + y + 'px)';
          group.labelEl.style.opacity = String(p);
        });
        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          if (anchor) {
            anchor.ringEls.forEach(ring => {
              ring.style.transform = 'translate(' + anchor.x + 'px,' + anchor.y + 'px)';
              ring.style.opacity = '';
            });
            anchor.labelEl.style.opacity = '';
          }
          starts.forEach(({ group }) => {
            group.ringEls.forEach(ring => {
              ring.style.transform = 'translate(' + group.x + 'px,' + group.y + 'px)';
              ring.style.opacity = '';
            });
            group.labelEl.style.opacity = '';
          });
          viewport.style.pointerEvents = '';
          resolve();
        }
      }
      requestAnimationFrame(step);
    });
  }

  // Reverse of playEntrance: whichever group is currently settled on
  // (or, in the all-zoomed-out view, whichever is closest to center)
  // collapses back into the screen's center while every other group
  // flies back out off-screen.
  function playExit(duration) {
    return new Promise(resolve => {
      const settled = getSettledTarget();
      const anchorId = settled.type === 'group' ? settled.id : getClosestGroupToView();
      const anchor = deviceGroups.find(g => g.id === anchorId) || null;
      const others = deviceGroups.filter(g => g.id !== anchorId);

      const span = (Math.max(window.innerWidth, window.innerHeight) / (baseScale * view.scale)) * 0.85;
      const ends = others.map(group => {
        let dx = anchor ? group.x - anchor.x : group.x;
        let dy = anchor ? group.y - anchor.y : group.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        return { group, ex: group.x + dx * span, ey: group.y + dy * span };
      });

      viewport.style.pointerEvents = 'none';
      const start = performance.now();
      function step(now) {
        const t = Math.min(1, (now - start) / duration);
        const p = easeInCubic(t);
        if (anchor) {
          anchor.ringEls.forEach(ring => {
            ring.style.transform = 'translate(' + anchor.x + 'px,' + anchor.y + 'px) scale(' + Math.max(0, 1 - p) + ')';
            ring.style.opacity = String(1 - p);
          });
          anchor.labelEl.style.opacity = String(1 - p);
        }
        ends.forEach(({ group, ex, ey }) => {
          const x = group.x + (ex - group.x) * p;
          const y = group.y + (ey - group.y) * p;
          group.ringEls.forEach(ring => {
            ring.style.transform = 'translate(' + x + 'px,' + y + 'px)';
            ring.style.opacity = String(1 - p);
          });
          group.labelEl.style.transform = 'translate(' + x + 'px,' + y + 'px)';
          group.labelEl.style.opacity = String(1 - p);
        });
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
  }

  function isAllView() {
    return !deviceGroups.length || view.scale <= minimumScale() + CONFIG.deviceAllZone;
  }

  function getSettledTarget() {
    if (isAllView()) return { type: 'all' };
    const id = (activeDeviceIndex >= 0 && activeDeviceIndex < deviceGroups.length) ? deviceGroups[activeDeviceIndex].id : null;
    return id ? { type: 'group', id } : { type: 'all' };
  }

  function finalizeExit() {
    pointers.clear();
    gesture = null;
    lastPointer = null;
    preview.classList.remove('is-visible');
    devicePreview.classList.remove('is-visible');
    clearRing();
    viewport.classList.remove('is-dragging');
    viewport.style.pointerEvents = '';
    document.body.classList.remove('mode-flat');
    viewport.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    modeSwitch.classList.remove('is-device');
    modeSwitchYear.setAttribute('aria-pressed', 'true');
    modeSwitchDevice.setAttribute('aria-pressed', 'false');
    syncModeSwitchHighlight();
    isFlat = false;
  }

  // Bridge used by transition.js to orchestrate the tunnel<->flat
  // animation. Ordinary in-flat panning/zooming/clicking still goes
  // through the internal functions above directly.
  window.Flat = {
    isReady: () => years.length > 0,
    isActive: () => isFlat,
    getDeviceGroupIds: () => deviceGroups.map(g => g.id),
    getHomeGroupId: () => (deviceGroups[homeDeviceIndex] || {}).id || null,
    isAllView,
    getClosestGroupToView,
    getSettledTarget,
    flyToGroupId: (id, duration) => {
      const group = deviceGroups.find(g => g.id === id);
      if (!group) return Promise.resolve();
      activeDeviceIndex = deviceGroups.indexOf(group);
      deviceName.textContent = group.label;
      setRevealedGroup(group.id);
      flyTo(group.x, group.y, scaleForGroup(group), duration);
      return new Promise(resolve => setTimeout(resolve, duration));
    },
    prepareEntrance,
    prepareAllViewEntrance,
    playEntrance,
    playExit,
    finalizeExit,
  };

  viewport.addEventListener('wheel', onWheel, { passive: false });
  viewport.addEventListener('pointerdown', onPointerDown);
  viewport.addEventListener('pointermove', onPointerMove);
  viewport.addEventListener('pointerup', onPointerUp);
  viewport.addEventListener('pointercancel', onPointerUp);
  viewport.addEventListener('pointerleave', event => {
    if (!pointers.size && !event.relatedTarget) {
      preview.classList.remove('is-visible');
      clearRing();
    }
  });
  viewport.addEventListener('dblclick', () => { if (isFlat) resetView(); });
  window.addEventListener('resize', () => { if (isFlat) buildView(); });

  lastSpinTime = performance.now();
  requestAnimationFrame(spinLoop);

  buildControls();
  fetch('data/dataset.json')
    .then(response => response.json())
    .then(data => {
      years = data.years;
      if (isFlat) buildView();
    })
    .catch(error => console.warn('[flat-v2.js] Could not load dataset.json:', error));
}());