-- V7: комментарий SLM для шторки /admin (semantic_comment из classify-threat).
-- Старые письма: NULL (шторка показывает «нет данных», не fallback).
ALTER TABLE message_threat_analysis
  ADD COLUMN IF NOT EXISTS semantic_category threat_category,
  ADD COLUMN IF NOT EXISTS semantic_score NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS semantic_comment TEXT;
