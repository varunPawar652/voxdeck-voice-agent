#!/usr/bin/env node
/**
 * Acceptance check M: fails if the built client bundle contains anything that
 * looks like a standard OpenAI API key, or the literal value from .env.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');
if (!fs.existsSync(dist)) {
  console.error('client/dist not found — run `npm run build` first.');
  process.exit(1);
}

let envKey;
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  envKey = /^OPENAI_API_KEY=(.+)$/m.exec(fs.readFileSync(envFile, 'utf8'))?.[1]?.trim();
}

const keyPattern = /sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/;
const findings = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else {
      const text = fs.readFileSync(file, 'utf8');
      if (keyPattern.test(text)) findings.push(`${path.relative(root, file)}: matches an OpenAI key pattern`);
      if (envKey && text.includes(envKey)) findings.push(`${path.relative(root, file)}: contains OPENAI_API_KEY from .env`);
      if (text.includes('OPENAI_API_KEY')) findings.push(`${path.relative(root, file)}: references OPENAI_API_KEY`);
    }
  }
};
walk(dist);

if (findings.length) {
  console.error('✗ Secret scan failed:\n  ' + findings.join('\n  '));
  process.exit(1);
}
console.log(`✓ No API keys found in client/dist${envKey ? ' (checked against .env value too)' : ''}.`);
