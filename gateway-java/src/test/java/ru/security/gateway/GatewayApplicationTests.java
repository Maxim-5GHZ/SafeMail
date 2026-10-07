package ru.security.gateway;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * Интеграционный тест: требует живой PostgreSQL. Без базы — пропускается
 * через {@link EnabledIfPostgresAvailable}, чтобы `mvn test` был зелёным.
 * С базой: SPRING_DATASOURCE_URL/USERNAME/PASSWORD.
 */
@SpringBootTest
@EnabledIfPostgresAvailable
class GatewayApplicationTests {
  @Test
  void contextLoads() {
  }
}
