import {
    AddTagsToResourceCommand,
    CreateDBInstanceCommand,
    DeleteDBInstanceCommand,
    DescribeDBInstancesCommand,
    ModifyDBInstanceCommand,
    RDSClient,
    RebootDBInstanceCommand,
    StartDBInstanceCommand,
    StopDBInstanceCommand,
    waitUntilDBInstanceAvailable,
    waitUntilDBInstanceDeleted,
    type DBInstance,
} from '@aws-sdk/client-rds';
import type { AwsClientConfig } from '../aws';
import { MAX_WAIT_SECONDS, toTagList } from './common';

/**
 * RDS database instances: create, read, update, delete, plus start/stop/reboot.
 */

export function rdsClient(config: AwsClientConfig): RDSClient {
    return new RDSClient(config);
}

export interface RdsSummary {
    id: string;
    engine?: string;
    version?: string;
    class?: string;
    status?: string;
    storageGb?: number;
    endpoint?: string;
    port?: number;
    username?: string;
    database?: string;
    multiAz?: boolean;
    public?: boolean;
    deletionProtection?: boolean;
    /** Secrets Manager secret that holds the password, when AWS manages it. */
    passwordSecret?: string;
    arn?: string;
}

function summarize(db: DBInstance): RdsSummary {
    return {
        id: db.DBInstanceIdentifier ?? 'unknown',
        engine: db.Engine,
        version: db.EngineVersion,
        class: db.DBInstanceClass,
        status: db.DBInstanceStatus,
        storageGb: db.AllocatedStorage,
        endpoint: db.Endpoint?.Address,
        port: db.Endpoint?.Port,
        username: db.MasterUsername,
        database: db.DBName,
        multiAz: db.MultiAZ,
        public: db.PubliclyAccessible,
        deletionProtection: db.DeletionProtection,
        passwordSecret: db.MasterUserSecret?.SecretArn,
        arn: db.DBInstanceArn,
    };
}

export interface RdsCreateOptions {
    engine: string;
    engineVersion?: string;
    instanceClass: string;
    storage: number;
    storageType?: string;
    username: string;
    /** Without a password, AWS generates one and keeps it in Secrets Manager. */
    password?: string;
    database?: string;
    port?: number;
    multiAz?: boolean;
    public?: boolean;
    securityGroupIds?: string[];
    subnetGroup?: string;
    backupRetention?: number;
    deletionProtection?: boolean;
    tags?: Record<string, string>;
}

export async function createDatabase(client: RDSClient, id: string, opts: RdsCreateOptions): Promise<RdsSummary> {
    const result = await client.send(new CreateDBInstanceCommand({
        DBInstanceIdentifier: id,
        Engine: opts.engine,
        EngineVersion: opts.engineVersion,
        DBInstanceClass: opts.instanceClass,
        AllocatedStorage: opts.storage,
        StorageType: opts.storageType,
        MasterUsername: opts.username,
        MasterUserPassword: opts.password,
        ManageMasterUserPassword: opts.password ? undefined : true,
        DBName: opts.database,
        Port: opts.port,
        MultiAZ: opts.multiAz,
        PubliclyAccessible: opts.public,
        VpcSecurityGroupIds: opts.securityGroupIds,
        DBSubnetGroupName: opts.subnetGroup,
        BackupRetentionPeriod: opts.backupRetention,
        DeletionProtection: opts.deletionProtection,
        Tags: opts.tags ? toTagList(opts.tags) : undefined,
    }));
    if (!result.DBInstance) throw new Error(`AWS did not return database ${id}.`);
    return summarize(result.DBInstance);
}

export async function listDatabases(client: RDSClient): Promise<RdsSummary[]> {
    const databases: RdsSummary[] = [];
    let marker: string | undefined;
    do {
        const page = await client.send(new DescribeDBInstancesCommand({ Marker: marker }));
        databases.push(...(page.DBInstances ?? []).map(summarize));
        marker = page.Marker;
    } while (marker);
    return databases;
}

export async function getDatabase(client: RDSClient, id: string): Promise<RdsSummary> {
    const result = await client.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: id }));
    const db = result.DBInstances?.[0];
    if (!db) throw new Error(`Database ${id} not found.`);
    return summarize(db);
}

export interface RdsUpdateOptions {
    instanceClass?: string;
    storage?: number;
    engineVersion?: string;
    password?: string;
    backupRetention?: number;
    multiAz?: boolean;
    public?: boolean;
    deletionProtection?: boolean;
    securityGroupIds?: string[];
    /** Apply now instead of in the next maintenance window. */
    applyImmediately?: boolean;
    tags?: Record<string, string>;
}

export async function updateDatabase(client: RDSClient, id: string, opts: RdsUpdateOptions): Promise<RdsSummary> {
    const { tags, applyImmediately, ...changes } = opts;
    let db: RdsSummary | undefined;

    if (Object.values(changes).some((v) => v !== undefined)) {
        const result = await client.send(new ModifyDBInstanceCommand({
            DBInstanceIdentifier: id,
            DBInstanceClass: changes.instanceClass,
            AllocatedStorage: changes.storage,
            EngineVersion: changes.engineVersion,
            AllowMajorVersionUpgrade: changes.engineVersion ? true : undefined,
            MasterUserPassword: changes.password,
            BackupRetentionPeriod: changes.backupRetention,
            MultiAZ: changes.multiAz,
            PubliclyAccessible: changes.public,
            DeletionProtection: changes.deletionProtection,
            VpcSecurityGroupIds: changes.securityGroupIds,
            ApplyImmediately: applyImmediately,
        }));
        if (result.DBInstance) db = summarize(result.DBInstance);
    }

    if (tags && Object.keys(tags).length > 0) {
        db ??= await getDatabase(client, id);
        await client.send(new AddTagsToResourceCommand({ ResourceName: db.arn, Tags: toTagList(tags) }));
    }

    return db ?? getDatabase(client, id);
}

export interface RdsDeleteOptions {
    /** Take a final snapshot with this name. Without it, no snapshot is taken. */
    finalSnapshot?: string;
    /** Turn off deletion protection first. */
    force?: boolean;
    /** Keep automated backups after the instance is gone. */
    keepBackups?: boolean;
}

export async function deleteDatabase(client: RDSClient, id: string, opts: RdsDeleteOptions = {}): Promise<RdsSummary> {
    if (opts.force) {
        await client.send(new ModifyDBInstanceCommand({ DBInstanceIdentifier: id, DeletionProtection: false, ApplyImmediately: true }));
    }
    const result = await client.send(new DeleteDBInstanceCommand({
        DBInstanceIdentifier: id,
        SkipFinalSnapshot: !opts.finalSnapshot,
        FinalDBSnapshotIdentifier: opts.finalSnapshot,
        DeleteAutomatedBackups: !opts.keepBackups,
    }));
    if (!result.DBInstance) throw new Error(`AWS did not return database ${id}.`);
    return summarize(result.DBInstance);
}

export async function startDatabase(client: RDSClient, id: string): Promise<RdsSummary> {
    const result = await client.send(new StartDBInstanceCommand({ DBInstanceIdentifier: id }));
    return result.DBInstance ? summarize(result.DBInstance) : { id };
}

export async function stopDatabase(client: RDSClient, id: string, { snapshot }: { snapshot?: string } = {}): Promise<RdsSummary> {
    const result = await client.send(new StopDBInstanceCommand({ DBInstanceIdentifier: id, DBSnapshotIdentifier: snapshot }));
    return result.DBInstance ? summarize(result.DBInstance) : { id };
}

export async function rebootDatabase(client: RDSClient, id: string, { failover }: { failover?: boolean } = {}): Promise<RdsSummary> {
    const result = await client.send(new RebootDBInstanceCommand({ DBInstanceIdentifier: id, ForceFailover: failover }));
    return result.DBInstance ? summarize(result.DBInstance) : { id };
}

/**
 * Waits for the database to reach a state. 'modified' first waits (up to a minute) for RDS
 * to start applying a change, since right after ModifyDBInstance it can still say "available".
 */
export async function waitForDatabase(client: RDSClient, id: string, state: 'available' | 'modified' | 'deleted'): Promise<void> {
    if (state === 'modified') {
        for (let i = 0; i < 12 && (await getDatabase(client, id)).status === 'available'; i++) {
            await new Promise((r) => setTimeout(r, 5_000));
        }
        state = 'available';
    }
    const waiter = state === 'available' ? waitUntilDBInstanceAvailable : waitUntilDBInstanceDeleted;
    await waiter({ client, maxWaitTime: MAX_WAIT_SECONDS }, { DBInstanceIdentifier: id });
}
