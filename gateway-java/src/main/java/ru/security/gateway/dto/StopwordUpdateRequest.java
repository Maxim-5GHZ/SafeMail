package ru.security.gateway.dto;

import lombok.Data;
import ru.security.gateway.domain.ThreatCategory;

@Data
public class StopwordUpdateRequest {
  /** Новая категория (null — не менять). */
  private ThreatCategory category;
  /** Вкл/выкл правило (null — не менять). */
  private Boolean active;
}
