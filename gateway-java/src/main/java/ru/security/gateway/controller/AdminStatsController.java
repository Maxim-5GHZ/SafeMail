package ru.security.gateway.controller;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import ru.security.gateway.dto.AdminStatsResponse;
import ru.security.gateway.service.AdminStatsService;

/** Админ-дашборд: агрегаты для KPI/графиков. Доступ — только ADMIN (см. SecurityConfig). */
@RestController
@RequestMapping("/api/v1/admin")
@RequiredArgsConstructor
@Validated
public class AdminStatsController {
  private final AdminStatsService adminStatsService;

  @GetMapping("/stats")
  public ResponseEntity<AdminStatsResponse> getStats(
      @RequestParam(defaultValue = "14") @Min(1) @Max(90) int days) {
    return ResponseEntity.ok(adminStatsService.getStats(days));
  }
}
