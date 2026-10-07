package ru.security.gateway.domain;

import jakarta.persistence.*;
import java.time.OffsetDateTime;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** Управляемое стоп-слово: подстрока -> категория вердикта (матчится в ml-classify). */
@Entity
@Table(name = "threat_stopwords")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class ThreatStopword {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Integer id;

  @Column(nullable = false, unique = true)
  private String pattern;

  @Enumerated(EnumType.STRING)
  @JdbcTypeCode(SqlTypes.NAMED_ENUM)
  @Column(nullable = false, columnDefinition = "threat_category")
  private ThreatCategory category;

  @Column(name = "is_active")
  @Builder.Default
  private boolean active = true;

  @Column(name = "created_at")
  private OffsetDateTime createdAt;

  @PrePersist
  void prePersist() {
    if (createdAt == null) createdAt = OffsetDateTime.now();
  }
}
