package ru.security.gateway.config;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.subethamail.smtp.server.SMTPServer;
import ru.security.gateway.smtp.InboundMessageHandlerFactory;

@Configuration
@RequiredArgsConstructor
public class GatewayConfig {
  private static final Logger log = LoggerFactory.getLogger(GatewayConfig.class);

  @Value("${smtp.host:0.0.0.0}")
  private String smtpHost;
  @Value("${smtp.port:2525}")
  private int smtpPort;
  @Value("${smtp.submission-port:2587}")
  private int submissionPort;
  @Value("${spring.mail.host:localhost}")
  private String relayHost;
  @Value("${spring.mail.port:1025}")
  private int relayPort;

  @Bean
  public JavaMailSender javaMailSender() {
    JavaMailSenderImpl sender = new JavaMailSenderImpl();
    sender.setHost(relayHost);
    sender.setPort(relayPort);
    return sender;
  }

  @Bean(initMethod = "start", destroyMethod = "stop")
  public SMTPServer smtpServer(InboundMessageHandlerFactory factory) throws Exception {
    SMTPServer server = new SMTPServer(factory);
    server.setBindAddress(java.net.InetAddress.getByName(smtpHost));
    server.setPort(smtpPort);
    log.info("SubEthaSMTP listening on {}:{}", smtpHost, smtpPort);
    return server;
  }

  // Второй инстанс для submission (587/2587): та же фабрика, другой порт.
  @Bean(initMethod = "start", destroyMethod = "stop")
  public SMTPServer submissionServer(InboundMessageHandlerFactory factory) throws Exception {
    SMTPServer server = new SMTPServer(factory);
    server.setBindAddress(java.net.InetAddress.getByName(smtpHost));
    server.setPort(submissionPort);
    log.info("SubEthaSMTP submission on {}:{}", smtpHost, submissionPort);
    return server;
  }

  @Bean
  public org.springframework.web.client.RestTemplate restTemplate() {
    // Без таймаутов зависший ML вешает поток поллера навсегда.
    org.springframework.http.client.SimpleClientHttpRequestFactory f =
        new org.springframework.http.client.SimpleClientHttpRequestFactory();
    f.setConnectTimeout(3000);
    f.setReadTimeout(15000);
    return new org.springframework.web.client.RestTemplate(f);
  }
}
