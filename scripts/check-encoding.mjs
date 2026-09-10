// Verifica che i file testuali versionati siano UTF-8 senza BOM e con fine riga LF
// (convenzione ARCHITECTURE.md §7). Eseguito da `npm run lint`; esce con codice 1 se trova problemi.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.css',
  '.md',
  '.yml',
  '.yaml',
  '.txt',
  '.example',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
]);

function isTextFile(path) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  const ext = dot === -1 ? base : base.slice(dot);
  return TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(base);
}

const tracked = execSync('git ls-files -z', { encoding: 'utf8' })
  .split('\0')
  .filter((p) => p.length > 0 && isTextFile(p));

const problems = [];
for (const path of tracked) {
  let buffer;
  try {
    buffer = readFileSync(path);
  } catch {
    continue; // file cancellato nella working copy: non è un problema di encoding
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    problems.push(`${path}: BOM UTF-8 presente`);
  }
  if (buffer.includes(0x0d)) {
    problems.push(`${path}: fine riga CRLF (atteso LF)`);
  }
}

if (problems.length > 0) {
  console.error('Controllo encoding fallito:');
  for (const p of problems) {
    console.error(`  - ${p}`);
  }
  process.exit(1);
}

console.log(`Controllo encoding ok: ${tracked.length} file testuali senza BOM e con LF.`);
