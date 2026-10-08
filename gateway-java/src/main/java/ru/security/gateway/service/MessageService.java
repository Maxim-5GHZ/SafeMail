package ru.security.gateway.service;

import jakarta.persistence.criteria.*;
import java.time.OffsetDateTime;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
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
  private final SystemSettingService systemSettingService;
  private final com.fasterxml.jackson.databind.ObjectMapper objectMapper;

  /** C: мгновенный reprocess без ожидания 5-с полла (не в конструкторе —
   *  тесты создают сервис вручную через new; null → старый режим PENDING). */
  @Autowired(required = false)
  private ObjectProvider<InboundPipelineService> pipelineProvider;
  @Autowired(required = false)
  private org.springframework.core.task.TaskExecutor pipelineExecutor;

  @Transactional(readOnly = true)
  public Page<MessageDto> getFilteredMessages(MessageStatus status, ThreatCategory category,
      String sender, String recipient, String query, String mailbox, Pageable pageable) {
    Specification<Message> spec = (root, q, cb) -> {
      List<Predicate> p = new ArrayList<>();
      if (status != null) p.add(cb.equal(root.get("status"), status));
      if (sender != null && !sender.isBlank()) p.add(cb.like(cb.lower(root.get("senderEmail")), "%" + sender.toLowerCase() + "%"));
      if (recipient != null && !recipient.isBlank()) {
        int at = recipient.indexOf('@');
        String domainPart = at > 0 ? recipient.substring(at + 1).toLowerCase() : "";
        if (at > 0 && systemSettingService.isLocalDomain(domainPart)) {
          // Свой домен: ищем по всем алиасам (ivan@hotcodeband.ru И ivan@mail.hotcodeband.ru —
          // один ящик), а не подстрокой, иначе чужой домен-суффикс даст ложные совпадения.
          String userPart = recipient.substring(0, at).toLowerCase();
          List<Predicate> ors = systemSettingService.getAllowedDomainsList().stream()
              .map(d -> cb.equal(cb.lower(root.get("recipientEmail")), userPart + "@" + d))
              .toList();
          p.add(cb.or(ors.toArray(new Predicate[0])));
        } else {
          p.add(cb.like(cb.lower(root.get("recipientEmail")), "%" + recipient.toLowerCase() + "%"));
        }
      }
      if ("inbox".equalsIgnoreCase(mailbox)) {
        // Карантин получателю не доставлялся — во Входящих его нет (тихо, без заглушек).
        // Отправленные (sent) карантин видят — отправитель должен знать о блокировке.
        p.add(cb.not(root.get("status").in(MessageStatus.REROUTED, MessageStatus.FORWARDED)));
      }
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
      if (a != null && currentUserIsAdmin()) {
        // Вердикт — только админу: отправитель в «Отправленных» видит факт
        // блокировки по статусу, но не категорию и разбор.
        dto.setVerdict(a.getFinalVerdict());
      }
      // cleanText — всегда (сниппеты списка), а не только при наличии анализа.
      parsedRepo.findByMessageId(m.getId()).ifPresent(pd -> dto.setCleanText(pd.getCleanText()));
      // В списке — только счётчик (BLOB-ы вложений в список не тянем).
      dto.setAttachmentCount((int) attachmentRepo.countByMessageId(m.getId()));
      dto.setLastError(lastFailure(m.getId()));
      return dto;
    });
  }

  /** Урезанная деталка для отправителя карантинного письма: без вердикта,
   *  разбора, нормализованного текста, сырого EML, скоринга ссылок и маршрута ИБ. */
  private MessageDto senderStrippedDetails(Message m, UUID id) {
    MessageDto dto = new MessageDto();
    dto.setId(m.getId());
    dto.setSenderEmail(m.getSenderEmail());
    dto.setRecipientEmail(m.getRecipientEmail());
    dto.setSubject(m.getSubject());
    dto.setStatus(m.getStatus());
    dto.setCreatedAt(m.getCreatedAt());
    parsedRepo.findByMessageId(id).ifPresent(pd -> dto.setCleanText(pd.getCleanText()));
    dto.setLinks(linkRepo.findByMessageId(id).stream().map(l -> {
      MessageDto.LinkDto d = new MessageDto.LinkDto();
      d.setUrl(l.getUrl());
      return d;
    }).toList());
    dto.setAttachments(attachmentRepo.findByMessageId(id).stream().map(a -> {
      MessageDto.AttachmentDto d = new MessageDto.AttachmentDto();
      d.setId(a.getId());
      d.setFilename(a.getFilename());
      d.setSizeBytes(a.getFileSizeBytes());
      d.setContentType(a.getContentType());
      d.setThreat(false);
      return d;
    }).toList());
    dto.setAttachmentCount(dto.getAttachments().size());
    dto.setLastError(lastFailure(id));
    return dto;
  }

  @Transactional(readOnly = true)
  public MessageDto getMessageDetails(UUID id) {
    Message m = messages.findById(id).orElseThrow(() -> new NoSuchElementException("Message not found: " + id));
    if ((m.getStatus() == MessageStatus.REROUTED || m.getStatus() == MessageStatus.FORWARDED)
        && !currentUserIsAdmin()) {
      String me = currentUserEmail();
      if (me != null && me.equalsIgnoreCase(m.getSenderEmail())) {
        // Отправитель открывает своё карантинное письмо: текст и файлы — да,
        // вердикт/разбор/маршрут ИБ — нет (адреса безопасников не палим).
        return senderStrippedDetails(m, id);
      }
      // Карантин получателю не виден: тот же 404, что для несуществующего (не палим факт блокировки).
      throw new NoSuchElementException("Message not found: " + id);
    }
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
    // Исходное письмо как пришло (EML): декодируем UTF-8 с заменой, режем для UI.
    if (m.getRawContent() != null && m.getRawContent().length > 0) {
      String raw = new String(m.getRawContent(), java.nio.charset.StandardCharsets.UTF_8);
      if (raw.length() > 20000) raw = raw.substring(0, 20000) + "\n…[обрезано]";
      dto.setRawText(raw);
    }
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
      d.setThreat(a.isThreat());
      return d;
    }).toList());
    dto.setAttachmentCount(dto.getAttachments().size());
    dto.setLastError(lastFailure(id));
    // Вердикт не-админу — только при терминальном статусе: в PENDING/PARSED/…
    // строка анализа может быть stale (reprocess/resetStale), получатель тогда
    // видел бы прошлый вердикт как текущий. Админ видит всегда (инженерия).
    boolean showVerdict = currentUserIsAdmin() || isTerminal(m.getStatus());
    if (showVerdict) analysisRepo.findByMessageId(id).ifPresent(a -> {
      dto.setVerdict(a.getFinalVerdict());
      MessageDto.ThreatReportDto t = new MessageDto.ThreatReportDto();
      t.setCategory(a.getFinalVerdict());
      t.setConfidence(a.getLlmConfidence() == null ? null : a.getLlmConfidence().doubleValue());
      t.setExplanation(a.getExplanation());
      t.setHeuristicScore(a.getHeuristicScore() == null ? null : a.getHeuristicScore().doubleValue());
      t.setHeuristicFlags(a.getHeuristicFlags() == null ? List.of() : List.of(a.getHeuristicFlags()));
      t.setSpellerFixes(parseJsonLenient(a.getSpellerFixes()));
      t.setSemanticCategory(a.getSemanticCategory());
      t.setSemanticScore(a.getSemanticScore() == null ? null : a.getSemanticScore().doubleValue());
      t.setSemanticComment(a.getSemanticComment());
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

  /** Терминальный статус = анализ завершён, вердикт финальный (как TERMINAL_STATUSES на фронте). */
  static boolean isTerminal(MessageStatus s) {
    return s == MessageStatus.DELIVERED || s == MessageStatus.REROUTED
        || s == MessageStatus.FORWARDED || s == MessageStatus.FAILED;
  }

  /** Роль из JWT (фильтр кладёт ROLE_*); без аутентификации — обычный пользователь. */
  public static boolean currentUserIsAdmin() {    var auth = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
    return auth != null && auth.getAuthorities().stream().anyMatch(a -> "ROLE_ADMIN".equals(a.getAuthority()));
  }

  /** Email из JWT (JwtAuthFilter кладёт его principal'ом); null — без аутентификации. */
  public static String currentUserEmail() {
    var auth = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
    if (auth == null || auth.getName() == null) return null;
    String name = auth.getName();
    return (name.contains("@") ? name : null);
  }

  /** Последняя неуспешная запись delivery_logs (причина для FAILED-строк). */
  private String lastFailure(UUID id) {
    return deliveryRepo.findByMessageId(id).stream()
        .filter(dl -> !dl.isSuccess())
        .max(java.util.Comparator.comparing(
            DeliveryLog::getAttemptedAt,
            java.util.Comparator.nullsFirst(java.util.Comparator.naturalOrder())))
        .map(DeliveryLog::getSmtpResponse)
        .orElse(null);
  }

  /** JSONB -> объект для API; битый/пустой JSON отдаём как есть, фронт разберёт. */  private Object parseJsonLenient(String raw) {
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
    // Старый анализ удаляем тут же: иначе деталка в статусе PENDING отдавала бы
    // ПРОШЛЫЙ вердикт как текущий («В очереди анализа» + «Вердикт: … 75%»
    // одновременно + утечка вердикта не-админу в промежуточном статусе).
    analysisRepo.findByMessageId(id).ifPresent(analysisRepo::delete);
    // C: сразу ставим в пул после коммита — не ждём следующий 5-с полл.
    // claim атомарный (SKIP LOCKED), двойной обработки с поллером не будет:
    // кто первым сделал claimAsInProgress, тот и обрабатывает.
    if (pipelineProvider == null || pipelineExecutor == null) {
      return; // юнит-тесты без контекста: только PENDING, заберёт поллер
    }
    if (org.springframework.transaction.support.TransactionSynchronizationManager.isSynchronizationActive()) {
      org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
          new org.springframework.transaction.support.TransactionSynchronization() {
            @Override
            public void afterCommit() {
              launchReprocessing(id);
            }
          });
    } else {
      launchReprocessing(id);
    }
  }

  private void launchReprocessing(UUID id) {
    pipelineExecutor.execute(() -> {
      try {
        pipelineProvider.getObject().processClaimed(id);
      } catch (Exception e) {
        try {
          pipelineProvider.getObject().markFailed(id);
        } catch (Exception ignored) {
        }
      }
    });
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
