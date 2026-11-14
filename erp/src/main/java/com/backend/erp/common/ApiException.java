package com.backend.erp.common;

import org.springframework.http.HttpStatus;

public class ApiException extends RuntimeException {
	private final HttpStatus status;
	private final String code;

	public ApiException(HttpStatus status, String code, String message) {
		super(message);
		this.status = status;
		this.code = code;
	}

	public HttpStatus status() { return status; }
	public String code() { return code; }

	public static ApiException badRequest(String msg) { return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", msg); }
	public static ApiException unauthenticated(String msg) { return new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", msg); }
	public static ApiException forbidden(String msg) { return new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", msg); }
	public static ApiException notFound(String msg) { return new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", msg); }
	public static ApiException conflict(String code, String msg) { return new ApiException(HttpStatus.CONFLICT, code, msg); }
	public static ApiException unprocessable(String code, String msg) { return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, code, msg); }
}
