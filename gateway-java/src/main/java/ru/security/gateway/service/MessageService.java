package ru.security.gateway.service;

import jakarta.persistence.criteria.*;
import java.time.OffsetDateTime;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.*;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.security.gateway.domain.*;
import ru.security.gateway.dto.MessageDto;
import ru.security.gateway.repository.*;

@Service
@RequiredArgsConstructor
public class MessageService {
  private final MessageRepository messages;
  private final MessageParsedDataRepository parsedRepo;
  private final MessageAttachmentRepository attachmentRepo;
  private final MessageLinkRepository linkRepo;
  private final MessageThreatAnalysisRepository analysisRepo;
  private final ThreatRoutingRuleRepository rulesRepo;
  private final DeliveryLogRepository deliveryRepo;
  private final com.fasterxml.jackson.databind.ObjectMapper objectMapper;

  @Transactional(readOnly = true)
  public Page<MessageDto> getFilteredMessages(MessageStatus status, ThreatCategory category,
      String sender, String recipient, String query, Pageable pageable) {
    Specification<Message> spec = (root, q, cb) -> {
      List<Predicate> p = new ArrayList<>();
      if (status != null) p.add(cb.equal(root.get("status"), status));
      if (sender != null && !sender.isBlank()) p.add(cb.like(cb.lower(root.get("senderEmail")), "%" + sender.toLowerCase() + "%"));
      if (recipient != null && !recipient.isBlank()) p.add(cb.like(cb.lower(root.get("recipientEmail")), "%" + recipient.toLowerCase() + "%"));
      if (query != null && !query.isBlank()) {
        // Поиск по теме + тексту: связь Message→parsed в JPA тоже без ассоциации — EXISTS.
        String like = "%" + query.toLowerCase() + "%";
        Predicate onSubject = cb.like(cb.lower(root.get("subject")), like);
        Subquery<MessageParsedData> pq = q.subquery(MessageParsedData.class);
        Root<MessageParsedData> pd = pq.from(MessageParsedData.class);
        pq.select(pd).where(
            cb.equal(pd.get("messageId"), root.get("id")),
            cb.like(cb.lower(pd.get("cleanText")), like));
        p.add(cb.or(onSubject, cb.exists(pq)));
      }
      if (category != null) {
        // Связи Message→analysis в JPA нет (messageId без FK-ассоциации), поэтому подзапрос EXISTS.
        Subquery<MessageThreatAnalysis> sq = q.subquery(MessageThreatAnalysis.class);
        Root<MessageThreatAnalysis> a = sq.from(MessageThreatAnalysis.class);
        sq.select(a).where(
            cb.equal(a.get("messageId"), root.get("id")),
            cb.equal(a.get("finalVerdict"), category));
        p.add(cb.exists(sq));
      }
      return cb.and(p.toArray(new Predicate[0]));
    };
    Page<Message> page = messages.findAll(spec, pageable);
    List<UUID> ids = page.map(Message::getId).toList();
    Map<UUID, MessageThreatAnalysis> analyses = new HashMap<>();
    for (UUID id : ids) analysisRepo.findByMessageId(id).ifPresent(a -> analyses.put(id, a));

    return page.map(m -> {
      MessageDto dto = new MessageDto();
      dto.setId(m.getId());
      dto.setSenderEmail(m.getSenderEmail());
      dto.setRecipientEmail(m.getRecipientEmail());
      dto.setSubject(m.getSubject());
      dto.setStatus(m.getStatus());
      dto.setCreatedAt(m.getCreatedAt());
      MessageThreatAnalysis a = analyses.get(m.getId());
      if (a != null) {
        dto.setVerdict(a.getFinalVerdict());
      }
      // cleanText — всегда (сниппеты списка), а не только при наличии анализа.
      parsedRepo.findByMessageId(m.getId()).ifPresent(pd -> dto.setCleanText(pd.getCleanText()));
      // В списке — только счётчик (BLOB-ы вложений в список не тянем).
      dto.setAttachmentCount((int) attachmentRepo.countByMessageId(m.getId()));
      return dto;
    });
  }

  @Transactional(readOnly = true)
  public MessageDto getMessageDetails(UUID id) {
    Message m = messages.findById(id).orElseThrow(() -> new NoSuchElementException("Message not found: " + id));
    MessageDto dto = new MessageDto();
    dto.setId(m.getId());
    dto.setSenderEmail(m.getSenderEmail());
    dto.setRecipientEmail(m.getRecipientEmail());
    dto.setSubject(m.getSubject());
    dto.setStatus(m.getStatus());
    dto.setCreatedAt(m.getCreatedAt());
    parsedRepo.findByMessageId(id).ifPresent(pd -> {
      dto.setCleanText(pd.getCleanText());
      dto.setNormalizedText(pd.getNormalizedText());
    });
    dto.setLinks(linkRepo.findByMessageId(id).stream().map(l -> {
      MessageDto.LinkDto d = new MessageDto.LinkDto();
      d.setUrl(l.getUrl());
      d.setStatus(l.getStatus().name());
      d.setReputationScore(l.getReputationScore());
      d.setDetails(parseJsonLenient(l.getDetails()));
      return d;
    }).toList());
    dto.setAttachments(attachmentRepo.findByMessageId(id).stream().map(a -> {
      MessageDto.AttachmentDto d = new MessageDto.AttachmentDto();
      d.setId(a.getId());
      d.setFilename(a.getFilename());
      d.setSizeBytes(a.getFileSizeBytes());
      d.setContentType(a.getContentType());
      return d;
    }).toList());
    dto.setAttachmentCount(dto.getAttachments().size());
    analysisRepo.findByMessageId(id).ifPresent(a -> {
      dto.setVerdict(a.getFinalVerdict());
      MessageDto.ThreatReportDto t = new MessageDto.ThreatReportDto();
      t.setCategory(a.getFinalVerdict());
      t.setConfidence(a.getLlmConfidence() == null ? null : a.getLlmConfidence().doubleValue());
      t.setExplanation(a.getExplanation());
      t.setHeuristicScore(a.getHeuristicScore() == null ? null : a.getHeuristicScore().doubleValue());
      t.setHeuristicFlags(a.getHeuristicFlags() == null ? List.of() : List.of(a.getHeuristicFlags()));
      t.setSpellerFixes(parseJsonLenient(a.getSpellerFixes()));
      dto.setThreat(t);
    });
    // Маршрут «кому предназначалось -> куда ушло» для инженерной шторки.
    dto.setDeliveries(deliveryRepo.findByMessageId(id).stream().map(dl -> {
      MessageDto.DeliveryDto d = new MessageDto.DeliveryDto();
      d.setActionTaken(dl.getActionTaken());
      d.setDestinationRecipients(dl.getDestinationRecipients());
      d.setSmtpResponse(dl.getSmtpResponse());
      d.setSuccess(dl.isSuccess());
      d.setAttemptedAt(dl.getAttemptedAt());
      return d;
    }).toList());
    return dto;
  }

  /** JSONB -> объект для API; битый/пустой JSON отдаём как есть, фронт разберёт. */
  private Object parseJsonLenient(String raw) {
    if (raw == null || raw.isBlank()) return raw;
    try {
      return objectMapper.readValue(raw, Object.class);
    } catch (Exception e) {
      return raw;
    }
  }

  @Transactional
  public void triggerReprocessing(UUID id) {
    Message m = messages.findById(id).orElseThrow(() -> new NoSuchElementException("Message not found: " + id));
    m.setStatus(MessageStatus.PENDING);
    m.setProcessedAt(null);
  }

  @Transactional(readOnly = true)
  public List<ThreatRoutingRule> listRules() {
    return rulesRepo.findAll();
  }

  @Transactional
  public ThreatRoutingRule updateRule(ThreatCategory category, List<String> emails) {
    ThreatRoutingRule r = rulesRepo.findByCategory(category)
        .orElse(ThreatRoutingRule.builder().category(category).build());
    r.setDestinationEmails(emails.toArray(new String[0]));
    r.setActive(true);
    return rulesRepo.save(r);
  }
}
