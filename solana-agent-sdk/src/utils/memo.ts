import { PublicKey, TransactionInstruction } from "@solana/web3.js";

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export function memoInstruction(memo: string, signerPublicKeys: PublicKey[] = []): TransactionInstruction {
  const data = Buffer.from(memo, "utf-8");
  return new TransactionInstruction({
    keys: signerPublicKeys.map((pk) => ({ pubkey: pk, isSigner: true, isWritable: false })),
    programId: MEMO_PROGRAM_ID,
    data,
  });
}
