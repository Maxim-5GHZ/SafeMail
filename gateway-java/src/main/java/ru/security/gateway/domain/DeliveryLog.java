package ru.security.gateway.domain;

import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "delivery_logs")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class DeliveryLog {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "message_id", nullable = false, columnDefinition = "uuid")
  private UUID messageId;

  @Column(name = "action_taken", nullable = false)
  private String actionTaken;

  @Column(name = "destination_recipients", nullable = false, columnDefinition = "text[]")
  @JdbcTypeCode(SqlTypes.ARRAY)
  private String[] destinationRecipients;

  @Column(name = "smtp_response", columnDefinition = "TEXT")
  private String smtpResponse;

  private boolean success;

  @Column(name = "attempted_at")
  private OffsetDateTime attemptedAt;

  @PrePersist
  void prePersist() {
    if (attemptedAt == null) attemptedAt = OffsetDateTime.now();
  }
}
