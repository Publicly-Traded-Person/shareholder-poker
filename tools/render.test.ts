import { describe, expect, test } from "bun:test";
import { renderStandings, renderGamesIndex, renderNextGameIcs, secondTuesday } from "./render";
import type { GamesData } from "./lib/standings";

const data: GamesData = {
  nextGame: { date: "2026-09-08", time: "7:00pm PT" },
  hopeCoin: { holder: "nick-m", since: "2026-04-14" },
  players: [
    { slug: "nick-m", name: "Nick M.", aka: ["nickmershon"] },
    { slug: "chris-g", name: "Chris G.", aka: ["LEWD"] },
  ],
  games: [
    { date: "2026-07-14", hands: 201, startingStack: 5000, buyIn: 50, entries: 3, pot: 150,
      cardSet: "2026-07",
      results: [
        { slug: "chris-g", handle: "LEWD", finish: 1, payout: 105, rebuys: 0, trophies: ["hope-slayer"] },
        { slug: "nick-m", handle: "nickmershon", finish: 2, payout: 45, rebuys: 2, trophies: [] },
      ] },
  ],
};

describe("renderStandings", () => {
  const html = renderStandings(data);
  test("is a full document using the theme", () => {
    expect(html).toStartWith("<!doctype html>");
    expect(html).toContain('href="/styles.css"');
    expect(html).toContain("ledger");
  });
  test("shows the coin holder with skull progress", () => {
    expect(html).toContain("Nick M.");
    expect(html).toContain("Hope Coin");
    expect(html).toContain("1 of 3");
  });
  test("states the record starts with July 2026 and earlier seasons are being backfilled", () => {
    expect(html).toContain("This record starts with July 2026");
    expect(html).toContain("2020, and April and June 2026");
    expect(html).toContain("backfilled");
  });
  test("contains no em dash", () => {
    expect(html).not.toContain("—");
  });
  test("marks the current page in the nav and links the favicon", () => {
    expect(html).toContain('<a href="/standings/" aria-current="page">');
    expect(html).toContain('href="/favicon.svg"');
  });
  test("shows the trophy tiles", () => {
    expect(html).toContain("The Foil");
    expect(html).toContain('class="tiles"');
    expect(html).toContain("Chris G.");
  });
  test("skull tallies use drawn skulls, filled plus outline to three", () => {
    expect(html).toContain('class="mark mark--skull"');
    expect(html).toContain('class="mark mark--skull-empty"');
  });
  test("draws marks as svg, never emoji", () => {
    expect(html).not.toContain("\u{1FA99}");
    expect(html).toContain('class="mark');
  });
  test("declares its own canonical url for link unfurls", () => {
    expect(html).toContain('<meta property="og:url" content="https://poker.kmikeym.com/standings/">');
  });
});

describe("renderGamesIndex", () => {
  const html = renderGamesIndex(data);
  test("links each game page, newest first", () => {
    expect(html).toContain('href="/games/2026-07-14/"');
  });
  test("names the winner", () => {
    expect(html).toContain("Chris G.");
  });
  test("states the record starts with July 2026 and earlier seasons are being backfilled", () => {
    expect(html).toContain("This record starts with July 2026");
    expect(html).toContain("2020, and April and June 2026");
    expect(html).toContain("backfilled");
  });
  test("contains no em dash", () => {
    expect(html).not.toContain("—");
  });
  test("renders each played game as a season card with its stat line", () => {
    expect(html).toContain('class="season-card"');
    expect(html).toContain("3 entries · $150 pot · 201 hands");
  });
  test("links the month's card set when the game has one", () => {
    expect(html).toContain('href="/cards/2026-07/"');
  });
  test("marks the current page in the nav", () => {
    expect(html).toContain('<a href="/games/" aria-current="page">');
  });
  test("declares its own canonical url for link unfurls", () => {
    expect(html).toContain('<meta property="og:url" content="https://poker.kmikeym.com/games/">');
  });
});

describe("secondTuesday", () => {
  test("computes the standing schedule's dates", () => {
    expect(secondTuesday(2026, 9)).toBe("2026-09-08");
    expect(secondTuesday(2026, 10)).toBe("2026-10-13");
    expect(secondTuesday(2026, 11)).toBe("2026-11-10");
    expect(secondTuesday(2027, 1)).toBe("2027-01-12");
  });
});

describe("season page (renderGamesIndex)", () => {
  const html = renderGamesIndex(data);
  test("orders the season chronologically with played, next, upcoming", () => {
    const played = html.indexOf("2026-07-14");
    const next = html.indexOf("season-card--next");
    const upcoming = html.indexOf("season-card--upcoming");
    expect(played).toBeGreaterThan(-1);
    expect(next).toBeGreaterThan(played);
    expect(upcoming).toBeGreaterThan(next);
  });
  test("the next-game card is the page's only lime, on felt, with the date", () => {
    expect(html.split("btn-primary").length - 1).toBe(1);
    expect(html).toContain("season-card--next");
    expect(html).toContain("2026-09-08");
    expect(html).toContain("RSVP for Sept 8");
  });
  test("played cards carry the podium from the record", () => {
    expect(html).toContain('class="podium"');
    expect(html).toContain("Chris G.");
    expect(html).toContain("$105");
    expect(html).toContain("Nick M.");
  });
  test("upcoming cards derive from the standing rule and say so", () => {
    expect(html).toContain("2026-10-13");
    expect(html).toContain("2026-11-10");
    expect(html).toContain("Second Tuesday, per the standing schedule");
  });
  test("links the calendar file", () => {
    expect(html).toContain('href="/next-game.ics"');
  });
});

describe("renderNextGameIcs", () => {
  const ics = renderNextGameIcs(data);
  test("is a deterministic VEVENT for the next game at 7pm Pacific", () => {
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("DTSTART;TZID=America/Los_Angeles:20260908T190000");
    expect(ics).toContain("DTEND;TZID=America/Los_Angeles:20260908T220000");
    expect(ics).toContain("UID:poker-kmikeym-2026-09-08");
    expect(ics).toContain("DTSTAMP:20260908T000000Z");
    expect(ics).toContain("URL:https://poker.kmikeym.com/");
  });
});
