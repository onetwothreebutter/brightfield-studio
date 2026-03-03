import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LIQUID_DIRS = ['snippets', 'sections', 'layout', 'templates'];

function getLiquidFiles() {
  const files = [];
  for (const dir of LIQUID_DIRS) {
    let entries;
    try {
      entries = readdirSync(join(ROOT, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && extname(entry.name) === '.liquid') {
        files.push(join(ROOT, dir, entry.name));
      }
    }
  }
  return files;
}

describe('Liquid syntax', () => {
  const liquidFiles = getLiquidFiles();

  it('does not use filter pipes inside if/unless/elsif conditions', () => {
    const errors = [];

    for (const file of liquidFiles) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        if (!/\{%-?\s*(if|unless|elsif)\b/.test(line)) return;

        // Strip string literals so a | inside a quoted value doesn't trigger
        const stripped = line.replace(/'[^']*'|"[^"]*"/g, '""');

        // Extract the condition between the tag keyword and the closing %}
        const m = stripped.match(/\{%-?\s*(?:if|unless|elsif)\b([^%]+)%\}/);
        if (m && m[1].includes('|')) {
          const rel = file.replace(ROOT + '/', '');
          errors.push(`${rel}:${idx + 1}: filter pipe in condition — assign to a variable first`);
        }
      });
    }

    expect(errors).toEqual([]);
  });
});
