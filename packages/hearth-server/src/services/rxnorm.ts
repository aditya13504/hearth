import { editDistance } from '../care.js';
import { cachedJson } from './http.js';

const RXNAV = 'https://rxnav.nlm.nih.gov/REST';

export interface RxMatch {
  rxcui: string;
  /** Ingredient name, e.g. "metformin". */
  ingredient: string;
  /** The concept RxNorm matched, e.g. "metformin 500 MG Oral Tablet". */
  matched: string;
  confidence: 'high' | 'medium' | 'low';
}

interface ApproxResponse {
  approximateGroup?: { candidate?: Array<{ rxcui: string; score: string; name?: string; source: string }> };
}
interface RelatedResponse {
  relatedGroup?: { conceptGroup?: Array<{ tty: string; conceptProperties?: Array<{ rxcui: string; name: string }> }> };
}

/**
 * Normalise a medication name as heard by speech recognition ("lisinoprl", "met for men")
 * to an RxNorm ingredient using the NIH RxNav approximate-match API.
 */
export class RxNorm {
  constructor(private readonly cacheDir: string) {}

  async normalise(spoken: string): Promise<RxMatch[]> {
    const raw = spoken.trim().toLowerCase();
    const joined = raw.replace(/[^a-z0-9]/g, '');
    const variants = [...new Set([raw, joined])].filter(Boolean);
    const seen = new Map<string, RxMatch & { score: number }>();

    const responses = await Promise.all(
      variants.map((term) =>
        cachedJson<ApproxResponse>(`${RXNAV}/approximateTerm.json?term=${encodeURIComponent(term)}&maxEntries=6&option=1`, this.cacheDir),
      ),
    );
    const candidates = responses
      .flatMap((res) =>
        (res?.approximateGroup?.candidate ?? [])
          .filter((c): c is typeof c & { name: string } => Boolean(c.name))
          .slice(0, 4),
      )
      .filter((c, i, all) => all.findIndex((x) => x.rxcui === c.rxcui) === i);
    const ingredients = await Promise.all(candidates.map((c) => this.ingredientOf(c.rxcui, c.name)));

    {
      for (const [i, c] of candidates.entries()) {
        const ingredient = ingredients[i];
        if (!ingredient) continue;
        // Brand names ("Eliquis") match the concept name, generics match the ingredient.
        const distance = Math.min(
          editDistance(joined, ingredient.name.replace(/[^a-z0-9]/g, '')),
          editDistance(joined, c.name.toLowerCase().replace(/[^a-z0-9]/g, '')),
        );
        // Prefer single-ingredient concepts whose spelling is close to what was heard.
        const score = Number(c.score) - distance * 1.5 - (ingredient.name.includes('/') ? 5 : 0);
        const prev = seen.get(ingredient.rxcui);
        if (!prev || prev.score < score) {
          seen.set(ingredient.rxcui, {
            rxcui: ingredient.rxcui,
            ingredient: ingredient.name,
            matched: c.name,
            confidence: distance <= 1 ? 'high' : distance <= 3 ? 'medium' : 'low',
            score,
          });
        }
      }
    }
    return [...seen.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ score: _score, ...m }) => m);
  }

  private async ingredientOf(rxcui: string, name: string): Promise<{ rxcui: string; name: string } | null> {
    const res = await cachedJson<RelatedResponse>(`${RXNAV}/rxcui/${rxcui}/related.json?tty=IN+MIN`, this.cacheDir);
    const groups = res?.relatedGroup?.conceptGroup ?? [];
    const single = groups.find((g) => g.tty === 'IN')?.conceptProperties ?? [];
    const multi = groups.find((g) => g.tty === 'MIN')?.conceptProperties ?? [];
    if (single.length === 1) return { rxcui: single[0].rxcui, name: single[0].name.toLowerCase() };
    if (multi.length > 0) return { rxcui: multi[0].rxcui, name: multi[0].name.toLowerCase() };
    if (single.length > 1) return { rxcui, name: single.map((s) => s.name.toLowerCase()).join(' / ') };
    // The candidate is itself an ingredient.
    return /\d/.test(name) ? null : { rxcui, name: name.toLowerCase() };
  }
}
