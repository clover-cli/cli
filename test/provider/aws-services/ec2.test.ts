import type { EC2Client } from '@aws-sdk/client-ec2';
import { waitUntilInstanceStopped } from '@aws-sdk/client-ec2';
import { describe, expect, it, vi } from 'vitest';
import { createInstances, IMAGE_ALIASES, terminateInstances, updateInstance } from '../../../src/provider/aws-services/ec2';
import { fakeClient } from '../../helpers';

vi.mock('@aws-sdk/client-ec2', async (importOriginal) => ({
    ...await importOriginal<typeof import('@aws-sdk/client-ec2')>(),
    waitUntilInstanceRunning: vi.fn(),
    waitUntilInstanceStopped: vi.fn(),
    waitUntilInstanceTerminated: vi.fn(),
}));

const described = (state: string) => ({
    Reservations: [{ Instances: [{ InstanceId: 'i-1', InstanceType: 't3.micro', State: { Name: state } }] }],
});

describe('createInstances', () => {
    it('resolves image aliases, encodes user data and tags instance and volume', async () => {
        const { client, sent } = fakeClient<EC2Client>({ RunInstancesCommand: { Instances: [{ InstanceId: 'i-1' }] } });

        const result = await createInstances(client, {
            image: 'al2023', instanceType: 't3.micro', name: 'web', userData: 'echo hi', tags: { env: 'dev' },
        });

        expect(result.map((i) => i.id)).toEqual(['i-1']);
        const input = sent()[0].input;
        expect(input.ImageId).toBe(IMAGE_ALIASES.al2023);
        expect(input.UserData).toBe(Buffer.from('echo hi').toString('base64'));
        expect(input.TagSpecifications).toEqual([
            { ResourceType: 'instance', Tags: [{ Key: 'env', Value: 'dev' }, { Key: 'Name', Value: 'web' }] },
            { ResourceType: 'volume', Tags: [{ Key: 'env', Value: 'dev' }, { Key: 'Name', Value: 'web' }] },
        ]);
        expect(input).toMatchObject({ MinCount: 1, MaxCount: 1 });
    });

    it('moves subnet and security groups onto the network interface when --public-ip is set', async () => {
        const { client, sent } = fakeClient<EC2Client>();

        await createInstances(client, {
            image: 'ami-123', instanceType: 't3.micro', publicIp: true, subnetId: 'subnet-1', securityGroupIds: ['sg-1'],
        });

        const input = sent()[0].input;
        expect(input.SubnetId).toBeUndefined();
        expect(input.SecurityGroupIds).toBeUndefined();
        expect(input.NetworkInterfaces).toEqual([{ DeviceIndex: 0, AssociatePublicIpAddress: true, SubnetId: 'subnet-1', Groups: ['sg-1'] }]);
    });

    it('looks up the root device of an AMI to resize its volume', async () => {
        const { client, sent } = fakeClient<EC2Client>({ DescribeImagesCommand: { Images: [{ RootDeviceName: '/dev/sda1' }] } });

        await createInstances(client, { image: 'ami-123', instanceType: 't3.micro', volumeSize: 30 });

        expect(sent()[1].input.BlockDeviceMappings).toEqual([{ DeviceName: '/dev/sda1', Ebs: { VolumeSize: 30, VolumeType: 'gp3' } }]);
    });
});

describe('updateInstance', () => {
    it('refuses to resize a running instance without --restart', async () => {
        const { client } = fakeClient<EC2Client>({ DescribeInstancesCommand: described('running') });

        await expect(updateInstance(client, 'i-1', { instanceType: 't3.large' })).rejects.toThrow('--restart');
    });

    it('stops, resizes and starts a running instance with --restart', async () => {
        const { client, sent } = fakeClient<EC2Client>({ DescribeInstancesCommand: described('running') });

        await updateInstance(client, 'i-1', { instanceType: 't3.large', restart: true });

        expect(sent().map((c) => c.name)).toEqual([
            'DescribeInstancesCommand', 'StopInstancesCommand', 'ModifyInstanceAttributeCommand', 'StartInstancesCommand', 'DescribeInstancesCommand',
        ]);
        expect(waitUntilInstanceStopped).toHaveBeenCalled();
        expect(sent()[2].input).toEqual({ InstanceId: 'i-1', InstanceType: { Value: 't3.large' } });
    });

    it('resizes a stopped instance without starting it', async () => {
        const { client, sent } = fakeClient<EC2Client>({ DescribeInstancesCommand: described('stopped') });

        await updateInstance(client, 'i-1', { instanceType: 't3.large' });

        expect(sent().map((c) => c.name)).not.toContain('StartInstancesCommand');
    });

    it('adds and removes tags', async () => {
        const { client, sent } = fakeClient<EC2Client>({ DescribeInstancesCommand: described('running') });

        await updateInstance(client, 'i-1', { name: 'api', removeTags: ['old'] });

        expect(sent()[0]).toEqual({ name: 'CreateTagsCommand', input: { Resources: ['i-1'], Tags: [{ Key: 'Name', Value: 'api' }] } });
        expect(sent()[1]).toEqual({ name: 'DeleteTagsCommand', input: { Resources: ['i-1'], Tags: [{ Key: 'old' }] } });
    });
});

describe('terminateInstances', () => {
    it('turns off termination protection first with force', async () => {
        const { client, sent } = fakeClient<EC2Client>();

        await terminateInstances(client, ['i-1', 'i-2'], { force: true });

        expect(sent().map((c) => c.name)).toEqual([
            'ModifyInstanceAttributeCommand', 'ModifyInstanceAttributeCommand', 'TerminateInstancesCommand',
        ]);
    });
});
