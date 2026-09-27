import type { RDSClient } from '@aws-sdk/client-rds';
import { describe, expect, it } from 'vitest';
import { createDatabase, deleteDatabase, updateDatabase } from '../../../src/provider/aws-services/rds';
import { fakeClient } from '../../helpers';

const db = { DBInstance: { DBInstanceIdentifier: 'app-db', DBInstanceArn: 'arn:db' } };
const base = { engine: 'postgres', instanceClass: 'db.t3.micro', storage: 20, username: 'dbadmin' };

describe('createDatabase', () => {
    it('lets AWS manage the password when none is given', async () => {
        const { client, sent } = fakeClient<RDSClient>({ CreateDBInstanceCommand: db });

        await createDatabase(client, 'app-db', base);

        expect(sent()[0].input).toMatchObject({ ManageMasterUserPassword: true, MasterUserPassword: undefined });
    });

    it('uses the given password', async () => {
        const { client, sent } = fakeClient<RDSClient>({ CreateDBInstanceCommand: db });

        await createDatabase(client, 'app-db', { ...base, password: 'hunter22', tags: { env: 'prod' } });

        expect(sent()[0].input).toMatchObject({
            ManageMasterUserPassword: undefined, MasterUserPassword: 'hunter22', Tags: [{ Key: 'env', Value: 'prod' }],
        });
    });
});

describe('updateDatabase', () => {
    it('only tags when nothing else changes', async () => {
        const { client, sent } = fakeClient<RDSClient>({ DescribeDBInstancesCommand: { DBInstances: [db.DBInstance] } });

        await updateDatabase(client, 'app-db', { tags: { team: 'core' } });

        expect(sent().map((c) => c.name)).toEqual(['DescribeDBInstancesCommand', 'AddTagsToResourceCommand']);
        expect(sent()[1].input).toEqual({ ResourceName: 'arn:db', Tags: [{ Key: 'team', Value: 'core' }] });
    });

    it('allows a major version upgrade when changing the engine version', async () => {
        const { client, sent } = fakeClient<RDSClient>({ ModifyDBInstanceCommand: db });

        await updateDatabase(client, 'app-db', { engineVersion: '17.2', applyImmediately: true });

        expect(sent()[0].input).toMatchObject({ EngineVersion: '17.2', AllowMajorVersionUpgrade: true, ApplyImmediately: true });
    });
});

describe('deleteDatabase', () => {
    it('skips the final snapshot unless one is named', async () => {
        const { client, sent } = fakeClient<RDSClient>({ DeleteDBInstanceCommand: db });

        await deleteDatabase(client, 'app-db');
        await deleteDatabase(client, 'app-db', { finalSnapshot: 'last' });

        expect(sent()[0].input).toMatchObject({ SkipFinalSnapshot: true, FinalDBSnapshotIdentifier: undefined });
        expect(sent()[1].input).toMatchObject({ SkipFinalSnapshot: false, FinalDBSnapshotIdentifier: 'last' });
    });

    it('turns off deletion protection first with force', async () => {
        const { client, sent } = fakeClient<RDSClient>({ DeleteDBInstanceCommand: db });

        await deleteDatabase(client, 'app-db', { force: true });

        expect(sent()[0]).toEqual({
            name: 'ModifyDBInstanceCommand',
            input: { DBInstanceIdentifier: 'app-db', DeletionProtection: false, ApplyImmediately: true },
        });
    });
});
