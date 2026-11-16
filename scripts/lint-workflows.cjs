/**
 * Lint GitHub Actions workflows with actionlint (wasm build, no binary needed).
 *
 * This is what caught the `secrets` context being used in a step-level `if`,
 * which makes GitHub reject the whole workflow file before any job starts.
 *
 * Usage: npm run lint:workflows
 */
const { createLinter } = require('actionlint');
const fs = require('fs');
const path = require('path');

(async () => {
  const lint = await createLinter();
  const dir = path.join(__dirname, '..', '.github', 'workflows');
  let files = process.argv.slice(2);
  if (!files.length) files = fs.readdirSync(dir).map((f) => path.join(dir, f));
  let total = 0;
  for (const f of files) {
    const results = lint(fs.readFileSync(f, 'utf8'), f);
    for (const r of results) {
      total++;
      console.log(`${r.file}:${r.line}:${r.column} [${r.kind}] ${r.message}`);
    }
  }
  console.log(total === 0 ? 'actionlint: no problems found' : `actionlint: ${total} problem(s)`);
})().catch((e) => { console.error('lint failed:', e); process.exit(1); });
