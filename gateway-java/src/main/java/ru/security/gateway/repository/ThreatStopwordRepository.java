package ru.security.gateway.repository;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import ru.security.gateway.domain.ThreatStopword;

public interface ThreatStopwordRepository extends JpaRepository<ThreatStopword, Integer> {
  List<ThreatStopword> findByActiveTrue();
}
