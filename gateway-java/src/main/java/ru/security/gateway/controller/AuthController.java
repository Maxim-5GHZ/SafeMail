package ru.security.gateway.controller;

import jakarta.validation.Valid;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import ru.security.gateway.dto.LoginRequest;
import ru.security.gateway.dto.RegisterRequest;
import ru.security.gateway.service.AuthService;

@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class AuthController {
  private final AuthService authService;

  @PostMapping("/register")
  public ResponseEntity<Map<String, String>> register(@Valid @RequestBody RegisterRequest req) {
    String token = authService.register(req);
    return ResponseEntity.ok(Map.of("token", token));
  }

  @PostMapping("/login")
  public ResponseEntity<Map<String, String>> login(@Valid @RequestBody LoginRequest req) {
    String token = authService.login(req);
    return ResponseEntity.ok(Map.of("token", token));
  }
}
