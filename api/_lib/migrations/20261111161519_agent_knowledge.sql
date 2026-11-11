-- Agent knowledge: Word, PowerPoint, Excel, PDF and Outlook files an agent's
-- owner uploads so the agent can answer from them (api/agents/[id]/knowledge.js,
-- api/_lib/agent-knowledge.js, docs/agent-knowledge.md).
--
-- The original file is never stored. workers/markitdown converts it to
-- Markdown, api/_lib/knowledge-chunker.js splits it into slide, sheet, page or
-- section chunks, and only those chunks plus their embeddings are kept.
-- Deleting a doc (or the agent) deletes every chunk through the cascade.
--
-- Embeddings live in a pgvector column with no fixed dimension, because the
-- embedding lanes differ (NIM 2048, Vertex 768, OpenAI 256). Each row records
-- the embedder that produced it, and queries filter on that tag before they
-- order by cosine distance, so only vectors from one space are ever compared.
-- Similarity runs in the database and only the top chunks come back, so a
-- chat turn never pulls every vector over the wire.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS agent_knowledge_docs (
	id           text PRIMARY KEY,
	agent_id     uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	uploaded_by  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name         text NOT NULL,
	kind         text NOT NULL CHECK (kind IN ('docx', 'pptx', 'xlsx', 'pdf', 'msg')),
	mime         text,
	byte_size    bigint NOT NULL CHECK (byte_size > 0),
	sha256       text NOT NULL,
	title        text,
	meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
	chunk_count  integer NOT NULL DEFAULT 0,
	token_count  integer NOT NULL DEFAULT 0,
	embedder     text NOT NULL,
	created_at   timestamptz NOT NULL DEFAULT now()
);

-- One copy of a given file per agent: a re-upload answers with the existing doc.
CREATE UNIQUE INDEX IF NOT EXISTS agent_knowledge_docs_agent_sha
	ON agent_knowledge_docs (agent_id, sha256);
CREATE INDEX IF NOT EXISTS agent_knowledge_docs_agent_created
	ON agent_knowledge_docs (agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_knowledge_chunks (
	id           bigserial PRIMARY KEY,
	doc_id       text NOT NULL REFERENCES agent_knowledge_docs(id) ON DELETE CASCADE,
	agent_id     uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	chunk_index  integer NOT NULL,
	heading      text,
	locator      text,
	content      text NOT NULL,
	token_count  integer NOT NULL,
	embedder     text NOT NULL,
	embedding    vector NOT NULL,
	UNIQUE (doc_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS agent_knowledge_chunks_agent_space
	ON agent_knowledge_chunks (agent_id, embedder);
