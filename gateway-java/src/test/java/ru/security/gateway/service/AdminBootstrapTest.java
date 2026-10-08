package ru.security.gateway.service;

import static org.mockito.Mockito.*;

import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import ru.security.gateway.domain.SystemSetting;
import ru.security.gateway.domain.User;
import ru.security.gateway.repository.UserRepository;

@ExtendWith(MockitoExtension.class)
class AdminBootstrapTest {
  @Mock UserRepository users;
  @Mock PasswordEncoder encoder;
  @Mock SystemSettingService systemSettingService;

  private AdminBootstrap bootstrap() {
    lenient().when(systemSettingService.getSettings()).thenReturn(SystemSetting.builder()
        .id(1).primaryDomain("corp-sec.ru").allowedDomains(new String[]{"corp-sec.ru"})
        .relayEnabled(false).build());
    AdminBootstrap b = new AdminBootstrap(users, encoder, systemSettingService);
    ReflectionTestUtils.setField(b, "adminPassword", "admin");
    return b;
  }

  @Test
  void createsAdminWhenAbsent() {
    when(users.findByEmail("admin@corp-sec.ru")).thenReturn(Optional.empty());
    when(users.findByUsername("admin")).thenReturn(Optional.empty());
    when(encoder.encode("admin")).thenReturn("h");
    bootstrap().run();
    ArgumentCaptor<User> cap = ArgumentCaptor.forClass(User.class);
    verify(users).save(cap.capture());
    assert cap.getValue().getRole().equals("ADMIN");
  }

  @Test
  void skipsWhenExists() {
    when(users.findByEmail("admin@corp-sec.ru")).thenReturn(Optional.of(User.builder().build()));
    bootstrap().run();
    verify(users, never()).save(any());
  }
}
