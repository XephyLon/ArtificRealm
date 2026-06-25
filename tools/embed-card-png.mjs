#!/usr/bin/env node
/**
 * Embeds the canonical character-card JSON directly into a PNG as both
 * "chara" (v2 spec) and "ccv3" (chara_card_v3 spec) tEXt chunks with no
 * merging, no template, no field stripping. SillyTavern reads "ccv3" in
 * preference to "chara" when both are present — a base PNG that already
 * carries a stale "ccv3" chunk from an earlier export will silently win
 * over a freshly-written "chara" chunk unless both are kept in sync, which
 * is exactly what happened the first time this tool shipped (only "chara"
 * was rewritten, so ST kept reading the old "ccv3" data). Also bumps
 * data.character_version in the source JSON and logs the export to
 * CHANGELOG.md and CharacterCard/export-history.jsonl.
 *
 * Why this exists: MVU_Game_Maker (~/MVU_Game_Maker) always merges an
 * uploaded card onto one of its two bundled templates. Any regex_script
 * or tavern_helper script whose name collides with a template script
 * (e.g. "StatusMenu") gets silently dropped in favor of the template's
 * stub. This tool bypasses that entirely: it reads the JSON, embeds it
 * verbatim into a PNG, done.
 *
 * Usage:
 *   node tools/embed-card-png.mjs [--json <path>] [--base-png <path>] [--out <path>] [--version <X.Y>] [--note "..."]
 *
 * Defaults (run with no args to regenerate the canonical card PNG in place):
 *   --json      src/ArtificRealm創世域_Eng.json
 *   --base-png  CharacterCard/ArtificRealm_eng-1.01.png
 *   --out       (same as --base-png)
 *   --version   auto-bump current data.character_version by 0.01
 *   --note      "" (recorded in CHANGELOG.md and the export history log)
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function parsePngChunks(buf) {
    if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
        throw new Error('Not a valid PNG file (bad signature)');
    }
    const chunks = [];
    let offset = 8;
    while (offset < buf.length) {
        const length = buf.readUInt32BE(offset);
        const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        const data = buf.subarray(dataStart, dataEnd);
        const crc = buf.readUInt32BE(dataEnd);
        chunks.push({ type, data, length, crc });
        offset = dataEnd + 4;
        if (type === 'IEND') break;
    }
    return chunks;
}

function buildChunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const body = Buffer.concat([typeBuf, data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([length, body, crc]);
}

const CARD_KEYWORDS = ['chara', 'ccv3'];

function buildCardTextChunk(keyword, cardJson) {
    const json = JSON.stringify(cardJson);
    const base64 = Buffer.from(json, 'utf-8').toString('base64');
    // tEXt chunk format: keyword + 0x00 + text
    const data = Buffer.concat([Buffer.from(`${keyword}\0`, 'ascii'), Buffer.from(base64, 'ascii')]);
    return buildChunk('tEXt', data);
}

function textChunkKeyword(chunk) {
    if (chunk.type !== 'tEXt') return null;
    const nul = chunk.data.indexOf(0);
    if (nul === -1) return null;
    return chunk.data.subarray(0, nul).toString('ascii');
}

/** Removes any existing "chara"/"ccv3" tEXt chunks and inserts fresh ones (both, in sync) before IEND. */
export function embedCardIntoPng(pngBuffer, cardJson) {
    const chunks = parsePngChunks(pngBuffer);
    const kept = chunks.filter((c) => c.type === 'IEND' || !CARD_KEYWORDS.includes(textChunkKeyword(c)));

    const parts = [PNG_SIGNATURE];
    for (const chunk of kept) {
        if (chunk.type === 'IEND') {
            for (const keyword of CARD_KEYWORDS) parts.push(buildCardTextChunk(keyword, cardJson));
        }
        parts.push(buildChunk(chunk.type, chunk.data));
    }
    return Buffer.concat(parts);
}

/** Reads the embedded card back out as a parsed JSON object, preferring "ccv3" over "chara" (matches SillyTavern's own precedence), or null if neither is present. */
export function extractCardFromPng(pngBuffer) {
    const chunks = parsePngChunks(pngBuffer);
    for (const keyword of ['ccv3', 'chara']) {
        const chunk = chunks.find((c) => textChunkKeyword(c) === keyword);
        if (!chunk) continue;
        const nul = chunk.data.indexOf(0);
        const base64 = chunk.data.subarray(nul + 1).toString('ascii');
        const json = Buffer.from(base64, 'base64').toString('utf-8');
        return JSON.parse(json);
    }
    return null;
}

/** Bumps an "X.Y" version string by 0.01 (e.g. "1.00" -> "1.01"). Unparseable input starts at "1.00". */
export function bumpVersion(current) {
    const parsed = typeof current === 'string' ? parseFloat(current) : NaN;
    const next = Number.isFinite(parsed) ? parsed + 0.01 : 1.0;
    return next.toFixed(2);
}

/** Prepends a "## [version] - date" entry (with note) to CHANGELOG.md, creating it if absent. */
export function appendChangelogEntry(changelogPath, { version, date, note }) {
    const header = '# Changelog\n\n';
    const entry = `## [${version}] - ${date}\n\n- ${note || 'No note provided.'}\n\n`;
    const existing = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf-8') : header;
    const body = existing.startsWith(header) ? existing.slice(header.length) : existing;
    writeFileSync(changelogPath, header + entry + body);
}

/** Appends one JSON line per export to the history log, creating it if absent. */
export function appendExportHistoryEntry(historyPath, entry) {
    appendFileSync(historyPath, JSON.stringify(entry) + '\n');
}

function parseArgs(argv) {
    const args = { json: null, basePng: null, out: null, version: null, note: '' };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--json') args.json = argv[++i];
        else if (arg === '--base-png') args.basePng = argv[++i];
        else if (arg === '--out') args.out = argv[++i];
        else if (arg === '--version') args.version = argv[++i];
        else if (arg === '--note') args.note = argv[++i];
        else throw new Error(`Unknown argument: ${arg}`);
    }
    return args;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const jsonPath = args.json ?? path.join(REPO_ROOT, 'src', 'ArtificRealm創世域_Eng.json');
    const basePngPath = args.basePng ?? path.join(REPO_ROOT, 'CharacterCard', 'ArtificRealm_eng-1.01.png');
    const outPath = args.out ?? basePngPath;
    const changelogPath = path.join(REPO_ROOT, 'CHANGELOG.md');
    const historyPath = path.join(REPO_ROOT, 'CharacterCard', 'export-history.jsonl');

    const cardJson = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    const previousVersion = cardJson.data?.character_version ?? '';
    const version = args.version ?? bumpVersion(previousVersion);
    if (cardJson.data) cardJson.data.character_version = version;

    const basePng = readFileSync(basePngPath);
    const outPng = embedCardIntoPng(basePng, cardJson);

    writeFileSync(jsonPath, JSON.stringify(cardJson, null, 2));
    writeFileSync(outPath, outPng);

    const date = new Date().toISOString().slice(0, 10);
    appendChangelogEntry(changelogPath, { version, date, note: args.note });
    appendExportHistoryEntry(historyPath, {
        version,
        previousVersion,
        date,
        note: args.note,
        jsonPath: path.relative(REPO_ROOT, jsonPath),
        outPath: path.relative(REPO_ROOT, outPath),
        sha256: createHash('sha256').update(outPng).digest('hex'),
    });

    console.log(`Embedded ${jsonPath} (v${version}) into ${outPath} (${outPng.length} bytes)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
