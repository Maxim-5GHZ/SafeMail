-- V4: нормализованный текст для инженерной шторки (/admin): диф clean -> normalized.
ALTER TABLE message_parsed_data ADD COLUMN IF NOT EXISTS normalized_text TEXT;
