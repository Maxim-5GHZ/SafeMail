package ru.security.gateway.dto;

import jakarta.validation.constraints.*;
import java.util.List;
import lombok.Data;

@Data
public class RoutingRuleUpdateRequest {
  @NotNull @Size(min = 1)
  private List<@Email String> destinationEmails;
}
