package ru.security.gateway.events;

import java.time.OffsetDateTime;
import java.util.UUID;
import ru.security.gateway.domain.ThreatCategory;

/** Письмо ушло в карантин (вердикт != NONE). Публикуется из пайплайна,
 *  рассылается живым SSE-подписчикам SOC-панели через ThreatSseService.
 *  Тел писем нет — только лёгкий заголовок инцидента. */
public record ThreatQuarantinedEvent(
    UUID messageId,
    String senderEmail,
    String recipientEmail,
    String subject,
    ThreatCategory category,
    double confidence,
    OffsetDateTime createdAt) {
}
