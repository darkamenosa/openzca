# Group Poll Commands Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-pass `group poll` commands to `openzca` for creating and managing Zalo group polls using the existing `zca-js` APIs.

**Architecture:** Keep the feature inside the current single-file Commander CLI structure, but extract poll-specific parsing and validation into a focused helper module under `src/lib/`. The CLI should expose a nested `group poll` command tree that delegates to `api.createPoll`, `api.getPollDetail`, `api.votePoll`, `api.lockPoll`, and `api.sharePoll`.

**Tech Stack:** TypeScript, Commander.js, `zca-js`, Node test runner with `tsx`

---

## Chunk 1: Testable Poll Parsing Surface

### Task 1: Add a poll helper module contract

**Files:**
- Create: `src/lib/group-poll.ts`
- Create: `tests/group-poll.test.ts`

- [ ] **Step 1: Write the failing test**

Cover:
- create-poll validation rejects missing question
- create-poll validation rejects fewer than two options
- create-poll validation trims values
- poll id parsing rejects invalid ids
- expire-ms parsing rejects non-positive values

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/group-poll.test.ts`
Expected: FAIL because the helper module does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement helper functions for:
- building validated create-poll payloads
- parsing positive integer poll ids
- parsing optional positive integer expire-ms values

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/group-poll.test.ts`
Expected: PASS

## Chunk 2: CLI Command Surface

### Task 2: Add `group poll` commands

**Files:**
- Modify: `src/cli.ts`
- Create: `tests/cli-group-poll-help.test.ts`

- [ ] **Step 1: Write the failing test**

Cover:
- `group poll --help` lists the expected subcommands
- `group poll create --help` shows the required flags

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/cli-group-poll-help.test.ts`
Expected: FAIL because the commands are not registered yet.

- [ ] **Step 3: Write minimal implementation**

Add nested commands:
- `group poll create <groupId> --question <text> --option <text>...`
- `group poll detail <pollId>`
- `group poll vote <pollId> --option <id>...`
- `group poll lock <pollId>`
- `group poll share <pollId>`

Map flags to existing `zca-js` poll APIs and use the helper module for validation.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/cli-group-poll-help.test.ts`
Expected: PASS

## Chunk 3: Documentation and Verification

### Task 3: Update command reference and run project verification

**Files:**
- Modify: `docs/zca-cli-features-reference.md`

- [ ] **Step 1: Document the new commands**

Add the new `group poll` commands and key create flags to the feature reference.

- [ ] **Step 2: Run targeted tests**

Run:
- `node --import tsx --test tests/group-poll.test.ts`
- `node --import tsx --test tests/cli-group-poll-help.test.ts`

Expected: PASS

- [ ] **Step 3: Run repo verification**

Run:
- `npm run typecheck`
- `npm run build`

Expected: both succeed
