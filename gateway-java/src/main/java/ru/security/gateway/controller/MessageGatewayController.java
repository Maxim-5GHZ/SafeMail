package ru.security.gateway.controller;

import jakarta.validation.constraints.*;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.*;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import ru.security.gateway.domain.MessageStatus;
import ru.security.gateway.domain.ThreatCategory;
import ru.security.gateway.dto.MessageDto;
import ru.security.gateway.repository.MessageAttachmentRepository;
import ru.security.gateway.service.MailRoutingService;
import ru.security.gateway.service.MessageService;

@RestController
@RequestMapping("/api/v1/messages")
@RequiredArgsConstructor
@Validated
public class MessageGatewayController {
  private final MessageService messageService;
  private final MailRoutingService routingService;
  private final MessageAttachmentRepository attachmentRepo;

  /** Белый список полей сортировки — неизвестное поле молча не роняем в 500, а откатываемся на createdAt. */
  static final java.util.Set<String> ALLOWED_SORT =
      java.util.Set.of("createdAt", "processedAt", "subject", "senderEmail", "recipientEmail", "status");

  static String resolveSortBy(String sortBy) {
    return ALLOWED_SORT.contains(sortBy) ? sortBy : "createdAt";
  }

  @GetMapping
  public ResponseEntity<Page<MessageDto>> getMessages(
      @RequestParam(required = false) MessageStatus status,
      @RequestParam(required = false) ThreatCategory category,
      @RequestParam(required = false) @Email(message = "Некорректный email отправителя") String sender,
      @RequestParam(required = false) @Email(message = "Некорректный email получателя") String recipient,
      @RequestParam(required = false) @Size(max = 200, message = "Поисковый запрос до 200 символов") String query,
      @RequestParam(defaultValue = "0") @Min(0) int page,
      @RequestParam(defaultValue = "20") @Min(1) @Max(100) int size,
      @RequestParam(defaultValue = "createdAt") String sortBy,
      @RequestParam(defaultValue = "DESC") Sort.Direction direction) {
    Pageable pageable = PageRequest.of(page, size, Sort.by(direction, resolveSortBy(sortBy)));
    return ResponseEntity.ok(messageService.getFilteredMessages(status, category, sender, recipient, query, pageable));
  }

  @GetMapping("/{id}")
  public ResponseEntity<MessageDto> getMessageById(@PathVariable UUID id) {
    return ResponseEntity.ok(messageService.getMessageDetails(id));
  }

  @PostMapping("/{id}/reprocess")
  public ResponseEntity<Void> reprocessMessage(@PathVariable UUID id) {
    messageService.triggerReprocessing(id);
    return ResponseEntity.accepted().build();
  }

  @PostMapping(value = "/send", consumes = {"multipart/form-data"})
  public ResponseEntity<Void> send(
      @RequestParam @Email String from,
      @RequestParam @Email String to,
      @RequestParam String subject,
      @RequestParam String body,
      @RequestParam(required = false) java.util.List<MultipartFile> files) {
    routingService.sendEmail(from, to, subject, body, files);
    return ResponseEntity.accepted().build();
  }

  @GetMapping("/{id}/attachments/{attachmentId}")
  public ResponseEntity<byte[]> downloadAttachment(@PathVariable UUID id, @PathVariable UUID attachmentId) {
    var att = attachmentRepo.findById(attachmentId).orElseThrow();
    if (!att.getMessageId().equals(id)) throw new IllegalArgumentException("Attachment mismatch");
    return ResponseEntity.ok()
        .header("Content-Disposition", "attachment; filename=\"" + att.getFilename() + "\"")
        .header("Content-Type", att.getContentType() == null ? "application/octet-stream" : att.getContentType())
        .body(att.getFileContent() == null ? new byte[0] : att.getFileContent());
  }
}
