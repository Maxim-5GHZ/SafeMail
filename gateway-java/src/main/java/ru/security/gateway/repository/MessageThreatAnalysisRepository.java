package ru.security.gateway.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import ru.security.gateway.domain.MessageThreatAnalysis;

public interface MessageThreatAnalysisRepository extends JpaRepository<MessageThreatAnalysis, UUID>, JpaSpecificationExecutor<MessageThreatAnalysis> {
  Optional<MessageThreatAnalysis> findByMessageId(UUID messageId);

  /** Счётчики по финальному вердикту. Строка: [ThreatCategory, Long]. */
  @Query("SELECT a.finalVerdict, COUNT(a) FROM MessageThreatAnalysis a GROUP BY a.finalVerdict")
  List<Object[]> countByCategory();
}
