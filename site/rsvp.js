// RSVP form wiring. The next game date comes from /data/games.json, which is the
// single source of truth: publishing a game updates nextGame there and this page
// follows. Nothing on the home page hardcodes a date.
// Endpoint contract:
//   POST /api/rsvp  {email, displayName, game} -> {ok: true} | {error}
//   GET  /api/rsvp?game=YYYY-MM-DD -> {count, names: [string]}  (never emails)
(function () {
  var form = document.getElementById("rsvp-form");
  if (!form) return;
  var email = document.getElementById("rsvp-email");
  var name = document.getElementById("rsvp-name");
  var list = document.getElementById("rsvp-list");
  var status = document.getElementById("rsvp-status");
  var submit = document.getElementById("rsvp-submit");

  var MONTHS = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];
  var SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];

  var game = null;
  var sending = false;
  var confirmed = false;

  function say(el, text) { if (el) el.textContent = text; }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  // Parse the ISO date by hand. new Date("2026-09-08") is UTC midnight, which
  // renders as the 7th for anyone west of Greenwich.
  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return null;
    var month = parseInt(m[2], 10) - 1;
    var day = parseInt(m[3], 10);
    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    return {
      full: MONTHS[month] + " " + day + ", " + m[1],
      monthDay: MONTHS[month] + " " + day,
      short: SHORT[month] + " " + day
    };
  }

  function applyDates(next) {
    var d = formatDate(next.date);
    if (!d) return;
    var time = next.time || "7:00pm PT";
    setText("next-game-line", "Next game: " + d.full + " · " + time);
    setText("rsvp-submit", "I'm in for " + d.short);
    setText("next-game-short", d.monthDay + ", " + time);
    setText("rsvp-jump", "RSVP for " + d.short);
  }

  var loaded = fetch("/data/games.json")
    .then(function (r) {
      if (!r.ok) throw new Error("games.json " + r.status);
      return r.json();
    })
    .then(function (data) {
      var next = data && data.nextGame;
      if (!next || !formatDate(next.date)) throw new Error("games.json has no usable nextGame");
      game = next.date;
      applyDates(next);
      return next.date;
    });

  loaded.then(refresh).catch(function () {
    say(status, "Could not load the next game date. Refresh the page to try again.");
  });

  function refresh() {
    if (!game) return;
    return fetch("/api/rsvp?game=" + encodeURIComponent(game))
      .then(function (r) {
        if (!r.ok) throw new Error("rsvp " + r.status);
        return r.json();
      })
      .then(function (d) {
        if (d && d.count > 0) say(list, d.count + " confirmed: " + d.names.join(", "));
        else say(list, "Be the first name on the list.");
      })
      .catch(function () {
        say(list, "The confirmed list is not loading right now. Refresh to see who is in.");
      });
  }

  // Prefill display name from the email local-part; the visitor can overwrite.
  email.addEventListener("input", function () {
    if (!name.dataset.touched) name.value = (email.value.split("@")[0] || "");
  });
  name.addEventListener("input", function () { name.dataset.touched = "1"; });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (sending || confirmed) return;
    sending = true;
    if (submit) submit.disabled = true;
    say(status, "Sending your RSVP...");

    loaded
      .then(function (date) {
        return fetch("/api/rsvp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.value,
            displayName: name.value || email.value.split("@")[0],
            game: date
          })
        });
      })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) {
          confirmed = true;
          if (submit) submit.textContent = "You're in ✓";
          say(status, "");
          return refresh();
        }
        if (submit) submit.disabled = false;
        say(status, (d && d.error) || "That did not go through. Try again.");
      })
      .catch(function () {
        if (submit) submit.disabled = false;
        say(status, "Could not reach the table right now. Check your connection and try again.");
      })
      .then(function () { sending = false; });
  });
})();
