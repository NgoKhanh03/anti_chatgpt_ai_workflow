#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
workflow_root="$(cd "${script_dir}/../../../.." && pwd)"
target_repo="$(pwd)"

for ((index = 1; index <= $#; index += 1)); do
  if [[ "${!index}" == "--repo" ]]; then
    next=$((index + 1))
    target_repo="$(cd "${!next}" && pwd)"
  fi
done

reviewer_transport="${REVIEWER_TRANSPORT:-browser}"
agent_url="${CHATGPT_AGENT_URL:-http://127.0.0.1:4317}"
if [[ "${reviewer_transport}" == "browser" ]] && ! curl --silent --fail "${agent_url}/health" >/dev/null 2>&1; then
  mkdir -p "${target_repo}/.ai"
  (
    cd "${workflow_root}"
    CHATGPT_CONVERSATION_STORE="${target_repo}/.ai/project-conversations.json" \
      npm run browser:agent >>"${target_repo}/.ai/browser-agent.log" 2>&1 &
  )
  for _ in {1..30}; do
    if curl --silent --fail "${agent_url}/health" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if ! curl --silent --fail "${agent_url}/health" >/dev/null 2>&1; then
    echo "ChatGPT browser agent did not become healthy. See ${target_repo}/.ai/browser-agent.log" >&2
    exit 1
  fi
fi

cd "${workflow_root}"
npm run workflow -- run --repo "${target_repo}" "$@"
