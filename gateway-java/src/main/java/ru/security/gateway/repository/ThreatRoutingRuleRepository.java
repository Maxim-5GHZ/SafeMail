package ru.security.gateway.repository;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import ru.security.gateway.domain.ThreatCategory;
import ru.security.gateway.domain.ThreatRoutingRule;

public interface ThreatRoutingRuleRepository extends JpaRepository<ThreatRoutingRule, Integer> {
  Optional<ThreatRoutingRule> findByCategory(ThreatCategory category);
}
