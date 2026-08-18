// RSVP form wiring. Endpoint contract:
//   POST /api/rsvp  {email, displayName, game} -> {ok: true} | {error}
//   GET  /api/rsvp?game=YYYY-MM-DD -> {count, names: [string]}  (never emails)
(function () {
  var GAME = "2026-09-08";
  var form = document.getElementById("rsvp-form");
  var email = document.getElementById("rsvp-email");
  var name = document.getElementById("rsvp-name");
  var list = document.getElementById("rsvp-list");

  function refresh() {
    fetch("/api/rsvp?game=" + GAME).then(function (r) { return r.json(); }).then(function (d) {
      if (d.count > 0) list.textContent = d.count + " confirmed: " + d.names.join(", ");
      else list.textContent = "Be the first name on the list.";
    }).catch(function () { list.textContent = ""; });
  }

  // Prefill display name from the email local-part; the visitor can overwrite.
  email.addEventListener("input", function () {
    if (!name.dataset.touched) name.value = (email.value.split("@")[0] || "");
  });
  name.addEventListener("input", function () { name.dataset.touched = "1"; });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    fetch("/api/rsvp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.value, displayName: name.value || email.value.split("@")[0], game: GAME }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) { form.querySelector("button").textContent = "You're in ✓"; refresh(); }
      else list.textContent = d.error || "Something went wrong. Try again.";
    });
  });

  refresh();
})();
