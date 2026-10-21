// Yksinkertainen hash-reititys, joka toimii staattisella sivulla ilman palvelinasetuksia.

export type Route = 'tanaan' | 'kartta' | 'ajankohdat' | 'tietoa';

export const ROUTES: ReadonlyArray<{ route: Route; label: string }> = [
  { route: 'tanaan', label: 'Tänään' },
  { route: 'kartta', label: 'Riskikartta' },
  { route: 'ajankohdat', label: 'Ajankohdat' },
  { route: 'tietoa', label: 'Tietoa' },
];

export function parseRoute(hash: string): Route {
  const r = hash.replace(/^#\/?/, '');
  return ROUTES.some((x) => x.route === r) ? (r as Route) : 'tanaan';
}
