package ru.security.gateway.domain;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "message_threat_analysis")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class MessageThreatAnalysis {
  @Id
  @Column(columnDefinition = "uuid")
  @Builder.Default
  private UUID id = UUID.randomUUID();

  @Column(name = "message_id", nullable = false, unique = true, columnDefinition = "uuid")
  private UUID messageId;

  @Column(name = "heuristic_score", precision = 5, scale = 4)
  private BigDecimal heuristicScore;

  @Column(name = "heuristic_flags", columnDefinition = "text[]")
  @JdbcTypeCode(SqlTypes.ARRAY)
  private String[] heuristicFlags;

  @Enumerated(EnumType.STRING)
  @JdbcTypeCode(SqlTypes.NAMED_ENUM)
  @Column(name = "llm_category", columnDefinition = "threat_category")
  @Builder.Default
  private ThreatCategory llmCategory = ThreatCategory.NONE;

  @Column(name = "llm_confidence", precision = 5, scale = 4)
  private BigDecimal llmConfidence;

  @Enumerated(EnumType.STRING)
  @JdbcTypeCode(SqlTypes.NAMED_ENUM)
  @Column(name = "final_verdict", columnDefinition = "threat_category")
  @Builder.Default
  private ThreatCategory finalVerdict = ThreatCategory.NONE;

  @Column(columnDefinition = "TEXT")
  private String explanation;

  @Column(name = "speller_fixes", columnDefinition = "jsonb")
  @JdbcTypeCode(SqlTypes.JSON)
  private String spellerFixes;

  @Column(name = "analyzed_at")
  private OffsetDateTime analyzedAt;

  @PrePersist
  void prePersist() {
    if (id == null) id = UUID.randomUUID();
    if (analyzedAt == null) analyzedAt = OffsetDateTime.now();
  }
}
