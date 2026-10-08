-- V8: динамические настройки почты (домены + режим релея) для приёма из интернета.
-- Сид — кодом (SystemSettingService: MAIL_DOMAIN из env), здесь только DDL:
-- свежий прод с MAIL_DOMAIN=mail.hotcodeband.ru сразу получит правильный домен.
CREATE TABLE IF NOT EXISTS system_settings (
  id INT PRIMARY KEY,
  primary_domain VARCHAR(255) NOT NULL,
  allowed_domains TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  relay_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  relay_host VARCHAR(255) NOT NULL DEFAULT 'localhost',
  relay_port INT NOT NULL DEFAULT 1025,
  CONSTRAINT single_settings_row CHECK (id = 1)
);
