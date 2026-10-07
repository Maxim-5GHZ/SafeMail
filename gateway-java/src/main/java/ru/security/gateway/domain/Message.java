package ru.security.gateway.domain;

import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "messages")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Message {
  @Id
  @Column(columnDefinition = "uuid")
  @Builder.Default
  private UUID id = UUID.randomUUID();

  @Column(name = "smtp_message_id")
  private String smtpMessageId;

  @Column(name = "sender_email", nullable = false)
  private String senderEmail;

  @Column(name = "recipient_email", nullable = false)
  private String recipientEmail;

  private String subject;

  @Column(name = "raw_content")
  private byte[] rawContent;

  @Enumerated(EnumType.STRING)
  @JdbcTypeCode(SqlTypes.NAMED_ENUM)
  @Column(columnDefinition = "message_status")
  @Builder.Default
  private MessageStatus status = MessageStatus.PENDING;

  @Column(name = "created_at")
  private OffsetDateTime createdAt;

  @Column(name = "processed_at")
  private OffsetDateTime processedAt;

  @PrePersist
  void prePersist() {
    if (id == null) id = UUID.randomUUID();
    if (createdAt == null) createdAt = OffsetDateTime.now();
    if (status == null) status = MessageStatus.PENDING;
  }
}
