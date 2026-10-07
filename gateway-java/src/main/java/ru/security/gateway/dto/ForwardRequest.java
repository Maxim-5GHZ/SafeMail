package ru.security.gateway.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Size;
import java.util.List;
import lombok.Data;

/** Ручная отправка копии карантинного письма безопасникам. Всё опционально. */
@Data
public class ForwardRequest {
  /** Дополнительные адреса сверх правила категории (если пусто — только правило). */
  private List<@Email String> emails;
  @Size(max = 500)
  private String reason;
}
