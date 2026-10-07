-- SafeMail V2: claim строк очереди (защита от повторного забора)
ALTER TYPE message_status ADD VALUE IF NOT EXISTS 'IN_PROGRESS';
