import { describe, expect, it, vi } from 'vitest';
import { gcpClient, getGcpConfig } from '../../../src/provider/gcp';
import { errored, fakeGcpClient, logged, runCli } from '../../helpers';

const API = 'https://firestore.googleapis.com/v1/projects/p/databases';

function setup(responses: Record<string, unknown> = {}) {
    vi.mocked(getGcpConfig).mockReturnValue({ project: 'p' });
    const fake = fakeGcpClient(responses);
    vi.mocked(gcpClient).mockReturnValue(fake.client);
    return fake;
}

describe('clover gcp firestore', () => {
    it('creates a database in --region and waits for the operation', async () => {
        const { sent } = setup({
            'POST /databases': { name: 'projects/p/databases/users/operations/1' },
            'GET /operations/1': { done: true },
            'GET /databases/users': { name: 'projects/p/databases/users', locationId: 'nam5', deleteProtectionState: 'DELETE_PROTECTION_ENABLED' },
        });

        await runCli('gcp firestore create users --region nam5 --deletion-protection --wait --output json');

        expect(sent()[0]).toMatchObject({ params: { databaseId: 'users' }, data: { locationId: 'nam5' } });
        expect(JSON.parse(logged())).toMatchObject({ name: 'users', location: 'nam5', deletionProtection: true });
    });

    it('turns deletion protection off with --no-deletion-protection', async () => {
        const { sent } = setup({ 'GET /databases': { name: 'projects/p/databases/(default)' } });

        await runCli('gcp firestore update default --no-deletion-protection');

        expect(sent()[0]).toMatchObject({
            method: 'PATCH', url: `${API}/(default)`, data: { deleteProtectionState: 'DELETE_PROTECTION_DISABLED' },
        });
    });

    it('refuses to delete a database without --yes outside a terminal', async () => {
        const { sent } = setup();
        process.stdin.isTTY = false;

        await runCli('gcp firestore delete users');

        expect(sent()).toHaveLength(0);
        expect(errored()).toContain('Pass --yes');
    });

    it('puts a document and rejects non-objects', async () => {
        const { sent } = setup();

        await runCli(['gcp', 'firestore', 'put-item', 'default', '--collection', 'users', '--id', '1', '--item', '{"name":"Ada"}']);
        await runCli(['gcp', 'firestore', 'put-item', 'default', '--collection', 'users', '--id', '1', '--item', '[1]']);

        expect(sent()).toHaveLength(1);
        expect(sent()[0].url).toBe(`${API}/(default)/documents/users/1`);
        expect(errored()).toContain('Wrote users/1.');
        expect(errored()).toContain('--item must be a JSON object.');
    });

    it('prints a document as JSON, and fails when it is missing', async () => {
        setup({ 'GET /documents/users/1': [
            { name: 'x', fields: { name: { stringValue: 'Ada' } } },
            Object.assign(new Error('not found'), { response: { status: 404 } }),
        ] });

        await runCli('gcp firestore get-item default --collection users --id 1');
        expect(JSON.parse(logged())).toEqual({ name: 'Ada' });

        await runCli('gcp firestore get-item default --collection users --id 1');
        expect(errored()).toContain('Item not found.');
        expect(process.exitCode).toBe(1);
    });

    it('scans a collection, 25 documents by default', async () => {
        const { sent } = setup({ 'GET /documents/users': { documents: [] } });

        await runCli('gcp firestore scan default --collection users');

        expect(sent()[0].params).toEqual({ pageSize: 25 });
        expect(logged()).toBe('No items found.');
    });
});
