import { AgentSkills } from '../src/agent-skills.js';
import { sql } from '../api/_lib/db.js';

async function seed() {
  const _noop = () => {};
  const _stub = { emit: _noop, on: _noop, off: _noop, add: _noop, query: () => [] };
  const skills = new AgentSkills(_stub, _stub).list();

  console.log(`Found ${skills.length} skills to seed.`);

  for (const skill of skills) {
    const { name, description, inputSchema, mcpExposed } = skill;

    // Don't add skills without a description
    if (!description) {
      console.warn(`Skipping skill "${name}" because it has no description.`);
      continue;
    }
    
    // Generate a slug from the name
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

    // Extract category from name, or default
    let category = 'utility';
    const nameParts = name.split('-');
    if (nameParts.length > 1) {
        category = nameParts[0];
    }

    const newSkill = {
      name,
      slug,
      description,
      category,
      is_public: true,
      schema_json: inputSchema ? [ { function: { name: name, parameters: inputSchema } } ] : null,
    };
    
    console.log(`Seeding skill: ${newSkill.name}`);
    
    try {
      await sql`
        insert into marketplace_skills (
          name, slug, description, category, is_public, schema_json
        ) values (
          ${newSkill.name}, ${newSkill.slug}, ${newSkill.description}, ${newSkill.category}, ${newSkill.is_public}, ${sql.json(newSkill.schema_json)}
        )
        on conflict (slug) do update set
          name = excluded.name,
          description = excluded.description,
          category = excluded.category,
          is_public = excluded.is_public,
          schema_json = excluded.schema_json,
          updated_at = now()
      `;
      console.log(`  -> Successfully seeded skill: ${newSkill.name}`);
    } catch (error) {
      console.error(`  -> Error seeding skill ${newSkill.name}:`, error);
    }
  }

  console.log('Seeding complete.');
  // close the database connection
  await sql.end();
}

seed().catch(err => {
  console.error("Seeding script failed:", err);
  process.exit(1);
});
