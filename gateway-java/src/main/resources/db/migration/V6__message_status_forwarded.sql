-- Новый статус письма: вручную отправлено безопасникам (см. InboundPipelineService.forwardToOfficers).
ALTER TYPE message_status ADD VALUE IF NOT EXISTS 'FORWARDED';
