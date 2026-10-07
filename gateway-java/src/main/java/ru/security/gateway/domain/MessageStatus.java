package ru.security.gateway.domain;

public enum MessageStatus {
  PENDING, IN_PROGRESS, PARSED, ENRICHED, ANALYZED, DELIVERED, REROUTED, FAILED
}
