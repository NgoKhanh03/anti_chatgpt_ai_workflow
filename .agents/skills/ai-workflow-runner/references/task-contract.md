# Task contract

Save one approved implementation unit as JSON. Both camelCase and the documented snake_case aliases are accepted for acceptance criteria and definition of done.

```json
{
  "task": {
    "id": "FEAT-001",
    "objective": "Implement the approved objective",
    "acceptanceCriteria": [
      "Observable acceptance condition"
    ]
  },
  "constraints": [
    "Preserve existing architecture"
  ],
  "definitionOfDone": [
    "lint passes",
    "typecheck passes",
    "tests pass",
    "build passes"
  ],
  "scope": {
    "expectedFiles": ["src/example.ts"],
    "allowedWriteRoots": ["src/", "tests/"]
  }
}
```

Use a stable task ID because it determines the default branch (`codex/<task-id>`) and persisted state path. Keep each task small enough for one reviewable pull request. If a plan contains independent units, run them as separate task contracts in dependency order.
