package ru.security.gateway.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import java.util.List;
import java.util.Properties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.util.ReflectionTestUtils;

/** Hairpin без БД: свой домен — в пайплайн, чужой — сразу в relay. */
@ExtendWith(MockitoExtension.class)
class MailRoutingServiceTest {
  @Mock JavaMailSender mailSender;
  @Mock InboundPipelineService pipeline;

  MailRoutingService svc;

  @BeforeEach
  void setUp() {
    svc = new MailRoutingService(mailSender, pipeline);
    ReflectionTestUtils.setField(svc, "localDomain", "corp-sec.ru");
    lenient().when(mailSender.createMimeMessage())
        .thenAnswer(inv -> new MimeMessage(Session.getInstance(new Properties())));
  }

  @Test
  void localDomainGoesToPipeline() {
    svc.sendEmail("a@corp-sec.ru", "b@corp-sec.ru", "s", "body", null);
    verify(pipeline).processIncomingStream(eq("a@corp-sec.ru"), eq("b@corp-sec.ru"), any());
    verify(mailSender, never()).send(any(MimeMessage.class));
  }

  @Test
  void foreignDomainGoesDirectly() {
    svc.sendEmail("a@corp-sec.ru", "x@gmail.com", "s", "body", null);
    verify(mailSender).send(any(MimeMessage.class));
    verify(pipeline, never()).processIncomingStream(any(), any(), any());
  }

  @Test
  void localDomainCaseInsensitive() {
    svc.sendEmail("a@corp-sec.ru", "B@CORP-SEC.RU", "s", "body", null);
    verify(pipeline).processIncomingStream(any(), any(), any());
  }

  @Test
  void invalidRecipientRejected() {
    assertThrows(IllegalArgumentException.class,
        () -> svc.sendEmail("a@corp-sec.ru", "not-an-email", "s", "b", null));
  }

  @Test
  void attachmentsPassedThrough() throws Exception {
    var file = mock(org.springframework.web.multipart.MultipartFile.class);
    when(file.isEmpty()).thenReturn(false);
    when(file.getOriginalFilename()).thenReturn("a.txt");
    svc.sendEmail("a@corp-sec.ru", "x@gmail.com", "s", "b", List.of(file));
    verify(file).isEmpty();
  }
}
