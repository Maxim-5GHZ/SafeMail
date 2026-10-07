package ru.security.gateway.dto;

import java.util.List;
import java.util.Map;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Агрегаты для админ-дашборда. byStatus/byCategory — за всё время, perDay — за окно days. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AdminStatsResponse {
  /** Всего писем за всё время. */
  private long total;
  /** Ключ — имя MessageStatus, значение — счётчик. */
  private Map<String, Long> byStatus;
  /** Ключ — имя ThreatCategory, значение — счётчик (только проанализированные). */
  private Map<String, Long> byCategory;
  /** Посуточная динамика за окно days (возрастание даты). */
  private List<DayBucket> perDay;
  /** Срез очереди из byStatus. */
  private QueueInfo queue;

  @Data
  @Builder
  @NoArgsConstructor
  @AllArgsConstructor
  public static class DayBucket {
    /** ISO-дата, например 2026-10-07. */
    private String date;
    private long total;
    private long rerouted;
  }

  @Data
  @Builder
  @NoArgsConstructor
  @AllArgsConstructor
  public static class QueueInfo {
    private long pending;
    private long inProgress;
  }
}
