# Group Chat Mentions Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add outbound `@Name` mention support for group text messages in `openzca msg send --group`.

**Architecture:** Keep mention parsing/resolution in a small pure helper so mention offsets can be tested without a live Zalo session. Reuse a shared group-member lookup path in the CLI, parse mentions against the final plain text after formatting markers are stripped, and pass `mentions` into `api.sendMessage` only for group text sends.

**Tech Stack:** TypeScript, Commander.js, `zca-js`, Node test runner with `tsx`

---

## Chunk 1: Pure Mention Resolution

### Task 1: Add failing tests for outbound mention parsing

**Files:**
- Create: `src/lib/group-mentions.test.ts`
- Test: `src/lib/group-mentions.test.ts`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement minimal mention parsing helper**
- [ ] **Step 4: Run test to verify it passes**

### Task 2: Implement mention parsing and ambiguity handling

**Files:**
- Create: `src/lib/group-mentions.ts`
- Test: `src/lib/group-mentions.test.ts`

- [ ] **Step 1: Add unique-match resolution for `displayName` and `zaloName`**
- [ ] **Step 2: Add longest-match handling for names with spaces**
- [ ] **Step 3: Add ambiguity errors for duplicate display labels**
- [ ] **Step 4: Re-run mention helper tests**

## Chunk 2: CLI Integration

### Task 3: Reuse group-member lookup for mentions

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Extract shared group-member row lookup from `group members`**
- [ ] **Step 2: Reuse the shared helper in the existing `group members` command**
- [ ] **Step 3: Run typecheck to verify the refactor stays sound**

### Task 4: Wire mentions into `msg send --group`

**Files:**
- Modify: `src/cli.ts`
- Modify: `README.md`
- Modify: `docs/zca-cli-features-reference.md`
- Test: `src/lib/group-mentions.test.ts`

- [ ] **Step 1: Build final text/styles as today**
- [ ] **Step 2: Resolve group mentions against the final text**
- [ ] **Step 3: Pass `mentions` to `api.sendMessage` for group text messages**
- [ ] **Step 4: Document the supported `@Name` syntax and ambiguity behavior**
- [ ] **Step 5: Run targeted tests, typecheck, and build**
