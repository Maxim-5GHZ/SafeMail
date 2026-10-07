-- SafeMail V1: очередь, метаданные, анализ, маршрутизация, пользователи
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE message_status AS ENUM ('PENDING','PARSED','ENRICHED','ANALYZED','DELIVERED','REROUTED','FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE threat_category AS ENUM ('NONE','TERRORISM','MAN_MADE','ILLEGAL_ACTIONS','OTHER_THREAT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE link_status AS ENUM ('SAFE','SUSPICIOUS','MALICIOUS','UNCHECKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(64) NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9._-]{2,64}$'),
  email VARCHAR(320) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS threat_routing_rules (
  id SERIAL PRIMARY KEY,
  category threat_category NOT NULL UNIQUE,
  destination_emails TEXT[] NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO threat_routing_rules (category, destination_emails) VALUES
  ('TERRORISM', ARRAY['infosec@corp-sec.ru']),
  ('MAN_MADE', ARRAY['infosec@corp-sec.ru']),
  ('ILLEGAL_ACTIONS', ARRAY['infosec@corp-sec.ru']),
  ('OTHER_THREAT', ARRAY['infosec@corp-sec.ru'])
ON CONFLICT (category) DO NOTHING;

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  smtp_message_id VARCHAR(255),
  sender_email VARCHAR(320) NOT NULL,
  recipient_email VARCHAR(320) NOT NULL,
  subject TEXT,
  raw_content BYTEA,
  status message_status DEFAULT 'PENDING',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_email);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);

CREATE TABLE IF NOT EXISTS message_parsed_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  clean_text TEXT,
  extracted_text_from_attachments TEXT,
  has_attachments BOOLEAN DEFAULT FALSE,
  attachments_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(100),
  file_size_bytes BIGINT NOT NULL,
  file_content BYTEA,
  is_threat BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON message_attachments(message_id);

CREATE TABLE IF NOT EXISTS message_links (
  id BIGSERIAL PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  status link_status DEFAULT 'UNCHECKED',
  reputation_score INT,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_links_message_id ON message_links(message_id);

CREATE TABLE IF NOT EXISTS message_threat_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  heuristic_score NUMERIC(5,4),
  heuristic_flags TEXT[],
  llm_category threat_category DEFAULT 'NONE',
  llm_confidence NUMERIC(5,4),
  final_verdict threat_category DEFAULT 'NONE',
  explanation TEXT,
  speller_fixes JSONB,
  analyzed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_threat_final_verdict ON message_threat_analysis(final_verdict);

CREATE TABLE IF NOT EXISTS delivery_logs (
  id BIGSERIAL PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  action_taken VARCHAR(50) NOT NULL,
  destination_recipients TEXT[] NOT NULL,
  smtp_response TEXT,
  success BOOLEAN NOT NULL,
  attempted_at TIMESTAMPTZ DEFAULT NOW()
);
