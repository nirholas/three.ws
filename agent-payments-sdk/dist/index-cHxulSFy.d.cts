import { PublicKey, Connection, AccountMeta, TransactionInstruction } from '@solana/web3.js';
import { BN, Program } from '@coral-xyz/anchor';

declare const LEGACY_AGENT_PAYMENTS_PROGRAM_ID: PublicKey;
declare const PUMP_PROGRAM_ID: PublicKey;
declare const GLOBAL_CONFIG_SEED: Buffer<ArrayBuffer>;
declare const TOKEN_AGENT_PAYMENTS_SEED: Buffer<ArrayBuffer>;
declare const PAYMENT_IN_CURRENCY_SEED: Buffer<ArrayBuffer>;
declare const INVOICE_ID_SEED: Buffer<ArrayBuffer>;
declare const BUYBACK_AUTHORITY_SEED: Buffer<ArrayBuffer>;
declare const WITHDRAW_AUTHORITY_SEED: Buffer<ArrayBuffer>;
declare const BONDING_CURVE_SEED: Buffer<ArrayBuffer>;
declare function getGlobalConfigPDA(): [PublicKey, number];
declare function getTokenAgentPaymentsPDA(mint: PublicKey): [PublicKey, number];
declare function getPaymentInCurrencyPDA(tokenMint: PublicKey, currencyMint: PublicKey): [PublicKey, number];
declare function getInvoiceIdPDA(tokenMint: PublicKey, currencyMint: PublicKey, amount: BN, memo: BN, startTime: BN, endTime: BN): [PublicKey, number];
declare function getBuybackAuthorityPDA(tokenMint: PublicKey): [PublicKey, number];
declare function getWithdrawAuthorityPDA(tokenMint: PublicKey): [PublicKey, number];
/**
 * Note: BondingCurve PDA is owned by the pump program, not the legacy
 * agent-payments program — it lives on the *pump* program ID. The legacy
 * SDK uses the same seed scheme as the modern bonding curve.
 */
declare function getBondingCurvePDA(mint: PublicKey): [PublicKey, number];

/**
 * Program IDL for the legacy 1.0.7 release of @pump-fun/agent-payments-sdk.
 * Address: pUmPFn9WvfaN2WTVGnCEtJTd2ATTpvpsKRz6jVzu6u4
 */
type LegacyPumpAgentPayments = {
    "address": "pUmPFn9WvfaN2WTVGnCEtJTd2ATTpvpsKRz6jVzu6u4";
    "metadata": {
        "name": "pumpAgentPayments";
        "version": "0.1.0";
        "spec": "0.1.0";
        "description": "Created with Anchor";
    };
    "instructions": [
        {
            "name": "agentAcceptPayment";
            "discriminator": [
                34,
                157,
                64,
                220,
                74,
                32,
                48,
                225
            ];
            "accounts": [
                {
                    "name": "user";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "userTokenAccount";
                    "writable": true;
                },
                {
                    "name": "tokenAgentPayments";
                },
                {
                    "name": "tokenAgentAssociatedAccount";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "account";
                                "path": "tokenAgentPayments";
                            },
                            {
                                "kind": "const";
                                "value": [
                                    6,
                                    221,
                                    246,
                                    225,
                                    215,
                                    101,
                                    161,
                                    147,
                                    217,
                                    203,
                                    225,
                                    70,
                                    206,
                                    235,
                                    121,
                                    172,
                                    28,
                                    180,
                                    133,
                                    237,
                                    95,
                                    91,
                                    55,
                                    145,
                                    58,
                                    140,
                                    245,
                                    133,
                                    126,
                                    255,
                                    0,
                                    169
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "currencyMint";
                            }
                        ];
                        "program": {
                            "kind": "const";
                            "value": [
                                140,
                                151,
                                37,
                                143,
                                78,
                                36,
                                137,
                                241,
                                187,
                                61,
                                16,
                                41,
                                20,
                                142,
                                13,
                                131,
                                11,
                                90,
                                19,
                                153,
                                218,
                                255,
                                16,
                                132,
                                4,
                                142,
                                123,
                                216,
                                219,
                                233,
                                248,
                                89
                            ];
                        };
                    };
                },
                {
                    "name": "tokenAgentPaymentInCurrency";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    112,
                                    97,
                                    121,
                                    109,
                                    101,
                                    110,
                                    116,
                                    45,
                                    105,
                                    110,
                                    45,
                                    99,
                                    117,
                                    114,
                                    114,
                                    101,
                                    110,
                                    99,
                                    121
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "token_agent_payments.mint";
                                "account": "tokenAgentPayments";
                            },
                            {
                                "kind": "account";
                                "path": "currencyMint";
                            }
                        ];
                    };
                },
                {
                    "name": "globalConfig";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    103,
                                    108,
                                    111,
                                    98,
                                    97,
                                    108,
                                    45,
                                    99,
                                    111,
                                    110,
                                    102,
                                    105,
                                    103
                                ];
                            }
                        ];
                    };
                },
                {
                    "name": "invoiceId";
                },
                {
                    "name": "currencyMint";
                },
                {
                    "name": "tokenProgram";
                },
                {
                    "name": "associatedTokenProgram";
                    "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
                },
                {
                    "name": "systemProgram";
                    "address": "11111111111111111111111111111111";
                },
                {
                    "name": "eventAuthority";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    95,
                                    95,
                                    101,
                                    118,
                                    101,
                                    110,
                                    116,
                                    95,
                                    97,
                                    117,
                                    116,
                                    104,
                                    111,
                                    114,
                                    105,
                                    116,
                                    121
                                ];
                            }
                        ];
                    };
                },
                {
                    "name": "program";
                }
            ];
            "args": [
                {
                    "name": "amount";
                    "type": "u64";
                },
                {
                    "name": "memo";
                    "type": "u64";
                },
                {
                    "name": "startTime";
                    "type": "i64";
                },
                {
                    "name": "endTime";
                    "type": "i64";
                }
            ];
        },
        {
            "name": "agentBuybackTrigger";
            "discriminator": [
                95,
                231,
                193,
                2,
                245,
                75,
                125,
                155
            ];
            "accounts": [
                {
                    "name": "globalBuybackAuthority";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "mint";
                    "writable": true;
                },
                {
                    "name": "tokenAgentPayments";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    116,
                                    111,
                                    107,
                                    101,
                                    110,
                                    45,
                                    97,
                                    103,
                                    101,
                                    110,
                                    116,
                                    45,
                                    112,
                                    97,
                                    121,
                                    109,
                                    101,
                                    110,
                                    116,
                                    115
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "mint";
                            }
                        ];
                    };
                },
                {
                    "name": "tokenAgentPaymentInCurrency";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    112,
                                    97,
                                    121,
                                    109,
                                    101,
                                    110,
                                    116,
                                    45,
                                    105,
                                    110,
                                    45,
                                    99,
                                    117,
                                    114,
                                    114,
                                    101,
                                    110,
                                    99,
                                    121
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "token_agent_payments.mint";
                                "account": "tokenAgentPayments";
                            },
                            {
                                "kind": "account";
                                "path": "currencyMint";
                            }
                        ];
                    };
                },
                {
                    "name": "currencyMint";
                },
                {
                    "name": "globalConfig";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    103,
                                    108,
                                    111,
                                    98,
                                    97,
                                    108,
                                    45,
                                    99,
                                    111,
                                    110,
                                    102,
                                    105,
                                    103
                                ];
                            }
                        ];
                    };
                },
                {
                    "name": "swapProgramToInvoke";
                },
                {
                    "name": "burnAuthority";
                    "docs": [
                        "Intentionally called burn_authority",
                        "TO avoid any confusion with the global buyback authority."
                    ];
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    98,
                                    117,
                                    121,
                                    98,
                                    97,
                                    99,
                                    107,
                                    45,
                                    97,
                                    117,
                                    116,
                                    104,
                                    111,
                                    114,
                                    105,
                                    116,
                                    121
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "token_agent_payments.mint";
                                "account": "tokenAgentPayments";
                            }
                        ];
                    };
                },
                {
                    "name": "burnMintVault";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "account";
                                "path": "burnAuthority";
                            },
                            {
                                "kind": "const";
                                "value": [
                                    6,
                                    221,
                                    246,
                                    225,
                                    215,
                                    101,
                                    161,
                                    147,
                                    217,
                                    203,
                                    225,
                                    70,
                                    206,
                                    235,
                                    121,
                                    172,
                                    28,
                                    180,
                                    133,
                                    237,
                                    95,
                                    91,
                                    55,
                                    145,
                                    58,
                                    140,
                                    245,
                                    133,
                                    126,
                                    255,
                                    0,
                                    169
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "mint";
                            }
                        ];
                        "program": {
                            "kind": "const";
                            "value": [
                                140,
                                151,
                                37,
                                143,
                                78,
                                36,
                                137,
                                241,
                                187,
                                61,
                                16,
                                41,
                                20,
                                142,
                                13,
                                131,
                                11,
                                90,
                                19,
                                153,
                                218,
                                255,
                                16,
                                132,
                                4,
                                142,
                                123,
                                216,
                                219,
                                233,
                                248,
                                89
                            ];
                        };
                    };
                },
                {
                    "name": "tokenProgram";
                },
                {
                    "name": "associatedTokenProgram";
                    "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
                },
                {
                    "name": "systemProgram";
                    "address": "11111111111111111111111111111111";
                },
                {
                    "name": "eventAuthority";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    95,
                                    95,
                                    101,
                                    118,
                                    101,
                                    110,
                                    116,
                                    95,
                                    97,
                                    117,
                                    116,
                                    104,
                                    111,
                                    114,
                                    105,
                                    116,
                                    121
                                ];
                            }
                        ];
                    };
                },
                {
                    "name": "program";
                }
            ];
            "args": [
                {
                    "name": "swapInstructionData";
                    "type": "bytes";
                }
            ];
        },
        {
            "name": "agentDistributePayments";
            "discriminator": [
                145,
                44,
                246,
                47,
                192,
                204,
                95,
                32
            ];
            "accounts": [
                {
                    "name": "user";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "globalConfig";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    103,
                                    108,
                                    111,
                                    98,
                                    97,
                                    108,
                                    45,
                                    99,
                                    111,
                                    110,
                                    102,
                                    105,
                                    103
                                ];
                            }
                        ];
                    };
                },
                {
                    "name": "currencyMint";
                },
                {
                    "name": "tokenAgentPayments";
                },
                {
                    "name": "tokenAgentPaymentInCurrency";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    112,
                                    97,
                                    121,
                                    109,
                                    101,
                                    110,
                                    116,
                                    45,
                                    105,
                                    110,
                                    45,
                                    99,
                                    117,
                                    114,
                                    114,
                                    101,
                                    110,
                                    99,
                                    121
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "token_agent_payments.mint";
                                "account": "tokenAgentPayments";
                            },
                            {
                                "kind": "account";
                                "path": "currencyMint";
                            }
                        ];
                    };
                },
                {
                    "name": "tokenAgentAssociatedAccount";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "account";
                                "path": "tokenAgentPayments";
                            },
                            {
                                "kind": "const";
                                "value": [
                                    6,
                                    221,
                                    246,
                                    225,
                                    215,
                                    101,
                                    161,
                                    147,
                                    217,
                                    203,
                                    225,
                                    70,
                                    206,
                                    235,
                                    121,
                                    172,
                                    28,
                                    180,
                                    133,
                                    237,
                                    95,
                                    91,
                                    55,
                                    145,
                                    58,
                                    140,
                                    245,
                                    133,
                                    126,
                                    255,
                                    0,
                                    169
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "currencyMint";
                            }
                        ];
                        "program": {
                            "kind": "const";
                            "value": [
                                140,
                                151,
                                37,
                                143,
                                78,
                                36,
                                137,
                                241,
                                187,
                                61,
                                16,
                                41,
                                20,
                                142,
                                13,
                                131,
                                11,
                                90,
                                19,
                                153,
                                218,
                                255,
                                16,
                                132,
                                4,
                                142,
                                123,
                                216,
                                219,
                                233,
                                248,
                                89
                            ];
                        };
                    };
                },
                {
                    "name": "buybackAuthority";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    98,
                                    117,
                                    121,
                                    98,
                                    97,
                                    99,
                                    107,
                                    45,
                                    97,
                                    117,
                                    116,
                                    104,
                                    111,
                                    114,
                                    105,
                                    116,
                                    121
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "token_agent_payments.mint";
                                "account": "tokenAgentPayments";
                            }
                        ];
                    };
                },
                {
                    "name": "withdrawAuthority";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    119,
                                    105,
                                    116,
                                    104,
                                    100,
                                    114,
                                    97,
                                    119,
                                    45,
                                    97,
                                    117,
                                    116,
                                    104,
                                    111,
                                    114,
                                    105,
                                    116,
                                    121
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "token_agent_payments.mint";
                                "account": "tokenAgentPayments";
                            }
                        ];
                    };
                },
                {
                    "name": "buybackVault";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "account";
                                "path": "buybackAuthority";
                            },
                            {
                                "kind": "const";
                                "value": [
                                    6,
                                    221,
                                    246,
                                    225,
                                    215,
                                    101,
                                    161,
                                    147,
                                    217,
                                    203,
                                    225,
                                    70,
                                    206,
                                    235,
                                    121,
                                    172,
                                    28,
                                    180,
                                    133,
                                    237,
                                    95,
                                    91,
                                    55,
                                    145,
                                    58,
                                    140,
                                    245,
                                    133,
                                    126,
                                    255,
                                    0,
                                    169
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "currencyMint";
                            }
                        ];
                        "program": {
                            "kind": "const";
                            "value": [
                                140,
                                151,
                                37,
                                143,
                                78,
                                36,
                                137,
                                241,
                                187,
                                61,
                                16,
                                41,
                                20,
                                142,
                                13,
                                131,
                                11,
                                90,
                                19,
                                153,
                                218,
                                255,
                                16,
                                132,
                                4,
                                142,
                                123,
                                216,
                                219,
                                233,
                                248,
                                89
                            ];
                        };
                    };
                },
                {
                    "name": "withdrawVault";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "account";
                                "path": "withdrawAuthority";
                            },
                            {
                                "kind": "const";
                                "value": [
                                    6,
                                    221,
                                    246,
                                    225,
                                    215,
                                    101,
                                    161,
                                    147,
                                    217,
                                    203,
                                    225,
                                    70,
                                    206,
                                    235,
                                    121,
                                    172,
                                    28,
                                    180,
                                    133,
                                    237,
                                    95,
                                    91,
                                    55,
                                    145,
                                    58,
                                    140,
                                    245,
                                    133,
                                    126,
                                    255,
                                    0,
                                    169
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "currencyMint";
                            }
                        ];
                        "program": {
                            "kind": "const";
                            "value": [
                                140,
                                151,
                                37,
                                143,
                                78,
                                36,
                                137,
                                241,
                                187,
                                61,
                                16,
                                41,
                                20,
                                142,
                                13,
                                131,
                                11,
                                90,
                                19,
                                153,
                                218,
                                255,
                                16,
                                132,
                                4,
                                142,
                                123,
                                216,
                                219,
                                233,
                                248,
                                89
                            ];
                        };
                    };
                },
                {
                    "name": "tokenProgram";
                },
                {
                    "name": "associatedTokenProgram";
                    "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
                },
                {
                    "name": "systemProgram";
                    "address": "11111111111111111111111111111111";
                },
                {
                    "name": "eventAuthority";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    95,
                                    95,
                                    101,
                                    118,
                                    101,
                                    110,
                                    116,
                                    95,
                                    97,
                                    117,
                                    116,
                                    104,
                                    111,
                                    114,
                                    105,
                                    116,
                                    121
                                ];
                            }
                        ];
                    };
                },
                {
                    "name": "program";
                }
            ];
            "args": [];
        },
        {
            "name": "agentInitialize";
            "discriminator": [
                180,
                248,
                163,
                8,
                49,
                94,
                126,
                96
            ];
            "accounts": [
                {
                    "name": "authority";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "bondingCurve";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    98,
                                    111,
                                    110,
                                    100,
                                    105,
                                    110,
                                    103,
                                    45,
                                    99,
                                    117,
                                    114,
                                    118,
                                    101
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "mint";
                            }
                        ];
                        "program": {
                            "kind": "const";
                            "value": [
                                1,
                                86,
                                224,
                                246,
                                147,
                                102,
                                90,
                                207,
                                68,
                                219,
                                21,
                                104,
                                191,
                                23,
                                91,
                                170,
                                81,
                                137,
                                203,
                                151,
                                245,
                                210,
                                255,
                                59,
                                101,
                                93,
                                43,
                                182,
                                253,
                                109,
                                24,
                                176
                            ];
                        };
                    };
                },
                {
                    "name": "globalConfig";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    103,
                                    108,
                                    111,
                                    98,
                                    97,
                                    108,
                                    45,
                                    99,
                                    111,
                                    110,
                                    102,
                                    105,
                                    103
                                ];
                            }
                        ];
                    };
                },
                {
                    "name": "mint";
                },
                {
                    "name": "tokenAgentPayments";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    116,
                                    111,
                                    107,
                                    101,
                                    110,
                                    45,
                                    97,
                                    103,
                                    101,
                                    110,
                                    116,
                                    45,
                                    112,
                                    97,
                                    121,
                                    109,
                                    101,
                                    110,
                                    116,
                                    115
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "mint";
                            }
                        ];
                    };
                },
                {
                    "name": "systemProgram";
                    "address": "11111111111111111111111111111111";
                },
                {
                    "name": "eventAuthority";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    95,
                                    95,
                                    101,
                                    118,
                                    101,
                                    110,
                                    116,
                                    95,
                                    97,
                                    117,
                                    116,
                                    104,
                                    111,
                                    114,
                                    105,
                                    116,
                                    121
                                ];
                            }
                        ];
                    };
                },
                {
                    "name": "program";
                }
            ];
            "args": [
                {
                    "name": "authority";
                    "type": "pubkey";
                },
                {
                    "name": "buybackBps";
                    "type": "u16";
                }
            ];
        },
        {
            "name": "agentUpdateAuthority";
            "discriminator": [
                237,
                228,
                227,
                224,
                226,
                198,
                167,
                83
            ];
            "accounts": [
                {
                    "name": "authority";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "globalConfig";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    103,
                                    108,
                                    111,
                                    98,
                                    97,
                                    108,
                                    45,
                                    99,
                                    111,
                                    110,
                                    102,
                                    105,
                                    103
                                ];
                            }
                        ];
                    };
                },
                {
                    "name": "tokenAgentPayments";
                    "writable": true;
                },
                {
                    "name": "systemProgram";
                    "address": "11111111111111111111111111111111";
                },
                {
                    "name": "eventAuthority";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    95,
                                    95,
                                    101,
                                    118,
                                    101,
                                    110,
                                    116,
                                    95,
                                    97,
                                    117,
                                    116,
                                    104,
                                    111,
                                    114,
                                    105,
                                    116,
                                    121
                                ];
                            }
                        ];
                    };
                },
                {
                    "name": "program";
                }
            ];
            "args": [
                {
                    "name": "newAuthority";
                    "type": "pubkey";
                }
            ];
        },
        {
            "name": "agentUpdateBuybackBps";
            "discriminator": [
                41,
                28,
                118,
                90,
                53,
                24,
                63,
                160
            ];
            "accounts": [
                {
                    "name": "authority";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "tokenAgentPayments";
                    "writable": true;
                },
                {
                    "name": "globalConfig";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    103,
                                    108,
                                    111,
                                    98,
                                    97,
                                    108,
                                    45,
                                    99,
                                    111,
                                    110,
                                    102,
                                    105,
                                    103
                                ];
                            }
                        ];
                    };
                },
                {
                    "name": "eventAuthority";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    95,
                                    95,
                                    101,
                                    118,
                                    101,
                                    110,
                                    116,
                                    95,
                                    97,
                                    117,
                                    116,
                                    104,
                                    111,
                                    114,
                                    105,
                                    116,
                                    121
                                ];
                            }
                        ];
                    };
                },
                {
                    "name": "program";
                }
            ];
            "args": [
                {
                    "name": "buybackBps";
                    "type": "u16";
                }
            ];
        },
        {
            "name": "agentWithdraw";
            "discriminator": [
                13,
                149,
                99,
                245,
                171,
                171,
                185,
                53
            ];
            "accounts": [
                {
                    "name": "authority";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "tokenAgentPayments";
                },
                {
                    "name": "currencyMint";
                },
                {
                    "name": "withdrawAuthority";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    119,
                                    105,
                                    116,
                                    104,
                                    100,
                                    114,
                                    97,
                                    119,
                                    45,
                                    97,
                                    117,
                                    116,
                                    104,
                                    111,
                                    114,
                                    105,
                                    116,
                                    121
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "token_agent_payments.mint";
                                "account": "tokenAgentPayments";
                            }
                        ];
                    };
                },
                {
                    "name": "withdrawVault";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "account";
                                "path": "withdrawAuthority";
                            },
                            {
                                "kind": "const";
                                "value": [
                                    6,
                                    221,
                                    246,
                                    225,
                                    215,
                                    101,
                                    161,
                                    147,
                                    217,
                                    203,
                                    225,
                                    70,
                                    206,
                                    235,
                                    121,
                                    172,
                                    28,
                                    180,
                                    133,
                                    237,
                                    95,
                                    91,
                                    55,
                                    145,
                                    58,
                                    140,
                                    245,
                                    133,
                                    126,
                                    255,
                                    0,
                                    169
                                ];
                            },
                            {
                                "kind": "account";
                                "path": "currencyMint";
                            }
                        ];
                        "program": {
                            "kind": "const";
                            "value": [
                                140,
                                151,
                                37,
                                143,
                                78,
                                36,
                                137,
                                241,
                                187,
                                61,
                                16,
                                41,
                                20,
                                142,
                                13,
                                131,
                                11,
                                90,
                                19,
                                153,
                                218,
                                255,
                                16,
                                132,
                                4,
                                142,
                                123,
                                216,
                                219,
                                233,
                                248,
                                89
                            ];
                        };
                    };
                },
                {
                    "name": "receiverAta";
                    "writable": true;
                },
                {
                    "name": "tokenProgram";
                },
                {
                    "name": "associatedTokenProgram";
                    "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
                },
                {
                    "name": "systemProgram";
                    "address": "11111111111111111111111111111111";
                },
                {
                    "name": "eventAuthority";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    95,
                                    95,
                                    101,
                                    118,
                                    101,
                                    110,
                                    116,
                                    95,
                                    97,
                                    117,
                                    116,
                                    104,
                                    111,
                                    114,
                                    105,
                                    116,
                                    121
                                ];
                            }
                        ];
                    };
                },
                {
                    "name": "program";
                }
            ];
            "args": [];
        },
        {
            "name": "closeAccount";
            "discriminator": [
                125,
                255,
                149,
                14,
                110,
                34,
                72,
                24
            ];
            "accounts": [
                {
                    "name": "account";
                    "writable": true;
                },
                {
                    "name": "user";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "globalConfig";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    103,
                                    108,
                                    111,
                                    98,
                                    97,
                                    108,
                                    45,
                                    99,
                                    111,
                                    110,
                                    102,
                                    105,
                                    103
                                ];
                            }
                        ];
                    };
                },
                {
                    "name": "systemProgram";
                    "address": "11111111111111111111111111111111";
                }
            ];
            "args": [];
        },
        {
            "name": "extendAccount";
            "discriminator": [
                234,
                102,
                194,
                203,
                150,
                72,
                62,
                229
            ];
            "accounts": [
                {
                    "name": "account";
                    "writable": true;
                },
                {
                    "name": "user";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "systemProgram";
                    "address": "11111111111111111111111111111111";
                },
                {
                    "name": "eventAuthority";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    95,
                                    95,
                                    101,
                                    118,
                                    101,
                                    110,
                                    116,
                                    95,
                                    97,
                                    117,
                                    116,
                                    104,
                                    111,
                                    114,
                                    105,
                                    116,
                                    121
                                ];
                            }
                        ];
                    };
                },
                {
                    "name": "program";
                }
            ];
            "args": [];
        },
        {
            "name": "globalAddNewCurrency";
            "discriminator": [
                46,
                135,
                47,
                120,
                118,
                204,
                177,
                224
            ];
            "accounts": [
                {
                    "name": "authority";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "globalConfig";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    103,
                                    108,
                                    111,
                                    98,
                                    97,
                                    108,
                                    45,
                                    99,
                                    111,
                                    110,
                                    102,
                                    105,
                                    103
                                ];
                            }
                        ];
                    };
                },
                {
                    "name": "mint";
                },
                {
                    "name": "eventAuthority";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    95,
                                    95,
                                    101,
                                    118,
                                    101,
                                    110,
                                    116,
                                    95,
                                    97,
                                    117,
                                    116,
                                    104,
                                    111,
                                    114,
                                    105,
                                    116,
                                    121
                                ];
                            }
                        ];
                    };
                },
                {
                    "name": "program";
                }
            ];
            "args": [];
        },
        {
            "name": "globalConfigInitialize";
            "discriminator": [
                61,
                23,
                208,
                192,
                232,
                52,
                8,
                66
            ];
            "accounts": [
                {
                    "name": "authority";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "globalConfig";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    103,
                                    108,
                                    111,
                                    98,
                                    97,
                                    108,
                                    45,
                                    99,
                                    111,
                                    110,
                                    102,
                                    105,
                                    103
                                ];
                            }
                        ];
                    };
                },
                {
                    "name": "systemProgram";
                    "address": "11111111111111111111111111111111";
                },
                {
                    "name": "eventAuthority";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    95,
                                    95,
                                    101,
                                    118,
                                    101,
                                    110,
                                    116,
                                    95,
                                    97,
                                    117,
                                    116,
                                    104,
                                    111,
                                    114,
                                    105,
                                    116,
                                    121
                                ];
                            }
                        ];
                    };
                },
                {
                    "name": "program";
                }
            ];
            "args": [
                {
                    "name": "protocolAuthority";
                    "type": "pubkey";
                },
                {
                    "name": "buybackAuthority";
                    "type": "pubkey";
                }
            ];
        },
        {
            "name": "globalUpdateAuthorities";
            "discriminator": [
                91,
                137,
                72,
                77,
                183,
                184,
                168,
                125
            ];
            "accounts": [
                {
                    "name": "authority";
                    "writable": true;
                    "signer": true;
                },
                {
                    "name": "globalConfig";
                    "writable": true;
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    103,
                                    108,
                                    111,
                                    98,
                                    97,
                                    108,
                                    45,
                                    99,
                                    111,
                                    110,
                                    102,
                                    105,
                                    103
                                ];
                            }
                        ];
                    };
                },
                {
                    "name": "eventAuthority";
                    "pda": {
                        "seeds": [
                            {
                                "kind": "const";
                                "value": [
                                    95,
                                    95,
                                    101,
                                    118,
                                    101,
                                    110,
                                    116,
                                    95,
                                    97,
                                    117,
                                    116,
                                    104,
                                    111,
                                    114,
                                    105,
                                    116,
                                    121
                                ];
                            }
                        ];
                    };
                },
                {
                    "name": "program";
                }
            ];
            "args": [
                {
                    "name": "protocolAuthority";
                    "type": {
                        "option": "pubkey";
                    };
                },
                {
                    "name": "buybackAuthority";
                    "type": {
                        "option": "pubkey";
                    };
                }
            ];
        }
    ];
    "accounts": [
        {
            "name": "bondingCurve";
            "discriminator": [
                23,
                183,
                248,
                55,
                96,
                216,
                172,
                96
            ];
        },
        {
            "name": "globalConfig";
            "discriminator": [
                149,
                8,
                156,
                202,
                160,
                252,
                176,
                217
            ];
        },
        {
            "name": "tokenAgentPaymentInCurrency";
            "discriminator": [
                225,
                195,
                81,
                227,
                115,
                43,
                25,
                177
            ];
        },
        {
            "name": "tokenAgentPayments";
            "discriminator": [
                136,
                241,
                242,
                217,
                173,
                77,
                112,
                186
            ];
        }
    ];
    "events": [
        {
            "name": "agentAcceptPaymentEvent";
            "discriminator": [
                114,
                190,
                188,
                192,
                105,
                79,
                41,
                147
            ];
        },
        {
            "name": "agentBuybackTriggerEvent";
            "discriminator": [
                139,
                240,
                9,
                225,
                214,
                63,
                232,
                165
            ];
        },
        {
            "name": "agentDistributePaymentsEvent";
            "discriminator": [
                137,
                116,
                114,
                140,
                54,
                111,
                230,
                26
            ];
        },
        {
            "name": "agentInitializeEvent";
            "discriminator": [
                192,
                5,
                183,
                151,
                0,
                64,
                100,
                207
            ];
        },
        {
            "name": "agentUpdateAuthorityEvent";
            "discriminator": [
                36,
                212,
                117,
                235,
                74,
                166,
                60,
                16
            ];
        },
        {
            "name": "agentUpdateBuybackBpsEvent";
            "discriminator": [
                165,
                251,
                40,
                19,
                114,
                26,
                128,
                232
            ];
        },
        {
            "name": "agentWithdrawEvent";
            "discriminator": [
                174,
                231,
                201,
                69,
                254,
                183,
                49,
                85
            ];
        },
        {
            "name": "extendAccountEvent";
            "discriminator": [
                97,
                97,
                215,
                144,
                93,
                146,
                22,
                124
            ];
        },
        {
            "name": "globalAddNewCurrencyEvent";
            "discriminator": [
                130,
                202,
                37,
                248,
                241,
                182,
                233,
                35
            ];
        },
        {
            "name": "globalConfigInitializeEvent";
            "discriminator": [
                241,
                51,
                222,
                190,
                142,
                245,
                176,
                53
            ];
        },
        {
            "name": "globalUpdateAuthoritiesEvent";
            "discriminator": [
                82,
                27,
                22,
                232,
                53,
                66,
                35,
                207
            ];
        }
    ];
    "errors": [
        {
            "code": 6000;
            "name": "unauthorizedSigner";
            "msg": "The given account is not authorized to execute this instruction.";
        },
        {
            "code": 6001;
            "name": "currencyAlreadySupported";
            "msg": "The given currency is already supported.";
        },
        {
            "code": 6002;
            "name": "maxCurrenciesReached";
            "msg": "The maximum number of currencies has been reached.";
        },
        {
            "code": 6003;
            "name": "invalidBuybackBps";
            "msg": "The buyback basis points is greater than 10000.";
        },
        {
            "code": 6004;
            "name": "currencyNotSupported";
            "msg": "The given currency is not supported.";
        },
        {
            "code": 6005;
            "name": "mathOverflow";
            "msg": "Math overflow.";
        },
        {
            "code": 6006;
            "name": "invalidRemainingAccountAddress";
            "msg": "The given remaining account address is invalid.";
        },
        {
            "code": 6007;
            "name": "paymentVaultNotEmpty";
            "msg": "The payment vault is not empty. Distribute the payments first.";
        },
        {
            "code": 6008;
            "name": "invalidInvoiceAccount";
            "msg": "The invoice account does not match the expected PDA seeds";
        },
        {
            "code": 6009;
            "name": "invalidProgramToInvoke";
            "msg": "The program to invoke is not allowed.";
        },
        {
            "code": 6010;
            "name": "invalidCallbackProgram";
            "msg": "The callback program is invalid.";
        },
        {
            "code": 6011;
            "name": "swapFailedAmountDidNotIncrease";
            "msg": "The swap failed and the amount did not increase.";
        },
        {
            "code": 6012;
            "name": "accountTypeNotSupported";
            "msg": "The account type is not supported for extension.";
        }
    ];
    "types": [
        {
            "name": "agentAcceptPaymentEvent";
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "user";
                        "type": "pubkey";
                    },
                    {
                        "name": "tokenizedAgentMint";
                        "type": "pubkey";
                    },
                    {
                        "name": "tokenAgentPayments";
                        "type": "pubkey";
                    },
                    {
                        "name": "currencyMint";
                        "type": "pubkey";
                    },
                    {
                        "name": "amount";
                        "type": "u64";
                    },
                    {
                        "name": "memo";
                        "type": "u64";
                    },
                    {
                        "name": "startTime";
                        "type": "i64";
                    },
                    {
                        "name": "endTime";
                        "type": "i64";
                    },
                    {
                        "name": "invoiceId";
                        "type": "pubkey";
                    },
                    {
                        "name": "agentPostBalance";
                        "type": "u64";
                    },
                    {
                        "name": "timestamp";
                        "type": "i64";
                    }
                ];
            };
        },
        {
            "name": "agentBuybackTriggerEvent";
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "tokenAgentPayments";
                        "type": "pubkey";
                    },
                    {
                        "name": "mint";
                        "type": "pubkey";
                    },
                    {
                        "name": "amountBurned";
                        "type": "u64";
                    },
                    {
                        "name": "swapProgram";
                        "type": "pubkey";
                    },
                    {
                        "name": "newTokensBoughtAndBurnedForCurrency";
                        "type": "u64";
                    },
                    {
                        "name": "timestamp";
                        "type": "i64";
                    }
                ];
            };
        },
        {
            "name": "agentDistributePaymentsEvent";
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "tokenAgentPayments";
                        "type": "pubkey";
                    },
                    {
                        "name": "currencyMint";
                        "type": "pubkey";
                    },
                    {
                        "name": "buybackBps";
                        "type": "u16";
                    },
                    {
                        "name": "buybackAmount";
                        "type": "u64";
                    },
                    {
                        "name": "withdrawAmount";
                        "type": "u64";
                    },
                    {
                        "name": "timestamp";
                        "type": "i64";
                    }
                ];
            };
        },
        {
            "name": "agentInitializeEvent";
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "tokenAgentPayments";
                        "type": "pubkey";
                    },
                    {
                        "name": "mint";
                        "type": "pubkey";
                    },
                    {
                        "name": "authority";
                        "type": "pubkey";
                    },
                    {
                        "name": "buybackBps";
                        "type": "u16";
                    },
                    {
                        "name": "timestamp";
                        "type": "i64";
                    },
                    {
                        "name": "tokenizedAgentSequence";
                        "type": "u64";
                    }
                ];
            };
        },
        {
            "name": "agentUpdateAuthorityEvent";
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "tokenAgentPayments";
                        "type": "pubkey";
                    },
                    {
                        "name": "oldAuthority";
                        "type": "pubkey";
                    },
                    {
                        "name": "newAuthority";
                        "type": "pubkey";
                    },
                    {
                        "name": "timestamp";
                        "type": "i64";
                    }
                ];
            };
        },
        {
            "name": "agentUpdateBuybackBpsEvent";
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "tokenAgentPayments";
                        "type": "pubkey";
                    },
                    {
                        "name": "mint";
                        "type": "pubkey";
                    },
                    {
                        "name": "oldBuybackBps";
                        "type": "u16";
                    },
                    {
                        "name": "newBuybackBps";
                        "type": "u16";
                    },
                    {
                        "name": "timestamp";
                        "type": "i64";
                    }
                ];
            };
        },
        {
            "name": "agentWithdrawEvent";
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "tokenAgentPayments";
                        "type": "pubkey";
                    },
                    {
                        "name": "currencyMint";
                        "type": "pubkey";
                    },
                    {
                        "name": "amount";
                        "type": "u64";
                    },
                    {
                        "name": "receiver";
                        "type": "pubkey";
                    },
                    {
                        "name": "timestamp";
                        "type": "i64";
                    }
                ];
            };
        },
        {
            "name": "bondingCurve";
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "virtualTokenReserves";
                        "type": "u64";
                    },
                    {
                        "name": "virtualSolReserves";
                        "type": "u64";
                    },
                    {
                        "name": "realTokenReserves";
                        "type": "u64";
                    },
                    {
                        "name": "realSolReserves";
                        "type": "u64";
                    },
                    {
                        "name": "tokenTotalSupply";
                        "type": "u64";
                    },
                    {
                        "name": "complete";
                        "type": "bool";
                    },
                    {
                        "name": "creator";
                        "type": "pubkey";
                    },
                    {
                        "name": "isMayhemMode";
                        "type": "bool";
                    }
                ];
            };
        },
        {
            "name": "extendAccountEvent";
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "account";
                        "type": "pubkey";
                    },
                    {
                        "name": "user";
                        "type": "pubkey";
                    },
                    {
                        "name": "currentSize";
                        "type": "u64";
                    },
                    {
                        "name": "newSize";
                        "type": "u64";
                    },
                    {
                        "name": "timestamp";
                        "type": "i64";
                    }
                ];
            };
        },
        {
            "name": "globalAddNewCurrencyEvent";
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "globalConfig";
                        "type": "pubkey";
                    },
                    {
                        "name": "currencyMint";
                        "type": "pubkey";
                    },
                    {
                        "name": "timestamp";
                        "type": "i64";
                    }
                ];
            };
        },
        {
            "name": "globalConfig";
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "bump";
                        "type": "u8";
                    },
                    {
                        "name": "protocolAuthority";
                        "type": "pubkey";
                    },
                    {
                        "name": "buybackAuthority";
                        "type": "pubkey";
                    },
                    {
                        "name": "supportedCurrenciesMint";
                        "type": {
                            "array": [
                                "pubkey",
                                10
                            ];
                        };
                    },
                    {
                        "name": "tokenizedAgentSequence";
                        "type": "u64";
                    }
                ];
            };
        },
        {
            "name": "globalConfigInitializeEvent";
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "globalConfig";
                        "type": "pubkey";
                    },
                    {
                        "name": "protocolAuthority";
                        "type": "pubkey";
                    },
                    {
                        "name": "buybackAuthority";
                        "type": "pubkey";
                    },
                    {
                        "name": "timestamp";
                        "type": "i64";
                    }
                ];
            };
        },
        {
            "name": "globalUpdateAuthoritiesEvent";
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "globalConfig";
                        "type": "pubkey";
                    },
                    {
                        "name": "protocolAuthority";
                        "type": {
                            "option": "pubkey";
                        };
                    },
                    {
                        "name": "buybackAuthority";
                        "type": {
                            "option": "pubkey";
                        };
                    },
                    {
                        "name": "timestamp";
                        "type": "i64";
                    }
                ];
            };
        },
        {
            "name": "tokenAgentPaymentInCurrency";
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "mint";
                        "type": "pubkey";
                    },
                    {
                        "name": "currencyMint";
                        "type": "pubkey";
                    },
                    {
                        "name": "totalInvoicePaymentsMade";
                        "type": "u64";
                    },
                    {
                        "name": "totalBuyback";
                        "type": "u64";
                    },
                    {
                        "name": "totalWithdrawals";
                        "type": "u64";
                    },
                    {
                        "name": "tokensBoughtBackAndBurned";
                        "type": "u64";
                    }
                ];
            };
        },
        {
            "name": "tokenAgentPayments";
            "type": {
                "kind": "struct";
                "fields": [
                    {
                        "name": "bump";
                        "type": "u8";
                    },
                    {
                        "name": "mint";
                        "type": "pubkey";
                    },
                    {
                        "name": "authority";
                        "type": "pubkey";
                    },
                    {
                        "name": "buybackBps";
                        "type": "u16";
                    }
                ];
            };
        }
    ];
};

/**
 * Anchor program client for the **1.0.7** pump_agent_payments deployment
 * (`pUmPFn9WvfaN2WTVGnCEtJTd2ATTpvpsKRz6jVzu6u4`). Use this when you need
 * to interact with coins whose tokenized-agent record lives on the legacy
 * program — most commonly when @pump-fun/pump-sdk's `isTokenizedAgent: true`
 * created the agent.
 */
declare function getLegacyPumpProgram(connection: Connection): Program<LegacyPumpAgentPayments>;
/**
 * Offline program client (no `Connection`) for instruction-only flows. The
 * underlying provider uses `PublicKey.default` as its identity and refuses
 * to sign — every method must end with `.instruction()`, not `.rpc()`.
 */
declare function getLegacyOfflineProgram(): Program<LegacyPumpAgentPayments>;
declare const OFFLINE_PUMP_PROGRAM: Program<LegacyPumpAgentPayments>;
/** Pick `online` when a connection is available, fall back to offline. */
declare function getLegacyPumpProgramWithFallback(connection?: Connection): Program<LegacyPumpAgentPayments>;
/** Decode helpers using the offline coder (no chain calls). */
declare function decodeLegacyGlobalConfig(data: Buffer): any;
declare function decodeLegacyTokenAgentPaymentInCurrency(data: Buffer): any;
declare function decodeLegacyTokenAgentPayments(data: Buffer): any;

/** Args for `agentInitialize` — registers a tokenized agent for a coin. */
interface LegacyCreateParams {
    authority: PublicKey;
    mint: PublicKey;
    agentAuthority: PublicKey;
    buybackBps: number;
}
interface LegacyWithdrawParams {
    authority: PublicKey;
    currencyMint: PublicKey;
    receiverAta: PublicKey;
    tokenProgram?: PublicKey;
}
interface LegacyUpdateBuybackBpsParams {
    authority: PublicKey;
    buybackBps: number;
}
/** Optional override fed in lieu of an on-chain fetch of `globalConfig`. */
interface LegacyUpdateBuybackBpsOptions {
    supportedCurrenciesMint: PublicKey[];
}
interface LegacyAcceptPaymentParams {
    user: PublicKey;
    userTokenAccount: PublicKey;
    currencyMint: PublicKey;
    amount: BN;
    memo: BN;
    startTime: BN;
    endTime: BN;
    tokenProgram?: PublicKey;
}
interface LegacyAcceptPaymentSimpleParams {
    user: PublicKey;
    userTokenAccount: PublicKey;
    currencyMint: PublicKey;
    amount: number | bigint;
    memo: number | bigint;
    startTime: number | bigint;
    endTime: number | bigint;
    tokenProgram?: PublicKey;
}
interface LegacyDistributePaymentsParams {
    user: PublicKey;
    currencyMint: PublicKey;
    tokenProgram?: PublicKey;
}
interface LegacyBuybackTriggerParams {
    globalBuybackAuthority: PublicKey;
    currencyMint: PublicKey;
    swapProgramToInvoke: PublicKey;
    swapInstructionData: Buffer;
    remainingAccounts: AccountMeta[];
    tokenProgram?: PublicKey;
}
interface LegacyExtendAccountParams {
    account: PublicKey;
    user: PublicKey;
}
interface LegacyUpdateAuthorityParams {
    authority: PublicKey;
    newAuthority: PublicKey;
}
interface LegacyVaultBalance {
    address: PublicKey;
    balance: bigint;
}
interface LegacyAgentBalances {
    paymentVault: LegacyVaultBalance;
    buybackVault: LegacyVaultBalance;
    withdrawVault: LegacyVaultBalance;
}
/** Decoded `tokenAgentPayments` account. Mirrors the 1.0.7 IDL exactly. */
interface LegacyTokenAgentPayments {
    bump: number;
    mint: PublicKey;
    authority: PublicKey;
    buybackBps: number;
}
/** Decoded `tokenAgentPaymentInCurrency` account. */
interface LegacyTokenAgentPaymentInCurrency {
    mint: PublicKey;
    currencyMint: PublicKey;
    totalInvoicePaymentsMade: BN;
    totalBuyback: BN;
    totalWithdrawals: BN;
    tokensBoughtBackAndBurned: BN;
}
/** Decoded `globalConfig` account. */
interface LegacyGlobalConfig {
    bump: number;
    protocolAuthority: PublicKey;
    buybackAuthority: PublicKey;
    /** Fixed-length `[Pubkey; 10]`. Empty slots are `Pubkey::default()`. */
    supportedCurrenciesMint: PublicKey[];
    tokenizedAgentSequence: BN;
}

/**
 * Offline-capable client for the legacy 1.0.7 `pump_agent_payments` program
 * (`pUmPFn9WvfaN2WTVGnCEtJTd2ATTpvpsKRz6jVzu6u4`). All methods return raw
 * `TransactionInstruction`s — the caller is responsible for transaction
 * assembly and signing. Mirrors the surface of the original npm package
 * exactly so coins registered via @pump-fun/pump-sdk's
 * `isTokenizedAgent: true` path remain operable.
 */
declare class LegacyPumpAgentOffline {
    readonly mint: PublicKey;
    protected readonly program: Program<LegacyPumpAgentPayments>;
    constructor(mint: PublicKey, program?: Program<LegacyPumpAgentPayments>);
    static load(mint: PublicKey, connection?: Connection): LegacyPumpAgentOffline;
    create(params: LegacyCreateParams): Promise<TransactionInstruction>;
    withdraw(params: LegacyWithdrawParams): Promise<TransactionInstruction>;
    /**
     * `agent_update_buyback_bps` — when the global config has supported
     * currencies, each currency's payment-vault ATA must be passed as a
     * remaining account. The 1.0.7 SDK fetched `globalConfig` from chain when
     * called via the connection-bound `LegacyPumpAgent`; for the offline
     * flow you must supply `supportedCurrenciesMint` yourself.
     */
    updateBuybackBps(params: LegacyUpdateBuybackBpsParams, options?: LegacyUpdateBuybackBpsOptions): Promise<TransactionInstruction>;
    acceptPayment(params: LegacyAcceptPaymentParams): Promise<TransactionInstruction>;
    acceptPaymentSimple(params: LegacyAcceptPaymentSimpleParams): Promise<TransactionInstruction>;
    distributePayments(params: LegacyDistributePaymentsParams): Promise<TransactionInstruction>;
    buybackTrigger(params: LegacyBuybackTriggerParams): Promise<TransactionInstruction>;
    extendAccount(params: LegacyExtendAccountParams): Promise<TransactionInstruction>;
    updateAuthority(params: LegacyUpdateAuthorityParams): Promise<TransactionInstruction>;
}

/**
 * Connection-bound client for the legacy 1.0.7 program. Adds methods that
 * need RPC: balance fetches, automatic supported-currencies discovery for
 * `updateBuybackBps`. Inherits all instruction-only methods from
 * `LegacyPumpAgentOffline`.
 */
declare class LegacyPumpAgent extends LegacyPumpAgentOffline {
    readonly connection: Connection;
    constructor(mint: PublicKey, connection: Connection);
    getBalances(currencyMint: PublicKey): Promise<LegacyAgentBalances>;
    /**
     * Override of `LegacyPumpAgentOffline.updateBuybackBps` that auto-fetches
     * the supported currencies list from the on-chain `globalConfig` when not
     * provided. Mirrors the 1.0.7 SDK's connection-bound behavior.
     */
    updateBuybackBps(params: LegacyUpdateBuybackBpsParams, options?: LegacyUpdateBuybackBpsOptions): Promise<TransactionInstruction>;
}

/**
 * Vendored 1.0.7 source of `@pump-fun/agent-payments-sdk` reconstructed from
 * the published npm bundle. The 1.0.7 deployment lives at program ID
 * `pUmPFn9WvfaN2WTVGnCEtJTd2ATTpvpsKRz6jVzu6u4` and is what
 * `@pump-fun/pump-sdk@1.35.0`'s `isTokenizedAgent: true` path targets.
 *
 * Coexists with the modern 3.0.x program (`AgenTMiC...`) implemented in
 * `../PumpAgent.ts` / `../PumpAgentOffline.ts`. Both can be imported and
 * used in the same process; PDAs and program IDs are disjoint.
 */

declare const index_BONDING_CURVE_SEED: typeof BONDING_CURVE_SEED;
declare const index_BUYBACK_AUTHORITY_SEED: typeof BUYBACK_AUTHORITY_SEED;
declare const index_GLOBAL_CONFIG_SEED: typeof GLOBAL_CONFIG_SEED;
declare const index_INVOICE_ID_SEED: typeof INVOICE_ID_SEED;
declare const index_LEGACY_AGENT_PAYMENTS_PROGRAM_ID: typeof LEGACY_AGENT_PAYMENTS_PROGRAM_ID;
type index_LegacyAcceptPaymentParams = LegacyAcceptPaymentParams;
type index_LegacyAcceptPaymentSimpleParams = LegacyAcceptPaymentSimpleParams;
type index_LegacyAgentBalances = LegacyAgentBalances;
type index_LegacyBuybackTriggerParams = LegacyBuybackTriggerParams;
type index_LegacyCreateParams = LegacyCreateParams;
type index_LegacyDistributePaymentsParams = LegacyDistributePaymentsParams;
type index_LegacyExtendAccountParams = LegacyExtendAccountParams;
type index_LegacyGlobalConfig = LegacyGlobalConfig;
type index_LegacyPumpAgent = LegacyPumpAgent;
declare const index_LegacyPumpAgent: typeof LegacyPumpAgent;
type index_LegacyPumpAgentOffline = LegacyPumpAgentOffline;
declare const index_LegacyPumpAgentOffline: typeof LegacyPumpAgentOffline;
type index_LegacyPumpAgentPayments = LegacyPumpAgentPayments;
type index_LegacyTokenAgentPaymentInCurrency = LegacyTokenAgentPaymentInCurrency;
type index_LegacyTokenAgentPayments = LegacyTokenAgentPayments;
type index_LegacyUpdateAuthorityParams = LegacyUpdateAuthorityParams;
type index_LegacyUpdateBuybackBpsOptions = LegacyUpdateBuybackBpsOptions;
type index_LegacyUpdateBuybackBpsParams = LegacyUpdateBuybackBpsParams;
type index_LegacyVaultBalance = LegacyVaultBalance;
type index_LegacyWithdrawParams = LegacyWithdrawParams;
declare const index_OFFLINE_PUMP_PROGRAM: typeof OFFLINE_PUMP_PROGRAM;
declare const index_PAYMENT_IN_CURRENCY_SEED: typeof PAYMENT_IN_CURRENCY_SEED;
declare const index_PUMP_PROGRAM_ID: typeof PUMP_PROGRAM_ID;
declare const index_TOKEN_AGENT_PAYMENTS_SEED: typeof TOKEN_AGENT_PAYMENTS_SEED;
declare const index_WITHDRAW_AUTHORITY_SEED: typeof WITHDRAW_AUTHORITY_SEED;
declare const index_decodeLegacyGlobalConfig: typeof decodeLegacyGlobalConfig;
declare const index_decodeLegacyTokenAgentPaymentInCurrency: typeof decodeLegacyTokenAgentPaymentInCurrency;
declare const index_decodeLegacyTokenAgentPayments: typeof decodeLegacyTokenAgentPayments;
declare const index_getBondingCurvePDA: typeof getBondingCurvePDA;
declare const index_getBuybackAuthorityPDA: typeof getBuybackAuthorityPDA;
declare const index_getGlobalConfigPDA: typeof getGlobalConfigPDA;
declare const index_getInvoiceIdPDA: typeof getInvoiceIdPDA;
declare const index_getLegacyOfflineProgram: typeof getLegacyOfflineProgram;
declare const index_getLegacyPumpProgram: typeof getLegacyPumpProgram;
declare const index_getLegacyPumpProgramWithFallback: typeof getLegacyPumpProgramWithFallback;
declare const index_getPaymentInCurrencyPDA: typeof getPaymentInCurrencyPDA;
declare const index_getTokenAgentPaymentsPDA: typeof getTokenAgentPaymentsPDA;
declare const index_getWithdrawAuthorityPDA: typeof getWithdrawAuthorityPDA;
declare namespace index {
  export { index_BONDING_CURVE_SEED as BONDING_CURVE_SEED, index_BUYBACK_AUTHORITY_SEED as BUYBACK_AUTHORITY_SEED, index_GLOBAL_CONFIG_SEED as GLOBAL_CONFIG_SEED, index_INVOICE_ID_SEED as INVOICE_ID_SEED, index_LEGACY_AGENT_PAYMENTS_PROGRAM_ID as LEGACY_AGENT_PAYMENTS_PROGRAM_ID, type index_LegacyAcceptPaymentParams as LegacyAcceptPaymentParams, type index_LegacyAcceptPaymentSimpleParams as LegacyAcceptPaymentSimpleParams, type index_LegacyAgentBalances as LegacyAgentBalances, type index_LegacyBuybackTriggerParams as LegacyBuybackTriggerParams, type index_LegacyCreateParams as LegacyCreateParams, type index_LegacyDistributePaymentsParams as LegacyDistributePaymentsParams, type index_LegacyExtendAccountParams as LegacyExtendAccountParams, type index_LegacyGlobalConfig as LegacyGlobalConfig, index_LegacyPumpAgent as LegacyPumpAgent, index_LegacyPumpAgentOffline as LegacyPumpAgentOffline, type index_LegacyPumpAgentPayments as LegacyPumpAgentPayments, type index_LegacyTokenAgentPaymentInCurrency as LegacyTokenAgentPaymentInCurrency, type index_LegacyTokenAgentPayments as LegacyTokenAgentPayments, type index_LegacyUpdateAuthorityParams as LegacyUpdateAuthorityParams, type index_LegacyUpdateBuybackBpsOptions as LegacyUpdateBuybackBpsOptions, type index_LegacyUpdateBuybackBpsParams as LegacyUpdateBuybackBpsParams, type index_LegacyVaultBalance as LegacyVaultBalance, type index_LegacyWithdrawParams as LegacyWithdrawParams, index_OFFLINE_PUMP_PROGRAM as OFFLINE_PUMP_PROGRAM, index_PAYMENT_IN_CURRENCY_SEED as PAYMENT_IN_CURRENCY_SEED, index_PUMP_PROGRAM_ID as PUMP_PROGRAM_ID, index_TOKEN_AGENT_PAYMENTS_SEED as TOKEN_AGENT_PAYMENTS_SEED, index_WITHDRAW_AUTHORITY_SEED as WITHDRAW_AUTHORITY_SEED, index_decodeLegacyGlobalConfig as decodeLegacyGlobalConfig, index_decodeLegacyTokenAgentPaymentInCurrency as decodeLegacyTokenAgentPaymentInCurrency, index_decodeLegacyTokenAgentPayments as decodeLegacyTokenAgentPayments, index_getBondingCurvePDA as getBondingCurvePDA, index_getBuybackAuthorityPDA as getBuybackAuthorityPDA, index_getGlobalConfigPDA as getGlobalConfigPDA, index_getInvoiceIdPDA as getInvoiceIdPDA, index_getLegacyOfflineProgram as getLegacyOfflineProgram, index_getLegacyPumpProgram as getLegacyPumpProgram, index_getLegacyPumpProgramWithFallback as getLegacyPumpProgramWithFallback, index_getPaymentInCurrencyPDA as getPaymentInCurrencyPDA, index_getTokenAgentPaymentsPDA as getTokenAgentPaymentsPDA, index_getWithdrawAuthorityPDA as getWithdrawAuthorityPDA };
}

export { getGlobalConfigPDA as A, BONDING_CURVE_SEED as B, getInvoiceIdPDA as C, getLegacyOfflineProgram as D, getLegacyPumpProgram as E, getLegacyPumpProgramWithFallback as F, GLOBAL_CONFIG_SEED as G, getPaymentInCurrencyPDA as H, INVOICE_ID_SEED as I, getTokenAgentPaymentsPDA as J, getWithdrawAuthorityPDA as K, LEGACY_AGENT_PAYMENTS_PROGRAM_ID as L, OFFLINE_PUMP_PROGRAM as O, PAYMENT_IN_CURRENCY_SEED as P, TOKEN_AGENT_PAYMENTS_SEED as T, WITHDRAW_AUTHORITY_SEED as W, BUYBACK_AUTHORITY_SEED as a, type LegacyAcceptPaymentParams as b, type LegacyAcceptPaymentSimpleParams as c, type LegacyAgentBalances as d, type LegacyBuybackTriggerParams as e, type LegacyCreateParams as f, type LegacyDistributePaymentsParams as g, type LegacyExtendAccountParams as h, index as i, type LegacyGlobalConfig as j, LegacyPumpAgent as k, LegacyPumpAgentOffline as l, type LegacyPumpAgentPayments as m, type LegacyTokenAgentPaymentInCurrency as n, type LegacyTokenAgentPayments as o, type LegacyUpdateAuthorityParams as p, type LegacyUpdateBuybackBpsOptions as q, type LegacyUpdateBuybackBpsParams as r, type LegacyVaultBalance as s, type LegacyWithdrawParams as t, PUMP_PROGRAM_ID as u, decodeLegacyGlobalConfig as v, decodeLegacyTokenAgentPaymentInCurrency as w, decodeLegacyTokenAgentPayments as x, getBondingCurvePDA as y, getBuybackAuthorityPDA as z };
