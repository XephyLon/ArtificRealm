import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    embedCardIntoPng,
    extractCardFromPng,
    bumpVersion,
    appendChangelogEntry,
    appendExportHistoryEntry,
} from '../tools/embed-card-png.mjs';

// 1x1 transparent PNG, no ancillary chunks (signature + IHDR + IDAT + IEND).
const BLANK_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function blankPng() {
    return Buffer.from(BLANK_PNG_BASE64, 'base64');
}

test('embedCardIntoPng round-trips an arbitrary JSON object exactly', () => {
    const card = { name: 'Test Card', data: { extensions: { tavern_helper: { scripts: [] } } } };
    const png = embedCardIntoPng(blankPng(), card);
    const extracted = extractCardFromPng(png);
    assert.deepEqual(extracted, card);
});

test('embedCardIntoPng output is still a valid PNG (signature + IEND intact)', () => {
    const card = { name: 'Test Card' };
    const png = embedCardIntoPng(blankPng(), card);
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.ok(png.subarray(0, 8).equals(signature));
    assert.ok(png.subarray(png.length - 8, png.length - 4).toString('ascii') === 'IEND');
});

test('embedCardIntoPng replaces a pre-existing chara chunk rather than appending a second one', () => {
    const oldCard = { name: 'Old' };
    const newCard = { name: 'New' };
    const withOld = embedCardIntoPng(blankPng(), oldCard);
    const withNew = embedCardIntoPng(withOld, newCard);
    assert.deepEqual(extractCardFromPng(withNew), newCard);
    // Only one "chara" tEXt chunk should remain.
    const occurrences = withNew.toString('latin1').split('chara\0').length - 1;
    assert.equal(occurrences, 1);
});

test('embedCardIntoPng preserves unrelated chunks (e.g. IHDR) byte-for-byte', () => {
    const base = blankPng();
    const png = embedCardIntoPng(base, { name: 'x' });
    // IHDR is always the chunk immediately following the signature.
    const ihdrLength = 13;
    const ihdrChunkBytes = 4 + 4 + ihdrLength + 4; // length + type + data + crc
    assert.ok(png.subarray(8, 8 + ihdrChunkBytes).equals(base.subarray(8, 8 + ihdrChunkBytes)));
});

test('bumpVersion increments by 0.01', () => {
    assert.equal(bumpVersion('1.00'), '1.01');
    assert.equal(bumpVersion('0.95'), '0.96');
});

test('bumpVersion starts at 1.00 for empty or unparseable input', () => {
    assert.equal(bumpVersion(''), '1.00');
    assert.equal(bumpVersion(undefined), '1.00');
    assert.equal(bumpVersion('not-a-version'), '1.00');
});

test('appendChangelogEntry creates the file with a header and prepends newest-first', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'changelog-test-'));
    const changelogPath = path.join(dir, 'CHANGELOG.md');

    appendChangelogEntry(changelogPath, { version: '1.01', date: '2026-06-25', note: 'First export.' });
    appendChangelogEntry(changelogPath, { version: '1.02', date: '2026-06-26', note: 'Second export.' });

    const content = readFileSync(changelogPath, 'utf-8');
    assert.ok(content.startsWith('# Changelog\n\n## [1.02]'));
    assert.ok(content.indexOf('[1.02]') < content.indexOf('[1.01]'));
    assert.ok(content.includes('Second export.'));
    assert.ok(content.includes('First export.'));
});

test('appendChangelogEntry falls back to "No note provided." when note is empty', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'changelog-test-'));
    const changelogPath = path.join(dir, 'CHANGELOG.md');
    appendChangelogEntry(changelogPath, { version: '1.00', date: '2026-06-25', note: '' });
    assert.ok(readFileSync(changelogPath, 'utf-8').includes('No note provided.'));
});

test('appendExportHistoryEntry appends one JSON line per call', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'history-test-'));
    const historyPath = path.join(dir, 'export-history.jsonl');

    appendExportHistoryEntry(historyPath, { version: '1.01' });
    appendExportHistoryEntry(historyPath, { version: '1.02' });

    assert.ok(existsSync(historyPath));
    const lines = readFileSync(historyPath, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]), { version: '1.01' });
    assert.deepEqual(JSON.parse(lines[1]), { version: '1.02' });
});
