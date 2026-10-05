import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export interface Project {
    name: string;
    created: string;
}

export interface ProjectStore {
    current?: string;
    projects: Project[];
}

export const PROJECT_TAG = 'clover:project';

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function projectsFile(env: NodeJS.ProcessEnv = process.env): string {
    const configHome = env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
    return path.join(configHome, 'clover', 'projects.json');
}

export function loadProjects(file = projectsFile()): ProjectStore {
    if (!existsSync(file)) return { projects: [] };
    const store: ProjectStore = JSON.parse(readFileSync(file, 'utf8'));
    return store;
}

function saveProjects(store: ProjectStore, file: string): void {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`);
}

function findProject(store: ProjectStore, name: string): Project {
    const project = store.projects.find((p) => p.name === name);
    if (!project) throw new Error(`Unknown project "${name}". Create it with: clover project create ${name}`);
    return project;
}

export function createProject(name: string, file = projectsFile()): Project {
    if (!NAME_PATTERN.test(name)) {
        throw new Error(`Invalid project name "${name}". Use lowercase letters, digits and dashes (up to 63).`);
    }
    const store = loadProjects(file);
    if (store.projects.some((p) => p.name === name)) throw new Error(`Project "${name}" already exists.`);
    const project = { name, created: new Date().toISOString() };
    saveProjects({ ...store, projects: [...store.projects, project] }, file);
    return project;
}

export function getProject(name: string, file = projectsFile()): Project {
    return findProject(loadProjects(file), name);
}

export function deleteProject(name: string, file = projectsFile()): void {
    const store = loadProjects(file);
    findProject(store, name);
    saveProjects({
        current: store.current === name ? undefined : store.current,
        projects: store.projects.filter((p) => p.name !== name),
    }, file);
}

/** Sets the current project; undefined clears it. */
export function useProject(name: string | undefined, file = projectsFile()): void {
    const store = loadProjects(file);
    if (name !== undefined) findProject(store, name);
    saveProjects({ ...store, current: name }, file);
}

export function resolveProject(name?: string, file = projectsFile()): string | undefined {
    if (name) return findProject(loadProjects(file), name).name;
    return loadProjects(file).current;
}
