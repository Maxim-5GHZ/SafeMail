package ru.security.gateway.controller;

import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import ru.security.gateway.domain.ThreatCategory;
import ru.security.gateway.domain.ThreatRoutingRule;
import ru.security.gateway.dto.RoutingRuleUpdateRequest;
import ru.security.gateway.service.MessageService;

@RestController
@RequestMapping("/api/v1/routing-rules")
@RequiredArgsConstructor
public class RoutingRuleController {
  private final MessageService messageService;

  @GetMapping
  public ResponseEntity<List<ThreatRoutingRule>> list() {
    return ResponseEntity.ok(messageService.listRules());
  }

  @PutMapping("/{category}")
  public ResponseEntity<ThreatRoutingRule> update(@PathVariable ThreatCategory category,
                                                 @Valid @RequestBody RoutingRuleUpdateRequest req) {
    return ResponseEntity.ok(messageService.updateRule(category, req.getDestinationEmails()));
  }
}
