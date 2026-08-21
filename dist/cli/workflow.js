import { access, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import process from 'node:process';
import { AntigravityAdapter, AgyAntigravityTransport, } from '../adapters/antigravity/index.js';
import { createReviewer, loadReviewerConfig } from '../adapters/reviewer/index.js';
import { GitHubClient, NodeCommandRunner } from '../github/index.js';
import { WorkflowCoordinator, ReviewLoopCoordinator } from '../orchestrator/index.js';
import { loadProjectReviewContext } from '../planning/index.js';
import { RunLease } from '../persistence/index.js';
import { StateStore, createInitialState } from '../state/index.js';
function valueAfter(args, flag) {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
}
function positiveInteger(value, fallback, field) {
    if (value === undefined)
        return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0)
        throw new Error(`${field} must be a positive integer.`);
    return parsed;
}
function parseOptions(argv) {
    const command = argv[0];
    if (command !== 'run' && command !== 'status') {
        throw new Error('Usage: ai-workflow <run|status> --task <task.json> [--repo <path>] [--branch <name>] [--base <name>]');
    }
    const taskFile = valueAfter(argv, '--task');
    if (!taskFile)
        throw new Error('--task <task.json> is required.');
    return {
        command,
        taskFile,
        repo: resolve(valueAfter(argv, '--repo') ?? process.cwd()),
        stateFile: valueAfter(argv, '--state-file'),
        branch: valueAfter(argv, '--branch'),
        base: valueAfter(argv, '--base'),
        projectId: valueAfter(argv, '--project-id'),
        overviewFile: valueAfter(argv, '--overview-file'),
        progressFile: valueAfter(argv, '--progress-file'),
        maxIterations: positiveInteger(valueAfter(argv, '--max-iterations'), 5, '--max-iterations'),
        ciTimeoutMs: positiveInteger(valueAfter(argv, '--ci-timeout-ms'), 15 * 60_000, '--ci-timeout-ms'),
        ciPollIntervalMs: positiveInteger(valueAfter(argv, '--ci-poll-ms'), 10_000, '--ci-poll-ms'),
        antigravityAutoApprove: argv.includes('--antigravity-auto-approve') || process.env.ANTIGRAVITY_AUTO_APPROVE === 'true',
    };
}
function requireString(value, field) {
    if (typeof value !== 'string' || !value.trim())
        throw new Error(`${field} must be a non-empty string.`);
    return value;
}
function requireStrings(value, field) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
        throw new Error(`${field} must be an array of non-empty strings.`);
    }
    return value;
}
export function parseTaskContract(value) {
    if (!value || typeof value !== 'object')
        throw new Error('Task contract must be an object.');
    const source = value;
    if (!source.task || typeof source.task !== 'object')
        throw new Error('task must be an object.');
    const task = source.task;
    const acceptanceCriteria = task.acceptanceCriteria ?? task.acceptance_criteria;
    const definitionOfDone = source.definitionOfDone ?? source.definition_of_done;
    return {
        task: {
            id: requireString(task.id, 'task.id'),
            objective: requireString(task.objective, 'task.objective'),
            acceptanceCriteria: requireStrings(acceptanceCriteria, 'task.acceptanceCriteria'),
        },
        constraints: requireStrings(source.constraints ?? [], 'constraints'),
        definitionOfDone: requireStrings(definitionOfDone, 'definitionOfDone'),
        scope: source.scope,
    };
}
function slug(value) {
    const result = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!result)
        throw new Error(`Cannot derive slug from ${value}.`);
    return result;
}
async function existingRelativeFile(repo, explicit, fallback) {
    const candidate = explicit ?? fallback;
    try {
        await access(resolve(repo, candidate));
        return candidate;
    }
    catch {
        if (explicit)
            throw new Error(`Context file does not exist: ${resolve(repo, explicit)}`);
        return undefined;
    }
}
export async function runWorkflowCli(argv = process.argv.slice(2)) {
    const options = parseOptions(argv);
    const taskPath = resolve(options.repo, options.taskFile);
    const task = parseTaskContract(JSON.parse(await readFile(taskPath, 'utf8')));
    const runSlug = slug(task.task.id);
    const statePath = resolve(options.repo, options.stateFile ?? `.ai/runs/${runSlug}/state.json`);
    const stateStore = new StateStore(statePath);
    if (options.command === 'status') {
        console.log(JSON.stringify(await stateStore.load(), null, 2));
        return;
    }
    const lease = new RunLease(resolve(options.repo, `.ai/runs/${runSlug}/lock`), task.task.id, `${process.pid}-${randomUUID()}`, 60_000);
    await lease.acquire();
    let heartbeatError;
    const heartbeat = setInterval(() => {
        void lease.heartbeat().catch((error) => { heartbeatError = error; });
    }, 20_000);
    try {
        try {
            await stateStore.load();
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
            await stateStore.save({ ...createInitialState(), taskId: task.task.id });
        }
        const runner = new NodeCommandRunner();
        const github = new GitHubClient(runner, options.repo);
        const repository = await github.getRepository();
        const baseBranch = options.base ?? repository.defaultBranch ?? 'main';
        const branch = options.branch ?? `codex/${runSlug}`;
        const reviewerConfig = loadReviewerConfig();
        const reviewer = createReviewer(reviewerConfig);
        const cleanRoomReviewer = createReviewer(reviewerConfig);
        const antigravity = new AntigravityAdapter(new AgyAntigravityTransport(runner, {
            cwd: options.repo,
            command: process.env.ANTIGRAVITY_COMMAND ?? 'agy',
            agent: process.env.ANTIGRAVITY_AGENT,
            model: process.env.ANTIGRAVITY_MODEL,
            effort: process.env.ANTIGRAVITY_EFFORT ?? 'high',
            printTimeout: process.env.ANTIGRAVITY_PRINT_TIMEOUT ?? '30m',
            autoApprovePermissions: options.antigravityAutoApprove,
        }));
        const projectId = options.projectId ?? `${repository.owner}/${repository.name}`;
        const overviewFile = await existingRelativeFile(options.repo, options.overviewFile, 'README.md');
        const progressFile = await existingRelativeFile(options.repo, options.progressFile, 'PROJECT_PROGRESS.md');
        const projectContext = await loadProjectReviewContext({
            projectId,
            root: options.repo,
            overviewFile,
            progressFile,
        });
        const cleanRoomContext = {
            ...projectContext,
            projectId: `${projectId}:clean-room`,
            forceNewConversation: true,
        };
        const reviewLoop = new ReviewLoopCoordinator(github, reviewer, cleanRoomReviewer, antigravity, stateStore, {
            maxIterations: options.maxIterations,
            ciTimeoutMs: options.ciTimeoutMs,
            ciPollIntervalMs: options.ciPollIntervalMs,
        });
        const workflow = new WorkflowCoordinator(github, antigravity, reviewLoop, stateStore);
        const result = await workflow.run({
            task,
            branch,
            baseBranch,
            reviewContext: { project: projectContext, cleanRoomProject: cleanRoomContext },
        });
        if (heartbeatError)
            throw heartbeatError;
        console.log(JSON.stringify({ taskId: task.task.id, stateFile: statePath, ...result }, null, 2));
    }
    finally {
        clearInterval(heartbeat);
        await lease.release();
    }
}
