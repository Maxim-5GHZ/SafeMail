package ru.security.gateway.controller;

import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import ru.security.gateway.events.ThreatSseService;

/** Живая лента угроз для SOC-панели: GET /api/v1/admin/events (text/event-stream).
 *  Доступ — только ADMIN (см. SecurityConfig). Токен — Bearer-заголовок либо
 *  ?access_token= (EventSource не умеет ставить заголовки; см. JwtAuthFilter).
 *  Nginx не буферизует этот путь (X-Accel-Buffering + location без proxy_buffering). */
@RestController
@RequestMapping("/api/v1/admin")
@RequiredArgsConstructor
public class AdminEventsController {
  private final ThreatSseService threatSseService;

  @GetMapping(value = "/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  public ResponseEntity<SseEmitter> streamThreats() {
    return ResponseEntity.ok()
        .header("X-Accel-Buffering", "no")
        .header("Cache-Control", "no-cache")
        .body(threatSseService.subscribe());
  }
}
