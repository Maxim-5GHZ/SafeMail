package ru.security.gateway.repository;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import ru.security.gateway.domain.MessageAttachment;

public interface MessageAttachmentRepository extends JpaRepository<MessageAttachment, UUID> {
  List<MessageAttachment> findByMessageId(UUID messageId);

  long countByMessageId(UUID messageId);
}
