import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from '../vendor/makefun-threejs.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync('/tmp/opencode/fps-dossier-');
const sourceExt = /\.(html|js|mjs|css|glsl|vert|frag|wgsl|json)$/;
const minified = /\.min\.(js|mjs|css)$/;

function files(dir, prefix = '') {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const path = prefix + entry.name;
    assert(!entry.isSymbolicLink(), `Symlink tidak diizinkan: ${path}`);
    return entry.isDirectory() ? files(join(dir, entry.name), path + '/') : [path];
  });
}

try {
  const outputs = ['first', 'second'].map(name => join(temp, name));
  for (const out of outputs) {
    execFileSync(process.execPath, ['main.ts'], {
      cwd: root, env: { ...process.env, MAKEFUN_OUTPUT_DIR: out }, timeout: 120_000,
    });
  }
  const firstFiles = files(outputs[0]);
  assert.deepEqual(firstFiles, files(outputs[1]), 'Output kedua berbeda struktur');
  for (const path of firstFiles) {
    assert.deepEqual(readFileSync(join(outputs[0], path)), readFileSync(join(outputs[1], path)), `Output berbeda: ${path}`);
  }
  const bytes = readFileSync(join(outputs[0], 'dossier.json'));
  const doc = JSON.parse(bytes);
  const textBytes = Buffer.byteLength(doc.text);
  assert(textBytes <= 163840, `Dossier text melebihi cap: ${textBytes}`);
  if (doc.text.includes('[Cut at')) {
    // Diagnostic only: measure uncut source; the real output must still meet 163840 bytes.
    const complete = JSON.parse(Buffer.from(buildDossier(outputs[0], { text_max_bytes: 1_000_000 })));
    const required = Buffer.byteLength(complete.text);
    console.error(JSON.stringify({ result: 'FAIL', requiredTextBytes: required, overCap: required - 163840, cut: true }));
  }
  assert(!doc.text.includes('[Cut at'), 'Source terpotong di dossier');
  assert(bytes.length <= 1572864, 'Dossier JSON melebihi 1.5 MiB');
  const sources = files(join(root, 'game')).filter(path =>
    !path.split('/').includes('vendor') && sourceExt.test(path) && !minified.test(path));
  for (const path of sources) {
    assert(doc.text.includes(`### game/${path} (`), `Header source hilang: ${path}`);
    assert(doc.text.includes(readFileSync(join(root, 'game', path), 'utf8')), `Source tidak utuh: ${path}`);
    if (/\.(js|mjs)$/.test(path)) execFileSync(process.execPath, ['--check', join(root, 'game', path)]);
  }
  assert.equal(doc.images.length, 4, 'Harus tepat empat screenshot');
  for (const image of doc.images) {
    const imageBytes = Buffer.from(image.base64, 'base64');
    assert(imageBytes.length <= 262144, `Screenshot terlalu besar: ${image.name}`);
    assert.deepEqual(imageBytes, readFileSync(join(root, 'screenshots', image.name)), `Screenshot dossier berbeda: ${image.name}`);
  }
  console.log(JSON.stringify({
    result: 'PASS', deterministic: true, sourceFiles: sources.length, sourceComplete: true,
    textBytes, textCap: 163840, headroom: 163840 - textBytes, cut: false,
    dossierBytes: bytes.length, screenshots: doc.images.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }, null, 2));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
