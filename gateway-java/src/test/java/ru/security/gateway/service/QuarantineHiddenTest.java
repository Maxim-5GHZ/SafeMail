package ru.security.gateway.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.mockito.Mockito.lenient;

import jakarta.persistence.criteria.*;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import ru.security.gateway.domain.Message;
import ru.security.gateway.domain.MessageStatus;
import ru.security.gateway.dto.MessageDto;
import ru.security.gateway.repository.*;

/**
 * Получатель не должен знать о карантине: Входящие исключают REROUTED/FORWARDED,
 * деталка и скачивание для не-админа отдают 404. Админ видит всё (шторка /admin).
 */
@ExtendWith(MockitoExtension.class)
@SuppressWarnings({"unchecked", "rawtypes"})
class QuarantineHiddenTest {
  @Mock MessageRepository messages;
  @Mock MessageParsedDataRepository parsedRepo;
  @Mock MessageAttachmentRepository attachmentRepo;
  @Mock MessageLinkRepository linkRepo;
  @Mock MessageThreatAnalysisRepository analysisRepo;
  @Mock ThreatRoutingRuleRepository rulesRepo;
  @Mock DeliveryLogRepository deliveryRepo;

  @AfterEach
  void clearAuth() {
    SecurityContextHolder.clearContext();
  }

  private MessageService svc() {
    return new MessageService(messages, parsedRepo, attachmentRepo, linkRepo, analysisRepo, rulesRepo,
        deliveryRepo, new com.fasterxml.jackson.databind.ObjectMapper());
  }

  private void asAdmin() {
    SecurityContextHolder.getContext().setAuthentication(
        new UsernamePasswordAuthenticationToken("admin@corp-sec.ru", null,
            List.of(new SimpleGrantedAuthority("ROLE_ADMIN"))));
  }

  private void stubEmptyPage() {
    when(messages.findAll(any(Specification.class), any(org.springframework.data.domain.Pageable.class)))
        .thenReturn(new PageImpl<>(List.of()));
  }

  private Specification<Message> captureSpec() {
    ArgumentCaptor<Specification> captor = ArgumentCaptor.forClass(Specification.class);
    verify(messages, atLeastOnce()).findAll(captor.capture(),
        any(org.springframework.data.domain.Pageable.class));
    return captor.getValue();
  }

  private CriteriaBuilder runSpec(Specification<Message> spec) {
    CriteriaBuilder cb = mock(CriteriaBuilder.class);
    spec.toPredicate(mock(Root.class), mock(CriteriaQuery.class), cb);
    return cb;
  }

  @Test
  void inboxExcludesQuarantine() {
    stubEmptyPage();
    svc().getFilteredMessages(null, null, null, null, null, "inbox", PageRequest.of(0, 20));
    Specification<Message> spec = captureSpec();
    Root root = mock(Root.class);
    Path statusPath = mock(Path.class);
    when(root.get("status")).thenReturn(statusPath);
    CriteriaBuilder cb = mock(CriteriaBuilder.class);
    spec.toPredicate(root, mock(CriteriaQuery.class), cb);

    verify(root).get("status");
    verify(statusPath).in(MessageStatus.REROUTED, MessageStatus.FORWARDED);
    verify(cb).not(any());
  }

  @Test
  void sentAndPlainListKeepQuarantine() {
    stubEmptyPage();
    svc().getFilteredMessages(null, null, "a@x.ru", null, null, "sent", PageRequest.of(0, 20));
    verify(runSpec(captureSpec()), never()).not(any());
    svc().getFilteredMessages(null, null, "a@x.ru", null, null, null, PageRequest.of(0, 20));
    verify(runSpec(captureSpec()), never()).not(any());
  }

  private UUID quarantineMessage(MessageStatus status) {
    UUID id = UUID.randomUUID();
    Message m = Message.builder().senderEmail("evil@evil.ru").recipientEmail("bob@corp-sec.ru")
        .subject("t").status(status).build();
    m.setId(id);
    when(messages.findById(id)).thenReturn(Optional.of(m));
    // Деталка карантина для не-админа падает до чтения этих репозиториев — стабы lenient.
    lenient().when(parsedRepo.findByMessageId(id)).thenReturn(Optional.empty());
    lenient().when(linkRepo.findByMessageId(id)).thenReturn(List.of());
    lenient().when(attachmentRepo.findByMessageId(id)).thenReturn(List.of());
    lenient().when(analysisRepo.findByMessageId(id)).thenReturn(Optional.empty());
    lenient().when(deliveryRepo.findByMessageId(id)).thenReturn(List.of());
    return id;
  }

  @Test
  void detailQuarantineHiddenFromUser() {
    UUID r = quarantineMessage(MessageStatus.REROUTED);
    assertThrows(NoSuchElementException.class, () -> svc().getMessageDetails(r));
    UUID f = quarantineMessage(MessageStatus.FORWARDED);
    assertThrows(NoSuchElementException.class, () -> svc().getMessageDetails(f));
  }

  @Test
  void detailQuarantineVisibleToAdmin() {
    asAdmin();
    MessageDto dto = svc().getMessageDetails(quarantineMessage(MessageStatus.REROUTED));
    assertEquals(MessageStatus.REROUTED, dto.getStatus());
    MessageDto dto2 = svc().getMessageDetails(quarantineMessage(MessageStatus.FORWARDED));
    assertEquals(MessageStatus.FORWARDED, dto2.getStatus());
  }

  @Test
  void detailDeliveredVisibleToUser() {
    MessageDto dto = svc().getMessageDetails(quarantineMessage(MessageStatus.DELIVERED));
    assertEquals(MessageStatus.DELIVERED, dto.getStatus());
  }
}
