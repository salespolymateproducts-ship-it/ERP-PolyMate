package com.backend.erp.common;

import java.util.LinkedHashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {
	private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

	@ExceptionHandler(ApiException.class)
	public ResponseEntity<Map<String, Object>> api(ApiException e) {
		return body(e.status(), e.code(), e.getMessage());
	}

	@ExceptionHandler(HttpMessageNotReadableException.class)
	public ResponseEntity<Map<String, Object>> unreadable(HttpMessageNotReadableException e) {
		return body(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "รูปแบบ JSON ไม่ถูกต้อง");
	}

	@ExceptionHandler(Exception.class)
	public ResponseEntity<Map<String, Object>> other(Exception e) {
		if (e instanceof ErrorResponse er) {
			return body(HttpStatus.valueOf(er.getStatusCode().value()), "HTTP_ERROR", "คำขอไม่ถูกต้อง");
		}
		log.error("Unhandled error", e);
		return body(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL", "เกิดข้อผิดพลาดภายในระบบ");
	}

	private ResponseEntity<Map<String, Object>> body(HttpStatus s, String code, String msg) {
		Map<String, Object> err = new LinkedHashMap<>();
		err.put("code", code);
		err.put("message", msg);
		Map<String, Object> out = new LinkedHashMap<>();
		out.put("error", err);
		return ResponseEntity.status(s).body(out);
	}
}
