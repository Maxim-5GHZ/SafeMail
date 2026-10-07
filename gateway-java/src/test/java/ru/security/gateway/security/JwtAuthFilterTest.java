package ru.security.gateway.security;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.core.context.SecurityContextHolder;

@ExtendWith(MockitoExtension.class)
class JwtAuthFilterTest {
  @Mock JwtService jwtService;
  @Mock jakarta.servlet.http.HttpServletRequest request;
  @Mock jakarta.servlet.http.HttpServletResponse response;
  @Mock FilterChain chain;

  @AfterEach
  void clean() {
    SecurityContextHolder.clearContext();
  }

  private void run(String uri, String header) throws Exception {
    when(request.getRequestURI()).thenReturn(uri);
    lenient().when(request.getHeader("Authorization")).thenReturn(header);
    new JwtAuthFilter(jwtService).doFilter(request, response, chain);
  }

  @Test
  void adminGetsRoleAdmin() throws Exception {
    when(jwtService.parseEmail("t")).thenReturn("admin@corp-sec.ru");
    when(jwtService.parseRole("t")).thenReturn("ADMIN");
    run("/api/v1/messages", "Bearer t");
    var auth = SecurityContextHolder.getContext().getAuthentication();
    assertNotNull(auth);
    assertTrue(auth.getAuthorities().stream().anyMatch(a -> a.getAuthority().equals("ROLE_ADMIN")));
    verify(chain).doFilter(request, response);
  }

  @Test
  void badTokenNoAuth() throws Exception {
    when(jwtService.parseEmail("bad")).thenThrow(new RuntimeException("bad"));
    run("/api/v1/messages", "Bearer bad");
    assertNull(SecurityContextHolder.getContext().getAuthentication());
  }

  @Test
  void authEndpointsSkipped() throws Exception {
    run("/api/v1/auth/login", null);
    verifyNoInteractions(jwtService);
    verify(chain).doFilter(request, response);
  }
}
