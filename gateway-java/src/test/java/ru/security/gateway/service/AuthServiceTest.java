package ru.security.gateway.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;
import ru.security.gateway.domain.SystemSetting;
import ru.security.gateway.domain.User;
import ru.security.gateway.dto.LoginRequest;
import ru.security.gateway.dto.RegisterRequest;
import ru.security.gateway.repository.UserRepository;
import ru.security.gateway.security.JwtService;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {
  @Mock UserRepository users;
  @Mock PasswordEncoder encoder;
  @Mock JwtService jwt;
  @Mock SystemSettingService systemSettingService;

  private AuthService svc() {
    lenient().when(systemSettingService.getSettings()).thenReturn(SystemSetting.builder()
        .id(1).primaryDomain("corp-sec.ru").allowedDomains(new String[]{"corp-sec.ru"})
        .relayEnabled(false).build());
    return new AuthService(users, encoder, jwt, systemSettingService);
  }

  @Test
  void registerCreatesUserRole() {
    RegisterRequest req = new RegisterRequest();
    req.setUsername("Ivan");
    req.setPassword("secret123");
    when(users.findByEmail("ivan@corp-sec.ru")).thenReturn(Optional.empty());
    when(users.findByUsername("ivan")).thenReturn(Optional.empty());
    when(encoder.encode("secret123")).thenReturn("hash");
    when(jwt.generate("ivan@corp-sec.ru", "USER")).thenReturn("tok");
    assertEquals("tok", svc().register(req));
    ArgumentCaptor<User> cap = ArgumentCaptor.forClass(User.class);
    verify(users).save(cap.capture());
    assertEquals("USER", cap.getValue().getRole());
  }

  @Test
  void registerDuplicateFails() {
    RegisterRequest req = new RegisterRequest();
    req.setUsername("ivan");
    req.setPassword("secret123");
    when(users.findByEmail("ivan@corp-sec.ru")).thenReturn(Optional.of(User.builder().build()));
    assertThrows(IllegalArgumentException.class, () -> svc().register(req));
  }

  @Test
  void loginWrongPasswordFails() {
    LoginRequest req = new LoginRequest();
    req.setEmail("ivan@corp-sec.ru");
    req.setPassword("nope");
    User u = User.builder().email("ivan@corp-sec.ru").passwordHash("h").role("USER").build();
    when(users.findByEmail("ivan@corp-sec.ru")).thenReturn(Optional.of(u));
    when(encoder.matches("nope", "h")).thenReturn(false);
    assertThrows(IllegalArgumentException.class, () -> svc().login(req));
  }
}
