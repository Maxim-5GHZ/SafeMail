package ru.security.gateway.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.Properties;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.client.RestTemplate;
import ru.security.gateway.domain.DeliveryLog;
import ru.security.gateway.domain.Message;
import ru.security.gateway.domain.MessageStatus;
import ru.security.gateway.repository.*;

/**
 * Ручной выпуск из карантина: оригинал — исходному получателю,
 * статус → DELIVERED, в логах — RELEASED_BY_ADMIN с email админа.
 */
@ExtendWith(MockitoExtension.class)
class ReleaseFromQuarantineTest {
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

  InboundPipelineService svc;
  Message msg;

  @BeforeEach
  void setUp() {
    svc = new InboundPipelineService(messages, parsedRepo, attachmentRepo, linkRepo,
        analysisRepo, rulesRepo, stopwordRepo, deliveryRepo, mailSender, restTemplate, self);
    ReflectionTestUtils.setField(svc, "mailDomain", "test.local");
    byte[] raw = ("From: a@test.local\r\nTo: b@test.local\r\nSubject: hi\r\n"
        + "Content-Type: text/plain; charset=utf-8\r\n\r\nhello").getBytes(java.nio.charset.StandardCharsets.UTF_8);
    msg = Message.builder().senderEmail("a@test.local").recipientEmail("b@test.local")
        .subject("hi").rawContent(raw).status(MessageStatus.REROUTED).build();
  }

  @Test
  void releaseDeliversOriginalWithAudit() throws Exception {
    when(messages.findById(any(UUID.class))).thenReturn(Optional.of(msg));

    svc.releaseFromQuarantine(msg.getId(), "admin@test.local", "ложное срабатывание");

    assertEquals(MessageStatus.DELIVERED, msg.getStatus());
    ArgumentCaptor<MimeMessage> mail = ArgumentCaptor.forClass(MimeMessage.class);
    verify(mailSender).send(mail.capture());
    assertEquals("hi", mail.getValue().getSubject());
    ArgumentCaptor<DeliveryLog> log = ArgumentCaptor.forClass(DeliveryLog.class);
    verify(deliveryRepo).save(log.capture());
    assertEquals("RELEASED_BY_ADMIN", log.getValue().getActionTaken());
    assertArrayEquals(new String[]{"b@test.local"}, log.getValue().getDestinationRecipients());
    assertTrue(log.getValue().getSmtpResponse().contains("admin@test.local"));
    assertTrue(log.getValue().getSmtpResponse().contains("ложное срабатывание"));
    assertTrue(log.getValue().isSuccess());
  }

  @Test
  void releaseWithoutReasonStillAudited() {
    when(messages.findById(any(UUID.class))).thenReturn(Optional.of(msg));

    svc.releaseFromQuarantine(msg.getId(), "admin@test.local", null);

    assertEquals(MessageStatus.DELIVERED, msg.getStatus());
    ArgumentCaptor<DeliveryLog> log = ArgumentCaptor.forClass(DeliveryLog.class);
    verify(deliveryRepo).save(log.capture());
    assertEquals("released by admin@test.local", log.getValue().getSmtpResponse());
  }

  @Test
  void releaseNonQuarantinedRejected() {
    msg.setStatus(MessageStatus.DELIVERED);
    when(messages.findById(any(UUID.class))).thenReturn(Optional.of(msg));

    assertThrows(IllegalArgumentException.class,
        () -> svc.releaseFromQuarantine(msg.getId(), "admin@test.local", null));
    verifyNoInteractions(mailSender);
    verify(deliveryRepo, never()).save(any());
  }

  @Test
  void releaseFromForwardedAlsoDelivers() {
    msg.setStatus(MessageStatus.FORWARDED);
    when(messages.findById(any(UUID.class))).thenReturn(Optional.of(msg));

    svc.releaseFromQuarantine(msg.getId(), "admin@test.local", "проверили у ИБ");

    assertEquals(MessageStatus.DELIVERED, msg.getStatus());
    verify(mailSender).send(any(MimeMessage.class));
  }

  @Test
  void releaseMissingThrows() {
    when(messages.findById(any(UUID.class))).thenReturn(Optional.empty());
    assertThrows(NoSuchElementException.class,
        () -> svc.releaseFromQuarantine(UUID.randomUUID(), "admin@test.local", null));
  }

  @Test
  void releaseSmtpFailureKeepsQuarantine() {
    when(messages.findById(any(UUID.class))).thenReturn(Optional.of(msg));
    doThrow(new RuntimeException("relay down")).when(mailSender).send(any(MimeMessage.class));

    assertThrows(RuntimeException.class,
        () -> svc.releaseFromQuarantine(msg.getId(), "admin@test.local", null));
    assertEquals(MessageStatus.REROUTED, msg.getStatus());
    ArgumentCaptor<DeliveryLog> log = ArgumentCaptor.forClass(DeliveryLog.class);
    verify(deliveryRepo).save(log.capture());
    assertEquals("RELEASED_BY_ADMIN", log.getValue().getActionTaken());
    assertFalse(log.getValue().isSuccess());
  }
}
