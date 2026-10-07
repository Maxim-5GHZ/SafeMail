package ru.security.gateway.service;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import jakarta.persistence.criteria.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.jpa.domain.Specification;
import ru.security.gateway.domain.Message;
import ru.security.gateway.domain.MessageParsedData;
import ru.security.gateway.repository.*;

/** Регрессия: ?recipient= и ?query= обязаны попадать в SQL (поиск и папки фронта). */
@ExtendWith(MockitoExtension.class)
@SuppressWarnings({"unchecked", "rawtypes"})
class MessageSearchSpecTest {
  @Mock MessageRepository messages;
  @Mock MessageParsedDataRepository parsedRepo;
  @Mock MessageAttachmentRepository attachmentRepo;
  @Mock MessageLinkRepository linkRepo;
  @Mock MessageThreatAnalysisRepository analysisRepo;
  @Mock ThreatRoutingRuleRepository rulesRepo;
  @Mock DeliveryLogRepository deliveryRepo;

  private MessageService svc() {
    return new MessageService(messages, parsedRepo, attachmentRepo, linkRepo, analysisRepo, rulesRepo,
        deliveryRepo, new com.fasterxml.jackson.databind.ObjectMapper());
  }

  private Specification<Message> captureSpec() {
    ArgumentCaptor<Specification> captor = ArgumentCaptor.forClass(Specification.class);
    verify(messages).findAll(captor.capture(), any(org.springframework.data.domain.Pageable.class));
    return captor.getValue();
  }

  @Test
  void recipientLikeArgs() {
    when(messages.findAll(any(Specification.class), any(org.springframework.data.domain.Pageable.class)))
        .thenReturn(new PageImpl<>(List.of()));
    svc().getFilteredMessages(null, null, null, "BOB@corp-sec.ru", null, null, PageRequest.of(0, 20));

    Specification<Message> spec = captureSpec();
    Root root = mock(Root.class);
    CriteriaBuilder cb = mock(CriteriaBuilder.class);
    spec.toPredicate(root, mock(CriteriaQuery.class), cb);

    verify(root).get("recipientEmail");
    verify(cb).like(any(), eq("%bob@corp-sec.ru%"));
  }

  @Test
  void querySearchesSubjectAndParsedText() {
    when(messages.findAll(any(Specification.class), any(org.springframework.data.domain.Pageable.class)))
        .thenReturn(new PageImpl<>(List.of()));
    svc().getFilteredMessages(null, null, null, null, "счёт", null, PageRequest.of(0, 20));

    Specification<Message> spec = captureSpec();
    Root root = mock(Root.class);
    CriteriaQuery query = mock(CriteriaQuery.class);
    CriteriaBuilder cb = mock(CriteriaBuilder.class);
    Subquery sq = mock(Subquery.class);
    when(query.subquery(MessageParsedData.class)).thenReturn(sq);
    when(sq.from(MessageParsedData.class)).thenReturn(mock(Root.class));
    when(sq.select(any(jakarta.persistence.criteria.Expression.class))).thenReturn(sq);

    spec.toPredicate(root, query, cb);

    verify(root).get("subject");
    verify(query).subquery(MessageParsedData.class);
    verify(cb).exists(sq);
    verify(cb).or(any(), any());
  }

  @Test
  void noQueryNoParsedSubquery() {
    when(messages.findAll(any(Specification.class), any(org.springframework.data.domain.Pageable.class)))
        .thenReturn(new PageImpl<>(List.of()));
    svc().getFilteredMessages(null, null, "a@x.ru", "b@x.ru", null, null, PageRequest.of(0, 20));

    Specification<Message> spec = captureSpec();
    CriteriaQuery query = mock(CriteriaQuery.class);
    spec.toPredicate(mock(Root.class), query, mock(CriteriaBuilder.class));

    verify(query, never()).subquery(MessageParsedData.class);
  }
}
