export type Player = { slug: string; name: string; aka: string[] };

export class UnknownHandleError extends Error {
  constructor(handle: string) {
    super(
      `Unknown handle "${handle}". Add it to an existing player's aka list in ` +
      `site/data/games.json, or add a new player entry. Never guess.`
    );
  }
}

export function resolveSlug(handle: string, players: Player[]): string {
  const want = handle.toLowerCase();
  for (const p of players) {
    if (p.aka.some(a => a.toLowerCase() === want)) return p.slug;
  }
  throw new UnknownHandleError(handle);
}
