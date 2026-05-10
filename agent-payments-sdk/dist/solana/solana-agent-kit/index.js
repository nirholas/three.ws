import { NATIVE_MINT, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction, createCloseAccountInstruction, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey, ComputeBudgetProgram, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, BN, EventParser } from '@coral-xyz/anchor';
import { z } from 'zod';

// src/solana/solana-agent-kit/index.ts

// src/solana/idl/pump_agent_payments.json
var pump_agent_payments_default = {
  address: "AgenTMiC2hvxGebTsgmsD4HHBa8WEcqGFf87iwRRxLo7",
  metadata: {
    name: "pump_agent_payments",
    version: "0.1.0",
    spec: "0.1.0",
    description: "Created with Anchor"
  },
  instructions: [
    {
      name: "agent_accept_payment",
      discriminator: [34, 157, 64, 220, 74, 32, 48, 225],
      accounts: [
        { name: "user", writable: true, signer: true },
        { name: "user_token_account", writable: true },
        { name: "token_agent_payments" },
        {
          name: "token_agent_associated_account",
          writable: true,
          pda: {
            seeds: [
              { kind: "account", path: "token_agent_payments" },
              {
                kind: "const",
                value: [6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169]
              },
              { kind: "account", path: "currency_mint" }
            ],
            program: {
              kind: "const",
              value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89]
            }
          }
        },
        {
          name: "token_agent_payment_in_currency",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [112, 97, 121, 109, 101, 110, 116, 45, 105, 110, 45, 99, 117, 114, 114, 101, 110, 99, 121] },
              { kind: "account", path: "token_agent_payments.mint", account: "TokenAgentPayments" },
              { kind: "account", path: "currency_mint" }
            ]
          }
        },
        {
          name: "global_config",
          pda: { seeds: [{ kind: "const", value: [103, 108, 111, 98, 97, 108, 45, 99, 111, 110, 102, 105, 103] }] }
        },
        { name: "invoice_id" },
        { name: "currency_mint" },
        { name: "token_program" },
        { name: "associated_token_program", address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" },
        { name: "system_program", address: "11111111111111111111111111111111" },
        {
          name: "event_authority",
          pda: { seeds: [{ kind: "const", value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121] }] }
        },
        { name: "program" }
      ],
      args: [
        { name: "amount", type: "u64" },
        { name: "memo", type: "u64" },
        { name: "start_time", type: "i64" },
        { name: "end_time", type: "i64" }
      ]
    },
    {
      name: "agent_buyback_trigger",
      discriminator: [95, 231, 193, 2, 245, 75, 125, 155],
      accounts: [
        { name: "global_buyback_authority", writable: true, signer: true },
        { name: "mint", writable: true },
        {
          name: "token_agent_payments",
          pda: {
            seeds: [
              { kind: "const", value: [116, 111, 107, 101, 110, 45, 97, 103, 101, 110, 116, 45, 112, 97, 121, 109, 101, 110, 116, 115] },
              { kind: "account", path: "mint" }
            ]
          }
        },
        {
          name: "token_agent_payment_in_currency",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [112, 97, 121, 109, 101, 110, 116, 45, 105, 110, 45, 99, 117, 114, 114, 101, 110, 99, 121] },
              { kind: "account", path: "token_agent_payments.mint", account: "TokenAgentPayments" },
              { kind: "account", path: "currency_mint" }
            ]
          }
        },
        { name: "currency_mint" },
        {
          name: "global_config",
          pda: { seeds: [{ kind: "const", value: [103, 108, 111, 98, 97, 108, 45, 99, 111, 110, 102, 105, 103] }] }
        },
        { name: "swap_program_to_invoke" },
        {
          name: "burn_authority",
          docs: ["Intentionally called burn_authority", "TO avoid any confusion with the global buyback authority."],
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [98, 117, 121, 98, 97, 99, 107, 45, 97, 117, 116, 104, 111, 114, 105, 116, 121] },
              { kind: "account", path: "token_agent_payments.mint", account: "TokenAgentPayments" }
            ]
          }
        },
        {
          name: "burn_mint_vault",
          writable: true,
          pda: {
            seeds: [
              { kind: "account", path: "burn_authority" },
              { kind: "account", path: "token_program" },
              { kind: "account", path: "mint" }
            ],
            program: {
              kind: "const",
              value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89]
            }
          }
        },
        {
          name: "burn_currency_mint_vault",
          writable: true,
          pda: {
            seeds: [
              { kind: "account", path: "burn_authority" },
              { kind: "account", path: "token_program_currency" },
              { kind: "account", path: "currency_mint" }
            ],
            program: {
              kind: "const",
              value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89]
            }
          }
        },
        { name: "token_program" },
        { name: "token_program_currency" },
        { name: "associated_token_program", address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" },
        { name: "system_program", address: "11111111111111111111111111111111" },
        {
          name: "event_authority",
          pda: { seeds: [{ kind: "const", value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121] }] }
        },
        { name: "program" }
      ],
      args: [
        { name: "swap_instruction_data", type: "bytes" }
      ]
    },
    {
      name: "agent_distribute_payments",
      discriminator: [145, 44, 246, 47, 192, 204, 95, 32],
      accounts: [
        { name: "user", writable: true, signer: true },
        {
          name: "global_config",
          pda: { seeds: [{ kind: "const", value: [103, 108, 111, 98, 97, 108, 45, 99, 111, 110, 102, 105, 103] }] }
        },
        { name: "currency_mint" },
        { name: "token_agent_payments", writable: true },
        {
          name: "token_agent_payment_in_currency",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [112, 97, 121, 109, 101, 110, 116, 45, 105, 110, 45, 99, 117, 114, 114, 101, 110, 99, 121] },
              { kind: "account", path: "token_agent_payments.mint", account: "TokenAgentPayments" },
              { kind: "account", path: "currency_mint" }
            ]
          }
        },
        {
          name: "token_agent_associated_account",
          writable: true,
          pda: {
            seeds: [
              { kind: "account", path: "token_agent_payments" },
              { kind: "const", value: [6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169] },
              { kind: "account", path: "currency_mint" }
            ],
            program: {
              kind: "const",
              value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89]
            }
          }
        },
        {
          name: "buyback_authority",
          pda: {
            seeds: [
              { kind: "const", value: [98, 117, 121, 98, 97, 99, 107, 45, 97, 117, 116, 104, 111, 114, 105, 116, 121] },
              { kind: "account", path: "token_agent_payments.mint", account: "TokenAgentPayments" }
            ]
          }
        },
        {
          name: "withdraw_authority",
          pda: {
            seeds: [
              { kind: "const", value: [119, 105, 116, 104, 100, 114, 97, 119, 45, 97, 117, 116, 104, 111, 114, 105, 116, 121] },
              { kind: "account", path: "token_agent_payments.mint", account: "TokenAgentPayments" }
            ]
          }
        },
        {
          name: "buyback_vault",
          writable: true,
          pda: {
            seeds: [
              { kind: "account", path: "buyback_authority" },
              { kind: "const", value: [6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169] },
              { kind: "account", path: "currency_mint" }
            ],
            program: {
              kind: "const",
              value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89]
            }
          }
        },
        {
          name: "withdraw_vault",
          writable: true,
          pda: {
            seeds: [
              { kind: "account", path: "withdraw_authority" },
              { kind: "const", value: [6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169] },
              { kind: "account", path: "currency_mint" }
            ],
            program: {
              kind: "const",
              value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89]
            }
          }
        },
        { name: "token_program" },
        { name: "associated_token_program", address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" },
        { name: "system_program", address: "11111111111111111111111111111111" },
        {
          name: "event_authority",
          pda: { seeds: [{ kind: "const", value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121] }] }
        },
        { name: "program" }
      ],
      args: []
    },
    {
      name: "agent_initialize",
      discriminator: [180, 248, 163, 8, 49, 94, 126, 96],
      accounts: [
        { name: "authority", writable: true, signer: true },
        {
          name: "bonding_curve",
          pda: {
            seeds: [
              { kind: "const", value: [98, 111, 110, 100, 105, 110, 103, 45, 99, 117, 114, 118, 101] },
              { kind: "account", path: "mint" }
            ],
            program: {
              kind: "const",
              value: [1, 86, 224, 246, 147, 102, 90, 207, 68, 219, 21, 104, 191, 23, 91, 170, 81, 137, 203, 151, 245, 210, 255, 59, 101, 93, 43, 182, 253, 109, 24, 176]
            }
          }
        },
        {
          name: "global_config",
          writable: true,
          pda: { seeds: [{ kind: "const", value: [103, 108, 111, 98, 97, 108, 45, 99, 111, 110, 102, 105, 103] }] }
        },
        { name: "mint" },
        {
          name: "token_agent_payments",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [116, 111, 107, 101, 110, 45, 97, 103, 101, 110, 116, 45, 112, 97, 121, 109, 101, 110, 116, 115] },
              { kind: "account", path: "mint" }
            ]
          }
        },
        { name: "system_program", address: "11111111111111111111111111111111" },
        {
          name: "event_authority",
          pda: { seeds: [{ kind: "const", value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121] }] }
        },
        { name: "program" }
      ],
      args: [
        { name: "authority", type: "pubkey" },
        { name: "buyback_bps", type: "u16" }
      ]
    },
    {
      name: "agent_transfer_extra_lamports",
      discriminator: [39, 206, 214, 167, 55, 44, 221, 81],
      accounts: [
        {
          name: "token_agent_payments",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [116, 111, 107, 101, 110, 45, 97, 103, 101, 110, 116, 45, 112, 97, 121, 109, 101, 110, 116, 115] },
              { kind: "account", path: "token_agent_payments.mint", account: "TokenAgentPayments" }
            ]
          }
        },
        {
          name: "token_agent_associated_account",
          writable: true,
          pda: {
            seeds: [
              { kind: "account", path: "token_agent_payments" },
              { kind: "const", value: [6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169] },
              { kind: "const", value: [6, 155, 136, 87, 254, 171, 129, 132, 251, 104, 127, 99, 70, 24, 192, 53, 218, 196, 57, 220, 26, 235, 59, 85, 152, 160, 240, 0, 0, 0, 0, 1] }
            ],
            program: {
              kind: "const",
              value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89]
            }
          }
        }
      ],
      args: []
    },
    {
      name: "agent_update_authority",
      discriminator: [237, 228, 227, 224, 226, 198, 167, 83],
      accounts: [
        { name: "authority", writable: true, signer: true },
        {
          name: "global_config",
          pda: { seeds: [{ kind: "const", value: [103, 108, 111, 98, 97, 108, 45, 99, 111, 110, 102, 105, 103] }] }
        },
        { name: "token_agent_payments", writable: true },
        { name: "system_program", address: "11111111111111111111111111111111" },
        {
          name: "event_authority",
          pda: { seeds: [{ kind: "const", value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121] }] }
        },
        { name: "program" }
      ],
      args: [
        { name: "new_authority", type: "pubkey" }
      ]
    },
    {
      name: "agent_update_buyback_bps",
      discriminator: [41, 28, 118, 90, 53, 24, 63, 160],
      accounts: [
        { name: "authority", writable: true, signer: true },
        { name: "token_agent_payments", writable: true },
        {
          name: "global_config",
          pda: { seeds: [{ kind: "const", value: [103, 108, 111, 98, 97, 108, 45, 99, 111, 110, 102, 105, 103] }] }
        },
        {
          name: "event_authority",
          pda: { seeds: [{ kind: "const", value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121] }] }
        },
        { name: "program" }
      ],
      args: [
        { name: "buyback_bps", type: "u16" }
      ]
    },
    {
      name: "agent_withdraw",
      discriminator: [13, 149, 99, 245, 171, 171, 185, 53],
      accounts: [
        { name: "authority", writable: true, signer: true },
        { name: "token_agent_payments" },
        { name: "currency_mint" },
        {
          name: "withdraw_authority",
          pda: {
            seeds: [
              { kind: "const", value: [119, 105, 116, 104, 100, 114, 97, 119, 45, 97, 117, 116, 104, 111, 114, 105, 116, 121] },
              { kind: "account", path: "token_agent_payments.mint", account: "TokenAgentPayments" }
            ]
          }
        },
        {
          name: "withdraw_vault",
          writable: true,
          pda: {
            seeds: [
              { kind: "account", path: "withdraw_authority" },
              { kind: "const", value: [6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169] },
              { kind: "account", path: "currency_mint" }
            ],
            program: {
              kind: "const",
              value: [140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11, 90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89]
            }
          }
        },
        { name: "receiver_ata", writable: true },
        { name: "token_program" },
        { name: "associated_token_program", address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" },
        { name: "system_program", address: "11111111111111111111111111111111" },
        {
          name: "event_authority",
          pda: { seeds: [{ kind: "const", value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121] }] }
        },
        { name: "program" }
      ],
      args: []
    },
    {
      name: "close_account",
      discriminator: [125, 255, 149, 14, 110, 34, 72, 24],
      accounts: [
        { name: "account", writable: true },
        { name: "user", writable: true, signer: true },
        {
          name: "global_config",
          pda: { seeds: [{ kind: "const", value: [103, 108, 111, 98, 97, 108, 45, 99, 111, 110, 102, 105, 103] }] }
        },
        { name: "system_program", address: "11111111111111111111111111111111" }
      ],
      args: []
    },
    {
      name: "extend_account",
      discriminator: [234, 102, 194, 203, 150, 72, 62, 229],
      accounts: [
        { name: "account", writable: true },
        { name: "user", writable: true, signer: true },
        { name: "system_program", address: "11111111111111111111111111111111" },
        {
          name: "event_authority",
          pda: { seeds: [{ kind: "const", value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121] }] }
        },
        { name: "program" }
      ],
      args: []
    },
    {
      name: "global_add_new_currency",
      discriminator: [46, 135, 47, 120, 118, 204, 177, 224],
      accounts: [
        { name: "authority", writable: true, signer: true },
        {
          name: "global_config",
          writable: true,
          pda: { seeds: [{ kind: "const", value: [103, 108, 111, 98, 97, 108, 45, 99, 111, 110, 102, 105, 103] }] }
        },
        { name: "mint" },
        {
          name: "event_authority",
          pda: { seeds: [{ kind: "const", value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121] }] }
        },
        { name: "program" }
      ],
      args: []
    },
    {
      name: "global_config_initialize",
      discriminator: [61, 23, 208, 192, 232, 52, 8, 66],
      accounts: [
        { name: "authority", writable: true, signer: true },
        {
          name: "global_config",
          writable: true,
          pda: { seeds: [{ kind: "const", value: [103, 108, 111, 98, 97, 108, 45, 99, 111, 110, 102, 105, 103] }] }
        },
        { name: "system_program", address: "11111111111111111111111111111111" },
        {
          name: "event_authority",
          pda: { seeds: [{ kind: "const", value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121] }] }
        },
        { name: "program" }
      ],
      args: [
        { name: "protocol_authority", type: "pubkey" },
        { name: "buyback_authority", type: "pubkey" }
      ]
    },
    {
      name: "global_remove_currency",
      discriminator: [57, 226, 180, 140, 91, 14, 231, 196],
      accounts: [
        { name: "authority", writable: true, signer: true },
        {
          name: "global_config",
          writable: true,
          pda: { seeds: [{ kind: "const", value: [103, 108, 111, 98, 97, 108, 45, 99, 111, 110, 102, 105, 103] }] }
        },
        {
          name: "event_authority",
          pda: { seeds: [{ kind: "const", value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121] }] }
        },
        { name: "program" }
      ],
      args: [
        { name: "index", type: "u8" }
      ]
    },
    {
      name: "global_update_authorities",
      discriminator: [91, 137, 72, 77, 183, 184, 168, 125],
      accounts: [
        { name: "authority", writable: true, signer: true },
        {
          name: "global_config",
          writable: true,
          pda: { seeds: [{ kind: "const", value: [103, 108, 111, 98, 97, 108, 45, 99, 111, 110, 102, 105, 103] }] }
        },
        {
          name: "event_authority",
          pda: { seeds: [{ kind: "const", value: [95, 95, 101, 118, 101, 110, 116, 95, 97, 117, 116, 104, 111, 114, 105, 116, 121] }] }
        },
        { name: "program" }
      ],
      args: [
        { name: "protocol_authority", type: { option: "pubkey" } },
        { name: "buyback_authority", type: { option: "pubkey" } }
      ]
    }
  ],
  accounts: [
    { name: "BondingCurve", discriminator: [23, 183, 248, 55, 96, 216, 172, 96] },
    { name: "GlobalConfig", discriminator: [149, 8, 156, 202, 160, 252, 176, 217] },
    { name: "TokenAgentPaymentInCurrency", discriminator: [225, 195, 81, 227, 115, 43, 25, 177] },
    { name: "TokenAgentPayments", discriminator: [136, 241, 242, 217, 173, 77, 112, 186] }
  ],
  events: [
    { name: "AgentAcceptPaymentEvent", discriminator: [114, 190, 188, 192, 105, 79, 41, 147] },
    { name: "AgentBuybackTriggerEvent", discriminator: [139, 240, 9, 225, 214, 63, 232, 165] },
    { name: "AgentDistributePaymentsEvent", discriminator: [137, 116, 114, 140, 54, 111, 230, 26] },
    { name: "AgentInitializeEvent", discriminator: [192, 5, 183, 151, 0, 64, 100, 207] },
    { name: "AgentUpdateAuthorityEvent", discriminator: [36, 212, 117, 235, 74, 166, 60, 16] },
    { name: "AgentUpdateBuybackBpsEvent", discriminator: [165, 251, 40, 19, 114, 26, 128, 232] },
    { name: "AgentWithdrawEvent", discriminator: [174, 231, 201, 69, 254, 183, 49, 85] },
    { name: "ExtendAccountEvent", discriminator: [97, 97, 215, 144, 93, 146, 22, 124] },
    { name: "GlobalAddNewCurrencyEvent", discriminator: [130, 202, 37, 248, 241, 182, 233, 35] },
    { name: "GlobalConfigInitializeEvent", discriminator: [241, 51, 222, 190, 142, 245, 176, 53] },
    { name: "GlobalUpdateAuthoritiesEvent", discriminator: [82, 27, 22, 232, 53, 66, 35, 207] }
  ],
  errors: [
    { code: 6e3, name: "UnauthorizedSigner", msg: "The given account is not authorized to execute this instruction." },
    { code: 6001, name: "CurrencyAlreadySupported", msg: "The given currency is already supported." },
    { code: 6002, name: "MaxCurrenciesReached", msg: "The maximum number of currencies has been reached." },
    { code: 6003, name: "InvalidBuybackBps", msg: "The buyback basis points is greater than 10000." },
    { code: 6004, name: "CurrencyNotSupported", msg: "The given currency is not supported." },
    { code: 6005, name: "MathOverflow", msg: "Math overflow." },
    { code: 6006, name: "InvalidRemainingAccountAddress", msg: "The given remaining account address is invalid." },
    { code: 6007, name: "PaymentVaultNotEmpty", msg: "The payment vault is not empty. Distribute the payments first." },
    { code: 6008, name: "InvalidInvoiceAccount", msg: "The invoice account does not match the expected PDA seeds" },
    { code: 6009, name: "InvalidProgramToInvoke", msg: "The program to invoke is not allowed." },
    { code: 6010, name: "InvalidCallbackProgram", msg: "The callback program is invalid." },
    { code: 6011, name: "SwapFailedAmountDidNotIncrease", msg: "The swap failed and the amount did not increase." },
    { code: 6012, name: "AccountTypeNotSupported", msg: "The account type is not supported for extension." },
    { code: 6013, name: "InvalidIndex", msg: "The index is invalid." }
  ],
  types: [
    {
      name: "AgentAcceptPaymentEvent",
      type: {
        kind: "struct",
        fields: [
          { name: "user", type: "pubkey" },
          { name: "tokenized_agent_mint", type: "pubkey" },
          { name: "token_agent_payments", type: "pubkey" },
          { name: "currency_mint", type: "pubkey" },
          { name: "amount", type: "u64" },
          { name: "memo", type: "u64" },
          { name: "start_time", type: "i64" },
          { name: "end_time", type: "i64" },
          { name: "invoice_id", type: "pubkey" },
          { name: "agent_post_balance", type: "u64" },
          { name: "timestamp", type: "i64" }
        ]
      }
    },
    {
      name: "AgentBuybackTriggerEvent",
      type: {
        kind: "struct",
        fields: [
          { name: "tokenized_agent_mint", type: "pubkey" },
          { name: "currency_mint", type: "pubkey" },
          { name: "amount_burned", type: "u64" },
          { name: "swap_program", type: "pubkey" },
          { name: "new_tokens_bought_and_burned_for_currency", type: "u64" },
          { name: "agent_post_balance", type: "u64" },
          { name: "timestamp", type: "i64" },
          { name: "currency_mint_amount_for_buyback", type: "u64" }
        ]
      }
    },
    {
      name: "AgentDistributePaymentsEvent",
      type: {
        kind: "struct",
        fields: [
          { name: "token_agent_payments", type: "pubkey" },
          { name: "currency_mint", type: "pubkey" },
          { name: "buyback_bps", type: "u16" },
          { name: "buyback_amount", type: "u64" },
          { name: "withdraw_amount", type: "u64" },
          { name: "timestamp", type: "i64" }
        ]
      }
    },
    {
      name: "AgentInitializeEvent",
      type: {
        kind: "struct",
        fields: [
          { name: "token_agent_payments", type: "pubkey" },
          { name: "mint", type: "pubkey" },
          { name: "authority", type: "pubkey" },
          { name: "buyback_bps", type: "u16" },
          { name: "timestamp", type: "i64" },
          { name: "tokenized_agent_sequence", type: "u64" }
        ]
      }
    },
    {
      name: "AgentUpdateAuthorityEvent",
      type: {
        kind: "struct",
        fields: [
          { name: "token_agent_payments", type: "pubkey" },
          { name: "old_authority", type: "pubkey" },
          { name: "new_authority", type: "pubkey" },
          { name: "timestamp", type: "i64" }
        ]
      }
    },
    {
      name: "AgentUpdateBuybackBpsEvent",
      type: {
        kind: "struct",
        fields: [
          { name: "token_agent_payments", type: "pubkey" },
          { name: "mint", type: "pubkey" },
          { name: "old_buyback_bps", type: "u16" },
          { name: "new_buyback_bps", type: "u16" },
          { name: "timestamp", type: "i64" }
        ]
      }
    },
    {
      name: "AgentWithdrawEvent",
      type: {
        kind: "struct",
        fields: [
          { name: "tokenized_agent_mint", type: "pubkey" },
          { name: "currency_mint", type: "pubkey" },
          { name: "amount", type: "u64" },
          { name: "receiver", type: "pubkey" },
          { name: "timestamp", type: "i64" }
        ]
      }
    },
    {
      name: "BondingCurve",
      type: {
        kind: "struct",
        fields: [
          { name: "virtual_token_reserves", type: "u64" },
          { name: "virtual_sol_reserves", type: "u64" },
          { name: "real_token_reserves", type: "u64" },
          { name: "real_sol_reserves", type: "u64" },
          { name: "token_total_supply", type: "u64" },
          { name: "complete", type: "bool" },
          { name: "creator", type: "pubkey" },
          { name: "is_mayhem_mode", type: "bool" }
        ]
      }
    },
    {
      name: "ExtendAccountEvent",
      type: {
        kind: "struct",
        fields: [
          { name: "account", type: "pubkey" },
          { name: "user", type: "pubkey" },
          { name: "current_size", type: "u64" },
          { name: "new_size", type: "u64" },
          { name: "timestamp", type: "i64" }
        ]
      }
    },
    {
      name: "GlobalAddNewCurrencyEvent",
      type: {
        kind: "struct",
        fields: [
          { name: "global_config", type: "pubkey" },
          { name: "currency_mint", type: "pubkey" },
          { name: "timestamp", type: "i64" }
        ]
      }
    },
    {
      name: "GlobalConfig",
      type: {
        kind: "struct",
        fields: [
          { name: "bump", type: "u8" },
          { name: "protocol_authority", type: "pubkey" },
          { name: "buyback_authority", type: "pubkey" },
          { name: "supported_currencies_mint", type: { array: ["pubkey", 10] } },
          { name: "tokenized_agent_sequence", type: "u64" }
        ]
      }
    },
    {
      name: "GlobalConfigInitializeEvent",
      type: {
        kind: "struct",
        fields: [
          { name: "global_config", type: "pubkey" },
          { name: "protocol_authority", type: "pubkey" },
          { name: "buyback_authority", type: "pubkey" },
          { name: "timestamp", type: "i64" }
        ]
      }
    },
    {
      name: "GlobalUpdateAuthoritiesEvent",
      type: {
        kind: "struct",
        fields: [
          { name: "global_config", type: "pubkey" },
          { name: "protocol_authority", type: { option: "pubkey" } },
          { name: "buyback_authority", type: { option: "pubkey" } },
          { name: "timestamp", type: "i64" }
        ]
      }
    },
    {
      name: "TokenAgentPaymentInCurrency",
      type: {
        kind: "struct",
        fields: [
          { name: "mint", type: "pubkey" },
          { name: "currency_mint", type: "pubkey" },
          { name: "total_invoice_payments_made", type: "u64" },
          { name: "total_buyback", type: "u64" },
          { name: "total_withdrawals", type: "u64" },
          { name: "tokens_bought_back_and_burned", type: "u64" }
        ]
      }
    },
    {
      name: "TokenAgentPayments",
      type: {
        kind: "struct",
        fields: [
          { name: "bump", type: "u8" },
          { name: "mint", type: "pubkey" },
          { name: "authority", type: "pubkey" },
          { name: "buyback_bps", type: "u16" }
        ]
      }
    }
  ]
};

// src/solana/program.ts
function getPumpProgram(connection) {
  const dummyWallet = {
    publicKey: PublicKey.default,
    signTransaction: () => Promise.reject(),
    signAllTransactions: () => Promise.reject()
  };
  return new Program(
    pump_agent_payments_default,
    new AnchorProvider(connection, dummyWallet, {})
  );
}
var OFFLINE_PUMP_PROGRAM = getPumpProgram(null);
function getPumpProgramWithFallback(connection) {
  return connection ? getPumpProgram(connection) : OFFLINE_PUMP_PROGRAM;
}
var PROGRAM_ID = new PublicKey(
  "AgenTMiC2hvxGebTsgmsD4HHBa8WEcqGFf87iwRRxLo7"
);
var PUMP_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);
new PublicKey(
  "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"
);
var GLOBAL_CONFIG_SEED = Buffer.from("global-config");
var TOKEN_AGENT_PAYMENTS_SEED = Buffer.from("token-agent-payments");
var PAYMENT_IN_CURRENCY_SEED = Buffer.from("payment-in-currency");
var INVOICE_ID_SEED = Buffer.from("invoice-id");
var BUYBACK_AUTHORITY_SEED = Buffer.from("buyback-authority");
var WITHDRAW_AUTHORITY_SEED = Buffer.from("withdraw-authority");
var BONDING_CURVE_SEED = Buffer.from("bonding-curve");
Buffer.from("sharing-config");
function getGlobalConfigPDA() {
  return PublicKey.findProgramAddressSync([GLOBAL_CONFIG_SEED], PROGRAM_ID);
}
function getTokenAgentPaymentsPDA(mint) {
  return PublicKey.findProgramAddressSync(
    [TOKEN_AGENT_PAYMENTS_SEED, mint.toBuffer()],
    PROGRAM_ID
  );
}
function getPaymentInCurrencyPDA(tokenMint, currencyMint) {
  return PublicKey.findProgramAddressSync(
    [PAYMENT_IN_CURRENCY_SEED, tokenMint.toBuffer(), currencyMint.toBuffer()],
    PROGRAM_ID
  );
}
function getInvoiceIdPDA(tokenMint, currencyMint, amount, memo, startTime, endTime) {
  return PublicKey.findProgramAddressSync(
    [
      INVOICE_ID_SEED,
      tokenMint.toBuffer(),
      currencyMint.toBuffer(),
      amount.toArrayLike(Buffer, "le", 8),
      memo.toArrayLike(Buffer, "le", 8),
      startTime.toArrayLike(Buffer, "le", 8),
      endTime.toArrayLike(Buffer, "le", 8)
    ],
    PROGRAM_ID
  );
}
function getBuybackAuthorityPDA(tokenMint) {
  return PublicKey.findProgramAddressSync(
    [BUYBACK_AUTHORITY_SEED, tokenMint.toBuffer()],
    PROGRAM_ID
  );
}
function getWithdrawAuthorityPDA(tokenMint) {
  return PublicKey.findProgramAddressSync(
    [WITHDRAW_AUTHORITY_SEED, tokenMint.toBuffer()],
    PROGRAM_ID
  );
}
function getBondingCurvePDA(mint) {
  return PublicKey.findProgramAddressSync(
    [BONDING_CURVE_SEED, mint.toBuffer()],
    PUMP_PROGRAM_ID
  );
}

// src/solana/errors.ts
var JupiterUnavailableError = class extends Error {
  constructor(message, endpoint, status) {
    super(message);
    this.name = "JupiterUnavailableError";
    this.endpoint = endpoint;
    this.status = status;
  }
};

// src/solana/PumpAgentOffline.ts
var USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);
var ANCHOR_DISCRIMINATOR_LEN = 8;
var BONDING_CURVE_QUOTE_MINT_OFFSET = ANCHOR_DISCRIMINATOR_LEN + 5 * 8 + 1 + 32 + 1 + 1;
function decodeBondingCurveQuoteMint(data) {
  if (data.length < BONDING_CURVE_QUOTE_MINT_OFFSET + 32) {
    return NATIVE_MINT;
  }
  const slice = data.subarray(
    BONDING_CURVE_QUOTE_MINT_OFFSET,
    BONDING_CURVE_QUOTE_MINT_OFFSET + 32
  );
  const pk2 = new PublicKey(slice);
  return PublicKey.default.equals(pk2) ? NATIVE_MINT : pk2;
}
async function resolveTokenProgramForMint(connection, mint) {
  if (mint.equals(NATIVE_MINT) || mint.equals(USDC_MINT)) {
    return TOKEN_PROGRAM_ID;
  }
  const info = await connection.getAccountInfo(mint);
  if (!info) return TOKEN_PROGRAM_ID;
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
  return TOKEN_PROGRAM_ID;
}
function toBN(value) {
  return new BN(value.toString());
}
var _PumpAgentOffline = class _PumpAgentOffline {
  constructor(mint, program = getPumpProgramWithFallback()) {
    this.mint = mint;
    this.program = program;
  }
  static load(mint, connection) {
    return new _PumpAgentOffline(mint, getPumpProgramWithFallback(connection));
  }
  async create(params) {
    const { authority, mint, agentAuthority, buybackBps } = params;
    const [bondingCurve] = getBondingCurvePDA(mint);
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(mint);
    return this.program.methods.agentInitialize(agentAuthority, buybackBps).accountsPartial({
      authority,
      bondingCurve,
      mint,
      tokenAgentPayments
    }).instruction();
  }
  async withdraw(params) {
    const { authority, currencyMint, receiverAta, tokenProgram } = params;
    const tp = tokenProgram ?? TOKEN_PROGRAM_ID;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const [withdrawAuthority] = getWithdrawAuthorityPDA(this.mint);
    const withdrawVault = getAssociatedTokenAddressSync(
      currencyMint,
      withdrawAuthority,
      true,
      tp
    );
    return this.program.methods.agentWithdraw().accountsPartial({
      authority,
      tokenAgentPayments,
      currencyMint,
      withdrawAuthority,
      withdrawVault,
      receiverAta,
      tokenProgram: tp
    }).instruction();
  }
  async updateBuybackBps(params, options) {
    const { authority, buybackBps } = params;
    const supportedCurrencies = options.supportedCurrencies;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const [globalConfig] = getGlobalConfigPDA();
    const remainingAccounts = [];
    for (const currency of supportedCurrencies) {
      if (currency.mint.equals(PublicKey.default)) continue;
      const ata = getAssociatedTokenAddressSync(
        currency.mint,
        tokenAgentPayments,
        true,
        currency.tokenProgram
      );
      remainingAccounts.push({
        pubkey: ata,
        isWritable: false,
        isSigner: false
      });
    }
    return this.program.methods.agentUpdateBuybackBps(buybackBps).accountsPartial({
      authority,
      tokenAgentPayments,
      globalConfig
    }).remainingAccounts(remainingAccounts).instruction();
  }
  async acceptPayment(params) {
    const {
      user,
      userTokenAccount,
      currencyMint,
      amount,
      memo,
      startTime,
      endTime,
      tokenProgram
    } = params;
    const tp = tokenProgram ?? TOKEN_PROGRAM_ID;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const [globalConfig] = getGlobalConfigPDA();
    const [paymentInCurrency] = getPaymentInCurrencyPDA(
      this.mint,
      currencyMint
    );
    const [invoiceId] = getInvoiceIdPDA(
      this.mint,
      currencyMint,
      amount,
      memo,
      startTime,
      endTime
    );
    const tokenAgentAssociatedAccount = getAssociatedTokenAddressSync(
      currencyMint,
      tokenAgentPayments,
      true,
      tp
    );
    return this.program.methods.agentAcceptPayment(amount, memo, startTime, endTime).accountsPartial({
      user,
      userTokenAccount,
      tokenAgentPayments,
      tokenAgentAssociatedAccount,
      tokenAgentPaymentInCurrency: paymentInCurrency,
      globalConfig,
      invoiceId,
      currencyMint,
      tokenProgram: tp
    }).instruction();
  }
  async buildAcceptPaymentInstructions(params) {
    const { user, currencyMint } = params;
    const computeUnitLimit = params.computeUnitLimit ?? _PumpAgentOffline.DEFAULT_COMPUTE_UNIT_LIMIT_FOR_AGENT_PAYMENTS;
    const tp = params.tokenProgram ?? TOKEN_PROGRAM_ID;
    const userTokenAccount = getAssociatedTokenAddressSync(
      currencyMint,
      user,
      false,
      tp
    );
    const acceptIx = await this.acceptPayment({
      user,
      userTokenAccount,
      currencyMint,
      amount: toBN(params.amount),
      memo: toBN(params.memo),
      startTime: toBN(params.startTime),
      endTime: toBN(params.endTime),
      tokenProgram: params.tokenProgram
    });
    const ixs = [
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit })
    ];
    if (params.computeUnitPrice != null) {
      ixs.push(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: params.computeUnitPrice
        })
      );
    }
    if (currencyMint.equals(NATIVE_MINT)) {
      return [
        ...ixs,
        createAssociatedTokenAccountIdempotentInstruction(
          user,
          userTokenAccount,
          user,
          NATIVE_MINT
        ),
        SystemProgram.transfer({
          fromPubkey: user,
          toPubkey: userTokenAccount,
          lamports: BigInt(params.amount.toString())
        }),
        createSyncNativeInstruction(userTokenAccount),
        acceptIx,
        createCloseAccountInstruction(userTokenAccount, user, user)
      ];
    }
    return [...ixs, acceptIx];
  }
  async distributePayments(params) {
    const {
      user,
      currencyMint,
      tokenProgram,
      includeTransferExtraLamportsForNative = false
    } = params;
    const tp = tokenProgram ?? TOKEN_PROGRAM_ID;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const [globalConfig] = getGlobalConfigPDA();
    const [paymentInCurrency] = getPaymentInCurrencyPDA(
      this.mint,
      currencyMint
    );
    const [buybackAuthority] = getBuybackAuthorityPDA(this.mint);
    const [withdrawAuthority] = getWithdrawAuthorityPDA(this.mint);
    const tokenAgentAssociatedAccount = getAssociatedTokenAddressSync(
      currencyMint,
      tokenAgentPayments,
      true,
      tp
    );
    const buybackVault = getAssociatedTokenAddressSync(
      currencyMint,
      buybackAuthority,
      true,
      tp
    );
    const withdrawVault = getAssociatedTokenAddressSync(
      currencyMint,
      withdrawAuthority,
      true,
      tp
    );
    const distributeIx = await this.program.methods.agentDistributePayments().accountsPartial({
      user,
      globalConfig,
      currencyMint,
      tokenAgentPayments,
      tokenAgentPaymentInCurrency: paymentInCurrency,
      tokenAgentAssociatedAccount,
      buybackAuthority,
      withdrawAuthority,
      buybackVault,
      withdrawVault,
      tokenProgram: tp
    }).instruction();
    if (includeTransferExtraLamportsForNative && currencyMint.equals(NATIVE_MINT)) {
      const transferIx = await this.program.methods.agentTransferExtraLamports().accountsPartial({
        tokenAgentPayments,
        tokenAgentAssociatedAccount
      }).instruction();
      return [transferIx, distributeIx];
    }
    return [distributeIx];
  }
  async buybackTrigger(params) {
    const {
      globalBuybackAuthority,
      currencyMint,
      swapProgramToInvoke,
      swapInstructionData,
      remainingAccounts,
      tokenProgramCurrency,
      tokenProgram
    } = params;
    const tp = tokenProgram ?? TOKEN_PROGRAM_ID;
    const tpCurrency = tokenProgramCurrency ?? TOKEN_PROGRAM_ID;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const [globalConfig] = getGlobalConfigPDA();
    const [buybackAuthority] = getBuybackAuthorityPDA(this.mint);
    const [paymentInCurrency] = getPaymentInCurrencyPDA(
      this.mint,
      currencyMint
    );
    const burnMintVault = getAssociatedTokenAddressSync(
      this.mint,
      buybackAuthority,
      true,
      tp
    );
    const burnCurrencyMintVault = getAssociatedTokenAddressSync(
      currencyMint,
      buybackAuthority,
      true,
      tpCurrency
    );
    return this.program.methods.agentBuybackTrigger(swapInstructionData).accountsPartial({
      globalBuybackAuthority,
      mint: this.mint,
      tokenAgentPayments,
      tokenAgentPaymentInCurrency: paymentInCurrency,
      currencyMint,
      globalConfig,
      swapProgramToInvoke,
      burnAuthority: buybackAuthority,
      burnMintVault,
      burnCurrencyMintVault,
      tokenProgram: tp,
      tokenProgramCurrency: tpCurrency
    }).remainingAccounts(remainingAccounts).instruction();
  }
  async extendAccount(params) {
    const { account, user } = params;
    return this.program.methods.extendAccount().accountsPartial({ account, user }).instruction();
  }
  async updateAuthority(params) {
    const { authority, newAuthority } = params;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    return this.program.methods.agentUpdateAuthority(newAuthority).accountsPartial({
      authority,
      tokenAgentPayments
    }).instruction();
  }
  /**
   * Returns the `close_account` instruction to close a program account
   * and reclaim its rent-exempt lamports.
   */
  async closeAccount(params) {
    const { account, user } = params;
    const [globalConfig] = getGlobalConfigPDA();
    return this.program.methods.closeAccount().accountsPartial({
      account,
      user,
      globalConfig
    }).instruction();
  }
  static async getCoinQuoteMint(connection, baseMint) {
    const key = baseMint.toBase58();
    const cached = _PumpAgentOffline._coinQuoteMintCache.get(key);
    if (cached) return cached;
    const [bondingCurve] = getBondingCurvePDA(baseMint);
    const info = await connection.getAccountInfo(bondingCurve);
    if (!info) {
      throw new Error(
        `Bonding curve account not found for mint ${key} (PDA ${bondingCurve.toBase58()})`
      );
    }
    const quoteMint = decodeBondingCurveQuoteMint(info.data);
    _PumpAgentOffline._coinQuoteMintCache.set(key, quoteMint);
    return quoteMint;
  }
  static _clearCoinQuoteMintCache() {
    _PumpAgentOffline._coinQuoteMintCache.clear();
  }
  async acceptPaymentForCoin(params) {
    const { connection, user, userTokenAccount, baseMint, amount, memo, startTime, endTime } = params;
    const quoteMint = await _PumpAgentOffline.getCoinQuoteMint(connection, baseMint);
    const tokenProgram = await resolveTokenProgramForMint(connection, quoteMint);
    return this.acceptPayment({
      user,
      userTokenAccount,
      currencyMint: quoteMint,
      amount,
      memo,
      startTime,
      endTime,
      tokenProgram
    });
  }
  async distributeAndBuybackForCoin(params) {
    const {
      connection,
      user,
      globalBuybackAuthority,
      baseMint,
      swapProgramToInvoke,
      swapInstructionData,
      remainingAccounts
    } = params;
    const quoteMint = await _PumpAgentOffline.getCoinQuoteMint(connection, baseMint);
    const tpCurrency = await resolveTokenProgramForMint(connection, quoteMint);
    const [distributeIx] = await this.distributePayments({
      user,
      currencyMint: quoteMint,
      tokenProgram: tpCurrency
    });
    const buybackIx = await this.buybackTrigger({
      globalBuybackAuthority,
      currencyMint: quoteMint,
      swapProgramToInvoke,
      swapInstructionData,
      remainingAccounts,
      tokenProgramCurrency: tpCurrency,
      tokenProgram: TOKEN_PROGRAM_ID
    });
    return [distributeIx, buybackIx];
  }
  static async buildJupiterSwapData(params) {
    const {
      inputMint,
      outputMint,
      amount,
      slippageBps = 50,
      jupiterApiBase = "https://quote-api.jup.ag/v6"
    } = params;
    const baseUrl = jupiterApiBase.replace(/\/+$/, "");
    const amountStr = amount.toString();
    const retryFetch = async (url, init) => {
      let lastErr;
      for (let i = 0; i < 3; i++) {
        if (i > 0) {
          await new Promise((r) => setTimeout(r, 200 * 2 ** (i - 1)));
        }
        try {
          const resp = await fetch(url, init);
          if (resp.ok) return resp;
          lastErr = new JupiterUnavailableError(
            `HTTP ${resp.status} from Jupiter API`,
            url,
            resp.status
          );
        } catch (err) {
          lastErr = err;
        }
      }
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
      throw new JupiterUnavailableError(
        `Jupiter unavailable after 3 attempts: ${msg}`,
        url
      );
    };
    const quoteUrl = `${baseUrl}/quote?inputMint=${inputMint.toBase58()}&outputMint=${outputMint.toBase58()}&amount=${amountStr}&slippageBps=${slippageBps}`;
    const quoteResp = await retryFetch(quoteUrl);
    const quoteResponse = await quoteResp.json();
    const swapUrl = `${baseUrl}/swap-instructions`;
    const swapResp = await retryFetch(swapUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quoteResponse, wrapAndUnwrapSol: false })
    });
    const swapJson = await swapResp.json();
    const dataB64 = swapJson.swapInstruction?.data;
    if (!dataB64) {
      throw new JupiterUnavailableError(
        "Jupiter swap-instructions response missing swapInstruction.data",
        swapUrl
      );
    }
    return Buffer.from(dataB64, "base64");
  }
  async validateCurrencySupport(params) {
    const { connection, baseMint } = params;
    const quoteMint = await _PumpAgentOffline.getCoinQuoteMint(connection, baseMint);
    const [globalConfigPda] = getGlobalConfigPDA();
    const cfg = await this.program.account.GlobalConfig.fetch(globalConfigPda);
    const registeredCurrencies = cfg.supportedCurrenciesMint.filter(
      (m) => !PublicKey.default.equals(m)
    );
    const supported = quoteMint.equals(NATIVE_MINT) || registeredCurrencies.some((m) => m.equals(quoteMint));
    return { supported, quoteMint, registeredCurrencies };
  }
};
_PumpAgentOffline.DEFAULT_COMPUTE_UNIT_LIMIT_FOR_AGENT_PAYMENTS = 1e5;
_PumpAgentOffline.DEFAULT_PRIORITY_FEE_MICRO_LAMPORTS = 1e3;
// ─── Multi-currency / USDC-aware helpers ────────────────────────────────
_PumpAgentOffline._coinQuoteMintCache = /* @__PURE__ */ new Map();
var PumpAgentOffline = _PumpAgentOffline;
function createEventParser(connection) {
  const program = connection ? getPumpProgramWithFallback(connection) : OFFLINE_PUMP_PROGRAM;
  return new EventParser(program.programId, program.coder);
}
function parseAgentEvents(logs, connection) {
  const parser = createEventParser(connection);
  const events = [];
  for (const event of parser.parseLogs(logs)) {
    events.push({
      name: event.name,
      data: event.data
    });
  }
  return events;
}

// src/solana/PumpAgent.ts
var PumpAgent = class extends PumpAgentOffline {
  constructor(mint, environment = "mainnet", connection) {
    super(mint, getPumpProgramWithFallback(connection));
    this.connection = connection;
    this.environment = environment;
  }
  get blockchainClientBaseUrl() {
    return this.environment === "devnet" ? "https://blockchain-client.internal.pump.fun" : "https://fun-block.pump.fun";
  }
  /**
   * Fetches the current balances for all three vaults for a given currency.
   * Returns the vault address and its token balance.
   * If a vault ATA does not exist yet the balance is reported as 0n.
   */
  async getBalances(currencyMint, currencyTokenProgram = TOKEN_PROGRAM_ID) {
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const [buybackAuthority] = getBuybackAuthorityPDA(this.mint);
    const [withdrawAuthority] = getWithdrawAuthorityPDA(this.mint);
    const paymentAta = getAssociatedTokenAddressSync(
      currencyMint,
      tokenAgentPayments,
      true,
      currencyTokenProgram
    );
    const buybackAta = getAssociatedTokenAddressSync(
      currencyMint,
      buybackAuthority,
      true,
      currencyTokenProgram
    );
    const withdrawAta = getAssociatedTokenAddressSync(
      currencyMint,
      withdrawAuthority,
      true,
      currencyTokenProgram
    );
    const fetchBalance = async (ata) => {
      try {
        const resp = await connection.getTokenAccountBalance(ata);
        return BigInt(resp.value.amount);
      } catch {
        return 0n;
      }
    };
    const [paymentBal, buybackBal, withdrawBal] = await Promise.all([
      fetchBalance(paymentAta),
      fetchBalance(buybackAta),
      fetchBalance(withdrawAta)
    ]);
    return {
      quoteMint: currencyMint,
      paymentVault: { address: paymentAta, balance: paymentBal },
      buybackVault: { address: buybackAta, balance: buybackBal },
      withdrawVault: { address: withdrawAta, balance: withdrawBal }
    };
  }
  /**
   * Fetch balances for every currency this agent could receive — i.e. SOL
   * (always) plus every non-default mint in `GlobalConfig.supportedCurrenciesMint`.
   *
   * Returned map is keyed by `mint.toBase58()`. Lookups happen concurrently.
   */
  async getAllCurrencyBalances() {
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");
    const cfg = await this.getGlobalConfig();
    const splMints = cfg.supportedCurrenciesMint.filter(
      (m) => !PublicKey.default.equals(m)
    );
    const accountInfos = splMints.length ? await connection.getMultipleAccountsInfo(splMints) : [];
    const queries = [
      { mint: NATIVE_MINT, tokenProgram: TOKEN_PROGRAM_ID }
    ];
    for (const [idx, mint] of splMints.entries()) {
      if (mint.equals(NATIVE_MINT)) continue;
      const info = accountInfos[idx];
      if (!info) continue;
      queries.push({ mint, tokenProgram: info.owner });
    }
    const results = await Promise.all(
      queries.map(async ({ mint, tokenProgram }) => {
        const balances = await this.getBalances(mint, tokenProgram);
        return [mint.toBase58(), balances];
      })
    );
    return new Map(results);
  }
  async getCoinQuoteMint(baseMint) {
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");
    return PumpAgentOffline.getCoinQuoteMint(connection, baseMint);
  }
  async getCoinPaymentSummary(baseMint) {
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");
    const quoteMint = await PumpAgentOffline.getCoinQuoteMint(connection, baseMint);
    const tp = await resolveTokenProgramForMint(connection, quoteMint);
    const [balances, stats] = await Promise.all([
      this.getBalances(quoteMint, tp),
      this.getPaymentStats(quoteMint).catch(() => null)
    ]);
    const totalPaymentsReceived = stats ? new BN(stats.totalInvoicePaymentsMade.toString()) : new BN(0);
    return {
      quoteMint,
      totalPaymentsReceived,
      pendingBuyback: new BN(balances.buybackVault.balance.toString()),
      pendingWithdrawal: new BN(balances.withdrawVault.balance.toString()),
      readyToDistribute: balances.paymentVault.balance > 0n
    };
  }
  /**
   * Returns the `agent_update_buyback_bps` instruction and auto-fetches
   * supported currencies from GlobalConfig when options are omitted.
   */
  async updateBuybackBps(params) {
    const { authority, buybackBps } = params;
    const [globalConfigPda] = getGlobalConfigPDA();
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");
    const globalConfigAccount = await this.program.account.GlobalConfig.fetch(globalConfigPda);
    const mints = globalConfigAccount.supportedCurrenciesMint.filter(
      (m) => !PublicKey.default.equals(m)
    );
    const accountInfos = await connection.getMultipleAccountsInfo(mints);
    const supportedCurrencies = [];
    for (const [idx, mint] of mints.entries()) {
      const info = accountInfos[idx];
      if (info) {
        supportedCurrencies.push({ mint, tokenProgram: info.owner });
      }
    }
    return super.updateBuybackBps(
      { authority, buybackBps },
      { supportedCurrencies }
    );
  }
  // ─── Account Fetch Helpers ──────────────────────────────────────────────
  /**
   * Fetch the on-chain TokenAgentPayments config for this agent's mint.
   * Returns the authority, buyback bps, and mint.
   */
  async getAgentConfig() {
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");
    const [pda] = getTokenAgentPaymentsPDA(this.mint);
    return this.program.account.TokenAgentPayments.fetch(pda);
  }
  /**
   * Fetch the protocol-wide GlobalConfig account.
   * Returns authorities and the list of supported currency mints.
   */
  async getGlobalConfig() {
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");
    const [pda] = getGlobalConfigPDA();
    return this.program.account.GlobalConfig.fetch(pda);
  }
  /**
   * Fetch the per-currency accounting stats for this agent.
   * Returns total payments, buybacks, withdrawals, and tokens burned.
   */
  async getPaymentStats(currencyMint) {
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");
    const [pda] = getPaymentInCurrencyPDA(this.mint, currencyMint);
    return this.program.account.TokenAgentPaymentInCurrency.fetch(pda);
  }
  /**
   * Fetch the list of supported currency mints from GlobalConfig,
   * filtered to only non-default (non-zero) entries.
   */
  async getSupportedCurrencies() {
    const config = await this.getGlobalConfig();
    return config.supportedCurrenciesMint.filter(
      (m) => !PublicKey.default.equals(m)
    );
  }
  /**
   * Check whether the TokenAgentPayments account exists on-chain
   * (i.e. whether this agent has been initialized).
   */
  async isInitialized() {
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");
    const [pda] = getTokenAgentPaymentsPDA(this.mint);
    const info = await connection.getAccountInfo(pda);
    return info !== null;
  }
  // ─── Payment History ────────────────────────────────────────────────────
  /**
   * Fetch recent payment events for this agent by scanning on-chain
   * transaction logs on the TokenAgentPayments PDA.
   *
   * @param limit - Maximum number of transactions to scan (default: 50)
   * @returns Parsed `AgentAcceptPaymentEvent`s in reverse chronological order
   */
  async getPaymentHistory(limit = 50) {
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const signatures = await connection.getSignaturesForAddress(
      tokenAgentPayments,
      { limit }
    );
    const payments = [];
    for (const sig of signatures) {
      if (sig.err) continue;
      const tx = await connection.getTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0
      });
      if (!tx?.meta?.logMessages) continue;
      const events = parseAgentEvents(tx.meta.logMessages, connection);
      for (const event of events) {
        if (event.name === "agentAcceptPaymentEvent") {
          payments.push(event.data);
        }
      }
    }
    return payments;
  }
  /**
   * Fetch all recent events for this agent (payments, distributions,
   * buybacks, withdrawals, etc.) from on-chain transaction logs.
   *
   * @param limit - Maximum number of transactions to scan (default: 50)
   */
  async getEventHistory(limit = 50) {
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const signatures = await connection.getSignaturesForAddress(
      tokenAgentPayments,
      { limit }
    );
    const allEvents = [];
    for (const sig of signatures) {
      if (sig.err) continue;
      const tx = await connection.getTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0
      });
      if (!tx?.meta?.logMessages) continue;
      const events = parseAgentEvents(tx.meta.logMessages, connection);
      allEvents.push(...events);
    }
    return allEvents;
  }
  // ─── Invoice Validation ─────────────────────────────────────────────────
  async validateInvoicePayment(params) {
    const { user, currencyMint } = params;
    const amount = new BN(params.amount);
    const memo = new BN(params.memo);
    const startTime = new BN(params.startTime);
    const endTime = new BN(params.endTime);
    const [invoiceId] = getInvoiceIdPDA(
      this.mint,
      currencyMint,
      amount,
      memo,
      startTime,
      endTime
    );
    try {
      const url = new URL(
        "/agents/invoice-id",
        this.blockchainClientBaseUrl
      );
      url.searchParams.set("invoice-id", invoiceId.toBase58());
      url.searchParams.set("mint", this.mint.toBase58());
      const response = await fetch(url.toString());
      if (response.ok) {
        const data = await response.json();
        return data.user === user.toBase58() && data.tokenized_agent_mint === this.mint.toBase58() && data.currency_mint === currencyMint.toBase58() && new BN(data.amount).eq(amount) && new BN(data.memo).eq(memo) && new BN(data.start_time).eq(startTime) && new BN(data.end_time).eq(endTime);
      }
    } catch {
    }
    return this.validateInvoicePaymentViaRpc({
      user,
      currencyMint,
      amount,
      memo,
      startTime,
      endTime
    });
  }
  /** RPC-based fallback: scans on-chain transaction logs for the payment event. */
  async validateInvoicePaymentViaRpc(params) {
    const { user, currencyMint, amount, memo, startTime, endTime } = params;
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");
    const [invoiceId] = getInvoiceIdPDA(
      this.mint,
      currencyMint,
      amount,
      memo,
      startTime,
      endTime
    );
    const signatures = await connection.getSignaturesForAddress(invoiceId);
    for (const sig of signatures) {
      const tx = await connection.getTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0
      });
      if (!tx || tx.meta?.err) continue;
      const logs = tx.meta?.logMessages;
      if (!logs) continue;
      const parser = new EventParser(
        this.program.programId,
        this.program.coder
      );
      for (const event of parser.parseLogs(logs)) {
        if (event.name !== "agentAcceptPaymentEvent") continue;
        const data = event.data;
        if (data.user.equals(user) && data.tokenizedAgentMint.equals(this.mint) && data.currencyMint.equals(currencyMint) && data.amount.eq(amount) && data.memo.eq(memo) && data.startTime.eq(startTime) && data.endTime.eq(endTime)) {
          return true;
        }
      }
    }
    return false;
  }
};
function pk(value) {
  return new PublicKey(value);
}
function serializeIx(ix) {
  return {
    programId: ix.programId.toBase58(),
    keys: ix.keys.map((k) => ({
      pubkey: k.pubkey.toBase58(),
      isSigner: k.isSigner,
      isWritable: k.isWritable
    })),
    data: Buffer.from(ix.data).toString("base64")
  };
}
function agent(kit, mint) {
  return new PumpAgent(pk(mint), "mainnet", kit.connection);
}
var createAgentPaymentsAction = {
  name: "pump_agent_create",
  similes: [
    "initialize agent payments",
    "set up agent monetization",
    "create tokenized agent payment config",
    "enable payments for my agent"
  ],
  description: "Initialize the on-chain Agent Payments configuration for a Pump Fun token. This must be called once by the token's bonding-curve creator before the agent can accept payments. Sets the agent authority and buyback basis points.",
  examples: [
    [
      {
        input: {
          mint: "So11111111111111111111111111111111111111112",
          buybackBps: "500"
        },
        output: {
          status: "success",
          signature: "5K4b...txSig"
        },
        explanation: "Initialize agent payments for the given token with 5% buyback."
      }
    ]
  ],
  schema: z.object({
    mint: z.string().describe("Token mint address"),
    agentAuthority: z.string().optional().describe(
      "Public key of the agent authority. Defaults to the agent wallet."
    ),
    buybackBps: z.number().int().min(0).max(1e4).describe("Buyback basis points (0\u201310000, e.g. 500 = 5%)")
  }),
  handler: async (kit, input) => {
    const pumpAgent = PumpAgentOffline.load(pk(input.mint), kit.connection);
    const authority = kit.wallet_address;
    const agentAuthority = input.agentAuthority ? pk(input.agentAuthority) : kit.wallet_address;
    const ix = await pumpAgent.create({
      authority,
      mint: pk(input.mint),
      agentAuthority,
      buybackBps: input.buybackBps
    });
    return { instruction: serializeIx(ix) };
  }
};
var buildPaymentInstructionsAction = {
  name: "pump_agent_build_payment_instructions",
  similes: [
    "build payment instructions",
    "create payment transaction",
    "generate agent payment",
    "prepare agent payment",
    "build agent invoice"
  ],
  description: "Build the accept-payment instructions for a tokenized agent. Returns serialized instructions that the payer must sign \u2014 does NOT auto-submit. Handles native SOL wrapping automatically when paying in SOL.",
  examples: [
    [
      {
        input: {
          mint: "So11111111111111111111111111111111111111112",
          user: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
          amount: "1000000",
          memo: "1"
        },
        output: {
          instructions: "[...serialized instructions]"
        },
        explanation: "Build payment instructions for 0.001 SOL to the agent with memo 1."
      }
    ]
  ],
  schema: z.object({
    mint: z.string().describe("Token mint address of the agent to pay"),
    user: z.string().describe("Public key of the payer"),
    currencyMint: z.string().optional().describe("Currency mint to pay in. Defaults to native SOL (wrapped)."),
    amount: z.string().describe("Payment amount in the currency's smallest unit"),
    memo: z.string().default("0").describe("Invoice memo / identifier"),
    startTime: z.string().default("0").describe("Invoice start time (unix seconds). Defaults to 0."),
    endTime: z.string().default("0").describe("Invoice end time (unix seconds). Defaults to 0.")
  }),
  handler: async (kit, input) => {
    const pumpAgent = PumpAgentOffline.load(pk(input.mint), kit.connection);
    const currencyMint = input.currencyMint ? pk(input.currencyMint) : NATIVE_MINT;
    const ixs = await pumpAgent.buildAcceptPaymentInstructions({
      user: pk(input.user),
      currencyMint,
      amount: input.amount,
      memo: input.memo,
      startTime: input.startTime,
      endTime: input.endTime
    });
    return { instructions: ixs.map(serializeIx) };
  }
};
var getBalancesAction = {
  name: "pump_agent_get_balances",
  similes: [
    "check agent balances",
    "get agent earnings",
    "view agent vault balances",
    "how much has the agent earned"
  ],
  description: "Fetch the current balances across all three agent vaults (payment, buyback, withdraw) for a given currency. Returns vault addresses and token balances.",
  examples: [
    [
      {
        input: {
          mint: "So11111111111111111111111111111111111111112"
        },
        output: {
          paymentVault: '{"address":"...","balance":"500000"}',
          buybackVault: '{"address":"...","balance":"100000"}',
          withdrawVault: '{"address":"...","balance":"400000"}'
        },
        explanation: "Check SOL balances across all vaults for the agent."
      }
    ]
  ],
  schema: z.object({
    mint: z.string().describe("Token mint address of the agent"),
    currencyMint: z.string().optional().describe("Currency mint to check balances for. Defaults to native SOL.")
  }),
  handler: async (kit, input) => {
    const pumpAgent = agent(kit, input.mint);
    const currencyMint = input.currencyMint ? pk(input.currencyMint) : NATIVE_MINT;
    const balances = await pumpAgent.getBalances(currencyMint);
    return {
      paymentVault: {
        address: balances.paymentVault.address.toBase58(),
        balance: balances.paymentVault.balance.toString()
      },
      buybackVault: {
        address: balances.buybackVault.address.toBase58(),
        balance: balances.buybackVault.balance.toString()
      },
      withdrawVault: {
        address: balances.withdrawVault.address.toBase58(),
        balance: balances.withdrawVault.balance.toString()
      }
    };
  }
};
var validateInvoiceAction = {
  name: "pump_agent_validate_invoice",
  similes: [
    "verify payment",
    "check if user paid",
    "validate invoice",
    "confirm agent payment",
    "did the user pay"
  ],
  description: "Validate that a specific payment was made to an agent. Checks on-chain records to confirm the invoice parameters match. Returns true if the payment is valid.",
  examples: [
    [
      {
        input: {
          mint: "So11111111111111111111111111111111111111112",
          user: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
          currencyMint: "So11111111111111111111111111111111111111112",
          amount: "1000000",
          memo: "42",
          startTime: "0",
          endTime: "0"
        },
        output: {
          valid: "true"
        },
        explanation: "Validate that the user paid 0.001 SOL with memo 42."
      }
    ]
  ],
  schema: z.object({
    mint: z.string().describe("Token mint address of the agent"),
    user: z.string().describe("Public key of the payer to validate"),
    currencyMint: z.string().describe("Currency mint used for payment"),
    amount: z.string().describe("Expected payment amount"),
    memo: z.string().describe("Expected invoice memo"),
    startTime: z.string().describe("Expected invoice start time (unix seconds)"),
    endTime: z.string().describe("Expected invoice end time (unix seconds)")
  }),
  handler: async (kit, input) => {
    const pumpAgent = agent(kit, input.mint);
    const valid = await pumpAgent.validateInvoicePayment({
      user: pk(input.user),
      currencyMint: pk(input.currencyMint),
      amount: Number(input.amount),
      memo: Number(input.memo),
      startTime: Number(input.startTime),
      endTime: Number(input.endTime)
    });
    return { valid };
  }
};
var distributePaymentsAction = {
  name: "pump_agent_distribute_payments",
  similes: [
    "distribute agent payments",
    "split agent revenue",
    "process agent payments",
    "trigger payment distribution"
  ],
  description: "Distribute accumulated payments between the buyback and withdraw vaults according to the configured buyback basis points. This is permissionless \u2014 anyone can trigger it.",
  examples: [
    [
      {
        input: {
          mint: "So11111111111111111111111111111111111111112"
        },
        output: {
          status: "success",
          signature: "3Yp7...txSig"
        },
        explanation: "Distribute accumulated SOL payments for the agent."
      }
    ]
  ],
  schema: z.object({
    mint: z.string().describe("Token mint address of the agent"),
    currencyMint: z.string().optional().describe("Currency mint to distribute. Defaults to native SOL.")
  }),
  handler: async (kit, input) => {
    const pumpAgent = PumpAgentOffline.load(pk(input.mint), kit.connection);
    const currencyMint = input.currencyMint ? pk(input.currencyMint) : NATIVE_MINT;
    const ixs = await pumpAgent.distributePayments({
      user: kit.wallet_address,
      currencyMint,
      includeTransferExtraLamportsForNative: currencyMint.equals(NATIVE_MINT)
    });
    return { instructions: ixs.map(serializeIx) };
  }
};
var withdrawAction = {
  name: "pump_agent_withdraw",
  similes: [
    "withdraw agent earnings",
    "withdraw agent payments",
    "claim agent revenue",
    "withdraw from agent vault"
  ],
  description: "Withdraw accumulated earnings from the agent withdraw vault. Must be called by the agent authority. Transfers tokens from the withdraw vault to the specified receiver token account.",
  examples: [
    [
      {
        input: {
          mint: "So11111111111111111111111111111111111111112",
          currencyMint: "So11111111111111111111111111111111111111112"
        },
        output: {
          status: "success",
          signature: "4Rz8...txSig"
        },
        explanation: "Withdraw accumulated SOL earnings from the agent."
      }
    ]
  ],
  schema: z.object({
    mint: z.string().describe("Token mint address of the agent"),
    currencyMint: z.string().describe("Currency mint to withdraw"),
    receiverAta: z.string().optional().describe(
      "Receiver token account. Defaults to the agent wallet's ATA for the currency."
    )
  }),
  handler: async (kit, input) => {
    const pumpAgent = PumpAgentOffline.load(pk(input.mint), kit.connection);
    const currencyMint = pk(input.currencyMint);
    const receiverAta = input.receiverAta ? pk(input.receiverAta) : getAssociatedTokenAddressSync(currencyMint, kit.wallet_address);
    const ix = await pumpAgent.withdraw({
      authority: kit.wallet_address,
      currencyMint,
      receiverAta
    });
    return { instruction: serializeIx(ix) };
  }
};
var getConfigAction = {
  name: "pump_agent_get_config",
  similes: [
    "get agent config",
    "check agent settings",
    "view agent payment config",
    "agent payment configuration"
  ],
  description: "Fetch the on-chain Agent Payments configuration for a token. Returns the agent authority, buyback basis points, and token mint.",
  examples: [
    [
      {
        input: {
          mint: "So11111111111111111111111111111111111111112"
        },
        output: {
          authority: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
          buybackBps: "500",
          mint: "So11111111111111111111111111111111111111112"
        },
        explanation: "Fetch the agent payment configuration."
      }
    ]
  ],
  schema: z.object({
    mint: z.string().describe("Token mint address of the agent")
  }),
  handler: async (kit, input) => {
    const pumpAgent = agent(kit, input.mint);
    const config = await pumpAgent.getAgentConfig();
    return {
      authority: config.authority.toBase58(),
      buybackBps: config.buybackBps,
      mint: config.mint.toBase58()
    };
  }
};
var getPaymentStatsAction = {
  name: "pump_agent_get_payment_stats",
  similes: [
    "get payment stats",
    "agent payment statistics",
    "how much has the agent earned",
    "payment analytics"
  ],
  description: "Fetch per-currency payment statistics for an agent. Returns total payments received, total distributed to buyback, total distributed to withdraw, and tokens burned.",
  examples: [
    [
      {
        input: {
          mint: "So11111111111111111111111111111111111111112",
          currencyMint: "So11111111111111111111111111111111111111112"
        },
        output: {
          totalPayments: "10000000",
          totalBuyback: "2000000",
          totalWithdraw: "8000000"
        },
        explanation: "Get SOL payment statistics for the agent."
      }
    ]
  ],
  schema: z.object({
    mint: z.string().describe("Token mint address of the agent"),
    currencyMint: z.string().describe("Currency mint to get stats for")
  }),
  handler: async (kit, input) => {
    const pumpAgent = agent(kit, input.mint);
    const stats = await pumpAgent.getPaymentStats(pk(input.currencyMint));
    const result = {};
    for (const [key, value] of Object.entries(stats)) {
      if (value instanceof PublicKey) {
        result[key] = value.toBase58();
      } else if (typeof value === "bigint") {
        result[key] = value.toString();
      } else if (value != null && typeof value === "object" && "toString" in value) {
        result[key] = String(value);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
};
var updateBuybackBpsAction = {
  name: "pump_agent_update_buyback_bps",
  similes: [
    "update buyback percentage",
    "change buyback bps",
    "set buyback rate",
    "modify agent buyback"
  ],
  description: "Update the buyback basis points for an agent's payment configuration. Must be called by the agent authority. The new bps value determines what percentage of future payments are allocated to token buyback and burn.",
  examples: [
    [
      {
        input: {
          mint: "So11111111111111111111111111111111111111112",
          buybackBps: "1000"
        },
        output: {
          status: "success",
          signature: "5Tz9...txSig"
        },
        explanation: "Update buyback to 10% (1000 bps) for the agent."
      }
    ]
  ],
  schema: z.object({
    mint: z.string().describe("Token mint address of the agent"),
    buybackBps: z.number().int().min(0).max(1e4).describe("New buyback basis points (0\u201310000, e.g. 1000 = 10%)")
  }),
  handler: async (kit, input) => {
    const pumpAgent = agent(kit, input.mint);
    const ix = await pumpAgent.updateBuybackBps({
      authority: kit.wallet_address,
      buybackBps: input.buybackBps
    });
    return { instruction: serializeIx(ix) };
  }
};
var allActions = [
  createAgentPaymentsAction,
  buildPaymentInstructionsAction,
  getBalancesAction,
  validateInvoiceAction,
  distributePaymentsAction,
  withdrawAction,
  getConfigAction,
  getPaymentStatsAction,
  updateBuybackBpsAction
];

// src/solana/solana-agent-kit/index.ts
async function createAgentPayments(agent2, mint, buybackBps, agentAuthority) {
  const pump = PumpAgentOffline.load(mint, agent2.connection);
  return pump.create({
    authority: agent2.wallet_address,
    mint,
    agentAuthority: agentAuthority ?? agent2.wallet_address,
    buybackBps
  });
}
async function buildPayAgentInstructions(agent2, mint, currencyMint, amount, memo = "0", startTime = "0", endTime = "0") {
  const pump = PumpAgentOffline.load(mint, agent2.connection);
  return pump.buildAcceptPaymentInstructions({
    user: agent2.wallet_address,
    currencyMint,
    amount,
    memo,
    startTime,
    endTime
  });
}
async function getAgentBalances(agent2, mint, currencyMint = NATIVE_MINT) {
  const pump = new PumpAgent(mint, "mainnet", agent2.connection);
  return pump.getBalances(currencyMint);
}
async function validateInvoicePayment(agent2, mint, user, currencyMint, amount, memo, startTime, endTime) {
  const pump = new PumpAgent(mint, "mainnet", agent2.connection);
  return pump.validateInvoicePayment({
    user,
    currencyMint,
    amount,
    memo,
    startTime,
    endTime
  });
}
async function distributeAgentPayments(agent2, mint, currencyMint = NATIVE_MINT) {
  const pump = PumpAgentOffline.load(mint, agent2.connection);
  return pump.distributePayments({
    user: agent2.wallet_address,
    currencyMint,
    includeTransferExtraLamportsForNative: currencyMint.equals(NATIVE_MINT)
  });
}
async function withdrawAgentPayments(agent2, mint, currencyMint, receiverAta) {
  const pump = PumpAgentOffline.load(mint, agent2.connection);
  return pump.withdraw({
    authority: agent2.wallet_address,
    currencyMint,
    receiverAta: receiverAta ?? getAssociatedTokenAddressSync(currencyMint, agent2.wallet_address)
  });
}
async function getAgentConfig(agent2, mint) {
  const pump = new PumpAgent(mint, "mainnet", agent2.connection);
  return pump.getAgentConfig();
}
async function getPaymentStats(agent2, mint, currencyMint) {
  const pump = new PumpAgent(mint, "mainnet", agent2.connection);
  return pump.getPaymentStats(currencyMint);
}
async function updateBuybackBps(agent2, mint, buybackBps) {
  const pump = new PumpAgent(mint, "mainnet", agent2.connection);
  return pump.updateBuybackBps({
    authority: agent2.wallet_address,
    buybackBps
  });
}
var PumpAgentPaymentsPlugin = {
  name: "pump-agent-payments",
  methods: {
    createAgentPayments,
    buildPayAgentInstructions,
    getAgentBalances,
    validateInvoicePayment,
    distributeAgentPayments,
    withdrawAgentPayments,
    getAgentConfig,
    getPaymentStats,
    updateBuybackBps
  },
  actions: allActions
};

export { PumpAgentPaymentsPlugin, allActions, buildPaymentInstructionsAction, createAgentPaymentsAction, distributePaymentsAction, getBalancesAction, getConfigAction, getPaymentStatsAction, updateBuybackBpsAction, validateInvoiceAction, withdrawAction };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map