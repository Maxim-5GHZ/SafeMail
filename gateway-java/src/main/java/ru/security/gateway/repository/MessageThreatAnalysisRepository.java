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

  /**
   * Счётчики вердиктов только по карантину (письма в статусе REROUTED).
   * Строка: [String verdict, Long]. Native: связь Message→analysis в JPA отсутствует,
   * поэтому JOIN по message_id вручную; enum в PG — CAST'ы по устоявшемуся шаблону.
   */
  @Query(value = "SELECT CAST(a.final_verdict AS text), COUNT(*) FROM message_threat_analysis a "
      + "JOIN messages m ON m.id = a.message_id "
      + "WHERE m.status = CAST('REROUTED' AS message_status) GROUP BY a.final_verdict",
      nativeQuery = true)
  List<Object[]> countByCategoryInQuarantine();

  /**
   * То же, но по письмам, отправленным безопасникам (status FORWARDED):
   * чипы категорий вкладки «Отправлено в ИБ» в SOC-таблице.
   */
  @Query(value = "SELECT CAST(a.final_verdict AS text), COUNT(*) FROM message_threat_analysis a "
      + "JOIN messages m ON m.id = a.message_id "
      + "WHERE m.status = CAST('FORWARDED' AS message_status) GROUP BY a.final_verdict",
      nativeQuery = true)
  List<Object[]> countByCategoryForwarded();
}
