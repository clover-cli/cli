import yargs from 'yargs';
import awsCommand from './commands/aws';

/**
 * Argument and command definitions.
 * Each provider's commands live in src/commands/<provider>.ts
 */
const argv = yargs(process.argv.slice(2))
    .scriptName('clover')
    .command(awsCommand)
    .options({
        a: {
            type: 'boolean', default: false
        },
        b: {
            type: 'number', default: false
        },
        message: {
            type: 'string', default: false
        }
    })
    .strict()
    .help()
    .parse();

export default argv;
