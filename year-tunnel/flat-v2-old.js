/* FLAT MODE — VERSION 2: color tiles, hover previews, and device groups. */
(function () {
  'use strict';
  const viewport = document.getElementById('flat-viewport');
  const stage = document.getElementById('flat-stage');
  const modeToggle = document.getElementById('mode-toggle');
  if (!viewport || !stage || !modeToggle) return;

  const CONFIG = {
    design: 6000, allInner: .05, allOuter: .46, groupPadding: 260,
    photoFraction: .012, photoMin: 60, photoMax: 180, allMinScale: 1, deviceMinScale: .55, devicePanBaseScale: .6, maxScale: 8,
    wheelIntensity: .002, pinchIntensity: .010, rotation: 137.50776405003785,
  };
  const CATEGORIES = [['all','All'],['film','Film'],['compact','Compact'],['dslr','DSLR'],['mirrorless','Mirrorless'],['phone','Phone'],['pro','Pro'],['other','Other']];
  let years = [], isFlat = false, savedScrollY = 0, baseScale = 1, contentBounds = { x: 0, y: 0 };
  let activeFilter = 'all', layout = 'all', highlightedRing = null, gesture = null, activeDeviceIndex = -1;
  let deviceGroups = [];
  const chips = [], pointers = new Map(), view = { scale: 1, tx: 0, ty: 0 };

  const label = document.createElement('div');
  label.id = 'flat-year-label-v2'; label.innerHTML = '<span id="flat-year-label-text-v2">ALL PHOTOS</span>';
  const labelText = label.firstElementChild;
  const preview = document.createElement('div');
  preview.id = 'flat-preview-v2'; preview.innerHTML = '<img alt=""><span></span>';
  const previewImage = preview.querySelector('img'), previewText = preview.querySelector('span');
  const layoutToggle = document.createElement('button');
  layoutToggle.id = 'flat-layout-toggle-v2'; layoutToggle.type = 'button'; layoutToggle.textContent = 'Device groups'; layoutToggle.setAttribute('aria-pressed', 'false');
  const deviceNav = document.createElement('div');
  deviceNav.id = 'flat-device-nav-v2';
  deviceNav.innerHTML = '<button type="button" aria-label="Previous device group">&larr;</button><span>Device group</span><button type="button" aria-label="Next device group">&rarr;</button>';
  const previousDeviceButton = deviceNav.querySelector('button:first-child');
  const deviceName = deviceNav.querySelector('span');
  const nextDeviceButton = deviceNav.querySelector('button:last-child');

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
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
  function setLabel(year) { labelText.textContent = year ? '09.03.' + year : 'ALL PHOTOS'; }
  function activateRing(ring, year) {
    if (highlightedRing && highlightedRing !== ring) highlightedRing.classList.remove('is-highlighted');
    highlightedRing = ring; ring.classList.add('is-highlighted'); setLabel(year);
  }
  function clearRing(ring) {
    if (ring && highlightedRing !== ring) return;
    if (highlightedRing) highlightedRing.classList.remove('is-highlighted');
    highlightedRing = null; setLabel(null);
  }
  function positionPreview(event) {
    preview.style.left = clamp(event.clientX + 18, 12, window.innerWidth - 202) + 'px';
    preview.style.top = clamp(event.clientY + 18, 12, window.innerHeight - 222) + 'px';
  }
  function showPreview(photo, year, ring, event) {
    activateRing(ring, year); previewImage.src = 'photos/' + encodeURIComponent(photo.file);
    previewImage.alt = photo.file + ' (' + year + ')'; previewText.textContent = '09.03.' + year;
    if (event) positionPreview(event); preview.classList.add('is-visible');
  }
  function leaveRing(ring, event) {
    if (ring.contains(event.relatedTarget)) return;
    preview.classList.remove('is-visible'); clearRing(ring);
  }
  function updateDeviceFocus() {
    if (layout !== 'device' || !deviceGroups.length) return;
    const localX = -view.tx / (baseScale * view.scale);
    const localY = -view.ty / (baseScale * view.scale);
    let closest = 0, closestDistance = Infinity;
    deviceGroups.forEach((group, index) => {
      const distance = Math.hypot(localX - group.x, localY - group.y);
      if (distance < closestDistance) { closestDistance = distance; closest = index; }
    });
    activeDeviceIndex = closest;
    deviceName.textContent = deviceGroups[closest].label;
  }
  function focusDevice(index) {
    if (!deviceGroups.length) return;
    activeDeviceIndex = (index + deviceGroups.length) % deviceGroups.length;
    const group = deviceGroups[activeDeviceIndex];
    view.scale = Math.max(view.scale, 1);
    view.tx = -group.x * baseScale * view.scale;
    view.ty = -group.y * baseScale * view.scale;
    clampView(); applyView();
  }

  function buildControls() {
    const filters = document.createElement('div'); filters.id = 'flat-filters-v2';
    CATEGORIES.forEach(([id, text]) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'flat-chip-v2'; button.dataset.category = id; button.textContent = text;
      button.addEventListener('click', event => { event.stopPropagation(); activeFilter = id; applyFilter(); });
      filters.appendChild(button); chips.push(button);
    });
    layoutToggle.addEventListener('click', event => {
      event.stopPropagation(); layout = layout === 'all' ? 'device' : 'all'; activeFilter = 'all';
      layoutToggle.textContent = layout === 'all' ? 'Device groups' : 'All photos'; layoutToggle.setAttribute('aria-pressed', String(layout === 'device'));
      resetView(); buildView();
    });
    previousDeviceButton.addEventListener('click', event => { event.stopPropagation(); focusDevice(activeDeviceIndex - 1); });
    nextDeviceButton.addEventListener('click', event => { event.stopPropagation(); focusDevice(activeDeviceIndex + 1); });
    viewport.append(filters, layoutToggle, label, preview, deviceNav);
  }

  function addRing(parent, entry, yearIndex, radius, centerX, centerY, rotationOffset) {
    const ring = document.createElement('div'); ring.className = 'flat-ring-v2'; ring.dataset.year = entry.year;
    ring.style.transform = 'translate(' + centerX + 'px,' + centerY + 'px)';
    ring.style.setProperty('--ring-offset', -radius + 'px'); ring.style.setProperty('--ring-diameter', radius * 2 + 'px');
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    hit.classList.add('flat-ring-hit-v2'); hit.setAttribute('viewBox', '0 0 ' + (radius * 2 + 20) + ' ' + (radius * 2 + 20));
    hit.style.width = radius * 2 + 20 + 'px'; hit.style.height = radius * 2 + 20 + 'px'; hit.style.marginLeft = -radius - 10 + 'px'; hit.style.marginTop = -radius - 10 + 'px';
    const hitCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    hitCircle.setAttribute('cx', radius + 10); hitCircle.setAttribute('cy', radius + 10); hitCircle.setAttribute('r', radius);
    hitCircle.addEventListener('pointerenter', () => activateRing(ring, entry.year));
    hitCircle.addEventListener('pointerleave', event => leaveRing(ring, event));
    hit.appendChild(hitCircle); ring.appendChild(hit);
    const tileSize = clamp(CONFIG.design * CONFIG.photoFraction, CONFIG.photoMin, CONFIG.photoMax);
    entry.photos.forEach((photo, photoIndex) => {
      const tile = document.createElement('button'); tile.type = 'button'; tile.className = 'flat-photo-v2';
      tile.dataset.category = classifyDevice(photo.device, entry.year); tile.style.width = tileSize + 'px'; tile.style.height = tileSize + 'px';
      tile.style.marginLeft = -tileSize / 2 + 'px'; tile.style.marginTop = -tileSize / 2 + 'px'; tile.style.backgroundColor = photo.hex || '#c9c9c9';
      const angle = 360 / entry.photos.length * photoIndex + rotationOffset + yearIndex * CONFIG.rotation;
      tile.style.transform = 'rotate(' + angle + 'deg) translateY(' + -radius + 'px)'; tile.setAttribute('aria-label', photo.file + ', September 3, ' + entry.year);
      tile.addEventListener('pointerenter', event => showPreview(photo, entry.year, ring, event));
      tile.addEventListener('pointermove', positionPreview); tile.addEventListener('pointerleave', event => leaveRing(ring, event));
      tile.addEventListener('focus', () => showPreview(photo, entry.year, ring));
      tile.addEventListener('blur', () => { preview.classList.remove('is-visible'); clearRing(ring); }); ring.appendChild(tile);
    });
    parent.appendChild(ring);
  }
  function buildAllPhotos() {
    deviceGroups = []; activeDeviceIndex = -1;
    const chronological = [...years].sort((a, b) => a.year - b.year), inner = CONFIG.design * CONFIG.allInner, outer = CONFIG.design * CONFIG.allOuter;
    const spacing = (outer - inner) / Math.max(1, chronological.length - 1);
    chronological.forEach((entry, index) => addRing(stage, entry, index, inner + index * spacing, 0, 0, 0)); contentBounds = { x: outer, y: outer };
  }
  function buildDeviceGroups() {
    deviceGroups = []; activeDeviceIndex = -1;
    const groups = CATEGORIES.slice(1).map(([id, label], order) => ({ id, label, order, byYear: new Map() })), groupById = new Map(groups.map(group => [group.id, group]));
    years.forEach(entry => entry.photos.forEach(photo => {
      const group = groupById.get(classifyDevice(photo.device, entry.year));
      if (!group.byYear.has(entry.year)) group.byYear.set(entry.year, []); group.byYear.get(entry.year).push(photo);
    }));
    const chronologicalAll = [...years].sort((a, b) => a.year - b.year);
    const ringGap = CONFIG.design * (CONFIG.allOuter - CONFIG.allInner) / Math.max(1, chronologicalAll.length - 1);
    const startRadius = CONFIG.design * CONFIG.allInner;
    const active = groups.filter(group => group.byYear.size).map(group => {
      const chronological = Array.from(group.byYear.entries()).sort((a, b) => a[0] - b[0]);
      return { ...group, chronological, radius: startRadius + ringGap * (chronological.length - 1) };
    }).sort((a, b) => b.radius - a.radius);
    const totalArea = active.reduce((sum, group) => sum + Math.pow(group.radius * 2 + CONFIG.groupPadding, 2), 0);
    const targetWidth = Math.sqrt(totalArea * 1.35);
    const rows = [];
    active.forEach(group => {
      const diameter = group.radius * 2;
      let row = rows.find(candidate => candidate.width && candidate.width + CONFIG.groupPadding + diameter <= targetWidth);
      if (!row) { row = { items: [], width: 0, height: 0 }; rows.push(row); }
      row.items.push(group); row.width += (row.width ? CONFIG.groupPadding : 0) + diameter; row.height = Math.max(row.height, diameter);
    });
    const totalHeight = rows.reduce((sum, row) => sum + row.height, 0) + CONFIG.groupPadding * Math.max(0, rows.length - 1);
    let yCursor = -totalHeight / 2;
    let maxX = 0, maxY = 0;
    rows.forEach(row => {
      let xCursor = -row.width / 2;
      row.items.forEach(group => {
        const x = xCursor + group.radius;
        const y = yCursor + row.height / 2;
        const deviceLabel = document.createElement('div'); deviceLabel.className = 'flat-device-label-v2'; deviceLabel.textContent = group.label;
        deviceLabel.style.transform = 'translate(' + x + 'px,' + (y - group.radius - 95) + 'px)'; stage.appendChild(deviceLabel);
        group.chronological.forEach(([year, photos], yearIndex) => addRing(stage, { year, photos }, yearIndex, startRadius + yearIndex * ringGap, x, y, group.radius));
        deviceGroups.push({ id: group.id, label: group.label, order: group.order, x, y, radius: group.radius });
        xCursor += group.radius * 2 + CONFIG.groupPadding;
        maxX = Math.max(maxX, Math.abs(x) + group.radius); maxY = Math.max(maxY, Math.abs(y) + group.radius + 130);
      });
      yCursor += row.height + CONFIG.groupPadding;
    });
    deviceGroups.sort((a, b) => a.order - b.order);
    contentBounds = { x: maxX, y: maxY };
  }
  function buildView() {
    stage.replaceChildren(); if (!years.length) return;
    viewport.classList.toggle('is-device-layout', layout === 'device'); baseScale = Math.min(window.innerWidth, window.innerHeight) / CONFIG.design;
    if (layout === 'device') buildDeviceGroups(); else buildAllPhotos(); clampView(); applyView(); applyFilter();
  }
  function applyFilter() {
    chips.forEach(chip => chip.classList.toggle('is-active', chip.dataset.category === activeFilter));
    stage.querySelectorAll('.flat-photo-v2').forEach(tile => tile.classList.toggle('is-dimmed', layout === 'all' && activeFilter !== 'all' && tile.dataset.category !== activeFilter));
  }
  function minimumScale() { return layout === 'device' ? CONFIG.deviceMinScale : CONFIG.allMinScale; }
  function applyView() { stage.style.transform = 'translate(' + view.tx + 'px,' + view.ty + 'px) scale(' + baseScale * view.scale + ')'; updateDeviceFocus(); }
  function clampView() {
    const minScale = minimumScale();
    view.scale = clamp(view.scale, minScale, CONFIG.maxScale);
    if (layout === 'all' && view.scale === minScale) { view.tx = 0; view.ty = 0; return; }
    const panBaseScale = layout === 'device' ? CONFIG.devicePanBaseScale : CONFIG.allMinScale;
    const travelX = layout === 'device' ? contentBounds.x * baseScale * view.scale : Math.max(0, contentBounds.x * baseScale * (view.scale - panBaseScale));
    const travelY = layout === 'device' ? contentBounds.y * baseScale * view.scale : Math.max(0, contentBounds.y * baseScale * (view.scale - panBaseScale));
    view.tx = clamp(view.tx, -travelX, travelX); view.ty = clamp(view.ty, -travelY, travelY);
  }
  function resetView() { view.scale = layout === 'device' ? 1 : CONFIG.allMinScale; view.tx = 0; view.ty = 0; applyView(); }
  function pairMetrics() { const [one, two] = Array.from(pointers.values()); return { x: (one.x + two.x) / 2, y: (one.y + two.y) / 2, distance: Math.hypot(two.x - one.x, two.y - one.y) || 1 }; }
  function beginMulti() { const metric = pairMetrics(); gesture = { type: 'multi', ...metric, scale: view.scale, tx: view.tx, ty: view.ty }; viewport.classList.add('is-dragging'); }
  function onPointerDown(event) {
    if (!isFlat || event.target.closest('#flat-filters-v2, #flat-layout-toggle-v2')) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); try { viewport.setPointerCapture(event.pointerId); } catch (_) {}
    if (pointers.size === 1) { gesture = { type: 'single', id: event.pointerId, x: event.clientX, y: event.clientY, tx: view.tx, ty: view.ty }; viewport.classList.add('is-dragging'); } else beginMulti();
  }
  function onPointerMove(event) {
    if (!pointers.has(event.pointerId)) return; pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gesture && gesture.type === 'single' && gesture.id === event.pointerId) { view.tx = gesture.tx + event.clientX - gesture.x; view.ty = gesture.ty + event.clientY - gesture.y; }
    else if (gesture && gesture.type === 'multi' && pointers.size >= 2) {
      const metric = pairMetrics(), nextScale = clamp(gesture.scale * metric.distance / gesture.distance, minimumScale(), CONFIG.maxScale), ratio = nextScale / gesture.scale;
      view.scale = nextScale; view.tx = metric.x - (gesture.x - gesture.tx) * ratio; view.ty = metric.y - (gesture.y - gesture.ty) * ratio;
    } else return;
    clampView(); applyView();
  }
  function onPointerUp(event) {
    if (!pointers.has(event.pointerId)) return; pointers.delete(event.pointerId); try { viewport.releasePointerCapture(event.pointerId); } catch (_) {}
    if (pointers.size === 1) { const [id, point] = Array.from(pointers.entries())[0]; gesture = { type: 'single', id, x: point.x, y: point.y, tx: view.tx, ty: view.ty }; }
    else { gesture = null; viewport.classList.remove('is-dragging'); }
  }
  function onWheel(event) {
    if (!isFlat) return; event.preventDefault(); const intensity = event.ctrlKey ? CONFIG.pinchIntensity : CONFIG.wheelIntensity;
    const nextScale = clamp(view.scale * Math.exp(-event.deltaY * intensity), minimumScale(), CONFIG.maxScale), ratio = nextScale / view.scale, x = event.clientX - window.innerWidth / 2, y = event.clientY - window.innerHeight / 2;
    view.tx = x - (x - view.tx) * ratio; view.ty = y - (y - view.ty) * ratio; view.scale = nextScale; clampView(); applyView();
  }
  function enterFlat() {
    if (isFlat) return; savedScrollY = window.scrollY; document.documentElement.style.overflow = 'hidden'; document.body.style.overflow = 'hidden'; document.body.classList.add('mode-flat'); viewport.setAttribute('aria-hidden','false'); modeToggle.textContent = 'Tunnel'; modeToggle.setAttribute('aria-pressed','true'); isFlat = true; resetView(); buildView();
  }
  function exitFlat() {
    if (!isFlat) return; pointers.clear(); gesture = null; preview.classList.remove('is-visible'); clearRing(); viewport.classList.remove('is-dragging'); document.body.classList.remove('mode-flat'); viewport.setAttribute('aria-hidden','true'); document.documentElement.style.overflow = ''; document.body.style.overflow = ''; window.scrollTo(0,savedScrollY); modeToggle.textContent = 'Flat'; modeToggle.setAttribute('aria-pressed','false'); isFlat = false;
  }
  modeToggle.addEventListener('click', () => isFlat ? exitFlat() : enterFlat());
  viewport.addEventListener('wheel', onWheel, { passive: false }); viewport.addEventListener('pointerdown', onPointerDown); viewport.addEventListener('pointermove', onPointerMove); viewport.addEventListener('pointerup', onPointerUp); viewport.addEventListener('pointercancel', onPointerUp);
  viewport.addEventListener('pointerleave', event => { if (!pointers.size && !event.relatedTarget) { preview.classList.remove('is-visible'); clearRing(); } }); viewport.addEventListener('dblclick', () => { if (isFlat) resetView(); }); window.addEventListener('resize', () => { if (isFlat) buildView(); });
  buildControls(); fetch('data/dataset.json').then(response => response.json()).then(data => { years = data.years; if (isFlat) buildView(); }).catch(error => console.warn('[flat-v2.js] Could not load dataset.json:', error));
}());
