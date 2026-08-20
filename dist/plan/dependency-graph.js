export class DependencyGraphError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DependencyGraphError';
    }
}
export function topologicalSort(nodes) {
    const byId = new Map();
    for (const node of nodes) {
        if (byId.has(node.id))
            throw new DependencyGraphError(`Duplicate dependency node: ${node.id}`);
        byId.set(node.id, node);
    }
    for (const node of nodes) {
        for (const dependency of node.dependencies) {
            if (!byId.has(dependency)) {
                throw new DependencyGraphError(`${node.id} depends on missing node ${dependency}`);
            }
            if (dependency === node.id)
                throw new DependencyGraphError(`${node.id} cannot depend on itself`);
        }
    }
    const visiting = new Set();
    const visited = new Set();
    const ordered = [];
    const visit = (node, path) => {
        if (visited.has(node.id))
            return;
        if (visiting.has(node.id)) {
            throw new DependencyGraphError(`Dependency cycle detected: ${[...path, node.id].join(' -> ')}`);
        }
        visiting.add(node.id);
        for (const dependency of node.dependencies)
            visit(byId.get(dependency), [...path, node.id]);
        visiting.delete(node.id);
        visited.add(node.id);
        ordered.push(node);
    };
    for (const node of nodes)
        visit(node, []);
    return ordered;
}
