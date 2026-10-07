package ru.security.gateway.security;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import javax.crypto.SecretKey;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class JwtService {
  private final SecretKey key;
  private final long ttlMillis;

  public JwtService(@Value("${app.jwt-secret:change-me-to-32-chars-minimum-secret-12345}") String secret,
                    @Value("${app.jwt-ttl-minutes:720}") long ttlMinutes) {
    byte[] bytes = secret.getBytes(StandardCharsets.UTF_8);
    if (bytes.length < 32) {
      byte[] padded = new byte[32];
      System.arraycopy(bytes, 0, padded, 0, bytes.length);
      bytes = padded;
    }
    this.key = Keys.hmacShaKeyFor(bytes);
    this.ttlMillis = ttlMinutes * 60_000L;
  }

  public String generate(String email) {
    return generate(email, "USER");
  }

  public String generate(String email, String role) {
    Date now = new Date();
    return Jwts.builder()
        .subject(email)
        .claim("role", role == null ? "USER" : role)
        .issuedAt(now)
        .expiration(new Date(now.getTime() + ttlMillis))
        .signWith(key)
        .compact();
  }

  public String parseEmail(String token) {
    return Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload().getSubject();
  }

  public String parseRole(String token) {
    try {
      String role = Jwts.parser().verifyWith(key).build()
          .parseSignedClaims(token).getPayload().get("role", String.class);
      return role == null ? "USER" : role;
    } catch (Exception e) {
      return "USER";
    }
  }
}
