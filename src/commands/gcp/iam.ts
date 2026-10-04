import type { Argv, CommandModule } from 'yargs';
import { getGcpConfig, verifyGcpCredentials } from '../../provider/gcp';
import { SERVICES, checkCommands, listRoles, memberFor } from '../../provider/gcp-services/iam';
import { action, info, print } from '../aws/shared';
import { gcpCommonOptions, gcpContext, gcpServiceBuilder } from './shared';

const policies = action({
    command: 'policies',
    describe: 'List the project roles granted to the current credentials',
    options: gcpCommonOptions,
    examples: [['$0 gcp iam policies', 'Roles granted to you directly on the project']],
    handler: async (argv) => {
        const { client, project } = gcpContext(argv);
        const { email } = await verifyGcpCredentials({ ...getGcpConfig(), project });
        if (!email) {
            throw new Error('These credentials have no email to look up (gcloud user credentials). Use a service account key file, or run: clover gcp iam check');
        }
        const member = memberFor(email);
        info(`Roles for ${member} on project ${project}:`);
        print(argv, await listRoles(client, project, member), 'No roles granted directly (roles granted through groups are not shown).');
    },
});

const check = action({
    command: 'check',
    describe: 'Check which Clover commands the current credentials are allowed to run',
    options: {
        ...gcpCommonOptions,
        service: { choices: SERVICES, array: true, describe: 'Only these services' },
    },
    examples: [
        ['$0 gcp iam check', 'Every service'],
        ['$0 gcp iam check --service storage functions', 'Only Cloud Storage and Cloud Functions'],
    ],
    handler: async (argv) => {
        const { client, project } = gcpContext(argv);
        const results = await checkCommands(client, project, argv.service?.map(String));
        if (argv.output === 'json') {
            print(argv, results);
            return;
        }
        info(`Commands you can run on project ${project} (checked with testIamPermissions):`);
        print(argv, results.map(({ service, command, allowed, missing }) => ({
            service, command, allowed: allowed ? 'yes' : 'no', missing: missing.join(' '),
        })));
    },
});

/**
 * clover gcp iam <policies|check>
 */
const iamCommand: CommandModule = {
    command: 'iam',
    describe: 'See which roles and permissions the current credentials have',
    builder: (yargs: Argv) => gcpServiceBuilder(yargs)
        .command(policies)
        .command(check)
        .demandCommand(1, 'Choose an action: policies or check'),
    handler: () => {},
};

export default iamCommand;
