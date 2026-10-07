package ru.security.gateway.controller;

import jakarta.validation.Valid;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import ru.security.gateway.dto.ReleaseRequest;
import ru.security.gateway.service.InboundPipelineService;

/** Ручной выпуск из карантина. Доступ — только ADMIN (см. SecurityConfig /api/v1/admin/**). */
@RestController
@RequestMapping("/api/v1/admin/messages")
@RequiredArgsConstructor
@Validated
public class AdminMessageController {
  private final InboundPipelineService pipelineService;

  @PostMapping("/{id}/release")
  public ResponseEntity<Map<String, String>> release(@PathVariable UUID id,
                                                      @Valid @RequestBody(required = false) ReleaseRequest req) {
    String adminEmail = SecurityContextHolder.getContext().getAuthentication().getName();
    pipelineService.releaseFromQuarantine(id, adminEmail, req == null ? null : req.getReason());
    return ResponseEntity.ok(Map.of("status", "DELIVERED"));
  }
}
