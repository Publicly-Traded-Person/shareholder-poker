/* card-zoom.js: select a card, see it big.
   Served at /card-zoom.js. Loaded with `defer` by every page that shows
   .card-frame images: the set pages (site/cards/<set>/index.html are
   hand-written; docs/publishing.md "Cards" says to keep the tag when copying
   the newest set page) and every player page with a card gallery
   (tools/render.ts adds the tag whenever it renders one). tools/site.test.ts
   fails any page that shows card frames without loading this.

   Progressive enhancement: with no JS the cards are plain images, exactly as
   they were before this script existed. With JS, every .card-frame becomes a
   keyboard-reachable control. Click, Enter or Space opens ONE shared
   <dialog class="card-zoom"> holding the same PNG (the card art is already
   full resolution, 676px wide, so there is nothing bigger to fetch) plus the
   card's caption line. Escape, a click on the backdrop, or the Close button
   closes it, and focus returns to the card that opened it. All visuals live
   in styles.css under "Card zoom"; this file only builds the dialog and wires
   the events. */
(function () {
  "use strict";
  var images = document.querySelectorAll(".card-frame img");
  /* No frames, or a browser without <dialog>.showModal(): do nothing, and the
     page is what it always was. */
  if (!images.length || typeof HTMLDialogElement === "undefined" ||
      !HTMLDialogElement.prototype.showModal) return;

  var dialog = document.createElement("dialog");
  dialog.className = "card-zoom";
  dialog.setAttribute("aria-label", "Enlarged card");
  var big = document.createElement("img");
  var caption = document.createElement("p");
  caption.className = "card-zoom__caption";
  var close = document.createElement("button");
  close.type = "button";
  close.className = "card-zoom__close";
  close.textContent = "Close";
  dialog.appendChild(big);
  dialog.appendChild(caption);
  dialog.appendChild(close);
  document.body.appendChild(dialog);

  var opener = null;

  function open(img, frame) {
    big.src = img.currentSrc || img.src;
    big.alt = img.alt;
    /* The caption is the unboxed .card-caption line that sits under the frame
       (never inside it; see the holo comment in styles.css). textContent drops
       the drawn gem SVG the set pages put in front of the words, which is what
       we want here: the words alone, whitespace collapsed. */
    var figure = frame.closest("figure");
    var line = figure ? figure.querySelector(".card-caption") : null;
    caption.textContent = line ? line.textContent.replace(/\s+/g, " ").trim() : "";
    caption.hidden = !caption.textContent;
    opener = frame;
    dialog.showModal();
  }

  /* A click outside the dialog's own box lands on the ::backdrop and reports
     the dialog element as its target. Comparing against the box, rather than
     trusting e.target alone, also treats a click in any padding as "inside",
     so a near miss on the image never slams the dialog shut. */
  dialog.addEventListener("click", function (e) {
    var r = dialog.getBoundingClientRect();
    var outside = e.clientX < r.left || e.clientX > r.right ||
                  e.clientY < r.top || e.clientY > r.bottom;
    if (outside) dialog.close();
  });
  close.addEventListener("click", function () { dialog.close(); });
  /* Escape closes a modal dialog natively and also fires this event, so one
     handler covers every way out. Focus goes back where it came from, the way
     a keyboard user expects. */
  dialog.addEventListener("close", function () {
    if (opener) { opener.focus(); opener = null; }
  });

  images.forEach(function (img) {
    var frame = img.closest(".card-frame") || img;
    frame.classList.add("card-frame--zoomable");
    frame.setAttribute("role", "button");
    frame.setAttribute("tabindex", "0");
    frame.setAttribute("aria-label", "Enlarge: " + img.alt);
    frame.addEventListener("click", function () { open(img, frame); });
    frame.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault(); /* Space would otherwise scroll the page */
        open(img, frame);
      }
    });
  });
})();
