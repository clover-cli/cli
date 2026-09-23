import yargs from 'yargs';

/**
 * Argument definitions.
 * ?? This could potentially be set on a separate file.
 */
const argv = yargs(process.argv.slice(2)).options({
    a: {
        type: 'boolean', default: false
    },
    b: {
        type: 'number', default: false
    },
    message: {
        type: 'string', default: false
    }
}).parseSync();

/**
 * Example use case:
 * node dist/index.js --message Example
 * >Example
 */
if (argv.message) {
    console.log(argv.message);
}