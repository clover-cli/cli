import {
    GetRoleCommand,
    IAMClient,
    ListAttachedGroupPoliciesCommand,
    ListAttachedRolePoliciesCommand,
    ListAttachedUserPoliciesCommand,
    ListGroupPoliciesCommand,
    ListGroupsForUserCommand,
    ListRolePoliciesCommand,
    ListUserPoliciesCommand,
    SimulatePrincipalPolicyCommand,
} from '@aws-sdk/client-iam';
import type { AwsClientConfig } from '../aws';

/**
 * IAM, read-only: which policies apply to the current credentials, and which Clover commands
 * they allow. Nothing here changes permissions; that stays in the IAM console (or your IaC).
 */

export function iamClient(config: AwsClientConfig): IAMClient {
    return new IAMClient(config);
}

/** Who the credentials belong to, as IAM sees it. */
export interface Principal {
    kind: 'user' | 'role';
    name: string;
    account: string;
    partition: string;
}

/**
 * Turns the caller ARN from `aws whoami` (STS GetCallerIdentity) into an IAM user or role.
 *   arn:aws:iam::123456789012:user/path/alice            -> user alice
 *   arn:aws:sts::123456789012:assumed-role/Admin/session -> role Admin
 * The root user and federated users have no IAM policies to list, so they throw.
 */
export function principalFromArn(arn: string): Principal {
    const [, partition, service, , account, resource = ''] = arn.split(':');
    const parts = resource.split('/');
    if (service === 'iam' && parts[0] === 'user') {
        return { kind: 'user', name: parts[parts.length - 1], account, partition };
    }
    if (service === 'sts' && parts[0] === 'assumed-role' && parts[1]) {
        return { kind: 'role', name: parts[1], account, partition };
    }
    if (service === 'iam' && resource === 'root') {
        throw new Error('These are the account root user\'s credentials, which can do everything and have no policies. '
            + 'AWS recommends an IAM user with only the permissions it needs instead.');
    }
    throw new Error(`Can't look up policies for ${arn}: only IAM users and roles have them.`);
}

/** IAM list calls return pages marked IsTruncated, continued with Marker. */
async function all<T>(fetch: (marker?: string) => Promise<{ items?: T[]; IsTruncated?: boolean; Marker?: string }>): Promise<T[]> {
    const items: T[] = [];
    let marker: string | undefined;
    do {
        const page = await fetch(marker);
        items.push(...page.items ?? []);
        marker = page.IsTruncated ? page.Marker : undefined;
    } while (marker);
    return items;
}

export interface AttachedPolicy {
    name: string;
    /** 'aws-managed' (e.g. ReadOnlyAccess), 'customer-managed', or 'inline' (lives on the user/group/role). */
    type: 'aws-managed' | 'customer-managed' | 'inline';
    /** Where it's attached: 'user', 'role', or 'group <name>'. */
    via: string;
    arn?: string;
}

function managed(policies: { PolicyName?: string; PolicyArn?: string }[], via: string): AttachedPolicy[] {
    return policies.map((p) => ({
        name: p.PolicyName ?? 'unknown',
        type: p.PolicyArn?.includes(':aws:policy/') ? 'aws-managed' : 'customer-managed',
        via,
        arn: p.PolicyArn,
    }));
}

function inline(names: string[], via: string): AttachedPolicy[] {
    return names.map((name) => ({ name, type: 'inline', via }));
}

/** Every policy that applies to the principal: attached directly, inline, and through its groups. */
export async function listPolicies(client: IAMClient, principal: Principal): Promise<AttachedPolicy[]> {
    if (principal.kind === 'role') {
        const RoleName = principal.name;
        const [attached, inlineNames] = await Promise.all([
            all((Marker) => client.send(new ListAttachedRolePoliciesCommand({ RoleName, Marker }))
                .then((r) => ({ ...r, items: r.AttachedPolicies }))),
            all((Marker) => client.send(new ListRolePoliciesCommand({ RoleName, Marker }))
                .then((r) => ({ ...r, items: r.PolicyNames }))),
        ]);
        return [...managed(attached, 'role'), ...inline(inlineNames, 'role')];
    }

    const UserName = principal.name;
    const [attached, inlineNames, groups] = await Promise.all([
        all((Marker) => client.send(new ListAttachedUserPoliciesCommand({ UserName, Marker }))
            .then((r) => ({ ...r, items: r.AttachedPolicies }))),
        all((Marker) => client.send(new ListUserPoliciesCommand({ UserName, Marker }))
            .then((r) => ({ ...r, items: r.PolicyNames }))),
        all((Marker) => client.send(new ListGroupsForUserCommand({ UserName, Marker }))
            .then((r) => ({ ...r, items: r.Groups }))),
    ]);
    const fromGroups = await Promise.all(groups.map(async ({ GroupName }) => {
        const via = `group ${GroupName}`;
        const [groupAttached, groupInline] = await Promise.all([
            all((Marker) => client.send(new ListAttachedGroupPoliciesCommand({ GroupName, Marker }))
                .then((r) => ({ ...r, items: r.AttachedPolicies }))),
            all((Marker) => client.send(new ListGroupPoliciesCommand({ GroupName, Marker }))
                .then((r) => ({ ...r, items: r.PolicyNames }))),
        ]);
        return [...managed(groupAttached, via), ...inline(groupInline, via)];
    }));
    return [...managed(attached, 'user'), ...inline(inlineNames, 'user'), ...fromGroups.flat()];
}

/**
 * The IAM actions each Clover command can call, by service, including through its common options
 * (--name/--tags, --wait). Keep in sync with the provider modules when a command changes.
 */
export const COMMAND_ACTIONS: Record<string, Record<string, string[]>> = {
    ec2: {
        list: ['ec2:DescribeInstances'],
        get: ['ec2:DescribeInstances'],
        // Image aliases (al2023, ubuntu-24.04, ...) are resolved by EC2 through public SSM parameters.
        create: ['ec2:RunInstances', 'ec2:CreateTags', 'ec2:DescribeInstances', 'ssm:GetParameters'],
        update: ['ec2:ModifyInstanceAttribute', 'ec2:CreateTags', 'ec2:DeleteTags'],
        start: ['ec2:StartInstances'],
        stop: ['ec2:StopInstances'],
        reboot: ['ec2:RebootInstances'],
        delete: ['ec2:TerminateInstances'],
    },
    rds: {
        list: ['rds:DescribeDBInstances'],
        get: ['rds:DescribeDBInstances'],
        create: ['rds:CreateDBInstance', 'rds:AddTagsToResource'],
        // Only without --password: AWS generates the password and keeps it in Secrets Manager.
        'create (generated password)': ['secretsmanager:CreateSecret', 'kms:DescribeKey'],
        // Only when the account has no default network: create restores it, then retries.
        'create (restore default network)': [
            'ec2:DescribeVpcs', 'ec2:CreateDefaultVpc', 'ec2:DescribeAvailabilityZones', 'ec2:DescribeSubnets', 'ec2:CreateDefaultSubnet',
        ],
        update: ['rds:ModifyDBInstance', 'rds:AddTagsToResource'],
        start: ['rds:StartDBInstance'],
        stop: ['rds:StopDBInstance'],
        reboot: ['rds:RebootDBInstance'],
        delete: ['rds:DeleteDBInstance'],
    },
    dynamodb: {
        list: ['dynamodb:ListTables'],
        get: ['dynamodb:DescribeTable', 'dynamodb:DescribeTimeToLive'],
        create: ['dynamodb:CreateTable', 'dynamodb:DescribeTable'],
        update: ['dynamodb:UpdateTable', 'dynamodb:UpdateTimeToLive', 'dynamodb:TagResource'],
        delete: ['dynamodb:DeleteTable'],
        'put-item': ['dynamodb:PutItem', 'dynamodb:BatchWriteItem'],
        'get-item': ['dynamodb:GetItem'],
        'delete-item': ['dynamodb:DeleteItem'],
        scan: ['dynamodb:Scan'],
    },
    s3: {
        list: ['s3:ListAllMyBuckets'],
        get: ['s3:GetBucketLocation', 's3:GetBucketVersioning', 's3:GetBucketTagging'],
        create: ['s3:CreateBucket'],
        update: ['s3:PutBucketVersioning', 's3:PutBucketTagging'],
        delete: ['s3:DeleteBucket'],
        'delete --force': ['s3:ListBucketVersions', 's3:DeleteObject', 's3:DeleteObjectVersion'],
        objects: ['s3:ListBucket'],
        upload: ['s3:PutObject'],
        download: ['s3:GetObject'],
        'delete-object': ['s3:DeleteObject'],
    },
    lambda: {
        list: ['lambda:ListFunctions'],
        get: ['lambda:GetFunction'],
        // --role is passed to Lambda, which needs iam:PassRole on that role.
        create: ['lambda:CreateFunction', 'lambda:GetFunction', 'iam:PassRole'],
        update: ['lambda:UpdateFunctionConfiguration', 'lambda:UpdateFunctionCode', 'lambda:GetFunction'],
        delete: ['lambda:DeleteFunction'],
        invoke: ['lambda:InvokeFunction'],
    },
    project: {
        get: ['tag:GetResources'],
        // Plus the tagging permission of each resource's service, e.g. ec2:CreateTags.
        add: ['tag:TagResources'],
    },
};

export const SERVICES = Object.keys(COMMAND_ACTIONS);

export interface CommandCheck {
    service: string;
    command: string;
    allowed: boolean;
    actions: string[];
    /** Actions that are not allowed. */
    missing: string[];
}

/** The IAM ARN to simulate. A role's path isn't in its session ARN, so it's looked up. */
async function principalArn(client: IAMClient, principal: Principal): Promise<string> {
    if (principal.kind === 'role') {
        const role = await client.send(new GetRoleCommand({ RoleName: principal.name }));
        if (role.Role?.Arn) return role.Role.Arn;
    }
    return `arn:${principal.partition}:iam::${principal.account}:${principal.kind}/${principal.name}`;
}

/**
 * Asks IAM's policy simulator whether the principal may call each action the Clover commands use.
 * The simulator applies identity policies, permissions boundaries and Organizations SCPs, against
 * all resources ("*"): a policy that only allows specific buckets or tables shows as not allowed.
 */
export async function checkCommands(client: IAMClient, principal: Principal, services: string[] = SERVICES): Promise<CommandCheck[]> {
    const commands = services.flatMap((service) =>
        Object.entries(COMMAND_ACTIONS[service] ?? {}).map(([command, actions]) => ({ service, command, actions })));
    const actionNames = [...new Set(commands.flatMap((c) => c.actions))];
    const PolicySourceArn = await principalArn(client, principal);

    const decisions = new Map<string, string | undefined>();
    let Marker: string | undefined;
    do {
        const page = await client.send(new SimulatePrincipalPolicyCommand({ PolicySourceArn, ActionNames: actionNames, Marker }));
        for (const result of page.EvaluationResults ?? []) {
            if (result.EvalActionName) decisions.set(result.EvalActionName, result.EvalDecision);
        }
        Marker = page.IsTruncated ? page.Marker : undefined;
    } while (Marker);

    return commands.map(({ service, command, actions }) => {
        const missing = actions.filter((a) => decisions.get(a) !== 'allowed');
        return { service, command, allowed: missing.length === 0, actions, missing };
    });
}
