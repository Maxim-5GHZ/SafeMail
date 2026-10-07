package ru.security.gateway.repository;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import ru.security.gateway.domain.DeliveryLog;

public interface DeliveryLogRepository extends JpaRepository<DeliveryLog, Long> {
  List<DeliveryLog> findByMessageId(UUID messageId);
}
