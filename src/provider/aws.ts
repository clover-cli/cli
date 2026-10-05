// Connection from the user to AWS
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { DynamoDBClient, paginateListTables } from '@aws-sdk/client-dynamodb';
import { EC2Client, paginateDescribeInstances } from '@aws-sdk/client-ec2';
import { LambdaClient, paginateListFunctions } from '@aws-sdk/client-lambda';
import { RDSClient, paginateDescribeDBInstances } from '@aws-sdk/client-rds';
import { ResourceGroupsTaggingAPIClient, paginateGetResources } from '@aws-sdk/client-resource-groups-tagging-api';
import { S3Client, paginateListBuckets } from '@aws-sdk/client-s3';
import { readAwsEnv } from '../credentials';
import { errorMessage } from '../utils';

export interface AwsLogin {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
    region: string;
}

/**
 * Checks the credentials against AWS (STS GetCallerIdentity).
 * This call needs no special IAM permissions, so it works for any valid key.
 * Throws if the credentials are invalid.
 */
export async function verifyAwsCredentials(login: AwsLogin) {
    const sts = new STSClient({
        region: login.region,
        credentials: {
            accessKeyId: login.accessKeyId,
            secretAccessKey: login.secretAccessKey,
            sessionToken: login.sessionToken,
        },
    });

    const identity = await sts.send(new GetCallerIdentityCommand({}));
    return { accountId: identity.Account ?? null, arn: identity.Arn ?? null };
}

export interface AwsClientConfig {
    region: string;
    credentials: {
        accessKeyId: string;
        secretAccessKey: string;
        sessionToken?: string;
    };
}

/**
 * Returns a config object ready to pass to any AWS SDK client, built from the
 * AWS_* environment variables (see src/credentials.ts).
 *
 * Example:
 *   const s3 = new S3Client(getAwsClientConfig());
 */
export function getAwsClientConfig(env: NodeJS.ProcessEnv = process.env): AwsClientConfig {
    const login = readAwsEnv(env);
    if (!login) {
        throw new Error(
            'No AWS credentials found. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or run: eval "$(clover aws login)"',
        );
    }
    return {
        region: login.region,
        credentials: {
            accessKeyId: login.accessKeyId,
            secretAccessKey: login.secretAccessKey,
            sessionToken: login.sessionToken,
        },
    };
}

export interface AwsResource {
    id: string;
    name?: string;
    type: string;
    state?: string;
}

export interface AwsServiceResources {
    service: string;
    count: number;
    resources: AwsResource[];
    /** Set when the service could not be listed (e.g. missing IAM permission); the rest still run. */
    error?: string;
}

export interface AwsResourceInventory {
    region: string;
    services: AwsServiceResources[];
    /** Resources across every service that listed successfully. */
    total: number;
}

/** Services with a dedicated lister; the tagging API only fills in services not in this list. */
const DEDICATED_SERVICES = ['ec2', 'rds', 'dynamodb', 's3', 'lambda'];

async function listEc2Instances(config: AwsClientConfig): Promise<AwsResource[]> {
    const client = new EC2Client(config);
    const resources: AwsResource[] = [];
    for await (const page of paginateDescribeInstances({ client }, {})) {
        for (const reservation of page.Reservations ?? []) {
            for (const instance of reservation.Instances ?? []) {
                resources.push({
                    id: instance.InstanceId ?? 'unknown',
                    name: instance.Tags?.find((t) => t.Key === 'Name')?.Value,
                    type: instance.InstanceType ?? 'instance',
                    state: instance.State?.Name,
                });
            }
        }
    }
    return resources;
}

async function listRdsInstances(config: AwsClientConfig): Promise<AwsResource[]> {
    const client = new RDSClient(config);
    const resources: AwsResource[] = [];
    for await (const page of paginateDescribeDBInstances({ client }, {})) {
        for (const db of page.DBInstances ?? []) {
            resources.push({
                id: db.DBInstanceIdentifier ?? 'unknown',
                type: `${db.Engine ?? 'db'} ${db.DBInstanceClass ?? ''}`.trim(),
                state: db.DBInstanceStatus,
            });
        }
    }
    return resources;
}

async function listDynamoDbTables(config: AwsClientConfig): Promise<AwsResource[]> {
    const client = new DynamoDBClient(config);
    const resources: AwsResource[] = [];
    for await (const page of paginateListTables({ client }, {})) {
        for (const table of page.TableNames ?? []) {
            resources.push({ id: table, type: 'table' });
        }
    }
    return resources;
}

/** S3 buckets are global, so this lists every bucket in the account regardless of region. */
async function listS3Buckets(config: AwsClientConfig): Promise<AwsResource[]> {
    const client = new S3Client(config);
    const resources: AwsResource[] = [];
    for await (const page of paginateListBuckets({ client }, {})) {
        for (const bucket of page.Buckets ?? []) {
            resources.push({ id: bucket.Name ?? 'unknown', type: 'bucket' });
        }
    }
    return resources;
}

async function listLambdaFunctions(config: AwsClientConfig): Promise<AwsResource[]> {
    const client = new LambdaClient(config);
    const resources: AwsResource[] = [];
    for await (const page of paginateListFunctions({ client }, {})) {
        for (const fn of page.Functions ?? []) {
            resources.push({
                id: fn.FunctionName ?? 'unknown',
                type: fn.Runtime ?? 'function',
                state: fn.State,
            });
        }
    }
    return resources;
}

/**
 * Catch-all for every other service, via the Resource Groups Tagging API.
 * Note: this API only returns resources that have (or once had) tags.
 */
async function listOtherTaggedResources(config: AwsClientConfig): Promise<Map<string, AwsResource[]>> {
    const client = new ResourceGroupsTaggingAPIClient(config);
    const byService = new Map<string, AwsResource[]>();
    for await (const page of paginateGetResources({ client }, {})) {
        for (const mapping of page.ResourceTagMappingList ?? []) {
            const arn = mapping.ResourceARN;
            if (!arn) continue;
            // arn:partition:service:region:account:resource
            const [, , service, , , ...rest] = arn.split(':');
            if (!service || DEDICATED_SERVICES.includes(service)) continue;
            const resource = rest.join(':');
            const list = byService.get(service) ?? [];
            list.push({
                id: arn,
                name: mapping.Tags?.find((t) => t.Key === 'Name')?.Value,
                type: resource.split(/[/:]/)[0] || service,
            });
            byService.set(service, list);
        }
    }
    return byService;
}

/**
 * Lists the resources in the account, grouped by service with a count each.
 * EC2, RDS, DynamoDB, S3 and Lambda are listed directly; any other service is discovered through
 * the Resource Groups Tagging API. Everything except S3 is scoped to the configured region.
 *
 * Each service is listed independently: if one fails (e.g. missing IAM permission) its entry
 * carries an `error` and the others are still returned.
 */
export async function listAwsResources(region?: string): Promise<AwsResourceInventory> {
    const base = getAwsClientConfig();
    const config = region ? { ...base, region } : base;

    const dedicated: [string, (c: AwsClientConfig) => Promise<AwsResource[]>][] = [
        ['EC2', listEc2Instances],
        ['RDS', listRdsInstances],
        ['DynamoDB', listDynamoDbTables],
        ['S3', listS3Buckets],
        ['Lambda', listLambdaFunctions],
    ];

    const [dedicatedResults, otherResult] = await Promise.all([
        Promise.allSettled(dedicated.map(([, list]) => list(config))),
        listOtherTaggedResources(config).then(
            (value) => ({ value, error: undefined }),
            (err: Error) => ({ value: undefined, error: err.message }),
        ),
    ]);

    const services: AwsServiceResources[] = dedicatedResults.map((result, i) => {
        const service = dedicated[i][0];
        return result.status === 'fulfilled'
            ? { service, count: result.value.length, resources: result.value }
            : { service, count: 0, resources: [], error: errorMessage(result.reason) };
    });

    if (otherResult.value) {
        for (const [service, resources] of otherResult.value) {
            services.push({ service, count: resources.length, resources });
        }
    } else {
        services.push({ service: 'Other (tagged)', count: 0, resources: [], error: otherResult.error });
    }

    return {
        region: config.region,
        services,
        total: services.reduce((sum, s) => sum + s.count, 0),
    };
}
