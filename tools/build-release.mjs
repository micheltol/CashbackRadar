// Maakt het pakket en de release notes voor een release. Wordt door de GitHub-workflow
// (.github/workflows/release.yml) bij elke commit op main gedraaid, maar werkt ook lokaal:
//
//   node tools/build-release.mjs
//   CHANNEL=beta node tools/build-release.mjs
//
// Twee kanalen (CHANNEL, standaard stable):
//   stable  tag v1.2.0.57, gewone release; de workflow zet deze ook in de Edge-store
//   beta    tag v1.2.0.58-beta, pre-release op GitHub
//
// Resultaat in dist/:
//   CashbackRadar-<versie>/   de extensie, met het versienummer van deze build in het manifest
//   release-notes.md          de commits sinds de vorige release, plus installatie-uitleg
//
// Het versienummer is de versie uit extension/manifest.json met het aantal commits
// erachter (1.2.0 -> 1.2.0.57). Zo heeft elke commit zijn eigen, oplopende versie en
// zie je in edge://extensions precies welke build geladen is.

import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const MAX_COMMITS = 50; // de eerste release zou anders de hele geschiedenis opsommen
const CHANNEL = process.env.CHANNEL || 'stable';
if (!['stable', 'beta'].includes(CHANNEL)) throw new Error(`Onbekend kanaal: ${CHANNEL} (stable of beta)`);
const beta = CHANNEL === 'beta';

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const tryGit = (...args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

// --- versie ---------------------------------------------------------------------

const manifest = JSON.parse(readFileSync(join(root, 'extension', 'manifest.json'), 'utf8'));
const base = String(manifest.version).split('.').slice(0, 3);
while (base.length < 3) base.push('0');
if (!base.every((part) => /^\d+$/.test(part))) {
  throw new Error(`Onverwachte versie in manifest.json: ${manifest.version}`);
}
const build = Number(git('rev-list', '--count', 'HEAD'));
if (build > 65535) throw new Error('Te veel commits voor het vierde versiegetal (maximaal 65535)');

const version = [...base, build].join('.');
// Het manifest moet vier getallen hebben; het kanaal staat alleen in de tag en de titel.
const tag = beta ? `v${version}-beta` : `v${version}`;
const name = `${manifest.name}-${version}`;
const zip = `${name}.zip`;

// --- pakket ---------------------------------------------------------------------

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, 'extension'), join(dist, name), { recursive: true });
writeFileSync(join(dist, name, 'manifest.json'), `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);

// --- release notes ----------------------------------------------------------------

// De vorige release is de laatste v-tag die vóór deze commit ligt. Een stabiele release
// vergelijkt met de vorige stabiele, zodat de notes alles sinds de vorige store-versie tonen.
const previousTag = tryGit(
  'describe',
  '--tags',
  '--abbrev=0',
  '--match',
  'v[0-9]*',
  ...(beta ? [] : ['--exclude', '*-beta']),
  'HEAD',
);
const range = previousTag ? `${previousTag}..HEAD` : 'HEAD';
const log = git('log', '--no-merges', `--max-count=${MAX_COMMITS + 1}`, '--format=%H%x1f%s%x1f%b%x1e', range);
const commits = log
  .split('\x1e')
  .map((record) => record.trim())
  .filter(Boolean)
  .map((record) => {
    const [hash, subject, body = ''] = record.split('\x1f');
    return { hash, subject: subject.trim(), body };
  });
const truncated = commits.length > MAX_COMMITS;
if (truncated) commits.length = MAX_COMMITS;

const repoUrl =
  process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`
    : null;

// Regels als "Co-Authored-By: ..." horen bij de commit, niet in de release notes.
const TRAILER = /^[A-Za-z][A-Za-z-]*-[Bb]y:\s/;

function commitNote({ hash, subject, body }) {
  const short = hash.slice(0, 7);
  const reference = repoUrl ? `[\`${short}\`](${repoUrl}/commit/${hash})` : `\`${short}\``;
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => !TRAILER.test(line));
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines.at(-1) === '') lines.pop();
  // De toelichting springt in, zodat ze bij het punt van de commit blijft horen.
  const details = lines.length ? `\n\n${lines.map((line) => (line ? `  ${line}` : '')).join('\n')}` : '';
  return `- **${subject}** (${reference})${details}`;
}

const notes = [
  ...(beta ? ['> **Beta.** Testversie van de `beta`-branch; deze komt niet in de stores.', ''] : []),
  '## Wijzigingen',
  '',
  commits.length ? commits.map(commitNote).join('\n\n') : '_Geen wijzigingen sinds de vorige release._',
];
if (truncated) notes.push('', `_Alleen de laatste ${MAX_COMMITS} commits zijn opgesomd._`);
if (repoUrl && previousTag) {
  notes.push('', `Alle wijzigingen: [${previousTag}...${tag}](${repoUrl}/compare/${previousTag}...${tag})`);
}
notes.push(
  '',
  '## Installeren',
  '',
  `1. Download \`${zip}\` hieronder en pak het uit in een map die blijft staan.`,
  '2. Open `edge://extensions` en zet **Ontwikkelaarsmodus** aan.',
  '3. Nieuw: klik **Uitgepakte extensie laden** en kies de uitgepakte map.',
  '   Bijwerken: pak het zip-bestand uit over de bestaande map en klik op de kaart van de extensie op **Opnieuw laden**.',
  '',
  `De geladen versie staat op \`edge://extensions\` bij de extensie: \`${version}\`.`,
  '',
);
writeFileSync(join(dist, 'release-notes.md'), notes.join('\n'));

// --- uitkomst ---------------------------------------------------------------------

const title = `${manifest.name} ${version}${beta ? ' (beta)' : ''}`;
const outputs = { version, tag, name, zip, title, channel: CHANNEL, prerelease: String(beta), previous_tag: previousTag };
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''));
}
console.log(`Pakket:        dist/${name}/`);
console.log(`Release notes: dist/release-notes.md (${commits.length} commits sinds ${previousTag || 'het begin'})`);
console.log(`Tag:           ${tag}`);
