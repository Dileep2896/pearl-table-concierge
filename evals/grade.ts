import { parseIntent, type Intent } from '../server/chat';
import { cases as defaultCases, NOW, type EvalCase } from './dataset';

export type Diff = { field: string; expected: unknown; actual: unknown };
export type Failure = { id: string; message: string; diffs: Diff[] };
export type Report = {
  total: number;
  passed: number;
  accuracy: number;
  byField: { field: string; hit: number; total: number }[];
  byTag: { tag: string; passed: number; total: number }[];
  failures: Failure[];
};

/** Grade a case set against the deterministic parser. Pure: same cases + NOW → same report. */
export function grade(cases: EvalCase[] = defaultCases, now: Date = NOW): Report {
  const field = new Map<string, { hit: number; total: number }>();
  const tag = new Map<string, { passed: number; total: number }>();
  const failures: Failure[] = [];
  let passed = 0;

  for (const c of cases) {
    const got = parseIntent(c.message, c.previous ?? {}, now) as Record<string, unknown>;
    const diffs: Diff[] = [];
    for (const [key, expected] of Object.entries(c.expect) as [keyof Intent, unknown][]) {
      const actual = got[key];
      const stat = field.get(key) ?? { hit: 0, total: 0 };
      stat.total++;
      if (actual === expected) stat.hit++;
      else diffs.push({ field: key, expected, actual });
      field.set(key, stat);
    }
    const ok = diffs.length === 0;
    if (ok) passed++; else failures.push({ id: c.id, message: c.message, diffs });
    for (const t of c.tags) { const s = tag.get(t) ?? { passed: 0, total: 0 }; s.total++; if (ok) s.passed++; tag.set(t, s); }
  }

  return {
    total: cases.length,
    passed,
    accuracy: cases.length ? passed / cases.length : 1,
    byField: [...field].map(([f, s]) => ({ field: f, ...s })).sort((a, b) => a.field.localeCompare(b.field)),
    byTag: [...tag].map(([t, s]) => ({ tag: t, ...s })).sort((a, b) => a.tag.localeCompare(b.tag)),
    failures,
  };
}
