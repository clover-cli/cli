import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { confirm, parseJson, parseKeyValues, print } from '../../../src/commands/aws/shared';
import { askUser } from '../../../src/utils';
import { logged } from '../../helpers';

describe('parseKeyValues', () => {
    it('splits on the first =', () => {
        expect(parseKeyValues(['env=prod', 'url=a=b', 'empty='])).toEqual({ env: 'prod', url: 'a=b', empty: '' });
        expect(parseKeyValues(undefined)).toEqual({});
    });

    it('rejects values without a key', () => {
        expect(() => parseKeyValues(['env'])).toThrow('Invalid tag "env"');
        expect(() => parseKeyValues(['=x'], 'environment variable')).toThrow('Invalid environment variable');
    });
});

describe('parseJson', () => {
    it('reads inline JSON or @file', () => {
        const file = path.join(mkdtempSync(path.join(tmpdir(), 'clover-')), 'item.json');
        writeFileSync(file, '{"id":"1"}');

        expect(parseJson('[1,2]', '--item')).toEqual([1, 2]);
        expect(parseJson(`@${file}`, '--item')).toEqual({ id: '1' });
    });

    it('names the option when the JSON is invalid', () => {
        expect(() => parseJson('{nope', '--key')).toThrow('Invalid JSON for --key');
    });
});

describe('confirm', () => {
    it('skips the prompt with --yes', async () => {
        expect(await confirm({ yes: true }, 'Delete?')).toBe(true);
        expect(askUser).not.toHaveBeenCalled();
    });

    it('requires --yes without a terminal', async () => {
        process.stdin.isTTY = false;
        await expect(confirm({}, 'Delete?')).rejects.toThrow('Pass --yes');
    });

    it('asks in a terminal and only accepts yes', async () => {
        process.stdin.isTTY = true;
        vi.mocked(askUser).mockResolvedValueOnce('y').mockResolvedValueOnce('no').mockResolvedValueOnce('');

        expect(await confirm({}, 'Delete?')).toBe(true);
        expect(await confirm({}, 'Delete?')).toBe(false);
        expect(await confirm({}, 'Delete?')).toBe(false);
        expect(askUser).toHaveBeenCalledWith('Delete? [y/N] ');
    });
});

describe('print', () => {
    it('prints JSON', () => {
        print({ output: 'json' }, { a: 1 });
        expect(logged()).toBe('{\n  "a": 1\n}');
    });

    it('prints lists as tables and says when they are empty', () => {
        print({ output: 'table' }, [{ a: 1 }]);
        print({ output: 'table' }, [], 'No tables found.');
        expect(console.table).toHaveBeenCalledWith([{ a: 1 }]);
        expect(logged()).toBe('No tables found.');
    });

    it('prints objects as aligned key/value lines, skipping undefined', () => {
        print({ output: 'table' }, { id: 'i-1', longerKey: { x: 1 }, gone: undefined });
        expect(logged()).toBe('id         i-1\nlongerKey  {"x":1}');
    });
});
