import type { Argv, CommandModule } from 'yargs';
import { createProject, deleteProject, getProject, loadProjects, resolveProject, useProject } from '../projects';
import { listAwsResources } from '../provider/aws';
import { addToProject, listProjectResources, taggingClient, type ProjectResource } from '../provider/aws-services/tagging';
import { errorMessage } from '../utils';
import { action, clientConfig, commonOptions, confirm, info, print, yesOption } from './aws/shared';

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
    describe: 'Show one project and its AWS resources in the region',
    positionals: nameArgument,
    handler: async (argv) => {
        const project = { ...getProject(argv.name), current: loadProjects().current === argv.name };
        let resources: ProjectResource[] | undefined;
        try {
            resources = await listProjectResources(taggingClient(clientConfig(argv)), argv.name);
        } catch (err) {
            info(`Could not list the project's AWS resources: ${errorMessage(err)}`);
        }
        if (argv.output === 'json') {
            print(argv, { ...project, resources });
            return;
        }
        print(argv, project);
        if (resources) print(argv, resources.map(({ service, id, arn }) => ({ service, id, arn })), 'No resources in this project yet.');
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

const add = action({
    command: 'add <arns..>',
    describe: 'Bring existing resources into the current project (or --project), by ARN',
    positionals: { arns: { type: 'string', array: true, describe: 'Resource ARN(s)' } },
    options: { project: commonOptions.project },
    examples: [['$0 project add arn:aws:s3:::my-bucket arn:aws:lambda:us-east-1:123456789012:function:api', 'Add a bucket and a function']],
    handler: async (argv) => {
        const project = resolveProject(argv.project);
        if (!project) throw new Error('No current project. Pass --project <name>, or run: clover project use <name>');
        await addToProject(taggingClient(clientConfig(argv)), argv.arns, project);
        info(`Added ${argv.arns.length} resource(s) to project ${project}.`);
    },
});

const overview = action({
    command: 'overview',
    describe: 'Totals per service across the account, and per project',
    handler: async (argv) => {
        const [inventory, tagged] = await Promise.all([
            listAwsResources(),
            listProjectResources(taggingClient(clientConfig(argv))),
        ]);
        const names = [...new Set([...loadProjects().projects.map((p) => p.name), ...tagged.map((r) => r.project)])];
        const projects = names.map((project) => {
            const mine = tagged.filter((r) => r.project === project);
            const services: Record<string, number> = {};
            for (const r of mine) services[r.service] = (services[r.service] ?? 0) + 1;
            return { project, total: mine.length, ...services };
        });
        const services = inventory.services.map(({ service, count, error }) => ({ service, count, ...(error ? { error } : {}) }));
        if (argv.output === 'json') {
            print(argv, { region: inventory.region, total: inventory.total, services, projects });
            return;
        }
        console.log(`Account overview, region ${inventory.region}: ${inventory.total} resource(s).`);
        print(argv, services);
        print(argv, projects, 'No projects.');
    },
});

const projectCommand: CommandModule = {
    command: 'project',
    describe: 'Group resources into projects',
    builder: (yargs: Argv) => yargs
        .options({ output: commonOptions.output, region: commonOptions.region })
        .command(create)
        .command(list)
        .command(get)
        .command(remove)
        .command(use)
        .command(add)
        .command(overview)
        .demandCommand(1, 'Choose an action: create, list, get, delete, use, add, overview'),
    handler: () => {},
};

export default projectCommand;
