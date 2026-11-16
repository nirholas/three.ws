-- Layout-aware PDF knowledge extraction (api/_lib/knowledge-pdf-jobs.js,
-- api/_lib/pdf-extract.js, docs/agent-knowledge.md).
--
-- A PDF upload becomes a job instead of a synchronous request: every page is
-- rendered and read by NVIDIA NeMo Retriever models (page elements, table
-- structure, graphic elements, OCR), which takes seconds per page. The
-- uploading browser advances the job in short steps (POST .../step) and shows
-- per-page progress; /api/cron/knowledge-pdf-jobs resumes any job whose
-- browser went away. A lease (lease_until) keeps two steppers off one job.
--
-- The file bytes are held only while the job runs and are set to NULL the
-- moment it finishes or fails, so the original file is still never kept.
-- `blocks` holds the extracted page blocks until the document is indexed, and
-- `tables` is the preview the upload panel shows while pages come in.

CREATE TABLE IF NOT EXISTS agent_knowledge_jobs (
	id               text PRIMARY KEY,
	agent_id         uuid NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
	user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name             text NOT NULL,
	sha256           text NOT NULL,
	byte_size        bigint NOT NULL CHECK (byte_size > 0),
	file             bytea,
	status           text NOT NULL DEFAULT 'queued'
	                 CHECK (status IN ('queued', 'extracting', 'indexing', 'done', 'failed')),
	page_count       integer NOT NULL CHECK (page_count > 0),
	pages_done       integer NOT NULL DEFAULT 0,
	blocks           jsonb NOT NULL DEFAULT '[]'::jsonb,
	tables           jsonb NOT NULL DEFAULT '[]'::jsonb,
	stats            jsonb NOT NULL DEFAULT '{}'::jsonb,
	extractor        text NOT NULL DEFAULT 'nemotron',
	fallback_reason  text,
	error_code       text,
	error            text,
	attempts         integer NOT NULL DEFAULT 0,
	doc_id           text REFERENCES agent_knowledge_docs(id) ON DELETE SET NULL,
	lease_until      timestamptz,
	created_at       timestamptz NOT NULL DEFAULT now(),
	updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One in-flight job per file per agent: a second upload of the same PDF while
-- the first is still processing answers with the running job.
CREATE UNIQUE INDEX IF NOT EXISTS agent_knowledge_jobs_active_sha
	ON agent_knowledge_jobs (agent_id, sha256)
	WHERE status IN ('queued', 'extracting', 'indexing');
CREATE INDEX IF NOT EXISTS agent_knowledge_jobs_agent_created
	ON agent_knowledge_jobs (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_knowledge_jobs_resume
	ON agent_knowledge_jobs (updated_at)
	WHERE status IN ('queued', 'extracting', 'indexing');

-- Where a chunk came from on the page: { page, element: text|table|chart,
-- bbox: {x0,y0,x1,y1} normalised 0..1, part, parts }. NULL for chunks from
-- the MarkItDown path, which has no layout.
ALTER TABLE agent_knowledge_chunks ADD COLUMN IF NOT EXISTS source jsonb;
