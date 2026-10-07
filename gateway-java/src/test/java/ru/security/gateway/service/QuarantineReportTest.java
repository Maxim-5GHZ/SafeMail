package ru.security.gateway.service;

import static org.junit.jupiter.api.Assertions.*;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import ru.security.gateway.domain.LinkStatus;
import ru.security.gateway.domain.Message;
import ru.security.gateway.domain.MessageLink;
import ru.security.gateway.domain.MessageParsedData;
import ru.security.gateway.domain.MessageStatus;
import ru.security.gateway.domain.MessageThreatAnalysis;
import ru.security.gateway.domain.ThreatCategory;

/**
 * Официальное заключение для ИБ: 5 этапов строго в порядке пайплайна,
 * спеллер раньше алгоритмов (с объяснением почему), источники правок,
 * причины ссылок словами, вердикт с маркерами. Чистая функция — без БД.
 */
class QuarantineReportTest {

  private static Message msg() {
    return Message.builder()
        .senderEmail("evil@ext.ru")
        .recipientEmail("alice@corp-sec.ru")
        .subject("срочно")
        .status(MessageStatus.REROUTED)
        .build();
  }

  private static MessageThreatAnalysis ta() {
    return MessageThreatAnalysis.builder()
        .heuristicScore(BigDecimal.valueOf(0.98))
        .heuristicFlags(new String[]{"man_made:хлор", "hidden-chars:2"})
        .llmCategory(ThreatCategory.MAN_MADE)
        .llmConfidence(BigDecimal.valueOf(0.98))
        .finalVerdict(ThreatCategory.MAN_MADE)
        .explanation("Обнаружены маркеры угрозы техногенной аварии.")
        .spellerFixes("[{\"original\":\"ghbdtn\",\"suggested\":\"привет\",\"source\":\"layout\"},"
            + "{\"original\":\"б0мбу\",\"suggested\":\"бомбу\",\"source\":\"yandex\"}]")
        .build();
  }

  @Test
  void fiveStagesInPipelineOrder() {
    Message m = msg();
    MessageParsedData pd = MessageParsedData.builder()
        .normalizedText("привет, заложили бомбу").attachmentsCount(1).build();
    MessageLink link = MessageLink.builder()
        .url("http://track-sabotage-leak.ru/login")
        .status(LinkStatus.MALICIOUS).reputationScore(80)
        .details("{\"reasons\":[\"suspicious-tld\",\"blacklist-hint:login,sabotage,leak\",\"no-tls\"]}")
        .build();
    String body = InboundPipelineService.buildQuarantineBody(m, ThreatCategory.MAN_MADE, pd, ta(), List.of(link));

    int i1 = body.indexOf("ЭТАП 1");
    int i2 = body.indexOf("ЭТАП 2");
    int i3 = body.indexOf("ЭТАП 3");
    int i4 = body.indexOf("ЭТАП 4");
    int i5 = body.indexOf("ЭТАП 5");
    assertTrue(i1 >= 0 && i2 > i1 && i3 > i2 && i4 > i3 && i5 > i4, "этапы по порядку:\n" + body);
    assertTrue(body.contains("СЕЙФМЕЙЛ № " + m.getId()));
    // Спеллер раньше алгоритмов — с объяснением последовательности
    assertTrue(body.contains("сначала восстанавливаем слова"));
    // Источники правок
    assertTrue(body.contains("«ghbdtn» → «привет» (источник: раскладка)"), body);
    assertTrue(body.contains("«б0мбу» → «бомбу» (источник: Яндекс)"), body);
    assertTrue(body.contains("Подмен раскладки клавиатуры: 1"));
    assertTrue(body.contains("Скрытых символов срезано: 2"));
    // Ссылки словами
    assertTrue(body.contains("подозрительная зона"), body);
    assertTrue(body.contains("чёрный список: login,sabotage,leak"), body);
    assertTrue(body.contains("вредоносная"), body);
    // Вердикт
    assertTrue(body.contains("Категория: Техногенная угроза."), body);
    assertTrue(body.contains("Уверенность: 98%."), body);
    assertTrue(body.contains("hidden-chars:2"), body);
  }

  @Test
  void emptyDataStillOfficial() {
    String body = InboundPipelineService.buildQuarantineBody(
        msg(), ThreatCategory.OTHER_THREAT, null, null, List.of());
    assertTrue(body.contains("ЭТАП 1") && body.contains("ЭТАП 5"));
    assertTrue(body.contains("Исправлений не потребовалось."));
    assertTrue(body.contains("Ссылок в письме нет."));
    assertTrue(body.contains("Категория: Прочая угроза."));
  }

  @Test
  void labels() {
    assertEquals("раскладка", InboundPipelineService.spellerSourceLabel("layout"));
    assertEquals("Яндекс", InboundPipelineService.spellerSourceLabel("yandex"));
    assertEquals("смешанный алфавит", InboundPipelineService.spellerSourceLabel("mixed-alphabet"));
    assertEquals("—", InboundPipelineService.spellerSourceLabel("bhlch"));
    assertEquals("—", InboundPipelineService.spellerSourceLabel(null));
    assertEquals("адрес вместо имени", InboundPipelineService.linkReasonLabel("ip-in-host"));
    assertEquals("прочий признак", InboundPipelineService.linkReasonLabel("???"));
  }
}
