package ru.security.gateway;

import java.lang.annotation.*;
import org.junit.jupiter.api.extension.ExtendWith;

/** Запускает тест только если доступен PostgreSQL (иначе skip, а не fail). */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@ExtendWith(PostgresAvailableCondition.class)
public @interface EnabledIfPostgresAvailable {
}
