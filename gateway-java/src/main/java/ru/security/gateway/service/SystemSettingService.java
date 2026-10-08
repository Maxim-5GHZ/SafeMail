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
import ru.security.gateway.domain.ThreatRoutingRule;
import ru.security.gateway.domain.User;
import ru.security.gateway.repository.SystemSettingRepository;
import ru.security.gateway.repository.ThreatRoutingRuleRepository;
import ru.security.gateway.repository.UserRepository;

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
  private final ThreatRoutingRuleRepository rulesRepo;
  private final UserRepository usersRepo;

  /** Только из env (MAIL_DOMAIN): дефолта-литерала нет, без переменной контекст не стартует. */
  @Value("${mail.domain}")
  private String defaultEnvDomain;

  /** Итог смены настроек: сохранённая строка + счётчики пересаженных внутренних адресов. */
  public record SettingsUpdateResult(SystemSetting settings, int rebasedRules,
                                     int rebasedUsers, List<String> skippedUsers) {}

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
        .primaryDomain(requireEnvDomain())
        .allowedDomains(defaultAliases(requireEnvDomain()))
        .relayEnabled(false)
        .relayHost("localhost")
        .relayPort(1025)
        .build());
  }

  /** Домен только из env; без него — явная ошибка вместо тихого чужого дефолта. */
  private String requireEnvDomain() {
    try {
      return normalizeDomain(defaultEnvDomain);
    } catch (IllegalArgumentException e) {
      throw new IllegalStateException(
          "MAIL_DOMAIN не задан или некорректен — задайте его в .env (см. .env.example)", e);
    }
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

  /**
   * Смена настроек + пересадка внутренних адресов на новый домен.
   * Пересаживается только то, что было внутренним (домен из старого primary/алиасов):
   * адреса ИБ в threat_routing_rules и email всех пользователей (тот же local-part).
   * Внешние адреса (gmail и т.п.) и история писем не трогаются никогда.
   * Коллизия email (такой ящик уже есть) — пропуск строки с отчётом в skippedUsers,
   * всё сохранение при этом не валится.
   */
  @Transactional
  public SettingsUpdateResult updateSettings(String primaryDomain, List<String> allowedDomains,
                                             boolean relayEnabled, String relayHost, Integer relayPort) {
    SystemSetting current = getSettings();
    Set<String> oldInternal = internalSet(current.getPrimaryDomain(), current.getAllowedDomains());
    String primary = normalizeDomain(primaryDomain);
    LinkedHashSet<String> set = new LinkedHashSet<>();
    set.add(primary);
    if (allowedDomains != null) {
      for (String d : allowedDomains) {
        if (d != null && !d.isBlank()) set.add(normalizeDomain(d));
      }
    }
    SystemSetting s = current;
    s.setId(1);
    s.setPrimaryDomain(primary);
    s.setAllowedDomains(set.toArray(new String[0]));
    s.setRelayEnabled(relayEnabled);
    s.setRelayHost(relayHost == null || relayHost.isBlank() ? "localhost" : relayHost.trim());
    s.setRelayPort(relayPort == null ? 1025 : relayPort);
    repo.save(s);

    int rebasedRules = 0;
    for (ThreatRoutingRule r : rulesRepo.findAll()) {
      if (r.getDestinationEmails() == null) continue;
      LinkedHashSet<String> fresh = new LinkedHashSet<>();
      boolean changed = false;
      for (String e : r.getDestinationEmails()) {
        String nb = rebaseInternalEmail(e, oldInternal, primary);
        if (!nb.equals(e)) changed = true;
        fresh.add(nb);
      }
      if (changed) {
        r.setDestinationEmails(fresh.toArray(new String[0]));
        rulesRepo.save(r);
        rebasedRules++;
      }
    }

    int rebasedUsers = 0;
    List<String> skippedUsers = new ArrayList<>();
    Set<String> taken = new HashSet<>();
    for (User u : usersRepo.findAll()) {
      if (u.getEmail() != null) taken.add(u.getEmail().trim().toLowerCase(Locale.ROOT));
    }
    for (User u : usersRepo.findAll()) {
      String old = u.getEmail();
      String nb = rebaseInternalEmail(old, oldInternal, primary);
      if (nb.equals(old)) continue;
      String key = nb.toLowerCase(Locale.ROOT);
      if (taken.contains(key)) {
        skippedUsers.add(old);
        continue;
      }
      taken.remove(old == null ? null : old.trim().toLowerCase(Locale.ROOT));
      taken.add(key);
      u.setEmail(nb);
      usersRepo.save(u);
      rebasedUsers++;
    }
    if (!skippedUsers.isEmpty()) {
      log.warn("Смена домена: пропущены ящики (такой email уже занят): {}", skippedUsers);
    }
    log.info("Смена домена -> {}: пересажено правил ИБ={}, ящиков={}", primary, rebasedRules, rebasedUsers);
    return new SettingsUpdateResult(s, rebasedRules, rebasedUsers, List.copyOf(skippedUsers));
  }

  private static Set<String> internalSet(String primary, String[] allowed) {
    LinkedHashSet<String> out = new LinkedHashSet<>();
    if (primary != null && !primary.isBlank()) out.add(primary.trim().toLowerCase(Locale.ROOT));
    if (allowed != null) {
      for (String d : allowed) {
        if (d != null && !d.isBlank()) out.add(d.trim().toLowerCase(Locale.ROOT));
      }
    }
    return out;
  }

  /**
   * Пересадка одного адреса на новый primary. Возвращает исходный, если адрес
   * внешний (домен вне старого внутреннего набора), кривой или уже на новом домене.
   * Тот же хелпер использует RoutingRuleSeeder при старте.
   */
  static String rebaseInternalEmail(String email, Set<String> oldInternal, String newPrimary) {
    if (email == null) return null;
    int at = email.indexOf('@');
    if (at <= 0 || at != email.lastIndexOf('@') || at == email.length() - 1) return email;
    String local = email.substring(0, at);
    String dom = email.substring(at + 1).trim().toLowerCase(Locale.ROOT);
    if (!oldInternal.contains(dom) || dom.equals(newPrimary)) return email;
    return local + "@" + newPrimary;
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
