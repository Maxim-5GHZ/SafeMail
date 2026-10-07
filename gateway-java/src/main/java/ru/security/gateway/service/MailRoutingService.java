package ru.security.gateway.service;

import jakarta.mail.internet.MimeMessage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
@RequiredArgsConstructor
public class MailRoutingService {
  private static final Logger log = LoggerFactory.getLogger(MailRoutingService.class);

  private final JavaMailSender externalMailSender;
  private final InboundPipelineService inboundPipelineService;

  @Value("${mail.domain:corp-sec.ru}")
  private String localDomain;

  public void sendEmail(String fromUser, String toUser, String subject, String body, List<MultipartFile> attachments) {
    int at = toUser == null ? -1 : toUser.lastIndexOf('@');
    if (at < 0) {
      throw new IllegalArgumentException("Некорректный email получателя: " + toUser);
    }
    try {
      MimeMessage message = externalMailSender.createMimeMessage();
      MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");
      helper.setFrom(fromUser);
      helper.setTo(toUser);
      helper.setSubject(subject == null ? "" : subject);
      helper.setText(body == null ? "" : body, true);
      if (attachments != null) {
        for (MultipartFile file : attachments) {
          if (!file.isEmpty()) helper.addAttachment(file.getOriginalFilename(), file);
        }
      }
      String recipientDomain = toUser.substring(toUser.indexOf('@') + 1).toLowerCase();
      if (recipientDomain.equalsIgnoreCase(localDomain)) {
        log.info("Hairpin {} -> {} в AI-пайплайн", fromUser, toUser);
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        message.writeTo(baos);
        inboundPipelineService.processIncomingStream(fromUser, toUser, new ByteArrayInputStream(baos.toByteArray()));
      } else {
        log.info("Outbound {} -> {} без ИИ", fromUser, toUser);
        externalMailSender.send(message);
      }
    } catch (Exception e) {
      throw new RuntimeException("Не удалось отправить сообщение: " + e.getMessage(), e);
    }
  }
}
