package ru.security.gateway.domain;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "threat_routing_rules")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class ThreatRoutingRule {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Integer id;

  @Enumerated(EnumType.STRING)
  @JdbcTypeCode(SqlTypes.NAMED_ENUM)
  @Column(nullable = false, unique = true, columnDefinition = "threat_category")
  private ThreatCategory category;

  @Column(name = "destination_emails", nullable = false, columnDefinition = "text[]")
  @JdbcTypeCode(SqlTypes.ARRAY)
  private String[] destinationEmails;

  @Column(name = "is_active")
  @Builder.Default
  private boolean active = true;
}
