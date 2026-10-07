package ru.security.gateway.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import ru.security.gateway.domain.MessageStatus;
import ru.security.gateway.domain.ThreatCategory;
import ru.security.gateway.dto.AdminStatsResponse;
import ru.security.gateway.repository.MessageRepository;
import ru.security.gateway.repository.MessageThreatAnalysisRepository;

/** Дашборд /admin: агрегаты собираются из GROUP BY без БД (моки репозиториев). */
@ExtendWith(MockitoExtension.class)
class AdminStatsServiceTest {
  @Mock MessageRepository messages;
  @Mock MessageThreatAnalysisRepository analyses;

  @Test
  void statsAggregateStatusesCategoriesDaysAndQueue() {
    when(messages.count()).thenReturn(10L);
    when(messages.countByStatus()).thenReturn(List.<Object[]>of(
        new Object[]{MessageStatus.DELIVERED, 6L},
        new Object[]{MessageStatus.REROUTED, 2L},
        new Object[]{MessageStatus.PENDING, 1L},
        new Object[]{MessageStatus.IN_PROGRESS, 1L}));
    when(analyses.countByCategory()).thenReturn(List.<Object[]>of(
        new Object[]{ThreatCategory.TERRORISM, 1L},
        new Object[]{ThreatCategory.OTHER_THREAT, 1L}));
    when(messages.countPerDaySince(any(OffsetDateTime.class))).thenReturn(List.<Object[]>of(
        new Object[]{LocalDate.of(2026, 10, 6), 4L, 1L},
        new Object[]{LocalDate.of(2026, 10, 7), 6L, 1L}));

    AdminStatsResponse stats = new AdminStatsService(messages, analyses).getStats(14);

    assertEquals(10L, stats.getTotal());
    assertEquals(6L, stats.getByStatus().get("DELIVERED"));
    assertEquals(1L, stats.getByCategory().get("TERRORISM"));
    assertEquals(2, stats.getPerDay().size());
    assertEquals("2026-10-06", stats.getPerDay().get(0).getDate());
    assertEquals(1L, stats.getPerDay().get(1).getRerouted());
    assertEquals(1L, stats.getQueue().getPending());
    assertEquals(1L, stats.getQueue().getInProgress());
  }

  @Test
  void emptyDatabaseYieldsZeroQueue() {
    when(messages.count()).thenReturn(0L);
    when(messages.countByStatus()).thenReturn(List.of());
    when(analyses.countByCategory()).thenReturn(List.of());
    when(messages.countPerDaySince(any(OffsetDateTime.class))).thenReturn(List.of());

    AdminStatsResponse stats = new AdminStatsService(messages, analyses).getStats(7);

    assertEquals(0L, stats.getTotal());
    assertTrue(stats.getPerDay().isEmpty());
    assertEquals(0L, stats.getQueue().getPending());
    assertEquals(0L, stats.getQueue().getInProgress());
  }
}
