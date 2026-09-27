import type { Argv, CommandModule } from 'yargs';
import { verifyAwsCredentials } from '../../provider/aws';
import { SERVICES, checkCommands, iamClient, listPolicies, principalFromArn } from '../../provider/aws-services/iam';
import { action, clientConfig, info, print, serviceBuilder } from './shared';

/** The IAM user or role behind the credentials, from STS GetCallerIdentity. */
async function currentPrincipal(argv: { region?: string }) {
    const config = clientConfig(argv);
    const identity = await verifyAwsCredentials({ ...config.credentials, region: config.region });
    if (!identity.arn) throw new Error('AWS did not say who these credentials belong to.');
    return { config, principal: principalFromArn(identity.arn) };
}

const policies = action({
    command: 'policies',
    describe: 'List the IAM policies that apply to the current credentials',
    examples: [['$0 aws iam policies', 'Policies attached to you directly and through your groups']],
    handler: async (argv) => {
        const { config, principal } = await currentPrincipal(argv);
        info(`Policies for ${principal.kind} ${principal.name}:`);
        print(argv, await listPolicies(iamClient(config), principal), 'No policies: these credentials can\'t do anything.');
    },
});

const check = action({
    command: 'check',
    describe: 'Check which Clover commands the current credentials are allowed to run',
    options: {
        service: { choices: SERVICES, array: true, describe: 'Only these services' },
    },
    examples: [
        ['$0 aws iam check', 'Every service'],
        ['$0 aws iam check --service s3 lambda', 'Only S3 and Lambda'],
    ],
    handler: async (argv) => {
        const { config, principal } = await currentPrincipal(argv);
        const results = await checkCommands(iamClient(config), principal, argv.service?.map(String));
        if (argv.output === 'json') {
            print(argv, results);
            return;
        }
        info(`Commands ${principal.kind} ${principal.name} can run (checked with the IAM policy simulator):`);
        print(argv, results.map(({ service, command, allowed, missing }) => ({
            service, command, allowed: allowed ? 'yes' : 'no', missing: missing.join(' '),
        })));
    },
});

/**
 * clover aws iam <policies|check>
 */
const iamCommand: CommandModule = {
    command: 'iam',
    describe: 'See which IAM policies and permissions the current credentials have',
    builder: (yargs: Argv) => serviceBuilder(yargs)
        .command(policies)
        .command(check)
        .demandCommand(1, 'Choose an action: policies or check'),
    handler: () => {},
};

export default iamCommand;
