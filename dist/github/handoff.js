export function renderHandoffMarkdown(packet) {
    const { repository, pullRequest, diff } = packet;
    const files = diff.files
        .map((file) => `- ${file.path} (+${file.additions} / -${file.deletions})`)
        .join('\n');
    return [
        '# PR Review Handoff',
        '',
        `Repository: ${repository.owner}/${repository.name}`,
        `PR: #${pullRequest.number} — ${pullRequest.title}`,
        `Branch: ${pullRequest.headRefName} -> ${pullRequest.baseRefName}`,
        `Commit Range: ${pullRequest.baseSha}..${pullRequest.headSha}`,
        `CI: ${pullRequest.ciState}`,
        `URL: ${pullRequest.url}`,
        '',
        '## Files Changed',
        files || '- None',
        '',
        '## PR Description',
        pullRequest.body || '(empty)',
        '',
        '## Diff',
        '```diff',
        diff.patch,
        '```',
    ].join('\n');
}
