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
import ru.security.gateway.domain.MessageThreatAnalysis;
import ru.security.gateway.domain.ThreatCategory;
import ru.security.gateway.repository.*;

/** Регрессия: ?category= обязан попадать в SQL (раньше игнорировался). */
@ExtendWith(MockitoExtension.class)
@SuppressWarnings({"unchecked", "rawtypes"})
class MessageServiceCategorySpecTest {
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

  @Test
  void categoryAddsExistsSubquery() {
    when(messages.findAll(any(Specification.class), any(org.springframework.data.domain.Pageable.class)))
        .thenReturn(new PageImpl<>(List.of()));
    svc().getFilteredMessages(null, ThreatCategory.MAN_MADE, null, null, null, PageRequest.of(0, 20));

    ArgumentCaptor<Specification> captor = ArgumentCaptor.forClass(Specification.class);
    verify(messages).findAll(captor.capture(), any(org.springframework.data.domain.Pageable.class));
    Specification<Message> spec = captor.getValue();

    Root root = mock(Root.class);
    CriteriaQuery query = mock(CriteriaQuery.class);
    CriteriaBuilder cb = mock(CriteriaBuilder.class);
    Subquery sq = mock(Subquery.class);
    Root aRoot = mock(Root.class);
    when(query.subquery(MessageThreatAnalysis.class)).thenReturn(sq);
    when(sq.from(MessageThreatAnalysis.class)).thenReturn(aRoot);
    when(sq.select(any(jakarta.persistence.criteria.Expression.class))).thenReturn(sq);
    when(cb.and(any(Predicate[].class))).thenAnswer(inv -> mock(Predicate.class));

    spec.toPredicate(root, query, cb);
    verify(query).subquery(MessageThreatAnalysis.class);
    verify(cb).exists(sq);
  }

  @Test
  void noCategoryNoSubquery() {
    when(messages.findAll(any(Specification.class), any(org.springframework.data.domain.Pageable.class)))
        .thenReturn(new PageImpl<>(List.of()));
    svc().getFilteredMessages(null, null, null, null, null, PageRequest.of(0, 20));

    ArgumentCaptor<Specification> captor = ArgumentCaptor.forClass(Specification.class);
    verify(messages).findAll(captor.capture(), any(org.springframework.data.domain.Pageable.class));
    Specification<Message> spec = captor.getValue();

    Root root = mock(Root.class);
    CriteriaQuery query = mock(CriteriaQuery.class);
    CriteriaBuilder cb = mock(CriteriaBuilder.class);
    when(cb.and(any(Predicate[].class))).thenAnswer(inv -> mock(Predicate.class));

    spec.toPredicate(root, query, cb);
    verify(query, never()).subquery(any(Class.class));
    verify(cb, never()).exists(any(Subquery.class));
  }
}
