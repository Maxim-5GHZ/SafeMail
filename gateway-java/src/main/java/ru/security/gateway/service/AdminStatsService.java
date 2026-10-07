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

    Map<String, Long> byCategoryRerouted = new LinkedHashMap<>();
    for (Object[] row : analyses.countByCategoryInQuarantine()) {
      byCategoryRerouted.put(String.valueOf(row[0]), ((Number) row[1]).longValue());
    }

    OffsetDateTime since = OffsetDateTime.now().minusDays(days);
    Map<LocalDate, long[]> counts = new LinkedHashMap<>();
    for (Object[] row : messages.countPerDaySince(since)) {
      counts.put(toDate(row[0]), new long[]{(Long) row[1], (Long) row[2]});
    }
    // Zero-fill: окно days целиком, иначе один день растягивается на всю ширину графика.
    LocalDate today = LocalDate.now();
    List<AdminStatsResponse.DayBucket> perDay = new java.util.ArrayList<>(days);
    for (int i = days - 1; i >= 0; i--) {
      LocalDate d = today.minusDays(i);
      long[] c = counts.getOrDefault(d, new long[]{0L, 0L});
      perDay.add(AdminStatsResponse.DayBucket.builder()
          .date(d.toString()).total(c[0]).rerouted(c[1]).build());
    }

    AdminStatsResponse.QueueInfo queue = AdminStatsResponse.QueueInfo.builder()
        .pending(byStatus.getOrDefault(MessageStatus.PENDING.name(), 0L))
        .inProgress(byStatus.getOrDefault(MessageStatus.IN_PROGRESS.name(), 0L))
        .build();

    return AdminStatsResponse.builder()
        .total(total)
        .byStatus(byStatus)
        .byCategory(byCategory)
        .byCategoryRerouted(byCategoryRerouted)
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
