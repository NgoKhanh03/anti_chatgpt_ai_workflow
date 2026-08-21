export interface DependencyNode {
  id: string;
  dependencies: string[];
}

export class DependencyGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DependencyGraphError';
  }
}

export function topologicalSort<T extends DependencyNode>(nodes: T[]): T[] {
  const byId = new Map<string, T>();
  for (const node of nodes) {
    if (byId.has(node.id)) throw new DependencyGraphError(`Duplicate dependency node: ${node.id}`);
    byId.set(node.id, node);
  }

  for (const node of nodes) {
    for (const dependency of node.dependencies) {
      if (!byId.has(dependency)) {
        throw new DependencyGraphError(`${node.id} depends on missing node ${dependency}`);
      }
      if (dependency === node.id) throw new DependencyGraphError(`${node.id} cannot depend on itself`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: T[] = [];

  const visit = (node: T, path: string[]): void => {
    if (visited.has(node.id)) return;
    if (visiting.has(node.id)) {
      throw new DependencyGraphError(`Dependency cycle detected: ${[...path, node.id].join(' -> ')}`);
    }
    visiting.add(node.id);
    for (const dependency of node.dependencies) visit(byId.get(dependency)!, [...path, node.id]);
    visiting.delete(node.id);
    visited.add(node.id);
    ordered.push(node);
  };

  for (const node of nodes) visit(node, []);
  return ordered;
}
