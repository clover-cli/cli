import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { getAwsClientConfig } from '../../../src/provider/aws';
import {
    createInstances, ec2Client, listInstances, startInstances, terminateInstances, updateInstance, waitForInstances,
} from '../../../src/provider/aws-services/ec2';
import { errored, logged, runCli, testConfig } from '../../helpers';

vi.mock('../../../src/provider/aws-services/ec2');

describe('clover aws ec2', () => {
    it('requires an action', async () => {
        await expect(runCli('aws ec2')).rejects.toThrow('Choose an action');
    });

    it('creates instances with defaults', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(createInstances).mockResolvedValue([{ id: 'i-1', state: 'pending' }]);

        await runCli('aws ec2 create --name web --tags env=dev --tags team=core');

        expect(ec2Client).toHaveBeenCalledWith(testConfig);
        expect(createInstances).toHaveBeenCalledWith(undefined, expect.objectContaining({
            image: 'al2023', instanceType: 't3.micro', count: 1, name: 'web', tags: { env: 'dev', team: 'core' },
        }));
        expect(errored()).toContain('Launched i-1.');
        expect(waitForInstances).not.toHaveBeenCalled();
    });

    it('reads every option from --config, with flags taking precedence', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(createInstances).mockResolvedValue([{ id: 'i-1' }]);
        const dir = mkdtempSync(path.join(tmpdir(), 'clover-'));
        writeFileSync(path.join(dir, 'setup.sh'), '#!/bin/sh\necho hi');
        const config = path.join(dir, 'web.json');
        writeFileSync(config, JSON.stringify({
            'instance-type': 't3.small', count: 2, 'security-group-ids': ['sg-1'], 'user-data': `@${path.join(dir, 'setup.sh')}`,
            region: 'eu-west-1', name: 'from-file',
        }));

        await runCli(`aws ec2 create --config ${config} --name from-flag`);

        expect(ec2Client).toHaveBeenCalledWith({ ...testConfig, region: 'eu-west-1' });
        expect(createInstances).toHaveBeenCalledWith(undefined, expect.objectContaining({
            instanceType: 't3.small', count: 2, securityGroupIds: ['sg-1'], userData: '#!/bin/sh\necho hi', name: 'from-flag',
        }));
    });

    it('rejects unknown keys in the config file', async () => {
        const config = path.join(mkdtempSync(path.join(tmpdir(), 'clover-')), 'bad.json');
        writeFileSync(config, '{"colour":"blue"}');

        await expect(runCli(`aws ec2 create --config ${config}`)).rejects.toThrow('Unknown argument: colour');
    });

    it('waits for new instances to run with --wait', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(createInstances).mockResolvedValue([{ id: 'i-1' }, { id: 'i-2' }]);

        await runCli('aws ec2 create --count 2 --wait --output json');

        expect(waitForInstances).toHaveBeenCalledWith(undefined, ['i-1', 'i-2'], 'running');
    });

    it('lists instances filtered by state and tag', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(listInstances).mockResolvedValue([{ id: 'i-1', tags: { env: 'dev' } }]);

        await runCli('aws ec2 list --state running --tag env=dev --output json');

        expect(listInstances).toHaveBeenCalledWith(undefined, { states: ['running'], tags: { env: 'dev' } });
        expect(JSON.parse(logged())).toEqual([{ id: 'i-1', tags: { env: 'dev' } }]);
    });

    it('updates the type with --restart and reports progress', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(updateInstance).mockResolvedValue({ id: 'i-1', type: 't3.large' });

        await runCli('aws ec2 update i-1 --type t3.large --restart --no-termination-protection');

        expect(updateInstance).toHaveBeenCalledWith(undefined, 'i-1', expect.objectContaining({
            instanceType: 't3.large', restart: true, terminationProtection: false,
        }));
    });

    it('terminates several instances with --yes', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(terminateInstances).mockResolvedValue([]);

        await runCli('aws ec2 delete i-1 i-2 --yes --force');

        expect(terminateInstances).toHaveBeenCalledWith(undefined, ['i-1', 'i-2'], { force: true });
    });

    it('refuses to terminate without --yes outside a terminal', async () => {
        process.stdin.isTTY = false;

        await runCli('aws ec2 delete i-1');

        expect(terminateInstances).not.toHaveBeenCalled();
        expect(errored()).toContain('Pass --yes');
        expect(process.exitCode).toBe(1);
    });

    it('starts instances and waits', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(startInstances).mockResolvedValue([]);

        await runCli('aws ec2 start i-1 --wait');

        expect(waitForInstances).toHaveBeenCalledWith(undefined, ['i-1'], 'running');
    });

    it('reports AWS errors', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(listInstances).mockRejectedValue(new Error('UnauthorizedOperation'));

        await runCli('aws ec2 list');

        expect(errored()).toContain('UnauthorizedOperation');
        expect(process.exitCode).toBe(1);
    });
});
