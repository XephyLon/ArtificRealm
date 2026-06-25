import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embedCardIntoPng, extractCardFromPng } from '../tools/embed-card-png.mjs';

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
