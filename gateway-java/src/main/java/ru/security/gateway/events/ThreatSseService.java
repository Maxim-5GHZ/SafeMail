package ru.security.gateway.events;

import java.io.IOException;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** Живая лента угроз для SOC-панели (/admin): держит SSE-подписчиков
 *  и рассылает им карантинные события после коммита пайплайна.
 *  Зависшие эмиттеры вычищаются по onCompletion/onTimeout/onError. */
@Service
public class ThreatSseService {
  private static final Logger log = LoggerFactory.getLogger(ThreatSseService.class);

  /** Час жизни эмиттера: heartbeat каждые 20с держит соединение живым
   *  сквозь nginx/прокси, долгоживущие висяки не копятся. */
  static final long EMITTER_TTL_MS = 3_600_000L;

  private final Map<String, SseEmitter> emitters = new ConcurrentHashMap<>();

  public SseEmitter subscribe() {
    SseEmitter emitter = newEmitter();
    String id = UUID.randomUUID().toString();
    emitters.put(id, emitter);
    emitter.onCompletion(() -> emitters.remove(id));
    emitter.onTimeout(() -> emitters.remove(id));
    emitter.onError(e -> emitters.remove(id));
    try {
      emitter.send(SseEmitter.event().name("connected").data("ok"));
    } catch (IOException e) {
      emitters.remove(id);
    }
    log.info("SSE-подписчик угроз: {} (всего {})", id, emitters.size());
    return emitter;
  }

  /** Шов для юнит-тестов: подмена эмиттера записывающим фейком. */
  SseEmitter newEmitter() {
    return new SseEmitter(EMITTER_TTL_MS);
  }
  /** AFTER_COMMIT — в ленту попадает только закоммиченный карантин.
   *  fallbackExecution — на случай публикации вне транзакции (ручные вызовы). */
  @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
  public void onThreatQuarantined(ThreatQuarantinedEvent e) {
    broadcast("threat", Map.of(
        "messageId", e.messageId().toString(),
        "senderEmail", e.senderEmail(),
        "recipientEmail", e.recipientEmail(),
        "subject", e.subject() == null ? "" : e.subject(),
        "category", e.category().name(),
        "confidence", e.confidence(),
        "createdAt", e.createdAt().toString()));
  }

  /** Heartbeat сквозь прокси/nginx, иначе молчащее соединение прибьют по таймауту. */
  @Scheduled(fixedDelay = 20_000)
  public void heartbeat() {
    emitters.forEach((id, emitter) -> {
      try {
        emitter.send(SseEmitter.event().comment("ping"));
      } catch (Exception ex) {
        emitters.remove(id);
      }
    });
  }

  void broadcast(String name, Object data) {
    int sent = 0;
    var it = emitters.entrySet().iterator();
    while (it.hasNext()) {
      var entry = it.next();
      try {
        entry.getValue().send(SseEmitter.event().name(name).data(data, MediaType.APPLICATION_JSON));
        sent++;
      } catch (Exception e) {
        it.remove();
      }
    }
    log.info("SSE-рассылка '{}': {} подписчикам", name, sent);
  }

  int subscriberCount() {
    return emitters.size();
  }
}
