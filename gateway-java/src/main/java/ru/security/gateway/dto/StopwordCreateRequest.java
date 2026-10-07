package ru.security.gateway.dto;

import jakarta.validation.constraints.*;
import lombok.Data;
import ru.security.gateway.domain.ThreatCategory;

@Data
public class StopwordCreateRequest {
  @NotBlank @Size(min = 2, max = 200, message = "Паттерн 2..200 символов")
  private String pattern;

  @NotNull
  private ThreatCategory category;
}
