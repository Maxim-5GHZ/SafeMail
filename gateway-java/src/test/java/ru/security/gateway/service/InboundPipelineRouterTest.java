package ru.security.gateway.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Properties;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.web.client.RestTemplate;
import ru.security.gateway.domain.DeliveryLog;
import ru.security.gateway.domain.Message;
import ru.security.gateway.domain.MessageStatus;
import ru.security.gateway.domain.SystemSetting;
import ru.security.gateway.repository.*;

/**
 * Роутер без БД и без ML: NONE — оригинал дальше, угроза без правила —
 * на infosec@&lt;mail.domain&gt;, падение ML — fallback в доставку.
 */
@ExtendWith(MockitoExtension.class)
@SuppressWarnings({"unchecked", "rawtypes"})
class InboundPipelineRouterTest {
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
    lenient().when(systemSettingService.getSettings()).thenReturn(SystemSetting.builder()
        .id(1).primaryDomain("test.local").allowedDomains(new String[]{"test.local"})
        .relayEnabled(true).relayHost("localhost").relayPort(1025).build());
    byte[] raw = ("From: a@test.local\r\nTo: b@test.local\r\nSubject: hi\r\n"
        + "Content-Type: text/plain; charset=utf-8\r\n\r\nhello").getBytes(java.nio.charset.StandardCharsets.UTF_8);
    msg = Message.builder().senderEmail("a@test.local").recipientEmail("b@test.local")
        .subject("hi").rawContent(raw).status(MessageStatus.PENDING).build();
    lenient().when(messages.claimAsInProgress(any(UUID.class))).thenReturn(1);
    lenient().when(messages.findById(any(UUID.class))).thenReturn(Optional.of(msg));
    lenient().when(parsedRepo.findByMessageId(any())).thenReturn(Optional.empty());
    lenient().when(analysisRepo.findByMessageId(any())).thenReturn(Optional.empty());
    lenient().when(linkRepo.findByMessageId(any())).thenReturn(List.of());
    lenient().when(stopwordRepo.findByActiveTrue()).thenReturn(List.of());
    lenient().when(mailSender.createMimeMessage())
        .thenAnswer(inv -> new MimeMessage(Session.getInstance(new Properties())));
  }

  private void stubMl(String category) {
    when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class),
        any(ParameterizedTypeReference.class))).thenAnswer(inv -> {
          String url = inv.getArgument(0);
          if (url.contains("parse-extract")) {
            return new ResponseEntity<>(Map.of("clean_text", "hello", "links", List.of(),
                "attachments", List.of()), HttpStatus.OK);
          }
          if (url.contains("normalize-enrich")) {
            return new ResponseEntity<>(Map.of("normalized_text", "hello", "links", List.of(),
                "speller_fixes", List.of()), HttpStatus.OK);
          }
          return new ResponseEntity<>(Map.of("category", category, "confidence", 0.9,
              "explanation", "t", "heuristic_score", 0.1, "heuristic_flags", List.of(),
              "semantic_category", "TERRORISM", "semantic_score", 0.83,
              "semantic_comment", "SLM поймала парафраз «TERRORISM» (0.83)."),
              HttpStatus.OK);
        });
  }

  @Test
  void cleanDeliveredOriginal() {
    stubMl("NONE");
    svc.processClaimed(msg.getId());
    assertEquals(MessageStatus.DELIVERED, msg.getStatus());
    ArgumentCaptor<DeliveryLog> cap = ArgumentCaptor.forClass(DeliveryLog.class);
    verify(deliveryRepo).save(cap.capture());
    assertEquals("FORWARDED_ORIGINAL", cap.getValue().getActionTaken());
    verify(mailSender).send(any(MimeMessage.class));
  }

  @Test
  void relayDisabledStoresCleanLocally() {
    when(systemSettingService.getSettings()).thenReturn(SystemSetting.builder()
        .id(1).primaryDomain("test.local").allowedDomains(new String[]{"test.local"})
        .relayEnabled(false).relayHost("localhost").relayPort(1025).build());
    stubMl("NONE");
    svc.processClaimed(msg.getId());
    assertEquals(MessageStatus.DELIVERED, msg.getStatus());
    ArgumentCaptor<DeliveryLog> cap = ArgumentCaptor.forClass(DeliveryLog.class);
    verify(deliveryRepo).save(cap.capture());
    assertEquals("STORED_LOCALLY", cap.getValue().getActionTaken());
    assertTrue(cap.getValue().isSuccess());
    verify(mailSender, never()).send(any(MimeMessage.class));
  }

  @Test
  void relayDisabledQuarantinesLocally() {
    when(systemSettingService.getSettings()).thenReturn(SystemSetting.builder()
        .id(1).primaryDomain("test.local").allowedDomains(new String[]{"test.local"})
        .relayEnabled(false).relayHost("localhost").relayPort(1025).build());
    stubMl("MAN_MADE");
    when(rulesRepo.findByCategory(any())).thenReturn(Optional.empty());
    svc.processClaimed(msg.getId());
    assertEquals(MessageStatus.REROUTED, msg.getStatus());
    ArgumentCaptor<DeliveryLog> cap = ArgumentCaptor.forClass(DeliveryLog.class);
    verify(deliveryRepo).save(cap.capture());
    assertEquals("REROUTED_TO_SECURITY", cap.getValue().getActionTaken());
    assertTrue(cap.getValue().isSuccess());
    verify(mailSender, never()).send(any(MimeMessage.class));
  }

  @Test
  void threatWithoutRuleGoesToDomainInfosec() throws Exception {
    stubMl("MAN_MADE");
    when(rulesRepo.findByCategory(any())).thenReturn(Optional.empty());
    svc.processClaimed(msg.getId());
    assertEquals(MessageStatus.REROUTED, msg.getStatus());
    ArgumentCaptor<MimeMessage> mail = ArgumentCaptor.forClass(MimeMessage.class);
    verify(mailSender).send(mail.capture());
    String rcpt = String.valueOf(mail.getValue().getAllRecipients()[0]);
    assertTrue(rcpt.contains("infosec@test.local"), rcpt);
    ArgumentCaptor<DeliveryLog> cap = ArgumentCaptor.forClass(DeliveryLog.class);
    verify(deliveryRepo).save(cap.capture());
    assertEquals("REROUTED_TO_SECURITY", cap.getValue().getActionTaken());
  }

  @Test
  void mlDownFallsBackToDelivery() {
    when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class),
        any(ParameterizedTypeReference.class))).thenThrow(new RuntimeException("ML down"));
    svc.processClaimed(msg.getId());
    assertEquals(MessageStatus.DELIVERED, msg.getStatus());
  }

  @Test
  void alreadyClaimedSkipped() {
    when(messages.claimAsInProgress(any(UUID.class))).thenReturn(0);
    svc.processClaimed(msg.getId());
    assertEquals(MessageStatus.PENDING, msg.getStatus());
    verifyNoInteractions(restTemplate);
  }

  @Test
  @SuppressWarnings("unchecked")
  void activeStopwordsForwardedToClassify() {
    when(stopwordRepo.findByActiveTrue()).thenReturn(List.of(
        ru.security.gateway.domain.ThreatStopword.builder()
            .pattern("обнал").category(ru.security.gateway.domain.ThreatCategory.ILLEGAL_ACTIONS).build()));
    stubMl("NONE");
    svc.processClaimed(msg.getId());
    ArgumentCaptor<HttpEntity> bodies = ArgumentCaptor.forClass(HttpEntity.class);
    verify(restTemplate, atLeastOnce()).exchange(
        argThat((String url) -> url != null && url.contains("classify-threat")),
        eq(HttpMethod.POST), bodies.capture(), any(ParameterizedTypeReference.class));
    Object body = bodies.getValue().getBody();
    assertInstanceOf(Map.class, body);
    Object sw = ((Map<?, ?>) body).get("stopwords");
    assertInstanceOf(List.class, sw);
    assertEquals(1, ((List<?>) sw).size());
    assertEquals("обнал", ((Map<?, ?>) ((List<?>) sw).get(0)).get("pattern"));
  }

  @Test
  void semanticCommentPersistedToAnalysis() {
    stubMl("NONE");
    svc.processClaimed(msg.getId());
    ArgumentCaptor<ru.security.gateway.domain.MessageThreatAnalysis> cap =
        ArgumentCaptor.forClass(ru.security.gateway.domain.MessageThreatAnalysis.class);
    verify(analysisRepo).save(cap.capture());
    assertEquals(ru.security.gateway.domain.ThreatCategory.TERRORISM,
        cap.getValue().getSemanticCategory());
    assertEquals(0.83, cap.getValue().getSemanticScore().doubleValue(), 1e-9);
    assertTrue(cap.getValue().getSemanticComment().contains("поймала парафраз"),
        cap.getValue().getSemanticComment());
  }
}
