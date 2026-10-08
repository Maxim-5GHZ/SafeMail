package ru.security.gateway.dto;

import jakarta.validation.constraints.*;
import java.util.List;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SystemSettingsDto {
  @NotBlank(message = "Основной домен обязателен")
  @Size(max = 255, message = "Домен до 255 символов")
  private String primaryDomain;

  @Size(max = 20, message = "Алиасов не больше 20")
  private List<@Size(max = 255, message = "Алиас до 255 символов") String> allowedDomains;

  private boolean relayEnabled;

  @Size(max = 255, message = "Хост релея до 255 символов")
  private String relayHost;

  @Min(value = 1, message = "Порт 1..65535")
  @Max(value = 65535, message = "Порт 1..65535")
  private Integer relayPort;
}
