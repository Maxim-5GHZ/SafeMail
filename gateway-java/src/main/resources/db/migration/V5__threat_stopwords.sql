-- V5: управляемые стоп-слова для админки (/admin): pattern -> категория вердикта.
-- Матчинг — подстрока без учёта регистра по НОРМАЛИЗОВАННОМУ тексту в ml-classify
-- (обфускация уже снята enrich/normalize). Сигнал едет в classify-threat как stopwords[].
CREATE TABLE IF NOT EXISTS threat_stopwords (
  id SERIAL PRIMARY KEY,
  pattern TEXT NOT NULL UNIQUE,
  category threat_category NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO threat_stopwords (pattern, category) VALUES
  ('взрывчатка', 'TERRORISM'),
  ('обнал', 'ILLEGAL_ACTIONS')
ON CONFLICT (pattern) DO NOTHING;
