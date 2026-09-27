import type { EC2Client } from '@aws-sdk/client-ec2';
import { describe, expect, it } from 'vitest';
import { isMissingDefaultNetwork, restoreDefaultNetwork } from '../../../src/provider/aws-services/network';
import { fakeClient } from '../../helpers';

const zones = { AvailabilityZones: [{ ZoneName: 'us-east-1a' }, { ZoneName: 'us-east-1b' }, { ZoneName: 'us-east-1c' }] };

describe('isMissingDefaultNetwork', () => {
    it('recognizes the RDS error for a missing default subnet', () => {
        expect(isMissingDefaultNetwork(new Error('No default subnet detected in VPC. Please contact AWS Support to recreate default Subnets.'))).toBe(true);
        expect(isMissingDefaultNetwork(new Error('The security token included in the request is invalid.'))).toBe(false);
    });
});

describe('restoreDefaultNetwork', () => {
    it('creates the default VPC when there is none', async () => {
        const { client, sent } = fakeClient<EC2Client>({
            DescribeVpcsCommand: { Vpcs: [] },
            CreateDefaultVpcCommand: { Vpc: { VpcId: 'vpc-new' } },
        });

        expect(await restoreDefaultNetwork(client)).toEqual({ vpcId: 'vpc-new', vpcCreated: true, subnetsCreated: [] });
        expect(sent().map((c) => c.name)).toEqual(['DescribeVpcsCommand', 'CreateDefaultVpcCommand']);
    });

    it('adds default subnets only in the zones missing one', async () => {
        const { client, sent } = fakeClient<EC2Client>({
            DescribeVpcsCommand: { Vpcs: [{ VpcId: 'vpc-1' }] },
            DescribeAvailabilityZonesCommand: zones,
            DescribeSubnetsCommand: { Subnets: [{ AvailabilityZone: 'us-east-1b' }] },
        });

        expect(await restoreDefaultNetwork(client)).toEqual({ vpcId: 'vpc-1', vpcCreated: false, subnetsCreated: ['us-east-1a', 'us-east-1c'] });
        expect(sent().filter((c) => c.name === 'CreateDefaultSubnetCommand').map((c) => c.input.AvailabilityZone))
            .toEqual(['us-east-1a', 'us-east-1c']);
    });

    it('skips zones that refuse a default subnet, as long as two zones are covered', async () => {
        const { client } = fakeClient<EC2Client>({
            DescribeVpcsCommand: { Vpcs: [{ VpcId: 'vpc-1' }] },
            DescribeAvailabilityZonesCommand: zones,
            DescribeSubnetsCommand: { Subnets: [] },
            CreateDefaultSubnetCommand: (input: { AvailabilityZone: string }) =>
                input.AvailabilityZone === 'us-east-1c' ? new Error('Not supported in this zone') : {},
        });

        expect((await restoreDefaultNetwork(client)).subnetsCreated).toEqual(['us-east-1a', 'us-east-1b']);
    });

    it('fails when fewer than two zones end up with a subnet', async () => {
        const { client } = fakeClient<EC2Client>({
            DescribeVpcsCommand: { Vpcs: [{ VpcId: 'vpc-1' }] },
            DescribeAvailabilityZonesCommand: zones,
            DescribeSubnetsCommand: { Subnets: [] },
            CreateDefaultSubnetCommand: new Error('Not supported in this zone'),
        });

        await expect(restoreDefaultNetwork(client)).rejects.toThrow(/fewer than 2 availability zones/);
    });
});
