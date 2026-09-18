/* MODE TRANSITION — owns the year/device mode-switch nav and choreographs
   the tunnel <-> flat switch. It never touches tunnel or flat rendering
   math directly; it only calls the primitives each side exposes via
   window.TunnelBridge / window.Flat.

   Tunnel -> Flat:
     1. Quickly sweep the tunnel through one lap (rings cycle past) and
        collapse everything to the vanishing point at screen center, as
        one continuous move — the background fades toward black the
        whole time too, finishing exactly as the collapse settles.
     2. Swap to flat (already black) and grow the target device group's
        rings out from that same screen-center point, while every other
        group flies in from just off-screen to its packed position.

   Flat -> Tunnel: the exact reverse, ending back on the tunnel year the
   user was last looking at. If flat is zoomed all the way out, it first
   snaps to whichever group is closest to center so there's a single
   group to collapse.

   Returning to flat later restores whatever group (or the all-zoomed-
   out view) the user last left it on, rather than always reopening on
   film — film is only the very first entrance.
*/
(function () {
  'use strict';

  const modeSwitchYear = document.getElementById('mode-switch-year');
  const modeSwitchDevice = document.getElementById('mode-switch-device');
  if (!modeSwitchYear || !modeSwitchDevice) return;

  function setNavDisabled(disabled) {
    modeSwitchYear.disabled = disabled;
    modeSwitchDevice.disabled = disabled;
  }

  // Remembers which mode the user was last on across a page refresh
  // (see restoreSavedMode() below). Wrapped in try/catch since
  // localStorage can throw in some private-browsing contexts -- losing
  // the memory there is fine, it just falls back to always opening on
  // tunnel like before.
  const VIEW_MODE_KEY = 'septemberThirdViewMode';
  function saveMode(m) {
    try { localStorage.setItem(VIEW_MODE_KEY, m); } catch (e) { /* ignore */ }
  }

  const TUNNEL_LAP_MS = 600;
  const TUNNEL_COLLAPSE_MS = 360;
  const TUNNEL_DEPARTURE_MS = TUNNEL_LAP_MS + TUNNEL_COLLAPSE_MS;
  const TUNNEL_LANDING_MS = 900;
  const FLAT_ENTRANCE_MS = 700;
  const FLAT_EXIT_MS = 520;
  const ALL_VIEW_PREZOOM_MS = 380;
  const RECENTER_MS = 260;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  function easeInCubic(t) { return t * t * t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function lerpColor(a, b, t) {
    const [ar, ag, ab] = hexToRgb(a);
    const [br, bg, bb] = hexToRgb(b);
    const r = Math.round(lerp(ar, br, t));
    const g = Math.round(lerp(ag, bg, t));
    const bl = Math.round(lerp(ab, bb, t));
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  function tween(duration, onFrame) {
    return new Promise(resolve => {
      const start = performance.now();
      function step(now) {
        const t = Math.min(1, (now - start) / duration);
        onFrame(t);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
  }

  let mode = 'tunnel'; // 'tunnel' | 'flat'
  let animating = false;
  let hasVisitedFlat = false;
  let lastTunnelDepth = null;
  let lastFlatTarget = { type: 'group', id: null }; // null id -> resolved to the home group

  async function tunnelToFlat() {
    animating = true;
    setNavDisabled(true);
    document.body.classList.add('mode-transitioning');

    const tunnelViewport = window.TunnelBridge.getViewportEl();
    window.TunnelBridge.setPaused(true);

    const startDepth = window.TunnelBridge.getCurrentDepth();
    lastTunnelDepth = startDepth;
    const lap = window.TunnelBridge.getYearsCount() || 1;
    const sweepEnd = startDepth - lap;

    // Lap sweep and collapse play as ONE continuous tween rather than
    // two separate awaited beats. Two separate tween() calls means a
    // real animation-frame boundary between them, and the lap sweep's
    // very last frame lands exactly one full period back — which, same
    // as the tunnel's periodic math that bit us on the flat->tunnel
    // side, looks *identical* to the year the user left, rendered at
    // full brightness. That frame would actually paint before the
    // collapse got a chance to start fading it, reading as a flash of
    // "the year I left on" between the sweep and flat appearing.
    // Keeping depth in continuous motion for the whole departure (it
    // only ever stops once it's already invisible) avoids that. Position
    // uses easeOutCubic rather than easeInCubic so it has real velocity
    // from frame one instead of lingering near the start — a slow-start
    // curve here would otherwise hold on a nearly-static, fully visible
    // "year I left on" frame for the first several frames.
    //
    // The shrink (visibility) is NOT gated to only start after the lap
    // finishes — it ramps across the whole tween using easeInCubic(t)
    // directly (back-loaded, negligible at first, accelerating toward
    // the end). Gating it to kick in only partway through used to create
    // a "scrolls one lap, STOPS, and then shrinks" feel: position (on
    // easeOutCubic) was already decelerating into its coast by the time
    // the gate opened, so the shrink's sudden onset read as a second,
    // disconnected beat. Letting it overlap the sweep from t=0 means the
    // tunnel is already subtly collapsing while it's still cycling, so
    // there's no seam between "sweeping" and "shrinking".
    await tween(TUNNEL_DEPARTURE_MS, t => {
      const posEased = easeOutCubic(t);
      window.TunnelBridge.setCurrentDepth(lerp(startDepth, sweepEnd, posEased));
      const visibility = 1 - easeInCubic(t);
      window.TunnelBridge.renderFrame(visibility, visibility);
      tunnelViewport.style.background = lerpColor('#ffffff', '#000000', easeInOutCubic(t));
    });

    tunnelViewport.style.display = 'none';

    // Phase 3: hand off to flat (already black) and grow it in.
    const target = hasVisitedFlat ? lastFlatTarget : { type: 'group', id: null };
    let groupId = target.type === 'group' ? target.id : null;
    if (groupId && !window.Flat.getDeviceGroupIds().includes(groupId)) groupId = null;
    if (!groupId) groupId = window.Flat.getHomeGroupId();

    let anchorId;
    if (target.type === 'group' || !hasVisitedFlat) {
      anchorId = window.Flat.prepareEntrance(groupId);
    } else {
      anchorId = window.Flat.prepareAllViewEntrance();
    }
    await window.Flat.playEntrance(anchorId, FLAT_ENTRANCE_MS);

    tunnelViewport.style.display = '';
    tunnelViewport.style.background = '';
    document.body.classList.remove('mode-transitioning');
    hasVisitedFlat = true;
    mode = 'flat';
    saveMode('flat');
    setNavDisabled(false);
    animating = false;
  }

  async function flatToTunnel() {
    animating = true;
    setNavDisabled(true);
    document.body.classList.add('mode-transitioning');
    window.TunnelBridge.setPaused(true);

    // If zoomed all the way out, settle on whichever group is closest
    // to center first so there's a single anchor to collapse.
    if (window.Flat.isAllView()) {
      const closestId = window.Flat.getClosestGroupToView();
      if (closestId) await window.Flat.flyToGroupId(closestId, ALL_VIEW_PREZOOM_MS);
    }

    lastFlatTarget = window.Flat.getSettledTarget();

    // If the user panned/zoomed away from the settled group's own
    // centered/focused framing before hitting YEAR, snap the camera back
    // to dead-center on it first. playExit() collapses that group's rings
    // toward its fixed world-space position, not toward wherever the
    // camera currently happens to be pointed -- so an off-center camera
    // here would otherwise produce a visible jump right as the tunnel
    // emerges expecting dead-center. flyToGroupId() no-ops instantly when
    // the camera is already framed on this group, so this is a no-op in
    // the common case where the user never moved.
    if (lastFlatTarget.type === 'group' && lastFlatTarget.id) {
      await window.Flat.flyToGroupId(lastFlatTarget.id, RECENTER_MS);
    }

    // Phase 1: collapse the settled group back into the screen's
    // center; every other group flies back off-screen.
    await window.Flat.playExit(FLAT_EXIT_MS);
    window.Flat.finalizeExit();

    const tunnelViewport = window.TunnelBridge.getViewportEl();
    tunnelViewport.style.display = '';
    tunnelViewport.style.background = '#000000';

    const targetDepth = lastTunnelDepth != null ? lastTunnelDepth : window.TunnelBridge.getCurrentDepth();
    const lap = window.TunnelBridge.getYearsCount() || 1;
    const emergeStart = targetDepth - lap;
    window.TunnelBridge.setCurrentDepth(emergeStart);
    window.TunnelBridge.renderFrame(0, 0);

    // Phase 2: emerge from the vanishing point AND run the last lap in
    // one continuous move, landing on the year the user was last
    // looking at. These two have to happen together, not as separate
    // beats — emergeStart is exactly one lap behind targetDepth, so the
    // tunnel's periodic math makes that starting position look
    // *identical* to the final landing frame. Fading it in first and
    // only then sweeping through the lap would show the correct year
    // right away, then needlessly run away from it and back — which
    // reads as "jumps to where it left off, then animates". Ramping
    // position and visibility together means nothing fully legible is
    // on screen until it actually arrives.
    await tween(TUNNEL_LANDING_MS, t => {
      const eased = easeOutCubic(t);
      window.TunnelBridge.setCurrentDepth(lerp(emergeStart, targetDepth, eased));
      window.TunnelBridge.renderFrame(eased, eased);
      tunnelViewport.style.background = lerpColor('#000000', '#ffffff', eased);
    });

    window.TunnelBridge.setCurrentDepth(targetDepth);
    window.TunnelBridge.setScrollToDepth(targetDepth);
    tunnelViewport.style.background = '';
    window.TunnelBridge.setPaused(false);

    document.body.classList.remove('mode-transitioning');
    mode = 'tunnel';
    saveMode('tunnel');
    setNavDisabled(false);
    animating = false;
  }

  modeSwitchDevice.addEventListener('click', () => {
    if (animating || mode === 'flat') return;
    tunnelToFlat();
  });

  modeSwitchYear.addEventListener('click', () => {
    if (animating || mode === 'tunnel') return;
    flatToTunnel();
  });

  // If the user was on flat mode when they last left/refreshed the
  // page, open there directly instead of always landing back on
  // tunnel -- the whole point of remembering it is that the page
  // shouldn't feel like it forgot where they were. This settles flat
  // straight into its resting state (prepareEntrance + a ~0ms
  // playEntrance) rather than replaying the full tunnel-departure/
  // flat-grow choreography, since that cinematic is for an active
  // choice to switch views, not an unrelated page reload. Always opens
  // on the home group -- only the mode itself is remembered, not the
  // exact group/zoom the user had. A duration of exactly 0 risks a
  // divide-by-zero landing on NaN if the first animation frame fires
  // on the very same tick playEntrance starts on; 1ms is close enough
  // to instant that it's imperceptible while staying safely nonzero.
  function restoreSavedMode() {
    if (mode === 'flat') return;
    let saved = null;
    try { saved = localStorage.getItem(VIEW_MODE_KEY); } catch (e) { /* ignore */ }
    if (saved !== 'flat') return;

    window.TunnelBridge.setPaused(true);
    const anchorId = window.Flat.prepareEntrance(null);
    window.Flat.playEntrance(anchorId, 1);

    hasVisitedFlat = true;
    mode = 'flat';
    document.documentElement.classList.remove('mode-flat-restore');
  }

  // The switch starts disabled (see index-v2.html) until both the
  // tunnel and flat datasets have finished loading.
  (function whenReady() {
    if (window.TunnelBridge && window.TunnelBridge.getYearsCount() > 0 && window.Flat && window.Flat.isReady()) {
      restoreSavedMode();
      setNavDisabled(false);
    } else {
      setTimeout(whenReady, 60);
    }
  })();
}());