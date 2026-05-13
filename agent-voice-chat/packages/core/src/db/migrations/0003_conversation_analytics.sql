-- =============================================================================
-- Migration 0003: Conversation Analytics & Sentiment Timeseries
-- =============================================================================

CREATE TABLE IF NOT EXISTS conversation_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES agent_sessions(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,

  -- Aggregates
  duration_seconds INTEGER,
  active_speaking_seconds INTEGER,
  silence_seconds INTEGER,
  participant_count INTEGER,
  total_turns INTEGER,
  avg_turn_length_seconds REAL,

  -- Sentiment
  sentiment_avg REAL,
  sentiment_min REAL,
  sentiment_max REAL,
  sentiment_trend TEXT,

  -- Topics
  topics JSONB DEFAULT '[]'::jsonb,
  primary_topic TEXT,

  -- Speakers
  speakers JSONB DEFAULT '[]'::jsonb,

  -- AI Insights
  summary TEXT,
  key_decisions TEXT[] DEFAULT '{}',
  action_items JSONB DEFAULT '[]'::jsonb,
  recommendations TEXT[] DEFAULT '{}',
  highlights JSONB DEFAULT '[]'::jsonb,
  risk_flags JSONB DEFAULT '[]'::jsonb,

  processed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_analytics_session
  ON conversation_analytics(session_id);
CREATE INDEX IF NOT EXISTS idx_conversation_analytics_org
  ON conversation_analytics(org_id, processed_at);
CREATE INDEX IF NOT EXISTS idx_conversation_analytics_sentiment
  ON conversation_analytics(org_id, sentiment_avg);

-- Time-series for charts
CREATE TABLE IF NOT EXISTS sentiment_timeseries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,
  speaker TEXT NOT NULL,
  sentiment REAL NOT NULL,
  topic TEXT
);

CREATE INDEX IF NOT EXISTS idx_sentiment_ts_session
  ON sentiment_timeseries(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_sentiment_ts_speaker
  ON sentiment_timeseries(session_id, speaker);


