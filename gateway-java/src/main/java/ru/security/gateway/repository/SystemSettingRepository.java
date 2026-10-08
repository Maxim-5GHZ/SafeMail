package ru.security.gateway.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import ru.security.gateway.domain.SystemSetting;

public interface SystemSettingRepository extends JpaRepository<SystemSetting, Integer> {
}
