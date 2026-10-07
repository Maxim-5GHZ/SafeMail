package ru.security.gateway.repository;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;
import ru.security.gateway.domain.Message;
import ru.security.gateway.domain.MessageStatus;

public interface MessageRepository extends JpaRepository<Message, UUID>, JpaSpecificationExecutor<Message> {
  @Query(value = "SELECT id FROM messages WHERE status = CAST(:status AS message_status) ORDER BY created_at LIMIT :limit FOR UPDATE SKIP LOCKED", nativeQuery = true)
  List<UUID> pickForProcessing(@Param("status") String status, @Param("limit") int limit);

  /** Атомарный claim: забирает строку в работу только если она ещё PENDING. */
  @Modifying
  @Query(value = "UPDATE messages SET status = CAST('IN_PROGRESS' AS message_status) "
      + "WHERE id = :id AND status = CAST('PENDING' AS message_status)", nativeQuery = true)
  int claimAsInProgress(@Param("id") UUID id);

  /** Возврат зависших IN_PROGRESS (упавший инстанс) обратно в PENDING. */
  @Modifying
  @Query(value = "UPDATE messages SET status = CAST('PENDING' AS message_status) "
      + "WHERE status = CAST('IN_PROGRESS' AS message_status) AND created_at < :cutoff", nativeQuery = true)
  int resetStaleInProgress(@Param("cutoff") OffsetDateTime cutoff);
}
