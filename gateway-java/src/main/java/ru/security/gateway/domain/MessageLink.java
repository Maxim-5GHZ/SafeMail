package ru.security.gateway.domain;

import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "message_links")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class MessageLink {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "message_id", nullable = false, columnDefinition = "uuid")
  private UUID messageId;

  @Column(nullable = false, columnDefinition = "TEXT")
  private String url;

  @Enumerated(EnumType.STRING)
  @JdbcTypeCode(SqlTypes.NAMED_ENUM)
  @Column(columnDefinition = "link_status")
  @Builder.Default
  private LinkStatus status = LinkStatus.UNCHECKED;

  @Column(name = "reputation_score")
  private Integer reputationScore;

  @JdbcTypeCode(SqlTypes.JSON)
  @Column(columnDefinition = "jsonb")
  private String details;

  @Column(name = "created_at")
  private OffsetDateTime createdAt;

  @PrePersist
  void prePersist() {
    if (createdAt == null) createdAt = OffsetDateTime.now();
    if (status == null) status = LinkStatus.UNCHECKED;
  }
}
