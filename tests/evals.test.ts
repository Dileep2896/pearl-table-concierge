import { describe, expect, it } from 'vitest';
import { grade } from '../evals/grade';
import { cases } from '../evals/dataset';

describe('understanding eval', () => {
  const report = grade();

  it('stays above the accuracy floor', () => {
    expect(report.accuracy).toBeGreaterThanOrEqual(0.8);
  });

  it('never regresses on the core (non-hard) cases', () => {
    // "hard" cases are known parser gaps; everything else must keep passing.
    const coreIds = new Set(cases.filter(c => !c.tags.includes('hard')).map(c => c.id));
    const coreFailures = report.failures.filter(f => coreIds.has(f.id));
    expect(coreFailures).toEqual([]);
  });
});
