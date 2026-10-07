package ru.security.gateway.repository;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import ru.security.gateway.domain.MessageLink;

public interface MessageLinkRepository extends JpaRepository<MessageLink, Long> {
  List<MessageLink> findByMessageId(UUID messageId);
}
