package ru.security.gateway.smtp;

import java.io.IOException;
import java.io.InputStream;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.subethamail.smtp.MessageContext;
import org.subethamail.smtp.MessageHandler;
import org.subethamail.smtp.MessageHandlerFactory;
import org.subethamail.smtp.RejectException;
import ru.security.gateway.service.InboundPipelineService;

@Component
@RequiredArgsConstructor
public class InboundMessageHandlerFactory implements MessageHandlerFactory {

  private final InboundPipelineService pipelineService;

  @Override
  public MessageHandler create(MessageContext ctx) {
    return new Handler(pipelineService);
  }

  static class Handler implements MessageHandler {
    private static final Logger log = LoggerFactory.getLogger(Handler.class);
    private final InboundPipelineService pipelineService;
    private String from;
    private final java.util.List<String> recipients = new java.util.ArrayList<>();

    Handler(InboundPipelineService pipelineService) {
      this.pipelineService = pipelineService;
    }

    @Override
    public void from(String from) throws RejectException {
      this.from = from;
    }

    @Override
    public void recipient(String recipient) throws RejectException {
      this.recipients.add(recipient); // RCPT TO приходит по одному на каждого получателя
    }

    @Override
    public void data(InputStream data) throws RejectException, IOException {
      try {
        byte[] raw = data.readAllBytes();
        java.util.List<String> targets = recipients.isEmpty() ? java.util.List.of("unknown") : java.util.List.copyOf(recipients);
        for (String rcpt : targets) {
          pipelineService.receiveRaw(from, rcpt, raw);
        }
        log.info("SMTP accepted {} -> {} ({} bytes, {} получателей)", from, targets, raw.length, targets.size());
      } catch (Exception e) {
        log.error("SMTP receive failed", e);
        throw new RejectException(451, "Temporary failure: " + e.getMessage());
      }
    }

    @Override
    public void done() {
    }
  }
}
