import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCode, zipPath } from '../../../src/provider/aws-services/zip';

/** Lists a zip's entries and contents with Python's zipfile, an independent reader. */
function readZip(zip: Buffer): Record<string, string> {
    const script = 'import sys,zipfile,io,json\nz=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))\nassert z.testzip() is None\nprint(json.dumps({n: z.read(n).decode() for n in z.namelist()}))';
    return JSON.parse(execFileSync('python3', ['-c', script], { input: zip, encoding: 'utf8' })) as Record<string, string>;
}

describe('zipPath', () => {
    it('zips a folder with relative, forward-slash paths', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'clover-'));
        mkdirSync(path.join(dir, 'lib'));
        writeFileSync(path.join(dir, 'index.mjs'), 'export const handler = () => 1;');
        writeFileSync(path.join(dir, 'lib', 'util.mjs'), 'export const x = 1;');

        expect(readZip(zipPath(dir))).toEqual({
            'index.mjs': 'export const handler = () => 1;',
            'lib/util.mjs': 'export const x = 1;',
        });
    });

    it('zips a single file at the root', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'clover-'));
        writeFileSync(path.join(dir, 'app.py'), 'def handler(e, c): pass');

        expect(readZip(zipPath(path.join(dir, 'app.py')))).toEqual({ 'app.py': 'def handler(e, c): pass' });
    });

    it('gives the same bytes for the same input', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'clover-'));
        writeFileSync(path.join(dir, 'index.mjs'), 'x');

        expect(zipPath(dir).equals(zipPath(dir))).toBe(true);
    });

    it('rejects an empty folder', () => {
        expect(() => zipPath(mkdtempSync(path.join(tmpdir(), 'clover-')))).toThrow('Nothing to zip');
    });
});

describe('loadCode', () => {
    it('uses a .zip file as-is', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'clover-'));
        const file = path.join(dir, 'code.zip');
        writeFileSync(file, 'PKzip');

        expect(loadCode(file).toString()).toBe('PKzip');
    });
});
