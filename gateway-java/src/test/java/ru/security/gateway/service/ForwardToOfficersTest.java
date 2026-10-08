package ru.security.gateway.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import jakarta.mail.internet.MimeMessage;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.web.client.RestTemplate;
import ru.security.gateway.domain.DeliveryLog;
import ru.security.gateway.domain.Message;
import ru.security.gateway.domain.MessageStatus;
import ru.security.gateway.domain.SystemSetting;
import ru.security.gateway.domain.MessageThreatAnalysis;
import ru.security.gateway.domain.ThreatCategory;
import ru.security.gateway.domain.ThreatRoutingRule;
import ru.security.gateway.repository.*;

/**
 * Ручная отправка копии безопасникам: оригинал без изменений (кроме конверта),
 * статус → FORWARDED, в логах — FORWARDED_TO_SECURITY.
 */
@ExtendWith(MockitoExtension.class)
class ForwardToOfficersTest {
  @Mock MessageRepository messages;
  @Mock MessageParsedDataRepository parsedRepo;
  @Mock MessageAttachmentRepository attachmentRepo;
  @Mock MessageLinkRepository linkRepo;
  @Mock MessageThreatAnalysisRepository analysisRepo;
  @Mock ThreatRoutingRuleRepository rulesRepo;
  @Mock ThreatStopwordRepository stopwordRepo;
  @Mock DeliveryLogRepository deliveryRepo;
  @Mock JavaMailSender mailSender;
  @Mock RestTemplate restTemplate;
  @Mock org.springframework.beans.factory.ObjectProvider<InboundPipelineService> self;
  @Mock SystemSettingService systemSettingService;

  InboundPipelineService svc;
  Message msg;

  @BeforeEach
  void setUp() {
    svc = new InboundPipelineService(messages, parsedRepo, attachmentRepo, linkRepo,
        analysisRepo, rulesRepo, stopwordRepo, deliveryRepo, mailSender, restTemplate, self,
        systemSettingService);
    lenient().when(systemSettingService.getSettings()).thenReturn(relayOn());
    byte[] raw = ("From: a@test.local\r\nTo: b@test.local\r\nSubject: hi\r\n"
        + "Content-Type: text/plain; charset=utf-8\r\n\r\nhello").getBytes(java.nio.charset.StandardCharsets.UTF_8);
    msg = Message.builder().senderEmail("a@test.local").recipientEmail("b@test.local")
        .subject("hi").rawContent(raw).status(MessageStatus.REROUTED).build();
  }

  private void stubFound() {
    when(messages.findById(any(UUID.class))).thenReturn(Optional.of(msg));
  }

  /** Правило категории MAN_MADE → soc@test.local. Только для позитивных сценариев. */
  private void stubRule() {
    stubFound();
    when(analysisRepo.findByMessageId(any(UUID.class))).thenReturn(Optional.of(
        MessageThreatAnalysis.builder().finalVerdict(ThreatCategory.MAN_MADE).build()));
    when(rulesRepo.findByCategory(ThreatCategory.MAN_MADE)).thenReturn(Optional.of(
        ThreatRoutingRule.builder().category(ThreatCategory.MAN_MADE)
            .destinationEmails(new String[]{"soc@test.local"}).build()));
  }

  @Test
  void forwardMergesRuleAndExtraRecipients() throws Exception {
    stubRule();
    List<String> to = svc.forwardToOfficers(msg.getId(),
        List.of("boss@test.local", "soc@test.local"), "admin@test.local", "вторая пара глаз");

    assertEquals(List.of("soc@test.local", "boss@test.local"), to);
    assertEquals(MessageStatus.FORWARDED, msg.getStatus());
    ArgumentCaptor<MimeMessage> mail = ArgumentCaptor.forClass(MimeMessage.class);
    verify(mailSender).send(mail.capture());
    // Тело и тема оригинала без изменений, конверт — на безопасников.
    assertEquals("hi", mail.getValue().getSubject());
    assertEquals("hello", mail.getValue().getContent().toString().trim());
    assertEquals(2, mail.getValue().getAllRecipients().length);
    ArgumentCaptor<DeliveryLog> log = ArgumentCaptor.forClass(DeliveryLog.class);
    verify(deliveryRepo).save(log.capture());
    assertEquals("FORWARDED_TO_SECURITY", log.getValue().getActionTaken());
    assertArrayEquals(new String[]{"soc@test.local", "boss@test.local"},
        log.getValue().getDestinationRecipients());
    assertTrue(log.getValue().getSmtpResponse().contains("admin@test.local"));
    assertTrue(log.getValue().getSmtpResponse().contains("вторая пара глаз"));
    assertTrue(log.getValue().isSuccess());
  }

  @Test
  void forwardRuleOnlyWhenNoExtras() {
    stubRule();
    List<String> to = svc.forwardToOfficers(msg.getId(), null, "admin@test.local", null);

    assertEquals(List.of("soc@test.local"), to);
    assertEquals(MessageStatus.FORWARDED, msg.getStatus());
  }

  @Test
  void forwardFallsBackToInfosecWhenRuleMissing() {
    stubFound();
    when(analysisRepo.findByMessageId(any(UUID.class))).thenReturn(Optional.of(
        MessageThreatAnalysis.builder().finalVerdict(ThreatCategory.MAN_MADE).build()));
    when(rulesRepo.findByCategory(ThreatCategory.MAN_MADE)).thenReturn(Optional.empty());

    List<String> to = svc.forwardToOfficers(msg.getId(), null, "admin@test.local", null);

    assertEquals(List.of("infosec@test.local"), to);
  }

  @Test
  void forwardRepeatFromForwardedRejected() {
    msg.setStatus(MessageStatus.FORWARDED);
    stubFound();

    assertThrows(IllegalArgumentException.class,
        () -> svc.forwardToOfficers(msg.getId(), null, "admin@test.local", null));
    verifyNoInteractions(mailSender);
    verify(deliveryRepo, never()).save(any());
  }

  @Test
  void forwardNonQuarantinedRejected() {
    msg.setStatus(MessageStatus.DELIVERED);
    stubFound();

    assertThrows(IllegalArgumentException.class,
        () -> svc.forwardToOfficers(msg.getId(), null, "admin@test.local", null));
    verifyNoInteractions(mailSender);
    verify(deliveryRepo, never()).save(any());
  }

  @Test
  void forwardMissingThrows() {
    when(messages.findById(any(UUID.class))).thenReturn(Optional.empty());
    assertThrows(NoSuchElementException.class,
        () -> svc.forwardToOfficers(UUID.randomUUID(), null, "admin@test.local", null));
  }

  @Test
  void forwardSmtpFailureKeepsQuarantine() {
    stubRule();
    doThrow(new RuntimeException("relay down")).when(mailSender).send(any(MimeMessage.class));

    assertThrows(RuntimeException.class,
        () -> svc.forwardToOfficers(msg.getId(), null, "admin@test.local", null));
    assertEquals(MessageStatus.REROUTED, msg.getStatus());
    ArgumentCaptor<DeliveryLog> log = ArgumentCaptor.forClass(DeliveryLog.class);
    verify(deliveryRepo).save(log.capture());
    assertEquals("FORWARDED_TO_SECURITY", log.getValue().getActionTaken());
    assertFalse(log.getValue().isSuccess());
  }

  @Test
  void relayDisabledForwardsLocallyWithoutSmtp() {
    when(systemSettingService.getSettings()).thenReturn(SystemSetting.builder()
        .id(1).primaryDomain("test.local").allowedDomains(new String[]{"test.local"})
        .relayEnabled(false).relayHost("localhost").relayPort(1025).build());
    stubRule();

    List<String> to = svc.forwardToOfficers(msg.getId(), null, "admin@test.local", null);

    assertEquals(List.of("soc@test.local"), to);
    assertEquals(MessageStatus.FORWARDED, msg.getStatus());
    verify(mailSender, never()).send(any(MimeMessage.class));
    ArgumentCaptor<DeliveryLog> log = ArgumentCaptor.forClass(DeliveryLog.class);
    verify(deliveryRepo).save(log.capture());
    assertEquals("FORWARDED_TO_SECURITY", log.getValue().getActionTaken());
    assertTrue(log.getValue().isSuccess());
  }

  private static SystemSetting relayOn() {
    return SystemSetting.builder()
        .id(1).primaryDomain("test.local").allowedDomains(new String[]{"test.local"})
        .relayEnabled(true).relayHost("localhost").relayPort(1025).build();
  }
}
