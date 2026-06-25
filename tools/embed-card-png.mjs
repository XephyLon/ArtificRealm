#!/usr/bin/env node
/**
 * Embeds the canonical character-card JSON directly into a PNG as a
 * "chara" tEXt chunk (the standard SillyTavern card-PNG format) with no
 * merging, no template, no field stripping.
 *
 * Why this exists: MVU_Game_Maker (~/MVU_Game_Maker) always merges an
 * uploaded card onto one of its two bundled templates. Any regex_script
 * or tavern_helper script whose name collides with a template script
 * (e.g. "StatusMenu") gets silently dropped in favor of the template's
 * stub. This tool bypasses that entirely: it reads the JSON, embeds it
 * verbatim into a PNG, done.
 *
 * Usage:
 *   node tools/embed-card-png.mjs [--json <path>] [--base-png <path>] [--out <path>]
 *
 * Defaults (run with no args to regenerate the canonical card PNG in place):
 *   --json      src/ArtificRealm創世域_Eng.json
 *   --base-png  CharacterCard/ArtificRealm_eng-1.01.png
 *   --out       (same as --base-png)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

function buildCharaTextChunk(cardJson) {
    const json = JSON.stringify(cardJson);
    const base64 = Buffer.from(json, 'utf-8').toString('base64');
    // tEXt chunk format: keyword + 0x00 + text
    const data = Buffer.concat([Buffer.from('chara\0', 'ascii'), Buffer.from(base64, 'ascii')]);
    return buildChunk('tEXt', data);
}

function isCharaTextChunk(chunk) {
    if (chunk.type !== 'tEXt') return false;
    const nul = chunk.data.indexOf(0);
    if (nul === -1) return false;
    return chunk.data.subarray(0, nul).toString('ascii') === 'chara';
}

/** Removes any existing "chara" tEXt chunks and inserts a fresh one before IEND. */
export function embedCardIntoPng(pngBuffer, cardJson) {
    const chunks = parsePngChunks(pngBuffer);
    const kept = chunks.filter((c) => c.type === 'IEND' || !isCharaTextChunk(c));
    const newChara = buildCharaTextChunk(cardJson);

    const parts = [PNG_SIGNATURE];
    for (const chunk of kept) {
        if (chunk.type === 'IEND') {
            parts.push(newChara);
        }
        parts.push(buildChunk(chunk.type, chunk.data));
    }
    return Buffer.concat(parts);
}

/** Reads the embedded "chara" tEXt chunk back out as a parsed JSON object, or null if absent. */
export function extractCardFromPng(pngBuffer) {
    const chunks = parsePngChunks(pngBuffer);
    const chara = chunks.find(isCharaTextChunk);
    if (!chara) return null;
    const nul = chara.data.indexOf(0);
    const base64 = chara.data.subarray(nul + 1).toString('ascii');
    const json = Buffer.from(base64, 'base64').toString('utf-8');
    return JSON.parse(json);
}

function parseArgs(argv) {
    const args = { json: null, basePng: null, out: null };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--json') args.json = argv[++i];
        else if (arg === '--base-png') args.basePng = argv[++i];
        else if (arg === '--out') args.out = argv[++i];
        else throw new Error(`Unknown argument: ${arg}`);
    }
    return args;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const jsonPath = args.json ?? path.join(REPO_ROOT, 'src', 'ArtificRealm創世域_Eng.json');
    const basePngPath = args.basePng ?? path.join(REPO_ROOT, 'CharacterCard', 'ArtificRealm_eng-1.01.png');
    const outPath = args.out ?? basePngPath;

    const cardJson = JSON.parse(readFileSync(jsonPath, 'utf-8'));
    const basePng = readFileSync(basePngPath);
    const outPng = embedCardIntoPng(basePng, cardJson);
    writeFileSync(outPath, outPng);

    console.log(`Embedded ${jsonPath} into ${outPath} (${outPng.length} bytes)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
