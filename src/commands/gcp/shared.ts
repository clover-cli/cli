import type { Argv, Options } from 'yargs';
import { gcpClient, getGcpConfig, type GcpClient } from '../../provider/gcp';

/**
 * Helpers for the GCP service commands (clover gcp compute|sql|...). The provider-agnostic ones
 * (action, print, confirm, info, ...) are shared with AWS: import them from '../aws/shared'.
 */

export const DEFAULT_GCP_REGION = 'us-central1';

/** Options every GCP service command accepts. Same names as AWS's commonOptions, plus --project. */
export const gcpCommonOptions = {
    project: { type: 'string', describe: 'Project for this command (overrides GOOGLE_CLOUD_PROJECT)' },
    region: { type: 'string', default: DEFAULT_GCP_REGION, describe: 'Region for this command' },
    output: { choices: ['table', 'json'] as const, default: 'table' as const, describe: 'Output format' },
} as const satisfies Record<string, Options>;

/** Like serviceBuilder in ../aws/shared, with the GCP options. */
export function gcpServiceBuilder(yargs: Argv): Argv {
    return yargs
        .options(gcpCommonOptions)
        .config('config', 'JSON file with options for this command (flags override it)');
}

/** The client and project for a command, from the environment with --project applied. */
export function gcpContext(argv: { project?: unknown }): { client: GcpClient; project: string } {
    const login = getGcpConfig();
    const project = typeof argv.project === 'string' && argv.project ? argv.project : login.project;
    return { client: gcpClient({ ...login, project }), project };
}
