// Fills the next-game date on any page that promotes the RSVP, from
// /data/games.json, which is the single source of truth for `nextGame`
// (repo CLAUDE.md: publishing a game updates it there and the pages follow).
//
// Where it is served: /next-game.js, loaded with `defer` by the generated
// puzzle pages (site/wwyhd/index.html and site/wwyhd/<id>/index.html). The
// home page does the same job inside site/rsvp.js, which also owns that
// page's form; this file exists so a page with no form can carry the date
// without pulling the form's script in.
//
// Every element with a `data-next-game` attribute gets the formatted date as
// its text. The generator writes today's answer into that element at render
// time, so the band reads correctly with JavaScript off and before this runs;
// this only corrects it when `nextGame` has moved since the page was last
// generated. A failed fetch leaves the rendered text alone, which is the
// right failure: a stale date beats no date, and the link still works.
(function () {
  var slots = document.querySelectorAll("[data-next-game]");
  if (!slots.length) return;

  var MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  // "2026-10-13" and "7:00pm PT" -> "October 13, 2026 at 7:00pm PT". Returns
  // an empty string for anything that is not a YYYY-MM-DD date, so a
  // malformed games.json leaves the rendered text in place.
  function phrase(next) {
    if (!next || typeof next.date !== "string") return "";
    var parts = next.date.split("-");
    if (parts.length !== 3) return "";
    var year = Number(parts[0]), month = Number(parts[1]), day = Number(parts[2]);
    if (!MONTHS[month - 1] || !day || !year) return "";
    var when = MONTHS[month - 1] + " " + day + ", " + year;
    return next.time ? when + " at " + next.time : when;
  }

  fetch("/data/games.json")
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var text = phrase(data && data.nextGame);
      if (!text) return;
      for (var i = 0; i < slots.length; i++) slots[i].textContent = text;
    })
    .catch(function () { /* the rendered date stands */ });
})();
