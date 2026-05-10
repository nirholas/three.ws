'use strict';

var anchor = require('@coral-xyz/anchor');
var web3_js = require('@solana/web3.js');
var splToken = require('@solana/spl-token');
var zod = require('zod');
var event_js = require('@coral-xyz/anchor/dist/cjs/coder/borsh/event.js');
var pumpSdk = require('@pump-fun/pump-sdk');

var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

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
    publicKey: web3_js.PublicKey.default,
    signTransaction: () => Promise.reject(),
    signAllTransactions: () => Promise.reject()
  };
  return new anchor.Program(
    pump_agent_payments_default,
    new anchor.AnchorProvider(connection, dummyWallet, {})
  );
}
var OFFLINE_PUMP_PROGRAM = getPumpProgram(null);
function getPumpProgramWithFallback(connection) {
  return connection ? getPumpProgram(connection) : OFFLINE_PUMP_PROGRAM;
}
function getOfflineProgram() {
  return OFFLINE_PUMP_PROGRAM;
}
var PROGRAM_ID = new web3_js.PublicKey(
  "AgenTMiC2hvxGebTsgmsD4HHBa8WEcqGFf87iwRRxLo7"
);
var PUMP_PROGRAM_ID = new web3_js.PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);
var PUMP_FEES_PROGRAM_ID = new web3_js.PublicKey(
  "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"
);
var GLOBAL_CONFIG_SEED = Buffer.from("global-config");
var TOKEN_AGENT_PAYMENTS_SEED = Buffer.from("token-agent-payments");
var PAYMENT_IN_CURRENCY_SEED = Buffer.from("payment-in-currency");
var INVOICE_ID_SEED = Buffer.from("invoice-id");
var BUYBACK_AUTHORITY_SEED = Buffer.from("buyback-authority");
var WITHDRAW_AUTHORITY_SEED = Buffer.from("withdraw-authority");
var BONDING_CURVE_SEED = Buffer.from("bonding-curve");
var SHARING_CONFIG_SEED = Buffer.from("sharing-config");
var TOKEN_AGENT_PAYMENTS_MIN_RENT_EXEMPT_LAMPORTS = 1412880;
function getGlobalConfigPDA() {
  return web3_js.PublicKey.findProgramAddressSync([GLOBAL_CONFIG_SEED], PROGRAM_ID);
}
function getTokenAgentPaymentsPDA(mint) {
  return web3_js.PublicKey.findProgramAddressSync(
    [TOKEN_AGENT_PAYMENTS_SEED, mint.toBuffer()],
    PROGRAM_ID
  );
}
function getPaymentInCurrencyPDA(tokenMint, currencyMint) {
  return web3_js.PublicKey.findProgramAddressSync(
    [PAYMENT_IN_CURRENCY_SEED, tokenMint.toBuffer(), currencyMint.toBuffer()],
    PROGRAM_ID
  );
}
function getInvoiceIdPDA(tokenMint, currencyMint, amount, memo, startTime, endTime) {
  return web3_js.PublicKey.findProgramAddressSync(
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
  return web3_js.PublicKey.findProgramAddressSync(
    [BUYBACK_AUTHORITY_SEED, tokenMint.toBuffer()],
    PROGRAM_ID
  );
}
function getWithdrawAuthorityPDA(tokenMint) {
  return web3_js.PublicKey.findProgramAddressSync(
    [WITHDRAW_AUTHORITY_SEED, tokenMint.toBuffer()],
    PROGRAM_ID
  );
}
function getBondingCurvePDA(mint) {
  return web3_js.PublicKey.findProgramAddressSync(
    [BONDING_CURVE_SEED, mint.toBuffer()],
    PUMP_PROGRAM_ID
  );
}
function getSharingConfigPDA(mint) {
  return web3_js.PublicKey.findProgramAddressSync(
    [SHARING_CONFIG_SEED, mint.toBuffer()],
    PROGRAM_ID
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
var CurrencyNotSupportedError = class extends Error {
  constructor(params) {
    super(
      `Coin ${params.baseMint} uses quote mint ${params.quoteMint}, which is not in GlobalConfig.supportedCurrenciesMint (supported: ${params.supportedMints.length === 0 ? "<none>" : params.supportedMints.join(", ")}). Add the currency to GlobalConfig before accepting payments.`
    );
    this.name = "CurrencyNotSupportedError";
    this.baseMint = params.baseMint;
    this.quoteMint = params.quoteMint;
    this.supportedMints = params.supportedMints;
  }
};

// src/solana/PumpAgentOffline.ts
var USDC_MINT = new web3_js.PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);
var ANCHOR_DISCRIMINATOR_LEN = 8;
var BONDING_CURVE_QUOTE_MINT_OFFSET = ANCHOR_DISCRIMINATOR_LEN + 5 * 8 + 1 + 32 + 1 + 1;
function decodeBondingCurveQuoteMint(data) {
  if (data.length < BONDING_CURVE_QUOTE_MINT_OFFSET + 32) {
    return splToken.NATIVE_MINT;
  }
  const slice = data.subarray(
    BONDING_CURVE_QUOTE_MINT_OFFSET,
    BONDING_CURVE_QUOTE_MINT_OFFSET + 32
  );
  const pk2 = new web3_js.PublicKey(slice);
  return web3_js.PublicKey.default.equals(pk2) ? splToken.NATIVE_MINT : pk2;
}
async function resolveTokenProgramForMint(connection, mint) {
  if (mint.equals(splToken.NATIVE_MINT) || mint.equals(USDC_MINT)) {
    return splToken.TOKEN_PROGRAM_ID;
  }
  const info = await connection.getAccountInfo(mint);
  if (!info) return splToken.TOKEN_PROGRAM_ID;
  if (info.owner.equals(splToken.TOKEN_2022_PROGRAM_ID)) return splToken.TOKEN_2022_PROGRAM_ID;
  return splToken.TOKEN_PROGRAM_ID;
}
function toBN(value) {
  return new anchor.BN(value.toString());
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
    const tp = tokenProgram ?? splToken.TOKEN_PROGRAM_ID;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const [withdrawAuthority] = getWithdrawAuthorityPDA(this.mint);
    const withdrawVault = splToken.getAssociatedTokenAddressSync(
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
      if (currency.mint.equals(web3_js.PublicKey.default)) continue;
      const ata = splToken.getAssociatedTokenAddressSync(
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
    const tp = tokenProgram ?? splToken.TOKEN_PROGRAM_ID;
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
    const tokenAgentAssociatedAccount = splToken.getAssociatedTokenAddressSync(
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
    const tp = params.tokenProgram ?? splToken.TOKEN_PROGRAM_ID;
    const userTokenAccount = splToken.getAssociatedTokenAddressSync(
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
      web3_js.ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit })
    ];
    if (params.computeUnitPrice != null) {
      ixs.push(
        web3_js.ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: params.computeUnitPrice
        })
      );
    }
    if (currencyMint.equals(splToken.NATIVE_MINT)) {
      return [
        ...ixs,
        splToken.createAssociatedTokenAccountIdempotentInstruction(
          user,
          userTokenAccount,
          user,
          splToken.NATIVE_MINT
        ),
        web3_js.SystemProgram.transfer({
          fromPubkey: user,
          toPubkey: userTokenAccount,
          lamports: BigInt(params.amount.toString())
        }),
        splToken.createSyncNativeInstruction(userTokenAccount),
        acceptIx,
        splToken.createCloseAccountInstruction(userTokenAccount, user, user)
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
    const tp = tokenProgram ?? splToken.TOKEN_PROGRAM_ID;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const [globalConfig] = getGlobalConfigPDA();
    const [paymentInCurrency] = getPaymentInCurrencyPDA(
      this.mint,
      currencyMint
    );
    const [buybackAuthority] = getBuybackAuthorityPDA(this.mint);
    const [withdrawAuthority] = getWithdrawAuthorityPDA(this.mint);
    const tokenAgentAssociatedAccount = splToken.getAssociatedTokenAddressSync(
      currencyMint,
      tokenAgentPayments,
      true,
      tp
    );
    const buybackVault = splToken.getAssociatedTokenAddressSync(
      currencyMint,
      buybackAuthority,
      true,
      tp
    );
    const withdrawVault = splToken.getAssociatedTokenAddressSync(
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
    if (includeTransferExtraLamportsForNative && currencyMint.equals(splToken.NATIVE_MINT)) {
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
    const tp = tokenProgram ?? splToken.TOKEN_PROGRAM_ID;
    const tpCurrency = tokenProgramCurrency ?? splToken.TOKEN_PROGRAM_ID;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const [globalConfig] = getGlobalConfigPDA();
    const [buybackAuthority] = getBuybackAuthorityPDA(this.mint);
    const [paymentInCurrency] = getPaymentInCurrencyPDA(
      this.mint,
      currencyMint
    );
    const burnMintVault = splToken.getAssociatedTokenAddressSync(
      this.mint,
      buybackAuthority,
      true,
      tp
    );
    const burnCurrencyMintVault = splToken.getAssociatedTokenAddressSync(
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
      tokenProgram: splToken.TOKEN_PROGRAM_ID
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
      (m) => !web3_js.PublicKey.default.equals(m)
    );
    const supported = quoteMint.equals(splToken.NATIVE_MINT) || registeredCurrencies.some((m) => m.equals(quoteMint));
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
  return new anchor.EventParser(program.programId, program.coder);
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
function subscribeToAgentEvents(connection, callback, options) {
  const parser = createEventParser(connection);
  const filterNames = options?.eventNames ? new Set(options.eventNames) : null;
  const subId = connection.onLogs(
    OFFLINE_PUMP_PROGRAM.programId,
    (logInfo, ctx) => {
      if (logInfo.err) return;
      for (const event of parser.parseLogs(logInfo.logs)) {
        const parsed = {
          name: event.name,
          data: event.data
        };
        if (filterNames && !filterNames.has(parsed.name)) continue;
        callback(parsed, ctx.slot);
      }
    },
    "confirmed"
  );
  return {
    unsubscribe() {
      connection.removeOnLogsListener(subId);
    }
  };
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
  async getBalances(currencyMint, currencyTokenProgram = splToken.TOKEN_PROGRAM_ID) {
    const connection = this.connection;
    if (!connection) throw new Error("Connection is required");
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA(this.mint);
    const [buybackAuthority] = getBuybackAuthorityPDA(this.mint);
    const [withdrawAuthority] = getWithdrawAuthorityPDA(this.mint);
    const paymentAta = splToken.getAssociatedTokenAddressSync(
      currencyMint,
      tokenAgentPayments,
      true,
      currencyTokenProgram
    );
    const buybackAta = splToken.getAssociatedTokenAddressSync(
      currencyMint,
      buybackAuthority,
      true,
      currencyTokenProgram
    );
    const withdrawAta = splToken.getAssociatedTokenAddressSync(
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
      (m) => !web3_js.PublicKey.default.equals(m)
    );
    const accountInfos = splMints.length ? await connection.getMultipleAccountsInfo(splMints) : [];
    const queries = [
      { mint: splToken.NATIVE_MINT, tokenProgram: splToken.TOKEN_PROGRAM_ID }
    ];
    for (const [idx, mint] of splMints.entries()) {
      if (mint.equals(splToken.NATIVE_MINT)) continue;
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
    const totalPaymentsReceived = stats ? new anchor.BN(stats.totalInvoicePaymentsMade.toString()) : new anchor.BN(0);
    return {
      quoteMint,
      totalPaymentsReceived,
      pendingBuyback: new anchor.BN(balances.buybackVault.balance.toString()),
      pendingWithdrawal: new anchor.BN(balances.withdrawVault.balance.toString()),
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
      (m) => !web3_js.PublicKey.default.equals(m)
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
      (m) => !web3_js.PublicKey.default.equals(m)
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
    const amount = new anchor.BN(params.amount);
    const memo = new anchor.BN(params.memo);
    const startTime = new anchor.BN(params.startTime);
    const endTime = new anchor.BN(params.endTime);
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
        return data.user === user.toBase58() && data.tokenized_agent_mint === this.mint.toBase58() && data.currency_mint === currencyMint.toBase58() && new anchor.BN(data.amount).eq(amount) && new anchor.BN(data.memo).eq(memo) && new anchor.BN(data.start_time).eq(startTime) && new anchor.BN(data.end_time).eq(endTime);
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
      const parser = new anchor.EventParser(
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

// src/solana/decoders.ts
function decodeGlobalConfig(accountData) {
  return OFFLINE_PUMP_PROGRAM.coder.accounts.decode(
    "globalConfig",
    accountData
  );
}
function decodeTokenAgentPaymentInCurrency(accountData) {
  return OFFLINE_PUMP_PROGRAM.coder.accounts.decode(
    "tokenAgentPaymentInCurrency",
    accountData
  );
}
function decodeTokenAgentPayments(accountData) {
  return OFFLINE_PUMP_PROGRAM.coder.accounts.decode(
    "tokenAgentPayments",
    accountData
  );
}
function pk(value) {
  return new web3_js.PublicKey(value);
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
  schema: zod.z.object({
    mint: zod.z.string().describe("Token mint address"),
    agentAuthority: zod.z.string().optional().describe(
      "Public key of the agent authority. Defaults to the agent wallet."
    ),
    buybackBps: zod.z.number().int().min(0).max(1e4).describe("Buyback basis points (0\u201310000, e.g. 500 = 5%)")
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
  schema: zod.z.object({
    mint: zod.z.string().describe("Token mint address of the agent to pay"),
    user: zod.z.string().describe("Public key of the payer"),
    currencyMint: zod.z.string().optional().describe("Currency mint to pay in. Defaults to native SOL (wrapped)."),
    amount: zod.z.string().describe("Payment amount in the currency's smallest unit"),
    memo: zod.z.string().default("0").describe("Invoice memo / identifier"),
    startTime: zod.z.string().default("0").describe("Invoice start time (unix seconds). Defaults to 0."),
    endTime: zod.z.string().default("0").describe("Invoice end time (unix seconds). Defaults to 0.")
  }),
  handler: async (kit, input) => {
    const pumpAgent = PumpAgentOffline.load(pk(input.mint), kit.connection);
    const currencyMint = input.currencyMint ? pk(input.currencyMint) : splToken.NATIVE_MINT;
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
  schema: zod.z.object({
    mint: zod.z.string().describe("Token mint address of the agent"),
    currencyMint: zod.z.string().optional().describe("Currency mint to check balances for. Defaults to native SOL.")
  }),
  handler: async (kit, input) => {
    const pumpAgent = agent(kit, input.mint);
    const currencyMint = input.currencyMint ? pk(input.currencyMint) : splToken.NATIVE_MINT;
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
  schema: zod.z.object({
    mint: zod.z.string().describe("Token mint address of the agent"),
    user: zod.z.string().describe("Public key of the payer to validate"),
    currencyMint: zod.z.string().describe("Currency mint used for payment"),
    amount: zod.z.string().describe("Expected payment amount"),
    memo: zod.z.string().describe("Expected invoice memo"),
    startTime: zod.z.string().describe("Expected invoice start time (unix seconds)"),
    endTime: zod.z.string().describe("Expected invoice end time (unix seconds)")
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
  schema: zod.z.object({
    mint: zod.z.string().describe("Token mint address of the agent"),
    currencyMint: zod.z.string().optional().describe("Currency mint to distribute. Defaults to native SOL.")
  }),
  handler: async (kit, input) => {
    const pumpAgent = PumpAgentOffline.load(pk(input.mint), kit.connection);
    const currencyMint = input.currencyMint ? pk(input.currencyMint) : splToken.NATIVE_MINT;
    const ixs = await pumpAgent.distributePayments({
      user: kit.wallet_address,
      currencyMint,
      includeTransferExtraLamportsForNative: currencyMint.equals(splToken.NATIVE_MINT)
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
  schema: zod.z.object({
    mint: zod.z.string().describe("Token mint address of the agent"),
    currencyMint: zod.z.string().describe("Currency mint to withdraw"),
    receiverAta: zod.z.string().optional().describe(
      "Receiver token account. Defaults to the agent wallet's ATA for the currency."
    )
  }),
  handler: async (kit, input) => {
    const pumpAgent = PumpAgentOffline.load(pk(input.mint), kit.connection);
    const currencyMint = pk(input.currencyMint);
    const receiverAta = input.receiverAta ? pk(input.receiverAta) : splToken.getAssociatedTokenAddressSync(currencyMint, kit.wallet_address);
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
  schema: zod.z.object({
    mint: zod.z.string().describe("Token mint address of the agent")
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
  schema: zod.z.object({
    mint: zod.z.string().describe("Token mint address of the agent"),
    currencyMint: zod.z.string().describe("Currency mint to get stats for")
  }),
  handler: async (kit, input) => {
    const pumpAgent = agent(kit, input.mint);
    const stats = await pumpAgent.getPaymentStats(pk(input.currencyMint));
    const result = {};
    for (const [key, value] of Object.entries(stats)) {
      if (value instanceof web3_js.PublicKey) {
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
  schema: zod.z.object({
    mint: zod.z.string().describe("Token mint address of the agent"),
    buybackBps: zod.z.number().int().min(0).max(1e4).describe("New buyback basis points (0\u201310000, e.g. 1000 = 10%)")
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
async function getAgentBalances(agent2, mint, currencyMint = splToken.NATIVE_MINT) {
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
async function distributeAgentPayments(agent2, mint, currencyMint = splToken.NATIVE_MINT) {
  const pump = PumpAgentOffline.load(mint, agent2.connection);
  return pump.distributePayments({
    user: agent2.wallet_address,
    currencyMint,
    includeTransferExtraLamportsForNative: currencyMint.equals(splToken.NATIVE_MINT)
  });
}
async function withdrawAgentPayments(agent2, mint, currencyMint, receiverAta) {
  const pump = PumpAgentOffline.load(mint, agent2.connection);
  return pump.withdraw({
    authority: agent2.wallet_address,
    currencyMint,
    receiverAta: receiverAta ?? splToken.getAssociatedTokenAddressSync(currencyMint, agent2.wallet_address)
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

// src/solana/x402/index.ts
var x402_exports = {};
__export(x402_exports, {
  PumpAgentFacilitator: () => PumpAgentFacilitator,
  SOLANA_DEVNET: () => SOLANA_DEVNET,
  SOLANA_MAINNET: () => SOLANA_MAINNET,
  USDC_DEVNET: () => USDC_DEVNET,
  USDC_MAINNET: () => USDC_MAINNET,
  X402_HEADER_PAYMENT_REQUIRED: () => X402_HEADER_PAYMENT_REQUIRED,
  X402_HEADER_PAYMENT_RESPONSE: () => X402_HEADER_PAYMENT_RESPONSE,
  X402_HEADER_PAYMENT_SIGNATURE: () => X402_HEADER_PAYMENT_SIGNATURE,
  X402_VERSION: () => X402_VERSION,
  buildPumpAgentRequirements: () => buildPumpAgentRequirements,
  createResourceServer: () => createResourceServer,
  createX402Fetch: () => createX402Fetch,
  decodePaymentPayload: () => decodePaymentPayload,
  decodePaymentRequired: () => decodePaymentRequired,
  decodePaymentResponse: () => decodePaymentResponse,
  encodePaymentPayload: () => encodePaymentPayload,
  encodePaymentRequired: () => encodePaymentRequired,
  encodePaymentResponse: () => encodePaymentResponse,
  getPaymentPayloadFromRequest: () => getPaymentPayloadFromRequest,
  getPaymentRequiredFromResponse: () => getPaymentRequiredFromResponse,
  getPaymentResponseFromResponse: () => getPaymentResponseFromResponse
});

// src/solana/x402/types.ts
var X402_VERSION = 2;
var X402_HEADER_PAYMENT_REQUIRED = "PAYMENT-REQUIRED";
var X402_HEADER_PAYMENT_SIGNATURE = "PAYMENT-SIGNATURE";
var X402_HEADER_PAYMENT_RESPONSE = "PAYMENT-RESPONSE";
var SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
var SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
var USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
var USDC_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

// src/solana/x402/headers.ts
function encodePaymentRequired(pr) {
  return btoa(JSON.stringify(pr));
}
function decodePaymentRequired(headerValue) {
  return JSON.parse(atob(headerValue));
}
function encodePaymentPayload(payload) {
  return btoa(JSON.stringify(payload));
}
function decodePaymentPayload(headerValue) {
  return JSON.parse(atob(headerValue));
}
function encodePaymentResponse(pr) {
  return btoa(JSON.stringify(pr));
}
function decodePaymentResponse(headerValue) {
  return JSON.parse(atob(headerValue));
}
function getPaymentRequiredFromResponse(response) {
  if (response.status !== 402) return null;
  const raw = response.headers.get(X402_HEADER_PAYMENT_REQUIRED);
  if (!raw) return null;
  return decodePaymentRequired(raw);
}
function getPaymentPayloadFromRequest(request) {
  const raw = request.headers.get(X402_HEADER_PAYMENT_SIGNATURE);
  if (!raw) return null;
  return decodePaymentPayload(raw);
}
function getPaymentResponseFromResponse(response) {
  const raw = response.headers.get(X402_HEADER_PAYMENT_RESPONSE);
  if (!raw) return null;
  return decodePaymentResponse(raw);
}
var SettlementCache = class {
  constructor(maxSize = 1e4, ttlMs = 12e4) {
    this.cache = /* @__PURE__ */ new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }
  has(key) {
    const ts = this.cache.get(key);
    if (!ts) return false;
    if (Date.now() - ts > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }
  set(key) {
    this.cache.set(key, Date.now());
    if (this.cache.size > this.maxSize) {
      const cutoff = Date.now() - this.ttlMs;
      for (const [k, v] of this.cache) {
        if (v < cutoff) this.cache.delete(k);
      }
    }
  }
};
var memoCounter = 0;
function generateMemo() {
  const ts = Date.now();
  memoCounter = (memoCounter + 1) % 1e6;
  return `${ts}${String(memoCounter).padStart(6, "0")}`;
}
var PumpAgentFacilitator = class {
  constructor(config) {
    this.settlementCache = new SettlementCache();
    this.connection = config.connection;
    this.network = config.network ?? SOLANA_MAINNET;
  }
  async verify(payload, requirements) {
    if (requirements.scheme !== "pump-agent") {
      return { isValid: false, invalidReason: "Unsupported scheme" };
    }
    if (payload.x402Version !== X402_VERSION) {
      return { isValid: false, invalidReason: `Expected x402Version ${X402_VERSION}` };
    }
    const req = requirements;
    const proof = payload.payload;
    const signature = proof.signature;
    const payer = proof.payer;
    if (!signature || !payer) {
      return { isValid: false, invalidReason: "Missing signature or payer" };
    }
    if (this.settlementCache.has(signature)) {
      return { isValid: false, invalidReason: "Duplicate payment" };
    }
    if (payload.accepted.amount !== requirements.amount || payload.accepted.asset !== requirements.asset) {
      return { isValid: false, invalidReason: "Amount or asset mismatch" };
    }
    try {
      const agent2 = new PumpAgent(
        new web3_js.PublicKey(req.extra.agentMint),
        req.network === SOLANA_MAINNET ? "mainnet" : "devnet",
        this.connection
      );
      const valid = await agent2.validateInvoicePayment({
        user: new web3_js.PublicKey(payer),
        currencyMint: new web3_js.PublicKey(req.asset),
        amount: Number(req.amount),
        memo: Number(req.extra.memo),
        startTime: req.extra.startTime,
        endTime: req.extra.endTime
      });
      if (!valid) {
        return { isValid: false, invalidReason: "On-chain validation failed", payer };
      }
      return { isValid: true, payer };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { isValid: false, invalidReason: `Verification error: ${message}` };
    }
  }
  async settle(payload, requirements) {
    const verifyResult = await this.verify(payload, requirements);
    if (!verifyResult.isValid) {
      return {
        success: false,
        errorReason: verifyResult.invalidReason,
        payer: verifyResult.payer
      };
    }
    const proof = payload.payload;
    const signature = proof.signature;
    const payer = proof.payer;
    this.settlementCache.set(signature);
    return {
      success: true,
      payer,
      transaction: signature,
      network: this.network
    };
  }
  async getSupported() {
    return {
      kinds: [
        {
          scheme: "pump-agent",
          network: this.network,
          asset: USDC_MAINNET
        }
      ]
    };
  }
};
function buildPumpAgentRequirements(config) {
  const windowSec = config.invoiceWindowSeconds ?? 300;
  const now = Math.floor(Date.now() / 1e3);
  return {
    scheme: "pump-agent",
    network: config.network ?? SOLANA_MAINNET,
    asset: config.asset ?? USDC_MAINNET,
    amount: config.amount,
    payTo: config.payTo,
    maxTimeoutSeconds: config.maxTimeoutSeconds ?? 60,
    extra: {
      agentMint: config.agentMint,
      memo: generateMemo(),
      startTime: now,
      endTime: now + windowSec
    }
  };
}
function createResourceServer(config) {
  const { facilitator, resource } = config;
  return async (request, handler) => {
    const paymentHeader = request.headers.get(X402_HEADER_PAYMENT_SIGNATURE);
    if (!paymentHeader) {
      const body = {
        x402Version: X402_VERSION,
        resource,
        accepts: config.requirements
      };
      return new Response(JSON.stringify(body), {
        status: 402,
        statusText: "Payment Required",
        headers: {
          "Content-Type": "application/json",
          [X402_HEADER_PAYMENT_REQUIRED]: encodePaymentRequired(body)
        }
      });
    }
    let paymentPayload;
    try {
      paymentPayload = decodePaymentPayload(paymentHeader);
    } catch {
      return new Response("Invalid PAYMENT-SIGNATURE header", { status: 400 });
    }
    const accepted = paymentPayload.accepted;
    const matchedReq = config.requirements.find(
      (r) => r.scheme === accepted.scheme && r.network === accepted.network
    );
    if (!matchedReq) {
      return new Response("No matching payment requirement", { status: 400 });
    }
    const verifyResult = await facilitator.verify(paymentPayload, matchedReq);
    if (!verifyResult.isValid) {
      return new Response(
        JSON.stringify({ error: verifyResult.invalidReason }),
        { status: 402, headers: { "Content-Type": "application/json" } }
      );
    }
    const settleResult = await facilitator.settle(paymentPayload, matchedReq);
    if (!settleResult.success) {
      return new Response(
        JSON.stringify({ error: settleResult.errorReason }),
        { status: 402, headers: { "Content-Type": "application/json" } }
      );
    }
    const finalResponse = await handler();
    const paymentResponse = {
      success: true,
      transaction: settleResult.transaction,
      network: settleResult.network,
      payer: settleResult.payer
    };
    const outResponse = new Response(finalResponse.body, {
      status: finalResponse.status,
      statusText: finalResponse.statusText,
      headers: new Headers(finalResponse.headers)
    });
    outResponse.headers.set(
      X402_HEADER_PAYMENT_RESPONSE,
      encodePaymentResponse(paymentResponse)
    );
    return outResponse;
  };
}
function createX402Fetch(config) {
  const {
    payer,
    signTransaction,
    sendTransaction,
    connection,
    network = SOLANA_MAINNET,
    confirmationTimeoutMs = 3e4
  } = config;
  return async (input, init) => {
    const response = await fetch(input, init);
    if (response.status !== 402) return response;
    const paymentRequired = getPaymentRequiredFromResponse(response);
    if (!paymentRequired) return response;
    const accepted = selectRequirement(paymentRequired, network);
    if (!accepted) return response;
    const proof = await buildPaymentProof(
      accepted,
      payer,
      connection,
      signTransaction,
      sendTransaction,
      confirmationTimeoutMs
    );
    const paymentPayload = {
      x402Version: X402_VERSION,
      resource: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      accepted,
      payload: proof
    };
    const retryInit = { ...init };
    const headers = new Headers(retryInit.headers);
    headers.set(X402_HEADER_PAYMENT_SIGNATURE, encodePaymentPayload(paymentPayload));
    retryInit.headers = headers;
    return fetch(input, retryInit);
  };
}
function selectRequirement(paymentRequired, network) {
  return paymentRequired.accepts.find(
    (r) => r.scheme === "pump-agent" && r.network === network
  ) ?? paymentRequired.accepts.find(
    (r) => r.scheme === "exact" && r.network === network
  ) ?? null;
}
async function buildPaymentProof(requirements, payer, connection, signTransaction, sendTransaction, confirmationTimeoutMs) {
  const scheme = requirements.scheme;
  if (scheme === "pump-agent") {
    return buildPumpAgentProof(
      requirements,
      payer,
      connection,
      signTransaction,
      sendTransaction,
      confirmationTimeoutMs
    );
  }
  if (scheme === "exact") {
    return buildExactProof(
      requirements,
      payer,
      connection,
      signTransaction,
      sendTransaction,
      confirmationTimeoutMs
    );
  }
  throw new Error(`Unsupported scheme: ${scheme}`);
}
async function buildPumpAgentProof(requirements, payer, connection, signTransaction, sendTransaction, confirmationTimeoutMs) {
  const { extra } = requirements;
  const agent2 = new PumpAgentOffline(new web3_js.PublicKey(extra.agentMint));
  const instructions = await agent2.buildAcceptPaymentInstructions({
    user: new web3_js.PublicKey(payer),
    currencyMint: new web3_js.PublicKey(requirements.asset),
    amount: requirements.amount,
    memo: extra.memo,
    startTime: extra.startTime,
    endTime: extra.endTime
  });
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new web3_js.Transaction();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = new web3_js.PublicKey(payer);
  tx.add(...instructions);
  const txBase64 = Buffer.from(
    tx.serialize({ requireAllSignatures: false })
  ).toString("base64");
  const signedTxBase64 = await signTransaction(txBase64);
  const signature = await sendTransaction(signedTxBase64);
  await waitForConfirmation(
    connection,
    signature,
    lastValidBlockHeight,
    confirmationTimeoutMs
  );
  return {
    signature,
    payer,
    agentMint: extra.agentMint,
    asset: requirements.asset,
    amount: requirements.amount,
    memo: extra.memo,
    startTime: extra.startTime,
    endTime: extra.endTime
  };
}
async function buildExactProof(requirements, payer, connection, signTransaction, sendTransaction, confirmationTimeoutMs) {
  const payerPk = new web3_js.PublicKey(payer);
  const mint = new web3_js.PublicKey(requirements.asset);
  const payTo = new web3_js.PublicKey(requirements.payTo);
  const amount = BigInt(requirements.amount);
  const mintInfo = await splToken.getMint(connection, mint);
  const senderAta = splToken.getAssociatedTokenAddressSync(mint, payerPk, false, splToken.TOKEN_PROGRAM_ID, splToken.ASSOCIATED_TOKEN_PROGRAM_ID);
  const receiverAta = splToken.getAssociatedTokenAddressSync(mint, payTo, false, splToken.TOKEN_PROGRAM_ID, splToken.ASSOCIATED_TOKEN_PROGRAM_ID);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new web3_js.Transaction();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = payerPk;
  const receiverInfo = await connection.getAccountInfo(receiverAta);
  if (!receiverInfo) {
    tx.add(splToken.createAssociatedTokenAccountInstruction(
      payerPk,
      receiverAta,
      payTo,
      mint,
      splToken.TOKEN_PROGRAM_ID,
      splToken.ASSOCIATED_TOKEN_PROGRAM_ID
    ));
  }
  tx.add(splToken.createTransferCheckedInstruction(
    senderAta,
    mint,
    receiverAta,
    payerPk,
    amount,
    mintInfo.decimals,
    [],
    splToken.TOKEN_PROGRAM_ID
  ));
  const txBase64 = Buffer.from(tx.serialize({ requireAllSignatures: false })).toString("base64");
  const signedTxBase64 = await signTransaction(txBase64);
  const signature = await sendTransaction(signedTxBase64);
  await waitForConfirmation(connection, signature, lastValidBlockHeight, confirmationTimeoutMs);
  return { signature, network: requirements.network };
}
async function waitForConfirmation(connection, signature, lastValidBlockHeight, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await connection.getSignatureStatus(signature);
    const value = status?.value;
    if (value?.confirmationStatus === "confirmed" || value?.confirmationStatus === "finalized") {
      if (value.err)
        throw new Error(`Transaction failed: ${JSON.stringify(value.err)}`);
      return;
    }
    const blockHeight = await connection.getBlockHeight();
    if (blockHeight > lastValidBlockHeight) {
      throw new Error("Transaction expired (blockhash no longer valid)");
    }
    await new Promise((r) => setTimeout(r, 2e3));
  }
  throw new Error("Transaction confirmation timed out");
}

// src/solana/pump-events.ts
var pump_events_exports = {};
__export(pump_events_exports, {
  PUMP_BONDING_CURVE_PROGRAM_ID: () => PUMP_BONDING_CURVE_PROGRAM_ID,
  createPumpEventParser: () => createPumpEventParser,
  eventDiscriminatorMap: () => eventDiscriminatorMap,
  subscribeToPumpEvents: () => subscribeToPumpEvents
});

// src/solana/idl/pump.json
var pump_default = {
  address: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  metadata: {
    name: "pump",
    version: "0.1.0",
    spec: "0.1.0",
    description: "Created with Anchor"
  },
  instructions: [
    {
      name: "add_quote_mint",
      discriminator: [
        111,
        121,
        21,
        56,
        40,
        24,
        94,
        209
      ],
      accounts: [
        {
          name: "global",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "authority",
          writable: true,
          signer: true,
          relations: [
            "global"
          ]
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: [
        {
          name: "quote_mint",
          type: "pubkey"
        }
      ]
    },
    {
      name: "admin_set_creator",
      docs: [
        "Allows Global::admin_set_creator_authority to override the bonding curve creator"
      ],
      discriminator: [
        69,
        25,
        171,
        142,
        57,
        239,
        13,
        4
      ],
      accounts: [
        {
          name: "admin_set_creator_authority",
          signer: true,
          relations: [
            "global"
          ]
        },
        {
          name: "global",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "mint"
        },
        {
          name: "bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ]
          }
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: [
        {
          name: "creator",
          type: "pubkey"
        }
      ]
    },
    {
      name: "admin_set_idl_authority",
      discriminator: [
        8,
        217,
        96,
        231,
        144,
        104,
        192,
        5
      ],
      accounts: [
        {
          name: "authority",
          signer: true,
          relations: [
            "global"
          ]
        },
        {
          name: "global",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "idl_account",
          writable: true
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        },
        {
          name: "program_signer",
          pda: {
            seeds: []
          }
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: [
        {
          name: "idl_authority",
          type: "pubkey"
        }
      ]
    },
    {
      name: "admin_update_token_incentives",
      discriminator: [
        209,
        11,
        115,
        87,
        213,
        23,
        124,
        204
      ],
      accounts: [
        {
          name: "authority",
          writable: true,
          signer: true,
          relations: [
            "global"
          ]
        },
        {
          name: "global",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "global_volume_accumulator",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  118,
                  111,
                  108,
                  117,
                  109,
                  101,
                  95,
                  97,
                  99,
                  99,
                  117,
                  109,
                  117,
                  108,
                  97,
                  116,
                  111,
                  114
                ]
              }
            ]
          }
        },
        {
          name: "mint"
        },
        {
          name: "global_incentive_token_account",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "global_volume_accumulator"
              },
              {
                kind: "account",
                path: "token_program"
              },
              {
                kind: "account",
                path: "mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "associated_token_program",
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        },
        {
          name: "token_program"
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: [
        {
          name: "start_time",
          type: "i64"
        },
        {
          name: "end_time",
          type: "i64"
        },
        {
          name: "seconds_in_a_day",
          type: "i64"
        },
        {
          name: "day_number",
          type: "u64"
        },
        {
          name: "pump_token_supply_per_day",
          type: "u64"
        }
      ]
    },
    {
      name: "buy",
      docs: [
        "Buys tokens from a bonding curve."
      ],
      discriminator: [
        102,
        6,
        61,
        18,
        1,
        218,
        235,
        234
      ],
      accounts: [
        {
          name: "global",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "fee_recipient",
          writable: true
        },
        {
          name: "mint"
        },
        {
          name: "bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ]
          }
        },
        {
          name: "associated_bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "bonding_curve"
              },
              {
                kind: "account",
                path: "token_program"
              },
              {
                kind: "account",
                path: "mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "associated_user",
          writable: true
        },
        {
          name: "user",
          writable: true,
          signer: true
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        },
        {
          name: "token_program"
        },
        {
          name: "creator_vault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  99,
                  114,
                  101,
                  97,
                  116,
                  111,
                  114,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                kind: "account",
                path: "bonding_curve.creator",
                account: "BondingCurve"
              }
            ]
          }
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program",
          address: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
        },
        {
          name: "global_volume_accumulator",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  118,
                  111,
                  108,
                  117,
                  109,
                  101,
                  95,
                  97,
                  99,
                  99,
                  117,
                  109,
                  117,
                  108,
                  97,
                  116,
                  111,
                  114
                ]
              }
            ]
          }
        },
        {
          name: "user_volume_accumulator",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  117,
                  115,
                  101,
                  114,
                  95,
                  118,
                  111,
                  108,
                  117,
                  109,
                  101,
                  95,
                  97,
                  99,
                  99,
                  117,
                  109,
                  117,
                  108,
                  97,
                  116,
                  111,
                  114
                ]
              },
              {
                kind: "account",
                path: "user"
              }
            ]
          }
        },
        {
          name: "fee_config",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  102,
                  101,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                kind: "const",
                value: [
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
                ]
              }
            ],
            program: {
              kind: "account",
              path: "fee_program"
            }
          }
        },
        {
          name: "fee_program",
          address: "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"
        }
      ],
      args: [
        {
          name: "amount",
          type: "u64"
        },
        {
          name: "max_sol_cost",
          type: "u64"
        },
        {
          name: "track_volume",
          type: {
            defined: {
              name: "OptionBool"
            }
          }
        }
      ]
    },
    {
      name: "buy_exact_quote_in_v2",
      discriminator: [
        194,
        171,
        28,
        70,
        104,
        77,
        91,
        47
      ],
      accounts: [
        {
          name: "global",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "base_mint"
        },
        {
          name: "quote_mint"
        },
        {
          name: "base_token_program"
        },
        {
          name: "quote_token_program"
        },
        {
          name: "associated_token_program",
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          name: "fee_recipient",
          writable: true
        },
        {
          name: "associated_quote_fee_recipient",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "fee_recipient"
              },
              {
                kind: "account",
                path: "quote_token_program"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "buyback_fee_recipient",
          writable: true
        },
        {
          name: "associated_quote_buyback_fee_recipient",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "buyback_fee_recipient"
              },
              {
                kind: "account",
                path: "quote_token_program"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "base_mint"
              }
            ]
          }
        },
        {
          name: "associated_base_bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "bonding_curve"
              },
              {
                kind: "account",
                path: "base_token_program"
              },
              {
                kind: "account",
                path: "base_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "associated_quote_bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "bonding_curve"
              },
              {
                kind: "account",
                path: "quote_token_program"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "user",
          writable: true,
          signer: true
        },
        {
          name: "associated_base_user",
          writable: true
        },
        {
          name: "associated_quote_user",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "user"
              },
              {
                kind: "account",
                path: "quote_token_program"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "creator_vault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  99,
                  114,
                  101,
                  97,
                  116,
                  111,
                  114,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                kind: "account",
                path: "bonding_curve.creator",
                account: "BondingCurve"
              }
            ]
          }
        },
        {
          name: "associated_creator_vault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "creator_vault"
              },
              {
                kind: "account",
                path: "quote_token_program"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "sharing_config",
          docs: [
            "seeds; the account is intentionally not deserialized here because it may be uninitialized",
            "for mints that have not created a fee sharing config. Handlers must check",
            "`data_is_empty()` / owner before reading."
          ],
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  115,
                  104,
                  97,
                  114,
                  105,
                  110,
                  103,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                kind: "account",
                path: "base_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
                12,
                53,
                255,
                169,
                5,
                90,
                142,
                86,
                141,
                168,
                247,
                188,
                7,
                86,
                21,
                39,
                76,
                241,
                201,
                44,
                164,
                31,
                64,
                0,
                156,
                81,
                106,
                164,
                20,
                194,
                124,
                112
              ]
            }
          }
        },
        {
          name: "global_volume_accumulator",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  118,
                  111,
                  108,
                  117,
                  109,
                  101,
                  95,
                  97,
                  99,
                  99,
                  117,
                  109,
                  117,
                  108,
                  97,
                  116,
                  111,
                  114
                ]
              }
            ]
          }
        },
        {
          name: "user_volume_accumulator",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  117,
                  115,
                  101,
                  114,
                  95,
                  118,
                  111,
                  108,
                  117,
                  109,
                  101,
                  95,
                  97,
                  99,
                  99,
                  117,
                  109,
                  117,
                  108,
                  97,
                  116,
                  111,
                  114
                ]
              },
              {
                kind: "account",
                path: "user"
              }
            ]
          }
        },
        {
          name: "associated_user_volume_accumulator",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "user_volume_accumulator"
              },
              {
                kind: "account",
                path: "quote_token_program"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "fee_config",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  102,
                  101,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                kind: "const",
                value: [
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
                ]
              }
            ],
            program: {
              kind: "account",
              path: "fee_program"
            }
          }
        },
        {
          name: "fee_program",
          address: "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program",
          address: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
        }
      ],
      args: [
        {
          name: "spendable_quote_in",
          type: "u64"
        },
        {
          name: "min_tokens_out",
          type: "u64"
        }
      ]
    },
    {
      name: "buy_exact_sol_in",
      docs: [
        "Given a budget of spendable SOL, buy at least min_tokens_out tokens.",
        "Fees are deducted from spendable_sol_in.",
        "",
        "# Quote formulas",
        "Where:",
        "- total_fee_bps = protocol_fee_bps + creator_fee_bps (creator_fee_bps is 0 if no creator)",
        "- floor(a/b) = a / b (integer division)",
        "- ceil(a/b) = (a + b - 1) / b",
        "",
        "SOL \u2192 tokens quote",
        "To calculate tokens_out for a given spendable_sol_in:",
        "1. net_sol = floor(spendable_sol_in * 10_000 / (10_000 + total_fee_bps))",
        "2. fees = ceil(net_sol * protocol_fee_bps / 10_000) + ceil(net_sol * creator_fee_bps / 10_000) (creator_fee_bps is 0 if no creator)",
        "3. if net_sol + fees > spendable_sol_in: net_sol = net_sol - (net_sol + fees - spendable_sol_in)",
        "4. tokens_out = floor((net_sol - 1) * virtual_token_reserves / (virtual_sol_reserves + net_sol - 1))",
        "",
        "Reverse quote (tokens \u2192 SOL)",
        "To calculate spendable_sol_in for a desired number of tokens:",
        "1. net_sol = ceil(tokens * virtual_sol_reserves / (virtual_token_reserves - tokens)) + 1",
        "2. spendable_sol_in = ceil(net_sol * (10_000 + total_fee_bps) / 10_000)",
        "",
        "Rent",
        "Separately make sure the instruction's payer has enough SOL to cover rent for:",
        "- creator_vault: rent.minimum_balance(0)",
        "- user_volume_accumulator: rent.minimum_balance(UserVolumeAccumulator::LEN)"
      ],
      discriminator: [
        56,
        252,
        116,
        8,
        158,
        223,
        205,
        95
      ],
      accounts: [
        {
          name: "global",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "fee_recipient",
          writable: true
        },
        {
          name: "mint"
        },
        {
          name: "bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ]
          }
        },
        {
          name: "associated_bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "bonding_curve"
              },
              {
                kind: "account",
                path: "token_program"
              },
              {
                kind: "account",
                path: "mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "associated_user",
          writable: true
        },
        {
          name: "user",
          writable: true,
          signer: true
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        },
        {
          name: "token_program"
        },
        {
          name: "creator_vault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  99,
                  114,
                  101,
                  97,
                  116,
                  111,
                  114,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                kind: "account",
                path: "bonding_curve.creator",
                account: "BondingCurve"
              }
            ]
          }
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program",
          address: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
        },
        {
          name: "global_volume_accumulator",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  118,
                  111,
                  108,
                  117,
                  109,
                  101,
                  95,
                  97,
                  99,
                  99,
                  117,
                  109,
                  117,
                  108,
                  97,
                  116,
                  111,
                  114
                ]
              }
            ]
          }
        },
        {
          name: "user_volume_accumulator",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  117,
                  115,
                  101,
                  114,
                  95,
                  118,
                  111,
                  108,
                  117,
                  109,
                  101,
                  95,
                  97,
                  99,
                  99,
                  117,
                  109,
                  117,
                  108,
                  97,
                  116,
                  111,
                  114
                ]
              },
              {
                kind: "account",
                path: "user"
              }
            ]
          }
        },
        {
          name: "fee_config",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  102,
                  101,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                kind: "const",
                value: [
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
                ]
              }
            ],
            program: {
              kind: "account",
              path: "fee_program"
            }
          }
        },
        {
          name: "fee_program",
          address: "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"
        }
      ],
      args: [
        {
          name: "spendable_sol_in",
          type: "u64"
        },
        {
          name: "min_tokens_out",
          type: "u64"
        },
        {
          name: "track_volume",
          type: {
            defined: {
              name: "OptionBool"
            }
          }
        }
      ]
    },
    {
      name: "buy_v2",
      discriminator: [
        184,
        23,
        238,
        97,
        103,
        197,
        211,
        61
      ],
      accounts: [
        {
          name: "global",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "base_mint"
        },
        {
          name: "quote_mint"
        },
        {
          name: "base_token_program"
        },
        {
          name: "quote_token_program"
        },
        {
          name: "associated_token_program",
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          name: "fee_recipient",
          writable: true
        },
        {
          name: "associated_quote_fee_recipient",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "fee_recipient"
              },
              {
                kind: "account",
                path: "quote_token_program"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "buyback_fee_recipient",
          writable: true
        },
        {
          name: "associated_quote_buyback_fee_recipient",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "buyback_fee_recipient"
              },
              {
                kind: "account",
                path: "quote_token_program"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "base_mint"
              }
            ]
          }
        },
        {
          name: "associated_base_bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "bonding_curve"
              },
              {
                kind: "account",
                path: "base_token_program"
              },
              {
                kind: "account",
                path: "base_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "associated_quote_bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "bonding_curve"
              },
              {
                kind: "account",
                path: "quote_token_program"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "user",
          writable: true,
          signer: true
        },
        {
          name: "associated_base_user",
          writable: true
        },
        {
          name: "associated_quote_user",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "user"
              },
              {
                kind: "account",
                path: "quote_token_program"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "creator_vault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  99,
                  114,
                  101,
                  97,
                  116,
                  111,
                  114,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                kind: "account",
                path: "bonding_curve.creator",
                account: "BondingCurve"
              }
            ]
          }
        },
        {
          name: "associated_creator_vault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "creator_vault"
              },
              {
                kind: "account",
                path: "quote_token_program"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "sharing_config",
          docs: [
            "seeds; the account is intentionally not deserialized here because it may be uninitialized",
            "for mints that have not created a fee sharing config. Handlers must check",
            "`data_is_empty()` / owner before reading."
          ],
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  115,
                  104,
                  97,
                  114,
                  105,
                  110,
                  103,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                kind: "account",
                path: "base_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
                12,
                53,
                255,
                169,
                5,
                90,
                142,
                86,
                141,
                168,
                247,
                188,
                7,
                86,
                21,
                39,
                76,
                241,
                201,
                44,
                164,
                31,
                64,
                0,
                156,
                81,
                106,
                164,
                20,
                194,
                124,
                112
              ]
            }
          }
        },
        {
          name: "global_volume_accumulator",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  118,
                  111,
                  108,
                  117,
                  109,
                  101,
                  95,
                  97,
                  99,
                  99,
                  117,
                  109,
                  117,
                  108,
                  97,
                  116,
                  111,
                  114
                ]
              }
            ]
          }
        },
        {
          name: "user_volume_accumulator",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  117,
                  115,
                  101,
                  114,
                  95,
                  118,
                  111,
                  108,
                  117,
                  109,
                  101,
                  95,
                  97,
                  99,
                  99,
                  117,
                  109,
                  117,
                  108,
                  97,
                  116,
                  111,
                  114
                ]
              },
              {
                kind: "account",
                path: "user"
              }
            ]
          }
        },
        {
          name: "associated_user_volume_accumulator",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "user_volume_accumulator"
              },
              {
                kind: "account",
                path: "quote_token_program"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "fee_config",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  102,
                  101,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                kind: "const",
                value: [
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
                ]
              }
            ],
            program: {
              kind: "account",
              path: "fee_program"
            }
          }
        },
        {
          name: "fee_program",
          address: "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program",
          address: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
        }
      ],
      args: [
        {
          name: "amount",
          type: "u64"
        },
        {
          name: "max_sol_cost",
          type: "u64"
        }
      ]
    },
    {
      name: "claim_cashback",
      discriminator: [
        37,
        58,
        35,
        126,
        190,
        53,
        228,
        197
      ],
      accounts: [
        {
          name: "user",
          writable: true
        },
        {
          name: "user_volume_accumulator",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  117,
                  115,
                  101,
                  114,
                  95,
                  118,
                  111,
                  108,
                  117,
                  109,
                  101,
                  95,
                  97,
                  99,
                  99,
                  117,
                  109,
                  117,
                  108,
                  97,
                  116,
                  111,
                  114
                ]
              },
              {
                kind: "account",
                path: "user"
              }
            ]
          }
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program",
          address: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
        }
      ],
      args: []
    },
    {
      name: "claim_cashback_v2",
      discriminator: [
        122,
        243,
        204,
        65,
        94,
        116,
        29,
        55
      ],
      accounts: [
        {
          name: "user",
          writable: true
        },
        {
          name: "user_volume_accumulator",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  117,
                  115,
                  101,
                  114,
                  95,
                  118,
                  111,
                  108,
                  117,
                  109,
                  101,
                  95,
                  97,
                  99,
                  99,
                  117,
                  109,
                  117,
                  108,
                  97,
                  116,
                  111,
                  114
                ]
              },
              {
                kind: "account",
                path: "user"
              }
            ]
          }
        },
        {
          name: "quote_mint"
        },
        {
          name: "quote_token_program"
        },
        {
          name: "associated_token_program",
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          name: "associated_user_volume_accumulator",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "user_volume_accumulator"
              },
              {
                kind: "account",
                path: "quote_token_program"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "account",
              path: "associated_token_program"
            }
          }
        },
        {
          name: "associated_quote_user",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "user"
              },
              {
                kind: "account",
                path: "quote_token_program"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "account",
              path: "associated_token_program"
            }
          }
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program",
          address: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
        }
      ],
      args: []
    },
    {
      name: "claim_token_incentives",
      discriminator: [
        16,
        4,
        71,
        28,
        204,
        1,
        40,
        27
      ],
      accounts: [
        {
          name: "user"
        },
        {
          name: "user_ata",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "user"
              },
              {
                kind: "account",
                path: "token_program"
              },
              {
                kind: "account",
                path: "mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "global_volume_accumulator",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  118,
                  111,
                  108,
                  117,
                  109,
                  101,
                  95,
                  97,
                  99,
                  99,
                  117,
                  109,
                  117,
                  108,
                  97,
                  116,
                  111,
                  114
                ]
              }
            ]
          }
        },
        {
          name: "global_incentive_token_account",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "global_volume_accumulator"
              },
              {
                kind: "account",
                path: "token_program"
              },
              {
                kind: "account",
                path: "mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "user_volume_accumulator",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  117,
                  115,
                  101,
                  114,
                  95,
                  118,
                  111,
                  108,
                  117,
                  109,
                  101,
                  95,
                  97,
                  99,
                  99,
                  117,
                  109,
                  117,
                  108,
                  97,
                  116,
                  111,
                  114
                ]
              },
              {
                kind: "account",
                path: "user"
              }
            ]
          }
        },
        {
          name: "mint",
          relations: [
            "global_volume_accumulator"
          ]
        },
        {
          name: "token_program"
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        },
        {
          name: "associated_token_program",
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program",
          address: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
        },
        {
          name: "payer",
          writable: true,
          signer: true
        }
      ],
      args: []
    },
    {
      name: "close_user_volume_accumulator",
      discriminator: [
        249,
        69,
        164,
        218,
        150,
        103,
        84,
        138
      ],
      accounts: [
        {
          name: "user",
          writable: true,
          signer: true
        },
        {
          name: "user_volume_accumulator",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  117,
                  115,
                  101,
                  114,
                  95,
                  118,
                  111,
                  108,
                  117,
                  109,
                  101,
                  95,
                  97,
                  99,
                  99,
                  117,
                  109,
                  117,
                  108,
                  97,
                  116,
                  111,
                  114
                ]
              },
              {
                kind: "account",
                path: "user"
              }
            ]
          }
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: []
    },
    {
      name: "collect_creator_fee",
      docs: [
        "Collects creator_fee from creator_vault to the coin creator account"
      ],
      discriminator: [
        20,
        22,
        86,
        123,
        198,
        28,
        219,
        132
      ],
      accounts: [
        {
          name: "creator",
          writable: true
        },
        {
          name: "creator_vault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  99,
                  114,
                  101,
                  97,
                  116,
                  111,
                  114,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                kind: "account",
                path: "creator"
              }
            ]
          }
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: []
    },
    {
      name: "create",
      docs: [
        "Creates a new coin and bonding curve."
      ],
      discriminator: [
        24,
        30,
        200,
        40,
        5,
        28,
        7,
        119
      ],
      accounts: [
        {
          name: "mint",
          writable: true,
          signer: true
        },
        {
          name: "mint_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  109,
                  105,
                  110,
                  116,
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
                ]
              }
            ]
          }
        },
        {
          name: "bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ]
          }
        },
        {
          name: "associated_bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "bonding_curve"
              },
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "global",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "mpl_token_metadata",
          address: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
        },
        {
          name: "metadata",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                kind: "const",
                value: [
                  11,
                  112,
                  101,
                  177,
                  227,
                  209,
                  124,
                  69,
                  56,
                  157,
                  82,
                  127,
                  107,
                  4,
                  195,
                  205,
                  88,
                  184,
                  108,
                  115,
                  26,
                  160,
                  253,
                  181,
                  73,
                  182,
                  209,
                  188,
                  3,
                  248,
                  41,
                  70
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ],
            program: {
              kind: "account",
              path: "mpl_token_metadata"
            }
          }
        },
        {
          name: "user",
          writable: true,
          signer: true
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        },
        {
          name: "token_program",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          name: "associated_token_program",
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          name: "rent",
          address: "SysvarRent111111111111111111111111111111111"
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: [
        {
          name: "name",
          type: "string"
        },
        {
          name: "symbol",
          type: "string"
        },
        {
          name: "uri",
          type: "string"
        },
        {
          name: "creator",
          type: "pubkey"
        }
      ]
    },
    {
      name: "create_v2",
      docs: [
        "Creates a new spl-22 coin and bonding curve."
      ],
      discriminator: [
        214,
        144,
        76,
        236,
        95,
        139,
        49,
        180
      ],
      accounts: [
        {
          name: "mint",
          writable: true,
          signer: true
        },
        {
          name: "mint_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  109,
                  105,
                  110,
                  116,
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
                ]
              }
            ]
          }
        },
        {
          name: "bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ]
          }
        },
        {
          name: "associated_bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "bonding_curve"
              },
              {
                kind: "account",
                path: "token_program"
              },
              {
                kind: "account",
                path: "mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "global",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "user",
          writable: true,
          signer: true
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        },
        {
          name: "token_program",
          address: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          name: "associated_token_program",
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          name: "mayhem_program_id",
          writable: true,
          address: "MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e"
        },
        {
          name: "global_params",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  45,
                  112,
                  97,
                  114,
                  97,
                  109,
                  115
                ]
              }
            ],
            program: {
              kind: "const",
              value: [
                5,
                42,
                229,
                215,
                167,
                218,
                167,
                36,
                166,
                234,
                176,
                167,
                41,
                84,
                145,
                133,
                90,
                212,
                160,
                103,
                22,
                96,
                103,
                76,
                78,
                3,
                69,
                89,
                128,
                61,
                101,
                163
              ]
            }
          }
        },
        {
          name: "sol_vault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  115,
                  111,
                  108,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ],
            program: {
              kind: "const",
              value: [
                5,
                42,
                229,
                215,
                167,
                218,
                167,
                36,
                166,
                234,
                176,
                167,
                41,
                84,
                145,
                133,
                90,
                212,
                160,
                103,
                22,
                96,
                103,
                76,
                78,
                3,
                69,
                89,
                128,
                61,
                101,
                163
              ]
            }
          }
        },
        {
          name: "mayhem_state",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  109,
                  97,
                  121,
                  104,
                  101,
                  109,
                  45,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ],
            program: {
              kind: "const",
              value: [
                5,
                42,
                229,
                215,
                167,
                218,
                167,
                36,
                166,
                234,
                176,
                167,
                41,
                84,
                145,
                133,
                90,
                212,
                160,
                103,
                22,
                96,
                103,
                76,
                78,
                3,
                69,
                89,
                128,
                61,
                101,
                163
              ]
            }
          }
        },
        {
          name: "mayhem_token_vault",
          writable: true
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: [
        {
          name: "name",
          type: "string"
        },
        {
          name: "symbol",
          type: "string"
        },
        {
          name: "uri",
          type: "string"
        },
        {
          name: "creator",
          type: "pubkey"
        },
        {
          name: "is_mayhem_mode",
          type: "bool"
        },
        {
          name: "is_cashback_enabled",
          type: {
            defined: {
              name: "OptionBool"
            }
          }
        }
      ]
    },
    {
      name: "distribute_creator_fees",
      docs: [
        "Distributes creator fees to shareholders based on their share percentages",
        "The creator vault needs to have at least the minimum distributable amount to distribute fees",
        "This can be checked with the get_minimum_distributable_fee instruction"
      ],
      discriminator: [
        165,
        114,
        103,
        0,
        121,
        206,
        247,
        81
      ],
      accounts: [
        {
          name: "mint",
          relations: [
            "sharing_config"
          ]
        },
        {
          name: "bonding_curve",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ]
          }
        },
        {
          name: "sharing_config",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  115,
                  104,
                  97,
                  114,
                  105,
                  110,
                  103,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ],
            program: {
              kind: "const",
              value: [
                12,
                53,
                255,
                169,
                5,
                90,
                142,
                86,
                141,
                168,
                247,
                188,
                7,
                86,
                21,
                39,
                76,
                241,
                201,
                44,
                164,
                31,
                64,
                0,
                156,
                81,
                106,
                164,
                20,
                194,
                124,
                112
              ]
            }
          }
        },
        {
          name: "creator_vault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  99,
                  114,
                  101,
                  97,
                  116,
                  111,
                  114,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                kind: "account",
                path: "bonding_curve.creator",
                account: "BondingCurve"
              }
            ]
          }
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program",
          address: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
        }
      ],
      args: [],
      returns: {
        defined: {
          name: "DistributeCreatorFeesEvent"
        }
      }
    },
    {
      name: "extend_account",
      docs: [
        "Extends the size of program-owned accounts"
      ],
      discriminator: [
        234,
        102,
        194,
        203,
        150,
        72,
        62,
        229
      ],
      accounts: [
        {
          name: "account",
          writable: true
        },
        {
          name: "user",
          signer: true
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: []
    },
    {
      name: "get_minimum_distributable_fee",
      docs: [
        "Permissionless instruction to check the minimum required fees for distribution",
        "Returns the minimum required balance from the creator_vault and whether distribution can proceed"
      ],
      discriminator: [
        117,
        225,
        127,
        202,
        134,
        95,
        68,
        35
      ],
      accounts: [
        {
          name: "mint",
          relations: [
            "sharing_config"
          ]
        },
        {
          name: "bonding_curve",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ]
          }
        },
        {
          name: "sharing_config",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  115,
                  104,
                  97,
                  114,
                  105,
                  110,
                  103,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ],
            program: {
              kind: "const",
              value: [
                12,
                53,
                255,
                169,
                5,
                90,
                142,
                86,
                141,
                168,
                247,
                188,
                7,
                86,
                21,
                39,
                76,
                241,
                201,
                44,
                164,
                31,
                64,
                0,
                156,
                81,
                106,
                164,
                20,
                194,
                124,
                112
              ]
            }
          }
        },
        {
          name: "creator_vault",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  99,
                  114,
                  101,
                  97,
                  116,
                  111,
                  114,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                kind: "account",
                path: "bonding_curve.creator",
                account: "BondingCurve"
              }
            ]
          }
        }
      ],
      args: [],
      returns: {
        defined: {
          name: "MinimumDistributableFeeEvent"
        }
      }
    },
    {
      name: "init_user_volume_accumulator",
      discriminator: [
        94,
        6,
        202,
        115,
        255,
        96,
        232,
        183
      ],
      accounts: [
        {
          name: "payer",
          writable: true,
          signer: true
        },
        {
          name: "user"
        },
        {
          name: "user_volume_accumulator",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  117,
                  115,
                  101,
                  114,
                  95,
                  118,
                  111,
                  108,
                  117,
                  109,
                  101,
                  95,
                  97,
                  99,
                  99,
                  117,
                  109,
                  117,
                  108,
                  97,
                  116,
                  111,
                  114
                ]
              },
              {
                kind: "account",
                path: "user"
              }
            ]
          }
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: []
    },
    {
      name: "initialize",
      docs: [
        "Creates the global state."
      ],
      discriminator: [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      accounts: [
        {
          name: "global",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "user",
          writable: true,
          signer: true
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        }
      ],
      args: []
    },
    {
      name: "migrate",
      docs: [
        "Migrates liquidity to pump_amm if the bonding curve is complete"
      ],
      discriminator: [
        155,
        234,
        231,
        146,
        236,
        158,
        162,
        30
      ],
      accounts: [
        {
          name: "global",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "withdraw_authority",
          writable: true,
          relations: [
            "global"
          ]
        },
        {
          name: "mint"
        },
        {
          name: "bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ]
          }
        },
        {
          name: "associated_bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "bonding_curve"
              },
              {
                kind: "account",
                path: "mint"
              },
              {
                kind: "account",
                path: "mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "user",
          signer: true
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        },
        {
          name: "token_program",
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          name: "pump_amm",
          address: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"
        },
        {
          name: "pool",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                kind: "const",
                value: [
                  0,
                  0
                ]
              },
              {
                kind: "account",
                path: "pool_authority"
              },
              {
                kind: "account",
                path: "mint"
              },
              {
                kind: "account",
                path: "wsol_mint"
              }
            ],
            program: {
              kind: "account",
              path: "pump_amm"
            }
          }
        },
        {
          name: "pool_authority",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  112,
                  111,
                  111,
                  108,
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
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ]
          }
        },
        {
          name: "pool_authority_mint_account",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "pool_authority"
              },
              {
                kind: "account",
                path: "mint"
              },
              {
                kind: "account",
                path: "mint"
              }
            ],
            program: {
              kind: "account",
              path: "associated_token_program"
            }
          }
        },
        {
          name: "pool_authority_wsol_account",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "pool_authority"
              },
              {
                kind: "account",
                path: "token_program"
              },
              {
                kind: "account",
                path: "wsol_mint"
              }
            ],
            program: {
              kind: "account",
              path: "associated_token_program"
            }
          }
        },
        {
          name: "amm_global_config",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ],
            program: {
              kind: "account",
              path: "pump_amm"
            }
          }
        },
        {
          name: "wsol_mint",
          address: "So11111111111111111111111111111111111111112"
        },
        {
          name: "lp_mint",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  112,
                  111,
                  111,
                  108,
                  95,
                  108,
                  112,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                kind: "account",
                path: "pool"
              }
            ],
            program: {
              kind: "account",
              path: "pump_amm"
            }
          }
        },
        {
          name: "user_pool_token_account",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "pool_authority"
              },
              {
                kind: "account",
                path: "token_2022_program"
              },
              {
                kind: "account",
                path: "lp_mint"
              }
            ],
            program: {
              kind: "account",
              path: "associated_token_program"
            }
          }
        },
        {
          name: "pool_base_token_account",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "pool"
              },
              {
                kind: "account",
                path: "mint"
              },
              {
                kind: "account",
                path: "mint"
              }
            ],
            program: {
              kind: "account",
              path: "associated_token_program"
            }
          }
        },
        {
          name: "pool_quote_token_account",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "pool"
              },
              {
                kind: "account",
                path: "token_program"
              },
              {
                kind: "account",
                path: "wsol_mint"
              }
            ],
            program: {
              kind: "account",
              path: "associated_token_program"
            }
          }
        },
        {
          name: "token_2022_program",
          address: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          name: "associated_token_program",
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          name: "pump_amm_event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ],
            program: {
              kind: "account",
              path: "pump_amm"
            }
          }
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program",
          address: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
        },
        {
          name: "rent",
          address: "SysvarRent111111111111111111111111111111111"
        }
      ],
      args: []
    },
    {
      name: "migrate_bonding_curve_creator",
      discriminator: [
        87,
        124,
        52,
        191,
        52,
        38,
        214,
        232
      ],
      accounts: [
        {
          name: "mint",
          relations: [
            "sharing_config"
          ]
        },
        {
          name: "bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ]
          }
        },
        {
          name: "sharing_config",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  115,
                  104,
                  97,
                  114,
                  105,
                  110,
                  103,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ],
            program: {
              kind: "const",
              value: [
                12,
                53,
                255,
                169,
                5,
                90,
                142,
                86,
                141,
                168,
                247,
                188,
                7,
                86,
                21,
                39,
                76,
                241,
                201,
                44,
                164,
                31,
                64,
                0,
                156,
                81,
                106,
                164,
                20,
                194,
                124,
                112
              ]
            }
          }
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: []
    },
    {
      name: "migrate_v2",
      docs: [
        "Migrates liquidity to pump_amm if the bonding curve is complete"
      ],
      discriminator: [
        187,
        203,
        18,
        31,
        206,
        237,
        254,
        41
      ],
      accounts: [
        {
          name: "global",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "withdraw_authority",
          writable: true,
          relations: [
            "global"
          ]
        },
        {
          name: "base_mint"
        },
        {
          name: "quote_mint"
        },
        {
          name: "bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "base_mint"
              }
            ]
          }
        },
        {
          name: "associated_base_bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "bonding_curve"
              },
              {
                kind: "account",
                path: "base_token_program"
              },
              {
                kind: "account",
                path: "base_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "associated_quote_bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "bonding_curve"
              },
              {
                kind: "account",
                path: "quote_token_program"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "account",
              path: "associated_token_program"
            }
          }
        },
        {
          name: "user",
          signer: true
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        },
        {
          name: "pump_amm",
          address: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"
        },
        {
          name: "pool",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                kind: "const",
                value: [
                  0,
                  0
                ]
              },
              {
                kind: "account",
                path: "pool_authority"
              },
              {
                kind: "account",
                path: "base_mint"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "account",
              path: "pump_amm"
            }
          }
        },
        {
          name: "pool_authority",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  112,
                  111,
                  111,
                  108,
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
                ]
              },
              {
                kind: "account",
                path: "base_mint"
              }
            ]
          }
        },
        {
          name: "pool_authority_mint_account",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "pool_authority"
              },
              {
                kind: "account",
                path: "base_token_program"
              },
              {
                kind: "account",
                path: "base_mint"
              }
            ],
            program: {
              kind: "account",
              path: "associated_token_program"
            }
          }
        },
        {
          name: "pool_authority_quote_account",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "pool_authority"
              },
              {
                kind: "account",
                path: "quote_token_program"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "account",
              path: "associated_token_program"
            }
          }
        },
        {
          name: "amm_global_config",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ],
            program: {
              kind: "account",
              path: "pump_amm"
            }
          }
        },
        {
          name: "lp_mint",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  112,
                  111,
                  111,
                  108,
                  95,
                  108,
                  112,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                kind: "account",
                path: "pool"
              }
            ],
            program: {
              kind: "account",
              path: "pump_amm"
            }
          }
        },
        {
          name: "user_pool_token_account",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "pool_authority"
              },
              {
                kind: "account",
                path: "token_2022_program"
              },
              {
                kind: "account",
                path: "lp_mint"
              }
            ],
            program: {
              kind: "account",
              path: "associated_token_program"
            }
          }
        },
        {
          name: "pool_base_token_account",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "pool"
              },
              {
                kind: "account",
                path: "base_token_program"
              },
              {
                kind: "account",
                path: "base_mint"
              }
            ],
            program: {
              kind: "account",
              path: "associated_token_program"
            }
          }
        },
        {
          name: "pool_quote_token_account",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "pool"
              },
              {
                kind: "account",
                path: "quote_token_program"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "account",
              path: "associated_token_program"
            }
          }
        },
        {
          name: "base_token_program"
        },
        {
          name: "quote_token_program"
        },
        {
          name: "token_2022_program",
          address: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          name: "associated_token_program",
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          name: "pump_amm_event_authority"
        },
        {
          name: "rent",
          address: "SysvarRent111111111111111111111111111111111"
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: []
    },
    {
      name: "remove_quote_mint",
      discriminator: [
        177,
        65,
        223,
        38,
        88,
        209,
        158,
        155
      ],
      accounts: [
        {
          name: "global",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "authority",
          writable: true,
          signer: true,
          relations: [
            "global"
          ]
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: [
        {
          name: "quote_mint",
          type: "pubkey"
        }
      ]
    },
    {
      name: "sell",
      docs: [
        "Sells tokens into a bonding curve.",
        "For cashback coins, pass as remaining_accounts: [0] user_volume_accumulator,",
        "[1] bonding_curve_v2. If provided and valid, creator_fee goes to user_volume_accumulator.",
        "Otherwise, falls back to transferring creator_fee to creator_vault."
      ],
      discriminator: [
        51,
        230,
        133,
        164,
        1,
        127,
        131,
        173
      ],
      accounts: [
        {
          name: "global",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "fee_recipient",
          writable: true
        },
        {
          name: "mint"
        },
        {
          name: "bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ]
          }
        },
        {
          name: "associated_bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "bonding_curve"
              },
              {
                kind: "account",
                path: "token_program"
              },
              {
                kind: "account",
                path: "mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "associated_user",
          writable: true
        },
        {
          name: "user",
          writable: true,
          signer: true
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        },
        {
          name: "creator_vault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  99,
                  114,
                  101,
                  97,
                  116,
                  111,
                  114,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                kind: "account",
                path: "bonding_curve.creator",
                account: "BondingCurve"
              }
            ]
          }
        },
        {
          name: "token_program"
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program",
          address: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
        },
        {
          name: "fee_config",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  102,
                  101,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                kind: "const",
                value: [
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
                ]
              }
            ],
            program: {
              kind: "account",
              path: "fee_program"
            }
          }
        },
        {
          name: "fee_program",
          address: "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"
        }
      ],
      args: [
        {
          name: "amount",
          type: "u64"
        },
        {
          name: "min_sol_output",
          type: "u64"
        }
      ]
    },
    {
      name: "sell_v2",
      discriminator: [
        93,
        246,
        130,
        60,
        231,
        233,
        64,
        178
      ],
      accounts: [
        {
          name: "global",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "base_mint"
        },
        {
          name: "quote_mint"
        },
        {
          name: "base_token_program"
        },
        {
          name: "quote_token_program"
        },
        {
          name: "associated_token_program",
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          name: "fee_recipient",
          writable: true
        },
        {
          name: "associated_quote_fee_recipient",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "fee_recipient"
              },
              {
                kind: "account",
                path: "quote_token_program"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "buyback_fee_recipient",
          writable: true
        },
        {
          name: "associated_quote_buyback_fee_recipient",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "buyback_fee_recipient"
              },
              {
                kind: "account",
                path: "quote_token_program"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "base_mint"
              }
            ]
          }
        },
        {
          name: "associated_base_bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "bonding_curve"
              },
              {
                kind: "account",
                path: "base_token_program"
              },
              {
                kind: "account",
                path: "base_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "associated_quote_bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "bonding_curve"
              },
              {
                kind: "account",
                path: "quote_token_program"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "user",
          writable: true,
          signer: true
        },
        {
          name: "associated_base_user",
          writable: true
        },
        {
          name: "associated_quote_user",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "user"
              },
              {
                kind: "account",
                path: "quote_token_program"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "creator_vault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  99,
                  114,
                  101,
                  97,
                  116,
                  111,
                  114,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                kind: "account",
                path: "bonding_curve.creator",
                account: "BondingCurve"
              }
            ]
          }
        },
        {
          name: "associated_creator_vault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "creator_vault"
              },
              {
                kind: "account",
                path: "quote_token_program"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "sharing_config",
          docs: [
            "seeds; the account is intentionally not deserialized here because it may be uninitialized",
            "for mints that have not created a fee sharing config. Handlers must check",
            "`data_is_empty()` / owner before reading."
          ],
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  115,
                  104,
                  97,
                  114,
                  105,
                  110,
                  103,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                kind: "account",
                path: "base_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
                12,
                53,
                255,
                169,
                5,
                90,
                142,
                86,
                141,
                168,
                247,
                188,
                7,
                86,
                21,
                39,
                76,
                241,
                201,
                44,
                164,
                31,
                64,
                0,
                156,
                81,
                106,
                164,
                20,
                194,
                124,
                112
              ]
            }
          }
        },
        {
          name: "user_volume_accumulator",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  117,
                  115,
                  101,
                  114,
                  95,
                  118,
                  111,
                  108,
                  117,
                  109,
                  101,
                  95,
                  97,
                  99,
                  99,
                  117,
                  109,
                  117,
                  108,
                  97,
                  116,
                  111,
                  114
                ]
              },
              {
                kind: "account",
                path: "user"
              }
            ]
          }
        },
        {
          name: "associated_user_volume_accumulator",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "user_volume_accumulator"
              },
              {
                kind: "account",
                path: "quote_token_program"
              },
              {
                kind: "account",
                path: "quote_mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "fee_config",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  102,
                  101,
                  101,
                  95,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              },
              {
                kind: "const",
                value: [
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
                ]
              }
            ],
            program: {
              kind: "account",
              path: "fee_program"
            }
          }
        },
        {
          name: "fee_program",
          address: "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"
        },
        {
          name: "system_program",
          address: "11111111111111111111111111111111"
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program",
          address: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
        }
      ],
      args: [
        {
          name: "amount",
          type: "u64"
        },
        {
          name: "min_sol_output",
          type: "u64"
        }
      ]
    },
    {
      name: "set_creator",
      docs: [
        "Allows Global::set_creator_authority to set the bonding curve creator from Metaplex metadata or input argument"
      ],
      discriminator: [
        254,
        148,
        255,
        112,
        207,
        142,
        170,
        165
      ],
      accounts: [
        {
          name: "set_creator_authority",
          signer: true,
          relations: [
            "global"
          ]
        },
        {
          name: "global",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "mint"
        },
        {
          name: "metadata",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                kind: "const",
                value: [
                  11,
                  112,
                  101,
                  177,
                  227,
                  209,
                  124,
                  69,
                  56,
                  157,
                  82,
                  127,
                  107,
                  4,
                  195,
                  205,
                  88,
                  184,
                  108,
                  115,
                  26,
                  160,
                  253,
                  181,
                  73,
                  182,
                  209,
                  188,
                  3,
                  248,
                  41,
                  70
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ],
            program: {
              kind: "const",
              value: [
                11,
                112,
                101,
                177,
                227,
                209,
                124,
                69,
                56,
                157,
                82,
                127,
                107,
                4,
                195,
                205,
                88,
                184,
                108,
                115,
                26,
                160,
                253,
                181,
                73,
                182,
                209,
                188,
                3,
                248,
                41,
                70
              ]
            }
          }
        },
        {
          name: "bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ]
          }
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: [
        {
          name: "creator",
          type: "pubkey"
        }
      ]
    },
    {
      name: "set_mayhem_virtual_params",
      discriminator: [
        61,
        169,
        188,
        191,
        153,
        149,
        42,
        97
      ],
      accounts: [
        {
          name: "sol_vault_authority",
          writable: true,
          signer: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  115,
                  111,
                  108,
                  45,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              }
            ],
            program: {
              kind: "const",
              value: [
                5,
                42,
                229,
                215,
                167,
                218,
                167,
                36,
                166,
                234,
                176,
                167,
                41,
                84,
                145,
                133,
                90,
                212,
                160,
                103,
                22,
                96,
                103,
                76,
                78,
                3,
                69,
                89,
                128,
                61,
                101,
                163
              ]
            }
          }
        },
        {
          name: "mayhem_token_vault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "sol_vault_authority"
              },
              {
                kind: "account",
                path: "token_program"
              },
              {
                kind: "account",
                path: "mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "mint"
        },
        {
          name: "global",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ]
          }
        },
        {
          name: "token_program",
          address: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: []
    },
    {
      name: "set_metaplex_creator",
      docs: [
        "Syncs the bonding curve creator with the Metaplex metadata creator if it exists"
      ],
      discriminator: [
        138,
        96,
        174,
        217,
        48,
        85,
        197,
        246
      ],
      accounts: [
        {
          name: "mint"
        },
        {
          name: "metadata",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                kind: "const",
                value: [
                  11,
                  112,
                  101,
                  177,
                  227,
                  209,
                  124,
                  69,
                  56,
                  157,
                  82,
                  127,
                  107,
                  4,
                  195,
                  205,
                  88,
                  184,
                  108,
                  115,
                  26,
                  160,
                  253,
                  181,
                  73,
                  182,
                  209,
                  188,
                  3,
                  248,
                  41,
                  70
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ],
            program: {
              kind: "const",
              value: [
                11,
                112,
                101,
                177,
                227,
                209,
                124,
                69,
                56,
                157,
                82,
                127,
                107,
                4,
                195,
                205,
                88,
                184,
                108,
                115,
                26,
                160,
                253,
                181,
                73,
                182,
                209,
                188,
                3,
                248,
                41,
                70
              ]
            }
          }
        },
        {
          name: "bonding_curve",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ]
          }
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: []
    },
    {
      name: "set_params",
      docs: [
        "Sets the global state parameters."
      ],
      discriminator: [
        27,
        234,
        178,
        52,
        147,
        2,
        187,
        141
      ],
      accounts: [
        {
          name: "global",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "authority",
          writable: true,
          signer: true,
          relations: [
            "global"
          ]
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: [
        {
          name: "initial_virtual_token_reserves",
          type: "u64"
        },
        {
          name: "initial_virtual_sol_reserves",
          type: "u64"
        },
        {
          name: "initial_real_token_reserves",
          type: "u64"
        },
        {
          name: "token_total_supply",
          type: "u64"
        },
        {
          name: "fee_basis_points",
          type: "u64"
        },
        {
          name: "withdraw_authority",
          type: "pubkey"
        },
        {
          name: "enable_migrate",
          type: "bool"
        },
        {
          name: "pool_migration_fee",
          type: "u64"
        },
        {
          name: "creator_fee_basis_points",
          type: "u64"
        },
        {
          name: "set_creator_authority",
          type: "pubkey"
        },
        {
          name: "admin_set_creator_authority",
          type: "pubkey"
        }
      ]
    },
    {
      name: "set_reserved_fee_recipients",
      discriminator: [
        111,
        172,
        162,
        232,
        114,
        89,
        213,
        142
      ],
      accounts: [
        {
          name: "global",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "authority",
          signer: true,
          relations: [
            "global"
          ]
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: [
        {
          name: "whitelist_pda",
          type: "pubkey"
        }
      ]
    },
    {
      name: "set_virtual_quote_reserves",
      discriminator: [
        101,
        135,
        191,
        104,
        9,
        88,
        20,
        96
      ],
      accounts: [
        {
          name: "global",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "authority",
          writable: true,
          signer: true,
          relations: [
            "global"
          ]
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: [
        {
          name: "initial_virtual_quote_reserves",
          type: "u64"
        }
      ]
    },
    {
      name: "sync_user_volume_accumulator",
      discriminator: [
        86,
        31,
        192,
        87,
        163,
        87,
        79,
        238
      ],
      accounts: [
        {
          name: "user"
        },
        {
          name: "global_volume_accumulator",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108,
                  95,
                  118,
                  111,
                  108,
                  117,
                  109,
                  101,
                  95,
                  97,
                  99,
                  99,
                  117,
                  109,
                  117,
                  108,
                  97,
                  116,
                  111,
                  114
                ]
              }
            ]
          }
        },
        {
          name: "user_volume_accumulator",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  117,
                  115,
                  101,
                  114,
                  95,
                  118,
                  111,
                  108,
                  117,
                  109,
                  101,
                  95,
                  97,
                  99,
                  99,
                  117,
                  109,
                  117,
                  108,
                  97,
                  116,
                  111,
                  114
                ]
              },
              {
                kind: "account",
                path: "user"
              }
            ]
          }
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: []
    },
    {
      name: "toggle_cashback_enabled",
      discriminator: [
        115,
        103,
        224,
        255,
        189,
        89,
        86,
        195
      ],
      accounts: [
        {
          name: "global",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "authority",
          writable: true,
          signer: true,
          relations: [
            "global"
          ]
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: [
        {
          name: "enabled",
          type: "bool"
        }
      ]
    },
    {
      name: "toggle_create_v2",
      discriminator: [
        28,
        255,
        230,
        240,
        172,
        107,
        203,
        171
      ],
      accounts: [
        {
          name: "global",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "authority",
          writable: true,
          signer: true,
          relations: [
            "global"
          ]
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: [
        {
          name: "enabled",
          type: "bool"
        }
      ]
    },
    {
      name: "toggle_mayhem_mode",
      discriminator: [
        1,
        9,
        111,
        208,
        100,
        31,
        255,
        163
      ],
      accounts: [
        {
          name: "global",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "authority",
          writable: true,
          signer: true,
          relations: [
            "global"
          ]
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: [
        {
          name: "enabled",
          type: "bool"
        }
      ]
    },
    {
      name: "update_buyback_config",
      discriminator: [
        251,
        224,
        171,
        146,
        160,
        26,
        113,
        233
      ],
      accounts: [
        {
          name: "global",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "authority",
          writable: true,
          signer: true,
          relations: [
            "global"
          ]
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: [
        {
          name: "buyback_basis_points",
          type: {
            option: "u64"
          }
        }
      ]
    },
    {
      name: "update_global_authority",
      discriminator: [
        227,
        181,
        74,
        196,
        208,
        21,
        97,
        213
      ],
      accounts: [
        {
          name: "global",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
                  103,
                  108,
                  111,
                  98,
                  97,
                  108
                ]
              }
            ]
          }
        },
        {
          name: "authority",
          signer: true,
          relations: [
            "global"
          ]
        },
        {
          name: "new_authority"
        },
        {
          name: "event_authority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: []
    }
  ],
  accounts: [
    {
      name: "BondingCurve",
      discriminator: [
        23,
        183,
        248,
        55,
        96,
        216,
        172,
        96
      ]
    },
    {
      name: "FeeConfig",
      discriminator: [
        143,
        52,
        146,
        187,
        219,
        123,
        76,
        155
      ]
    },
    {
      name: "Global",
      discriminator: [
        167,
        232,
        232,
        177,
        200,
        108,
        114,
        127
      ]
    },
    {
      name: "GlobalVolumeAccumulator",
      discriminator: [
        202,
        42,
        246,
        43,
        142,
        190,
        30,
        255
      ]
    },
    {
      name: "SharingConfig",
      discriminator: [
        216,
        74,
        9,
        0,
        56,
        140,
        93,
        75
      ]
    },
    {
      name: "UserVolumeAccumulator",
      discriminator: [
        86,
        255,
        112,
        14,
        102,
        53,
        154,
        250
      ]
    }
  ],
  events: [
    {
      name: "AdminSetCreatorEvent",
      discriminator: [
        64,
        69,
        192,
        104,
        29,
        30,
        25,
        107
      ]
    },
    {
      name: "AdminSetIdlAuthorityEvent",
      discriminator: [
        245,
        59,
        70,
        34,
        75,
        185,
        109,
        92
      ]
    },
    {
      name: "AdminUpdateTokenIncentivesEvent",
      discriminator: [
        147,
        250,
        108,
        120,
        247,
        29,
        67,
        222
      ]
    },
    {
      name: "ClaimCashbackEvent",
      discriminator: [
        226,
        214,
        246,
        33,
        7,
        242,
        147,
        229
      ]
    },
    {
      name: "ClaimTokenIncentivesEvent",
      discriminator: [
        79,
        172,
        246,
        49,
        205,
        91,
        206,
        232
      ]
    },
    {
      name: "CloseUserVolumeAccumulatorEvent",
      discriminator: [
        146,
        159,
        189,
        172,
        146,
        88,
        56,
        244
      ]
    },
    {
      name: "CollectCreatorFeeEvent",
      discriminator: [
        122,
        2,
        127,
        1,
        14,
        191,
        12,
        175
      ]
    },
    {
      name: "CompleteEvent",
      discriminator: [
        95,
        114,
        97,
        156,
        212,
        46,
        152,
        8
      ]
    },
    {
      name: "CompletePumpAmmMigrationEvent",
      discriminator: [
        189,
        233,
        93,
        185,
        92,
        148,
        234,
        148
      ]
    },
    {
      name: "CreateEvent",
      discriminator: [
        27,
        114,
        169,
        77,
        222,
        235,
        99,
        118
      ]
    },
    {
      name: "DistributeCreatorFeesEvent",
      discriminator: [
        165,
        55,
        129,
        112,
        4,
        179,
        202,
        40
      ]
    },
    {
      name: "ExtendAccountEvent",
      discriminator: [
        97,
        97,
        215,
        144,
        93,
        146,
        22,
        124
      ]
    },
    {
      name: "InitUserVolumeAccumulatorEvent",
      discriminator: [
        134,
        36,
        13,
        72,
        232,
        101,
        130,
        216
      ]
    },
    {
      name: "MigrateBondingCurveCreatorEvent",
      discriminator: [
        155,
        167,
        104,
        220,
        213,
        108,
        243,
        3
      ]
    },
    {
      name: "MinimumDistributableFeeEvent",
      discriminator: [
        168,
        216,
        132,
        239,
        235,
        182,
        49,
        52
      ]
    },
    {
      name: "ReservedFeeRecipientsEvent",
      discriminator: [
        43,
        188,
        250,
        18,
        221,
        75,
        187,
        95
      ]
    },
    {
      name: "SetCreatorEvent",
      discriminator: [
        237,
        52,
        123,
        37,
        245,
        251,
        72,
        210
      ]
    },
    {
      name: "SetMetaplexCreatorEvent",
      discriminator: [
        142,
        203,
        6,
        32,
        127,
        105,
        191,
        162
      ]
    },
    {
      name: "SetParamsEvent",
      discriminator: [
        223,
        195,
        159,
        246,
        62,
        48,
        143,
        131
      ]
    },
    {
      name: "SyncUserVolumeAccumulatorEvent",
      discriminator: [
        197,
        122,
        167,
        124,
        116,
        81,
        91,
        255
      ]
    },
    {
      name: "TradeEvent",
      discriminator: [
        189,
        219,
        127,
        211,
        78,
        230,
        97,
        238
      ]
    },
    {
      name: "UpdateGlobalAuthorityEvent",
      discriminator: [
        182,
        195,
        137,
        42,
        35,
        206,
        207,
        247
      ]
    },
    {
      name: "UpdateMayhemVirtualParamsEvent",
      discriminator: [
        117,
        123,
        228,
        182,
        161,
        168,
        220,
        214
      ]
    }
  ],
  errors: [
    {
      code: 6e3,
      name: "NotAuthorized",
      msg: "The given account is not authorized to execute this instruction."
    },
    {
      code: 6001,
      name: "AlreadyInitialized",
      msg: "The program is already initialized."
    },
    {
      code: 6002,
      name: "TooMuchSolRequired",
      msg: "slippage: Too much SOL required to buy the given amount of tokens."
    },
    {
      code: 6003,
      name: "TooLittleSolReceived",
      msg: "slippage: Too little SOL received to sell the given amount of tokens."
    },
    {
      code: 6004,
      name: "MintDoesNotMatchBondingCurve",
      msg: "The mint does not match the bonding curve."
    },
    {
      code: 6005,
      name: "BondingCurveComplete",
      msg: "The bonding curve has completed and liquidity migrated to raydium."
    },
    {
      code: 6006,
      name: "BondingCurveNotComplete",
      msg: "The bonding curve has not completed."
    },
    {
      code: 6007,
      name: "NotInitialized",
      msg: "The program is not initialized."
    },
    {
      code: 6008,
      name: "WithdrawTooFrequent",
      msg: "Withdraw too frequent"
    },
    {
      code: 6009,
      name: "NewSizeShouldBeGreaterThanCurrentSize",
      msg: "new_size should be > current_size"
    },
    {
      code: 6010,
      name: "AccountTypeNotSupported",
      msg: "Account type not supported"
    },
    {
      code: 6011,
      name: "InitialRealTokenReservesShouldBeLessThanTokenTotalSupply",
      msg: "initial_real_token_reserves should be less than token_total_supply"
    },
    {
      code: 6012,
      name: "InitialVirtualTokenReservesShouldBeGreaterThanInitialRealTokenReserves",
      msg: "initial_virtual_token_reserves should be greater than initial_real_token_reserves"
    },
    {
      code: 6013,
      name: "FeeBasisPointsGreaterThanMaximum",
      msg: "fee_basis_points greater than maximum"
    },
    {
      code: 6014,
      name: "AllZerosWithdrawAuthority",
      msg: "Withdraw authority cannot be set to System Program ID"
    },
    {
      code: 6015,
      name: "PoolMigrationFeeShouldBeLessThanFinalRealSolReserves",
      msg: "pool_migration_fee should be less than final_real_sol_reserves"
    },
    {
      code: 6016,
      name: "PoolMigrationFeeShouldBeGreaterThanCreatorFeePlusMaxMigrateFees",
      msg: "pool_migration_fee should be greater than creator_fee + MAX_MIGRATE_FEES"
    },
    {
      code: 6017,
      name: "DisabledWithdraw",
      msg: "Migrate instruction is disabled"
    },
    {
      code: 6018,
      name: "DisabledMigrate",
      msg: "Migrate instruction is disabled"
    },
    {
      code: 6019,
      name: "InvalidCreator",
      msg: "Invalid creator pubkey"
    },
    {
      code: 6020,
      name: "BuyZeroAmount",
      msg: "Buy zero amount"
    },
    {
      code: 6021,
      name: "NotEnoughTokensToBuy",
      msg: "Not enough tokens to buy"
    },
    {
      code: 6022,
      name: "SellZeroAmount",
      msg: "Sell zero amount"
    },
    {
      code: 6023,
      name: "NotEnoughTokensToSell",
      msg: "Not enough tokens to sell"
    },
    {
      code: 6024,
      name: "Overflow",
      msg: "Overflow"
    },
    {
      code: 6025,
      name: "Truncation",
      msg: "Truncation"
    },
    {
      code: 6026,
      name: "DivisionByZero",
      msg: "Division by zero"
    },
    {
      code: 6027,
      name: "NotEnoughRemainingAccounts",
      msg: "Not enough remaining accounts"
    },
    {
      code: 6028,
      name: "AllFeeRecipientsShouldBeNonZero",
      msg: "All fee recipients should be non-zero"
    },
    {
      code: 6029,
      name: "UnsortedNotUniqueFeeRecipients",
      msg: "Unsorted or not unique fee recipients"
    },
    {
      code: 6030,
      name: "CreatorShouldNotBeZero",
      msg: "Creator should not be zero"
    },
    {
      code: 6031,
      name: "StartTimeInThePast"
    },
    {
      code: 6032,
      name: "EndTimeInThePast"
    },
    {
      code: 6033,
      name: "EndTimeBeforeStartTime"
    },
    {
      code: 6034,
      name: "TimeRangeTooLarge"
    },
    {
      code: 6035,
      name: "EndTimeBeforeCurrentDay"
    },
    {
      code: 6036,
      name: "SupplyUpdateForFinishedRange"
    },
    {
      code: 6037,
      name: "DayIndexAfterEndIndex"
    },
    {
      code: 6038,
      name: "DayInActiveRange"
    },
    {
      code: 6039,
      name: "InvalidIncentiveMint"
    },
    {
      code: 6040,
      name: "BuyNotEnoughSolToCoverRent",
      msg: "Buy: Not enough SOL to cover for rent exemption."
    },
    {
      code: 6041,
      name: "BuyNotEnoughSolToCoverFees",
      msg: "Buy: Not enough SOL to cover for fees."
    },
    {
      code: 6042,
      name: "BuySlippageBelowMinTokensOut",
      msg: "Slippage: Would buy less tokens than expected min_tokens_out"
    },
    {
      code: 6043,
      name: "NameTooLong"
    },
    {
      code: 6044,
      name: "SymbolTooLong"
    },
    {
      code: 6045,
      name: "UriTooLong"
    },
    {
      code: 6046,
      name: "CreateV2Disabled"
    },
    {
      code: 6047,
      name: "CpitializeMayhemFailed"
    },
    {
      code: 6048,
      name: "MayhemModeDisabled"
    },
    {
      code: 6049,
      name: "CreatorMigratedToSharingConfig",
      msg: "creator has been migrated to sharing config, use pump_fees::reset_fee_sharing_config instead"
    },
    {
      code: 6050,
      name: "UnableToDistributeCreatorVaultMigratedToSharingConfig",
      msg: "creator_vault has been migrated to sharing config, use pump:distribute_creator_fees instead"
    },
    {
      code: 6051,
      name: "SharingConfigNotActive",
      msg: "Sharing config is not active"
    },
    {
      code: 6052,
      name: "UnableToDistributeCreatorFeesToExecutableRecipient",
      msg: "The recipient account is executable, so it cannot receive lamports, remove it from the team first"
    },
    {
      code: 6053,
      name: "BondingCurveAndSharingConfigCreatorMismatch",
      msg: "Bonding curve creator does not match sharing config"
    },
    {
      code: 6054,
      name: "ShareholdersAndRemainingAccountsMismatch",
      msg: "Remaining accounts do not match shareholders, make sure to pass exactly the same pubkeys in the same order"
    },
    {
      code: 6055,
      name: "InvalidShareBps",
      msg: "Share bps must be greater than 0"
    },
    {
      code: 6056,
      name: "CashbackNotEnabled",
      msg: "Cashback is not enabled"
    },
    {
      code: 6057,
      name: "BuybackFeeRecipientNotAuthorized",
      msg: "Buyback fee recipient not authorized"
    },
    {
      code: 6058,
      name: "AllBuybackFeeRecipientsShouldBeNonZero"
    },
    {
      code: 6059,
      name: "NotUniqueBuybackFeeRecipients"
    },
    {
      code: 6060,
      name: "BuybackBasisPointsOutOfRange",
      msg: "buyback_basis_points must be <= 10_000"
    },
    {
      code: 6061,
      name: "WrongBuybackFeeRecipientsCount",
      msg: "buyback fee recipients require exactly 8 remaining accounts (or none)"
    },
    {
      code: 6062,
      name: "BuybackFeeRecipientMissing"
    },
    {
      code: 6063,
      name: "UnsupportedQuoteMint",
      msg: "Unsupported quote mint"
    },
    {
      code: 6064,
      name: "InvalidQuoteTokenProgram",
      msg: "Create v2: quote token program must be legacy SPL Token"
    },
    {
      code: 6065,
      name: "InvalidAssociatedQuoteBondingCurve",
      msg: "Create v2: associated quote bonding curve address does not match derivation"
    },
    {
      code: 6066,
      name: "QuoteMintWhitelistFull",
      msg: "Quote mint whitelist is full"
    },
    {
      code: 6067,
      name: "QuoteMintAlreadyWhitelisted",
      msg: "Quote mint is already whitelisted"
    },
    {
      code: 6068,
      name: "QuoteMintNotWhitelisted",
      msg: "Quote mint is not in the whitelist"
    },
    {
      code: 6069,
      name: "QuoteMintNotEligibleForWhitelist",
      msg: "Quote mint cannot be added or removed via whitelist (default or native SOL mint)"
    }
  ],
  types: [
    {
      name: "AdminSetCreatorEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "timestamp",
            type: "i64"
          },
          {
            name: "admin_set_creator_authority",
            type: "pubkey"
          },
          {
            name: "mint",
            type: "pubkey"
          },
          {
            name: "bonding_curve",
            type: "pubkey"
          },
          {
            name: "old_creator",
            type: "pubkey"
          },
          {
            name: "new_creator",
            type: "pubkey"
          }
        ]
      }
    },
    {
      name: "AdminSetIdlAuthorityEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "idl_authority",
            type: "pubkey"
          }
        ]
      }
    },
    {
      name: "AdminUpdateTokenIncentivesEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "start_time",
            type: "i64"
          },
          {
            name: "end_time",
            type: "i64"
          },
          {
            name: "day_number",
            type: "u64"
          },
          {
            name: "token_supply_per_day",
            type: "u64"
          },
          {
            name: "mint",
            type: "pubkey"
          },
          {
            name: "seconds_in_a_day",
            type: "i64"
          },
          {
            name: "timestamp",
            type: "i64"
          }
        ]
      }
    },
    {
      name: "BondingCurve",
      type: {
        kind: "struct",
        fields: [
          {
            name: "virtual_token_reserves",
            type: "u64"
          },
          {
            name: "virtual_quote_reserves",
            type: "u64"
          },
          {
            name: "real_token_reserves",
            type: "u64"
          },
          {
            name: "real_quote_reserves",
            type: "u64"
          },
          {
            name: "token_total_supply",
            type: "u64"
          },
          {
            name: "complete",
            type: "bool"
          },
          {
            name: "creator",
            type: "pubkey"
          },
          {
            name: "is_mayhem_mode",
            type: "bool"
          },
          {
            name: "is_cashback_coin",
            type: "bool"
          },
          {
            name: "quote_mint",
            type: "pubkey"
          }
        ]
      }
    },
    {
      name: "ClaimCashbackEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "user",
            type: "pubkey"
          },
          {
            name: "amount",
            type: "u64"
          },
          {
            name: "timestamp",
            type: "i64"
          },
          {
            name: "total_claimed",
            type: "u64"
          },
          {
            name: "total_cashback_earned",
            type: "u64"
          }
        ]
      }
    },
    {
      name: "ClaimTokenIncentivesEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "user",
            type: "pubkey"
          },
          {
            name: "mint",
            type: "pubkey"
          },
          {
            name: "amount",
            type: "u64"
          },
          {
            name: "timestamp",
            type: "i64"
          },
          {
            name: "total_claimed_tokens",
            type: "u64"
          },
          {
            name: "current_sol_volume",
            type: "u64"
          }
        ]
      }
    },
    {
      name: "CloseUserVolumeAccumulatorEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "user",
            type: "pubkey"
          },
          {
            name: "timestamp",
            type: "i64"
          },
          {
            name: "total_unclaimed_tokens",
            type: "u64"
          },
          {
            name: "total_claimed_tokens",
            type: "u64"
          },
          {
            name: "current_sol_volume",
            type: "u64"
          },
          {
            name: "last_update_timestamp",
            type: "i64"
          }
        ]
      }
    },
    {
      name: "CollectCreatorFeeEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "timestamp",
            type: "i64"
          },
          {
            name: "creator",
            type: "pubkey"
          },
          {
            name: "creator_fee",
            type: "u64"
          }
        ]
      }
    },
    {
      name: "CompleteEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "user",
            type: "pubkey"
          },
          {
            name: "mint",
            type: "pubkey"
          },
          {
            name: "bonding_curve",
            type: "pubkey"
          },
          {
            name: "timestamp",
            type: "i64"
          },
          {
            name: "quote_mint",
            type: "pubkey"
          }
        ]
      }
    },
    {
      name: "CompletePumpAmmMigrationEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "user",
            type: "pubkey"
          },
          {
            name: "mint",
            type: "pubkey"
          },
          {
            name: "mint_amount",
            type: "u64"
          },
          {
            name: "sol_amount",
            type: "u64"
          },
          {
            name: "pool_migration_fee",
            type: "u64"
          },
          {
            name: "bonding_curve",
            type: "pubkey"
          },
          {
            name: "timestamp",
            type: "i64"
          },
          {
            name: "pool",
            type: "pubkey"
          }
        ]
      }
    },
    {
      name: "ConfigStatus",
      type: {
        kind: "enum",
        variants: [
          {
            name: "Paused"
          },
          {
            name: "Active"
          }
        ]
      }
    },
    {
      name: "CreateEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "name",
            type: "string"
          },
          {
            name: "symbol",
            type: "string"
          },
          {
            name: "uri",
            type: "string"
          },
          {
            name: "mint",
            type: "pubkey"
          },
          {
            name: "bonding_curve",
            type: "pubkey"
          },
          {
            name: "user",
            type: "pubkey"
          },
          {
            name: "creator",
            type: "pubkey"
          },
          {
            name: "timestamp",
            type: "i64"
          },
          {
            name: "virtual_token_reserves",
            type: "u64"
          },
          {
            name: "virtual_sol_reserves",
            type: "u64"
          },
          {
            name: "real_token_reserves",
            type: "u64"
          },
          {
            name: "token_total_supply",
            type: "u64"
          },
          {
            name: "token_program",
            type: "pubkey"
          },
          {
            name: "is_mayhem_mode",
            type: "bool"
          },
          {
            name: "is_cashback_enabled",
            type: "bool"
          },
          {
            name: "quote_mint",
            type: "pubkey"
          },
          {
            name: "virtual_quote_reserves",
            type: "u64"
          }
        ]
      }
    },
    {
      name: "DistributeCreatorFeesEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "timestamp",
            type: "i64"
          },
          {
            name: "mint",
            type: "pubkey"
          },
          {
            name: "bonding_curve",
            type: "pubkey"
          },
          {
            name: "sharing_config",
            type: "pubkey"
          },
          {
            name: "admin",
            type: "pubkey"
          },
          {
            name: "shareholders",
            type: {
              vec: {
                defined: {
                  name: "Shareholder"
                }
              }
            }
          },
          {
            name: "distributed",
            type: "u64"
          }
        ]
      }
    },
    {
      name: "ExtendAccountEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "account",
            type: "pubkey"
          },
          {
            name: "user",
            type: "pubkey"
          },
          {
            name: "current_size",
            type: "u64"
          },
          {
            name: "new_size",
            type: "u64"
          },
          {
            name: "timestamp",
            type: "i64"
          }
        ]
      }
    },
    {
      name: "FeeConfig",
      type: {
        kind: "struct",
        fields: [
          {
            name: "bump",
            type: "u8"
          },
          {
            name: "admin",
            type: "pubkey"
          },
          {
            name: "flat_fees",
            type: {
              defined: {
                name: "Fees"
              }
            }
          },
          {
            name: "fee_tiers",
            type: {
              vec: {
                defined: {
                  name: "FeeTier"
                }
              }
            }
          },
          {
            name: "stable_fee_tiers",
            type: {
              vec: {
                defined: {
                  name: "FeeTier"
                }
              }
            }
          }
        ]
      }
    },
    {
      name: "FeeTier",
      type: {
        kind: "struct",
        fields: [
          {
            name: "market_cap_lamports_threshold",
            type: "u128"
          },
          {
            name: "fees",
            type: {
              defined: {
                name: "Fees"
              }
            }
          }
        ]
      }
    },
    {
      name: "Fees",
      type: {
        kind: "struct",
        fields: [
          {
            name: "lp_fee_bps",
            type: "u64"
          },
          {
            name: "protocol_fee_bps",
            type: "u64"
          },
          {
            name: "creator_fee_bps",
            type: "u64"
          }
        ]
      }
    },
    {
      name: "Global",
      type: {
        kind: "struct",
        fields: [
          {
            name: "initialized",
            docs: [
              "Unused"
            ],
            type: "bool"
          },
          {
            name: "authority",
            type: "pubkey"
          },
          {
            name: "fee_recipient",
            type: "pubkey"
          },
          {
            name: "initial_virtual_token_reserves",
            type: "u64"
          },
          {
            name: "initial_virtual_sol_reserves",
            type: "u64"
          },
          {
            name: "initial_real_token_reserves",
            type: "u64"
          },
          {
            name: "token_total_supply",
            type: "u64"
          },
          {
            name: "fee_basis_points",
            type: "u64"
          },
          {
            name: "withdraw_authority",
            type: "pubkey"
          },
          {
            name: "enable_migrate",
            docs: [
              "Unused"
            ],
            type: "bool"
          },
          {
            name: "pool_migration_fee",
            type: "u64"
          },
          {
            name: "creator_fee_basis_points",
            type: "u64"
          },
          {
            name: "fee_recipients",
            type: {
              array: [
                "pubkey",
                7
              ]
            }
          },
          {
            name: "set_creator_authority",
            type: "pubkey"
          },
          {
            name: "admin_set_creator_authority",
            type: "pubkey"
          },
          {
            name: "create_v2_enabled",
            type: "bool"
          },
          {
            name: "whitelist_pda",
            type: "pubkey"
          },
          {
            name: "reserved_fee_recipient",
            type: "pubkey"
          },
          {
            name: "mayhem_mode_enabled",
            type: "bool"
          },
          {
            name: "reserved_fee_recipients",
            type: {
              array: [
                "pubkey",
                7
              ]
            }
          },
          {
            name: "is_cashback_enabled",
            type: "bool"
          },
          {
            name: "buyback_fee_recipients",
            type: {
              array: [
                "pubkey",
                8
              ]
            }
          },
          {
            name: "buyback_basis_points",
            type: "u64"
          },
          {
            name: "initial_virtual_quote_reserves",
            type: "u64"
          },
          {
            name: "whitelisted_quote_mints",
            type: {
              array: [
                "pubkey",
                1
              ]
            }
          }
        ]
      }
    },
    {
      name: "GlobalVolumeAccumulator",
      type: {
        kind: "struct",
        fields: [
          {
            name: "start_time",
            type: "i64"
          },
          {
            name: "end_time",
            type: "i64"
          },
          {
            name: "seconds_in_a_day",
            type: "i64"
          },
          {
            name: "mint",
            type: "pubkey"
          },
          {
            name: "total_token_supply",
            type: {
              array: [
                "u64",
                30
              ]
            }
          },
          {
            name: "sol_volumes",
            type: {
              array: [
                "u64",
                30
              ]
            }
          }
        ]
      }
    },
    {
      name: "InitUserVolumeAccumulatorEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "payer",
            type: "pubkey"
          },
          {
            name: "user",
            type: "pubkey"
          },
          {
            name: "timestamp",
            type: "i64"
          }
        ]
      }
    },
    {
      name: "MigrateBondingCurveCreatorEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "timestamp",
            type: "i64"
          },
          {
            name: "mint",
            type: "pubkey"
          },
          {
            name: "bonding_curve",
            type: "pubkey"
          },
          {
            name: "sharing_config",
            type: "pubkey"
          },
          {
            name: "old_creator",
            type: "pubkey"
          },
          {
            name: "new_creator",
            type: "pubkey"
          }
        ]
      }
    },
    {
      name: "MinimumDistributableFeeEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "minimum_required",
            type: "u64"
          },
          {
            name: "distributable_fees",
            type: "u64"
          },
          {
            name: "can_distribute",
            type: "bool"
          }
        ]
      }
    },
    {
      name: "OptionBool",
      type: {
        kind: "struct",
        fields: [
          "bool"
        ]
      }
    },
    {
      name: "ReservedFeeRecipientsEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "timestamp",
            type: "i64"
          },
          {
            name: "reserved_fee_recipient",
            type: "pubkey"
          },
          {
            name: "reserved_fee_recipients",
            type: {
              array: [
                "pubkey",
                7
              ]
            }
          }
        ]
      }
    },
    {
      name: "SetCreatorEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "timestamp",
            type: "i64"
          },
          {
            name: "mint",
            type: "pubkey"
          },
          {
            name: "bonding_curve",
            type: "pubkey"
          },
          {
            name: "creator",
            type: "pubkey"
          }
        ]
      }
    },
    {
      name: "SetMetaplexCreatorEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "timestamp",
            type: "i64"
          },
          {
            name: "mint",
            type: "pubkey"
          },
          {
            name: "bonding_curve",
            type: "pubkey"
          },
          {
            name: "metadata",
            type: "pubkey"
          },
          {
            name: "creator",
            type: "pubkey"
          }
        ]
      }
    },
    {
      name: "SetParamsEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "initial_virtual_token_reserves",
            type: "u64"
          },
          {
            name: "initial_virtual_sol_reserves",
            type: "u64"
          },
          {
            name: "initial_real_token_reserves",
            type: "u64"
          },
          {
            name: "final_real_sol_reserves",
            type: "u64"
          },
          {
            name: "token_total_supply",
            type: "u64"
          },
          {
            name: "fee_basis_points",
            type: "u64"
          },
          {
            name: "withdraw_authority",
            type: "pubkey"
          },
          {
            name: "enable_migrate",
            type: "bool"
          },
          {
            name: "pool_migration_fee",
            type: "u64"
          },
          {
            name: "creator_fee_basis_points",
            type: "u64"
          },
          {
            name: "fee_recipients",
            type: {
              array: [
                "pubkey",
                8
              ]
            }
          },
          {
            name: "timestamp",
            type: "i64"
          },
          {
            name: "set_creator_authority",
            type: "pubkey"
          },
          {
            name: "admin_set_creator_authority",
            type: "pubkey"
          }
        ]
      }
    },
    {
      name: "Shareholder",
      type: {
        kind: "struct",
        fields: [
          {
            name: "address",
            type: "pubkey"
          },
          {
            name: "share_bps",
            type: "u16"
          }
        ]
      }
    },
    {
      name: "SharingConfig",
      type: {
        kind: "struct",
        fields: [
          {
            name: "bump",
            type: "u8"
          },
          {
            name: "version",
            type: "u8"
          },
          {
            name: "status",
            type: {
              defined: {
                name: "ConfigStatus"
              }
            }
          },
          {
            name: "mint",
            type: "pubkey"
          },
          {
            name: "admin",
            type: "pubkey"
          },
          {
            name: "admin_revoked",
            type: "bool"
          },
          {
            name: "shareholders",
            type: {
              vec: {
                defined: {
                  name: "Shareholder"
                }
              }
            }
          }
        ]
      }
    },
    {
      name: "SyncUserVolumeAccumulatorEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "user",
            type: "pubkey"
          },
          {
            name: "total_claimed_tokens_before",
            type: "u64"
          },
          {
            name: "total_claimed_tokens_after",
            type: "u64"
          },
          {
            name: "timestamp",
            type: "i64"
          }
        ]
      }
    },
    {
      name: "TradeEvent",
      docs: [
        'ix_name: "buy" | "sell" | "buy_exact_sol_in"'
      ],
      type: {
        kind: "struct",
        fields: [
          {
            name: "mint",
            type: "pubkey"
          },
          {
            name: "sol_amount",
            type: "u64"
          },
          {
            name: "token_amount",
            type: "u64"
          },
          {
            name: "is_buy",
            type: "bool"
          },
          {
            name: "user",
            type: "pubkey"
          },
          {
            name: "timestamp",
            type: "i64"
          },
          {
            name: "virtual_sol_reserves",
            type: "u64"
          },
          {
            name: "virtual_token_reserves",
            type: "u64"
          },
          {
            name: "real_sol_reserves",
            type: "u64"
          },
          {
            name: "real_token_reserves",
            type: "u64"
          },
          {
            name: "fee_recipient",
            type: "pubkey"
          },
          {
            name: "fee_basis_points",
            type: "u64"
          },
          {
            name: "fee",
            type: "u64"
          },
          {
            name: "creator",
            type: "pubkey"
          },
          {
            name: "creator_fee_basis_points",
            type: "u64"
          },
          {
            name: "creator_fee",
            type: "u64"
          },
          {
            name: "track_volume",
            type: "bool"
          },
          {
            name: "total_unclaimed_tokens",
            type: "u64"
          },
          {
            name: "total_claimed_tokens",
            type: "u64"
          },
          {
            name: "current_sol_volume",
            type: "u64"
          },
          {
            name: "last_update_timestamp",
            type: "i64"
          },
          {
            name: "ix_name",
            type: "string"
          },
          {
            name: "mayhem_mode",
            type: "bool"
          },
          {
            name: "cashback_fee_basis_points",
            type: "u64"
          },
          {
            name: "cashback",
            type: "u64"
          },
          {
            name: "buyback_fee_basis_points",
            type: "u64"
          },
          {
            name: "buyback_fee",
            type: "u64"
          },
          {
            name: "shareholders",
            type: {
              vec: {
                defined: {
                  name: "Shareholder"
                }
              }
            }
          },
          {
            name: "quote_mint",
            type: "pubkey"
          },
          {
            name: "quote_amount",
            type: "u64"
          },
          {
            name: "virtual_quote_reserves",
            type: "u64"
          },
          {
            name: "real_quote_reserves",
            type: "u64"
          }
        ]
      }
    },
    {
      name: "UpdateGlobalAuthorityEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "global",
            type: "pubkey"
          },
          {
            name: "authority",
            type: "pubkey"
          },
          {
            name: "new_authority",
            type: "pubkey"
          },
          {
            name: "timestamp",
            type: "i64"
          }
        ]
      }
    },
    {
      name: "UpdateMayhemVirtualParamsEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "timestamp",
            type: "i64"
          },
          {
            name: "mint",
            type: "pubkey"
          },
          {
            name: "virtual_token_reserves",
            type: "u64"
          },
          {
            name: "virtual_sol_reserves",
            type: "u64"
          },
          {
            name: "new_virtual_token_reserves",
            type: "u64"
          },
          {
            name: "new_virtual_sol_reserves",
            type: "u64"
          },
          {
            name: "real_token_reserves",
            type: "u64"
          },
          {
            name: "real_sol_reserves",
            type: "u64"
          }
        ]
      }
    },
    {
      name: "UserVolumeAccumulator",
      type: {
        kind: "struct",
        fields: [
          {
            name: "user",
            type: "pubkey"
          },
          {
            name: "needs_claim",
            type: "bool"
          },
          {
            name: "total_unclaimed_tokens",
            type: "u64"
          },
          {
            name: "total_claimed_tokens",
            type: "u64"
          },
          {
            name: "current_sol_volume",
            type: "u64"
          },
          {
            name: "last_update_timestamp",
            type: "i64"
          },
          {
            name: "has_total_claimed_tokens",
            type: "bool"
          },
          {
            name: "cashback_earned",
            type: "u64"
          },
          {
            name: "total_cashback_claimed",
            type: "u64"
          }
        ]
      }
    }
  ]
};

// src/solana/pump-events.ts
var PUMP_BONDING_CURVE_PROGRAM_ID = new web3_js.PublicKey(pump_default.address);
var eventDiscriminatorMap = new Map(
  pump_default.events.map((ev) => [
    ev.name,
    Buffer.from(ev.discriminator)
  ])
);
if (eventDiscriminatorMap.size !== pump_default.events.length) {
  throw new Error(
    `pump-events: discriminator map size (${eventDiscriminatorMap.size}) != IDL events length (${pump_default.events.length})`
  );
}
var PROGRAM_DATA_PREFIX = "Program data: ";
function createPumpEventParser() {
  const coder = new event_js.BorshEventCoder(pump_default);
  return {
    parseLogs(logs) {
      const out = [];
      for (const line of logs) {
        if (!line.startsWith(PROGRAM_DATA_PREFIX)) continue;
        const b64 = line.slice(PROGRAM_DATA_PREFIX.length);
        const decoded = coder.decode(b64);
        if (!decoded) continue;
        out.push({
          name: decoded.name,
          data: decoded.data
        });
      }
      return out;
    }
  };
}
function subscribeToPumpEvents(connection, options, onEvent) {
  const programId = options.programId ?? PUMP_BONDING_CURVE_PROGRAM_ID;
  const commitment = options.commitment ?? "confirmed";
  const parser = createPumpEventParser();
  const subId = connection.onLogs(
    programId,
    (logsCb, ctx) => {
      if (logsCb.err) return;
      for (const ev of parser.parseLogs(logsCb.logs)) {
        if (options.mint) {
          const m = ev.data.mint;
          if (!(m instanceof web3_js.PublicKey) || !m.equals(options.mint)) continue;
        }
        ev.signature = logsCb.signature;
        ev.slot = ctx.slot;
        onEvent(ev);
      }
    },
    commitment
  );
  let unsubscribed = false;
  return {
    async unsubscribe() {
      if (unsubscribed) return;
      unsubscribed = true;
      const id = await Promise.resolve(subId);
      await connection.removeOnLogsListener(id);
    }
  };
}

// src/solana/legacy-agent-payments/index.ts
var legacy_agent_payments_exports = {};
__export(legacy_agent_payments_exports, {
  BONDING_CURVE_SEED: () => BONDING_CURVE_SEED2,
  BUYBACK_AUTHORITY_SEED: () => BUYBACK_AUTHORITY_SEED2,
  GLOBAL_CONFIG_SEED: () => GLOBAL_CONFIG_SEED2,
  INVOICE_ID_SEED: () => INVOICE_ID_SEED2,
  LEGACY_AGENT_PAYMENTS_PROGRAM_ID: () => LEGACY_AGENT_PAYMENTS_PROGRAM_ID,
  LegacyPumpAgent: () => LegacyPumpAgent,
  LegacyPumpAgentOffline: () => LegacyPumpAgentOffline,
  OFFLINE_PUMP_PROGRAM: () => OFFLINE_PUMP_PROGRAM2,
  PAYMENT_IN_CURRENCY_SEED: () => PAYMENT_IN_CURRENCY_SEED2,
  PUMP_PROGRAM_ID: () => PUMP_PROGRAM_ID2,
  TOKEN_AGENT_PAYMENTS_SEED: () => TOKEN_AGENT_PAYMENTS_SEED2,
  WITHDRAW_AUTHORITY_SEED: () => WITHDRAW_AUTHORITY_SEED2,
  decodeLegacyGlobalConfig: () => decodeLegacyGlobalConfig,
  decodeLegacyTokenAgentPaymentInCurrency: () => decodeLegacyTokenAgentPaymentInCurrency,
  decodeLegacyTokenAgentPayments: () => decodeLegacyTokenAgentPayments,
  getBondingCurvePDA: () => getBondingCurvePDA2,
  getBuybackAuthorityPDA: () => getBuybackAuthorityPDA2,
  getGlobalConfigPDA: () => getGlobalConfigPDA2,
  getInvoiceIdPDA: () => getInvoiceIdPDA2,
  getLegacyOfflineProgram: () => getLegacyOfflineProgram,
  getLegacyPumpProgram: () => getLegacyPumpProgram,
  getLegacyPumpProgramWithFallback: () => getLegacyPumpProgramWithFallback,
  getPaymentInCurrencyPDA: () => getPaymentInCurrencyPDA2,
  getTokenAgentPaymentsPDA: () => getTokenAgentPaymentsPDA2,
  getWithdrawAuthorityPDA: () => getWithdrawAuthorityPDA2
});
var LEGACY_AGENT_PAYMENTS_PROGRAM_ID = new web3_js.PublicKey(
  "pUmPFn9WvfaN2WTVGnCEtJTd2ATTpvpsKRz6jVzu6u4"
);
var PUMP_PROGRAM_ID2 = new web3_js.PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);
var GLOBAL_CONFIG_SEED2 = Buffer.from("global-config");
var TOKEN_AGENT_PAYMENTS_SEED2 = Buffer.from("token-agent-payments");
var PAYMENT_IN_CURRENCY_SEED2 = Buffer.from("payment-in-currency");
var INVOICE_ID_SEED2 = Buffer.from("invoice-id");
var BUYBACK_AUTHORITY_SEED2 = Buffer.from("buyback-authority");
var WITHDRAW_AUTHORITY_SEED2 = Buffer.from("withdraw-authority");
var BONDING_CURVE_SEED2 = Buffer.from("bonding-curve");
function getGlobalConfigPDA2() {
  return web3_js.PublicKey.findProgramAddressSync(
    [GLOBAL_CONFIG_SEED2],
    LEGACY_AGENT_PAYMENTS_PROGRAM_ID
  );
}
function getTokenAgentPaymentsPDA2(mint) {
  return web3_js.PublicKey.findProgramAddressSync(
    [TOKEN_AGENT_PAYMENTS_SEED2, mint.toBuffer()],
    LEGACY_AGENT_PAYMENTS_PROGRAM_ID
  );
}
function getPaymentInCurrencyPDA2(tokenMint, currencyMint) {
  return web3_js.PublicKey.findProgramAddressSync(
    [PAYMENT_IN_CURRENCY_SEED2, tokenMint.toBuffer(), currencyMint.toBuffer()],
    LEGACY_AGENT_PAYMENTS_PROGRAM_ID
  );
}
function getInvoiceIdPDA2(tokenMint, currencyMint, amount, memo, startTime, endTime) {
  return web3_js.PublicKey.findProgramAddressSync(
    [
      INVOICE_ID_SEED2,
      tokenMint.toBuffer(),
      currencyMint.toBuffer(),
      amount.toArrayLike(Buffer, "le", 8),
      memo.toArrayLike(Buffer, "le", 8),
      startTime.toArrayLike(Buffer, "le", 8),
      endTime.toArrayLike(Buffer, "le", 8)
    ],
    LEGACY_AGENT_PAYMENTS_PROGRAM_ID
  );
}
function getBuybackAuthorityPDA2(tokenMint) {
  return web3_js.PublicKey.findProgramAddressSync(
    [BUYBACK_AUTHORITY_SEED2, tokenMint.toBuffer()],
    LEGACY_AGENT_PAYMENTS_PROGRAM_ID
  );
}
function getWithdrawAuthorityPDA2(tokenMint) {
  return web3_js.PublicKey.findProgramAddressSync(
    [WITHDRAW_AUTHORITY_SEED2, tokenMint.toBuffer()],
    LEGACY_AGENT_PAYMENTS_PROGRAM_ID
  );
}
function getBondingCurvePDA2(mint) {
  return web3_js.PublicKey.findProgramAddressSync(
    [BONDING_CURVE_SEED2, mint.toBuffer()],
    PUMP_PROGRAM_ID2
  );
}

// src/solana/legacy-agent-payments/idl.json
var idl_default = {
  address: "pUmPFn9WvfaN2WTVGnCEtJTd2ATTpvpsKRz6jVzu6u4",
  metadata: {
    name: "pumpAgentPayments",
    version: "0.1.0",
    spec: "0.1.0",
    description: "Created with Anchor"
  },
  instructions: [
    {
      name: "agentAcceptPayment",
      discriminator: [
        34,
        157,
        64,
        220,
        74,
        32,
        48,
        225
      ],
      accounts: [
        {
          name: "user",
          writable: true,
          signer: true
        },
        {
          name: "userTokenAccount",
          writable: true
        },
        {
          name: "tokenAgentPayments"
        },
        {
          name: "tokenAgentAssociatedAccount",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "tokenAgentPayments"
              },
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "currencyMint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "tokenAgentPaymentInCurrency",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "tokenAgentPayments.mint",
                account: "tokenAgentPayments"
              },
              {
                kind: "account",
                path: "currencyMint"
              }
            ]
          }
        },
        {
          name: "globalConfig",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "invoiceId"
        },
        {
          name: "currencyMint"
        },
        {
          name: "tokenProgram"
        },
        {
          name: "associatedTokenProgram",
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          name: "systemProgram",
          address: "11111111111111111111111111111111"
        },
        {
          name: "eventAuthority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: [
        {
          name: "amount",
          type: "u64"
        },
        {
          name: "memo",
          type: "u64"
        },
        {
          name: "startTime",
          type: "i64"
        },
        {
          name: "endTime",
          type: "i64"
        }
      ]
    },
    {
      name: "agentBuybackTrigger",
      discriminator: [
        95,
        231,
        193,
        2,
        245,
        75,
        125,
        155
      ],
      accounts: [
        {
          name: "globalBuybackAuthority",
          writable: true,
          signer: true
        },
        {
          name: "mint",
          writable: true
        },
        {
          name: "tokenAgentPayments",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ]
          }
        },
        {
          name: "tokenAgentPaymentInCurrency",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "tokenAgentPayments.mint",
                account: "tokenAgentPayments"
              },
              {
                kind: "account",
                path: "currencyMint"
              }
            ]
          }
        },
        {
          name: "currencyMint"
        },
        {
          name: "globalConfig",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "swapProgramToInvoke"
        },
        {
          name: "burnAuthority",
          docs: [
            "Intentionally called burn_authority",
            "TO avoid any confusion with the global buyback authority."
          ],
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "tokenAgentPayments.mint",
                account: "tokenAgentPayments"
              }
            ]
          }
        },
        {
          name: "burnMintVault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "burnAuthority"
              },
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "tokenProgram"
        },
        {
          name: "associatedTokenProgram",
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          name: "systemProgram",
          address: "11111111111111111111111111111111"
        },
        {
          name: "eventAuthority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: [
        {
          name: "swapInstructionData",
          type: "bytes"
        }
      ]
    },
    {
      name: "agentDistributePayments",
      discriminator: [
        145,
        44,
        246,
        47,
        192,
        204,
        95,
        32
      ],
      accounts: [
        {
          name: "user",
          writable: true,
          signer: true
        },
        {
          name: "globalConfig",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "currencyMint"
        },
        {
          name: "tokenAgentPayments"
        },
        {
          name: "tokenAgentPaymentInCurrency",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "tokenAgentPayments.mint",
                account: "tokenAgentPayments"
              },
              {
                kind: "account",
                path: "currencyMint"
              }
            ]
          }
        },
        {
          name: "tokenAgentAssociatedAccount",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "tokenAgentPayments"
              },
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "currencyMint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "buybackAuthority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "tokenAgentPayments.mint",
                account: "tokenAgentPayments"
              }
            ]
          }
        },
        {
          name: "withdrawAuthority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "tokenAgentPayments.mint",
                account: "tokenAgentPayments"
              }
            ]
          }
        },
        {
          name: "buybackVault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "buybackAuthority"
              },
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "currencyMint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "withdrawVault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "withdrawAuthority"
              },
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "currencyMint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "tokenProgram"
        },
        {
          name: "associatedTokenProgram",
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          name: "systemProgram",
          address: "11111111111111111111111111111111"
        },
        {
          name: "eventAuthority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: []
    },
    {
      name: "agentInitialize",
      discriminator: [
        180,
        248,
        163,
        8,
        49,
        94,
        126,
        96
      ],
      accounts: [
        {
          name: "authority",
          writable: true,
          signer: true
        },
        {
          name: "bondingCurve",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "globalConfig",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "mint"
        },
        {
          name: "tokenAgentPayments",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "mint"
              }
            ]
          }
        },
        {
          name: "systemProgram",
          address: "11111111111111111111111111111111"
        },
        {
          name: "eventAuthority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: [
        {
          name: "authority",
          type: "pubkey"
        },
        {
          name: "buybackBps",
          type: "u16"
        }
      ]
    },
    {
      name: "agentUpdateAuthority",
      discriminator: [
        237,
        228,
        227,
        224,
        226,
        198,
        167,
        83
      ],
      accounts: [
        {
          name: "authority",
          writable: true,
          signer: true
        },
        {
          name: "globalConfig",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "tokenAgentPayments",
          writable: true
        },
        {
          name: "systemProgram",
          address: "11111111111111111111111111111111"
        },
        {
          name: "eventAuthority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: [
        {
          name: "newAuthority",
          type: "pubkey"
        }
      ]
    },
    {
      name: "agentUpdateBuybackBps",
      discriminator: [
        41,
        28,
        118,
        90,
        53,
        24,
        63,
        160
      ],
      accounts: [
        {
          name: "authority",
          writable: true,
          signer: true
        },
        {
          name: "tokenAgentPayments",
          writable: true
        },
        {
          name: "globalConfig",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "eventAuthority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: [
        {
          name: "buybackBps",
          type: "u16"
        }
      ]
    },
    {
      name: "agentWithdraw",
      discriminator: [
        13,
        149,
        99,
        245,
        171,
        171,
        185,
        53
      ],
      accounts: [
        {
          name: "authority",
          writable: true,
          signer: true
        },
        {
          name: "tokenAgentPayments"
        },
        {
          name: "currencyMint"
        },
        {
          name: "withdrawAuthority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "tokenAgentPayments.mint",
                account: "tokenAgentPayments"
              }
            ]
          }
        },
        {
          name: "withdrawVault",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "account",
                path: "withdrawAuthority"
              },
              {
                kind: "const",
                value: [
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
                ]
              },
              {
                kind: "account",
                path: "currencyMint"
              }
            ],
            program: {
              kind: "const",
              value: [
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
              ]
            }
          }
        },
        {
          name: "receiverAta",
          writable: true
        },
        {
          name: "tokenProgram"
        },
        {
          name: "associatedTokenProgram",
          address: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          name: "systemProgram",
          address: "11111111111111111111111111111111"
        },
        {
          name: "eventAuthority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: []
    },
    {
      name: "closeAccount",
      discriminator: [
        125,
        255,
        149,
        14,
        110,
        34,
        72,
        24
      ],
      accounts: [
        {
          name: "account",
          writable: true
        },
        {
          name: "user",
          writable: true,
          signer: true
        },
        {
          name: "globalConfig",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "systemProgram",
          address: "11111111111111111111111111111111"
        }
      ],
      args: []
    },
    {
      name: "extendAccount",
      discriminator: [
        234,
        102,
        194,
        203,
        150,
        72,
        62,
        229
      ],
      accounts: [
        {
          name: "account",
          writable: true
        },
        {
          name: "user",
          writable: true,
          signer: true
        },
        {
          name: "systemProgram",
          address: "11111111111111111111111111111111"
        },
        {
          name: "eventAuthority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: []
    },
    {
      name: "globalAddNewCurrency",
      discriminator: [
        46,
        135,
        47,
        120,
        118,
        204,
        177,
        224
      ],
      accounts: [
        {
          name: "authority",
          writable: true,
          signer: true
        },
        {
          name: "globalConfig",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "mint"
        },
        {
          name: "eventAuthority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: []
    },
    {
      name: "globalConfigInitialize",
      discriminator: [
        61,
        23,
        208,
        192,
        232,
        52,
        8,
        66
      ],
      accounts: [
        {
          name: "authority",
          writable: true,
          signer: true
        },
        {
          name: "globalConfig",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "systemProgram",
          address: "11111111111111111111111111111111"
        },
        {
          name: "eventAuthority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: [
        {
          name: "protocolAuthority",
          type: "pubkey"
        },
        {
          name: "buybackAuthority",
          type: "pubkey"
        }
      ]
    },
    {
      name: "globalUpdateAuthorities",
      discriminator: [
        91,
        137,
        72,
        77,
        183,
        184,
        168,
        125
      ],
      accounts: [
        {
          name: "authority",
          writable: true,
          signer: true
        },
        {
          name: "globalConfig",
          writable: true,
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "eventAuthority",
          pda: {
            seeds: [
              {
                kind: "const",
                value: [
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
                ]
              }
            ]
          }
        },
        {
          name: "program"
        }
      ],
      args: [
        {
          name: "protocolAuthority",
          type: {
            option: "pubkey"
          }
        },
        {
          name: "buybackAuthority",
          type: {
            option: "pubkey"
          }
        }
      ]
    }
  ],
  accounts: [
    {
      name: "bondingCurve",
      discriminator: [
        23,
        183,
        248,
        55,
        96,
        216,
        172,
        96
      ]
    },
    {
      name: "globalConfig",
      discriminator: [
        149,
        8,
        156,
        202,
        160,
        252,
        176,
        217
      ]
    },
    {
      name: "tokenAgentPaymentInCurrency",
      discriminator: [
        225,
        195,
        81,
        227,
        115,
        43,
        25,
        177
      ]
    },
    {
      name: "tokenAgentPayments",
      discriminator: [
        136,
        241,
        242,
        217,
        173,
        77,
        112,
        186
      ]
    }
  ],
  events: [
    {
      name: "agentAcceptPaymentEvent",
      discriminator: [
        114,
        190,
        188,
        192,
        105,
        79,
        41,
        147
      ]
    },
    {
      name: "agentBuybackTriggerEvent",
      discriminator: [
        139,
        240,
        9,
        225,
        214,
        63,
        232,
        165
      ]
    },
    {
      name: "agentDistributePaymentsEvent",
      discriminator: [
        137,
        116,
        114,
        140,
        54,
        111,
        230,
        26
      ]
    },
    {
      name: "agentInitializeEvent",
      discriminator: [
        192,
        5,
        183,
        151,
        0,
        64,
        100,
        207
      ]
    },
    {
      name: "agentUpdateAuthorityEvent",
      discriminator: [
        36,
        212,
        117,
        235,
        74,
        166,
        60,
        16
      ]
    },
    {
      name: "agentUpdateBuybackBpsEvent",
      discriminator: [
        165,
        251,
        40,
        19,
        114,
        26,
        128,
        232
      ]
    },
    {
      name: "agentWithdrawEvent",
      discriminator: [
        174,
        231,
        201,
        69,
        254,
        183,
        49,
        85
      ]
    },
    {
      name: "extendAccountEvent",
      discriminator: [
        97,
        97,
        215,
        144,
        93,
        146,
        22,
        124
      ]
    },
    {
      name: "globalAddNewCurrencyEvent",
      discriminator: [
        130,
        202,
        37,
        248,
        241,
        182,
        233,
        35
      ]
    },
    {
      name: "globalConfigInitializeEvent",
      discriminator: [
        241,
        51,
        222,
        190,
        142,
        245,
        176,
        53
      ]
    },
    {
      name: "globalUpdateAuthoritiesEvent",
      discriminator: [
        82,
        27,
        22,
        232,
        53,
        66,
        35,
        207
      ]
    }
  ],
  errors: [
    {
      code: 6e3,
      name: "unauthorizedSigner",
      msg: "The given account is not authorized to execute this instruction."
    },
    {
      code: 6001,
      name: "currencyAlreadySupported",
      msg: "The given currency is already supported."
    },
    {
      code: 6002,
      name: "maxCurrenciesReached",
      msg: "The maximum number of currencies has been reached."
    },
    {
      code: 6003,
      name: "invalidBuybackBps",
      msg: "The buyback basis points is greater than 10000."
    },
    {
      code: 6004,
      name: "currencyNotSupported",
      msg: "The given currency is not supported."
    },
    {
      code: 6005,
      name: "mathOverflow",
      msg: "Math overflow."
    },
    {
      code: 6006,
      name: "invalidRemainingAccountAddress",
      msg: "The given remaining account address is invalid."
    },
    {
      code: 6007,
      name: "paymentVaultNotEmpty",
      msg: "The payment vault is not empty. Distribute the payments first."
    },
    {
      code: 6008,
      name: "invalidInvoiceAccount",
      msg: "The invoice account does not match the expected PDA seeds"
    },
    {
      code: 6009,
      name: "invalidProgramToInvoke",
      msg: "The program to invoke is not allowed."
    },
    {
      code: 6010,
      name: "invalidCallbackProgram",
      msg: "The callback program is invalid."
    },
    {
      code: 6011,
      name: "swapFailedAmountDidNotIncrease",
      msg: "The swap failed and the amount did not increase."
    },
    {
      code: 6012,
      name: "accountTypeNotSupported",
      msg: "The account type is not supported for extension."
    }
  ],
  types: [
    {
      name: "agentAcceptPaymentEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "user",
            type: "pubkey"
          },
          {
            name: "tokenizedAgentMint",
            type: "pubkey"
          },
          {
            name: "tokenAgentPayments",
            type: "pubkey"
          },
          {
            name: "currencyMint",
            type: "pubkey"
          },
          {
            name: "amount",
            type: "u64"
          },
          {
            name: "memo",
            type: "u64"
          },
          {
            name: "startTime",
            type: "i64"
          },
          {
            name: "endTime",
            type: "i64"
          },
          {
            name: "invoiceId",
            type: "pubkey"
          },
          {
            name: "agentPostBalance",
            type: "u64"
          },
          {
            name: "timestamp",
            type: "i64"
          }
        ]
      }
    },
    {
      name: "agentBuybackTriggerEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "tokenAgentPayments",
            type: "pubkey"
          },
          {
            name: "mint",
            type: "pubkey"
          },
          {
            name: "amountBurned",
            type: "u64"
          },
          {
            name: "swapProgram",
            type: "pubkey"
          },
          {
            name: "newTokensBoughtAndBurnedForCurrency",
            type: "u64"
          },
          {
            name: "timestamp",
            type: "i64"
          }
        ]
      }
    },
    {
      name: "agentDistributePaymentsEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "tokenAgentPayments",
            type: "pubkey"
          },
          {
            name: "currencyMint",
            type: "pubkey"
          },
          {
            name: "buybackBps",
            type: "u16"
          },
          {
            name: "buybackAmount",
            type: "u64"
          },
          {
            name: "withdrawAmount",
            type: "u64"
          },
          {
            name: "timestamp",
            type: "i64"
          }
        ]
      }
    },
    {
      name: "agentInitializeEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "tokenAgentPayments",
            type: "pubkey"
          },
          {
            name: "mint",
            type: "pubkey"
          },
          {
            name: "authority",
            type: "pubkey"
          },
          {
            name: "buybackBps",
            type: "u16"
          },
          {
            name: "timestamp",
            type: "i64"
          },
          {
            name: "tokenizedAgentSequence",
            type: "u64"
          }
        ]
      }
    },
    {
      name: "agentUpdateAuthorityEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "tokenAgentPayments",
            type: "pubkey"
          },
          {
            name: "oldAuthority",
            type: "pubkey"
          },
          {
            name: "newAuthority",
            type: "pubkey"
          },
          {
            name: "timestamp",
            type: "i64"
          }
        ]
      }
    },
    {
      name: "agentUpdateBuybackBpsEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "tokenAgentPayments",
            type: "pubkey"
          },
          {
            name: "mint",
            type: "pubkey"
          },
          {
            name: "oldBuybackBps",
            type: "u16"
          },
          {
            name: "newBuybackBps",
            type: "u16"
          },
          {
            name: "timestamp",
            type: "i64"
          }
        ]
      }
    },
    {
      name: "agentWithdrawEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "tokenAgentPayments",
            type: "pubkey"
          },
          {
            name: "currencyMint",
            type: "pubkey"
          },
          {
            name: "amount",
            type: "u64"
          },
          {
            name: "receiver",
            type: "pubkey"
          },
          {
            name: "timestamp",
            type: "i64"
          }
        ]
      }
    },
    {
      name: "bondingCurve",
      type: {
        kind: "struct",
        fields: [
          {
            name: "virtualTokenReserves",
            type: "u64"
          },
          {
            name: "virtualSolReserves",
            type: "u64"
          },
          {
            name: "realTokenReserves",
            type: "u64"
          },
          {
            name: "realSolReserves",
            type: "u64"
          },
          {
            name: "tokenTotalSupply",
            type: "u64"
          },
          {
            name: "complete",
            type: "bool"
          },
          {
            name: "creator",
            type: "pubkey"
          },
          {
            name: "isMayhemMode",
            type: "bool"
          }
        ]
      }
    },
    {
      name: "extendAccountEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "account",
            type: "pubkey"
          },
          {
            name: "user",
            type: "pubkey"
          },
          {
            name: "currentSize",
            type: "u64"
          },
          {
            name: "newSize",
            type: "u64"
          },
          {
            name: "timestamp",
            type: "i64"
          }
        ]
      }
    },
    {
      name: "globalAddNewCurrencyEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "globalConfig",
            type: "pubkey"
          },
          {
            name: "currencyMint",
            type: "pubkey"
          },
          {
            name: "timestamp",
            type: "i64"
          }
        ]
      }
    },
    {
      name: "globalConfig",
      type: {
        kind: "struct",
        fields: [
          {
            name: "bump",
            type: "u8"
          },
          {
            name: "protocolAuthority",
            type: "pubkey"
          },
          {
            name: "buybackAuthority",
            type: "pubkey"
          },
          {
            name: "supportedCurrenciesMint",
            type: {
              array: [
                "pubkey",
                10
              ]
            }
          },
          {
            name: "tokenizedAgentSequence",
            type: "u64"
          }
        ]
      }
    },
    {
      name: "globalConfigInitializeEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "globalConfig",
            type: "pubkey"
          },
          {
            name: "protocolAuthority",
            type: "pubkey"
          },
          {
            name: "buybackAuthority",
            type: "pubkey"
          },
          {
            name: "timestamp",
            type: "i64"
          }
        ]
      }
    },
    {
      name: "globalUpdateAuthoritiesEvent",
      type: {
        kind: "struct",
        fields: [
          {
            name: "globalConfig",
            type: "pubkey"
          },
          {
            name: "protocolAuthority",
            type: {
              option: "pubkey"
            }
          },
          {
            name: "buybackAuthority",
            type: {
              option: "pubkey"
            }
          },
          {
            name: "timestamp",
            type: "i64"
          }
        ]
      }
    },
    {
      name: "tokenAgentPaymentInCurrency",
      type: {
        kind: "struct",
        fields: [
          {
            name: "mint",
            type: "pubkey"
          },
          {
            name: "currencyMint",
            type: "pubkey"
          },
          {
            name: "totalInvoicePaymentsMade",
            type: "u64"
          },
          {
            name: "totalBuyback",
            type: "u64"
          },
          {
            name: "totalWithdrawals",
            type: "u64"
          },
          {
            name: "tokensBoughtBackAndBurned",
            type: "u64"
          }
        ]
      }
    },
    {
      name: "tokenAgentPayments",
      type: {
        kind: "struct",
        fields: [
          {
            name: "bump",
            type: "u8"
          },
          {
            name: "mint",
            type: "pubkey"
          },
          {
            name: "authority",
            type: "pubkey"
          },
          {
            name: "buybackBps",
            type: "u16"
          }
        ]
      }
    }
  ]
};

// src/solana/legacy-agent-payments/program.ts
var IDL = idl_default;
var NOOP_WALLET = {
  publicKey: web3_js.PublicKey.default,
  signTransaction: () => Promise.reject(new Error("read-only wallet")),
  signAllTransactions: () => Promise.reject(new Error("read-only wallet"))
};
function getLegacyPumpProgram(connection) {
  return new anchor.Program(
    IDL,
    new anchor.AnchorProvider(connection, NOOP_WALLET, {})
  );
}
function getLegacyOfflineProgram() {
  return new anchor.Program(
    IDL,
    new anchor.AnchorProvider(
      { commitment: "processed" },
      NOOP_WALLET,
      {}
    )
  );
}
var OFFLINE_PUMP_PROGRAM2 = getLegacyOfflineProgram();
function getLegacyPumpProgramWithFallback(connection) {
  return connection ? getLegacyPumpProgram(connection) : OFFLINE_PUMP_PROGRAM2;
}
function decodeLegacyGlobalConfig(data) {
  return OFFLINE_PUMP_PROGRAM2.coder.accounts.decode("globalConfig", data);
}
function decodeLegacyTokenAgentPaymentInCurrency(data) {
  return OFFLINE_PUMP_PROGRAM2.coder.accounts.decode(
    "tokenAgentPaymentInCurrency",
    data
  );
}
function decodeLegacyTokenAgentPayments(data) {
  return OFFLINE_PUMP_PROGRAM2.coder.accounts.decode("tokenAgentPayments", data);
}
var toBn = (v) => anchor.BN.isBN(v) ? v : new anchor.BN(v.toString());
var LegacyPumpAgentOffline = class _LegacyPumpAgentOffline {
  constructor(mint, program) {
    this.mint = mint;
    this.program = program ?? getLegacyPumpProgramWithFallback();
  }
  static load(mint, connection) {
    return new _LegacyPumpAgentOffline(
      mint,
      getLegacyPumpProgramWithFallback(connection)
    );
  }
  async create(params) {
    const { authority, mint, agentAuthority, buybackBps } = params;
    const [bondingCurve] = getBondingCurvePDA2(mint);
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA2(mint);
    return this.program.methods.agentInitialize(agentAuthority, buybackBps).accountsPartial({
      authority,
      bondingCurve,
      mint,
      tokenAgentPayments
    }).instruction();
  }
  async withdraw(params) {
    const { authority, currencyMint, receiverAta, tokenProgram } = params;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA2(this.mint);
    const [withdrawAuthority] = getWithdrawAuthorityPDA2(this.mint);
    const withdrawVault = splToken.getAssociatedTokenAddressSync(
      currencyMint,
      withdrawAuthority,
      true
    );
    return this.program.methods.agentWithdraw().accountsPartial({
      authority,
      tokenAgentPayments,
      currencyMint,
      withdrawAuthority,
      withdrawVault,
      receiverAta,
      tokenProgram: tokenProgram ?? splToken.TOKEN_PROGRAM_ID
    }).instruction();
  }
  /**
   * `agent_update_buyback_bps` — when the global config has supported
   * currencies, each currency's payment-vault ATA must be passed as a
   * remaining account. The 1.0.7 SDK fetched `globalConfig` from chain when
   * called via the connection-bound `LegacyPumpAgent`; for the offline
   * flow you must supply `supportedCurrenciesMint` yourself.
   */
  async updateBuybackBps(params, options) {
    const { authority, buybackBps } = params;
    const supportedCurrenciesMint = options?.supportedCurrenciesMint;
    if (!supportedCurrenciesMint) {
      throw new Error(
        "LegacyPumpAgentOffline.updateBuybackBps requires options.supportedCurrenciesMint."
      );
    }
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA2(this.mint);
    const [globalConfig] = getGlobalConfigPDA2();
    const remainingAccounts = supportedCurrenciesMint.filter((m) => !m.equals(web3_js.PublicKey.default)).map((mint) => ({
      pubkey: splToken.getAssociatedTokenAddressSync(mint, tokenAgentPayments, true),
      isWritable: false,
      isSigner: false
    }));
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
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA2(this.mint);
    const [globalConfig] = getGlobalConfigPDA2();
    const [tokenAgentPaymentInCurrency] = getPaymentInCurrencyPDA2(
      this.mint,
      currencyMint
    );
    const [invoiceId] = getInvoiceIdPDA2(
      this.mint,
      currencyMint,
      amount,
      memo,
      startTime,
      endTime
    );
    const tokenAgentAssociatedAccount = splToken.getAssociatedTokenAddressSync(
      currencyMint,
      tokenAgentPayments,
      true
    );
    return this.program.methods.agentAcceptPayment(amount, memo, startTime, endTime).accountsPartial({
      user,
      userTokenAccount,
      tokenAgentPayments,
      tokenAgentAssociatedAccount,
      tokenAgentPaymentInCurrency,
      globalConfig,
      invoiceId,
      currencyMint,
      tokenProgram: tokenProgram ?? splToken.TOKEN_PROGRAM_ID
    }).instruction();
  }
  async acceptPaymentSimple(params) {
    const { amount, memo, startTime, endTime, ...rest } = params;
    return this.acceptPayment({
      ...rest,
      amount: toBn(amount),
      memo: toBn(memo),
      startTime: toBn(startTime),
      endTime: toBn(endTime)
    });
  }
  async distributePayments(params) {
    const { user, currencyMint, tokenProgram } = params;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA2(this.mint);
    const [globalConfig] = getGlobalConfigPDA2();
    const [tokenAgentPaymentInCurrency] = getPaymentInCurrencyPDA2(
      this.mint,
      currencyMint
    );
    const [buybackAuthority] = getBuybackAuthorityPDA2(this.mint);
    const [withdrawAuthority] = getWithdrawAuthorityPDA2(this.mint);
    const tokenAgentAssociatedAccount = splToken.getAssociatedTokenAddressSync(
      currencyMint,
      tokenAgentPayments,
      true
    );
    const buybackVault = splToken.getAssociatedTokenAddressSync(
      currencyMint,
      buybackAuthority,
      true
    );
    const withdrawVault = splToken.getAssociatedTokenAddressSync(
      currencyMint,
      withdrawAuthority,
      true
    );
    return this.program.methods.agentDistributePayments().accountsPartial({
      user,
      globalConfig,
      currencyMint,
      tokenAgentPayments,
      tokenAgentPaymentInCurrency,
      tokenAgentAssociatedAccount,
      buybackAuthority,
      withdrawAuthority,
      buybackVault,
      withdrawVault,
      tokenProgram: tokenProgram ?? splToken.TOKEN_PROGRAM_ID
    }).instruction();
  }
  async buybackTrigger(params) {
    const {
      globalBuybackAuthority,
      currencyMint,
      swapProgramToInvoke,
      swapInstructionData,
      remainingAccounts,
      tokenProgram
    } = params;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA2(this.mint);
    const [globalConfig] = getGlobalConfigPDA2();
    const [burnAuthority] = getBuybackAuthorityPDA2(this.mint);
    const [tokenAgentPaymentInCurrency] = getPaymentInCurrencyPDA2(
      this.mint,
      currencyMint
    );
    const burnMintVault = splToken.getAssociatedTokenAddressSync(
      this.mint,
      burnAuthority,
      true
    );
    return this.program.methods.agentBuybackTrigger(swapInstructionData).accountsPartial({
      globalBuybackAuthority,
      mint: this.mint,
      tokenAgentPayments,
      tokenAgentPaymentInCurrency,
      currencyMint,
      globalConfig,
      swapProgramToInvoke,
      burnAuthority,
      burnMintVault,
      tokenProgram: tokenProgram ?? splToken.TOKEN_PROGRAM_ID
    }).remainingAccounts(remainingAccounts).instruction();
  }
  async extendAccount(params) {
    const { account, user } = params;
    return this.program.methods.extendAccount().accountsPartial({ account, user }).instruction();
  }
  async updateAuthority(params) {
    const { authority, newAuthority } = params;
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA2(this.mint);
    return this.program.methods.agentUpdateAuthority(newAuthority).accountsPartial({ authority, tokenAgentPayments }).instruction();
  }
};
var LegacyPumpAgent = class extends LegacyPumpAgentOffline {
  constructor(mint, connection) {
    super(mint, getLegacyPumpProgramWithFallback(connection));
    this.connection = connection;
  }
  async getBalances(currencyMint) {
    const [tokenAgentPayments] = getTokenAgentPaymentsPDA2(this.mint);
    const [buybackAuthority] = getBuybackAuthorityPDA2(this.mint);
    const [withdrawAuthority] = getWithdrawAuthorityPDA2(this.mint);
    const paymentAta = splToken.getAssociatedTokenAddressSync(
      currencyMint,
      tokenAgentPayments,
      true
    );
    const buybackAta = splToken.getAssociatedTokenAddressSync(
      currencyMint,
      buybackAuthority,
      true
    );
    const withdrawAta = splToken.getAssociatedTokenAddressSync(
      currencyMint,
      withdrawAuthority,
      true
    );
    const fetchBalance = async (ata) => {
      try {
        const res = await this.connection.getTokenAccountBalance(ata);
        return BigInt(res.value.amount);
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
      paymentVault: { address: paymentAta, balance: paymentBal },
      buybackVault: { address: buybackAta, balance: buybackBal },
      withdrawVault: { address: withdrawAta, balance: withdrawBal }
    };
  }
  /**
   * Override of `LegacyPumpAgentOffline.updateBuybackBps` that auto-fetches
   * the supported currencies list from the on-chain `globalConfig` when not
   * provided. Mirrors the 1.0.7 SDK's connection-bound behavior.
   */
  async updateBuybackBps(params, options) {
    let supportedCurrenciesMint = options?.supportedCurrenciesMint;
    if (!supportedCurrenciesMint) {
      const [globalConfigPda] = getGlobalConfigPDA2();
      const account = await this.program.account.globalConfig.fetch(globalConfigPda);
      supportedCurrenciesMint = account.supportedCurrenciesMint;
    }
    return super.updateBuybackBps(params, { supportedCurrenciesMint });
  }
};
var BUYBACK_FEE_RECIPIENTS = [
  "5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD",
  "9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7",
  "GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL",
  "3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR",
  "5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6",
  "EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL",
  "5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD",
  "A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW"
].map((s) => new web3_js.PublicKey(s));
function pickBuybackFeeRecipient() {
  return BUYBACK_FEE_RECIPIENTS[Math.floor(Math.random() * BUYBACK_FEE_RECIPIENTS.length)];
}
function pickFeeRecipient(global, mayhemMode) {
  const pool = mayhemMode ? [global.reservedFeeRecipient, ...global.reservedFeeRecipients] : [global.feeRecipient, ...global.feeRecipients];
  return pool[Math.floor(Math.random() * pool.length)];
}

// src/solana/PumpTradeClient.ts
var CoinGraduatedError = class extends Error {
  constructor(mint) {
    super(
      `Bonding curve for mint ${mint.toBase58()} is complete \u2014 use AMM instead.`
    );
    this.name = "CoinGraduatedError";
  }
};
var CoinNotFoundError = class extends Error {
  constructor(mint) {
    super(`Bonding curve account not found for mint ${mint.toBase58()}.`);
    this.name = "CoinNotFoundError";
  }
};
var InsufficientLiquidityError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "InsufficientLiquidityError";
  }
};
var UnsupportedQuoteMintError = class extends Error {
  constructor(quoteMint) {
    super(
      `Quote mint ${quoteMint.toBase58()} is not owned by TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID.`
    );
    this.name = "UnsupportedQuoteMintError";
  }
};
var USDC_MINT2 = new web3_js.PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
var KNOWN_TOKEN_PROGRAMS = /* @__PURE__ */ new Set([
  splToken.TOKEN_PROGRAM_ID.toBase58(),
  splToken.TOKEN_2022_PROGRAM_ID.toBase58()
]);
function resolveQuoteMintFromCurve(quoteMintOnChain) {
  if (!quoteMintOnChain || quoteMintOnChain.equals(web3_js.PublicKey.default)) {
    return splToken.NATIVE_MINT;
  }
  return quoteMintOnChain;
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function computePriceImpactPct(quoteAmount, marketCap) {
  if (marketCap.isZero()) return 0;
  return clamp(quoteAmount.toNumber() / marketCap.toNumber() * 100, 0, 100);
}
var PumpTradeClient = class {
  constructor(connection) {
    this.connection = connection;
    /** quoteMint never changes once a coin is created — safe to cache forever. */
    this.quoteMintCache = /* @__PURE__ */ new Map();
    /** Token program for a quote mint (also stable after mint creation). */
    this.tokenProgramCache = /* @__PURE__ */ new Map();
  }
  // ── resolveQuoteMint ────────────────────────────────────────────────────────
  /** Read bondingCurve.quoteMint from chain, normalize default → NATIVE_MINT. Caches. */
  async resolveQuoteMint(mint) {
    const key = mint.toBase58();
    const cached = this.quoteMintCache.get(key);
    if (cached) return cached;
    const info = await this.connection.getAccountInfo(pumpSdk.bondingCurvePda(mint));
    if (!info) throw new CoinNotFoundError(mint);
    const curve = pumpSdk.PUMP_SDK.decodeBondingCurve(info);
    const resolved = resolveQuoteMintFromCurve(curve.quoteMint);
    this.quoteMintCache.set(key, resolved);
    return resolved;
  }
  // ── quoteForBuy ─────────────────────────────────────────────────────────────
  async quoteForBuy(params) {
    const { mint, quoteAmount } = params;
    const slippage = params.slippagePct ?? 5;
    const {
      global,
      feeConfig,
      bondingCurve,
      quoteMint,
      quoteTokenProgram
    } = await this._fetchAndDecode(mint);
    const mintSupply = bondingCurve.tokenTotalSupply;
    const expectedBaseTokens = pumpSdk.getBuyTokenAmountFromSolAmount({
      global,
      feeConfig,
      mintSupply,
      bondingCurve,
      amount: quoteAmount
    });
    const preciseQuoteAmount = pumpSdk.getBuySolAmountFromTokenAmount({
      global,
      feeConfig,
      mintSupply,
      bondingCurve,
      amount: expectedBaseTokens
    });
    const maxQuoteCost = new anchor.BN(
      Math.ceil(preciseQuoteAmount.toNumber() * (1 + slippage / 100))
    );
    const marketCap = pumpSdk.bondingCurveMarketCap({
      mintSupply,
      virtualQuoteReserves: bondingCurve.virtualQuoteReserves,
      virtualTokenReserves: bondingCurve.virtualTokenReserves
    });
    return {
      quoteMint,
      quoteTokenProgram,
      quoteAmount,
      expectedBaseTokens,
      preciseQuoteAmount,
      maxQuoteCost,
      slippagePct: slippage,
      priceImpactPct: computePriceImpactPct(quoteAmount, marketCap)
    };
  }
  // ── quoteForSell ────────────────────────────────────────────────────────────
  async quoteForSell(params) {
    const { mint, baseAmount } = params;
    const slippage = params.slippagePct ?? 5;
    const {
      global,
      feeConfig,
      bondingCurve,
      quoteMint,
      quoteTokenProgram
    } = await this._fetchAndDecode(mint);
    const mintSupply = bondingCurve.tokenTotalSupply;
    const expectedQuoteOut = pumpSdk.getSellSolAmountFromTokenAmount({
      global,
      feeConfig,
      mintSupply,
      bondingCurve,
      amount: baseAmount
    });
    const minQuoteOut = new anchor.BN(
      Math.max(0, Math.floor(expectedQuoteOut.toNumber() * (1 - slippage / 100)))
    );
    const marketCap = pumpSdk.bondingCurveMarketCap({
      mintSupply,
      virtualQuoteReserves: bondingCurve.virtualQuoteReserves,
      virtualTokenReserves: bondingCurve.virtualTokenReserves
    });
    return {
      quoteMint,
      quoteTokenProgram,
      baseAmount,
      expectedQuoteOut,
      minQuoteOut,
      slippagePct: slippage,
      priceImpactPct: computePriceImpactPct(expectedQuoteOut, marketCap)
    };
  }
  // ── buildBuyInstructions ────────────────────────────────────────────────────
  async buildBuyInstructions(params) {
    const { mint, user, quoteAmount } = params;
    const slippage = params.slippagePct ?? 5;
    const baseTokenProgram = await this._baseTokenProgram(mint);
    const userAta = splToken.getAssociatedTokenAddressSync(mint, user, true, baseTokenProgram);
    const bcAddr = pumpSdk.bondingCurvePda(mint);
    const [globalInfo, feeConfigInfo, bcInfo, userAtaInfo] = await this.connection.getMultipleAccountsInfo([
      pumpSdk.GLOBAL_PDA,
      pumpSdk.PUMP_FEE_CONFIG_PDA,
      bcAddr,
      userAta
    ]);
    if (!globalInfo) throw new Error("Global account not found \u2014 wrong network?");
    if (!bcInfo) throw new CoinNotFoundError(mint);
    const global = pumpSdk.PUMP_SDK.decodeGlobal(globalInfo);
    const feeConfig = feeConfigInfo ? pumpSdk.PUMP_SDK.decodeFeeConfig(feeConfigInfo) : null;
    const bondingCurve = pumpSdk.PUMP_SDK.decodeBondingCurve(bcInfo);
    if (bondingCurve.complete) throw new CoinGraduatedError(mint);
    const quoteMint = resolveQuoteMintFromCurve(bondingCurve.quoteMint);
    this.quoteMintCache.set(mint.toBase58(), quoteMint);
    const quoteTokenProgram = await this._quoteTokenProgram(quoteMint);
    const mintSupply = bondingCurve.tokenTotalSupply;
    const expectedBaseTokens = pumpSdk.getBuyTokenAmountFromSolAmount({
      global,
      feeConfig,
      mintSupply,
      bondingCurve,
      amount: quoteAmount
    });
    if (expectedBaseTokens.lte(new anchor.BN(0))) {
      throw new InsufficientLiquidityError(
        "Computed token amount is zero \u2014 amount too small or reserves exhausted."
      );
    }
    const preciseQuoteAmount = pumpSdk.getBuySolAmountFromTokenAmount({
      global,
      feeConfig,
      mintSupply,
      bondingCurve,
      amount: expectedBaseTokens
    });
    const mayhemMode = bondingCurve.isMayhemMode ?? false;
    const feeRecipient = pickFeeRecipient(global, mayhemMode);
    const buybackFeeRecipient = pickBuybackFeeRecipient();
    const instructions = await pumpSdk.PUMP_SDK.buyV2Instructions({
      global,
      bondingCurveAccountInfo: bcInfo,
      bondingCurve,
      associatedUserAccountInfo: userAtaInfo ?? null,
      mint,
      user,
      amount: expectedBaseTokens,
      quoteAmount: preciseQuoteAmount,
      slippage,
      tokenProgram: baseTokenProgram,
      quoteTokenProgram
    });
    return {
      instructions,
      quoteMint,
      quoteTokenProgram,
      expectedBaseTokens,
      preciseQuoteAmount,
      feeRecipient,
      buybackFeeRecipient
    };
  }
  // ── buildSellInstructions ───────────────────────────────────────────────────
  async buildSellInstructions(params) {
    const { mint, user, baseAmount } = params;
    const slippage = params.slippagePct ?? 5;
    const baseTokenProgram = await this._baseTokenProgram(mint);
    const bcAddr = pumpSdk.bondingCurvePda(mint);
    const [globalInfo, feeConfigInfo, bcInfo] = await this.connection.getMultipleAccountsInfo([
      pumpSdk.GLOBAL_PDA,
      pumpSdk.PUMP_FEE_CONFIG_PDA,
      bcAddr
    ]);
    if (!globalInfo) throw new Error("Global account not found \u2014 wrong network?");
    if (!bcInfo) throw new CoinNotFoundError(mint);
    const global = pumpSdk.PUMP_SDK.decodeGlobal(globalInfo);
    const feeConfig = feeConfigInfo ? pumpSdk.PUMP_SDK.decodeFeeConfig(feeConfigInfo) : null;
    const bondingCurve = pumpSdk.PUMP_SDK.decodeBondingCurve(bcInfo);
    if (bondingCurve.complete) throw new CoinGraduatedError(mint);
    const quoteMint = resolveQuoteMintFromCurve(bondingCurve.quoteMint);
    this.quoteMintCache.set(mint.toBase58(), quoteMint);
    const quoteTokenProgram = await this._quoteTokenProgram(quoteMint);
    const mintSupply = bondingCurve.tokenTotalSupply;
    const expectedQuoteOut = pumpSdk.getSellSolAmountFromTokenAmount({
      global,
      feeConfig,
      mintSupply,
      bondingCurve,
      amount: baseAmount
    });
    const instructions = await pumpSdk.PUMP_SDK.sellV2Instructions({
      global,
      bondingCurveAccountInfo: bcInfo,
      bondingCurve,
      mint,
      user,
      amount: baseAmount,
      quoteAmount: expectedQuoteOut,
      slippage,
      tokenProgram: baseTokenProgram,
      quoteTokenProgram
    });
    return { instructions, quoteMint, quoteTokenProgram, expectedQuoteOut };
  }
  // ── buildBuyExactQuoteInInstructions ────────────────────────────────────────
  /**
   * Build buy_exact_quote_in_v2. Drives the Anchor program directly because
   * the SDK has no JS helper for this instruction. Mirrors
   * swap/scripts/build-buy-exact-quote-in-v2-tx.mjs exactly.
   */
  async buildBuyExactQuoteInInstructions(params) {
    const { mint, user, spendableQuoteIn, minBaseOut } = params;
    const baseTokenProgram = await this._baseTokenProgram(mint);
    const bcAddr = pumpSdk.bondingCurvePda(mint);
    const [globalInfo, _feeConfigInfo, bcInfo] = await this.connection.getMultipleAccountsInfo([
      pumpSdk.GLOBAL_PDA,
      pumpSdk.PUMP_FEE_CONFIG_PDA,
      bcAddr
    ]);
    if (!globalInfo) throw new Error("Global account not found \u2014 wrong network?");
    if (!bcInfo) throw new CoinNotFoundError(mint);
    const global = pumpSdk.PUMP_SDK.decodeGlobal(globalInfo);
    const bondingCurve = pumpSdk.PUMP_SDK.decodeBondingCurve(bcInfo);
    if (bondingCurve.complete) throw new CoinGraduatedError(mint);
    const quoteMint = resolveQuoteMintFromCurve(bondingCurve.quoteMint);
    this.quoteMintCache.set(mint.toBase58(), quoteMint);
    const quoteTokenProgram = await this._quoteTokenProgram(quoteMint);
    const creator = bondingCurve.creator;
    const mayhemMode = bondingCurve.isMayhemMode ?? false;
    const feeRecipient = pickFeeRecipient(global, mayhemMode);
    const buybackFeeRecipient = pickBuybackFeeRecipient();
    const ata = (owner, tkProg) => splToken.getAssociatedTokenAddressSync(quoteMint, owner, true, tkProg);
    const associatedQuoteFeeRecipient = ata(feeRecipient, quoteTokenProgram);
    const associatedQuoteBuybackFeeRecipient = ata(buybackFeeRecipient, quoteTokenProgram);
    const associatedBaseBondingCurve = splToken.getAssociatedTokenAddressSync(
      mint,
      bcAddr,
      true,
      baseTokenProgram
    );
    const associatedQuoteBondingCurve = ata(bcAddr, quoteTokenProgram);
    const associatedBaseUser = splToken.getAssociatedTokenAddressSync(
      mint,
      user,
      true,
      baseTokenProgram
    );
    const associatedQuoteUser = ata(user, quoteTokenProgram);
    const creatorVault = pumpSdk.creatorVaultPda(creator);
    const associatedCreatorVault = ata(creatorVault, quoteTokenProgram);
    const userVolAcc = pumpSdk.userVolumeAccumulatorPda(user);
    const associatedUserVolumeAccumulator = ata(userVolAcc, quoteTokenProgram);
    const program = pumpSdk.getPumpProgram(this.connection);
    const buyExactIx = await program.methods.buyExactQuoteInV2(spendableQuoteIn, minBaseOut).accountsPartial({
      global: pumpSdk.GLOBAL_PDA,
      baseMint: mint,
      quoteMint,
      baseTokenProgram,
      quoteTokenProgram,
      associatedTokenProgram: splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
      feeRecipient,
      associatedQuoteFeeRecipient,
      buybackFeeRecipient,
      associatedQuoteBuybackFeeRecipient,
      bondingCurve: bcAddr,
      associatedBaseBondingCurve,
      associatedQuoteBondingCurve,
      user,
      associatedBaseUser,
      associatedQuoteUser,
      creatorVault,
      associatedCreatorVault,
      sharingConfig: pumpSdk.feeSharingConfigPda(mint),
      globalVolumeAccumulator: pumpSdk.GLOBAL_VOLUME_ACCUMULATOR_PDA,
      userVolumeAccumulator: userVolAcc,
      associatedUserVolumeAccumulator,
      feeConfig: pumpSdk.PUMP_FEE_CONFIG_PDA,
      feeProgram: pumpSdk.PUMP_FEE_PROGRAM_ID,
      systemProgram: web3_js.SystemProgram.programId,
      eventAuthority: pumpSdk.PUMP_EVENT_AUTHORITY_PDA,
      program: pumpSdk.PUMP_PROGRAM_ID
    }).instruction();
    const isNative = quoteMint.equals(splToken.NATIVE_MINT);
    const ataIxs = [
      splToken.createAssociatedTokenAccountIdempotentInstruction(
        user,
        associatedBaseUser,
        user,
        mint,
        baseTokenProgram
      ),
      ...isNative ? [] : [
        splToken.createAssociatedTokenAccountIdempotentInstruction(
          user,
          associatedQuoteUser,
          user,
          quoteMint,
          quoteTokenProgram
        )
      ]
    ];
    return {
      instructions: [...ataIxs, buyExactIx],
      quoteMint,
      quoteTokenProgram
    };
  }
  // ── buildClaimCashbackInstructions ──────────────────────────────────────────
  /**
   * Auto-discovers claimable quote mints by calling getTokenAccountsByOwner on
   * the UserVolumeAccumulator PDA. Any non-zero ATA → claimable cashback.
   * Pass quoteMints to skip discovery.
   */
  async buildClaimCashbackInstructions(params) {
    const { user } = params;
    let quoteMints = params.quoteMints;
    if (!quoteMints) {
      quoteMints = await this._discoverCashbackMints(user);
    }
    const ixs = [];
    for (const quoteMint of quoteMints) {
      const quoteTokenProgram = await this._quoteTokenProgram(quoteMint);
      ixs.push(
        await pumpSdk.PUMP_SDK.claimCashbackV2Instruction({
          user,
          quoteMint,
          quoteTokenProgram
        })
      );
    }
    return ixs;
  }
  // ── Private helpers ─────────────────────────────────────────────────────────
  async _discoverCashbackMints(user) {
    const userVolAcc = pumpSdk.userVolumeAccumulatorPda(user);
    const [splResult, t22Result] = await Promise.all([
      this.connection.getTokenAccountsByOwner(userVolAcc, {
        programId: splToken.TOKEN_PROGRAM_ID
      }),
      this.connection.getTokenAccountsByOwner(userVolAcc, {
        programId: splToken.TOKEN_2022_PROGRAM_ID
      })
    ]);
    const mints = [];
    for (const { account } of [...splResult.value, ...t22Result.value]) {
      const mintPk = new web3_js.PublicKey(account.data.slice(0, 32));
      const amount = account.data.readBigUInt64LE(64);
      if (amount > 0n) mints.push(mintPk);
    }
    return mints;
  }
  async _baseTokenProgram(mint) {
    const cacheKey = `base:${mint.toBase58()}`;
    const cached = this.tokenProgramCache.get(cacheKey);
    if (cached) return cached;
    const info = await this.connection.getAccountInfo(mint);
    if (!info) throw new Error(`Mint account not found: ${mint.toBase58()}`);
    const program = KNOWN_TOKEN_PROGRAMS.has(info.owner.toBase58()) ? info.owner : splToken.TOKEN_PROGRAM_ID;
    this.tokenProgramCache.set(cacheKey, program);
    return program;
  }
  async _quoteTokenProgram(quoteMint) {
    if (quoteMint.equals(splToken.NATIVE_MINT)) return splToken.TOKEN_PROGRAM_ID;
    const key = quoteMint.toBase58();
    const cached = this.tokenProgramCache.get(key);
    if (cached) return cached;
    const info = await this.connection.getAccountInfo(quoteMint, "confirmed");
    if (!info) throw new Error(`Quote mint not found: ${quoteMint.toBase58()}`);
    if (!KNOWN_TOKEN_PROGRAMS.has(info.owner.toBase58())) {
      throw new UnsupportedQuoteMintError(quoteMint);
    }
    this.tokenProgramCache.set(key, info.owner);
    return info.owner;
  }
  /**
   * Convenience: fetch + decode + throw in one call for quote methods.
   * Does NOT batch with userAta (quote methods don't need it).
   */
  async _fetchAndDecode(mint) {
    const bcAddr = pumpSdk.bondingCurvePda(mint);
    const [globalInfo, feeConfigInfo, bcInfo] = await this.connection.getMultipleAccountsInfo([
      pumpSdk.GLOBAL_PDA,
      pumpSdk.PUMP_FEE_CONFIG_PDA,
      bcAddr
    ]);
    if (!globalInfo) throw new Error("Global account not found \u2014 wrong network?");
    if (!bcInfo) throw new CoinNotFoundError(mint);
    const global = pumpSdk.PUMP_SDK.decodeGlobal(globalInfo);
    const feeConfig = feeConfigInfo ? pumpSdk.PUMP_SDK.decodeFeeConfig(feeConfigInfo) : null;
    const bondingCurve = pumpSdk.PUMP_SDK.decodeBondingCurve(bcInfo);
    if (bondingCurve.complete) throw new CoinGraduatedError(mint);
    const quoteMint = resolveQuoteMintFromCurve(bondingCurve.quoteMint);
    this.quoteMintCache.set(mint.toBase58(), quoteMint);
    const quoteTokenProgram = await this._quoteTokenProgram(quoteMint);
    return { global, feeConfig, bondingCurve, quoteMint, quoteTokenProgram };
  }
};
/** Exported for convenience; USDC mainnet address. */
PumpTradeClient.USDC_MINT = USDC_MINT2;

// src/solana/index.ts
var PUMP_AGENT_PAYMENTS_PROGRAM_ID = new web3_js.PublicKey(pump_agent_payments_default.address);
function getProgram(connection) {
  return getPumpProgram(connection);
}

exports.BONDING_CURVE_SEED = BONDING_CURVE_SEED;
exports.BUYBACK_AUTHORITY_SEED = BUYBACK_AUTHORITY_SEED;
exports.CoinGraduatedError = CoinGraduatedError;
exports.CoinNotFoundError = CoinNotFoundError;
exports.CurrencyNotSupportedError = CurrencyNotSupportedError;
exports.GLOBAL_CONFIG_SEED = GLOBAL_CONFIG_SEED;
exports.INVOICE_ID_SEED = INVOICE_ID_SEED;
exports.InsufficientLiquidityError = InsufficientLiquidityError;
exports.JupiterUnavailableError = JupiterUnavailableError;
exports.OFFLINE_PUMP_PROGRAM = OFFLINE_PUMP_PROGRAM;
exports.PAYMENT_IN_CURRENCY_SEED = PAYMENT_IN_CURRENCY_SEED;
exports.PROGRAM_ID = PROGRAM_ID;
exports.PUMP_AGENT_PAYMENTS_PROGRAM_ID = PUMP_AGENT_PAYMENTS_PROGRAM_ID;
exports.PUMP_FEES_PROGRAM_ID = PUMP_FEES_PROGRAM_ID;
exports.PUMP_PROGRAM_ID = PUMP_PROGRAM_ID;
exports.PumpAgent = PumpAgent;
exports.PumpAgentOffline = PumpAgentOffline;
exports.PumpAgentPaymentsPlugin = PumpAgentPaymentsPlugin;
exports.PumpTradeClient = PumpTradeClient;
exports.SHARING_CONFIG_SEED = SHARING_CONFIG_SEED;
exports.TOKEN_AGENT_PAYMENTS_MIN_RENT_EXEMPT_LAMPORTS = TOKEN_AGENT_PAYMENTS_MIN_RENT_EXEMPT_LAMPORTS;
exports.TOKEN_AGENT_PAYMENTS_SEED = TOKEN_AGENT_PAYMENTS_SEED;
exports.USDC_MINT = USDC_MINT;
exports.UnsupportedQuoteMintError = UnsupportedQuoteMintError;
exports.WITHDRAW_AUTHORITY_SEED = WITHDRAW_AUTHORITY_SEED;
exports.createEventParser = createEventParser;
exports.decodeBondingCurveQuoteMint = decodeBondingCurveQuoteMint;
exports.decodeGlobalConfig = decodeGlobalConfig;
exports.decodeTokenAgentPaymentInCurrency = decodeTokenAgentPaymentInCurrency;
exports.decodeTokenAgentPayments = decodeTokenAgentPayments;
exports.getBondingCurvePDA = getBondingCurvePDA;
exports.getBuybackAuthorityPDA = getBuybackAuthorityPDA;
exports.getGlobalConfigPDA = getGlobalConfigPDA;
exports.getInvoiceIdPDA = getInvoiceIdPDA;
exports.getOfflineProgram = getOfflineProgram;
exports.getPaymentInCurrencyPDA = getPaymentInCurrencyPDA;
exports.getProgram = getProgram;
exports.getPumpProgram = getPumpProgram;
exports.getPumpProgramWithFallback = getPumpProgramWithFallback;
exports.getSharingConfigPDA = getSharingConfigPDA;
exports.getTokenAgentPaymentsPDA = getTokenAgentPaymentsPDA;
exports.getWithdrawAuthorityPDA = getWithdrawAuthorityPDA;
exports.legacyAgentPayments = legacy_agent_payments_exports;
exports.parseAgentEvents = parseAgentEvents;
exports.pumpEvents = pump_events_exports;
exports.resolveTokenProgramForMint = resolveTokenProgramForMint;
exports.subscribeToAgentEvents = subscribeToAgentEvents;
exports.x402 = x402_exports;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map