import { describe, expect, it, vi } from 'vitest';
import { getAwsClientConfig } from '../../../src/provider/aws';
import { createBucket, deleteBucket, uploadObject } from '../../../src/provider/aws-services/s3';
import { errored, runCli, testConfig } from '../../helpers';

vi.mock('../../../src/provider/aws-services/s3');

describe('clover aws s3', () => {
    it('creates a bucket in the --region given', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(createBucket).mockResolvedValue({ name: 'assets' });

        await runCli('aws s3 create assets --region eu-west-1 --versioning --tags env=prod');

        expect(createBucket).toHaveBeenCalledWith(undefined, 'assets', { region: 'eu-west-1', versioning: true, tags: { env: 'prod' } });
        expect(errored()).toContain('Created bucket assets in eu-west-1.');
    });

    it('empties and deletes a bucket with --force', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(deleteBucket).mockResolvedValue({ name: 'assets', objectsDeleted: 3 });

        await runCli('aws s3 delete assets --force --yes');

        expect(deleteBucket).toHaveBeenCalledWith(undefined, 'assets', { force: true });
        expect(errored()).toContain('Deleted assets and 3 object(s).');
    });

    it('uploads a file under its own name by default', async () => {
        vi.mocked(getAwsClientConfig).mockReturnValue(testConfig);
        vi.mocked(uploadObject).mockResolvedValue({ bucket: 'assets', key: 'logo.png', size: 1 });

        await runCli('aws s3 upload assets ./img/logo.png');

        expect(uploadObject).toHaveBeenCalledWith(undefined, 'assets', 'logo.png', './img/logo.png', { contentType: undefined });
    });
});
