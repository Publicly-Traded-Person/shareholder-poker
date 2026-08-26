/* holo.js: pointer-driven foil effect for the champion card.
   Served at /holo.js; loaded with `defer` by pages that show the foil
   (home, the set page). Progressive enhancement in three layers:
     no JS                -> the CSS .shimmer animation (styles.css)
     touch-only device    -> shimmer (no pointer to track)
     reduced motion       -> nothing moves (CSS guards + the bail below)
   The script only writes two custom properties (--hx, --hy, both 0..1) and
   toggles .is-holo; every visual is CSS in styles.css ("Holo effect"). */
(function () {
  "use strict";
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  var finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  if (reduced.matches || !finePointer.matches) return;
  document.querySelectorAll(".card-frame--holo").forEach(function (card) {
    var raf = 0;
    card.addEventListener("pointerenter", function () {
      card.classList.add("is-holo");
    });
    card.addEventListener("pointermove", function (e) {
      if (raf) return; /* one write per frame, not per event */
      raf = requestAnimationFrame(function () {
        raf = 0;
        var r = card.getBoundingClientRect();
        card.style.setProperty("--hx", (e.clientX - r.left) / r.width);
        card.style.setProperty("--hy", (e.clientY - r.top) / r.height);
      });
    });
    card.addEventListener("pointerleave", function () {
      /* A pointermove rAF scheduled just before pointerleave fires afterwards
         and overwrites the .5 reset with stale coordinates; cancel it. */
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      card.classList.remove("is-holo");
      card.style.setProperty("--hx", 0.5);
      card.style.setProperty("--hy", 0.5);
    });
  });
})();
