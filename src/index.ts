#!/usr/bin/env node
import argv from './args';

void Promise.resolve(argv).then((args) => {
    if (args.message) {
        console.log(args.message);
    }
});
