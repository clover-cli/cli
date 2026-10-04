import { describe, expect, it } from 'vitest';
import {
    createDatabase, deleteDatabase, deleteItem, fromFields, getItem, putItem, scanItems, toFields, waitForOperation,
} from '../../../src/provider/gcp-services/firestore';
import { fakeGcpClient } from '../../helpers';

const API = 'https://firestore.googleapis.com/v1/projects/p/databases';

/** An error like the one gaxios throws for an HTTP status. */
function httpError(status: number) {
    return Object.assign(new Error(`HTTP ${status}`), { response: { status } });
}

describe('toFields / fromFields', () => {
    it('round-trips plain JSON through Firestore typed values', () => {
        const item = { s: 'a', i: 2, d: 1.5, b: true, n: null, list: [1, 'x'], map: { deep: { k: false } } };
        const fields = toFields(item);

        expect(fields).toEqual({
            s: { stringValue: 'a' },
            i: { integerValue: '2' },
            d: { doubleValue: 1.5 },
            b: { booleanValue: true },
            n: { nullValue: null },
            list: { arrayValue: { values: [{ integerValue: '1' }, { stringValue: 'x' }] } },
            map: { mapValue: { fields: { deep: { mapValue: { fields: { k: { booleanValue: false } } } } } } },
        });
        expect(fromFields(fields)).toEqual(item);
    });

    it('reads empty maps and arrays, and other types as their raw value', () => {
        expect(fromFields({ m: { mapValue: {} }, a: { arrayValue: {} }, t: { timestampValue: '2026-01-01T00:00:00Z' } }))
            .toEqual({ m: {}, a: [], t: '2026-01-01T00:00:00Z' });
    });
});

describe('createDatabase', () => {
    it('creates a native database, mapping default to (default)', async () => {
        const { client, sent } = fakeGcpClient({ 'POST /databases': { name: 'op' } });

        await createDatabase(client, 'p', 'default', { location: 'us-central1', deletionProtection: true });

        expect(sent()[0]).toMatchObject({
            method: 'POST',
            url: API,
            params: { databaseId: '(default)' },
            data: { type: 'FIRESTORE_NATIVE', locationId: 'us-central1', deleteProtectionState: 'DELETE_PROTECTION_ENABLED' },
        });
    });
});

describe('waitForOperation', () => {
    it('polls the operation and throws its error', async () => {
        const { client, sent } = fakeGcpClient({ 'GET /operations/1': { name: 'projects/p/databases/d/operations/1', done: true, error: { message: 'boom' } } });

        await expect(waitForOperation(client, { name: 'projects/p/databases/d/operations/1' })).rejects.toThrow('boom');
        expect(sent()[0].url).toBe('https://firestore.googleapis.com/v1/projects/p/databases/d/operations/1');
    });
});

describe('deleteDatabase', () => {
    it('turns off deletion protection first with --force', async () => {
        const { client, sent } = fakeGcpClient({ 'PATCH /databases/d': { name: 'op', done: true } });

        await deleteDatabase(client, 'p', 'd', { force: true });

        expect(sent().map((r) => [r.method, r.params, r.data])).toEqual([
            ['PATCH', { updateMask: 'deleteProtectionState' }, { deleteProtectionState: 'DELETE_PROTECTION_DISABLED' }],
            ['DELETE', undefined, undefined],
        ]);
    });
});

describe('documents', () => {
    it('puts a document as typed fields', async () => {
        const { client, sent } = fakeGcpClient();

        await putItem(client, 'p', 'd', 'users', 'a b', { name: 'Ada' });

        expect(sent()[0]).toMatchObject({
            method: 'PATCH', url: `${API}/d/documents/users/a%20b`, data: { fields: { name: { stringValue: 'Ada' } } },
        });
    });

    it('returns undefined / false for missing documents and rethrows other errors', async () => {
        const { client } = fakeGcpClient({ 'GET /documents/users/1': httpError(404), 'GET /documents/users/2': httpError(403), 'DELETE /users': httpError(404) });

        expect(await getItem(client, 'p', 'd', 'users', '1')).toBeUndefined();
        await expect(getItem(client, 'p', 'd', 'users', '2')).rejects.toThrow('HTTP 403');
        expect(await deleteItem(client, 'p', 'd', 'users', '1')).toBe(false);
    });

    it('scans one page of `limit` documents with their ids', async () => {
        const { client, sent } = fakeGcpClient({
            'GET /documents/users': { documents: [{ name: 'projects/p/databases/d/documents/users/1', fields: { n: { integerValue: '1' } } }] },
        });

        expect(await scanItems(client, 'p', 'd', 'users', { limit: 5 })).toEqual([{ id: '1', n: 1 }]);
        expect(sent()[0].params).toEqual({ pageSize: 5 });
    });
});
