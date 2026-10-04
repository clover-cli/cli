import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { exportCommands, gcpExportCommands, gcpUnsetCommand, readAwsEnv, readGcpEnv, unsetCommand } from '../src/credentials';

const { getAwsClientConfig } = await vi.importActual<typeof import('../src/provider/aws')>('../src/provider/aws');

const keys = { AWS_ACCESS_KEY_ID: 'AKIA', AWS_SECRET_ACCESS_KEY: 'SECRET' };

describe('readAwsEnv', () => {
    it('returns undefined when the access key or secret is missing', () => {
        expect(readAwsEnv({})).toBeUndefined();
        expect(readAwsEnv({ AWS_ACCESS_KEY_ID: 'AKIA' })).toBeUndefined();
        expect(readAwsEnv({ AWS_SECRET_ACCESS_KEY: 'SECRET' })).toBeUndefined();
        expect(readAwsEnv({ AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: 'SECRET' })).toBeUndefined();
    });

    it('reads every variable', () => {
        expect(readAwsEnv({ ...keys, AWS_SESSION_TOKEN: 'TOKEN', AWS_REGION: 'eu-west-1' })).toEqual({
            accessKeyId: 'AKIA', secretAccessKey: 'SECRET', sessionToken: 'TOKEN', region: 'eu-west-1',
        });
    });

    it('treats an empty session token as missing', () => {
        expect(readAwsEnv({ ...keys, AWS_SESSION_TOKEN: '' })?.sessionToken).toBeUndefined();
    });

    it('falls back to AWS_DEFAULT_REGION, then us-east-1', () => {
        expect(readAwsEnv({ ...keys, AWS_REGION: 'eu-west-1', AWS_DEFAULT_REGION: 'ap-south-1' })?.region).toBe('eu-west-1');
        expect(readAwsEnv({ ...keys, AWS_DEFAULT_REGION: 'ap-south-1' })?.region).toBe('ap-south-1');
        expect(readAwsEnv(keys)?.region).toBe('us-east-1');
    });
});

describe('exportCommands', () => {
    it('round-trips values with quotes and spaces through a real shell', () => {
        const login = { accessKeyId: "AK'IA", secretAccessKey: 'a b$HOME"c', sessionToken: 't`o`k', region: 'us-east-1' };
        const script = `${exportCommands(login).join('\n')}\nprintf '%s\\n' "$AWS_ACCESS_KEY_ID" "$AWS_SECRET_ACCESS_KEY" "$AWS_SESSION_TOKEN" "$AWS_REGION"`;

        const output = execFileSync('sh', ['-c', script], { encoding: 'utf8' });

        expect(output).toBe(`AK'IA\na b$HOME"c\nt\`o\`k\nus-east-1\n`);
    });

    it('unsets a stale session token when there is none', () => {
        const script = `${exportCommands({ accessKeyId: 'A', secretAccessKey: 'S', region: 'r' }).join('\n')}\necho "[\${AWS_SESSION_TOKEN-unset}]"`;

        const output = execFileSync('sh', ['-c', script], { encoding: 'utf8', env: { ...process.env, AWS_SESSION_TOKEN: 'old' } });

        expect(output).toBe('[unset]\n');
    });
});

describe('unsetCommand', () => {
    it('unsets every variable login exports', () => {
        const exported = exportCommands({ accessKeyId: 'A', secretAccessKey: 'S', sessionToken: 'T', region: 'r' })
            .map((line) => /^export (\w+)=/.exec(line)?.[1]);

        expect(unsetCommand().split(' ').slice(1)).toEqual(exported);
    });
});

describe('getAwsClientConfig', () => {
    it('builds an SDK client config from the environment', () => {
        expect(getAwsClientConfig({ ...keys, AWS_REGION: 'eu-west-1' })).toEqual({
            region: 'eu-west-1',
            credentials: { accessKeyId: 'AKIA', secretAccessKey: 'SECRET', sessionToken: undefined },
        });
    });

    it('explains how to set credentials when none are found', () => {
        expect(() => getAwsClientConfig({})).toThrow('No AWS credentials found');
    });
});

describe('readGcpEnv', () => {
    it('returns undefined without a project', () => {
        expect(readGcpEnv({})).toBeUndefined();
        expect(readGcpEnv({ GOOGLE_APPLICATION_CREDENTIALS: '/key.json' })).toBeUndefined();
    });

    it('reads the project and an optional key file', () => {
        expect(readGcpEnv({ GOOGLE_CLOUD_PROJECT: 'p', GOOGLE_APPLICATION_CREDENTIALS: '/key.json' }))
            .toEqual({ project: 'p', keyFile: '/key.json' });
        expect(readGcpEnv({ GOOGLE_CLOUD_PROJECT: 'p', GOOGLE_APPLICATION_CREDENTIALS: '' }))
            .toEqual({ project: 'p', keyFile: undefined });
    });
});

/** Evals the GCP exports in a shell that has a stale key file set, and echoes the result. */
const runGcpExports = (login: { project: string; keyFile?: string }) => execFileSync('sh', ['-c',
    `${gcpExportCommands(login).join('\n')}\necho "$GOOGLE_CLOUD_PROJECT [\${GOOGLE_APPLICATION_CREDENTIALS-unset}]"`,
], { encoding: 'utf8', env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: 'old' } });

describe('gcpExportCommands', () => {
    it('round-trips through a real shell and unsets a stale key file', () => {
        expect(runGcpExports({ project: "my'proj", keyFile: '/a b/key.json' })).toBe("my'proj [/a b/key.json]\n");
        expect(runGcpExports({ project: 'p' })).toBe('p [unset]\n');
    });

    it('is undone by gcpUnsetCommand', () => {
        const exported = gcpExportCommands({ project: 'p', keyFile: 'k' }).map((line) => /^export (\w+)=/.exec(line)?.[1]);

        expect(gcpUnsetCommand().split(' ').slice(1)).toEqual(exported);
    });
});
