package ru.security.gateway.service;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import ru.security.gateway.domain.User;
import ru.security.gateway.repository.UserRepository;

/**
 * MVP-bootstrap администратора (для /admin): создаёт admin@MAIL_DOMAIN,
 * если его нет. Пароль — APP_ADMIN_PASSWORD, по умолчанию 'admin'.
 */
@Component
@RequiredArgsConstructor
@Order(10)
public class AdminBootstrap implements CommandLineRunner {
  private static final Logger log = LoggerFactory.getLogger(AdminBootstrap.class);

  private final UserRepository users;
  private final PasswordEncoder encoder;
  private final SystemSettingService systemSettingService;

  @Value("${app.admin-password:admin}")
  private String adminPassword;

  @Override
  public void run(String... args) {
    String email = "admin@" + systemSettingService.getSettings().getPrimaryDomain().toLowerCase();
    if (users.findByEmail(email).isPresent() || users.findByUsername("admin").isPresent()) {
      return;
    }
    users.save(User.builder().username("admin").email(email).role("ADMIN")
        .passwordHash(encoder.encode(adminPassword)).build());
    if ("admin".equals(adminPassword)) {
      log.warn("Создан MVP-админ admin/admin — задайте APP_ADMIN_PASSWORD в проде!");
    } else {
      log.info("Создан администратор {}", email);
    }
  }
}
