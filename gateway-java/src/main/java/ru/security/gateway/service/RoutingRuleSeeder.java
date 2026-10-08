package ru.security.gateway.service;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import ru.security.gateway.domain.ThreatCategory;
import ru.security.gateway.domain.ThreatRoutingRule;
import ru.security.gateway.repository.ThreatRoutingRuleRepository;

/**
 * Чинит адреса ИБ после старта на новом домене.
 * Сиды V1__init.sql указывают на исторический домен сида (см. LEGACY_SEED_DOMAIN):
 * свежая БД, поднятая с другим MAIL_DOMAIN, иначе слала бы карантин не туда.
 * Трогает только адреса на историческом домене; ручные правки из /admin
 * (включая внешние ящики) не затирает.
 * Цель на категорию: ROUTE_* из env (если задан и валиден), иначе infosec@primary из БД.
 */
@Component
@RequiredArgsConstructor
@Order(6)
public class RoutingRuleSeeder implements CommandLineRunner {
  private static final Logger log = LoggerFactory.getLogger(RoutingRuleSeeder.class);
  /** Исторический домен сида V1 — маркер старых строк, НЕ дефолт для нового. */
  static final String LEGACY_SEED_DOMAIN = "corp-sec.ru";

  private final ThreatRoutingRuleRepository rulesRepo;
  private final SystemSettingService settingService;

  @Value("${ROUTE_TERRORISM:}")
  private String routeTerrorism;
  @Value("${ROUTE_MAN_MADE:}")
  private String routeManMade;
  @Value("${ROUTE_ILLEGAL:}")
  private String routeIllegal;
  @Value("${ROUTE_OTHER:}")
  private String routeOther;

  @Override
  @Transactional
  public void run(String... args) {
    String primary;
    try {
      primary = settingService.getSettings().getPrimaryDomain();
    } catch (IllegalStateException e) {
      log.warn("Сидер правил пропущен: {}", e.getMessage());
      return;
    }
    Map<ThreatCategory, String> envRoute = new LinkedHashMap<>();
    envRoute.put(ThreatCategory.TERRORISM, routeTerrorism);
    envRoute.put(ThreatCategory.MAN_MADE, routeManMade);
    envRoute.put(ThreatCategory.ILLEGAL_ACTIONS, routeIllegal);
    envRoute.put(ThreatCategory.OTHER_THREAT, routeOther);
    Map<ThreatCategory, String> fixed = new LinkedHashMap<>();
    for (ThreatCategory cat : ThreatCategory.values()) {
      if (cat == ThreatCategory.NONE) continue;
      String target = validEmail(envRoute.get(cat));
      if (target == null) target = "infosec@" + primary.toLowerCase(Locale.ROOT);
      ThreatRoutingRule r = rulesRepo.findByCategory(cat)
          .orElse(ThreatRoutingRule.builder().category(cat).active(true).build());
      boolean created = r.getId() == null;
      LinkedHashSet<String> fresh = new LinkedHashSet<>();
      boolean changed = created;
      String[] current = r.getDestinationEmails();
      if (current != null) {
        for (String e : current) {
          if (e != null && domainOf(e).equals(LEGACY_SEED_DOMAIN)) {
            // Исторический сид уходит в любом случае: либо заменой на цель,
            // либо выбросом, если цель уже есть (дедуп).
            if (!fresh.contains(target) && !containsEmail(current, target)) fresh.add(target);
            changed = true;
          } else if (e != null) {
            fresh.add(e);
          }
        }
      }
      if (created && fresh.isEmpty()) {
        fresh.add(target);
      }
      if (changed && !fresh.isEmpty()) {
        r.setDestinationEmails(fresh.toArray(new String[0]));
        r.setActive(true);
        rulesRepo.save(r);
        fixed.put(cat, target);
      }
    }
    if (!fixed.isEmpty()) log.info("Сидер правил ИБ: {} (primary={})", fixed, primary);
  }

  private static String domainOf(String email) {
    int at = email.lastIndexOf('@');
    return at < 0 ? "" : email.substring(at + 1).trim().toLowerCase(Locale.ROOT);
  }

  private static boolean containsEmail(String[] arr, String target) {
    for (String e : arr) {
      if (e != null && e.trim().equalsIgnoreCase(target)) return true;
    }
    return false;
  }

  /** Только валидный адрес из env; мусор — мимо (тогда infosec@primary). */
  static String validEmail(String raw) {
    if (raw == null || raw.isBlank()) return null;
    String e = raw.trim();
    int at = e.indexOf('@');
    if (at <= 0 || at != e.lastIndexOf('@') || at == e.length() - 1) return null;
    try {
      SystemSettingService.normalizeDomain(e.substring(at + 1));
    } catch (IllegalArgumentException ex) {
      return null;
    }
    return e.toLowerCase(Locale.ROOT);
  }
}
