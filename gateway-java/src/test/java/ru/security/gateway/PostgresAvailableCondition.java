package ru.security.gateway;

import java.util.Properties;
import org.junit.jupiter.api.extension.ConditionEvaluationResult;
import org.junit.jupiter.api.extension.ExecutionCondition;
import org.junit.jupiter.api.extension.ExtensionContext;

/** Проверяет JDBC-доступность PG ДО загрузки Spring-контекста. */
public class PostgresAvailableCondition implements ExecutionCondition {
  @Override
  public ConditionEvaluationResult evaluateExecutionCondition(ExtensionContext context) {
    String url = System.getenv().getOrDefault("SPRING_DATASOURCE_URL", "jdbc:postgresql://localhost:5432/safemail");
    String user = System.getenv().getOrDefault("SPRING_DATASOURCE_USERNAME", "safemail");
    String pass = System.getenv().getOrDefault("SPRING_DATASOURCE_PASSWORD", "safemail");
    try {
      Properties props = new Properties();
      props.setProperty("user", user);
      props.setProperty("password", pass);
      props.setProperty("connectTimeout", "1");
      props.setProperty("socketTimeout", "2");
      try (java.sql.Connection c = java.sql.DriverManager.getConnection(url, props)) {
        if (c.isValid(2)) return ConditionEvaluationResult.enabled("PostgreSQL доступен");
      }
    } catch (Exception e) {
      return ConditionEvaluationResult.disabled("Нет PostgreSQL (" + e.getMessage() + ") — интеграционный тест пропущен");
    }
    return ConditionEvaluationResult.disabled("Нет PostgreSQL — интеграционный тест пропущен");
  }
}
