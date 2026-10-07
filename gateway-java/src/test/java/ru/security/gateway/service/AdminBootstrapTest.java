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
import ru.security.gateway.domain.User;
import ru.security.gateway.repository.UserRepository;

@ExtendWith(MockitoExtension.class)
class AdminBootstrapTest {
  @Mock UserRepository users;
  @Mock PasswordEncoder encoder;

  @Test
  void createsAdminWhenAbsent() {
    when(users.findByEmail("admin@corp-sec.ru")).thenReturn(Optional.empty());
    when(users.findByUsername("admin")).thenReturn(Optional.empty());
    when(encoder.encode("admin")).thenReturn("h");
    AdminBootstrap b = new AdminBootstrap(users, encoder);
    ReflectionTestUtils.setField(b, "mailDomain", "corp-sec.ru");
    ReflectionTestUtils.setField(b, "adminPassword", "admin");
    b.run();
    ArgumentCaptor<User> cap = ArgumentCaptor.forClass(User.class);
    verify(users).save(cap.capture());
    assert cap.getValue().getRole().equals("ADMIN");
  }

  @Test
  void skipsWhenExists() {
    when(users.findByEmail("admin@corp-sec.ru")).thenReturn(Optional.of(User.builder().build()));
    AdminBootstrap b = new AdminBootstrap(users, encoder);
    ReflectionTestUtils.setField(b, "mailDomain", "corp-sec.ru");
    ReflectionTestUtils.setField(b, "adminPassword", "admin");
    b.run();
    verify(users, never()).save(any());
  }
}
