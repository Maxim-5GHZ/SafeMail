package ru.security.gateway.dto;

import jakarta.validation.constraints.Size;
import lombok.Data;

@Data
public class ReleaseRequest {
  /** Необязательная причина выпуска — попадёт в delivery_logs (аудит). */
  @Size(max = 500, message = "Причина до 500 символов")
  private String reason;
}
