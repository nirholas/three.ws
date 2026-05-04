// scripts/migrations/001_add_monetization_tables.mjs
import { sql } from '../../api/_lib/db.js';

async function migrate() {
  console.log('Running migration: 001_add_monetization_tables...');

  try {
    await sql.begin(async sql => {
      console.log('Creating table: agent_skill_prices...');
      await sql`
        CREATE TABLE IF NOT EXISTS agent_skill_prices (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            agent_id UUID NOT NULL,
            skill_name VARCHAR(255) NOT NULL,
            amount BIGINT NOT NULL CHECK (amount > 0),
            currency_mint VARCHAR(255) NOT NULL,
            billing_interval VARCHAR(50) DEFAULT 'one_time', -- For subscriptions
            trial_days INT DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            CONSTRAINT fk_agent
                FOREIGN KEY(agent_id)
                REFERENCES agent_identities(id)
                ON DELETE CASCADE,

            UNIQUE (agent_id, skill_name)
        );
      `;
      console.log('Table agent_skill_prices created.');

      console.log('Creating table: user_purchased_skills...');
      await sql`
        CREATE TABLE IF NOT EXISTS user_purchased_skills (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL,
            agent_id UUID NOT NULL,
            skill_name VARCHAR(255) NOT NULL,
            purchase_tx_signature VARCHAR(128) NOT NULL,
            price_amount BIGINT NOT NULL,
            price_currency_mint VARCHAR(255) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            CONSTRAINT fk_user
                FOREIGN KEY(user_id)
                REFERENCES users(id)
                ON DELETE CASCADE,

            CONSTRAINT fk_agent
                FOREIGN KEY(agent_id)
                REFERENCES agent_identities(id)
                ON DELETE CASCADE,

            UNIQUE (user_id, agent_id, skill_name)
        );
      `;
      console.log('Table user_purchased_skills created.');
    });

    console.log('Migration completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();
