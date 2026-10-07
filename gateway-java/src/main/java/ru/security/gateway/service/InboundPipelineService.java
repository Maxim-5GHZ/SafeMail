package ru.security.gateway.service;

import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import java.io.ByteArrayInputStream;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.*;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;
import ru.security.gateway.domain.*;
import ru.security.gateway.repository.*;

@Service
@RequiredArgsConstructor
public class InboundPipelineService {
  private static final Logger log = LoggerFactory.getLogger(InboundPipelineService.class);

  private final MessageRepository messages;
  private final MessageParsedDataRepository parsedRepo;
  private final MessageAttachmentRepository attachmentRepo;
  private final MessageLinkRepository linkRepo;
  private final MessageThreatAnalysisRepository analysisRepo;
  private final ThreatRoutingRuleRepository rulesRepo;
  private final ThreatStopwordRepository stopwordRepo;
  private final DeliveryLogRepository deliveryRepo;
  private final JavaMailSender mailSender;
  private final RestTemplate restTemplate;
  private final ObjectProvider<InboundPipelineService> self;

  @Value("${mail.domain:corp-sec.ru}")
  private String mailDomain;

  @Value("${ml.parser-url:http://localhost:8001}")
  private String parserUrl;
  @Value("${ml.enrich-url:http://localhost:8002}")
  private String enrichUrl;
  @Value("${ml.classify-url:http://localhost:8003}")
  private String classifyUrl;

  /** Вызывается из SubEthaSMTP-хендлера и из hairpin. */
  @Transactional
  public UUID receiveRaw(String from, String to, byte[] raw) {
    String subject = null, smtpId = null;
    try {
      MimeMessage mime = new MimeMessage(Session.getDefaultInstance(new Properties()), new ByteArrayInputStream(raw));
      subject = mime.getSubject();
      String[] hdr = mime.getHeader("Message-ID");
      if (hdr != null && hdr.length > 0) smtpId = hdr[0];
    } catch (Exception e) {
      log.warn("Не удалось распарсить заголовки: {}", e.getMessage());
    }
    Message m = Message.builder()
        .smtpMessageId(smtpId)
        .senderEmail(from == null ? "unknown" : from)
        .recipientEmail(to == null ? "unknown" : to)
        .subject(subject)
        .rawContent(raw)
        .status(MessageStatus.PENDING)
        .build();
    messages.save(m);
    return m.getId();
  }

  public void processIncomingStream(String from, String to, ByteArrayInputStream stream) {
    try {
      receiveRaw(from, to, stream.readAllBytes());
    } catch (Exception e) {
      throw new RuntimeException(e);
    }
  }

  @Scheduled(fixedDelay = 5000)
  public void pollAndProcess() {
    try {
      self.getObject().resetStale();
    } catch (Exception e) {
      log.warn("Stale-reset skip (БД недоступна?): {}", e.getMessage());
      return;
    }
    List<UUID> ids;
    try {
      ids = messages.pickForProcessing("PENDING", 10);
    } catch (Exception e) {
      log.warn("Poll skip (БД недоступна?): {}", e.getMessage());
      return;
    }
    for (UUID id : ids) {
      try {
        self.getObject().processClaimed(id);
      } catch (Exception e) {
        log.error("Pipeline failed for {}", id, e);
        try {
          self.getObject().markFailed(id);
        } catch (Exception inner) {
          log.error("markFailed failed for {}", id, inner);
        }
      }
    }
  }

  /** Возврат зависших IN_PROGRESS обратно в очередь (поллинг висит >30 мин — инстанс упал). */
  @Transactional
  public void resetStale() {
    messages.resetStaleInProgress(OffsetDateTime.now().minusMinutes(30));
  }

  /** Атомарный claim + обработка одного письма в своей транзакции. */
  @Transactional
  public void processClaimed(UUID id) {
    int claimed = messages.claimAsInProgress(id);
    if (claimed == 0) {
      return; // уже забрано другим инстансом / обработано
    }
    processOne(id);
  }

  @Transactional
  public void markFailed(UUID id) {
    messages.findById(id).ifPresent(m -> m.setStatus(MessageStatus.FAILED));
  }

  private void processOne(UUID id) {
    Message msg = messages.findById(id).orElseThrow();
    byte[] raw = msg.getRawContent();
    if (raw == null || raw.length == 0) {
      msg.setStatus(MessageStatus.FAILED);
      return;
    }

    // 1. Parser
    Map<String, Object> parsed = postJson(parserUrl + "/internal/parse-extract",
        Map.of("raw_base64", Base64.getEncoder().encodeToString(raw)));
    String cleanText = str(parsed, "clean_text");
    String attachText = str(parsed, "extracted_attachments_text");
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> urls = (List<Map<String, Object>>) parsed.getOrDefault("links", List.of());
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> atts = (List<Map<String, Object>>) parsed.getOrDefault("attachments", List.of());

    MessageParsedData pd = parsedRepo.findByMessageId(id).orElse(
        MessageParsedData.builder().messageId(id).build());
    pd.setCleanText(cleanText);
    pd.setExtractedTextFromAttachments(attachText);
    pd.setHasAttachments(!atts.isEmpty());
    pd.setAttachmentsCount(atts.size());
    parsedRepo.save(pd);

    for (Map<String, Object> a : atts) {
      try {
        String b64 = (String) a.getOrDefault("content_base64", "");
        byte[] content = b64.isEmpty() ? new byte[0] : Base64.getDecoder().decode(b64);
        if (content.length > 20_000_000) continue; // режем >20МБ для BYTEA-варианта А
        attachmentRepo.save(MessageAttachment.builder()
            .messageId(id)
            .filename(String.valueOf(a.getOrDefault("filename", "unnamed")))
            .contentType(String.valueOf(a.getOrDefault("content_type", "application/octet-stream")))
            .fileSizeBytes(content.length)
            .fileContent(content)
            .build());
      } catch (Exception e) {
        log.warn("Attachment skip: {}", e.getMessage());
      }
    }
    for (Map<String, Object> u : urls) {
      String url = String.valueOf(u.getOrDefault("url", ""));
      if (!url.isBlank()) {
        linkRepo.save(MessageLink.builder().messageId(id).url(url).status(LinkStatus.UNCHECKED).build());
      }
    }
    msg.setStatus(MessageStatus.PARSED);

    // 2. Enrich — субъект ОБЯЗАТЕЛЬНО входит в анализ (мат/угроза часто только в теме).
    String subject = msg.getSubject() != null ? msg.getSubject() : str(parsed, "subject");
    if (subject == null) subject = "";
    String enrichInput = (subject.isBlank() ? "" : subject + "\n")
        + (cleanText == null ? "" : cleanText) + "\n" + (attachText == null ? "" : attachText);
    Map<String, Object> enriched = postJson(enrichUrl + "/internal/normalize-enrich",
        Map.of("text", enrichInput, "urls", urls.stream().map(m -> m.get("url")).toList()));
    String normalized = str(enriched, "normalized_text");
    if (normalized.isBlank()) normalized = enrichInput;
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> linkVerdicts = (List<Map<String, Object>>) enriched.getOrDefault("links", List.of());
    for (Map<String, Object> lv : linkVerdicts) {
      String url = String.valueOf(lv.getOrDefault("url", ""));
      boolean phishing = Boolean.parseBoolean(String.valueOf(lv.getOrDefault("is_phishing", "false")));
      int score = Integer.parseInt(String.valueOf(lv.getOrDefault("risk_score", "0")));
      linkRepo.findByMessageId(id).stream().filter(l -> l.getUrl().equals(url)).forEach(l -> {
        l.setStatus(phishing ? LinkStatus.MALICIOUS : (score > 40 ? LinkStatus.SUSPICIOUS : LinkStatus.SAFE));
        l.setReputationScore(score);
        l.setDetails(toJson(lv));
        linkRepo.save(l);
      });
    }
    msg.setStatus(MessageStatus.ENRICHED);

    // Нормализованный текст сохраняем — нужен инженерной шторке (/admin) для диффа clean -> normalized.
    pd.setNormalizedText(normalized);
    parsedRepo.save(pd);

    // 3. Classify — активные стоп-слова едут сигналом (подстрока по нормализованному
    // тексту внутри classify-threat). Без ML — обычный fallback (ограничение зафиксировано).
    List<Map<String, String>> swRules = stopwordRepo.findByActiveTrue().stream()
        .map(sw -> Map.of("pattern", sw.getPattern(), "category", sw.getCategory().name()))
        .toList();
    Map<String, Object> verdict = postJson(classifyUrl + "/internal/classify-threat",
        Map.of("text", normalized, "stopwords", swRules));
    ThreatCategory cat = parseCategory(str(verdict, "category"));
    double conf = num(verdict, "confidence");
    double hscore = num(verdict, "heuristic_score");
    @SuppressWarnings("unchecked")
    List<String> flags = (List<String>) verdict.getOrDefault("heuristic_flags", List.of());
    String explanation = str(verdict, "explanation");

    MessageThreatAnalysis ta = analysisRepo.findByMessageId(id).orElse(
        MessageThreatAnalysis.builder().messageId(id).build());
    ta.setHeuristicScore(BigDecimal.valueOf(hscore));
    ta.setHeuristicFlags(flags.toArray(new String[0]));
    ta.setLlmCategory(cat);
    ta.setLlmConfidence(BigDecimal.valueOf(conf));
    ta.setFinalVerdict(cat);
    ta.setExplanation(explanation);
    ta.setSpellerFixes(toJson(enriched.getOrDefault("speller_fixes", List.of())));
    analysisRepo.save(ta);
    msg.setStatus(MessageStatus.ANALYZED);

    // 4. Router
    if (cat == ThreatCategory.NONE) {
      deliverOriginal(msg);
      msg.setStatus(MessageStatus.DELIVERED);
    } else {
      reroute(msg, cat);
      msg.setStatus(MessageStatus.REROUTED);
    }
    msg.setProcessedAt(OffsetDateTime.now());
    messages.save(msg);
  }

  private void deliverOriginal(Message msg) {
    try {
      sendOriginalBytes(msg);
      deliveryRepo.save(DeliveryLog.builder().messageId(msg.getId())
          .actionTaken("FORWARDED_ORIGINAL")
          .destinationRecipients(new String[]{msg.getRecipientEmail()})
          .smtpResponse("relayed").success(true).build());
    } catch (Exception e) {
      deliveryRepo.save(DeliveryLog.builder().messageId(msg.getId())
          .actionTaken("FORWARDED_ORIGINAL")
          .destinationRecipients(new String[]{msg.getRecipientEmail()})
          .smtpResponse("failed: " + e.getMessage()).success(false).build());
      throw new RuntimeException(e);
    }
  }

  /** Отправка оригинальных байтов без изменений (чистая доставка и ручной выпуск). */
  private void sendOriginalBytes(Message msg) throws Exception {
    MimeMessage mime = new MimeMessage(Session.getDefaultInstance(new Properties()),
        new ByteArrayInputStream(msg.getRawContent()));
    mailSender.send(mime);
  }

  /**
   * Ручной выпуск из карантина (только ADMIN, см. AdminMessageController):
   * оригинал — исходному получателю, статус → DELIVERED, вердикт сохраняется,
   * в delivery_logs — RELEASED_BY_ADMIN с email админа и причиной.
   * Допустим из REROUTED и из FORWARDED (отправленное безопасникам всё ещё
   * можно выпустить получателю — это разные действия, оба пишутся в аудит).
   */
  @Transactional
  public void releaseFromQuarantine(UUID id, String adminEmail, String reason) {
    Message msg = messages.findById(id)
        .orElseThrow(() -> new NoSuchElementException("Message not found: " + id));
    if (msg.getStatus() != MessageStatus.REROUTED && msg.getStatus() != MessageStatus.FORWARDED) {
      throw new IllegalArgumentException("Выпустить можно только письмо из карантина (REROUTED/FORWARDED)");
    }
    String note = "released by " + adminEmail
        + (reason == null || reason.isBlank() ? "" : ": " + reason.strip());
    try {
      sendOriginalBytes(msg);
      deliveryRepo.save(DeliveryLog.builder().messageId(msg.getId())
          .actionTaken("RELEASED_BY_ADMIN")
          .destinationRecipients(new String[]{msg.getRecipientEmail()})
          .smtpResponse(note).success(true).build());
    } catch (Exception e) {
      deliveryRepo.save(DeliveryLog.builder().messageId(msg.getId())
          .actionTaken("RELEASED_BY_ADMIN")
          .destinationRecipients(new String[]{msg.getRecipientEmail()})
          .smtpResponse(note + " | failed: " + e.getMessage()).success(false).build());
      throw new RuntimeException(e);
    }
    msg.setStatus(MessageStatus.DELIVERED);
    msg.setProcessedAt(OffsetDateTime.now());
    messages.save(msg);
  }

  /**
   * Ручная отправка копии карантинного письма безопасникам (только ADMIN):
   * получатели = адреса правила категории вердикта + дополнительные emails,
   * содержимое — оригинал без изменений (меняется только конверт получателей),
   * статус → FORWARDED (письмо уходит из карантина в отдельный фильтр SOC-таблицы),
   * в delivery_logs — FORWARDED_TO_SECURITY.
   * Повторная отправка из FORWARDED разрешена (получатели пересчитываются заново).
   * Возвращает итоговый список получателей.
   */
  @Transactional
  public List<String> forwardToOfficers(UUID id, List<String> extraEmails,
                                        String adminEmail, String reason) {
    Message msg = messages.findById(id)
        .orElseThrow(() -> new NoSuchElementException("Message not found: " + id));
    if (msg.getStatus() != MessageStatus.REROUTED && msg.getStatus() != MessageStatus.FORWARDED) {
      throw new IllegalArgumentException("Отправить безопаснику можно только письмо из карантина (REROUTED/FORWARDED)");
    }
    ThreatCategory cat = analysisRepo.findByMessageId(id)
        .map(MessageThreatAnalysis::getFinalVerdict).orElse(ThreatCategory.OTHER_THREAT);
    LinkedHashSet<String> dest = new LinkedHashSet<>();
    rulesRepo.findByCategory(cat).map(ThreatRoutingRule::getDestinationEmails).ifPresent(ruleDest -> {
      if (ruleDest != null) Collections.addAll(dest, ruleDest);
    });
    if (extraEmails != null) {
      for (String e : extraEmails) {
        if (e != null && !e.isBlank()) dest.add(e.strip());
      }
    }
    if (dest.isEmpty()) {
      dest.add("infosec@" + mailDomain);
    }
    String note = "forwarded by " + adminEmail
        + (reason == null || reason.isBlank() ? "" : ": " + reason.strip());
    try {
      MimeMessage fwd = new MimeMessage(Session.getDefaultInstance(new Properties()),
          new ByteArrayInputStream(msg.getRawContent()));
      fwd.setRecipients(jakarta.mail.Message.RecipientType.TO, String.join(",", dest));
      mailSender.send(fwd);
      deliveryRepo.save(DeliveryLog.builder().messageId(msg.getId())
          .actionTaken("FORWARDED_TO_SECURITY")
          .destinationRecipients(dest.toArray(new String[0]))
          .smtpResponse(note).success(true).build());
    } catch (Exception e) {
      deliveryRepo.save(DeliveryLog.builder().messageId(msg.getId())
          .actionTaken("FORWARDED_TO_SECURITY")
          .destinationRecipients(dest.toArray(new String[0]))
          .smtpResponse(note + " | failed: " + e.getMessage()).success(false).build());
      throw new RuntimeException(e);
    }
    msg.setStatus(MessageStatus.FORWARDED);
    msg.setProcessedAt(OffsetDateTime.now());
    messages.save(msg);
    return new ArrayList<>(dest);
  }

  /** Русская подпись категории для писем людям (тема/тело карантина). Коды API не меняет. */
  static String categoryLabel(ThreatCategory cat) {
    return switch (cat) {
      case TERRORISM -> "Терроризм";
      case MAN_MADE -> "Техногенная угроза";
      case ILLEGAL_ACTIONS -> "Противоправные действия";
      case OTHER_THREAT -> "Прочая угроза";
      case NONE -> "Чисто";
    };
  }

  private void reroute(Message msg, ThreatCategory cat) {
    String[] dest = rulesRepo.findByCategory(cat)
        .map(ThreatRoutingRule::getDestinationEmails)
        .orElseGet(() -> new String[]{"infosec@" + mailDomain});
    try {
      for (String d : dest) {
        var out = mailSender.createMimeMessage();
        out.setFrom(msg.getSenderEmail());
        out.setRecipients(jakarta.mail.Message.RecipientType.TO, d);
        out.setSubject("[КАРАНТИН · " + categoryLabel(cat) + "] " + (msg.getSubject() == null ? "" : msg.getSubject()));
        out.setText("Перехвачено шлюзом SafeMail.\nКатегория: " + categoryLabel(cat)
            + "\nИсходный получатель: " + msg.getRecipientEmail()
            + "\nMessage-ID: " + msg.getId(), "UTF-8");
        mailSender.send(out);
      }
      deliveryRepo.save(DeliveryLog.builder().messageId(msg.getId())
          .actionTaken("REROUTED_TO_SECURITY")
          .destinationRecipients(dest).smtpResponse("rerouted:" + cat).success(true).build());
    } catch (Exception e) {
      deliveryRepo.save(DeliveryLog.builder().messageId(msg.getId())
          .actionTaken("REROUTED_TO_SECURITY")
          .destinationRecipients(dest).smtpResponse("failed: " + e.getMessage()).success(false).build());
      throw new RuntimeException(e);
    }
  }

  private Map<String, Object> postJson(String url, Object body) {
    HttpHeaders h = new HttpHeaders();
    h.setContentType(MediaType.APPLICATION_JSON);
    try {
      ResponseEntity<Map<String, Object>> res = restTemplate.exchange(url, HttpMethod.POST,
          new HttpEntity<>(body, h), new ParameterizedTypeReference<>() {});
      return res.getBody() == null ? Map.of() : res.getBody();
    } catch (Exception e) {
      log.warn("ML {} недоступен ({}), использую fallback", url, e.getMessage());
      return Map.of();
    }
  }

  private static String str(Map<String, Object> m, String k) {
    Object v = m.get(k);
    return v == null ? "" : String.valueOf(v);
  }

  private static double num(Map<String, Object> m, String k) {
    try {
      return Double.parseDouble(str(m, k));
    } catch (Exception e) {
      return 0.0;
    }
  }

  private static ThreatCategory parseCategory(String s) {
    try {
      return ThreatCategory.valueOf(s.trim().toUpperCase());
    } catch (Exception e) {
      return ThreatCategory.NONE;
    }
  }

  private static String toJson(Object o) {
    try {
      return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(o);
    } catch (Exception e) {
      return "{}";
    }
  }
}
