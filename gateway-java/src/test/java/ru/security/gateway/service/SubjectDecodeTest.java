package ru.security.gateway.service;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

/** Регрессия кракозябр в теме: RFC2047 + сырой UTF-8 без кодирования (mojibake Ð/Ñ). */
class SubjectDecodeTest {
  @Test
  void rfc2047Decoded() {
    assertEquals("Привет", InboundPipelineService.decodeSubject("=?UTF-8?B?0J/RgNC40LLQtdGC?="));
  }

  @Test
  void rawUtf8MojibakeRepaired() {
    // Клиент слал сырой UTF-8 в заголовке: байты прочитаны как Latin-1.
    String mojibake = new String("Привет".getBytes(StandardCharsets.UTF_8), StandardCharsets.ISO_8859_1);
    assertTrue(InboundPipelineService.MOJIBAKE_PAT.matcher(mojibake).find());
    assertEquals("Привет", InboundPipelineService.decodeSubject(mojibake));
  }

  @Test
  void plainSubjectsUntouched() {
    assertEquals("Счёт за март", InboundPipelineService.decodeSubject("Счёт за март"));
    assertEquals("Hello world", InboundPipelineService.decodeSubject("Hello world"));
    // Испанская Ñ перед обычной буквой — не mojibake, не чиним.
    assertEquals("ÑOÑO mañana", InboundPipelineService.decodeSubject("ÑOÑO mañana"));
    assertNull(InboundPipelineService.decodeSubject(null));
  }
}
