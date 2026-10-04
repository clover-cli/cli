import { describe, expect, it } from 'vitest';
import { COMMAND_PERMISSIONS, checkCommands, listRoles, memberFor } from '../../../src/provider/gcp-services/iam';
import { fakeGcpClient } from '../../helpers';

describe('memberFor', () => {
    it('tells service accounts from users', () => {
        expect(memberFor('sa@p.iam.gserviceaccount.com')).toBe('serviceAccount:sa@p.iam.gserviceaccount.com');
        expect(memberFor('me@example.com')).toBe('user:me@example.com');
    });
});

describe('listRoles', () => {
    it('returns only the bindings that include the member', async () => {
        const { client } = fakeGcpClient({
            'POST :getIamPolicy': { bindings: [
                { role: 'roles/viewer', members: ['user:me@example.com'] },
                { role: 'roles/owner', members: ['user:other@example.com'] },
            ] },
        });

        await expect(listRoles(client, 'p', 'user:me@example.com')).resolves.toEqual([{ role: 'roles/viewer' }]);
    });
});

describe('checkCommands', () => {
    it('marks commands allowed only when every permission is granted', async () => {
        const { client, sent } = fakeGcpClient({
            'POST :testIamPermissions': { permissions: ['storage.buckets.list', 'storage.objects.list'] },
        });

        const results = await checkCommands(client, 'p', ['storage']);

        expect(sent()[0].url).toBe('https://cloudresourcemanager.googleapis.com/v3/projects/p:testIamPermissions');
        expect(results.find((r) => r.command === 'list')).toMatchObject({ allowed: true, missing: [] });
        expect(results.find((r) => r.command === 'delete --force')).toMatchObject({ allowed: false, missing: ['storage.objects.delete'] });
    });

    it('asks for each permission once', async () => {
        const { client, sent } = fakeGcpClient({ 'POST :testIamPermissions': {} });

        await checkCommands(client, 'p');

        const unique = [...new Set(Object.values(COMMAND_PERMISSIONS).flatMap((s) => Object.values(s).flat()))];
        expect(sent()).toEqual([expect.objectContaining({ data: { permissions: unique } })]);
    });
});
