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
import ru.security.gateway.domain.ThreatCategory;
import ru.security.gateway.domain.ThreatRoutingRule;
import ru.security.gateway.domain.User;
import ru.security.gateway.repository.SystemSettingRepository;
import ru.security.gateway.repository.ThreatRoutingRuleRepository;
import ru.security.gateway.repository.UserRepository;

/** Домены/алиасы/валидация настроек почты (приём с Gmail без гаданий о поддомене). */
@ExtendWith(MockitoExtension.class)
class SystemSettingServiceTest {
  @Mock SystemSettingRepository repo;
  @Mock ThreatRoutingRuleRepository rulesRepo;
  @Mock UserRepository usersRepo;

  private SystemSettingService svc(String envDomain) {
    SystemSettingService s = new SystemSettingService(repo, rulesRepo, usersRepo);
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
    when(rulesRepo.findAll()).thenReturn(List.of());
    when(usersRepo.findAll()).thenReturn(List.of());
    SystemSetting out = svc("x").updateSettings("HotCodeBand.RU",
        List.of("mail.hotcodeband.ru", " mail.hotcodeband.ru ", "hotcodeband.ru"), true, "smtp.x.ru", 587)
        .settings();
    assertEquals("hotcodeband.ru", out.getPrimaryDomain());
    assertEquals(List.of("hotcodeband.ru", "mail.hotcodeband.ru"),
        List.of(out.getAllowedDomains()));
    assertTrue(out.isRelayEnabled());
  }

  @Test
  void updateRebasesInternalRuleAndUserEmails() {
    SystemSetting old = SystemSetting.builder().id(1).primaryDomain("old.ru")
        .allowedDomains(new String[]{"old.ru", "mail.old.ru"})
        .relayEnabled(false).relayHost("localhost").relayPort(1025).build();
    when(repo.findById(1)).thenReturn(Optional.of(old));
    when(repo.save(any())).thenAnswer(inv -> inv.getArgument(0));
    ThreatRoutingRule rule = ThreatRoutingRule.builder().category(ThreatCategory.TERRORISM)
        .destinationEmails(new String[]{"infosec@old.ru", "soc@gmail.com"}).build();
    when(rulesRepo.findAll()).thenReturn(List.of(rule));
    User bob = User.builder().username("bob").email("bob@mail.old.ru").passwordHash("h").build();
    User dup = User.builder().username("a2").email("a@old.ru").passwordHash("h").build();
    User busy = User.builder().username("a1").email("a@new.ru").passwordHash("h").build();
    when(usersRepo.findAll()).thenReturn(List.of(bob, dup, busy));

    var res = svc("x").updateSettings("new.ru", List.of("new.ru"), false, "localhost", 1025);

    assertArrayEquals(new String[]{"infosec@new.ru", "soc@gmail.com"}, rule.getDestinationEmails());
    assertEquals("bob@new.ru", bob.getEmail());
    assertEquals("a@old.ru", dup.getEmail()); // коллизия — пропуск
    assertEquals(List.of("a@old.ru"), res.skippedUsers());
    assertEquals(1, res.rebasedRules());
    assertEquals(1, res.rebasedUsers());
  }

  @Test
  void rebaseKeepsExternalAndBroken() {
    var old = java.util.Set.of("old.ru", "mail.old.ru");
    assertEquals("x@new.ru", SystemSettingService.rebaseInternalEmail("x@old.ru", old, "new.ru"));
    assertEquals("x@new.ru", SystemSettingService.rebaseInternalEmail("x@new.ru", old, "new.ru"));
    assertEquals("soc@gmail.com", SystemSettingService.rebaseInternalEmail("soc@gmail.com", old, "new.ru"));
    assertEquals("кривой", SystemSettingService.rebaseInternalEmail("кривой", old, "new.ru"));
    assertNull(SystemSettingService.rebaseInternalEmail(null, old, "new.ru"));
  }
}
