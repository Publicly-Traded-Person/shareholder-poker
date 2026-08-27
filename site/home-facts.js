/* home-facts.js: fills the home page's data slots from /data/games.json.
   Served at /home-facts.js; loaded with `defer` by site/index.html only.
   Doctrine (same as rsvp.js): game-derived numbers are never hand-typed
   into the page. The static copy around every slot reads complete on its
   own; this script only adds the numbers, and on any failure it does
   nothing at all.
   Slots (all optional, all invisible while empty via .fact:empty):
     #fact-last-game       latest game stat line
     #fact-last-game-link  href to the latest game page
     #fact-coin            Hope Coin holder + held-since
     #fact-skulls          <li> per hunter: name, skull gems, "N of 3" text
                            (the count is a real text node, not just the
                            gems, so a screen reader hears it too) */
(function () {
  /* Shorthand for the one lookup this file does everywhere; returns null
     for a missing id (every caller below checks before using the result,
     so this script never throws on a page that lacks a given slot). */
  function el(id) { return document.getElementById(id); }
  /* The gem marks live as <template> elements in the page markup (ids
     skull-full / skull-empty, beside the other drawn marks); this script only
     clones nodes and writes text, so no string ever reaches an HTML sink. */
  function gem(kind) {
    var t = el(kind);
    return t && t.content.firstElementChild
      ? t.content.firstElementChild.cloneNode(true)
      : null;
  }

  fetch("/data/games.json")
    .then(function (r) {
      if (!r.ok) throw new Error("games.json " + r.status);
      return r.json();
    })
    .then(function (data) {
      var nameOf = {};
      data.players.forEach(function (p) { nameOf[p.slug] = p.name; });

      /* Latest game: max date wins; ISO strings compare correctly as text. */
      var latest = data.games.slice().sort(function (a, b) {
        return a.date < b.date ? 1 : -1;
      })[0];
      if (latest) {
        var winner = null;
        latest.results.forEach(function (r) { if (r.finish === 1) winner = r; });
        var line = el("fact-last-game");
        if (line && winner) {
          line.textContent = latest.date + " · " + (nameOf[winner.slug] || winner.slug) +
            " won · " + latest.entries + " entries · $" + latest.pot + " pot · " +
            latest.hands + " hands";
        }
        var link = el("fact-last-game-link");
        if (link) link.href = "/games/" + latest.date + "/";
      }

      var coin = el("fact-coin");
      if (coin && data.hopeCoin) {
        coin.textContent = (nameOf[data.hopeCoin.holder] || data.hopeCoin.holder) +
          " holds it, since " + data.hopeCoin.since + ".";
      }

      /* Skull tallies: count "hope-slayer" trophies per player across all
         games. This restates six lines of tools/lib/standings.ts because
         tools/ is Bun TypeScript and site/ is no-build browser JS; the two
         must agree on the trophy string. */
      var skulls = {};
      data.games.forEach(function (g) {
        g.results.forEach(function (r) {
          r.trophies.forEach(function (t) {
            if (t === "hope-slayer") skulls[r.slug] = (skulls[r.slug] || 0) + 1;
          });
        });
      });
      var listEl = el("fact-skulls");
      if (listEl) {
        Object.keys(skulls).forEach(function (slug) {
          var n = Math.min(skulls[slug], 3);
          var li = document.createElement("li");
          li.textContent = (nameOf[slug] || slug) + ": ";
          for (var i = 0; i < 3; i++) {
            var g = gem(i < n ? "skull-full" : "skull-empty");
            if (g) li.appendChild(g);
          }
          /* The gems are aria-hidden (drawn chrome, not content), so
             without this the count exists only as a visual gem tally and
             a screen reader hears just the name. A plain text node makes
             the count real content for everyone, matching how the
             standings page states name, gems, and count together. */
          li.appendChild(document.createTextNode(" " + n + " of 3"));
          listEl.appendChild(li);
        });
      }
    })
    .catch(function (err) {
      /* Visitors never see this: the static page stands on its own with
         every .fact slot empty. It exists for Charlie, checking the
         console during the monthly publish when a fill silently failed. */
      console.warn("home-facts: " + err);
    });
})();
