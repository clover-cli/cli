import type { Argv, CommandModule } from 'yargs';
import { costClient, monthlyCosts } from '../../provider/aws-services/cost';
import { action, clientConfig, print, serviceBuilder } from './shared';

const monthly = action({
    command: 'monthly',
    describe: 'Show the AWS bill per month (for the whole organization when run from its management account)',
    options: {
        months: { type: 'number', default: 6, describe: 'How many months, this one included' },
    },
    examples: [['$0 aws cost monthly --months 12', 'The last year, month by month']],
    handler: async (argv) => {
        if (!(argv.months >= 1)) throw new Error('--months must be at least 1.');
        print(argv, await monthlyCosts(costClient(clientConfig(argv)), argv.months), 'No costs found.');
    },
});

/**
 * clover aws cost <monthly>
 */
const costCommand: CommandModule = {
    command: 'cost',
    describe: 'See what the AWS account or organization costs',
    builder: (yargs: Argv) => serviceBuilder(yargs)
        .command(monthly)
        .demandCommand(1, 'Choose an action: monthly'),
    handler: () => {},
};

export default costCommand;
