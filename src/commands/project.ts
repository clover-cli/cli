import type { Argv, CommandModule } from 'yargs';
import { createProject, deleteProject, getProject, loadProjects, useProject } from '../projects';
import { action, confirm, info, print, yesOption } from './aws/shared';

const outputOption = {
    output: { choices: ['table', 'json'] as const, default: 'table' as const, describe: 'Output format' },
} as const;

const nameArgument = { name: { type: 'string', describe: 'Project name' } } as const;

const create = action({
    command: 'create <name>',
    describe: 'Create a project',
    positionals: nameArgument,
    handler: async (argv) => {
        print(argv, createProject(argv.name));
        info(`Run \`clover project use ${argv.name}\` to make it the current project.`);
    },
});

const list = action({
    command: 'list',
    describe: 'List projects',
    handler: async (argv) => {
        const { current, projects } = loadProjects();
        print(argv, projects.map((p) => ({ ...p, current: p.name === current })), 'No projects. Create one with: clover project create <name>');
    },
});

const get = action({
    command: 'get <name>',
    describe: 'Show one project',
    positionals: nameArgument,
    handler: async (argv) => {
        print(argv, { ...getProject(argv.name), current: loadProjects().current === argv.name });
    },
});

const remove = action({
    command: 'delete <name>',
    describe: 'Delete a project (its resources and their tags are kept)',
    positionals: nameArgument,
    options: yesOption,
    handler: async (argv) => {
        getProject(argv.name);
        if (!await confirm(argv, `Delete project ${argv.name}? Its resources are kept.`)) return;
        deleteProject(argv.name);
        info(`Deleted project ${argv.name}.`);
    },
});

const use = action({
    command: 'use [name]',
    describe: 'Set the current project (--none to clear it)',
    positionals: nameArgument,
    options: { none: { type: 'boolean', default: false, describe: 'Clear the current project' } },
    handler: async (argv) => {
        if (argv.none) {
            useProject(undefined);
            info('No current project.');
            return;
        }
        if (!argv.name) throw new Error('Give a project name, or --none to clear the current project.');
        useProject(argv.name);
        info(`Current project: ${argv.name}.`);
    },
});

/**
 * clover project <create|list|get|delete|use>
 */
const projectCommand: CommandModule = {
    command: 'project',
    describe: 'Group resources into projects',
    builder: (yargs: Argv) => yargs
        .options(outputOption)
        .command(create)
        .command(list)
        .command(get)
        .command(remove)
        .command(use)
        .demandCommand(1, 'Choose an action: create, list, get, delete, use'),
    handler: () => {},
};

export default projectCommand;
