import yargs from 'yargs';
import awsCommand from './commands/aws/aws';

/**
 * Argument and command definitions.
 * Each provider's commands live in src/commands/<provider>/<provider>.ts
 */
const argv = yargs(process.argv.slice(2))
    .scriptName('clover')
    .command(awsCommand)
    .strict()
    .help()
    .parse();

export default argv;
