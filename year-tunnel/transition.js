/* MODE TRANSITION — owns the mode-toggle button and choreographs the
   tunnel <-> flat switch. It never touches tunnel or flat rendering
   math directly; it only calls the primitives each side exposes via
   window.TunnelBridge / window.Flat.

   Tunnel -> Flat:
     1. Quickly sweep the tunnel through one lap (rings cycle past).
     2. Collapse everything to the vanishing point at screen center
        while the tunnel's background fades to black.
     3. Swap to flat (already black) and grow the target device group's
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

  const modeToggle = document.getElementById('mode-toggle');
  if (!modeToggle) return;

  const TUNNEL_LAP_MS = 600;
  const TUNNEL_COLLAPSE_MS = 360;
  const TUNNEL_EMERGE_MS = 360;
  const TUNNEL_RUN_MS = 600;
  const FLAT_ENTRANCE_MS = 700;
  const FLAT_EXIT_MS = 520;
  const ALL_VIEW_PREZOOM_MS = 380;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  function easeInCubic(t) { return t * t * t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

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
    modeToggle.disabled = true;
    document.body.classList.add('mode-transitioning');

    const tunnelViewport = window.TunnelBridge.getViewportEl();
    window.TunnelBridge.setPaused(true);

    const startDepth = window.TunnelBridge.getCurrentDepth();
    lastTunnelDepth = startDepth;
    const lap = window.TunnelBridge.getYearsCount() || 1;
    const sweepEnd = startDepth - lap;

    // Phase 1: quickly run through one lap of the tunnel.
    await tween(TUNNEL_LAP_MS, t => {
      const eased = easeInCubic(t);
      window.TunnelBridge.setCurrentDepth(lerp(startDepth, sweepEnd, eased));
      window.TunnelBridge.renderFrame(1, 1);
    });

    // Phase 2: collapse everything into the vanishing point at center,
    // fading the tunnel to black as it goes.
    await tween(TUNNEL_COLLAPSE_MS, t => {
      const eased = easeInCubic(t);
      window.TunnelBridge.renderFrame(1 - eased, 1 - eased);
      tunnelViewport.style.background = lerpColor('#ffffff', '#000000', eased);
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
    modeToggle.disabled = false;
    animating = false;
  }

  async function flatToTunnel() {
    animating = true;
    modeToggle.disabled = true;
    document.body.classList.add('mode-transitioning');
    window.TunnelBridge.setPaused(true);

    // If zoomed all the way out, settle on whichever group is closest
    // to center first so there's a single anchor to collapse.
    if (window.Flat.isAllView()) {
      const closestId = window.Flat.getClosestGroupToView();
      if (closestId) await window.Flat.flyToGroupId(closestId, ALL_VIEW_PREZOOM_MS);
    }

    lastFlatTarget = window.Flat.getSettledTarget();

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

    // Phase 2: emerge from the vanishing point, fading back to white.
    await tween(TUNNEL_EMERGE_MS, t => {
      const eased = easeOutCubic(t);
      window.TunnelBridge.renderFrame(eased, eased);
      tunnelViewport.style.background = lerpColor('#000000', '#ffffff', eased);
    });

    // Phase 3: quickly run the last lap, landing on the year the user
    // was last looking at.
    await tween(TUNNEL_RUN_MS, t => {
      const eased = easeOutCubic(t);
      window.TunnelBridge.setCurrentDepth(lerp(emergeStart, targetDepth, eased));
      window.TunnelBridge.renderFrame(1, 1);
    });

    window.TunnelBridge.setCurrentDepth(targetDepth);
    window.TunnelBridge.setScrollToDepth(targetDepth);
    tunnelViewport.style.background = '';
    window.TunnelBridge.setPaused(false);

    document.body.classList.remove('mode-transitioning');
    mode = 'tunnel';
    modeToggle.disabled = false;
    animating = false;
  }

  modeToggle.addEventListener('click', () => {
    if (animating) return;
    if (mode === 'tunnel') tunnelToFlat();
    else flatToTunnel();
  });

  // The toggle starts disabled (see index-v2.html) until both the
  // tunnel and flat datasets have finished loading.
  (function whenReady() {
    if (window.TunnelBridge && window.TunnelBridge.getYearsCount() > 0 && window.Flat && window.Flat.isReady()) {
      modeToggle.disabled = false;
    } else {
      setTimeout(whenReady, 60);
    }
  })();
}());