import { Program, BN, EventParser } from '@coral-xyz/anchor';
import { Connection, PublicKey, TransactionInstruction, AccountMeta, Commitment } from '@solana/web3.js';
import { PumpAgentPaymentsPlugin } from './solana/solana-agent-kit/index.js';
import { i as index$2 } from './index-cHxulSFy.js';

/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/pump_agent_payments.json`.
 */
type PumpAgentPayments = {
    address: "AgenTMiC2hvxGebTsgmsD4HHBa8WEcqGFf87iwRRxLo7";
    metadata: {
        name: "pumpAgentPayments";
        version: "0.1.0";
        spec: "0.1.0";
        description: "Created with Anchor";
    };
    instructions: [
        {
            name: "agentAcceptPayment";
            discriminator: [34, 157, 64, 220, 74, 32, 48, 225];
            accounts: [
                {
                    name: "user";
                    writable: true;
                    signer: true;
                },
                {
                    name: "userTokenAccount";
                    writable: true;
                },
                {
                    name: "tokenAgentPayments";
                },
                {
                    name: "tokenAgentAssociatedAccount";
                    writable: true;
                    pda: {
                        seeds: [
                            {
                                kind: "account";
                                path: "tokenAgentPayments";
                            },
                            {
                                kind: "const";
                                value: [6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169];
                            },
                            {
                                kind: "account";
                                path: "currencyMint";
                            }
                        ];
                        program: {
                            kind: "const";
                            value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
                        };
                    };
                },
                {
                    name: "tokenAgentPaymentInCurrency";
                    writable: true;
                    pda: {
                        seeds: [
                            {
                                kind: "const";
                                value: [112, 97, 121, 109, 101, 110, 116, 45, 105, 110, 45, 99, 117, 114, 114, 101, 110, 99, 121];
                            },
                            {
                                kind: "account";
                                path: "tokenAgentPayments.mint";
                                account: "TokenAgentPayments";
                            },
                            {
                                kind: "account";
                                path: "currencyMint";
                            }
                        ];
                    };
                },
                {
                    name: "globalConfig";
                    pda: {
                        seeds: [{
                            kind: "const";
                            value: [103, 108, 111, 98, 97, 108, 45, 99, 111, 110, 102, 105, 103];
                        }];
                    };
                },
                {
                    name: "invoiceId";
                },
                {
                    name: "currencyMint";
                },
                {
                    name: "tokenProgram";
                },
                {
                    name: "associatedTokenProgram";
                    address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
                },
                {
                    name: "systemProgram";
                    address: "11111111111111111111111111111111";
                },
                {
                    name: "eventAuthority";
                    pda: {
                        seeds: [{
                            kind: "const";
                            value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121];
                        }];
                    };
                },
                {
                    name: "program";
                }
            ];
            args: [
                {
                    name: "amount";
                    type: "u64";
                },
                {
                    name: "memo";
                    type: "u64";
                },
                {
                    name: "startTime";
                    type: "i64";
                },
                {
                    name: "endTime";
                    type: "i64";
                }
            ];
        },
        {
            name: "agentBuybackTrigger";
            discriminator: [95, 231, 193, 2, 245, 75, 125, 155];
            accounts: [
                {
                    name: "globalBuybackAuthority";
                    writable: true;
                    signer: true;
                },
                {
                    name: "mint";
                    writable: true;
                },
                {
                    name: "tokenAgentPayments";
                    pda: {
                        seeds: [
                            {
                                kind: "const";
                                value: [116, 111, 107, 101, 110, 45, 97, 103, 101, 110, 116, 45, 112, 97, 121, 109, 101, 110, 116, 115];
                            },
                            {
                                kind: "account";
                                path: "mint";
                            }
                        ];
                    };
                },
                {
                    name: "tokenAgentPaymentInCurrency";
                    writable: true;
                    pda: {
                        seeds: [
                            {
                                kind: "const";
                                value: [112, 97, 121, 109, 101, 110, 116, 45, 105, 110, 45, 99, 117, 114, 114, 101, 110, 99, 121];
                            },
                            {
                                kind: "account";
                                path: "tokenAgentPayments.mint";
                                account: "TokenAgentPayments";
                            },
                            {
                                kind: "account";
                                path: "currencyMint";
                            }
                        ];
                    };
                },
                {
                    name: "currencyMint";
                },
                {
                    name: "globalConfig";
                    pda: {
                        seeds: [{
                            kind: "const";
                            value: [103, 108, 111, 98, 97, 108, 45, 99, 111, 110, 102, 105, 103];
                        }];
                    };
                },
                {
                    name: "swapProgramToInvoke";
                },
                {
                    name: "burnAuthority";
                    docs: ["Intentionally called burn_authority", "TO avoid any confusion with the global buyback authority."];
                    writable: true;
                    pda: {
                        seeds: [
                            {
                                kind: "const";
                                value: [98, 117, 121, 98, 97, 99, 107, 45, 97, 117, 116, 104, 111, 114, 105, 116, 121];
                            },
                            {
                                kind: "account";
                                path: "tokenAgentPayments.mint";
                                account: "TokenAgentPayments";
                            }
                        ];
                    };
                },
                {
                    name: "burnMintVault";
                    writable: true;
                    pda: {
                        seeds: [
                            {
                                kind: "account";
                                path: "burnAuthority";
                            },
                            {
                                kind: "account";
                                path: "tokenProgram";
                            },
                            {
                                kind: "account";
                                path: "mint";
                            }
                        ];
                        program: {
                            kind: "const";
                            value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
                        };
                    };
                },
                {
                    name: "burnCurrencyMintVault";
                    writable: true;
                    pda: {
                        seeds: [
                            {
                                kind: "account";
                                path: "burnAuthority";
                            },
                            {
                                kind: "account";
                                path: "tokenProgramCurrency";
                            },
                            {
                                kind: "account";
                                path: "currencyMint";
                            }
                        ];
                        program: {
                            kind: "const";
                            value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
                        };
                    };
                },
                {
                    name: "tokenProgram";
                },
                {
                    name: "tokenProgramCurrency";
                },
                {
                    name: "associatedTokenProgram";
                    address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
                },
                {
                    name: "systemProgram";
                    address: "11111111111111111111111111111111";
                },
                {
                    name: "eventAuthority";
                    pda: {
                        seeds: [{
                            kind: "const";
                            value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121];
                        }];
                    };
                },
                {
                    name: "program";
                }
            ];
            args: [{
                name: "swapInstructionData";
                type: "bytes";
            }];
        },
        {
            name: "agentDistributePayments";
            discriminator: [145, 44, 246, 47, 192, 204, 95, 32];
            accounts: [
                {
                    name: "user";
                    writable: true;
                    signer: true;
                },
                {
                    name: "globalConfig";
                    pda: {
                        seeds: [{
                            kind: "const";
                            value: [103, 108, 111, 98, 97, 108, 45, 99, 111, 110, 102, 105, 103];
                        }];
                    };
                },
                {
                    name: "currencyMint";
                },
                {
                    name: "tokenAgentPayments";
                    writable: true;
                },
                {
                    name: "tokenAgentPaymentInCurrency";
                    writable: true;
                    pda: {
                        seeds: [
                            {
                                kind: "const";
                                value: [112, 97, 121, 109, 101, 110, 116, 45, 105, 110, 45, 99, 117, 114, 114, 101, 110, 99, 121];
                            },
                            {
                                kind: "account";
                                path: "tokenAgentPayments.mint";
                                account: "TokenAgentPayments";
                            },
                            {
                                kind: "account";
                                path: "currencyMint";
                            }
                        ];
                    };
                },
                {
                    name: "tokenAgentAssociatedAccount";
                    writable: true;
                    pda: {
                        seeds: [
                            {
                                kind: "account";
                                path: "tokenAgentPayments";
                            },
                            {
                                kind: "const";
                                value: [6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169];
                            },
                            {
                                kind: "account";
                                path: "currencyMint";
                            }
                        ];
                        program: {
                            kind: "const";
                            value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
                        };
                    };
                },
                {
                    name: "buybackAuthority";
                    pda: {
                        seeds: [
                            {
                                kind: "const";
                                value: [98, 117, 121, 98, 97, 99, 107, 45, 97, 117, 116, 104, 111, 114, 105, 116, 121];
                            },
                            {
                                kind: "account";
                                path: "tokenAgentPayments.mint";
                                account: "TokenAgentPayments";
                            }
                        ];
                    };
                },
                {
                    name: "withdrawAuthority";
                    pda: {
                        seeds: [
                            {
                                kind: "const";
                                value: [119, 105, 116, 104, 100, 114, 97, 119, 45, 97, 117, 116, 104, 111, 114, 105, 116, 121];
                            },
                            {
                                kind: "account";
                                path: "tokenAgentPayments.mint";
                                account: "TokenAgentPayments";
                            }
                        ];
                    };
                },
                {
                    name: "buybackVault";
                    writable: true;
                    pda: {
                        seeds: [
                            {
                                kind: "account";
                                path: "buybackAuthority";
                            },
                            {
                                kind: "const";
                                value: [6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169];
                            },
                            {
                                kind: "account";
                                path: "currencyMint";
                            }
                        ];
                        program: {
                            kind: "const";
                            value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
                        };
                    };
                },
                {
                    name: "withdrawVault";
                    writable: true;
                    pda: {
                        seeds: [
                            {
                                kind: "account";
                                path: "withdrawAuthority";
                            },
                            {
                                kind: "const";
                                value: [6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169];
                            },
                            {
                                kind: "account";
                                path: "currencyMint";
                            }
                        ];
                        program: {
                            kind: "const";
                            value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
                        };
                    };
                },
                {
                    name: "tokenProgram";
                },
                {
                    name: "associatedTokenProgram";
                    address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
                },
                {
                    name: "systemProgram";
                    address: "11111111111111111111111111111111";
                },
                {
                    name: "eventAuthority";
                    pda: {
                        seeds: [{
                            kind: "const";
                            value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121];
                        }];
                    };
                },
                {
                    name: "program";
                }
            ];
            args: [];
        },
        {
            name: "agentInitialize";
            discriminator: [180, 248, 163, 8, 49, 94, 126, 96];
            accounts: [
                {
                    name: "authority";
                    writable: true;
                    signer: true;
                },
                {
                    name: "bondingCurve";
                    pda: {
                        seeds: [
                            {
                                kind: "const";
                                value: [98, 111, 110, 100, 105, 110, 103, 45, 99, 117, 114, 118, 101];
                            },
                            {
                                kind: "account";
                                path: "mint";
                            }
                        ];
                        program: {
                            kind: "const";
                            value: [1, 86, 224, 246, 147, 102, 90, 207, 68, 219, 21, 104, 191, 23, 91, 170, 81, 137, 203, 151, 245, 210, 255, 59, 101, 93, 43, 182, 253, 109, 24, 176];
                        };
                    };
                },
                {
                    name: "globalConfig";
                    writable: true;
                    pda: {
                        seeds: [{
                            kind: "const";
                            value: [103, 108, 111, 98, 97, 108, 45, 99, 111, 110, 102, 105, 103];
                        }];
                    };
                },
                {
                    name: "mint";
                },
                {
                    name: "tokenAgentPayments";
                    writable: true;
                    pda: {
                        seeds: [
                            {
                                kind: "const";
                                value: [116, 111, 107, 101, 110, 45, 97, 103, 101, 110, 116, 45, 112, 97, 121, 109, 101, 110, 116, 115];
                            },
                            {
                                kind: "account";
                                path: "mint";
                            }
                        ];
                    };
                },
                {
                    name: "systemProgram";
                    address: "11111111111111111111111111111111";
                },
                {
                    name: "eventAuthority";
                    pda: {
                        seeds: [{
                            kind: "const";
                            value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121];
                        }];
                    };
                },
                {
                    name: "program";
                }
            ];
            args: [
                {
                    name: "authority";
                    type: "pubkey";
                },
                {
                    name: "buybackBps";
                    type: "u16";
                }
            ];
        },
        {
            name: "agentTransferExtraLamports";
            discriminator: [39, 206, 214, 167, 55, 44, 221, 81];
            accounts: [
                {
                    name: "tokenAgentPayments";
                    writable: true;
                    pda: {
                        seeds: [
                            {
                                kind: "const";
                                value: [116, 111, 107, 101, 110, 45, 97, 103, 101, 110, 116, 45, 112, 97, 121, 109, 101, 110, 116, 115];
                            },
                            {
                                kind: "account";
                                path: "tokenAgentPayments.mint";
                                account: "TokenAgentPayments";
                            }
                        ];
                    };
                },
                {
                    name: "tokenAgentAssociatedAccount";
                    writable: true;
                    pda: {
                        seeds: [
                            {
                                kind: "account";
                                path: "tokenAgentPayments";
                            },
                            {
                                kind: "const";
                                value: [6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169];
                            },
                            {
                                kind: "const";
                                value: [6, 155, 136, 87, 254, 171, 129, 132, 251, 104, 127, 99, 70, 24, 192, 53, 218, 196, 57, 220, 26, 235, 59, 85, 152, 160, 240, 0, 0, 0, 0, 1];
                            }
                        ];
                        program: {
                            kind: "const";
                            value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
                        };
                    };
                }
            ];
            args: [];
        },
        {
            name: "agentUpdateAuthority";
            discriminator: [237, 228, 227, 224, 226, 198, 167, 83];
            accounts: [
                {
                    name: "authority";
                    writable: true;
                    signer: true;
                },
                {
                    name: "globalConfig";
                    pda: {
                        seeds: [{
                            kind: "const";
                            value: [103, 108, 111, 98, 97, 108, 45, 99, 111, 110, 102, 105, 103];
                        }];
                    };
                },
                {
                    name: "tokenAgentPayments";
                    writable: true;
                },
                {
                    name: "systemProgram";
                    address: "11111111111111111111111111111111";
                },
                {
                    name: "eventAuthority";
                    pda: {
                        seeds: [{
                            kind: "const";
                            value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121];
                        }];
                    };
                },
                {
                    name: "program";
                }
            ];
            args: [{
                name: "newAuthority";
                type: "pubkey";
            }];
        },
        {
            name: "agentUpdateBuybackBps";
            discriminator: [41, 28, 118, 90, 53, 24, 63, 160];
            accounts: [
                {
                    name: "authority";
                    writable: true;
                    signer: true;
                },
                {
                    name: "tokenAgentPayments";
                    writable: true;
                },
                {
                    name: "globalConfig";
                    pda: {
                        seeds: [{
                            kind: "const";
                            value: [103, 108, 111, 98, 97, 108, 45, 99, 111, 110, 102, 105, 103];
                        }];
                    };
                },
                {
                    name: "eventAuthority";
                    pda: {
                        seeds: [{
                            kind: "const";
                            value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121];
                        }];
                    };
                },
                {
                    name: "program";
                }
            ];
            args: [{
                name: "buybackBps";
                type: "u16";
            }];
        },
        {
            name: "agentWithdraw";
            discriminator: [13, 149, 99, 245, 171, 171, 185, 53];
            accounts: [
                {
                    name: "authority";
                    writable: true;
                    signer: true;
                },
                {
                    name: "tokenAgentPayments";
                },
                {
                    name: "currencyMint";
                },
                {
                    name: "withdrawAuthority";
                    pda: {
                        seeds: [
                            {
                                kind: "const";
                                value: [119, 105, 116, 104, 100, 114, 97, 119, 45, 97, 117, 116, 104, 111, 114, 105, 116, 121];
                            },
                            {
                                kind: "account";
                                path: "tokenAgentPayments.mint";
                                account: "TokenAgentPayments";
                            }
                        ];
                    };
                },
                {
                    name: "withdrawVault";
                    writable: true;
                    pda: {
                        seeds: [
                            {
                                kind: "account";
                                path: "withdrawAuthority";
                            },
                            {
                                kind: "const";
                                value: [6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169];
                            },
                            {
                                kind: "account";
                                path: "currencyMint";
                            }
                        ];
                        program: {
                            kind: "const";
                            value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89];
                        };
                    };
                },
                {
                    name: "receiverAta";
                    writable: true;
                },
                {
                    name: "tokenProgram";
                },
                {
                    name: "associatedTokenProgram";
                    address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
                },
                {
                    name: "systemProgram";
                    address: "11111111111111111111111111111111";
                },
                {
                    name: "eventAuthority";
                    pda: {
                        seeds: [{
                            kind: "const";
                            value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121];
                        }];
                    };
                },
                {
                    name: "program";
                }
            ];
            args: [];
        },
        {
            name: "closeAccount";
            discriminator: [125, 255, 149, 14, 110, 34, 72, 24];
            accounts: [
                {
                    name: "account";
                    writable: true;
                },
                {
                    name: "user";
                    writable: true;
                    signer: true;
                },
                {
                    name: "globalConfig";
                    pda: {
                        seeds: [{
                            kind: "const";
                            value: [103, 108, 111, 98, 97, 108, 45, 99, 111, 110, 102, 105, 103];
                        }];
                    };
                },
                {
                    name: "systemProgram";
                    address: "11111111111111111111111111111111";
                }
            ];
            args: [];
        },
        {
            name: "extendAccount";
            discriminator: [234, 102, 194, 203, 150, 72, 62, 229];
            accounts: [
                {
                    name: "account";
                    writable: true;
                },
                {
                    name: "user";
                    writable: true;
                    signer: true;
                },
                {
                    name: "systemProgram";
                    address: "11111111111111111111111111111111";
                },
                {
                    name: "eventAuthority";
                    pda: {
                        seeds: [{
                            kind: "const";
                            value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121];
                        }];
                    };
                },
                {
                    name: "program";
                }
            ];
            args: [];
        },
        {
            name: "globalAddNewCurrency";
            discriminator: [46, 135, 47, 120, 118, 204, 177, 224];
            accounts: [
                {
                    name: "authority";
                    writable: true;
                    signer: true;
                },
                {
                    name: "globalConfig";
                    writable: true;
                    pda: {
                        seeds: [{
                            kind: "const";
                            value: [103, 108, 111, 98, 97, 108, 45, 99, 111, 110, 102, 105, 103];
                        }];
                    };
                },
                {
                    name: "mint";
                },
                {
                    name: "eventAuthority";
                    pda: {
                        seeds: [{
                            kind: "const";
                            value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121];
                        }];
                    };
                },
                {
                    name: "program";
                }
            ];
            args: [];
        },
        {
            name: "globalConfigInitialize";
            discriminator: [61, 23, 208, 192, 232, 52, 8, 66];
            accounts: [
                {
                    name: "authority";
                    writable: true;
                    signer: true;
                },
                {
                    name: "globalConfig";
                    writable: true;
                    pda: {
                        seeds: [{
                            kind: "const";
                            value: [103, 108, 111, 98, 97, 108, 45, 99, 111, 110, 102, 105, 103];
                        }];
                    };
                },
                {
                    name: "systemProgram";
                    address: "11111111111111111111111111111111";
                },
                {
                    name: "eventAuthority";
                    pda: {
                        seeds: [{
                            kind: "const";
                            value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121];
                        }];
                    };
                },
                {
                    name: "program";
                }
            ];
            args: [
                {
                    name: "protocolAuthority";
                    type: "pubkey";
                },
                {
                    name: "buybackAuthority";
                    type: "pubkey";
                }
            ];
        },
        {
            name: "globalRemoveCurrency";
            discriminator: [57, 226, 180, 140, 91, 14, 231, 196];
            accounts: [
                {
                    name: "authority";
                    writable: true;
                    signer: true;
                },
                {
                    name: "globalConfig";
                    writable: true;
                    pda: {
                        seeds: [{
                            kind: "const";
                            value: [103, 108, 111, 98, 97, 108, 45, 99, 111, 110, 102, 105, 103];
                        }];
                    };
                },
                {
                    name: "eventAuthority";
                    pda: {
                        seeds: [{
                            kind: "const";
                            value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121];
                        }];
                    };
                },
                {
                    name: "program";
                }
            ];
            args: [{
                name: "index";
                type: "u8";
            }];
        },
        {
            name: "globalUpdateAuthorities";
            discriminator: [91, 137, 72, 77, 183, 184, 168, 125];
            accounts: [
                {
                    name: "authority";
                    writable: true;
                    signer: true;
                },
                {
                    name: "globalConfig";
                    writable: true;
                    pda: {
                        seeds: [{
                            kind: "const";
                            value: [103, 108, 111, 98, 97, 108, 45, 99, 111, 110, 102, 105, 103];
                        }];
                    };
                },
                {
                    name: "eventAuthority";
                    pda: {
                        seeds: [{
                            kind: "const";
                            value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121];
                        }];
                    };
                },
                {
                    name: "program";
                }
            ];
            args: [
                {
                    name: "protocolAuthority";
                    type: {
                        option: "pubkey";
                    };
                },
                {
                    name: "buybackAuthority";
                    type: {
                        option: "pubkey";
                    };
                }
            ];
        }
    ];
    accounts: [
        {
            name: "BondingCurve";
            discriminator: [23, 183, 248, 55, 96, 216, 172, 96];
        },
        {
            name: "GlobalConfig";
            discriminator: [149, 8, 156, 202, 160, 252, 176, 217];
        },
        {
            name: "TokenAgentPaymentInCurrency";
            discriminator: [225, 195, 81, 227, 115, 43, 25, 177];
        },
        {
            name: "TokenAgentPayments";
            discriminator: [136, 241, 242, 217, 173, 77, 112, 186];
        }
    ];
    events: [
        {
            name: "AgentAcceptPaymentEvent";
            discriminator: [114, 190, 188, 192, 105, 79, 41, 147];
        },
        {
            name: "AgentBuybackTriggerEvent";
            discriminator: [139, 240, 9, 225, 214, 63, 232, 165];
        },
        {
            name: "AgentDistributePaymentsEvent";
            discriminator: [137, 116, 114, 140, 54, 111, 230, 26];
        },
        {
            name: "AgentInitializeEvent";
            discriminator: [192, 5, 183, 151, 0, 64, 100, 207];
        },
        {
            name: "AgentUpdateAuthorityEvent";
            discriminator: [36, 212, 117, 235, 74, 166, 60, 16];
        },
        {
            name: "AgentUpdateBuybackBpsEvent";
            discriminator: [165, 251, 40, 19, 114, 26, 128, 232];
        },
        {
            name: "AgentWithdrawEvent";
            discriminator: [174, 231, 201, 69, 254, 183, 49, 85];
        },
        {
            name: "ExtendAccountEvent";
            discriminator: [97, 97, 215, 144, 93, 146, 22, 124];
        },
        {
            name: "GlobalAddNewCurrencyEvent";
            discriminator: [130, 202, 37, 248, 241, 182, 233, 35];
        },
        {
            name: "GlobalConfigInitializeEvent";
            discriminator: [241, 51, 222, 190, 142, 245, 176, 53];
        },
        {
            name: "GlobalUpdateAuthoritiesEvent";
            discriminator: [82, 27, 22, 232, 53, 66, 35, 207];
        }
    ];
    errors: [
        {
            code: 6000;
            name: "UnauthorizedSigner";
            msg: "The given account is not authorized to execute this instruction.";
        },
        {
            code: 6001;
            name: "CurrencyAlreadySupported";
            msg: "The given currency is already supported.";
        },
        {
            code: 6002;
            name: "MaxCurrenciesReached";
            msg: "The maximum number of currencies has been reached.";
        },
        {
            code: 6003;
            name: "InvalidBuybackBps";
            msg: "The buyback basis points is greater than 10000.";
        },
        {
            code: 6004;
            name: "CurrencyNotSupported";
            msg: "The given currency is not supported.";
        },
        {
            code: 6005;
            name: "MathOverflow";
            msg: "Math overflow.";
        },
        {
            code: 6006;
            name: "InvalidRemainingAccountAddress";
            msg: "The given remaining account address is invalid.";
        },
        {
            code: 6007;
            name: "PaymentVaultNotEmpty";
            msg: "The payment vault is not empty. Distribute the payments first.";
        },
        {
            code: 6008;
            name: "InvalidInvoiceAccount";
            msg: "The invoice account does not match the expected PDA seeds";
        },
        {
            code: 6009;
            name: "InvalidProgramToInvoke";
            msg: "The program to invoke is not allowed.";
        },
        {
            code: 6010;
            name: "InvalidCallbackProgram";
            msg: "The callback program is invalid.";
        },
        {
            code: 6011;
            name: "SwapFailedAmountDidNotIncrease";
            msg: "The swap failed and the amount did not increase.";
        },
        {
            code: 6012;
            name: "AccountTypeNotSupported";
            msg: "The account type is not supported for extension.";
        },
        {
            code: 6013;
            name: "InvalidIndex";
            msg: "The index is invalid.";
        }
    ];
    types: [
        {
            name: "AgentAcceptPaymentEvent";
            type: {
                kind: "struct";
                fields: [
                    {
                        name: "user";
                        type: "pubkey";
                    },
                    {
                        name: "tokenizedAgentMint";
                        type: "pubkey";
                    },
                    {
                        name: "tokenAgentPayments";
                        type: "pubkey";
                    },
                    {
                        name: "currencyMint";
                        type: "pubkey";
                    },
                    {
                        name: "amount";
                        type: "u64";
                    },
                    {
                        name: "memo";
                        type: "u64";
                    },
                    {
                        name: "startTime";
                        type: "i64";
                    },
                    {
                        name: "endTime";
                        type: "i64";
                    },
                    {
                        name: "invoiceId";
                        type: "pubkey";
                    },
                    {
                        name: "agentPostBalance";
                        type: "u64";
                    },
                    {
                        name: "timestamp";
                        type: "i64";
                    }
                ];
            };
        },
        {
            name: "AgentBuybackTriggerEvent";
            type: {
                kind: "struct";
                fields: [
                    {
                        name: "tokenizedAgentMint";
                        type: "pubkey";
                    },
                    {
                        name: "currencyMint";
                        type: "pubkey";
                    },
                    {
                        name: "amountBurned";
                        type: "u64";
                    },
                    {
                        name: "swapProgram";
                        type: "pubkey";
                    },
                    {
                        name: "newTokensBoughtAndBurnedForCurrency";
                        type: "u64";
                    },
                    {
                        name: "agentPostBalance";
                        type: "u64";
                    },
                    {
                        name: "timestamp";
                        type: "i64";
                    },
                    {
                        name: "currencyMintAmountForBuyback";
                        type: "u64";
                    }
                ];
            };
        },
        {
            name: "AgentDistributePaymentsEvent";
            type: {
                kind: "struct";
                fields: [
                    {
                        name: "tokenAgentPayments";
                        type: "pubkey";
                    },
                    {
                        name: "currencyMint";
                        type: "pubkey";
                    },
                    {
                        name: "buybackBps";
                        type: "u16";
                    },
                    {
                        name: "buybackAmount";
                        type: "u64";
                    },
                    {
                        name: "withdrawAmount";
                        type: "u64";
                    },
                    {
                        name: "timestamp";
                        type: "i64";
                    }
                ];
            };
        },
        {
            name: "AgentInitializeEvent";
            type: {
                kind: "struct";
                fields: [
                    {
                        name: "tokenAgentPayments";
                        type: "pubkey";
                    },
                    {
                        name: "mint";
                        type: "pubkey";
                    },
                    {
                        name: "authority";
                        type: "pubkey";
                    },
                    {
                        name: "buybackBps";
                        type: "u16";
                    },
                    {
                        name: "timestamp";
                        type: "i64";
                    },
                    {
                        name: "tokenizedAgentSequence";
                        type: "u64";
                    }
                ];
            };
        },
        {
            name: "AgentUpdateAuthorityEvent";
            type: {
                kind: "struct";
                fields: [
                    {
                        name: "tokenAgentPayments";
                        type: "pubkey";
                    },
                    {
                        name: "oldAuthority";
                        type: "pubkey";
                    },
                    {
                        name: "newAuthority";
                        type: "pubkey";
                    },
                    {
                        name: "timestamp";
                        type: "i64";
                    }
                ];
            };
        },
        {
            name: "AgentUpdateBuybackBpsEvent";
            type: {
                kind: "struct";
                fields: [
                    {
                        name: "tokenAgentPayments";
                        type: "pubkey";
                    },
                    {
                        name: "mint";
                        type: "pubkey";
                    },
                    {
                        name: "oldBuybackBps";
                        type: "u16";
                    },
                    {
                        name: "newBuybackBps";
                        type: "u16";
                    },
                    {
                        name: "timestamp";
                        type: "i64";
                    }
                ];
            };
        },
        {
            name: "AgentWithdrawEvent";
            type: {
                kind: "struct";
                fields: [
                    {
                        name: "tokenizedAgentMint";
                        type: "pubkey";
                    },
                    {
                        name: "currencyMint";
                        type: "pubkey";
                    },
                    {
                        name: "amount";
                        type: "u64";
                    },
                    {
                        name: "receiver";
                        type: "pubkey";
                    },
                    {
                        name: "timestamp";
                        type: "i64";
                    }
                ];
            };
        },
        {
            name: "BondingCurve";
            type: {
                kind: "struct";
                fields: [
                    {
                        name: "virtualTokenReserves";
                        type: "u64";
                    },
                    {
                        name: "virtualSolReserves";
                        type: "u64";
                    },
                    {
                        name: "realTokenReserves";
                        type: "u64";
                    },
                    {
                        name: "realSolReserves";
                        type: "u64";
                    },
                    {
                        name: "tokenTotalSupply";
                        type: "u64";
                    },
                    {
                        name: "complete";
                        type: "bool";
                    },
                    {
                        name: "creator";
                        type: "pubkey";
                    },
                    {
                        name: "isMayhemMode";
                        type: "bool";
                    }
                ];
            };
        },
        {
            name: "ExtendAccountEvent";
            type: {
                kind: "struct";
                fields: [
                    {
                        name: "account";
                        type: "pubkey";
                    },
                    {
                        name: "user";
                        type: "pubkey";
                    },
                    {
                        name: "currentSize";
                        type: "u64";
                    },
                    {
                        name: "newSize";
                        type: "u64";
                    },
                    {
                        name: "timestamp";
                        type: "i64";
                    }
                ];
            };
        },
        {
            name: "GlobalAddNewCurrencyEvent";
            type: {
                kind: "struct";
                fields: [
                    {
                        name: "globalConfig";
                        type: "pubkey";
                    },
                    {
                        name: "currencyMint";
                        type: "pubkey";
                    },
                    {
                        name: "timestamp";
                        type: "i64";
                    }
                ];
            };
        },
        {
            name: "GlobalConfig";
            type: {
                kind: "struct";
                fields: [
                    {
                        name: "bump";
                        type: "u8";
                    },
                    {
                        name: "protocolAuthority";
                        type: "pubkey";
                    },
                    {
                        name: "buybackAuthority";
                        type: "pubkey";
                    },
                    {
                        name: "supportedCurrenciesMint";
                        type: {
                            array: ["pubkey", 10];
                        };
                    },
                    {
                        name: "tokenizedAgentSequence";
                        type: "u64";
                    }
                ];
            };
        },
        {
            name: "GlobalConfigInitializeEvent";
            type: {
                kind: "struct";
                fields: [
                    {
                        name: "globalConfig";
                        type: "pubkey";
                    },
                    {
                        name: "protocolAuthority";
                        type: "pubkey";
                    },
                    {
                        name: "buybackAuthority";
                        type: "pubkey";
                    },
                    {
                        name: "timestamp";
                        type: "i64";
                    }
                ];
            };
        },
        {
            name: "GlobalUpdateAuthoritiesEvent";
            type: {
                kind: "struct";
                fields: [
                    {
                        name: "globalConfig";
                        type: "pubkey";
                    },
                    {
                        name: "protocolAuthority";
                        type: {
                            option: "pubkey";
                        };
                    },
                    {
                        name: "buybackAuthority";
                        type: {
                            option: "pubkey";
                        };
                    },
                    {
                        name: "timestamp";
                        type: "i64";
                    }
                ];
            };
        },
        {
            name: "TokenAgentPaymentInCurrency";
            type: {
                kind: "struct";
                fields: [
                    {
                        name: "mint";
                        type: "pubkey";
                    },
                    {
                        name: "currencyMint";
                        type: "pubkey";
                    },
                    {
                        name: "totalInvoicePaymentsMade";
                        type: "u64";
                    },
                    {
                        name: "totalBuyback";
                        type: "u64";
                    },
                    {
                        name: "totalWithdrawals";
                        type: "u64";
                    },
                    {
                        name: "tokensBoughtBackAndBurned";
                        type: "u64";
                    }
                ];
            };
        },
        {
            name: "TokenAgentPayments";
            type: {
                kind: "struct";
                fields: [
                    {
                        name: "bump";
                        type: "u8";
                    },
                    {
                        name: "mint";
                        type: "pubkey";
                    },
                    {
                        name: "authority";
                        type: "pubkey";
                    },
                    {
                        name: "buybackBps";
                        type: "u16";
                    }
                ];
            };
        }
    ];
};

/**
 * Creates an Anchor Program instance for the Pump Agent Payments program.
 * Uses a dummy wallet since most operations only build instructions.
 */
declare function getPumpProgram(connection: Connection): Program<PumpAgentPayments>;
/**
 * Offline program instance (no connection required).
 * Useful for instruction building and account decoding without RPC.
 */
declare const OFFLINE_PUMP_PROGRAM: Program<PumpAgentPayments>;
/**
 * Returns the program instance, falling back to the offline program
 * if no connection is provided.
 */
declare function getPumpProgramWithFallback(connection?: Connection): Program<PumpAgentPayments>;
/**
 * Returns the offline program instance (alias for convenience).
 */
declare function getOfflineProgram(): Program<PumpAgentPayments>;

/** Pump Agent Payments program ID */
declare const PROGRAM_ID: PublicKey;
/** Pump (bonding curve) program ID */
declare const PUMP_PROGRAM_ID: PublicKey;
/** Pump fees program ID */
declare const PUMP_FEES_PROGRAM_ID: PublicKey;
declare const GLOBAL_CONFIG_SEED: Buffer<ArrayBuffer>;
declare const TOKEN_AGENT_PAYMENTS_SEED: Buffer<ArrayBuffer>;
declare const PAYMENT_IN_CURRENCY_SEED: Buffer<ArrayBuffer>;
declare const INVOICE_ID_SEED: Buffer<ArrayBuffer>;
declare const BUYBACK_AUTHORITY_SEED: Buffer<ArrayBuffer>;
declare const WITHDRAW_AUTHORITY_SEED: Buffer<ArrayBuffer>;
declare const BONDING_CURVE_SEED: Buffer<ArrayBuffer>;
declare const SHARING_CONFIG_SEED: Buffer<ArrayBuffer>;
/**
 * Minimum rent-exempt lamports for TokenAgentPayments account.
 * 0.00141288 SOL.
 */
declare const TOKEN_AGENT_PAYMENTS_MIN_RENT_EXEMPT_LAMPORTS = 1412880;
/**
 * Derives the GlobalConfig PDA.
 * Seeds: ["global-config"]
 */
declare function getGlobalConfigPDA(): [PublicKey, number];
/**
 * Derives the TokenAgentPayments PDA for a given mint.
 * Seeds: ["token-agent-payments", mint]
 */
declare function getTokenAgentPaymentsPDA(mint: PublicKey): [PublicKey, number];
/**
 * Derives the TokenAgentPaymentInCurrency PDA.
 * Seeds: ["payment-in-currency", tokenMint, currencyMint]
 */
declare function getPaymentInCurrencyPDA(tokenMint: PublicKey, currencyMint: PublicKey): [PublicKey, number];
/**
 * Derives the Invoice ID PDA used to validate payment uniqueness.
 * Seeds: ["invoice-id", tokenMint, currencyMint, amount, memo, startTime, endTime]
 */
declare function getInvoiceIdPDA(tokenMint: PublicKey, currencyMint: PublicKey, amount: BN, memo: BN, startTime: BN, endTime: BN): [PublicKey, number];
/**
 * Derives the Buyback Authority PDA for a given token mint.
 * Seeds: ["buyback-authority", tokenMint]
 */
declare function getBuybackAuthorityPDA(tokenMint: PublicKey): [PublicKey, number];
/**
 * Derives the Withdraw Authority PDA for a given token mint.
 * Seeds: ["withdraw-authority", tokenMint]
 */
declare function getWithdrawAuthorityPDA(tokenMint: PublicKey): [PublicKey, number];
/**
 * Derives the BondingCurve PDA from the Pump program for a given mint.
 * Seeds: ["bonding-curve", mint] (program = Pump)
 */
declare function getBondingCurvePDA(mint: PublicKey): [PublicKey, number];
/**
 * Derives the SharingConfig PDA for a given mint.
 * Seeds: ["sharing-config", mint]
 */
declare function getSharingConfigPDA(mint: PublicKey): [PublicKey, number];

type PumpEnvironment = "devnet" | "mainnet";
interface VaultBalance {
    address: PublicKey;
    balance: bigint;
}
interface AgentBalances {
    /** Currency mint these vaults hold (NATIVE_MINT for SOL, or any SPL mint). */
    quoteMint: PublicKey;
    /** ATA of the TokenAgentPayments PDA (incoming payments land here) */
    paymentVault: VaultBalance;
    /** ATA of the Buyback Authority PDA */
    buybackVault: VaultBalance;
    /** ATA of the Withdraw Authority PDA */
    withdrawVault: VaultBalance;
}
interface CreateParams {
    /** Signer – must be the bonding-curve creator for this mint */
    authority: PublicKey;
    /** The token mint this agent manages */
    mint: PublicKey;
    /** The pubkey that will act as the agent authority (for withdraw / update) */
    agentAuthority: PublicKey;
    /** Basis points allocated to buyback (0–10 000) */
    buybackBps: number;
}
interface WithdrawParams {
    /** Agent authority signer */
    authority: PublicKey;
    /** Currency mint to withdraw */
    currencyMint: PublicKey;
    /** Receiver's token account for the currency */
    receiverAta: PublicKey;
    /** Token program for the currency mint (defaults to TOKEN_PROGRAM_ID) */
    tokenProgram?: PublicKey;
}
interface UpdateBuybackBpsParams {
    /** Agent authority signer */
    authority: PublicKey;
    /** New buyback basis points (0–10 000) */
    buybackBps: number;
}
interface UpdateBuybackBpsOptions {
    /** Supported currencies and their token programs */
    supportedCurrencies: {
        mint: PublicKey;
        tokenProgram: PublicKey;
    }[];
}
interface AcceptPaymentParams {
    /** Payer / user signer */
    user: PublicKey;
    /** User's token account holding the currency */
    userTokenAccount: PublicKey;
    /** The currency mint being paid */
    currencyMint: PublicKey;
    amount: BN;
    memo: BN;
    startTime: BN;
    endTime: BN;
    /** Token program for the currency mint (defaults to TOKEN_PROGRAM_ID) */
    tokenProgram?: PublicKey;
}
interface AcceptPaymentSimpleParams {
    user: PublicKey;
    userTokenAccount: PublicKey;
    currencyMint: PublicKey;
    amount: bigint | number | string;
    memo: bigint | number | string;
    startTime: bigint | number | string;
    endTime: bigint | number | string;
    tokenProgram?: PublicKey;
    /** Compute unit limit (defaults to 130_000) */
    computeUnitLimit?: number;
    /** Priority fee in micro lamports per compute unit (defaults to 1_000) */
    computeUnitPrice?: number;
}
interface BuildAcceptPaymentParams {
    user: PublicKey;
    currencyMint: PublicKey;
    amount: bigint | number | string;
    memo: bigint | number | string;
    startTime: bigint | number | string;
    endTime: bigint | number | string;
    tokenProgram?: PublicKey;
    /** Compute unit limit for the transaction (defaults to 100_000) */
    computeUnitLimit?: number;
    /** Priority fee in microlamports per compute unit. If provided, a SetComputeUnitPrice instruction is prepended. */
    computeUnitPrice?: number;
}
interface DistributePaymentsParams {
    /** Any signer (permissionless) */
    user: PublicKey;
    /** Currency mint to distribute */
    currencyMint: PublicKey;
    /** Token program for the currency mint (defaults to TOKEN_PROGRAM_ID) */
    tokenProgram?: PublicKey;
    /**
     * For native SOL only: prepend `agentTransferExtraLamports` before distribute.
     * Default is false.
     */
    includeTransferExtraLamportsForNative?: boolean;
}
interface BuybackTriggerParams {
    /** Must match globalConfig.buybackAuthority */
    globalBuybackAuthority: PublicKey;
    /** The currency mint used for the swap (tracks per-currency buyback accounting) */
    currencyMint: PublicKey;
    /** Swap program to CPI into (must be in the allowed list) */
    swapProgramToInvoke: PublicKey;
    /** Serialised swap instruction data (pass empty Buffer to skip swap & just burn) */
    swapInstructionData: Buffer;
    /** All accounts the swap instruction requires */
    remainingAccounts: AccountMeta[];
    /** Token program for the currency mint (defaults to TOKEN_PROGRAM_ID) */
    tokenProgramCurrency?: PublicKey;
    /** Token program for the agent token mint (defaults to TOKEN_PROGRAM_ID) */
    tokenProgram?: PublicKey;
}
interface ExtendAccountParams {
    /** Account to extend (must be a supported account type on-chain) */
    account: PublicKey;
    /** Signer paying rent for extension */
    user: PublicKey;
}
interface UpdateAuthorityParams {
    /** Current agent authority signer (or protocol authority for recovery) */
    authority: PublicKey;
    /** The new authority pubkey to set */
    newAuthority: PublicKey;
}
interface CloseAccountParams {
    /** The account to close (TokenAgentPayments, PaymentInCurrency, etc.) */
    account: PublicKey;
    /** Signer who receives the reclaimed rent lamports */
    user: PublicKey;
}

type GlobalConfig = Awaited<ReturnType<typeof OFFLINE_PUMP_PROGRAM.account.GlobalConfig.fetch>>;
type TokenAgentPaymentInCurrency = Awaited<ReturnType<typeof OFFLINE_PUMP_PROGRAM.account.TokenAgentPaymentInCurrency.fetch>>;
type TokenAgentPayments = Awaited<ReturnType<typeof OFFLINE_PUMP_PROGRAM.account.TokenAgentPayments.fetch>>;

/** Result of `buildBuyInstructions` (buy_v2). */
interface BuyResult {
    instructions: TransactionInstruction[];
    /** Resolved quote mint (NATIVE_MINT for legacy SOL coins, USDC for USDC coins). */
    quoteMint: PublicKey;
    /** SPL token program owning `quoteMint`. */
    quoteTokenProgram: PublicKey;
    /** Expected base tokens received before slippage protection. */
    expectedBaseTokens: BN;
    /**
     * Quote required for `expectedBaseTokens` after the on-curve fee bump.
     * Matches the `quoteAmount` value passed to the program.
     */
    preciseQuoteAmount: BN;
    /** Fee recipient picked for this transaction. */
    feeRecipient: PublicKey;
    /** Buyback fee recipient picked for this transaction. */
    buybackFeeRecipient: PublicKey;
}
/** Result of `buildSellInstructions` (sell_v2). */
interface SellResult {
    instructions: TransactionInstruction[];
    quoteMint: PublicKey;
    quoteTokenProgram: PublicKey;
    /** Expected quote received before slippage protection. */
    expectedQuoteOut: BN;
}
/** Result of `buildBuyExactQuoteInInstructions` (buy_exact_quote_in_v2). */
interface ExactQuoteResult {
    instructions: TransactionInstruction[];
    quoteMint: PublicKey;
    quoteTokenProgram: PublicKey;
}
/** Preview of a buy without sending. */
interface BuyQuote {
    quoteMint: PublicKey;
    quoteTokenProgram: PublicKey;
    /** Quote requested by the caller. */
    quoteAmount: BN;
    /** Expected base tokens at current curve state. */
    expectedBaseTokens: BN;
    /** Quote required for `expectedBaseTokens` (round-tripped through the curve). */
    preciseQuoteAmount: BN;
    /** Maximum quote the user will spend including the slippage cap. */
    maxQuoteCost: BN;
    /** Slippage cap as a percent (e.g. 5 = 5%). */
    slippagePct: number;
    /** Price impact in percent, clamped to [0, 100]. */
    priceImpactPct: number;
}
/** Preview of a sell without sending. */
interface SellQuote {
    quoteMint: PublicKey;
    quoteTokenProgram: PublicKey;
    /** Base tokens to be sold. */
    baseAmount: BN;
    /** Expected quote out at current curve state. */
    expectedQuoteOut: BN;
    /** Minimum quote the user will accept including the slippage cap. */
    minQuoteOut: BN;
    /** Slippage cap as a percent (e.g. 5 = 5%). */
    slippagePct: number;
    /** Price impact in percent, clamped to [0, 100]. */
    priceImpactPct: number;
}

/**
 * USDC mainnet mint — recognised quote currency for pump-fun USDC coins.
 */
declare const USDC_MINT: PublicKey;
/**
 * Decode the `quote_mint` field from a raw pump BondingCurve account
 * buffer. Returns NATIVE_MINT for legacy accounts shorter than the
 * post-multi-quote layout (those are SOL-only by definition).
 */
declare function decodeBondingCurveQuoteMint(data: Buffer): PublicKey;
/**
 * Resolve the SPL token program (classic or Token-2022) for a mint.
 * Falls back to TOKEN_PROGRAM_ID for SOL/USDC and on RPC misses.
 */
declare function resolveTokenProgramForMint(connection: Connection, mint: PublicKey): Promise<PublicKey>;
declare class PumpAgentOffline {
    readonly mint: PublicKey;
    protected readonly program: Program<PumpAgentPayments>;
    static readonly DEFAULT_COMPUTE_UNIT_LIMIT_FOR_AGENT_PAYMENTS = 100000;
    static readonly DEFAULT_PRIORITY_FEE_MICRO_LAMPORTS = 1000;
    constructor(mint: PublicKey, program?: Program<PumpAgentPayments>);
    static load(mint: PublicKey, connection?: Connection): PumpAgentOffline;
    create(params: CreateParams): Promise<TransactionInstruction>;
    withdraw(params: WithdrawParams): Promise<TransactionInstruction>;
    updateBuybackBps(params: UpdateBuybackBpsParams, options: UpdateBuybackBpsOptions): Promise<TransactionInstruction>;
    acceptPayment(params: AcceptPaymentParams): Promise<TransactionInstruction>;
    buildAcceptPaymentInstructions(params: BuildAcceptPaymentParams): Promise<TransactionInstruction[]>;
    distributePayments(params: DistributePaymentsParams): Promise<TransactionInstruction[]>;
    buybackTrigger(params: BuybackTriggerParams): Promise<TransactionInstruction>;
    extendAccount(params: ExtendAccountParams): Promise<TransactionInstruction>;
    updateAuthority(params: UpdateAuthorityParams): Promise<TransactionInstruction>;
    /**
     * Returns the `close_account` instruction to close a program account
     * and reclaim its rent-exempt lamports.
     */
    closeAccount(params: CloseAccountParams): Promise<TransactionInstruction>;
    private static readonly _coinQuoteMintCache;
    static getCoinQuoteMint(connection: Connection, baseMint: PublicKey): Promise<PublicKey>;
    static _clearCoinQuoteMintCache(): void;
    acceptPaymentForCoin(params: {
        connection: Connection;
        user: PublicKey;
        userTokenAccount: PublicKey;
        baseMint: PublicKey;
        amount: BN;
        memo: BN;
        startTime: BN;
        endTime: BN;
    }): Promise<TransactionInstruction>;
    distributeAndBuybackForCoin(params: {
        connection: Connection;
        user: PublicKey;
        globalBuybackAuthority: PublicKey;
        baseMint: PublicKey;
        swapProgramToInvoke: PublicKey;
        swapInstructionData: Buffer;
        remainingAccounts: AccountMeta[];
    }): Promise<[TransactionInstruction, TransactionInstruction]>;
    static buildJupiterSwapData(params: {
        inputMint: PublicKey;
        outputMint: PublicKey;
        amount: BN;
        slippageBps?: number;
        jupiterApiBase?: string;
    }): Promise<Buffer>;
    validateCurrencySupport(params: {
        connection: Connection;
        baseMint: PublicKey;
    }): Promise<{
        supported: boolean;
        quoteMint: PublicKey;
        registeredCurrencies: PublicKey[];
    }>;
}

interface AgentAcceptPaymentEvent {
    user: PublicKey;
    tokenizedAgentMint: PublicKey;
    tokenAgentPayments: PublicKey;
    currencyMint: PublicKey;
    amount: BN;
    memo: BN;
    startTime: BN;
    endTime: BN;
    invoiceId: PublicKey;
    agentPostBalance: BN;
    timestamp: BN;
}
interface AgentBuybackTriggerEvent {
    tokenizedAgentMint: PublicKey;
    currencyMint: PublicKey;
    amountBurned: BN;
    swapProgram: PublicKey;
    newTokensBoughtAndBurnedForCurrency: BN;
    agentPostBalance: BN;
    timestamp: BN;
    currencyMintAmountForBuyback: BN;
}
interface AgentDistributePaymentsEvent {
    tokenAgentPayments: PublicKey;
    currencyMint: PublicKey;
    buybackBps: number;
    buybackAmount: BN;
    withdrawAmount: BN;
    timestamp: BN;
}
interface AgentInitializeEvent {
    tokenAgentPayments: PublicKey;
    mint: PublicKey;
    authority: PublicKey;
    buybackBps: number;
    timestamp: BN;
    tokenizedAgentSequence: BN;
}
interface AgentUpdateAuthorityEvent {
    tokenAgentPayments: PublicKey;
    oldAuthority: PublicKey;
    newAuthority: PublicKey;
    timestamp: BN;
}
interface AgentUpdateBuybackBpsEvent {
    tokenAgentPayments: PublicKey;
    mint: PublicKey;
    oldBuybackBps: number;
    newBuybackBps: number;
    timestamp: BN;
}
interface AgentWithdrawEvent {
    tokenizedAgentMint: PublicKey;
    currencyMint: PublicKey;
    amount: BN;
    receiver: PublicKey;
    timestamp: BN;
}
interface ExtendAccountEvent {
    account: PublicKey;
    user: PublicKey;
    currentSize: BN;
    newSize: BN;
    timestamp: BN;
}
interface GlobalAddNewCurrencyEvent {
    globalConfig: PublicKey;
    currencyMint: PublicKey;
    timestamp: BN;
}
interface GlobalConfigInitializeEvent {
    globalConfig: PublicKey;
    protocolAuthority: PublicKey;
    buybackAuthority: PublicKey;
    timestamp: BN;
}
interface GlobalUpdateAuthoritiesEvent {
    globalConfig: PublicKey;
    protocolAuthority: PublicKey | null;
    buybackAuthority: PublicKey | null;
    timestamp: BN;
}
type AgentEventName = "agentAcceptPaymentEvent" | "agentBuybackTriggerEvent" | "agentDistributePaymentsEvent" | "agentInitializeEvent" | "agentUpdateAuthorityEvent" | "agentUpdateBuybackBpsEvent" | "agentWithdrawEvent" | "extendAccountEvent" | "globalAddNewCurrencyEvent" | "globalConfigInitializeEvent" | "globalUpdateAuthoritiesEvent";
type AgentEventData = AgentAcceptPaymentEvent | AgentBuybackTriggerEvent | AgentDistributePaymentsEvent | AgentInitializeEvent | AgentUpdateAuthorityEvent | AgentUpdateBuybackBpsEvent | AgentWithdrawEvent | ExtendAccountEvent | GlobalAddNewCurrencyEvent | GlobalConfigInitializeEvent | GlobalUpdateAuthoritiesEvent;
interface ParsedAgentEvent<T extends AgentEventData = AgentEventData> {
    name: AgentEventName;
    data: T;
}
/**
 * Create an Anchor EventParser bound to the Pump Agent Payments program.
 * Works offline (no connection required) or with a connection.
 */
declare function createEventParser(connection?: Connection): EventParser;
/**
 * Parse transaction log messages into typed agent events.
 *
 * @example
 * ```ts
 * const tx = await connection.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
 * const events = parseAgentEvents(tx.meta.logMessages);
 * for (const event of events) {
 *   if (event.name === "agentAcceptPaymentEvent") {
 *     console.log("Payment:", event.data.amount.toString());
 *   }
 * }
 * ```
 */
declare function parseAgentEvents(logs: string[], connection?: Connection): ParsedAgentEvent[];
interface EventSubscriptionOptions {
    /** Filter to specific event names. If omitted, all events are emitted. */
    eventNames?: AgentEventName[];
}
interface EventSubscription {
    /** Stop listening and clean up the WebSocket subscription. */
    unsubscribe(): void;
}
/**
 * Subscribe to real-time Pump Agent Payments program events via WebSocket.
 * Calls the provided callback whenever a matching event is detected.
 *
 * @example
 * ```ts
 * const sub = subscribeToAgentEvents(connection, (event, slot) => {
 *   console.log(`[slot ${slot}] ${event.name}`, event.data);
 * }, { eventNames: ["agentAcceptPaymentEvent"] });
 *
 * // Later: stop listening
 * sub.unsubscribe();
 * ```
 */
declare function subscribeToAgentEvents(connection: Connection, callback: (event: ParsedAgentEvent, slot: number) => void, options?: EventSubscriptionOptions): EventSubscription;

declare class PumpAgent extends PumpAgentOffline {
    private connection?;
    private environment;
    constructor(mint: PublicKey, environment?: PumpEnvironment, connection?: Connection);
    private get blockchainClientBaseUrl();
    /**
     * Fetches the current balances for all three vaults for a given currency.
     * Returns the vault address and its token balance.
     * If a vault ATA does not exist yet the balance is reported as 0n.
     */
    getBalances(currencyMint: PublicKey, currencyTokenProgram?: PublicKey): Promise<AgentBalances>;
    /**
     * Fetch balances for every currency this agent could receive — i.e. SOL
     * (always) plus every non-default mint in `GlobalConfig.supportedCurrenciesMint`.
     *
     * Returned map is keyed by `mint.toBase58()`. Lookups happen concurrently.
     */
    getAllCurrencyBalances(): Promise<Map<string, AgentBalances>>;
    getCoinQuoteMint(baseMint: PublicKey): Promise<PublicKey>;
    getCoinPaymentSummary(baseMint: PublicKey): Promise<{
        quoteMint: PublicKey;
        totalPaymentsReceived: BN;
        pendingBuyback: BN;
        pendingWithdrawal: BN;
        readyToDistribute: boolean;
    }>;
    /**
     * Returns the `agent_update_buyback_bps` instruction and auto-fetches
     * supported currencies from GlobalConfig when options are omitted.
     */
    updateBuybackBps(params: UpdateBuybackBpsParams): Promise<TransactionInstruction>;
    /**
     * Fetch the on-chain TokenAgentPayments config for this agent's mint.
     * Returns the authority, buyback bps, and mint.
     */
    getAgentConfig(): Promise<TokenAgentPayments>;
    /**
     * Fetch the protocol-wide GlobalConfig account.
     * Returns authorities and the list of supported currency mints.
     */
    getGlobalConfig(): Promise<GlobalConfig>;
    /**
     * Fetch the per-currency accounting stats for this agent.
     * Returns total payments, buybacks, withdrawals, and tokens burned.
     */
    getPaymentStats(currencyMint: PublicKey): Promise<TokenAgentPaymentInCurrency>;
    /**
     * Fetch the list of supported currency mints from GlobalConfig,
     * filtered to only non-default (non-zero) entries.
     */
    getSupportedCurrencies(): Promise<PublicKey[]>;
    /**
     * Check whether the TokenAgentPayments account exists on-chain
     * (i.e. whether this agent has been initialized).
     */
    isInitialized(): Promise<boolean>;
    /**
     * Fetch recent payment events for this agent by scanning on-chain
     * transaction logs on the TokenAgentPayments PDA.
     *
     * @param limit - Maximum number of transactions to scan (default: 50)
     * @returns Parsed `AgentAcceptPaymentEvent`s in reverse chronological order
     */
    getPaymentHistory(limit?: number): Promise<AgentAcceptPaymentEvent[]>;
    /**
     * Fetch all recent events for this agent (payments, distributions,
     * buybacks, withdrawals, etc.) from on-chain transaction logs.
     *
     * @param limit - Maximum number of transactions to scan (default: 50)
     */
    getEventHistory(limit?: number): Promise<ParsedAgentEvent[]>;
    validateInvoicePayment(params: {
        user: PublicKey;
        currencyMint: PublicKey;
        amount: number;
        memo: number;
        startTime: number;
        endTime: number;
    }): Promise<boolean>;
    /** RPC-based fallback: scans on-chain transaction logs for the payment event. */
    private validateInvoicePaymentViaRpc;
}

/**
 * SDK error types for multi-currency / USDC-aware PumpAgent flows.
 */
/**
 * Thrown when a Jupiter v6 API call fails (network error, non-2xx status,
 * or malformed response). Callers should surface this so operators can
 * either retry, swap providers, or feed in their own pre-built swap data.
 */
declare class JupiterUnavailableError extends Error {
    readonly status?: number;
    readonly endpoint: string;
    constructor(message: string, endpoint: string, status?: number);
}
/**
 * Thrown when a pump-fun coin's quote mint is not present in the
 * agent-payments program's `GlobalConfig.supportedCurrenciesMint` list.
 *
 * Actionable resolution: ask a protocol authority to add the currency
 * via `globalAddNewCurrency`, or pick a different coin whose quote mint
 * is already supported.
 */
declare class CurrencyNotSupportedError extends Error {
    readonly baseMint: string;
    readonly quoteMint: string;
    readonly supportedMints: string[];
    constructor(params: {
        baseMint: string;
        quoteMint: string;
        supportedMints: string[];
    });
}

declare function decodeGlobalConfig(accountData: Buffer): GlobalConfig;
declare function decodeTokenAgentPaymentInCurrency(accountData: Buffer): TokenAgentPaymentInCurrency;
declare function decodeTokenAgentPayments(accountData: Buffer): TokenAgentPayments;

/**
 * x402 v2 Protocol Types
 *
 * Aligned with the coinbase/x402 specification.
 * Supports "pump-agent" scheme (on-chain invoice payments) and
 * the standard "exact" scheme (SPL TransferChecked).
 *
 * @see https://github.com/coinbase/x402
 */
declare const X402_VERSION = 2;
/** Standard x402 header names (v2 spec) */
declare const X402_HEADER_PAYMENT_REQUIRED = "PAYMENT-REQUIRED";
declare const X402_HEADER_PAYMENT_SIGNATURE = "PAYMENT-SIGNATURE";
declare const X402_HEADER_PAYMENT_RESPONSE = "PAYMENT-RESPONSE";
/** CAIP-2 network identifiers for Solana */
declare const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
declare const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
/** Well-known Solana asset addresses */
declare const USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
declare const USDC_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
/** Standard x402 "exact" scheme – SPL TransferChecked */
type ExactScheme = "exact";
/** Pump Agent invoice scheme */
type PumpAgentScheme = "pump-agent";
/** Supported payment schemes */
type PaymentScheme = ExactScheme | PumpAgentScheme;
interface ResourceInfo {
    /** The URL of the paid resource */
    url: string;
    /** Human-readable description */
    description?: string;
}
/** Base fields shared by all schemes */
interface PaymentRequirementsBase {
    /** Payment scheme identifier */
    scheme: PaymentScheme;
    /** CAIP-2 network identifier */
    network: string;
    /** Token/asset mint address (base58) */
    asset: string;
    /** Amount in minor units (string to avoid floating point) */
    amount: string;
    /** Recipient address (base58) */
    payTo: string;
    /** Max seconds the facilitator will wait for settlement */
    maxTimeoutSeconds: number;
    /** Scheme-specific extra data */
    extra?: Record<string, unknown>;
}
/** "exact" scheme – standard SPL TransferChecked */
interface ExactPaymentRequirements extends PaymentRequirementsBase {
    scheme: "exact";
}
/** "pump-agent" scheme – Pump Agent on-chain invoice */
interface PumpAgentPaymentRequirements extends PaymentRequirementsBase {
    scheme: "pump-agent";
    extra: {
        /** Agent token mint (base58) */
        agentMint: string;
        /** Numeric invoice memo */
        memo: string;
        /** Unix timestamp – invoice valid from */
        startTime: number;
        /** Unix timestamp – invoice valid until */
        endTime: number;
    };
}
/** Union of all supported requirements */
type PaymentRequirements = ExactPaymentRequirements | PumpAgentPaymentRequirements;
interface PaymentRequired {
    x402Version: 2;
    error?: string;
    resource: ResourceInfo;
    accepts: PaymentRequirements[];
}
interface PaymentPayload {
    x402Version: 2;
    /** The resource URL this payment is for */
    resource?: string;
    /** Which accepted scheme/requirements this payment matches */
    accepted: PaymentRequirements;
    /** Scheme-specific proof data */
    payload: Record<string, unknown>;
}
interface VerifyResponse {
    isValid: boolean;
    invalidReason?: string;
    payer?: string;
}
interface SettleResponse {
    success: boolean;
    errorReason?: string;
    payer?: string;
    transaction?: string;
    network?: string;
}
interface SupportedKind {
    scheme: PaymentScheme;
    network: string;
    asset: string;
}
interface SupportedResponse {
    kinds: SupportedKind[];
}
interface FacilitatorClient {
    /** Verify a payment payload against its requirements */
    verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse>;
    /** Settle (submit) a verified payment and return the result */
    settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse>;
    /** Return the schemes/networks/assets this facilitator supports */
    getSupported(): Promise<SupportedResponse>;
}
interface PaymentResponse {
    success: boolean;
    transaction?: string;
    network?: string;
    payer?: string;
    errorReason?: string;
}
interface ResourceServerConfig {
    /** Facilitator client to use for verify + settle */
    facilitator: FacilitatorClient;
    /** Default payment requirements for this resource */
    requirements: PaymentRequirements[];
    /** Resource info describing what's for sale */
    resource: ResourceInfo;
}
type TransactionSigner = (txBase64: string) => Promise<string>;
type TransactionSender = (signedTxBase64: string) => Promise<string>;
interface X402ClientConfig {
    /** Payer's public key (base58) */
    payer: string;
    /** Sign a serialised transaction, return signed base64 */
    signTransaction: TransactionSigner;
    /** Send a signed transaction, return the tx signature (base58) */
    sendTransaction: TransactionSender;
    /** CAIP-2 network identifier (default: SOLANA_MAINNET) */
    network?: string;
    /** Max time to wait for tx confirmation in ms (default: 30_000) */
    confirmationTimeoutMs?: number;
}

/**
 * x402 v2 Header encoding / decoding
 *
 * Standard headers (per coinbase/x402 v2 spec):
 *   PAYMENT-REQUIRED   – server → client (402 response)
 *   PAYMENT-SIGNATURE  – client → server (retry request)
 *   PAYMENT-RESPONSE   – server → client (200 after settlement)
 *
 * All values are base64-encoded JSON.
 */

declare function encodePaymentRequired(pr: PaymentRequired): string;
declare function decodePaymentRequired(headerValue: string): PaymentRequired;
declare function encodePaymentPayload(payload: PaymentPayload): string;
declare function decodePaymentPayload(headerValue: string): PaymentPayload;
declare function encodePaymentResponse(pr: PaymentResponse): string;
declare function decodePaymentResponse(headerValue: string): PaymentResponse;
/**
 * Extract PAYMENT-REQUIRED from a 402 Response.
 * Returns null if not a 402 or header is missing.
 */
declare function getPaymentRequiredFromResponse(response: Response): PaymentRequired | null;
/**
 * Extract PAYMENT-SIGNATURE from a Request.
 * Returns null if header is missing.
 */
declare function getPaymentPayloadFromRequest(request: Request): PaymentPayload | null;
/**
 * Extract PAYMENT-RESPONSE from a Response.
 * Returns null if header is missing.
 */
declare function getPaymentResponseFromResponse(response: Response): PaymentResponse | null;

/**
 * x402 v2 Facilitator & Resource Server
 *
 * Implements the coinbase/x402 3-party architecture:
 *   Client → Resource Server → Facilitator (verify / settle)
 *
 * Provides:
 *   - PumpAgentFacilitator: FacilitatorClient that verifies & settles
 *     "pump-agent" scheme payments using PumpAgent on-chain validation.
 *   - createResourceServer: framework-agnostic Request/Response middleware
 *     that returns 402s, verifies payment via a facilitator, and settles.
 */

interface PumpAgentFacilitatorConfig {
    /** Solana RPC connection */
    connection: Connection;
    /** CAIP-2 network (default: SOLANA_MAINNET) */
    network?: string;
}
/**
 * FacilitatorClient implementation for the "pump-agent" scheme.
 *
 * Uses PumpAgent.validateInvoicePayment() for on-chain verification,
 * and treats the client-submitted transaction signature as the settlement.
 */
declare class PumpAgentFacilitator implements FacilitatorClient {
    private connection;
    private network;
    private settlementCache;
    constructor(config: PumpAgentFacilitatorConfig);
    verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse>;
    settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse>;
    getSupported(): Promise<SupportedResponse>;
}
interface PumpAgentRequirementsConfig {
    /** Agent token mint (base58) */
    agentMint: string;
    /** Currency / asset mint (base58). Defaults to USDC mainnet */
    asset?: string;
    /** Recipient address (generally the payment vault) */
    payTo: string;
    /** Price in minor units */
    amount: string;
    /** CAIP-2 network (default: SOLANA_MAINNET) */
    network?: string;
    /** Invoice window in seconds (default: 300) */
    invoiceWindowSeconds?: number;
    /** Max settlement timeout in seconds (default: 60) */
    maxTimeoutSeconds?: number;
}
/**
 * Build fresh PumpAgentPaymentRequirements with a unique invoice memo.
 */
declare function buildPumpAgentRequirements(config: PumpAgentRequirementsConfig): PumpAgentPaymentRequirements;
/**
 * Creates a handler wrapper that implements the x402 Resource Server role.
 *
 * On requests without PAYMENT-SIGNATURE: returns 402 with PAYMENT-REQUIRED.
 * On requests with PAYMENT-SIGNATURE: verifies → settles → forwards to handler.
 *
 * Works with any framework using the standard Request/Response API
 * (Hono, Next.js App Router, Cloudflare Workers, Bun, Deno, etc.).
 *
 * @example
 * ```ts
 * const gate = createResourceServer({
 *   facilitator: new PumpAgentFacilitator({ connection }),
 *   requirements: [buildPumpAgentRequirements({
 *     agentMint: "YourMint...",
 *     payTo: "PaymentVault...",
 *     amount: "1000000",
 *   })],
 *   resource: { url: "/api/inference", description: "AI call" },
 * });
 *
 * // Hono
 * app.get("/api/inference", (c) =>
 *   gate(c.req.raw, () => c.json({ result: "..." }))
 * );
 * ```
 */
declare function createResourceServer(config: ResourceServerConfig): (request: Request, handler: () => Response | Promise<Response>) => Promise<Response>;

/**
 * x402 v2 Client – automatic 402 handling
 *
 * A fetch wrapper that intercepts HTTP 402 responses, builds and signs
 * a payment transaction matching the server's PaymentRequirements, and
 * retries the request with a PAYMENT-SIGNATURE header.
 *
 * Supports both "pump-agent" (Pump Agent invoice) and "exact" (SPL
 * TransferChecked) schemes.
 */

/**
 * Create a fetch function that automatically handles HTTP 402 responses
 * by building a payment transaction, signing, sending, and retrying
 * the original request with payment proof in the PAYMENT-SIGNATURE header.
 *
 * @example
 * ```ts
 * import { createX402Fetch } from "@pump-fun/agent-payments-sdk/x402";
 *
 * const x402fetch = createX402Fetch({
 *   payer: wallet.publicKey.toBase58(),
 *   signTransaction: async (txBase64) => {
 *     const tx = Transaction.from(Buffer.from(txBase64, "base64"));
 *     const signed = await wallet.signTransaction(tx);
 *     return Buffer.from(signed.serialize()).toString("base64");
 *   },
 *   sendTransaction: async (signedTxBase64) => {
 *     const raw = Buffer.from(signedTxBase64, "base64");
 *     const sig = await connection.sendRawTransaction(raw);
 *     await connection.confirmTransaction(sig, "confirmed");
 *     return sig;
 *   },
 * });
 *
 * const res = await x402fetch("https://api.agent.example/inference", {
 *   method: "POST",
 *   body: JSON.stringify({ prompt: "Hello" }),
 * });
 * ```
 */
declare function createX402Fetch(config: X402ClientConfig & {
    connection: Connection;
}): typeof fetch;

/**
 * x402 v2 – HTTP 402 Payment Required protocol for Pump Agent Payments
 *
 * Aligned with the coinbase/x402 v2 specification.
 * @see https://github.com/coinbase/x402
 *
 * Server-side:  PumpAgentFacilitator, createResourceServer, buildPumpAgentRequirements
 * Client-side:  createX402Fetch
 * Helpers:      encode/decode headers, constants
 */

type index$1_ExactPaymentRequirements = ExactPaymentRequirements;
type index$1_ExactScheme = ExactScheme;
type index$1_FacilitatorClient = FacilitatorClient;
type index$1_PaymentPayload = PaymentPayload;
type index$1_PaymentRequired = PaymentRequired;
type index$1_PaymentRequirements = PaymentRequirements;
type index$1_PaymentRequirementsBase = PaymentRequirementsBase;
type index$1_PaymentResponse = PaymentResponse;
type index$1_PaymentScheme = PaymentScheme;
type index$1_PumpAgentFacilitator = PumpAgentFacilitator;
declare const index$1_PumpAgentFacilitator: typeof PumpAgentFacilitator;
type index$1_PumpAgentFacilitatorConfig = PumpAgentFacilitatorConfig;
type index$1_PumpAgentPaymentRequirements = PumpAgentPaymentRequirements;
type index$1_PumpAgentRequirementsConfig = PumpAgentRequirementsConfig;
type index$1_PumpAgentScheme = PumpAgentScheme;
type index$1_ResourceInfo = ResourceInfo;
type index$1_ResourceServerConfig = ResourceServerConfig;
declare const index$1_SOLANA_DEVNET: typeof SOLANA_DEVNET;
declare const index$1_SOLANA_MAINNET: typeof SOLANA_MAINNET;
type index$1_SettleResponse = SettleResponse;
type index$1_SupportedKind = SupportedKind;
type index$1_SupportedResponse = SupportedResponse;
type index$1_TransactionSender = TransactionSender;
type index$1_TransactionSigner = TransactionSigner;
declare const index$1_USDC_DEVNET: typeof USDC_DEVNET;
declare const index$1_USDC_MAINNET: typeof USDC_MAINNET;
type index$1_VerifyResponse = VerifyResponse;
type index$1_X402ClientConfig = X402ClientConfig;
declare const index$1_X402_HEADER_PAYMENT_REQUIRED: typeof X402_HEADER_PAYMENT_REQUIRED;
declare const index$1_X402_HEADER_PAYMENT_RESPONSE: typeof X402_HEADER_PAYMENT_RESPONSE;
declare const index$1_X402_HEADER_PAYMENT_SIGNATURE: typeof X402_HEADER_PAYMENT_SIGNATURE;
declare const index$1_X402_VERSION: typeof X402_VERSION;
declare const index$1_buildPumpAgentRequirements: typeof buildPumpAgentRequirements;
declare const index$1_createResourceServer: typeof createResourceServer;
declare const index$1_createX402Fetch: typeof createX402Fetch;
declare const index$1_decodePaymentPayload: typeof decodePaymentPayload;
declare const index$1_decodePaymentRequired: typeof decodePaymentRequired;
declare const index$1_decodePaymentResponse: typeof decodePaymentResponse;
declare const index$1_encodePaymentPayload: typeof encodePaymentPayload;
declare const index$1_encodePaymentRequired: typeof encodePaymentRequired;
declare const index$1_encodePaymentResponse: typeof encodePaymentResponse;
declare const index$1_getPaymentPayloadFromRequest: typeof getPaymentPayloadFromRequest;
declare const index$1_getPaymentRequiredFromResponse: typeof getPaymentRequiredFromResponse;
declare const index$1_getPaymentResponseFromResponse: typeof getPaymentResponseFromResponse;
declare namespace index$1 {
  export { type index$1_ExactPaymentRequirements as ExactPaymentRequirements, type index$1_ExactScheme as ExactScheme, type index$1_FacilitatorClient as FacilitatorClient, type index$1_PaymentPayload as PaymentPayload, type index$1_PaymentRequired as PaymentRequired, type index$1_PaymentRequirements as PaymentRequirements, type index$1_PaymentRequirementsBase as PaymentRequirementsBase, type index$1_PaymentResponse as PaymentResponse, type index$1_PaymentScheme as PaymentScheme, index$1_PumpAgentFacilitator as PumpAgentFacilitator, type index$1_PumpAgentFacilitatorConfig as PumpAgentFacilitatorConfig, type index$1_PumpAgentPaymentRequirements as PumpAgentPaymentRequirements, type index$1_PumpAgentRequirementsConfig as PumpAgentRequirementsConfig, type index$1_PumpAgentScheme as PumpAgentScheme, type index$1_ResourceInfo as ResourceInfo, type index$1_ResourceServerConfig as ResourceServerConfig, index$1_SOLANA_DEVNET as SOLANA_DEVNET, index$1_SOLANA_MAINNET as SOLANA_MAINNET, type index$1_SettleResponse as SettleResponse, type index$1_SupportedKind as SupportedKind, type index$1_SupportedResponse as SupportedResponse, type index$1_TransactionSender as TransactionSender, type index$1_TransactionSigner as TransactionSigner, index$1_USDC_DEVNET as USDC_DEVNET, index$1_USDC_MAINNET as USDC_MAINNET, type index$1_VerifyResponse as VerifyResponse, type index$1_X402ClientConfig as X402ClientConfig, index$1_X402_HEADER_PAYMENT_REQUIRED as X402_HEADER_PAYMENT_REQUIRED, index$1_X402_HEADER_PAYMENT_RESPONSE as X402_HEADER_PAYMENT_RESPONSE, index$1_X402_HEADER_PAYMENT_SIGNATURE as X402_HEADER_PAYMENT_SIGNATURE, index$1_X402_VERSION as X402_VERSION, index$1_buildPumpAgentRequirements as buildPumpAgentRequirements, index$1_createResourceServer as createResourceServer, index$1_createX402Fetch as createX402Fetch, index$1_decodePaymentPayload as decodePaymentPayload, index$1_decodePaymentRequired as decodePaymentRequired, index$1_decodePaymentResponse as decodePaymentResponse, index$1_encodePaymentPayload as encodePaymentPayload, index$1_encodePaymentRequired as encodePaymentRequired, index$1_encodePaymentResponse as encodePaymentResponse, index$1_getPaymentPayloadFromRequest as getPaymentPayloadFromRequest, index$1_getPaymentRequiredFromResponse as getPaymentRequiredFromResponse, index$1_getPaymentResponseFromResponse as getPaymentResponseFromResponse };
}

/**
 * Typed event parser and live subscriber for the pump.fun bonding-curve
 * program (`6EF8rrec...`).
 *
 * Intentionally separate from `./events.ts` which targets the
 * `agent-payments` program. Both programs emit Anchor `emit_cpi!` events
 * but their IDLs are completely different.
 *
 * NOTE: BorshEventCoder returns field names in the snake_case form that
 * appears in the IDL (e.g. `is_buy`, `sol_amount`). Interfaces here mirror
 * that casing so TypeScript types match the runtime values exactly.
 *
 * IDL source: swap/node_modules/@pump-fun/pump-sdk/src/idl/pump.json
 * (the runtime IDL has more fields than pump-public-docs/idl/pump.json).
 */

/** The pump.fun bonding-curve program id. */
declare const PUMP_BONDING_CURVE_PROGRAM_ID: PublicKey;
interface Shareholder {
    address: PublicKey;
    share_bps: number;
}
interface AdminSetCreatorEventData {
    timestamp: BN;
    admin_set_creator_authority: PublicKey;
    mint: PublicKey;
    bonding_curve: PublicKey;
    old_creator: PublicKey;
    new_creator: PublicKey;
}
interface AdminSetIdlAuthorityEventData {
    idl_authority: PublicKey;
}
interface AdminUpdateTokenIncentivesEventData {
    start_time: BN;
    end_time: BN;
    day_number: BN;
    token_supply_per_day: BN;
    mint: PublicKey;
    seconds_in_a_day: BN;
    timestamp: BN;
}
interface ClaimCashbackEventData {
    user: PublicKey;
    amount: BN;
    timestamp: BN;
    total_claimed: BN;
    total_cashback_earned: BN;
}
interface ClaimTokenIncentivesEventData {
    user: PublicKey;
    mint: PublicKey;
    amount: BN;
    timestamp: BN;
    total_claimed_tokens: BN;
    current_sol_volume: BN;
}
interface CloseUserVolumeAccumulatorEventData {
    user: PublicKey;
    timestamp: BN;
    total_unclaimed_tokens: BN;
    total_claimed_tokens: BN;
    current_sol_volume: BN;
    last_update_timestamp: BN;
}
interface CollectCreatorFeeEventData {
    timestamp: BN;
    creator: PublicKey;
    creator_fee: BN;
}
interface CompleteEventData {
    user: PublicKey;
    mint: PublicKey;
    bonding_curve: PublicKey;
    timestamp: BN;
    quote_mint: PublicKey;
}
interface CompletePumpAmmMigrationEventData {
    user: PublicKey;
    mint: PublicKey;
    mint_amount: BN;
    sol_amount: BN;
    pool_migration_fee: BN;
    bonding_curve: PublicKey;
    timestamp: BN;
    pool: PublicKey;
}
interface CreateEventData {
    name: string;
    symbol: string;
    uri: string;
    mint: PublicKey;
    bonding_curve: PublicKey;
    user: PublicKey;
    creator: PublicKey;
    timestamp: BN;
    virtual_token_reserves: BN;
    virtual_sol_reserves: BN;
    real_token_reserves: BN;
    token_total_supply: BN;
    token_program: PublicKey;
    is_mayhem_mode: boolean;
    is_cashback_enabled: boolean;
    quote_mint: PublicKey;
    virtual_quote_reserves: BN;
}
interface DistributeCreatorFeesEventData {
    timestamp: BN;
    mint: PublicKey;
    bonding_curve: PublicKey;
    sharing_config: PublicKey;
    admin: PublicKey;
    shareholders: Shareholder[];
    distributed: BN;
}
interface ExtendAccountEventData {
    account: PublicKey;
    user: PublicKey;
    current_size: BN;
    new_size: BN;
    timestamp: BN;
}
interface InitUserVolumeAccumulatorEventData {
    payer: PublicKey;
    user: PublicKey;
    timestamp: BN;
}
interface MigrateBondingCurveCreatorEventData {
    timestamp: BN;
    mint: PublicKey;
    bonding_curve: PublicKey;
    sharing_config: PublicKey;
    old_creator: PublicKey;
    new_creator: PublicKey;
}
interface MinimumDistributableFeeEventData {
    minimum_required: BN;
    distributable_fees: BN;
    can_distribute: boolean;
}
interface ReservedFeeRecipientsEventData {
    timestamp: BN;
    reserved_fee_recipient: PublicKey;
    reserved_fee_recipients: PublicKey[];
}
interface SetCreatorEventData {
    timestamp: BN;
    mint: PublicKey;
    bonding_curve: PublicKey;
    creator: PublicKey;
}
interface SetMetaplexCreatorEventData {
    timestamp: BN;
    mint: PublicKey;
    bonding_curve: PublicKey;
    metadata: PublicKey;
    creator: PublicKey;
}
interface SetParamsEventData {
    initial_virtual_token_reserves: BN;
    initial_virtual_sol_reserves: BN;
    initial_real_token_reserves: BN;
    final_real_sol_reserves: BN;
    token_total_supply: BN;
    fee_basis_points: BN;
    withdraw_authority: PublicKey;
    enable_migrate: boolean;
    pool_migration_fee: BN;
    creator_fee_basis_points: BN;
    fee_recipients: PublicKey[];
    timestamp: BN;
    set_creator_authority: PublicKey;
    admin_set_creator_authority: PublicKey;
}
interface SyncUserVolumeAccumulatorEventData {
    user: PublicKey;
    total_claimed_tokens_before: BN;
    total_claimed_tokens_after: BN;
    timestamp: BN;
}
interface TradeEventData {
    mint: PublicKey;
    sol_amount: BN;
    token_amount: BN;
    is_buy: boolean;
    user: PublicKey;
    timestamp: BN;
    virtual_sol_reserves: BN;
    virtual_token_reserves: BN;
    real_sol_reserves: BN;
    real_token_reserves: BN;
    fee_recipient: PublicKey;
    fee_basis_points: BN;
    fee: BN;
    creator: PublicKey;
    creator_fee_basis_points: BN;
    creator_fee: BN;
    track_volume: boolean;
    total_unclaimed_tokens: BN;
    total_claimed_tokens: BN;
    current_sol_volume: BN;
    last_update_timestamp: BN;
    ix_name: string;
    mayhem_mode: boolean;
    cashback_fee_basis_points: BN;
    cashback: BN;
    buyback_fee_basis_points: BN;
    buyback_fee: BN;
    shareholders: Shareholder[];
    quote_mint: PublicKey;
    quote_amount: BN;
    virtual_quote_reserves: BN;
    real_quote_reserves: BN;
}
interface UpdateGlobalAuthorityEventData {
    global: PublicKey;
    authority: PublicKey;
    new_authority: PublicKey;
    timestamp: BN;
}
interface UpdateMayhemVirtualParamsEventData {
    timestamp: BN;
    mint: PublicKey;
    virtual_token_reserves: BN;
    virtual_sol_reserves: BN;
    new_virtual_token_reserves: BN;
    new_virtual_sol_reserves: BN;
    real_token_reserves: BN;
    real_sol_reserves: BN;
}
interface PumpEventDataMap {
    AdminSetCreatorEvent: AdminSetCreatorEventData;
    AdminSetIdlAuthorityEvent: AdminSetIdlAuthorityEventData;
    AdminUpdateTokenIncentivesEvent: AdminUpdateTokenIncentivesEventData;
    ClaimCashbackEvent: ClaimCashbackEventData;
    ClaimTokenIncentivesEvent: ClaimTokenIncentivesEventData;
    CloseUserVolumeAccumulatorEvent: CloseUserVolumeAccumulatorEventData;
    CollectCreatorFeeEvent: CollectCreatorFeeEventData;
    CompleteEvent: CompleteEventData;
    CompletePumpAmmMigrationEvent: CompletePumpAmmMigrationEventData;
    CreateEvent: CreateEventData;
    DistributeCreatorFeesEvent: DistributeCreatorFeesEventData;
    ExtendAccountEvent: ExtendAccountEventData;
    InitUserVolumeAccumulatorEvent: InitUserVolumeAccumulatorEventData;
    MigrateBondingCurveCreatorEvent: MigrateBondingCurveCreatorEventData;
    MinimumDistributableFeeEvent: MinimumDistributableFeeEventData;
    ReservedFeeRecipientsEvent: ReservedFeeRecipientsEventData;
    SetCreatorEvent: SetCreatorEventData;
    SetMetaplexCreatorEvent: SetMetaplexCreatorEventData;
    SetParamsEvent: SetParamsEventData;
    SyncUserVolumeAccumulatorEvent: SyncUserVolumeAccumulatorEventData;
    TradeEvent: TradeEventData;
    UpdateGlobalAuthorityEvent: UpdateGlobalAuthorityEventData;
    UpdateMayhemVirtualParamsEvent: UpdateMayhemVirtualParamsEventData;
}
type PumpEventName = keyof PumpEventDataMap;
interface ParsedPumpEvent<E extends PumpEventName = PumpEventName> {
    name: E;
    data: PumpEventDataMap[E];
    signature?: string;
    slot?: number;
}
/** Maps each IDL event name to its 8-byte discriminator Buffer. */
declare const eventDiscriminatorMap: Map<PumpEventName, Buffer>;
interface PumpEventParser {
    /**
     * Decode transaction log messages into typed pump events.
     * Lines not starting with `Program data: `, or with an unknown
     * discriminator, are silently ignored.
     */
    parseLogs(logs: string[]): ParsedPumpEvent[];
}
declare function createPumpEventParser(): PumpEventParser;
interface SubscribePumpEventsOptions {
    /** Filter events that carry a `mint` field matching this key. */
    mint?: PublicKey;
    /** Override the bonding-curve program id. */
    programId?: PublicKey;
    /** Commitment level (default: `confirmed`). */
    commitment?: Commitment;
}
interface PumpEventSubscription {
    /** Stop listening. Idempotent — safe to call multiple times. */
    unsubscribe: () => Promise<void>;
}
/** Narrow subset of `Connection` used here; makes unit-testing easy. */
type LogsSubscriber = Pick<Connection, "onLogs" | "removeOnLogsListener">;
/**
 * Subscribe to real-time pump bonding-curve program events via WebSocket.
 *
 * @example
 * ```ts
 * const sub = subscribeToPumpEvents(connection, { mint }, (ev) => {
 *   if (ev.name === "TradeEvent") console.log(ev.data.sol_amount.toString());
 * });
 * await sub.unsubscribe();
 * ```
 */
declare function subscribeToPumpEvents(connection: LogsSubscriber, options: SubscribePumpEventsOptions, onEvent: (event: ParsedPumpEvent) => void): PumpEventSubscription;

type pumpEvents_AdminSetCreatorEventData = AdminSetCreatorEventData;
type pumpEvents_AdminSetIdlAuthorityEventData = AdminSetIdlAuthorityEventData;
type pumpEvents_AdminUpdateTokenIncentivesEventData = AdminUpdateTokenIncentivesEventData;
type pumpEvents_ClaimCashbackEventData = ClaimCashbackEventData;
type pumpEvents_ClaimTokenIncentivesEventData = ClaimTokenIncentivesEventData;
type pumpEvents_CloseUserVolumeAccumulatorEventData = CloseUserVolumeAccumulatorEventData;
type pumpEvents_CollectCreatorFeeEventData = CollectCreatorFeeEventData;
type pumpEvents_CompleteEventData = CompleteEventData;
type pumpEvents_CompletePumpAmmMigrationEventData = CompletePumpAmmMigrationEventData;
type pumpEvents_CreateEventData = CreateEventData;
type pumpEvents_DistributeCreatorFeesEventData = DistributeCreatorFeesEventData;
type pumpEvents_ExtendAccountEventData = ExtendAccountEventData;
type pumpEvents_InitUserVolumeAccumulatorEventData = InitUserVolumeAccumulatorEventData;
type pumpEvents_LogsSubscriber = LogsSubscriber;
type pumpEvents_MigrateBondingCurveCreatorEventData = MigrateBondingCurveCreatorEventData;
type pumpEvents_MinimumDistributableFeeEventData = MinimumDistributableFeeEventData;
declare const pumpEvents_PUMP_BONDING_CURVE_PROGRAM_ID: typeof PUMP_BONDING_CURVE_PROGRAM_ID;
type pumpEvents_ParsedPumpEvent<E extends PumpEventName = PumpEventName> = ParsedPumpEvent<E>;
type pumpEvents_PumpEventDataMap = PumpEventDataMap;
type pumpEvents_PumpEventName = PumpEventName;
type pumpEvents_PumpEventParser = PumpEventParser;
type pumpEvents_PumpEventSubscription = PumpEventSubscription;
type pumpEvents_ReservedFeeRecipientsEventData = ReservedFeeRecipientsEventData;
type pumpEvents_SetCreatorEventData = SetCreatorEventData;
type pumpEvents_SetMetaplexCreatorEventData = SetMetaplexCreatorEventData;
type pumpEvents_SetParamsEventData = SetParamsEventData;
type pumpEvents_Shareholder = Shareholder;
type pumpEvents_SubscribePumpEventsOptions = SubscribePumpEventsOptions;
type pumpEvents_SyncUserVolumeAccumulatorEventData = SyncUserVolumeAccumulatorEventData;
type pumpEvents_TradeEventData = TradeEventData;
type pumpEvents_UpdateGlobalAuthorityEventData = UpdateGlobalAuthorityEventData;
type pumpEvents_UpdateMayhemVirtualParamsEventData = UpdateMayhemVirtualParamsEventData;
declare const pumpEvents_createPumpEventParser: typeof createPumpEventParser;
declare const pumpEvents_eventDiscriminatorMap: typeof eventDiscriminatorMap;
declare const pumpEvents_subscribeToPumpEvents: typeof subscribeToPumpEvents;
declare namespace pumpEvents {
  export { type pumpEvents_AdminSetCreatorEventData as AdminSetCreatorEventData, type pumpEvents_AdminSetIdlAuthorityEventData as AdminSetIdlAuthorityEventData, type pumpEvents_AdminUpdateTokenIncentivesEventData as AdminUpdateTokenIncentivesEventData, type pumpEvents_ClaimCashbackEventData as ClaimCashbackEventData, type pumpEvents_ClaimTokenIncentivesEventData as ClaimTokenIncentivesEventData, type pumpEvents_CloseUserVolumeAccumulatorEventData as CloseUserVolumeAccumulatorEventData, type pumpEvents_CollectCreatorFeeEventData as CollectCreatorFeeEventData, type pumpEvents_CompleteEventData as CompleteEventData, type pumpEvents_CompletePumpAmmMigrationEventData as CompletePumpAmmMigrationEventData, type pumpEvents_CreateEventData as CreateEventData, type pumpEvents_DistributeCreatorFeesEventData as DistributeCreatorFeesEventData, type pumpEvents_ExtendAccountEventData as ExtendAccountEventData, type pumpEvents_InitUserVolumeAccumulatorEventData as InitUserVolumeAccumulatorEventData, type pumpEvents_LogsSubscriber as LogsSubscriber, type pumpEvents_MigrateBondingCurveCreatorEventData as MigrateBondingCurveCreatorEventData, type pumpEvents_MinimumDistributableFeeEventData as MinimumDistributableFeeEventData, pumpEvents_PUMP_BONDING_CURVE_PROGRAM_ID as PUMP_BONDING_CURVE_PROGRAM_ID, type pumpEvents_ParsedPumpEvent as ParsedPumpEvent, type pumpEvents_PumpEventDataMap as PumpEventDataMap, type pumpEvents_PumpEventName as PumpEventName, type pumpEvents_PumpEventParser as PumpEventParser, type pumpEvents_PumpEventSubscription as PumpEventSubscription, type pumpEvents_ReservedFeeRecipientsEventData as ReservedFeeRecipientsEventData, type pumpEvents_SetCreatorEventData as SetCreatorEventData, type pumpEvents_SetMetaplexCreatorEventData as SetMetaplexCreatorEventData, type pumpEvents_SetParamsEventData as SetParamsEventData, type pumpEvents_Shareholder as Shareholder, type pumpEvents_SubscribePumpEventsOptions as SubscribePumpEventsOptions, type pumpEvents_SyncUserVolumeAccumulatorEventData as SyncUserVolumeAccumulatorEventData, type pumpEvents_TradeEventData as TradeEventData, type pumpEvents_UpdateGlobalAuthorityEventData as UpdateGlobalAuthorityEventData, type pumpEvents_UpdateMayhemVirtualParamsEventData as UpdateMayhemVirtualParamsEventData, pumpEvents_createPumpEventParser as createPumpEventParser, pumpEvents_eventDiscriminatorMap as eventDiscriminatorMap, pumpEvents_subscribeToPumpEvents as subscribeToPumpEvents };
}

/**
 * PumpTradeClient — v2 bonding-curve buy / sell / exact-quote / cashback.
 *
 * All build* methods batch Global + FeeConfig + bondingCurve (+ userAta for buy)
 * into a SINGLE getMultipleAccountsInfo call. No sequential RPC.
 *
 * Routing: reads bondingCurve.quoteMint on-chain → SOL-paired or USDC-paired
 * coins are handled identically. Zero changes needed when USDC coins go live.
 */

/** Coin has graduated (bondingCurve.complete === true). Use AMM. */
declare class CoinGraduatedError extends Error {
    constructor(mint: PublicKey);
}
/** No bonding curve account exists for the mint. */
declare class CoinNotFoundError extends Error {
    constructor(mint: PublicKey);
}
/** Requested amount exceeds available reserves. */
declare class InsufficientLiquidityError extends Error {
    constructor(message: string);
}
/** Quote mint is not in the pump.fun whitelist. */
declare class UnsupportedQuoteMintError extends Error {
    constructor(quoteMint: PublicKey);
}
declare class PumpTradeClient {
    private readonly connection;
    /** quoteMint never changes once a coin is created — safe to cache forever. */
    private readonly quoteMintCache;
    /** Token program for a quote mint (also stable after mint creation). */
    private readonly tokenProgramCache;
    constructor(connection: Connection);
    /** Read bondingCurve.quoteMint from chain, normalize default → NATIVE_MINT. Caches. */
    resolveQuoteMint(mint: PublicKey): Promise<PublicKey>;
    quoteForBuy(params: {
        mint: PublicKey;
        quoteAmount: BN;
        slippagePct?: number;
    }): Promise<BuyQuote>;
    quoteForSell(params: {
        mint: PublicKey;
        baseAmount: BN;
        slippagePct?: number;
    }): Promise<SellQuote>;
    buildBuyInstructions(params: {
        mint: PublicKey;
        user: PublicKey;
        quoteAmount: BN;
        slippagePct?: number;
    }): Promise<BuyResult>;
    buildSellInstructions(params: {
        mint: PublicKey;
        user: PublicKey;
        baseAmount: BN;
        slippagePct?: number;
    }): Promise<SellResult>;
    /**
     * Build buy_exact_quote_in_v2. Drives the Anchor program directly because
     * the SDK has no JS helper for this instruction. Mirrors
     * swap/scripts/build-buy-exact-quote-in-v2-tx.mjs exactly.
     */
    buildBuyExactQuoteInInstructions(params: {
        mint: PublicKey;
        user: PublicKey;
        spendableQuoteIn: BN;
        minBaseOut: BN;
    }): Promise<ExactQuoteResult>;
    /**
     * Auto-discovers claimable quote mints by calling getTokenAccountsByOwner on
     * the UserVolumeAccumulator PDA. Any non-zero ATA → claimable cashback.
     * Pass quoteMints to skip discovery.
     */
    buildClaimCashbackInstructions(params: {
        user: PublicKey;
        quoteMints?: PublicKey[];
    }): Promise<TransactionInstruction[]>;
    private _discoverCashbackMints;
    private _baseTokenProgram;
    private _quoteTokenProgram;
    /**
     * Convenience: fetch + decode + throw in one call for quote methods.
     * Does NOT batch with userAta (quote methods don't need it).
     */
    private _fetchAndDecode;
    /** Exported for convenience; USDC mainnet address. */
    static readonly USDC_MINT: PublicKey;
}

/**
 * @pump-fun/agent-payments-sdk
 * TypeScript SDK for Pump Agent Payments
 */

declare const PUMP_AGENT_PAYMENTS_PROGRAM_ID: PublicKey;
declare function getProgram(connection: Connection): Program<PumpAgentPayments>;

type index_AcceptPaymentParams = AcceptPaymentParams;
type index_AcceptPaymentSimpleParams = AcceptPaymentSimpleParams;
type index_AgentAcceptPaymentEvent = AgentAcceptPaymentEvent;
type index_AgentBalances = AgentBalances;
type index_AgentBuybackTriggerEvent = AgentBuybackTriggerEvent;
type index_AgentDistributePaymentsEvent = AgentDistributePaymentsEvent;
type index_AgentEventData = AgentEventData;
type index_AgentEventName = AgentEventName;
type index_AgentInitializeEvent = AgentInitializeEvent;
type index_AgentUpdateAuthorityEvent = AgentUpdateAuthorityEvent;
type index_AgentUpdateBuybackBpsEvent = AgentUpdateBuybackBpsEvent;
type index_AgentWithdrawEvent = AgentWithdrawEvent;
declare const index_BONDING_CURVE_SEED: typeof BONDING_CURVE_SEED;
declare const index_BUYBACK_AUTHORITY_SEED: typeof BUYBACK_AUTHORITY_SEED;
type index_BuildAcceptPaymentParams = BuildAcceptPaymentParams;
type index_BuyQuote = BuyQuote;
type index_BuyResult = BuyResult;
type index_BuybackTriggerParams = BuybackTriggerParams;
type index_CloseAccountParams = CloseAccountParams;
type index_CoinGraduatedError = CoinGraduatedError;
declare const index_CoinGraduatedError: typeof CoinGraduatedError;
type index_CoinNotFoundError = CoinNotFoundError;
declare const index_CoinNotFoundError: typeof CoinNotFoundError;
type index_CreateParams = CreateParams;
type index_CurrencyNotSupportedError = CurrencyNotSupportedError;
declare const index_CurrencyNotSupportedError: typeof CurrencyNotSupportedError;
type index_DistributePaymentsParams = DistributePaymentsParams;
type index_EventSubscription = EventSubscription;
type index_EventSubscriptionOptions = EventSubscriptionOptions;
type index_ExactQuoteResult = ExactQuoteResult;
type index_ExtendAccountEvent = ExtendAccountEvent;
type index_ExtendAccountParams = ExtendAccountParams;
declare const index_GLOBAL_CONFIG_SEED: typeof GLOBAL_CONFIG_SEED;
type index_GlobalAddNewCurrencyEvent = GlobalAddNewCurrencyEvent;
type index_GlobalConfig = GlobalConfig;
type index_GlobalConfigInitializeEvent = GlobalConfigInitializeEvent;
type index_GlobalUpdateAuthoritiesEvent = GlobalUpdateAuthoritiesEvent;
declare const index_INVOICE_ID_SEED: typeof INVOICE_ID_SEED;
type index_InsufficientLiquidityError = InsufficientLiquidityError;
declare const index_InsufficientLiquidityError: typeof InsufficientLiquidityError;
type index_JupiterUnavailableError = JupiterUnavailableError;
declare const index_JupiterUnavailableError: typeof JupiterUnavailableError;
declare const index_OFFLINE_PUMP_PROGRAM: typeof OFFLINE_PUMP_PROGRAM;
declare const index_PAYMENT_IN_CURRENCY_SEED: typeof PAYMENT_IN_CURRENCY_SEED;
declare const index_PROGRAM_ID: typeof PROGRAM_ID;
declare const index_PUMP_AGENT_PAYMENTS_PROGRAM_ID: typeof PUMP_AGENT_PAYMENTS_PROGRAM_ID;
declare const index_PUMP_FEES_PROGRAM_ID: typeof PUMP_FEES_PROGRAM_ID;
declare const index_PUMP_PROGRAM_ID: typeof PUMP_PROGRAM_ID;
type index_ParsedAgentEvent<T extends AgentEventData = AgentEventData> = ParsedAgentEvent<T>;
type index_PumpAgent = PumpAgent;
declare const index_PumpAgent: typeof PumpAgent;
type index_PumpAgentOffline = PumpAgentOffline;
declare const index_PumpAgentOffline: typeof PumpAgentOffline;
type index_PumpAgentPayments = PumpAgentPayments;
declare const index_PumpAgentPaymentsPlugin: typeof PumpAgentPaymentsPlugin;
type index_PumpEnvironment = PumpEnvironment;
type index_PumpTradeClient = PumpTradeClient;
declare const index_PumpTradeClient: typeof PumpTradeClient;
declare const index_SHARING_CONFIG_SEED: typeof SHARING_CONFIG_SEED;
type index_SellQuote = SellQuote;
type index_SellResult = SellResult;
declare const index_TOKEN_AGENT_PAYMENTS_MIN_RENT_EXEMPT_LAMPORTS: typeof TOKEN_AGENT_PAYMENTS_MIN_RENT_EXEMPT_LAMPORTS;
declare const index_TOKEN_AGENT_PAYMENTS_SEED: typeof TOKEN_AGENT_PAYMENTS_SEED;
type index_TokenAgentPaymentInCurrency = TokenAgentPaymentInCurrency;
type index_TokenAgentPayments = TokenAgentPayments;
declare const index_USDC_MINT: typeof USDC_MINT;
type index_UnsupportedQuoteMintError = UnsupportedQuoteMintError;
declare const index_UnsupportedQuoteMintError: typeof UnsupportedQuoteMintError;
type index_UpdateAuthorityParams = UpdateAuthorityParams;
type index_UpdateBuybackBpsOptions = UpdateBuybackBpsOptions;
type index_UpdateBuybackBpsParams = UpdateBuybackBpsParams;
type index_VaultBalance = VaultBalance;
declare const index_WITHDRAW_AUTHORITY_SEED: typeof WITHDRAW_AUTHORITY_SEED;
type index_WithdrawParams = WithdrawParams;
declare const index_createEventParser: typeof createEventParser;
declare const index_decodeBondingCurveQuoteMint: typeof decodeBondingCurveQuoteMint;
declare const index_decodeGlobalConfig: typeof decodeGlobalConfig;
declare const index_decodeTokenAgentPaymentInCurrency: typeof decodeTokenAgentPaymentInCurrency;
declare const index_decodeTokenAgentPayments: typeof decodeTokenAgentPayments;
declare const index_getBondingCurvePDA: typeof getBondingCurvePDA;
declare const index_getBuybackAuthorityPDA: typeof getBuybackAuthorityPDA;
declare const index_getGlobalConfigPDA: typeof getGlobalConfigPDA;
declare const index_getInvoiceIdPDA: typeof getInvoiceIdPDA;
declare const index_getOfflineProgram: typeof getOfflineProgram;
declare const index_getPaymentInCurrencyPDA: typeof getPaymentInCurrencyPDA;
declare const index_getProgram: typeof getProgram;
declare const index_getPumpProgram: typeof getPumpProgram;
declare const index_getPumpProgramWithFallback: typeof getPumpProgramWithFallback;
declare const index_getSharingConfigPDA: typeof getSharingConfigPDA;
declare const index_getTokenAgentPaymentsPDA: typeof getTokenAgentPaymentsPDA;
declare const index_getWithdrawAuthorityPDA: typeof getWithdrawAuthorityPDA;
declare const index_parseAgentEvents: typeof parseAgentEvents;
declare const index_pumpEvents: typeof pumpEvents;
declare const index_resolveTokenProgramForMint: typeof resolveTokenProgramForMint;
declare const index_subscribeToAgentEvents: typeof subscribeToAgentEvents;
declare namespace index {
  export { type index_AcceptPaymentParams as AcceptPaymentParams, type index_AcceptPaymentSimpleParams as AcceptPaymentSimpleParams, type index_AgentAcceptPaymentEvent as AgentAcceptPaymentEvent, type index_AgentBalances as AgentBalances, type index_AgentBuybackTriggerEvent as AgentBuybackTriggerEvent, type index_AgentDistributePaymentsEvent as AgentDistributePaymentsEvent, type index_AgentEventData as AgentEventData, type index_AgentEventName as AgentEventName, type index_AgentInitializeEvent as AgentInitializeEvent, type index_AgentUpdateAuthorityEvent as AgentUpdateAuthorityEvent, type index_AgentUpdateBuybackBpsEvent as AgentUpdateBuybackBpsEvent, type index_AgentWithdrawEvent as AgentWithdrawEvent, index_BONDING_CURVE_SEED as BONDING_CURVE_SEED, index_BUYBACK_AUTHORITY_SEED as BUYBACK_AUTHORITY_SEED, type index_BuildAcceptPaymentParams as BuildAcceptPaymentParams, type index_BuyQuote as BuyQuote, type index_BuyResult as BuyResult, type index_BuybackTriggerParams as BuybackTriggerParams, type index_CloseAccountParams as CloseAccountParams, index_CoinGraduatedError as CoinGraduatedError, index_CoinNotFoundError as CoinNotFoundError, type index_CreateParams as CreateParams, index_CurrencyNotSupportedError as CurrencyNotSupportedError, type index_DistributePaymentsParams as DistributePaymentsParams, type index_EventSubscription as EventSubscription, type index_EventSubscriptionOptions as EventSubscriptionOptions, type index_ExactQuoteResult as ExactQuoteResult, type index_ExtendAccountEvent as ExtendAccountEvent, type index_ExtendAccountParams as ExtendAccountParams, index_GLOBAL_CONFIG_SEED as GLOBAL_CONFIG_SEED, type index_GlobalAddNewCurrencyEvent as GlobalAddNewCurrencyEvent, type index_GlobalConfig as GlobalConfig, type index_GlobalConfigInitializeEvent as GlobalConfigInitializeEvent, type index_GlobalUpdateAuthoritiesEvent as GlobalUpdateAuthoritiesEvent, index_INVOICE_ID_SEED as INVOICE_ID_SEED, index_InsufficientLiquidityError as InsufficientLiquidityError, index_JupiterUnavailableError as JupiterUnavailableError, index_OFFLINE_PUMP_PROGRAM as OFFLINE_PUMP_PROGRAM, index_PAYMENT_IN_CURRENCY_SEED as PAYMENT_IN_CURRENCY_SEED, index_PROGRAM_ID as PROGRAM_ID, index_PUMP_AGENT_PAYMENTS_PROGRAM_ID as PUMP_AGENT_PAYMENTS_PROGRAM_ID, index_PUMP_FEES_PROGRAM_ID as PUMP_FEES_PROGRAM_ID, index_PUMP_PROGRAM_ID as PUMP_PROGRAM_ID, type index_ParsedAgentEvent as ParsedAgentEvent, index_PumpAgent as PumpAgent, index_PumpAgentOffline as PumpAgentOffline, type index_PumpAgentPayments as PumpAgentPayments, index_PumpAgentPaymentsPlugin as PumpAgentPaymentsPlugin, type index_PumpEnvironment as PumpEnvironment, index_PumpTradeClient as PumpTradeClient, index_SHARING_CONFIG_SEED as SHARING_CONFIG_SEED, type index_SellQuote as SellQuote, type index_SellResult as SellResult, index_TOKEN_AGENT_PAYMENTS_MIN_RENT_EXEMPT_LAMPORTS as TOKEN_AGENT_PAYMENTS_MIN_RENT_EXEMPT_LAMPORTS, index_TOKEN_AGENT_PAYMENTS_SEED as TOKEN_AGENT_PAYMENTS_SEED, type index_TokenAgentPaymentInCurrency as TokenAgentPaymentInCurrency, type index_TokenAgentPayments as TokenAgentPayments, index_USDC_MINT as USDC_MINT, index_UnsupportedQuoteMintError as UnsupportedQuoteMintError, type index_UpdateAuthorityParams as UpdateAuthorityParams, type index_UpdateBuybackBpsOptions as UpdateBuybackBpsOptions, type index_UpdateBuybackBpsParams as UpdateBuybackBpsParams, type index_VaultBalance as VaultBalance, index_WITHDRAW_AUTHORITY_SEED as WITHDRAW_AUTHORITY_SEED, type index_WithdrawParams as WithdrawParams, index_createEventParser as createEventParser, index_decodeBondingCurveQuoteMint as decodeBondingCurveQuoteMint, index_decodeGlobalConfig as decodeGlobalConfig, index_decodeTokenAgentPaymentInCurrency as decodeTokenAgentPaymentInCurrency, index_decodeTokenAgentPayments as decodeTokenAgentPayments, index_getBondingCurvePDA as getBondingCurvePDA, index_getBuybackAuthorityPDA as getBuybackAuthorityPDA, index_getGlobalConfigPDA as getGlobalConfigPDA, index_getInvoiceIdPDA as getInvoiceIdPDA, index_getOfflineProgram as getOfflineProgram, index_getPaymentInCurrencyPDA as getPaymentInCurrencyPDA, index_getProgram as getProgram, index_getPumpProgram as getPumpProgram, index_getPumpProgramWithFallback as getPumpProgramWithFallback, index_getSharingConfigPDA as getSharingConfigPDA, index_getTokenAgentPaymentsPDA as getTokenAgentPaymentsPDA, index_getWithdrawAuthorityPDA as getWithdrawAuthorityPDA, index$2 as legacyAgentPayments, index_parseAgentEvents as parseAgentEvents, index_pumpEvents as pumpEvents, index_resolveTokenProgramForMint as resolveTokenProgramForMint, index_subscribeToAgentEvents as subscribeToAgentEvents, index$1 as x402 };
}

export { TOKEN_AGENT_PAYMENTS_SEED as $, type AcceptPaymentParams as A, BONDING_CURVE_SEED as B, type CloseAccountParams as C, type DistributePaymentsParams as D, type EventSubscription as E, type GlobalConfigInitializeEvent as F, GLOBAL_CONFIG_SEED as G, type GlobalUpdateAuthoritiesEvent as H, INVOICE_ID_SEED as I, InsufficientLiquidityError as J, JupiterUnavailableError as K, PROGRAM_ID as L, PUMP_AGENT_PAYMENTS_PROGRAM_ID as M, PUMP_FEES_PROGRAM_ID as N, OFFLINE_PUMP_PROGRAM as O, PAYMENT_IN_CURRENCY_SEED as P, PUMP_PROGRAM_ID as Q, type ParsedAgentEvent as R, PumpAgent as S, PumpAgentOffline as T, type PumpAgentPayments as U, type PumpEnvironment as V, PumpTradeClient as W, SHARING_CONFIG_SEED as X, type SellQuote as Y, type SellResult as Z, TOKEN_AGENT_PAYMENTS_MIN_RENT_EXEMPT_LAMPORTS as _, type AcceptPaymentSimpleParams as a, type TokenAgentPaymentInCurrency as a0, type TokenAgentPayments as a1, USDC_MINT as a2, UnsupportedQuoteMintError as a3, type UpdateAuthorityParams as a4, type UpdateBuybackBpsOptions as a5, type UpdateBuybackBpsParams as a6, type VaultBalance as a7, WITHDRAW_AUTHORITY_SEED as a8, type WithdrawParams as a9, createEventParser as aa, decodeBondingCurveQuoteMint as ab, decodeGlobalConfig as ac, decodeTokenAgentPaymentInCurrency as ad, decodeTokenAgentPayments as ae, getBondingCurvePDA as af, getBuybackAuthorityPDA as ag, getGlobalConfigPDA as ah, getInvoiceIdPDA as ai, getOfflineProgram as aj, getPaymentInCurrencyPDA as ak, getProgram as al, getPumpProgram as am, getPumpProgramWithFallback as an, getSharingConfigPDA as ao, getTokenAgentPaymentsPDA as ap, getWithdrawAuthorityPDA as aq, parseAgentEvents as ar, pumpEvents as as, resolveTokenProgramForMint as at, index as au, subscribeToAgentEvents as av, index$1 as aw, type AgentAcceptPaymentEvent as b, type AgentBalances as c, type AgentBuybackTriggerEvent as d, type AgentDistributePaymentsEvent as e, type AgentEventData as f, type AgentEventName as g, type AgentInitializeEvent as h, type AgentUpdateAuthorityEvent as i, type AgentUpdateBuybackBpsEvent as j, type AgentWithdrawEvent as k, BUYBACK_AUTHORITY_SEED as l, type BuildAcceptPaymentParams as m, type BuyQuote as n, type BuyResult as o, type BuybackTriggerParams as p, CoinGraduatedError as q, CoinNotFoundError as r, type CreateParams as s, CurrencyNotSupportedError as t, type EventSubscriptionOptions as u, type ExactQuoteResult as v, type ExtendAccountEvent as w, type ExtendAccountParams as x, type GlobalAddNewCurrencyEvent as y, type GlobalConfig as z };
