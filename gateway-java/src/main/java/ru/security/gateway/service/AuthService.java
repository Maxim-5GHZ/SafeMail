package ru.security.gateway.service;

import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.security.gateway.domain.User;
import ru.security.gateway.dto.LoginRequest;
import ru.security.gateway.dto.RegisterRequest;
import ru.security.gateway.repository.UserRepository;
import ru.security.gateway.security.JwtService;

@Service
@RequiredArgsConstructor
public class AuthService {
  private final UserRepository users;
  private final PasswordEncoder encoder;
  private final JwtService jwt;
  private final SystemSettingService systemSettingService;

  @Transactional
  public String register(RegisterRequest req) {
    String username = req.getUsername().toLowerCase().trim();
    String email = username + "@" + systemSettingService.getSettings().getPrimaryDomain().toLowerCase();
    if (users.findByEmail(email).isPresent() || users.findByUsername(username).isPresent()) {
      throw new IllegalArgumentException("Пользователь уже существует: " + email);
    }
    User u = User.builder().username(username).email(email).role("USER")
        .passwordHash(encoder.encode(req.getPassword())).build();
    users.save(u);
    return jwt.generate(email, u.getRole());
  }

  @Transactional(readOnly = true)
  public String login(LoginRequest req) {
    User u = users.findByEmail(req.getEmail().toLowerCase().trim())
        .orElseThrow(() -> new IllegalArgumentException("Неверный email или пароль"));
    if (!encoder.matches(req.getPassword(), u.getPasswordHash())) {
      throw new IllegalArgumentException("Неверный email или пароль");
    }
    return jwt.generate(u.getEmail(), u.getRole() == null ? "USER" : u.getRole());
  }
}
