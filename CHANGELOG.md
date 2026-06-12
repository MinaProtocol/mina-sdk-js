# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Trustless block verification. `verifyPrecomputedBlock(precomputed, { network })`
  verifies a block's Pickles/kimchi SNARK proof and returns proof-backed facts
  (`height`, `stateHash`, `previousStateHash`, `stagedLedgerHash`);
  `checkBlockClaims(precomputed, claimed)` and the pure `compareToClaims(facts, claimed)`
  check an untrusted endpoint's claims against the proof. The proof verifier is the
  optional, unbundled `mina-verify-wasm` package, loaded on first use; without it the
  calls throw `VerificationBackendError`. Verification is synchronous and CPU-bound
  (tens of seconds per block today).

## [0.2.3] - 2026-05-21

### Fixed

- npm OIDC trusted publishing from GitHub Actions. The release job runs on Node
  20, which ships npm 10.x; that version signs provenance but cannot perform the
  OIDC -> npm token exchange, so the publish `PUT` was unauthenticated and the
  registry rejected it with a 404. The job now upgrades to `npm@latest`
  (>= 11.5.1) before publishing. This is the first release actually published via
  OIDC trusted publishing (no token, with provenance).

## [0.2.2] - 2026-05-18

### Changed

- Attempted the first OIDC-based publish from GitHub Actions; it failed with a
  404 and was never published to npm. See 0.2.3 for the fix.

## [0.2.1] - 2026-05-18

### Changed

- Package renamed from `mina-sdk` to `@o1-labs/mina-sdk` and moved to the `o1-labs` GitHub organization.
- First version published to npm (published manually with a token).

### Added

- Initial scaffold of the Mina JavaScript SDK.
- `MinaClient` with retry-aware GraphQL transport.
- `Currency` value type backed by `bigint`.
- Daemon queries: `getSyncStatus`, `getDaemonStatus`, `getNetworkId`,
  `getAccount`, `getBestChain`, `getPeers`, `getPooledUserCommands`, `executeQuery`.
- Daemon mutations: `sendPayment`, `sendDelegation`, `setSnarkWorker`, `setSnarkWorkFee`.
- ESM + CJS build via `tsup`; declaration files emitted.
- Vitest unit suite covering `Currency` arithmetic and `MinaClient` transport behaviour.
- GitHub Actions workflows for CI and release-on-tag npm publish (trusted-publisher ready).
