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
import ru.security.gateway.repository.ThreatRoutingRuleRepository;

/** Сидер адресов ИБ: чинит исторический сид V1, ручные внешние адреса не трогает. */
@ExtendWith(MockitoExtension.class)
class RoutingRuleSeederTest {
  @Mock ThreatRoutingRuleRepository rulesRepo;
  @Mock SystemSettingService settings;

  private RoutingRuleSeeder seeder(String... routes) {
    RoutingRuleSeeder s = new RoutingRuleSeeder(rulesRepo, settings);
    String[] names = {"routeTerrorism", "routeManMade", "routeIllegal", "routeOther"};
    for (int i = 0; i < names.length; i++) {
      ReflectionTestUtils.setField(s, names[i], i < routes.length ? routes[i] : "");
    }
    return s;
  }

  private void primary(String domain) {
    when(settings.getSettings()).thenReturn(SystemSetting.builder().id(1)
        .primaryDomain(domain).allowedDomains(new String[]{domain})
        .relayEnabled(false).relayHost("localhost").relayPort(1025).build());
  }

  private ThreatRoutingRule rule(ThreatCategory cat, String... emails) {
    ThreatRoutingRule r = ThreatRoutingRule.builder().id(100 + cat.ordinal()).category(cat)
        .destinationEmails(emails).active(true).build();
    lenient().when(rulesRepo.findByCategory(cat)).thenReturn(Optional.of(r));
    return r;
  }

  @Test
  void replacesLegacySeedWithInfosecAtPrimary() {
    primary("new.ru");
    ThreatRoutingRule r = rule(ThreatCategory.TERRORISM, "infosec@corp-sec.ru");
    rule(ThreatCategory.MAN_MADE, "soc@gmail.com");
    rule(ThreatCategory.ILLEGAL_ACTIONS, "infosec@corp-sec.ru", "soc@gmail.com");
    rule(ThreatCategory.OTHER_THREAT, "infosec@new.ru");
    when(rulesRepo.save(any())).thenAnswer(inv -> inv.getArgument(0));

    seeder().run();

    assertArrayEquals(new String[]{"infosec@new.ru"}, r.getDestinationEmails());
    verify(rulesRepo, times(2)).save(any()); // TERRORISM + ILLEGAL_ACTIONS
  }

  @Test
  void routeEnvWinsOverDefault() {
    primary("new.ru");
    ThreatRoutingRule r = rule(ThreatCategory.MAN_MADE, "infosec@corp-sec.ru");
    rule(ThreatCategory.TERRORISM, "soc@gmail.com");
    rule(ThreatCategory.ILLEGAL_ACTIONS, "soc@gmail.com");
    rule(ThreatCategory.OTHER_THREAT, "soc@gmail.com");
    when(rulesRepo.save(any())).thenAnswer(inv -> inv.getArgument(0));

    seeder("", "soc-team@new.ru").run();

    assertArrayEquals(new String[]{"soc-team@new.ru"}, r.getDestinationEmails());
  }

  @Test
  void badRouteEnvFallsBackToPrimary() {
    assertNull(RoutingRuleSeeder.validEmail(""));
    assertNull(RoutingRuleSeeder.validEmail("без-собаки"));
    assertNull(RoutingRuleSeeder.validEmail("x@nodot"));
    assertEquals("Soc@New.RU".toLowerCase(), RoutingRuleSeeder.validEmail("Soc@New.RU"));
  }

  @Test
  void createsMissingRule() {
    primary("new.ru");
    for (ThreatCategory c : ThreatCategory.values()) {
      if (c == ThreatCategory.NONE) continue;
      lenient().when(rulesRepo.findByCategory(c)).thenReturn(Optional.empty());
    }
    when(rulesRepo.save(any())).thenAnswer(inv -> inv.getArgument(0));

    seeder().run();

    var cap = org.mockito.ArgumentCaptor.forClass(ThreatRoutingRule.class);
    verify(rulesRepo, times(4)).save(cap.capture());
    assertTrue(cap.getAllValues().stream().allMatch(r ->
        List.of(r.getDestinationEmails()).equals(List.of("infosec@new.ru"))));
  }
}
