package ru.security.gateway.repository;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import ru.security.gateway.domain.MessageParsedData;

public interface MessageParsedDataRepository extends JpaRepository<MessageParsedData, UUID> {
  Optional<MessageParsedData> findByMessageId(UUID messageId);
}
