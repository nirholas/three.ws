// Forge Studio pays with the same $THREE sheet as /forge. The copy that lived
// here had drifted: it skipped the real-funds acknowledgment before the sheet
// opened, while /forge skipped the iOS app's hand-off to Safari. One module now
// serves both pages (guarded by tests/forge-studio-drift.test.js).
export * from '../forge-pay.js';
