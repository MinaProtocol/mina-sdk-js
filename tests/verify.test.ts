import { describe, expect, it, vi } from 'vitest';
import {
  compareToClaims,
  verifyPrecomputedBlock,
  VerificationBackendError,
  type VerifiedBlock,
} from '../src/index.js';

// Force the optional wasm backend to be unavailable, so the "backend missing" path is
// tested deterministically whether or not `mina-verify-wasm` happens to be installed.
vi.mock('mina-verify-wasm', () => {
  throw new Error("Cannot find module 'mina-verify-wasm'");
});

const FACTS: VerifiedBlock = {
  height: 526824,
  stateHash: '3NLJdkAD23h8a8y87bdGwqfkuFdnqAg1GVahEWdhtSBpfXrgwNzw',
  previousStateHash: '3NKpcYv7raSh3wAkNCevTPzFQMdja3LUWwfFLaaDadwNwzUj5DGV',
  stagedLedgerHash: 'jxBSBGmRE3TZvQUGUwURzWVqnAZmkYfBMbayLZ692gwb3H6p6Aj',
};

describe('compareToClaims', () => {
  it('is honest when every claimed field matches', () => {
    const r = compareToClaims(FACTS, {
      height: 526824,
      stateHash: FACTS.stateHash,
    });
    expect(r.honest).toBe(true);
    expect(r.mismatches).toEqual([]);
    expect(r.facts).toBe(FACTS);
  });

  it('only checks fields that are present in the claim', () => {
    expect(compareToClaims(FACTS, {}).honest).toBe(true);
    expect(compareToClaims(FACTS, { stagedLedgerHash: FACTS.stagedLedgerHash }).honest).toBe(true);
  });

  it('flags a lying source and reports the offending field', () => {
    const r = compareToClaims(FACTS, { stateHash: '3NLieToTheClient', height: 526824 });
    expect(r.honest).toBe(false);
    expect(r.mismatches).toHaveLength(1);
    expect(r.mismatches[0]).toMatchObject({
      field: 'stateHash',
      claimed: '3NLieToTheClient',
      actual: FACTS.stateHash,
    });
  });

  it('reports every mismatched field', () => {
    const r = compareToClaims(FACTS, { height: 1, stagedLedgerHash: 'jxWRONG' });
    expect(r.honest).toBe(false);
    expect(r.mismatches.map((m) => m.field).sort()).toEqual(['height', 'stagedLedgerHash']);
  });
});

describe('verifyPrecomputedBlock', () => {
  it('throws VerificationBackendError when mina-verify-wasm is not installed', async () => {
    // The wasm backend is an optional, unbundled dependency; in CI it is absent.
    await expect(verifyPrecomputedBlock('{}')).rejects.toBeInstanceOf(VerificationBackendError);
  });
});
