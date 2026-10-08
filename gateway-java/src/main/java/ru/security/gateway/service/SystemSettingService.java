package ru.security.gateway.service;

import java.util.*;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.security.gateway.domain.SystemSetting;
import ru.security.gateway.repository.SystemSettingRepository;

/**
 * Динамические настройки почты (домены + релей), меняются из /admin без пересборки.
 * Сид при первом старте — из MAIL_DOMAIN: основной домен + авто-алиас
 * (mail.X ↔ X), чтобы письма доходили хоть на @hotcodeband.ru, хоть на @mail.hotcodeband.ru.
 */
@Service
@RequiredArgsConstructor
@Order(5)
public class SystemSettingService implements CommandLineRunner {
  private static final Logger log = LoggerFactory.getLogger(SystemSettingService.class);
  private static final Pattern DOMAIN_PAT = Pattern.compile("^[a-z0-9]([a-z0-9.\\-]*[a-z0-9])?$");

  private final SystemSettingRepository repo;

  @Value("${mail.domain:corp-sec.ru}")
  private String defaultEnvDomain;

  @Override
  @Transactional
  public void run(String... args) {
    if (repo.findById(1).isPresent()) return;
    String clean = normalizeDomain(defaultEnvDomain);
    repo.save(SystemSetting.builder()
        .id(1)
        .primaryDomain(clean)
        .allowedDomains(defaultAliases(clean))
        .relayEnabled(false)
        .relayHost("localhost")
        .relayPort(1025)
        .build());
    log.info("Seed system_settings: primary={}, allowed={}", clean, Arrays.toString(defaultAliases(clean)));
  }

  @Transactional(readOnly = true)
  public SystemSetting getSettings() {
    return repo.findById(1).orElseGet(() -> SystemSetting.builder()
        .id(1)
        .primaryDomain("corp-sec.ru")
        .allowedDomains(new String[]{"corp-sec.ru"})
        .relayEnabled(false)
        .relayHost("localhost")
        .relayPort(1025)
        .build());
  }

  /** Свой ли домен (основной или любой алиас, без учёта регистра). */
  @Transactional(readOnly = true)
  public boolean isLocalDomain(String domain) {
    if (domain == null || domain.isBlank()) return false;
    String d = domain.trim().toLowerCase(Locale.ROOT);
    SystemSetting s = getSettings();
    if (d.equalsIgnoreCase(s.getPrimaryDomain())) return true;
    if (s.getAllowedDomains() != null) {
      for (String allowed : s.getAllowedDomains()) {
        if (allowed != null && d.equalsIgnoreCase(allowed.trim())) return true;
      }
    }
    return false;
  }

  @Transactional(readOnly = true)
  public List<String> getAllowedDomainsList() {
    SystemSetting s = getSettings();
    LinkedHashSet<String> out = new LinkedHashSet<>();
    if (s.getPrimaryDomain() != null && !s.getPrimaryDomain().isBlank()) {
      out.add(s.getPrimaryDomain().trim().toLowerCase(Locale.ROOT));
    }
    if (s.getAllowedDomains() != null) {
      for (String d : s.getAllowedDomains()) {
        if (d != null && !d.isBlank()) out.add(d.trim().toLowerCase(Locale.ROOT));
      }
    }
    return List.copyOf(out);
  }

  @Transactional
  public SystemSetting updateSettings(String primaryDomain, List<String> allowedDomains,
                                      boolean relayEnabled, String relayHost, Integer relayPort) {
    String primary = normalizeDomain(primaryDomain);
    LinkedHashSet<String> set = new LinkedHashSet<>();
    set.add(primary);
    if (allowedDomains != null) {
      for (String d : allowedDomains) {
        if (d != null && !d.isBlank()) set.add(normalizeDomain(d));
      }
    }
    SystemSetting s = getSettings();
    s.setId(1);
    s.setPrimaryDomain(primary);
    s.setAllowedDomains(set.toArray(new String[0]));
    s.setRelayEnabled(relayEnabled);
    s.setRelayHost(relayHost == null || relayHost.isBlank() ? "localhost" : relayHost.trim());
    s.setRelayPort(relayPort == null ? 1025 : relayPort);
    return repo.save(s);
  }

  static String normalizeDomain(String domain) {
    if (domain == null || domain.isBlank()) throw new IllegalArgumentException("Домен не задан");
    String d = domain.trim().toLowerCase(Locale.ROOT);
    if (d.length() > 253 || !DOMAIN_PAT.matcher(d).matches() || !d.contains(".")) {
      throw new IllegalArgumentException("Некорректный домен: " + domain.trim());
    }
    return d;
  }

  /** Авто-алиасы: mail.X ↔ X, чтобы не гадать, @hotcodeband.ru или @mail.hotcodeband.ru. */
  static String[] defaultAliases(String primary) {
    LinkedHashSet<String> set = new LinkedHashSet<>();
    set.add(primary);
    if (primary.startsWith("mail.")) {
      set.add(primary.substring("mail.".length()));
    } else {
      set.add("mail." + primary);
    }
    return set.toArray(new String[0]);
  }
}
