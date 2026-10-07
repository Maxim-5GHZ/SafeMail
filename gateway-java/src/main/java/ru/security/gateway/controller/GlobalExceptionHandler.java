package ru.security.gateway.controller;

import java.util.Map;
import java.util.NoSuchElementException;
import org.springframework.http.*;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;

@RestControllerAdvice
public class GlobalExceptionHandler {
  @ExceptionHandler(IllegalArgumentException.class)
  public ResponseEntity<Map<String, String>> badRequest(IllegalArgumentException e) {
    return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
  }

  @ExceptionHandler(NoSuchElementException.class)
  public ResponseEntity<Map<String, String>> notFound(NoSuchElementException e) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", e.getMessage()));
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<Map<String, String>> validation(MethodArgumentNotValidException e) {
    String msg = e.getBindingResult().getFieldErrors().stream()
        .map(f -> f.getField() + ": " + f.getDefaultMessage())
        .findFirst().orElse("validation error");
    return ResponseEntity.badRequest().body(Map.of("error", msg));
  }

  /** Валидация @RequestParam/@PathVariable (@Min/@Max на days и т.п.) — это 400, а не 500. */
  @ExceptionHandler({jakarta.validation.ConstraintViolationException.class,
      org.springframework.web.method.annotation.HandlerMethodValidationException.class})
  public ResponseEntity<Map<String, String>> paramValidation(Exception e) {
    return ResponseEntity.badRequest().body(Map.of("error", "Некорректные параметры запроса"));
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<Map<String, String>> internal(Exception e) {
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
        .body(Map.of("error", e.getMessage() == null ? "internal error" : e.getMessage()));
  }
}
