package ru.security.gateway.events;

import static org.junit.jupiter.api.Assertions.*;

import java.io.IOException;
import java.time.OffsetDateTime;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Queue;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import ru.security.gateway.domain.ThreatCategory;

/** Живая лента угроз: рассылка живым, вычистка мёртвых, heartbeat без падений. Без БД. */
class ThreatSseServiceTest {

  /** Записывающий фейк вместо сетевого эмиттера (сети в юнит-тесте нет). */
  static class FakeEmitter extends SseEmitter {
    final List<Object> received = new ArrayList<>();
    boolean dead;

    FakeEmitter() {
      super(60_000L);
    }

    @Override
    public void send(SseEmitter.SseEventBuilder event) throws IOException {
      if (dead) throw new IOException("simulated dead connection");
      received.add(event);
    }

    @Override
    public void send(Object object, MediaType mediaType) throws IOException {
      if (dead) throw new IOException("simulated dead connection");
      received.add(object);
    }
  }

  static class TestableService extends ThreatSseService {
    final Queue<FakeEmitter> pool = new ArrayDeque<>();

    @Override
    SseEmitter newEmitter() {
      return pool.remove();
    }
  }

  private static ThreatQuarantinedEvent event() {
    return new ThreatQuarantinedEvent(UUID.randomUUID(), "evil@x.ru", "victim@hotcodeband.ru",
        "Срочно открой", ThreatCategory.OTHER_THREAT, 0.9, OffsetDateTime.now());
  }

  @Test
  void broadcastReachesLiveAndDropsDead() {
    TestableService svc = new TestableService();
    FakeEmitter live = new FakeEmitter();
    FakeEmitter dead = new FakeEmitter();
    svc.pool.add(live);
    svc.pool.add(dead);
    svc.subscribe();
    svc.subscribe();
    assertEquals(2, svc.subscriberCount());

    dead.dead = true;
    svc.onThreatQuarantined(event());

    assertEquals(1, svc.subscriberCount());
    // Живой получил стартовое "connected" + саму угрозу.
    assertEquals(2, live.received.size());
    assertDoesNotThrow(svc::heartbeat);
    assertEquals(1, svc.subscriberCount());
  }

  @Test
  void noSubscribersNoFail() {
    TestableService svc = new TestableService();
    assertDoesNotThrow(() -> svc.onThreatQuarantined(event()));
    assertDoesNotThrow(svc::heartbeat);
    assertEquals(0, svc.subscriberCount());
  }
}
