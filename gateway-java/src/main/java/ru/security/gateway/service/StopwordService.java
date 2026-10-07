package ru.security.gateway.service;

import java.util.List;
import java.util.NoSuchElementException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import ru.security.gateway.domain.ThreatCategory;
import ru.security.gateway.domain.ThreatStopword;
import ru.security.gateway.repository.ThreatStopwordRepository;

/** Управляемые стоп-слова (/admin): CRUD + активный список для пайплайна. */
@Service
@RequiredArgsConstructor
public class StopwordService {
  private final ThreatStopwordRepository stopwords;

  @Transactional(readOnly = true)
  public List<ThreatStopword> list() {
    return stopwords.findAll();
  }

  /** Активные правила для проброса в classify-threat. */
  @Transactional(readOnly = true)
  public List<ThreatStopword> activeList() {
    return stopwords.findByActiveTrue();
  }

  @Transactional
  public ThreatStopword create(String pattern, ThreatCategory category) {
    String p = pattern == null ? "" : pattern.trim();
    if (p.length() < 2) throw new IllegalArgumentException("Паттерн 2..200 символов");
    return stopwords.save(ThreatStopword.builder().pattern(p).category(category).active(true).build());
  }

  @Transactional
  public ThreatStopword update(Integer id, ThreatCategory category, Boolean active) {
    ThreatStopword sw = stopwords.findById(id)
        .orElseThrow(() -> new NoSuchElementException("Stopword not found: " + id));
    if (category != null) sw.setCategory(category);
    if (active != null) sw.setActive(active);
    return stopwords.save(sw);
  }

  @Transactional
  public void delete(Integer id) {
    if (!stopwords.existsById(id)) throw new NoSuchElementException("Stopword not found: " + id);
    stopwords.deleteById(id);
  }
}
