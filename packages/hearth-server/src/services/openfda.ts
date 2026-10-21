import { cachedJson } from './http.js';

const OPENFDA = 'https://api.fda.gov/drug/label.json';

export type LabelTopic = 'purpose' | 'side_effects' | 'warnings' | 'interactions' | 'patient_info';

interface LabelResult {
  set_id: string;
  effective_time: string;
  openfda?: { generic_name?: string[]; brand_name?: string[] };
  [section: string]: unknown;
}

export interface LabelExcerpt {
  medication: string;
  topic: LabelTopic;
  excerpt: string;
  source: { title: string; url: string; labelDate: string };
}

/** Label sections to read for each question, in order of preference. */
const SECTIONS: Record<LabelTopic, string[]> = {
  purpose: ['purpose', 'indications_and_usage'],
  side_effects: ['adverse_reactions', 'information_for_patients'],
  warnings: ['boxed_warning', 'warnings_and_cautions', 'warnings', 'precautions'],
  interactions: ['drug_interactions'],
  // Deliberately excludes dosage_and_administration: dosing is between the person and their prescriber.
  patient_info: ['information_for_patients', 'spl_patient_package_insert'],
};

/** Strip the section heading and section numbers, then keep the first few sentences. */
export function tidy(text: string, maxChars = 700): string {
  let t = text
    .replace(/^\s*(\d+(\.\d+)*\s+)?[A-Z][A-Z &/,-]{3,}\s+/, '')
    .replace(/\[see[^\]]*\]/gi, '')
    .replace(/\(\s*\d+(\.\d+)*\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= maxChars) return t;
  t = t.slice(0, maxChars);
  const lastStop = t.lastIndexOf('. ');
  return (lastStop > maxChars * 0.5 ? t.slice(0, lastStop + 1) : t) + ' …';
}

/**
 * Reads FDA-approved drug labels from openFDA. Hearth only ever quotes the label with
 * attribution — it never paraphrases into advice.
 */
export class OpenFda {
  constructor(private readonly cacheDir: string) {}

  async label(ingredient: string): Promise<LabelResult | null> {
    const q = encodeURIComponent(`openfda.generic_name:"${ingredient}"`);
    const res = await cachedJson<{ results?: LabelResult[] }>(`${OPENFDA}?search=${q}&limit=10`, this.cacheDir);
    const results = res?.results ?? [];
    // Prefer single-ingredient labels: "LISINOPRIL" over "LISINOPRIL AND HYDROCHLOROTHIAZIDE".
    const single = results.filter((r) => !(r.openfda?.generic_name?.[0] ?? '').match(/\bAND\b|,/i));
    const pool = single.length ? single : results;
    return pool.sort((a, b) => b.effective_time.localeCompare(a.effective_time))[0] ?? null;
  }

  async excerpt(ingredient: string, topic: LabelTopic): Promise<LabelExcerpt | null> {
    const label = await this.label(ingredient);
    if (!label) return null;
    for (const section of SECTIONS[topic]) {
      const value = label[section];
      if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim()) {
        const d = label.effective_time;
        return {
          medication: label.openfda?.generic_name?.[0]?.toLowerCase() ?? ingredient,
          topic,
          excerpt: tidy(value[0]),
          source: {
            title: `FDA drug label (${section.replace(/_/g, ' ')})`,
            url: `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${label.set_id}`,
            labelDate: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
          },
        };
      }
    }
    return null;
  }
}
