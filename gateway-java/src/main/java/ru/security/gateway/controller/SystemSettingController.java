package ru.security.gateway.controller;

import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import ru.security.gateway.domain.SystemSetting;
import ru.security.gateway.dto.SystemSettingsDto;
import ru.security.gateway.service.SystemSettingService;

@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
@Validated
public class SystemSettingController {
  private final SystemSettingService settingService;

  /** Публичный конфиг для фронтенда (форма логина/регистрации показывает живой домен). */
  @GetMapping("/public/config")
  public ResponseEntity<Map<String, Object>> getPublicConfig() {
    SystemSetting s = settingService.getSettings();
    return ResponseEntity.ok(Map.of(
        "primaryDomain", s.getPrimaryDomain(),
        "allowedDomains", settingService.getAllowedDomainsList()));
  }

  @GetMapping("/admin/settings")
  public ResponseEntity<SystemSettingsDto> getAdminSettings() {
    SystemSetting s = settingService.getSettings();
    return ResponseEntity.ok(toDto(s));
  }

  @PutMapping("/admin/settings")
  public ResponseEntity<SystemSettingsDto> updateAdminSettings(@Valid @RequestBody SystemSettingsDto req) {
    SystemSetting s = settingService.updateSettings(
        req.getPrimaryDomain(), req.getAllowedDomains(),
        req.isRelayEnabled(), req.getRelayHost(), req.getRelayPort());
    return ResponseEntity.ok(toDto(s));
  }

  private SystemSettingsDto toDto(SystemSetting s) {
    return SystemSettingsDto.builder()
        .primaryDomain(s.getPrimaryDomain())
        .allowedDomains(settingService.getAllowedDomainsList())
        .relayEnabled(s.isRelayEnabled())
        .relayHost(s.getRelayHost())
        .relayPort(s.getRelayPort())
        .build();
  }
}
