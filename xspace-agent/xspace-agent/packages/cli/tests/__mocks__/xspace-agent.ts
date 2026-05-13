// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent) [§73]

// Stub module for xspace-agent so vitest can resolve the import.
// Tests override this with vi.mock().
export class XSpaceAgent {
  constructor(_opts: any) {}
  async join(_url: string) {}
  async leave() {}
  on(_event: string, _handler: Function) {}
}


