package ru.security.gateway.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@RequiredArgsConstructor
public class JwtAuthFilter extends OncePerRequestFilter {
  private final JwtService jwtService;

  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String path = request.getRequestURI();
    if (path.startsWith("/api/v1/auth/") || path.startsWith("/actuator") || path.startsWith("/error")) {
      chain.doFilter(request, response);
      return;
    }
    String header = request.getHeader("Authorization");
    // SSE (EventSource) не умеет ставить заголовки: для живой ленты угроз
    // (/api/v1/admin/events — и только для неё) токен принимается из ?access_token=.
    // Цена — токен в query светится в access-логах; прод: access_log off на этом location.
    if (header == null && "/api/v1/admin/events".equals(path)) {
      String qp = request.getParameter("access_token");
      if (qp != null && !qp.isBlank()) header = "Bearer " + qp;
    }
    if (header != null && header.startsWith("Bearer ")) {
      try {
        String token = header.substring(7);
        String email = jwtService.parseEmail(token);
        String role = jwtService.parseRole(token);
        var auth = new UsernamePasswordAuthenticationToken(email, null,
            java.util.List.of(new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_" + role)));
        SecurityContextHolder.getContext().setAuthentication(auth);
      } catch (Exception ignored) {
      }
    }
    chain.doFilter(request, response);
  }
}
