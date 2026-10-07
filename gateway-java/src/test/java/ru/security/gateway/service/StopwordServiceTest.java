package ru.security.gateway.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import java.util.List;
import java.util.NoSuchElementException;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import ru.security.gateway.domain.ThreatCategory;
import ru.security.gateway.domain.ThreatStopword;
import ru.security.gateway.repository.ThreatStopwordRepository;

/** CRUD стоп-слов: трим паттерна, patch-обновление, 404 на несуществующие. */
@ExtendWith(MockitoExtension.class)
class StopwordServiceTest {
  @Mock ThreatStopwordRepository stopwords;

  @Test
  void createTrimsPattern() {
    when(stopwords.save(any())).thenAnswer(i -> i.getArgument(0));
    ThreatStopword sw = new StopwordService(stopwords).create("  взрывчатка ", ThreatCategory.TERRORISM);
    assertEquals("взрывчатка", sw.getPattern());
    assertEquals(ThreatCategory.TERRORISM, sw.getCategory());
    assertTrue(sw.isActive());
  }

  @Test
  void createRejectsShortPattern() {
    assertThrows(IllegalArgumentException.class,
        () -> new StopwordService(stopwords).create("x", ThreatCategory.NONE));
    verify(stopwords, never()).save(any());
  }

  @Test
  void updatePatchesOnlyGivenFields() {
    ThreatStopword existing = ThreatStopword.builder()
        .pattern("обнал").category(ThreatCategory.ILLEGAL_ACTIONS).active(true).build();
    when(stopwords.findById(7)).thenReturn(Optional.of(existing));
    when(stopwords.save(any())).thenAnswer(i -> i.getArgument(0));

    ThreatStopword updated = new StopwordService(stopwords).update(7, null, false);

    assertEquals(ThreatCategory.ILLEGAL_ACTIONS, updated.getCategory());
    assertFalse(updated.isActive());
  }

  @Test
  void updateMissingThrows() {
    when(stopwords.findById(404)).thenReturn(Optional.empty());
    assertThrows(NoSuchElementException.class,
        () -> new StopwordService(stopwords).update(404, ThreatCategory.NONE, true));
  }

  @Test
  void deleteMissingThrows() {
    when(stopwords.existsById(404)).thenReturn(false);
    assertThrows(NoSuchElementException.class,
        () -> new StopwordService(stopwords).delete(404));
  }

  @Test
  void deleteExistingRemoves() {
    when(stopwords.existsById(3)).thenReturn(true);
    new StopwordService(stopwords).delete(3);
    verify(stopwords).deleteById(3);
  }

  @Test
  void activeListPassthrough() {
    List<ThreatStopword> active = List.of(ThreatStopword.builder()
        .pattern("обнал").category(ThreatCategory.ILLEGAL_ACTIONS).build());
    when(stopwords.findByActiveTrue()).thenReturn(active);
    assertEquals(active, new StopwordService(stopwords).activeList());
    // create обязан сохранять через репозиторий (ловим captor для чистоты)
    when(stopwords.save(any())).thenAnswer(i -> i.getArgument(0));
    new StopwordService(stopwords).create("тест-паттерн", ThreatCategory.MAN_MADE);
    verify(stopwords).save(ArgumentCaptor.forClass(ThreatStopword.class).capture());
  }
}
