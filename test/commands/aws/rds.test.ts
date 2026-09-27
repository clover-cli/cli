import { describe, expect, it, vi } from 'vitest';
import { getAwsClientConfig } from '../../../src/provider/aws';
import {
    createDatabase, deleteDatabase, getDatabase, updateDatabase, waitForDatabase,
} from '../../../src/provider/aws-services/rds';
import { errored, runCli, testConfig } from '../../helpers';

vi.mock('../../../src/provider/aws-services/rds');

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
