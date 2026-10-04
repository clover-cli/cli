import { describe, expect, it, vi } from 'vitest';
import { GoogleAuth } from 'google-auth-library';
import { getGcpConfig, verifyGcpCredentials } from '../../src/provider/gcp';

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
