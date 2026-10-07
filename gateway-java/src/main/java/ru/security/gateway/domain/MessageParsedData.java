package ru.security.gateway.domain;

import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.*;

@Entity
@Table(name = "message_parsed_data")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class MessageParsedData {
  @Id
  @Column(columnDefinition = "uuid")
  @Builder.Default
  private UUID id = UUID.randomUUID();

  @Column(name = "message_id", nullable = false, unique = true, columnDefinition = "uuid")
  private UUID messageId;

  @Column(name = "clean_text", columnDefinition = "TEXT")
  private String cleanText;

  @Column(name = "normalized_text", columnDefinition = "TEXT")
  private String normalizedText;

  @Column(name = "extracted_text_from_attachments", columnDefinition = "TEXT")
  private String extractedTextFromAttachments;

  @Column(name = "has_attachments")
  @Builder.Default
  private boolean hasAttachments = false;

  @Column(name = "attachments_count")
  @Builder.Default
  private int attachmentsCount = 0;

  @Column(name = "created_at")
  private OffsetDateTime createdAt;

  @PrePersist
  void prePersist() {
    if (id == null) id = UUID.randomUUID();
    if (createdAt == null) createdAt = OffsetDateTime.now();
  }
}
