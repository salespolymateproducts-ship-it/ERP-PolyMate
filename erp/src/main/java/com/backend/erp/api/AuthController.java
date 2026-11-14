package com.backend.erp.api;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.backend.erp.auth.AuthInterceptor;
import com.backend.erp.auth.AuthService;
import com.backend.erp.auth.AuthUser;
import com.backend.erp.common.Json;

import jakarta.servlet.http.HttpServletRequest;

@RestController
@RequestMapping("/api/v1")
public class AuthController {
	private final AuthService auth;

	public AuthController(AuthService auth) { this.auth = auth; }

	@GetMapping("/healthz")
	public Map<String, Object> health() { return Map.of("status", "ok"); }

	@PostMapping("/auth/login")
	public Map<String, Object> login(@RequestBody Map<String, Object> b, HttpServletRequest req) {
		return auth.login(Json.s(b.get("username")), Json.s(b.get("password")), req.getRemoteAddr(), req.getHeader("User-Agent"));
	}

	@PostMapping("/auth/logout")
	public Map<String, Object> logout(HttpServletRequest req) {
		auth.logout(AuthInterceptor.user(req), AuthInterceptor.token(req));
		return Map.of("ok", true);
	}

	@GetMapping("/auth/me")
	public Map<String, Object> me(HttpServletRequest req) {
		AuthUser u = AuthInterceptor.user(req);
		return auth.me(u);
	}

	@PostMapping("/auth/change-password")
	public Map<String, Object> changePassword(@RequestBody Map<String, Object> b, HttpServletRequest req) {
		auth.changeOwnPassword(AuthInterceptor.user(req), Json.s(b.get("currentPassword")), Json.s(b.get("newPassword")), AuthInterceptor.token(req));
		return Map.of("ok", true);
	}
}
