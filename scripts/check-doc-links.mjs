#!/usr/bin/env node
// Checks every relative Markdown link in README.md, docs/*.md and web/README.md:
// the target file/directory must exist and a `#fragment` into a .md file must match a heading
// (GitHub slug rules). External links (http:, https:, mailto:) are ignored.
//
//   node scripts/check-doc-links.mjs        exit 0 = all links resolve, 1 = broken links listed
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'README.md',
  'web/README.md',
  ...readdirSync(path.join(root, 'docs'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/${f}`),
];

function stripCode(markdown) {
  return markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

const anchorCache = new Map();
function anchorsOf(file) {
  if (!anchorCache.has(file)) {
    const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
    const seen = new Map();
    const anchors = new Set();
    for (const match of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
      const base = slug(match[1].replace(/`/g, ''));
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      anchors.add(n === 0 ? base : `${base}-${n}`);
    }
    anchorCache.set(file, anchors);
  }
  return anchorCache.get(file);
}

const broken = [];
let checked = 0;
for (const rel of files) {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) continue;
  const text = stripCode(readFileSync(abs, 'utf8'));
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1];
    if (/^(https?:|mailto:)/.test(target)) continue;
    checked += 1;
    const [filePart, fragment] = target.split('#');
    const resolved = filePart === '' ? abs : path.resolve(path.dirname(abs), decodeURI(filePart));
    if (!existsSync(resolved)) {
      broken.push(`${rel}: ${target} → missing ${path.relative(root, resolved)}`);
      continue;
    }
    if (fragment !== undefined && resolved.endsWith('.md') && !anchorsOf(resolved).has(fragment)) {
      broken.push(`${rel}: ${target} → no heading #${fragment} in ${path.relative(root, resolved)}`);
    }
  }
}

if (broken.length > 0) {
  console.error(`${broken.length} broken link(s) of ${checked} checked:\n  ${broken.join('\n  ')}`);
  process.exit(1);
}
console.log(`All ${checked} relative links in ${files.length} files resolve.`);
