import type { Branch } from '../components/partials/Header';

/** Default sidebar logo when "All Branches" is selected */
export const DEFAULT_ALL_BRANCHES_LOGO = '/uploads/branches/GENERAL_ALL_BRANCHES.png';

export function resolveBranchLogoUrl(logoPath: string | null | undefined): string | null {
  if (!logoPath || !String(logoPath).trim()) return null;
  const path = String(logoPath).trim();
  if (path.startsWith('http')) return path;
  return path.startsWith('/') ? path : `/${path}`;
}

/** Sidebar header image for a specific branch; null for "all" (static icon in UI) */
export function resolveSidebarBranchLogo(branch: Branch | null | undefined): string | null {
  if (!branch || String(branch.id) === 'all') {
    return null;
  }
  return resolveBranchLogoUrl(branch.logo);
}

const normalizeBranchName = (name: string) =>
  String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[''`]/g, '');

export function is3coreBranch(name: string | null | undefined): boolean {
  const n = normalizeBranchName(name || '');
  return n === '3core' || n.includes('3core');
}

export function isNoirBranch(name: string | null | undefined): boolean {
  const n = normalizeBranchName(name || '');
  return /noir/.test(n);
}

/** Branches hidden from All Branches sidebar grid, dashboard cards, and compare. */
export function isExcludedFromAllBranchesView(name: string | null | undefined): boolean {
  return is3coreBranch(name) || isNoirBranch(name);
}

/** All Branches sidebar grid: row1 kim's, Bluemoon, Kumho — row2 PRIME, EESOME */
const ALL_BRANCHES_SIDEBAR_MATCHERS: Array<(name: string) => boolean> = [
  (n) => /kim/.test(n),
  (n) => /blue\s*moon|bluemoon/.test(n),
  (n) => /kumho|kum\s*ho|keumho|keum\s*ho|daraejung/.test(n),
  (n) => /prime/.test(n),
  (n) => /eesome/.test(n) && !/noir/.test(n),
];

/** Fixed branch order (sidebar + dashboard compare). Excludes hidden branches by default. */
export function sortBranchesBySidebarOrder<T extends { id: number | string; name: string }>(
  branches: T[],
  options?: { exclude3core?: boolean; appendUnmatched?: boolean },
): T[] {
  const exclude3core = options?.exclude3core ?? true;
  const appendUnmatched = options?.appendUnmatched ?? true;
  const pool = exclude3core
    ? branches.filter((b) => !isExcludedFromAllBranchesView(b.name))
    : [...branches];
  const used = new Set<string>();
  const ordered: T[] = [];

  for (const match of ALL_BRANCHES_SIDEBAR_MATCHERS) {
    const found = pool.find((b) => {
      const id = String(b.id);
      if (used.has(id)) return false;
      return match(normalizeBranchName(b.name));
    });
    if (found) {
      ordered.push(found);
      used.add(String(found.id));
    }
  }

  if (appendUnmatched) {
    const rest = pool
      .filter((b) => !used.has(String(b.id)))
      .sort((a, b) => normalizeBranchName(a.name).localeCompare(normalizeBranchName(b.name)));
    ordered.push(...rest);
  }

  return ordered;
}

export function prepareAllBranchesSidebarLogos(branches: Branch[]): Branch[] {
  return sortBranchesBySidebarOrder(branches, { exclude3core: true, appendUnmatched: false });
}
