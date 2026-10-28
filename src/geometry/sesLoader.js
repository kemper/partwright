// Loads the SES shim (#1127). A plain-JS hop so TypeScript never type-loads the
// `ses` package: its types pull in @endo/immutable-arraybuffer, whose global
// ArrayBuffer augmentation breaks existing typed-array assignments across the
// codebase. Importing this module installs `lockdown`, `harden`, `Compartment`
// and `assert` on globalThis; sesSandbox.ts captures them privately.
import 'ses';
