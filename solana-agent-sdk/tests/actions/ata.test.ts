import {
  Keypair,
  PublicKey,
  type Connection,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { getOrCreateAta } from "../../src/actions/ata.js";
import { buildAndSend } from "../../src/tx/build.js";

jest.mock("../../src/tx/build.js", () => ({ buildAndSend: jest.fn() }));

const mockBuildAndSend = jest.mocked(buildAndSend);

// Deterministic test keys
const WALLET_PUBKEY = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey;
const CUSTOM_OWNER = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey;
const MINT_PUBKEY = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey;

const FAKE_ACCOUNT = { data: Buffer.alloc(0), executable: false, lamports: 1, owner: TOKEN_PROGRAM_ID } as any;

const wallet = {
  publicKey: WALLET_PUBKEY,
  signTransaction: jest.fn(),
  signAndSendTransaction: jest.fn(),
};

function makeConnection(ataExists: boolean) {
  return {
    getAccountInfo: jest.fn().mockResolvedValue(ataExists ? FAKE_ACCOUNT : null),
  } as unknown as Connection;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBuildAndSend.mockResolvedValue("fakeSig");
});

describe("getOrCreateAta", () => {
  it("returns { ata, signature: undefined } when ATA already exists", async () => {
    const connection = makeConnection(true);
    const result = await getOrCreateAta(wallet, connection, { mint: MINT_PUBKEY });

    expect(result.signature).toBeUndefined();
    expect(mockBuildAndSend).not.toHaveBeenCalled();

    const expectedAta = getAssociatedTokenAddressSync(
      MINT_PUBKEY, WALLET_PUBKEY, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    expect(result.ata.equals(expectedAta)).toBe(true);
  });

  it("calls buildAndSend and returns signature when ATA does not exist", async () => {
    const connection = makeConnection(false);
    const result = await getOrCreateAta(wallet, connection, { mint: MINT_PUBKEY });

    expect(mockBuildAndSend).toHaveBeenCalledTimes(1);
    expect(result.signature).toBe("fakeSig");
  });

  it("sends createAssociatedTokenAccountInstruction when ATA does not exist", async () => {
    const connection = makeConnection(false);
    await getOrCreateAta(wallet, connection, { mint: MINT_PUBKEY });

    const [, , instructions] = mockBuildAndSend.mock.calls[0];
    expect(instructions).toHaveLength(1);
    expect(instructions[0].programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true);
  });

  it("uses wallet.publicKey as owner by default", async () => {
    const connection = makeConnection(false);
    const result = await getOrCreateAta(wallet, connection, { mint: MINT_PUBKEY });

    const expectedAta = getAssociatedTokenAddressSync(
      MINT_PUBKEY, WALLET_PUBKEY, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    expect(result.ata.equals(expectedAta)).toBe(true);
  });

  it("uses provided owner instead of wallet.publicKey", async () => {
    const connection = makeConnection(false);
    const result = await getOrCreateAta(wallet, connection, {
      mint: MINT_PUBKEY,
      owner: CUSTOM_OWNER,
    });

    const expectedAta = getAssociatedTokenAddressSync(
      MINT_PUBKEY, CUSTOM_OWNER, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    expect(result.ata.equals(expectedAta)).toBe(true);
  });
});
