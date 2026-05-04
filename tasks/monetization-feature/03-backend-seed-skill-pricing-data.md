---
status: not-started
---

# Prompt 3: Backend - Seed Skill Pricing Data

## Objective
Populate the database with sample data for free and paid skills to enable frontend development and testing.

## Explanation
With the `agent_skill_prices` table created, we now need some data to work with. A seed script will allow us to consistently create a set of test skills with and without prices. This is crucial for developers working on the UI to be able to see and test all variations of the design.

## Instructions
1.  **Create a Seed Script:**
    *   Create a new script in your `scripts/` directory (e.g., `seed-skills.mjs`).
    *   The script should connect to your database.
    *   It should first create a sample creator user and a few sample skills.
    *   Then, for some of those skills, it should insert corresponding entries into the `agent_skill_prices` table.
    *   Include at least one free skill (no entry in the prices table) and two paid skills with different prices.

2.  **Run the Script:**
    *   Execute the script to populate your local database.
    *   Make sure to document how to run the script in your project's `README.md`.

## Code Example (Node.js Seeding Script)

```javascript
// In scripts/seed-skills.mjs
import { db } from '../api/_lib/db.js'; // Adjust path to your db connection

async function main() {
  console.log('Seeding database...');

  // 1. Create a sample creator
  const { rows: [creator] } = await db.query(
    `INSERT INTO users (username, email) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET username = $1 RETURNING id`,
    ['skill_creator_1', 'creator1@three.ws']
  );
  console.log(`Created/found creator user: ${creator.id}`);

  // 2. Create some skills
  const { rows: [skill1] } = await db.query(
    `INSERT INTO skills (name, description, creator_id) VALUES ($1, $2, $3) RETURNING id`,
    ['Advanced Market Analysis', 'Provides deep insights into token velocity.', creator.id]
  );
  const { rows: [skill2] } = await db.query(
    `INSERT INTO skills (name, description, creator_id) VALUES ($1, $2, $3) RETURNING id`,
    ['Rug-Pull Detection', 'Flags high-risk tokens using on-chain data.', creator.id]
  );
  const { rows: [skill3] } = await db.query(
    `INSERT INTO skills (name, description, creator_id) VALUES ($1, $2, $3) RETURNING id`,
    ['Wave', 'A simple social emote.', creator.id] // This one will be free
  );
  console.log('Created sample skills.');

  // 3. Set prices for paid skills (USDC mint on Solana Mainnet)
  const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyB7u6a';

  await db.query(
    `INSERT INTO agent_skill_prices (skill_id, creator_id, amount, currency_mint)
     VALUES ($1, $2, $3, $4) ON CONFLICT (skill_id, creator_id) DO NOTHING`,
    [skill1.id, creator.id, 2_000_000, USDC_MINT] // 2 USDC
  );

  await db.query(
    `INSERT INTO agent_skill_prices (skill_id, creator_id, amount, currency_mint)
     VALUES ($1, $2, $3, $4) ON CONFLICT (skill_id, creator_id) DO NOTHING`,
    [skill2.id, creator.id, 5_000_000, USDC_MINT] // 5 USDC
  );
  console.log('Set prices for paid skills.');

  console.log('Seeding complete.');
  await db.end();
}

main().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
```
