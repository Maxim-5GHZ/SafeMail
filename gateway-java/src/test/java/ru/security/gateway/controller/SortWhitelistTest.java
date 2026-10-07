package ru.security.gateway.controller;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class SortWhitelistTest {
  @Test
  void allowedPassThrough() {
    assertEquals("subject", MessageGatewayController.resolveSortBy("subject"));
    assertEquals("createdAt", MessageGatewayController.resolveSortBy("createdAt"));
  }

  @Test
  void unknownFallsBack() {
    assertEquals("createdAt", MessageGatewayController.resolveSortBy("id;DROP TABLE messages"));
    assertEquals("createdAt", MessageGatewayController.resolveSortBy("nonexistent"));
  }
}
