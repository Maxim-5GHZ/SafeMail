package ru.security.gateway.dto;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import lombok.Data;
import ru.security.gateway.domain.MessageStatus;
import ru.security.gateway.domain.ThreatCategory;

@Data
public class MessageDto {
  private UUID id;
  private String senderEmail;
  private String recipientEmail;
  private String subject;
  private MessageStatus status;
  private ThreatCategory verdict;
  private OffsetDateTime createdAt;
  private String cleanText;
  private String normalizedText;
  private List<LinkDto> links;
  private List<AttachmentDto> attachments;
  /** Лёгкий счётчик для списка (деталка несёт полный attachments). */
  private int attachmentCount;
  private List<DeliveryDto> deliveries;
  private ThreatReportDto threat;

  @Data
  public static class LinkDto {
    private String url;
    private String status;
    private Integer reputationScore;
    /** Сырой JSON из enrich (reasons скоринга). Фронт делает JSON.parse. */
    private Object details;
  }

  @Data
  public static class AttachmentDto {
    private UUID id;
    private String filename;
    private long sizeBytes;
    private String contentType;
  }

  @Data
  public static class DeliveryDto {
    private String actionTaken;
    private String[] destinationRecipients;
    private String smtpResponse;
    private boolean success;
    private OffsetDateTime attemptedAt;
  }

  @Data
  public static class ThreatReportDto {
    private ThreatCategory category;
    private Double confidence;
    private String explanation;
    private Double heuristicScore;
    private List<String> heuristicFlags;
    private Object spellerFixes;
  }
}
