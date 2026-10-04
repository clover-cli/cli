import { describe, expect, it } from 'vitest';
import {
    createDatabase, deleteDatabase, getDatabase, updateDatabase, waitForOperation,
} from '../../../src/provider/gcp-services/sql';
import { fakeGcpClient } from '../../helpers';

const url = 'https://sqladmin.googleapis.com/v1/projects/p/instances';
const op = { name: 'op-1', status: 'PENDING' };

describe('createDatabase', () => {
    it('posts the instance with labels and public IP', async () => {
        const { client, sent } = fakeGcpClient({ 'POST /instances': op });

        expect(await createDatabase(client, 'p', 'app-db', {
            databaseVersion: 'POSTGRES_16', tier: 'db-f1-micro', region: 'us-central1', storage: 20,
            password: 'hunter22', public: false, labels: { env: 'prod' },
        })).toEqual(op);

        expect(sent()[0]).toMatchObject({
            method: 'POST', url,
            data: {
                name: 'app-db', databaseVersion: 'POSTGRES_16', region: 'us-central1', rootPassword: 'hunter22',
                settings: { tier: 'db-f1-micro', dataDiskSizeGb: '20', userLabels: { env: 'prod' }, ipConfiguration: { ipv4Enabled: false } },
            },
        });
    });
});

describe('getDatabase', () => {
    it('summarizes the instance', async () => {
        const { client } = fakeGcpClient({
            'GET /instances/app-db': {
                name: 'app-db', state: 'RUNNABLE', databaseVersion: 'POSTGRES_16',
                ipAddresses: [{ type: 'OUTGOING', ipAddress: '1.1.1.1' }, { type: 'PRIMARY', ipAddress: '2.2.2.2' }],
                settings: { tier: 'db-f1-micro', dataDiskSizeGb: '10', activationPolicy: 'ALWAYS' },
            },
        });

        expect(await getDatabase(client, 'p', 'app-db')).toMatchObject({
            id: 'app-db', status: 'RUNNABLE', tier: 'db-f1-micro', storageGb: 10, ip: '2.2.2.2', activation: 'ALWAYS',
        });
    });
});

describe('updateDatabase', () => {
    it('merges new labels into the existing ones', async () => {
        const { client, sent } = fakeGcpClient({
            'GET /instances/app-db': { name: 'app-db', settings: { userLabels: { team: 'core' } } },
            'PATCH /instances/app-db': op,
        });

        await updateDatabase(client, 'p', 'app-db', { tier: 'db-g1-small', labels: { env: 'prod' } });

        expect(sent()[1]).toMatchObject({
            method: 'PATCH', url: `${url}/app-db`,
            data: { settings: { tier: 'db-g1-small', userLabels: { team: 'core', env: 'prod' } } },
        });
    });

    it('sends nothing when nothing changes', async () => {
        const { client, sent } = fakeGcpClient();

        expect(await updateDatabase(client, 'p', 'app-db', { labels: {} })).toBeNull();
        expect(sent()).toEqual([]);
    });
});

describe('deleteDatabase', () => {
    it('turns off deletion protection first with force', async () => {
        const { client, sent } = fakeGcpClient({
            'PATCH /instances/app-db': op,
            'GET /operations/op-1': { name: 'op-1', status: 'DONE' },
            'DELETE /instances/app-db': op,
        });

        await deleteDatabase(client, 'p', 'app-db', { force: true });

        expect(sent().map((r) => r.method)).toEqual(['PATCH', 'GET', 'DELETE']);
        expect(sent()[0].data).toEqual({ settings: { deletionProtectionEnabled: false } });
    });
});

describe('waitForOperation', () => {
    it('throws the operation error', async () => {
        const { client } = fakeGcpClient({
            'GET /operations/op-1': { name: 'op-1', status: 'DONE', error: { errors: [{ code: 'X', message: 'quota exceeded' }] } },
        });

        await expect(waitForOperation(client, 'p', op)).rejects.toThrow('quota exceeded');
    });
});
