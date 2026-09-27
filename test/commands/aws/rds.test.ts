import { describe, expect, it, vi } from 'vitest';
import { getAwsClientConfig } from '../../../src/provider/aws';
import {
    createDatabase, deleteDatabase, getDatabase, updateDatabase, waitForDatabase,
} from '../../../src/provider/aws-services/rds';
import { restoreDefaultNetwork } from '../../../src/provider/aws-services/network';
import { errored, runCli, testConfig } from '../../helpers';

vi.mock('../../../src/provider/aws-services/rds');
vi.mock('../../../src/provider/aws-services/network', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../../src/provider/aws-services/network')>(),
    restoreDefaultNetwork: vi.fn(),
}));

const noDefaultSubnet = new Error('No default subnet detected in VPC. Please contact AWS Support to recreate default Subnets.');

describe('clover aws rds', () => {
    it('creates a Postgres database with defaults and waits for it', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(createDatabase).mockResolvedValue({ id: 'app-db', status: 'creating' });
        vi.mocked(getDatabase).mockResolvedValue({ id: 'app-db', status: 'available' });

        await runCli('aws rds create app-db --database app --wait');

        expect(createDatabase).toHaveBeenCalledWith(undefined, 'app-db', expect.objectContaining({
            engine: 'postgres', instanceClass: 'db.t3.micro', storage: 20, username: 'dbadmin', password: undefined, database: 'app',
        }));
        expect(waitForDatabase).toHaveBeenCalledWith(undefined, 'app-db', 'available');
        expect(errored()).toContain('Secrets Manager');
    });

    it('restores the default network and retries when the account has none', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(createDatabase).mockRejectedValueOnce(noDefaultSubnet).mockResolvedValueOnce({ id: 'app-db', status: 'creating' });
        vi.mocked(restoreDefaultNetwork).mockResolvedValue({ vpcId: 'vpc-1', vpcCreated: false, subnetsCreated: ['us-east-1a', 'us-east-1b'] });

        await runCli('aws rds create app-db');

        expect(restoreDefaultNetwork).toHaveBeenCalledOnce();
        expect(createDatabase).toHaveBeenCalledTimes(2);
        expect(errored()).toContain('Added default subnets in us-east-1a, us-east-1b to vpc-1.');
        expect(process.exitCode).toBeUndefined();
    });

    it('leaves the network alone when a subnet group is given', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(createDatabase).mockRejectedValueOnce(noDefaultSubnet);

        await runCli('aws rds create app-db --subnet-group mine');

        expect(restoreDefaultNetwork).not.toHaveBeenCalled();
        expect(process.exitCode).toBe(1);
    });

    it('updates and waits for the change to apply', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(updateDatabase).mockResolvedValue({ id: 'app-db' });
        vi.mocked(getDatabase).mockResolvedValue({ id: 'app-db' });

        await runCli('aws rds update app-db --class db.t3.medium --storage 100 --apply-immediately --wait');

        expect(updateDatabase).toHaveBeenCalledWith(undefined, 'app-db', expect.objectContaining({
            instanceClass: 'db.t3.medium', storage: 100, applyImmediately: true,
        }));
        expect(waitForDatabase).toHaveBeenCalledWith(undefined, 'app-db', 'modified');
    });

    it('deletes with a final snapshot', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(deleteDatabase).mockResolvedValue({ id: 'app-db' });

        await runCli('aws rds delete app-db --final-snapshot app-db-final -y');

        expect(deleteDatabase).toHaveBeenCalledWith(undefined, 'app-db', { finalSnapshot: 'app-db-final', keepBackups: false, force: false });
    });
});
