import {
    CreateTagsCommand,
    DeleteTagsCommand,
    DescribeImagesCommand,
    DescribeInstancesCommand,
    EC2Client,
    ModifyInstanceAttributeCommand,
    RebootInstancesCommand,
    RunInstancesCommand,
    StartInstancesCommand,
    StopInstancesCommand,
    TerminateInstancesCommand,
    waitUntilInstanceRunning,
    waitUntilInstanceStopped,
    waitUntilInstanceTerminated,
    type _InstanceType,
    type Filter,
    type Instance,
    type RunInstancesCommandInput,
} from '@aws-sdk/client-ec2';
import type { AwsClientConfig } from '../aws';
import { MAX_WAIT_SECONDS, toTagList } from './common';

/**
 * EC2 instances: create, read, update, delete, plus start/stop/reboot.
 * Every function takes the client, so tests can pass a fake one.
 */

export function ec2Client(config: AwsClientConfig): EC2Client {
    return new EC2Client(config);
}

/**
 * Shorthands for --image. EC2 resolves `resolve:ssm:` image IDs itself, so these always
 * point at the latest AMI in whatever region the command runs in.
 * Taken directly from:
 * https://documentation.ubuntu.com/aws/en/latest/aws-how-to/instances/find-ubuntu-images/
 * https://docs.aws.amazon.com/linux/al2023/ug/ec2.html
 */
export const IMAGE_ALIASES: Record<string, string> = {
    'al2023': 'resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64',
    'al2023-arm64': 'resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64',
    'ubuntu-24.04': 'resolve:ssm:/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id',
    'ubuntu-24.04-arm64': 'resolve:ssm:/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id',
};

export function resolveImage(image: string): string {
    return IMAGE_ALIASES[image] ?? image;
}

export interface Ec2Summary {
    id: string;
    name?: string;
    type?: string;
    state?: string;
    az?: string;
    publicIp?: string;
    privateIp?: string;
    imageId?: string;
    keyName?: string;
    launched?: string;
    tags?: Record<string, string>;
}

function summarize(instance: Instance): Ec2Summary {
    const tags = Object.fromEntries((instance.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? '']));
    return {
        id: instance.InstanceId ?? 'unknown',
        name: tags.Name,
        type: instance.InstanceType,
        state: instance.State?.Name,
        az: instance.Placement?.AvailabilityZone,
        publicIp: instance.PublicIpAddress,
        privateIp: instance.PrivateIpAddress,
        imageId: instance.ImageId,
        keyName: instance.KeyName,
        launched: instance.LaunchTime?.toISOString(),
        tags,
    };
}

/** The root volume's device name, needed to resize it at launch. */
async function rootDeviceName(client: EC2Client, image: string): Promise<string> {
    if (image.startsWith('ubuntu')) return '/dev/sda1';
    if (image.startsWith('ami-')) {
        const result = await client.send(new DescribeImagesCommand({ ImageIds: [image] }));
        return result.Images?.[0]?.RootDeviceName ?? '/dev/xvda';
    }
    return '/dev/xvda'; // Amazon Linux
}

export interface Ec2CreateOptions {
    image: string;
    instanceType: string;
    count?: number;
    name?: string;
    keyName?: string;
    securityGroupIds?: string[];
    subnetId?: string;
    /** Plain-text user data; it is base64-encoded here. */
    userData?: string;
    volumeSize?: number;
    publicIp?: boolean;
    iamInstanceProfile?: string;
    tags?: Record<string, string>;
}

export async function createInstances(client: EC2Client, opts: Ec2CreateOptions): Promise<Ec2Summary[]> {
    const tags = { ...opts.tags, ...(opts.name ? { Name: opts.name } : {}) };
    const tagList = toTagList(tags);
    const count = opts.count ?? 1;

    const input: RunInstancesCommandInput = {
        ImageId: resolveImage(opts.image),
        // Any instance type is passed through; AWS validates it, even ones newer than the SDK's list.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        InstanceType: opts.instanceType as _InstanceType,
        MinCount: count,
        MaxCount: count,
        KeyName: opts.keyName,
        UserData: opts.userData ? Buffer.from(opts.userData).toString('base64') : undefined,
        IamInstanceProfile: opts.iamInstanceProfile
            ? (opts.iamInstanceProfile.startsWith('arn:') ? { Arn: opts.iamInstanceProfile } : { Name: opts.iamInstanceProfile })
            : undefined,
        TagSpecifications: tagList.length > 0
            ? [{ ResourceType: 'instance', Tags: tagList }, { ResourceType: 'volume', Tags: tagList }]
            : undefined,
        BlockDeviceMappings: opts.volumeSize
            ? [{ DeviceName: await rootDeviceName(client, opts.image), Ebs: { VolumeSize: opts.volumeSize, VolumeType: 'gp3' } }]
            : undefined,
    };

    // A public IP choice has to be made on the network interface, which then also carries subnet and groups.
    if (opts.publicIp !== undefined) {
        input.NetworkInterfaces = [{
            DeviceIndex: 0,
            AssociatePublicIpAddress: opts.publicIp,
            SubnetId: opts.subnetId,
            Groups: opts.securityGroupIds,
        }];
    } else {
        input.SubnetId = opts.subnetId;
        input.SecurityGroupIds = opts.securityGroupIds;
    }

    const result = await client.send(new RunInstancesCommand(input));
    return (result.Instances ?? []).map(summarize);
}

export interface Ec2ListOptions {
    states?: string[];
    tags?: Record<string, string>;
}

export async function listInstances(client: EC2Client, opts: Ec2ListOptions = {}): Promise<Ec2Summary[]> {
    const filters: Filter[] = [];
    if (opts.states?.length) filters.push({ Name: 'instance-state-name', Values: opts.states });
    for (const [key, value] of Object.entries(opts.tags ?? {})) {
        filters.push({ Name: `tag:${key}`, Values: [value] });
    }

    const instances: Ec2Summary[] = [];
    let token: string | undefined;
    do {
        const page = await client.send(new DescribeInstancesCommand({
            Filters: filters.length ? filters : undefined,
            NextToken: token,
        }));
        for (const reservation of page.Reservations ?? []) {
            instances.push(...(reservation.Instances ?? []).map(summarize));
        }
        token = page.NextToken;
    } while (token);
    return instances;
}

export async function getInstance(client: EC2Client, id: string): Promise<Ec2Summary> {
    const result = await client.send(new DescribeInstancesCommand({ InstanceIds: [id] }));
    const instance = result.Reservations?.[0]?.Instances?.[0];
    if (!instance) throw new Error(`Instance ${id} not found.`);
    return summarize(instance);
}

export interface Ec2UpdateOptions {
    instanceType?: string;
    /** Stop the instance first if needed to change its type, then start it again. */
    restart?: boolean;
    name?: string;
    tags?: Record<string, string>;
    removeTags?: string[];
    terminationProtection?: boolean;
    /** Called with progress messages for long multi-step updates. */
    onProgress?: (message: string) => void;
}

export async function updateInstance(client: EC2Client, id: string, opts: Ec2UpdateOptions): Promise<Ec2Summary> {
    const progress = opts.onProgress ?? (() => {});
    const tags = { ...opts.tags, ...(opts.name ? { Name: opts.name } : {}) };

    // Check before applying anything so a dead instance doesn't end up half-updated.
    const current = opts.instanceType ? await getInstance(client, id) : undefined;
    if (current?.state === 'shutting-down' || current?.state === 'terminated') {
        throw new Error(`Instance ${id} is ${current.state}; its type can't be changed.`);
    }

    if (Object.keys(tags).length > 0) {
        await client.send(new CreateTagsCommand({ Resources: [id], Tags: toTagList(tags) }));
    }
    if (opts.removeTags?.length) {
        await client.send(new DeleteTagsCommand({ Resources: [id], Tags: opts.removeTags.map((Key) => ({ Key })) }));
    }
    if (opts.terminationProtection !== undefined) {
        await client.send(new ModifyInstanceAttributeCommand({
            InstanceId: id,
            DisableApiTermination: { Value: opts.terminationProtection },
        }));
    }

    if (opts.instanceType && current) {
        const wasRunning = current.state !== 'stopped';
        if (wasRunning) {
            if (!opts.restart) {
                throw new Error(`Instance ${id} is ${current.state}. Stop it first, or pass --restart to stop, resize and start it.`);
            }
            progress(`Stopping ${id}...`);
            await client.send(new StopInstancesCommand({ InstanceIds: [id] }));
            await waitForInstances(client, [id], 'stopped');
        }
        progress(`Changing ${id} to ${opts.instanceType}...`);
        await client.send(new ModifyInstanceAttributeCommand({ InstanceId: id, InstanceType: { Value: opts.instanceType } }));
        if (wasRunning) {
            progress(`Starting ${id}...`);
            await client.send(new StartInstancesCommand({ InstanceIds: [id] }));
        }
    }

    return getInstance(client, id);
}

export interface Ec2StateChange {
    id: string;
    previous?: string;
    current?: string;
}

export async function terminateInstances(client: EC2Client, ids: string[], { force = false } = {}): Promise<Ec2StateChange[]> {
    if (force) {
        for (const id of ids) {
            await client.send(new ModifyInstanceAttributeCommand({ InstanceId: id, DisableApiTermination: { Value: false } }));
        }
    }
    const result = await client.send(new TerminateInstancesCommand({ InstanceIds: ids }));
    return (result.TerminatingInstances ?? []).map((c) => ({
        id: c.InstanceId ?? 'unknown', previous: c.PreviousState?.Name, current: c.CurrentState?.Name,
    }));
}

export async function startInstances(client: EC2Client, ids: string[]): Promise<Ec2StateChange[]> {
    const result = await client.send(new StartInstancesCommand({ InstanceIds: ids }));
    return (result.StartingInstances ?? []).map((c) => ({
        id: c.InstanceId ?? 'unknown', previous: c.PreviousState?.Name, current: c.CurrentState?.Name,
    }));
}

export async function stopInstances(client: EC2Client, ids: string[], { force = false } = {}): Promise<Ec2StateChange[]> {
    const result = await client.send(new StopInstancesCommand({ InstanceIds: ids, Force: force || undefined }));
    return (result.StoppingInstances ?? []).map((c) => ({
        id: c.InstanceId ?? 'unknown', previous: c.PreviousState?.Name, current: c.CurrentState?.Name,
    }));
}

export async function rebootInstances(client: EC2Client, ids: string[]): Promise<void> {
    await client.send(new RebootInstancesCommand({ InstanceIds: ids }));
}

/** Waits until every instance reaches the state. Throws if it doesn't within MAX_WAIT_SECONDS. */
export async function waitForInstances(client: EC2Client, ids: string[], state: 'running' | 'stopped' | 'terminated'): Promise<void> {
    const waiter = { running: waitUntilInstanceRunning, stopped: waitUntilInstanceStopped, terminated: waitUntilInstanceTerminated }[state];
    await waiter({ client, maxWaitTime: MAX_WAIT_SECONDS }, { InstanceIds: ids });
}
