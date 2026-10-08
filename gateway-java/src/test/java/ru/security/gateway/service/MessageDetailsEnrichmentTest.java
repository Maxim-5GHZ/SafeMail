package ru.security.gateway.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import ru.security.gateway.domain.*;
import ru.security.gateway.dto.MessageDto;
import ru.security.gateway.repository.*;

/**
 * Регрессия инженерной шторки (/admin): деталка обязана отдавать
 * normalized_text, details ссылок (reasons) и delivery_logs (маршрут).
 */
@ExtendWith(MockitoExtension.class)
class MessageDetailsEnrichmentTest {
  @Mock MessageRepository messages;
  @Mock MessageParsedDataRepository parsedRepo;
  @Mock MessageAttachmentRepository attachmentRepo;
  @Mock MessageLinkRepository linkRepo;
  @Mock MessageThreatAnalysisRepository analysisRepo;
  @Mock ThreatRoutingRuleRepository rulesRepo;
  @Mock DeliveryLogRepository deliveryRepo;
  @Mock SystemSettingService systemSettingService;

  private MessageService svc() {
    return new MessageService(messages, parsedRepo, attachmentRepo, linkRepo, analysisRepo, rulesRepo,
        deliveryRepo, systemSettingService, new com.fasterxml.jackson.databind.ObjectMapper());
  }

  @org.junit.jupiter.api.AfterEach
  void clearAuth() {
    org.springframework.security.core.context.SecurityContextHolder.clearContext();
  }

  @Test
  void detailsExposeNormalizedLinkDetailsAndDeliveries() {
    // Шторка — инструмент админа: карантин виден только с ROLE_ADMIN.
    org.springframework.security.core.context.SecurityContextHolder.getContext().setAuthentication(
        new org.springframework.security.authentication.UsernamePasswordAuthenticationToken(
            "admin@corp-sec.ru", null,
            List.of(new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_ADMIN"))));
    UUID id = UUID.randomUUID();
    Message m = Message.builder().senderEmail("a@evil.ru").recipientEmail("bob@corp-sec.ru")
        .subject("t").status(MessageStatus.REROUTED).build();
    m.setId(id);
    when(messages.findById(id)).thenReturn(Optional.of(m));
    when(parsedRepo.findByMessageId(id)).thenReturn(Optional.of(
        MessageParsedData.builder().messageId(id).cleanText("б0мба").normalizedText("бомба").build()));
    when(linkRepo.findByMessageId(id)).thenReturn(List.of(
        MessageLink.builder().messageId(id).url("http://track-sabotage-leak.ru/login")
            .status(LinkStatus.MALICIOUS).reputationScore(80)
            .details("{\"url\":\"http://track-sabotage-leak.ru/login\",\"reasons\":[\"blacklist\"]}")
            .build()));
    when(attachmentRepo.findByMessageId(id)).thenReturn(List.of());
    when(analysisRepo.findByMessageId(id)).thenReturn(Optional.of(
        MessageThreatAnalysis.builder().messageId(id).finalVerdict(ThreatCategory.TERRORISM)
            .spellerFixes("[{\"original\":\"б0мба\",\"suggested\":\"бомба\"}]").build()));
    when(deliveryRepo.findByMessageId(id)).thenReturn(List.of(
        DeliveryLog.builder().messageId(id).actionTaken("QUARANTINE_REROUTE")
            .destinationRecipients(new String[]{"infosec@corp-sec.ru"}).success(true).build()));

    MessageDto dto = svc().getMessageDetails(id);

    assertEquals("бомба", dto.getNormalizedText());
    assertEquals(1, dto.getLinks().size());
    assertTrue(dto.getLinks().get(0).getDetails() instanceof Map);
    assertEquals(List.of("blacklist"),
        ((Map<?, ?>) dto.getLinks().get(0).getDetails()).get("reasons"));
    assertTrue(dto.getThreat().getSpellerFixes() instanceof List);
    assertEquals(1, dto.getDeliveries().size());
    assertEquals("QUARANTINE_REROUTE", dto.getDeliveries().get(0).getActionTaken());
    assertArrayEquals(new String[]{"infosec@corp-sec.ru"},
        dto.getDeliveries().get(0).getDestinationRecipients());
  }
}
