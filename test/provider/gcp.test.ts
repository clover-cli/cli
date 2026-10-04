import { describe, expect, it, vi } from 'vitest';
import { GoogleAuth } from 'google-auth-library';
import { gcpList, gcpRequest, getGcpConfig, listGcpResources, verifyGcpCredentials } from '../../src/provider/gcp';
import { fakeGcpClient } from '../helpers';

// test/setup.ts mocks this module for the command tests; here the real one is under test.
vi.unmock('../../src/provider/gcp');

const { auth } = vi.hoisted(() => ({
    auth: { getAccessToken: vi.fn(), getCredentials: vi.fn() },
}));

vi.mock('google-auth-library', () => ({
    GoogleAuth: vi.fn(function () {
        return auth;
    }),
}));

describe('verifyGcpCredentials', () => {
    it('gets a token and returns the service account email', async () => {
        auth.getAccessToken.mockResolvedValue('token');
        auth.getCredentials.mockResolvedValue({ client_email: 'sa@p.iam.gserviceaccount.com' });

        await expect(verifyGcpCredentials({ project: 'p', keyFile: '/key.json' }))
            .resolves.toEqual({ email: 'sa@p.iam.gserviceaccount.com', project: 'p' });
        expect(GoogleAuth).toHaveBeenCalledWith(expect.objectContaining({ keyFile: '/key.json', projectId: 'p' }));
    });

    it('returns a null email for user credentials', async () => {
        auth.getAccessToken.mockResolvedValue('token');
        auth.getCredentials.mockResolvedValue({});

        await expect(verifyGcpCredentials({ project: 'p' })).resolves.toEqual({ email: null, project: 'p' });
    });

    it('throws when no token can be obtained', async () => {
        auth.getAccessToken.mockRejectedValue(new Error('invalid_grant'));

        await expect(verifyGcpCredentials({ project: 'p' })).rejects.toThrow('invalid_grant');
    });
});

describe('getGcpConfig', () => {
    it('reads the environment', () => {
        expect(getGcpConfig({ GOOGLE_CLOUD_PROJECT: 'p' })).toEqual({ project: 'p', keyFile: undefined });
    });

    it('explains how to log in when no project is set', () => {
        expect(() => getGcpConfig({})).toThrow('No GCP project found');
    });
});

describe('gcpRequest and gcpList', () => {
    it('returns the response body', async () => {
        const { client, sent } = fakeGcpClient({ 'POST /things': { name: 'op-1' } });

        await expect(gcpRequest(client, 'https://x/things', { method: 'POST', data: { a: 1 } })).resolves.toEqual({ name: 'op-1' });
        expect(sent()[0]).toMatchObject({ method: 'POST', url: 'https://x/things', data: { a: 1 } });
    });

    it('follows nextPageToken', async () => {
        const { client, sent } = fakeGcpClient({ 'GET /things': [{ items: [1, 2], nextPageToken: 't' }, { items: [3] }] });

        await expect(gcpList(client, 'https://x/things', 'items', { filter: 'f' })).resolves.toEqual([1, 2, 3]);
        expect(sent()[1].params).toEqual({ filter: 'f', pageToken: 't' });
    });
});

describe('listGcpResources', () => {
    it('groups Cloud Asset results by service', async () => {
        const { client } = fakeGcpClient({
            'GET :searchAllResources': { results: [
                { name: '//compute.googleapis.com/vm1', displayName: 'vm1', assetType: 'compute.googleapis.com/Instance', state: 'RUNNING' },
                { name: '//compute.googleapis.com/d1', displayName: 'd1', assetType: 'compute.googleapis.com/Disk' },
                { name: '//storage.googleapis.com/b', displayName: 'b', assetType: 'storage.googleapis.com/Bucket' },
            ] },
        });

        await expect(listGcpResources(client, 'p')).resolves.toEqual({
            project: 'p',
            total: 3,
            services: [
                { service: 'compute', count: 2, resources: [
                    { id: '//compute.googleapis.com/vm1', name: 'vm1', type: 'Instance', state: 'RUNNING' },
                    { id: '//compute.googleapis.com/d1', name: 'd1', type: 'Disk', state: undefined },
                ] },
                { service: 'storage', count: 1, resources: [{ id: '//storage.googleapis.com/b', name: 'b', type: 'Bucket', state: undefined }] },
            ],
        });
    });
});
