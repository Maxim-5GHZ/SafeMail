package ru.security.gateway.controller;

import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import ru.security.gateway.domain.ThreatStopword;
import ru.security.gateway.dto.StopwordCreateRequest;
import ru.security.gateway.dto.StopwordUpdateRequest;
import ru.security.gateway.service.StopwordService;

/** Стоп-слова для /admin. Доступ — только ADMIN (см. SecurityConfig /api/v1/admin/**). */
@RestController
@RequestMapping("/api/v1/admin/stopwords")
@RequiredArgsConstructor
@Validated
public class AdminStopwordController {
  private final StopwordService stopwordService;

  @GetMapping
  public ResponseEntity<List<ThreatStopword>> list() {
    return ResponseEntity.ok(stopwordService.list());
  }

  @PostMapping
  public ResponseEntity<ThreatStopword> create(@Valid @RequestBody StopwordCreateRequest req) {
    return ResponseEntity.ok(stopwordService.create(req.getPattern(), req.getCategory()));
  }

  @PutMapping("/{id}")
  public ResponseEntity<ThreatStopword> update(@PathVariable Integer id,
                                               @Valid @RequestBody StopwordUpdateRequest req) {
    return ResponseEntity.ok(stopwordService.update(id, req.getCategory(), req.getActive()));
  }

  @DeleteMapping("/{id}")
  public ResponseEntity<Void> delete(@PathVariable Integer id) {
    stopwordService.delete(id);
    return ResponseEntity.noContent().build();
  }
}
