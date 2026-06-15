#!/usr/bin/env bash
# Emits the e2e shard matrix as `matrix=<json>` on $GITHUB_OUTPUT. Shared by
# e2e.yml and e2e-ui.yml (they differ only in NUM_SHARDS).
#
# Returns an EMPTY matrix ({"include":[]}) when the run should be skipped:
#   - draft PRs, or
#   - a fork's pull_request (no secrets there; forks run via the fork-e2e/**
#     mirror push instead).
# An empty matrix yields zero jobs and therefore NO check-runs. This is the
# whole reason for the indirection: a job-level `if:` skip of a matrixed job
# would instead leave one check-run with an unexpanded
# `E2E Tests (shard ${{ matrix.shard_id }}/...)` name.
#
# Env in:  EVENT_NAME (github.event_name), IS_DRAFT, IS_FORK (both may be empty
#          on non-PR events), NUM_SHARDS.
#          EXTRA_SKIP (optional): when "true", force an empty matrix. e2e-ui.yml
#          sets this to skip a push to main that didn't touch ap-web/**; e2e.yml
#          never sets it, so its behavior is unchanged.
# Out:     matrix={"include":[{"shard_id":0,"num_shards":N}, ...]}  (or [] empty)

set -euo pipefail

skip=false
if [[ "${IS_DRAFT:-false}" == "true" ]]; then
  skip=true
fi
if [[ "$EVENT_NAME" == "pull_request" && "${IS_FORK:-false}" == "true" ]]; then
  skip=true
fi
if [[ "${EXTRA_SKIP:-false}" == "true" ]]; then
  skip=true
fi

if [[ "$skip" == "true" ]]; then
  echo 'matrix={"include":[]}' >> "$GITHUB_OUTPUT"
  echo "skip: empty matrix (event=$EVENT_NAME draft=${IS_DRAFT:-} fork=${IS_FORK:-} extra_skip=${EXTRA_SKIP:-})"
  exit 0
fi

inc=""
for ((i = 0; i < NUM_SHARDS; i++)); do
  inc+="{\"shard_id\":$i,\"num_shards\":$NUM_SHARDS},"
done
echo "matrix={\"include\":[${inc%,}]}" >> "$GITHUB_OUTPUT"
echo "run: $NUM_SHARDS shards (event=$EVENT_NAME)"
