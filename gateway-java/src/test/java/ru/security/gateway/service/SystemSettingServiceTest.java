package ru.security.gateway.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
import ru.security.gateway.domain.SystemSetting;
import ru.security.gateway.repository.SystemSettingRepository;

/** Домены/алиасы/валидация настроек почты (приём с Gmail без гаданий о поддомене). */
@ExtendWith(MockitoExtension.class)
class SystemSettingServiceTest {
  @Mock SystemSettingRepository repo;

  private SystemSettingService svc(String envDomain) {
    SystemSettingService s = new SystemSettingService(repo);
    ReflectionTestUtils.setField(s, "defaultEnvDomain", envDomain);
    return s;
  }

  private static SystemSetting stored() {
    return SystemSetting.builder().id(1).primaryDomain("mail.hotcodeband.ru")
        .allowedDomains(new String[]{"mail.hotcodeband.ru", "hotcodeband.ru"})
        .relayEnabled(false).relayHost("localhost").relayPort(1025).build();
  }

  @Test
  void seedAddsBaseDomainAlias() {
    when(repo.findById(1)).thenReturn(Optional.empty());
    svc("mail.hotcodeband.ru").run();
    var cap = org.mockito.ArgumentCaptor.forClass(SystemSetting.class);
    verify(repo).save(cap.capture());
    assertEquals("mail.hotcodeband.ru", cap.getValue().getPrimaryDomain());
    assertArrayEquals(new String[]{"mail.hotcodeband.ru", "hotcodeband.ru"},
        cap.getValue().getAllowedDomains());
  }

  @Test
  void seedAddsMailAlias() {
    when(repo.findById(1)).thenReturn(Optional.empty());
    svc("hotcodeband.ru").run();
    var cap = org.mockito.ArgumentCaptor.forClass(SystemSetting.class);
    verify(repo).save(cap.capture());
    assertArrayEquals(new String[]{"hotcodeband.ru", "mail.hotcodeband.ru"},
        cap.getValue().getAllowedDomains());
  }

  @Test
  void seedSkippedWhenRowExists() {
    when(repo.findById(1)).thenReturn(Optional.of(stored()));
    svc("other.ru").run();
    verify(repo, never()).save(any());
  }

  @Test
  void localDomainMatchesPrimaryAndAliases() {
    when(repo.findById(1)).thenReturn(Optional.of(stored()));
    SystemSettingService s = svc("mail.hotcodeband.ru");
    assertTrue(s.isLocalDomain("mail.hotcodeband.ru"));
    assertTrue(s.isLocalDomain("hotcodeband.ru"));
    assertTrue(s.isLocalDomain("MAIL.HOTCODEBAND.RU"));
    assertFalse(s.isLocalDomain("gmail.com"));
    assertFalse(s.isLocalDomain(null));
    assertFalse(s.isLocalDomain(""));
  }

  @Test
  void badDomainsRejected() {
    assertThrows(IllegalArgumentException.class, () -> SystemSettingService.normalizeDomain(""));
    assertThrows(IllegalArgumentException.class, () -> SystemSettingService.normalizeDomain("nodot"));
    assertThrows(IllegalArgumentException.class, () -> SystemSettingService.normalizeDomain("bad domain.ru"));
    assertEquals("hotcodeband.ru", SystemSettingService.normalizeDomain("  HotCodeBand.RU  "));
  }

  @Test
  void updateKeepsPrimaryFirst() {
    when(repo.findById(1)).thenReturn(Optional.of(stored()));
    when(repo.save(any())).thenAnswer(inv -> inv.getArgument(0));
    SystemSetting out = svc("x").updateSettings("HotCodeBand.RU",
        List.of("mail.hotcodeband.ru", " mail.hotcodeband.ru ", "hotcodeband.ru"), true, "smtp.x.ru", 587);
    assertEquals("hotcodeband.ru", out.getPrimaryDomain());
    assertEquals(List.of("hotcodeband.ru", "mail.hotcodeband.ru"),
        List.of(out.getAllowedDomains()));
    assertTrue(out.isRelayEnabled());
  }
}
