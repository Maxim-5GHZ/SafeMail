package ru.security.gateway.dto;

import jakarta.validation.constraints.*;
import lombok.Data;

@Data
public class RegisterRequest {
  @NotBlank
  @Pattern(regexp = "^[a-z0-9._-]{2,64}$", message = "username: только латиница, цифры, . _ -")
  private String username;

  @NotBlank
  @Size(min = 6, max = 128)
  private String password;
}
