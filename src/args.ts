import yargs from 'yargs';
import awsCommand from './commands/aws/aws';
import gcpCommand from './commands/gcp/gcp';
import projectCommand from './commands/project';

/**
 * Argument and command definitions.
 * Each provider's commands live in src/commands/<provider>/<provider>.ts
 */
const argv = yargs(process.argv.slice(2))
    .scriptName('clover')
    .command(awsCommand)
    .command(gcpCommand)
    .command(projectCommand)
    .completion()
    .strict()
    .help()
    .parse();

export default argv;
