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
    List<String> flags = new ArrayList<>((List<String>) verdict.getOrDefault("heuristic_flags", List.of()));
    // Сигналы enrich (снятая маскировка) — в общий набор маркеров отчёта.
    int hiddenChars = (int) num(enriched, "hidden_chars_removed");
    if (hiddenChars > 0) flags.add("hidden-chars:" + hiddenChars);
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
   * Повторная отправка запрещена: из FORWARDED — 400 (кнопка фронта там уже
   * не показывается). Возвращает итоговый список получателей.
   */
  @Transactional
  public List<String> forwardToOfficers(UUID id, List<String> extraEmails,
                                        String adminEmail, String reason) {
    Message msg = messages.findById(id)
        .orElseThrow(() -> new NoSuchElementException("Message not found: " + id));
    if (msg.getStatus() != MessageStatus.REROUTED) {
      throw new IllegalArgumentException("Отправить безопаснику можно только письмо из карантина (REROUTED), повторная отправка запрещена");
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
    MessageParsedData pd = parsedRepo.findByMessageId(msg.getId()).orElse(null);
    MessageThreatAnalysis ta = analysisRepo.findByMessageId(msg.getId()).orElse(null);
    List<MessageLink> links = linkRepo.findByMessageId(msg.getId());
    String body = buildQuarantineBody(msg, cat, pd, ta, links);
    try {
      for (String d : dest) {
        var out = mailSender.createMimeMessage();
        out.setFrom(msg.getSenderEmail());
        out.setRecipients(jakarta.mail.Message.RecipientType.TO, d);
        out.setSubject("[КАРАНТИН · " + categoryLabel(cat) + "] " + (msg.getSubject() == null ? "" : msg.getSubject()));
        out.setText(body, "UTF-8");
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

  /** Русская подпись источника правки спеллера (enrich: yandex|mixed-alphabet|layout). */
  static String spellerSourceLabel(String source) {
    if (source == null) return "—";
    return switch (source.trim().toLowerCase()) {
      case "yandex" -> "Яндекс";
      case "mixed-alphabet" -> "смешанный алфавит";
      case "layout" -> "раскладка";
      default -> "—";
    };
  }

  static String linkStatusLabel(LinkStatus s) {
    if (s == null) return "не проверена";
    return switch (s) {
      case SAFE -> "безопасная";
      case SUSPICIOUS -> "подозрительная";
      case MALICIOUS -> "вредоносная";
      case UNCHECKED -> "не проверена";
    };
  }

  static String linkReasonLabel(String r) {
    if (r == null) return "прочий признак";
    if (r.equals("ip-in-host")) return "адрес вместо имени";
    if (r.equals("obfuscated-host")) return "маскировка имени";
    if (r.equals("suspicious-tld")) return "подозрительная зона";
    if (r.equals("no-tls")) return "без шифрования";
    if (r.equals("long-url")) return "слишком длинная";
    if (r.startsWith("blacklist-hint:")) return "чёрный список: " + r.substring("blacklist-hint:".length());
    return "прочий признак";
  }

  @SuppressWarnings("unchecked")
  static List<Map<String, String>> parseSpellerFixes(String json) {
    if (json == null || json.isBlank()) return List.of();
    try {
      Object parsed = new com.fasterxml.jackson.databind.ObjectMapper().readValue(json, List.class);
      if (!(parsed instanceof List<?> list)) return List.of();
      List<Map<String, String>> out = new ArrayList<>();
      for (Object o : list) {
        if (o instanceof Map<?, ?> m) {
          Map<String, String> fix = new LinkedHashMap<>();
          m.forEach((k, v) -> fix.put(String.valueOf(k), v == null ? "" : String.valueOf(v)));
          if (fix.containsKey("original") && fix.containsKey("suggested")) out.add(fix);
        }
      }
      return out;
    } catch (Exception e) {
      return List.of();
    }
  }

  /**
   * Официальное заключение для безопасников: 5 этапов строго в порядке
   * реального пайплайна. Этап 2 (спеллер) идёт раньше алгоритмов — иначе
   * маскировка прячет угрозу; это сказано в тексте прямо.
   */
  static String buildQuarantineBody(Message msg, ThreatCategory cat,
      MessageParsedData pd, MessageThreatAnalysis ta, List<MessageLink> links) {
    StringBuilder b = new StringBuilder();
    b.append("ЗАКЛЮЧЕНИЕ ШЛЮЗА СЕЙФМЕЙЛ № ").append(msg.getId()).append("\n");
    b.append("Письмо перехвачено и не доставлено получателю. Проверка идёт строго по порядку: ");
    b.append("сначала восстанавливаем слова (спеллер и деобфускация), и только потом работают ");
    b.append("алгоритмы, — иначе маскировка прячет угрозу.\n");
    b.append("\nЭТАП 1. ПРИЁМ И РАЗБОР\n");
    b.append("Отправитель: ").append(nz(msg.getSenderEmail())).append("\n");
    b.append("Получатель: ").append(nz(msg.getRecipientEmail())).append("\n");
    b.append("Тема: ").append(msg.getSubject() == null || msg.getSubject().isBlank() ? "(без темы)" : msg.getSubject()).append("\n");
    b.append("Номер письма: ").append(msg.getId()).append("\n");
    int attCount = pd == null ? 0 : pd.getAttachmentsCount();
    int linkCount = links == null ? 0 : links.size();
    b.append("Вложений: ").append(attCount).append(". Ссылок: ").append(linkCount).append(".\n");

    List<Map<String, String>> fixes = parseSpellerFixes(ta == null ? null : ta.getSpellerFixes());
    long layoutCount = fixes.stream().filter(f -> "layout".equalsIgnoreCase(f.getOrDefault("source", ""))).count();
    b.append("\nЭТАП 2. СПЕЛЛЕР (восстановление слов)\n");
    if (fixes.isEmpty()) {
      b.append("Исправлений не потребовалось.\n");
    } else {
      for (Map<String, String> f : fixes) {
        b.append("«").append(f.get("original")).append("» → «").append(f.get("suggested")).append("»");
        b.append(" (источник: ").append(spellerSourceLabel(f.get("source"))).append(").\n");
      }
    }

    b.append("\nЭТАП 3. ДЕОБФУСКАЦИЯ (снятие маскировки)\n");
    int hidden = 0;
    List<String> flagList = new ArrayList<>();
    if (ta != null && ta.getHeuristicFlags() != null) {
      for (String fl : ta.getHeuristicFlags()) {
        if (fl != null) {
          flagList.add(fl);
          if (fl.startsWith("hidden-chars:")) {
            try { hidden = Integer.parseInt(fl.substring("hidden-chars:".length())); }
            catch (NumberFormatException ignored) { }
          }
        }
      }
    }
    b.append("Скрытых символов срезано: ").append(hidden).append(".\n");
    b.append("Подмен раскладки клавиатуры: ").append(layoutCount).append(" (см. этап 2).\n");
    String normalized = pd == null || pd.getNormalizedText() == null ? "" : pd.getNormalizedText();
    b.append("Нормализованный текст:\n").append(normalized.isBlank() ? "(пусто)" : normalized).append("\n");

    b.append("\nЭТАП 4. ПРОВЕРКА ССЫЛОК\n");
    if (links == null || links.isEmpty()) {
      b.append("Ссылок в письме нет.\n");
    } else {
      for (MessageLink l : links) {
        b.append(l.getUrl() == null ? "" : l.getUrl());
        b.append(" — ").append(linkStatusLabel(l.getStatus()));
        if (l.getReputationScore() != null) b.append(", оценка ").append(l.getReputationScore()).append("%");
        List<String> reasons = parseLinkReasons(l.getDetails());
        if (!reasons.isEmpty()) {
          b.append(". Причины: ");
          List<String> ru = new ArrayList<>();
          for (String r : reasons) ru.add(linkReasonLabel(r));
          b.append(String.join("; ", ru));
        }
        b.append(".\n");
      }
    }

    b.append("\nЭТАП 5. ВЕРДИКТ\n");
    b.append("Категория: ").append(categoryLabel(cat)).append(".\n");
    if (ta != null && ta.getLlmConfidence() != null) {
      b.append("Уверенность: ").append(Math.round(ta.getLlmConfidence().doubleValue() * 100)).append("%.\n");
    }
    if (ta != null && ta.getHeuristicScore() != null) {
      b.append("Эвристическая оценка: ").append(ta.getHeuristicScore()).append(".\n");
    }
    if (!flagList.isEmpty()) b.append("Маркеры: ").append(String.join(", ", flagList)).append(".\n");
    if (ta != null && ta.getExplanation() != null && !ta.getExplanation().isBlank()) {
      b.append("Обоснование: ").append(ta.getExplanation().strip()).append("\n");
    }
    return b.toString();
  }

  static List<String> parseLinkReasons(String detailsJson) {
    if (detailsJson == null || detailsJson.isBlank()) return List.of();
    try {
      Map<?, ?> m = new com.fasterxml.jackson.databind.ObjectMapper().readValue(detailsJson, Map.class);
      Object r = m.get("reasons");
      if (r instanceof List<?> list) {
        List<String> out = new ArrayList<>();
        for (Object o : list) if (o != null) out.add(String.valueOf(o));
        return out;
      }
      return List.of();
    } catch (Exception e) {
      return List.of();
    }
  }

  private static String nz(String s) {
    return s == null ? "" : s;
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
