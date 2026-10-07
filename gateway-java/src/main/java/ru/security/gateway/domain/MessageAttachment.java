package ru.security.gateway.domain;

import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.*;

@Entity
@Table(name = "message_attachments")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class MessageAttachment {
  @Id
  @Column(columnDefinition = "uuid")
  @Builder.Default
  private UUID id = UUID.randomUUID();

  @Column(name = "message_id", nullable = false, columnDefinition = "uuid")
  private UUID messageId;

  @Column(nullable = false)
  private String filename;

  @Column(name = "content_type")
  private String contentType;

  @Column(name = "file_size_bytes", nullable = false)
  private long fileSizeBytes;

  @Column(name = "file_content")
  private byte[] fileContent;

  @Column(name = "is_threat")
  @Builder.Default
  private boolean threat = false;

  @Column(name = "created_at")
  private OffsetDateTime createdAt;

  @PrePersist
  void prePersist() {
    if (id == null) id = UUID.randomUUID();
    if (createdAt == null) createdAt = OffsetDateTime.now();
  }
}
