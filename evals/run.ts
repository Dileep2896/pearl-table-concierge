import { grade } from './grade';

/** Human-readable eval report. `npm run eval`; exits non-zero below the floor so CI can gate it. */
const THRESHOLD = Number(process.env.EVAL_THRESHOLD ?? 0.8);
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

const report = grade();
console.log(`\nTavola understanding eval — ${report.passed}/${report.total} cases (${pct(report.accuracy)})\n`);

console.log('By intent field:');
for (const f of report.byField) console.log(`  ${f.field.padEnd(20)} ${f.hit}/${f.total}  ${pct(f.hit / f.total)}`);
console.log('\nBy category:');
for (const t of report.byTag) console.log(`  ${t.tag.padEnd(20)} ${t.passed}/${t.total}  ${pct(t.passed / t.total)}`);

if (report.failures.length) {
  console.log(`\n${report.failures.length} failing case(s):`);
  for (const f of report.failures) {
    console.log(`  [${f.id}] "${f.message}"`);
    for (const d of f.diffs) console.log(`      ${d.field}: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)}`);
  }
}

console.log(`\nThreshold ${pct(THRESHOLD)} — ${report.accuracy >= THRESHOLD ? 'PASS' : 'FAIL'}\n`);
process.exit(report.accuracy >= THRESHOLD ? 0 : 1);
