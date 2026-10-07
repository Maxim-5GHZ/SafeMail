-- SafeMail V3: роль пользователя (ADMIN для /routing-rules и /admin)
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'USER';
