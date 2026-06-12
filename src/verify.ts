/**
 * Trustless block verification.
 *
 * Verifies a Mina block's Pickles/kimchi SNARK proof. A block that verifies attests its
 * entire chain history up to that block by Pickles recursion, so this lets a JS client
 * check chain validity against an **untrusted** data source — a node, an indexer, a GCS
 * archive — with no need to trust whoever supplied the bytes.
 *
 * The proof verifier is a WebAssembly module (`mina-verify-wasm`) that is *not* bundled
 * with this SDK (it is several MB). It is loaded lazily on first use; install it
 * alongside this package to enable verification:
 *
 * ```sh
 * npm install mina-verify-wasm
 * ```
 *
 * GraphQL note: a daemon's GraphQL `protocolState` is a *lossy* projection and cannot be
 * re-hashed to verify a proof. The verifiable input is a **precomputed block** (the JSON
 * a daemon publishes to GCS / the archive), which carries the full protocol state.
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Networks with an embedded verification key. */
export type VerifyNetwork = 'devnet' | 'mainnet';

/** Proof-backed facts extracted from a verified block — every field is attested by the
 * proof, so it is safe to trust even though the block came from an untrusted source. */
export interface VerifiedBlock {
  /** Block height (blockchain length). */
  height: number;
  /** This block's state hash ("3N…"). */
  stateHash: string;
  /** Parent block's state hash. */
  previousStateHash: string;
  /** Staged-ledger Merkle root ("jx…"): an indexer's replayed ledger root must equal this. */
  stagedLedgerHash: string;
}

export interface VerifyOptions {
  /** Verification-key network. Default `'devnet'`. */
  network?: VerifyNetwork;
}

/** The block's proof did not verify, or the block JSON could not be decoded. The block
 * must NOT be ingested. */
export class VerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerificationError';
  }
}

/** The optional `mina-verify-wasm` backend is not installed (or failed to load). */
export class VerificationBackendError extends Error {
  constructor(override readonly cause: unknown) {
    super(
      'mina-verify-wasm is required for block verification but could not be loaded. ' +
        'Install it with `npm install mina-verify-wasm`. ' +
        `Underlying error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'VerificationBackendError';
  }
}

interface VerifyBackend {
  verifyPrecomputed(network: string, precomputedJson: string): string;
}

// A non-literal specifier so TypeScript/bundlers don't try to resolve the (optional,
// unbundled) backend at build time — it's resolved at runtime from the host's modules.
const BACKEND_PACKAGE = 'mina-verify-wasm';
let backend: VerifyBackend | undefined;

// Synchronous loader. The `mina-verify-wasm` (nodejs target) package is CommonJS and
// instantiates its wasm synchronously on require, so the whole verify path is sync —
// it just blocks while the (CPU-bound) proof check runs.
//
// Resolve the optional backend from both this module's location (covers a hoisted
// install next to the SDK) and the host process's cwd (covers a backend installed at
// the app root, or an SDK that is symlinked / pnpm-isolated). `import.meta.url` works
// in both the ESM and CJS builds (esbuild shims it for CJS).
function loadBackend(): VerifyBackend {
  if (backend) return backend;
  const bases = [import.meta.url, pathToFileURL(join(process.cwd(), 'noop.js')).href];
  let lastError: unknown;
  for (const base of bases) {
    try {
      const require = createRequire(base);
      const mod = require(BACKEND_PACKAGE) as Record<string, unknown>;
      const inner = (mod.default ?? mod) as Record<string, unknown>;
      if (typeof inner.verifyPrecomputed !== 'function') {
        throw new Error('module does not export verifyPrecomputed');
      }
      backend = inner as unknown as VerifyBackend;
      return backend;
    } catch (cause) {
      lastError = cause;
    }
  }
  throw new VerificationBackendError(lastError);
}

/**
 * Verify a **precomputed block** (the JSON a daemon publishes; the `{ "version", "data" }`
 * form, or a bare block object) and return its proof-backed facts.
 *
 * Synchronous and **blocking**: the proof check is CPU-bound and currently takes tens of
 * seconds, during which it holds the event loop. Run it off the main thread (a worker) if
 * the host must stay responsive.
 *
 * @throws {VerificationError} if the proof does not verify or the JSON is malformed.
 * @throws {VerificationBackendError} if `mina-verify-wasm` is not installed.
 */
export function verifyPrecomputedBlock(
  precomputed: string | object,
  options: VerifyOptions = {},
): VerifiedBlock {
  const network = options.network ?? 'devnet';
  const json = typeof precomputed === 'string' ? precomputed : JSON.stringify(precomputed);
  const backend = loadBackend();
  let raw: string;
  try {
    raw = backend.verifyPrecomputed(network, json);
  } catch (cause) {
    // The wasm rejects an invalid proof / undecodable block by throwing a string.
    throw new VerificationError(cause instanceof Error ? cause.message : String(cause));
  }
  return JSON.parse(raw) as VerifiedBlock;
}

/** The result of checking an endpoint's claims against proof-backed facts. */
export interface HonestyResult {
  /** True iff every claimed field matched the proof-backed facts. */
  honest: boolean;
  /** The proof-backed facts (authoritative). */
  facts: VerifiedBlock;
  /** Fields where the claim disagreed with the proof — empty iff `honest`. */
  mismatches: Array<{ field: keyof VerifiedBlock; claimed: unknown; actual: unknown }>;
}

/**
 * Compare an endpoint's claimed block facts to proof-backed facts (pure; no I/O).
 * Only fields present in `claimed` are checked. A non-empty `mismatches` proves the
 * source lied about that field relative to what the proof attests.
 */
export function compareToClaims(
  facts: VerifiedBlock,
  claimed: Partial<VerifiedBlock>,
): HonestyResult {
  const mismatches: HonestyResult['mismatches'] = [];
  for (const key of Object.keys(claimed) as Array<keyof VerifiedBlock>) {
    const claim = claimed[key];
    if (claim === undefined) continue;
    if (claim !== facts[key]) {
      mismatches.push({ field: key, claimed: claim, actual: facts[key] });
    }
  }
  return { honest: mismatches.length === 0, facts, mismatches };
}

/**
 * Verify a precomputed block and check an untrusted source's claims about it against the
 * proof-backed facts — the endpoint-honesty primitive. `honest: false` means the source
 * served data inconsistent with what the SNARK proof attests.
 *
 * Synchronous and blocking — see {@link verifyPrecomputedBlock}.
 *
 * @throws {VerificationError} if the proof does not verify.
 * @throws {VerificationBackendError} if `mina-verify-wasm` is not installed.
 */
export function checkBlockClaims(
  precomputed: string | object,
  claimed: Partial<VerifiedBlock>,
  options: VerifyOptions = {},
): HonestyResult {
  const facts = verifyPrecomputedBlock(precomputed, options);
  return compareToClaims(facts, claimed);
}
