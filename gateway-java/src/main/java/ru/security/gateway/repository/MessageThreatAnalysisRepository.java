package ru.security.gateway.repository;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import ru.security.gateway.domain.MessageThreatAnalysis;

public interface MessageThreatAnalysisRepository extends JpaRepository<MessageThreatAnalysis, UUID>, JpaSpecificationExecutor<MessageThreatAnalysis> {
  Optional<MessageThreatAnalysis> findByMessageId(UUID messageId);
}
