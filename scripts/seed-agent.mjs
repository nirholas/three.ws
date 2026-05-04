import { neon } from '@neondatabase/serverless';

const sql = neon(
	'postgresql://neondb_owner:npg_4nWXZhq2Hjse@ep-rapid-surf-ak9p7occ-pooler.c-3.us-west-2.aws.neon.tech/neondb?channel_binding=require&sslmode=require',
);

const [user] = await sql`
	INSERT INTO users (email, display_name, email_verified)
	VALUES ('seed@3dagent.dev', 'Seed User', true)
	ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
	RETURNING id
`;

const [agent] = await sql`
	INSERT INTO agent_identities (user_id, name, description, home_url, persona_prompt)
	VALUES (${user.id}, 'Demo Agent', 'Seed agent for dev harness testing', 'https://three.ws', 'You are a helpful and friendly 3D agent.')
	RETURNING id
`;

console.log('user_id: ', user.id);
console.log('agent_id:', agent.id);
