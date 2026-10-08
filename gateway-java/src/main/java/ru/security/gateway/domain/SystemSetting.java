package ru.security.gateway.domain;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** Единственная строка настроек (id=1): домены приёма почты и режим SMTP-релея. */
@Entity
@Table(name = "system_settings")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class SystemSetting {
  @Id
  @Builder.Default
  private Integer id = 1;

  @Column(name = "primary_domain", nullable = false)
  private String primaryDomain;

  @Column(name = "allowed_domains", nullable = false, columnDefinition = "text[]")
  @JdbcTypeCode(SqlTypes.ARRAY)
  @Builder.Default
  private String[] allowedDomains = new String[0];

  @Column(name = "relay_enabled", nullable = false)
  @Builder.Default
  private boolean relayEnabled = false;

  @Column(name = "relay_host", nullable = false)
  @Builder.Default
  private String relayHost = "localhost";

  @Column(name = "relay_port", nullable = false)
  @Builder.Default
  private int relayPort = 1025;
}
