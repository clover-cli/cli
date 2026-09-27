import {
    CreateDefaultSubnetCommand,
    CreateDefaultVpcCommand,
    DescribeAvailabilityZonesCommand,
    DescribeSubnetsCommand,
    DescribeVpcsCommand,
    type EC2Client,
} from '@aws-sdk/client-ec2';

/**
 * AWS's default network: the default VPC, with a default subnet in every availability zone.
 * Services like RDS place resources there when no network is given. It's free, but it can be
 * missing (deleted, or never created in older accounts), so Clover restores it when a command
 * needs it rather than asking people to learn about VPCs.
 */

export interface NetworkRestore {
    vpcId: string;
    /** True when the default VPC itself had to be created (it comes with its subnets). */
    vpcCreated: boolean;
    /** Availability zones that got a new default subnet. */
    subnetsCreated: string[];
}

/** Errors AWS returns when a command needs the default network and it isn't there. */
export function isMissingDefaultNetwork(err: unknown): boolean {
    return /no default (subnet|vpc)|default vpc (does not exist|not found)|default subnet/i.test(message(err));
}

function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** Creates the default VPC if there is none, otherwise the default subnets missing from it. */
export async function restoreDefaultNetwork(client: EC2Client): Promise<NetworkRestore> {
    const vpcs = await client.send(new DescribeVpcsCommand({ Filters: [{ Name: 'is-default', Values: ['true'] }] }));
    const existing = vpcs.Vpcs?.[0]?.VpcId;
    if (!existing) {
        const created = await client.send(new CreateDefaultVpcCommand({}));
        return { vpcId: created.Vpc?.VpcId ?? 'unknown', vpcCreated: true, subnetsCreated: [] };
    }

    const [zones, subnets] = await Promise.all([
        client.send(new DescribeAvailabilityZonesCommand({
            Filters: [{ Name: 'zone-type', Values: ['availability-zone'] }, { Name: 'state', Values: ['available'] }],
        })),
        client.send(new DescribeSubnetsCommand({
            Filters: [{ Name: 'vpc-id', Values: [existing] }, { Name: 'default-for-az', Values: ['true'] }],
        })),
    ]);
    const covered = new Set((subnets.Subnets ?? []).map((s) => s.AvailabilityZone));
    const missing = (zones.AvailabilityZones ?? []).map((z) => z.ZoneName).filter((z): z is string => !!z && !covered.has(z));

    const subnetsCreated: string[] = [];
    const failures: string[] = [];
    for (const zone of missing) {
        try {
            await client.send(new CreateDefaultSubnetCommand({ AvailabilityZone: zone }));
            subnetsCreated.push(zone);
        } catch (err) {
            // Some zones don't allow default subnets; the others are enough.
            failures.push(`${zone}: ${message(err)}`);
        }
    }
    // RDS needs subnets in at least two zones.
    if (covered.size + subnetsCreated.length < 2) {
        throw new Error(`Could not restore the default network (subnets in fewer than 2 availability zones).\n${failures.join('\n')}`);
    }
    return { vpcId: existing, vpcCreated: false, subnetsCreated };
}
