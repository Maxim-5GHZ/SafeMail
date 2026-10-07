package ru.security.gateway.service;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.security.gateway.domain.MessageStatus;
import ru.security.gateway.domain.ThreatCategory;
import ru.security.gateway.dto.AdminStatsResponse;
import ru.security.gateway.repository.MessageRepository;
import ru.security.gateway.repository.MessageThreatAnalysisRepository;

/** Агрегаты для админ-дашборда. Только чтение, очередь (SKIP LOCKED) не трогает. */
@Service
@RequiredArgsConstructor
public class AdminStatsService {
  private final MessageRepository messages;
  private final MessageThreatAnalysisRepository analyses;

  @Transactional(readOnly = true)
  public AdminStatsResponse getStats(int days) {
    long total = messages.count();

    Map<String, Long> byStatus = new LinkedHashMap<>();
    for (Object[] row : messages.countByStatus()) {
      byStatus.put(((MessageStatus) row[0]).name(), (Long) row[1]);
    }

    Map<String, Long> byCategory = new LinkedHashMap<>();
    for (Object[] row : analyses.countByCategory()) {
      byCategory.put(((ThreatCategory) row[0]).name(), (Long) row[1]);
    }

    OffsetDateTime since = OffsetDateTime.now().minusDays(days);
    List<AdminStatsResponse.DayBucket> perDay = messages.countPerDaySince(since).stream()
        .map(row -> AdminStatsResponse.DayBucket.builder()
            .date(toDate(row[0]).toString())
            .total((Long) row[1])
            .rerouted((Long) row[2])
            .build())
        .toList();

    AdminStatsResponse.QueueInfo queue = AdminStatsResponse.QueueInfo.builder()
        .pending(byStatus.getOrDefault(MessageStatus.PENDING.name(), 0L))
        .inProgress(byStatus.getOrDefault(MessageStatus.IN_PROGRESS.name(), 0L))
        .build();

    return AdminStatsResponse.builder()
        .total(total)
        .byStatus(byStatus)
        .byCategory(byCategory)
        .perDay(perDay)
        .queue(queue)
        .build();
  }

  /** PG date из native-запроса приходит LocalDate, но не гадаем — принимаем оба формата. */
  static LocalDate toDate(Object o) {
    if (o instanceof LocalDate ld) return ld;
    if (o instanceof java.sql.Date d) return d.toLocalDate();
    return LocalDate.parse(String.valueOf(o));
  }
}
