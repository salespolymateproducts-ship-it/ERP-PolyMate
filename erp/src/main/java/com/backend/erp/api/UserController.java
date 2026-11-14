package com.backend.erp.api;

import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.backend.erp.auth.AuthInterceptor;
import com.backend.erp.auth.UserAdminService;

import jakarta.servlet.http.HttpServletRequest;

@RestController
@CrossOrigin("*")
@RequestMapping("/api/v1/users")
public class UserController {
	private final UserAdminService users;

	public UserController(UserAdminService users) { this.users = users; }

	@GetMapping
	public List<Map<String, Object>> list(HttpServletRequest req) { return users.list(AuthInterceptor.user(req)); }

	@GetMapping("/{id}")
	public Map<String, Object> get(@PathVariable String id, HttpServletRequest req) { return users.get(AuthInterceptor.user(req), id); }

	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	public Map<String, Object> create(@RequestBody Map<String, Object> b, HttpServletRequest req) { return users.create(AuthInterceptor.user(req), b); }

	@PatchMapping("/{id}")
	public Map<String, Object> update(@PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest req) {
		return users.update(AuthInterceptor.user(req), id, b);
	}

	@PostMapping("/{id}/reset-password")
	public Map<String, Object> reset(@PathVariable String id, @RequestBody(required = false) Map<String, Object> b, HttpServletRequest req) {
		String pw = b == null || b.get("newPassword") == null ? null : String.valueOf(b.get("newPassword"));
		return users.resetPassword(AuthInterceptor.user(req), id, pw);
	}

	@org.springframework.web.bind.annotation.DeleteMapping("/{id}")
	public Map<String, Object> delete(@PathVariable String id, HttpServletRequest req) {
		users.delete(AuthInterceptor.user(req), id);
		return Map.of("ok", true);
	}

	@PostMapping("/{id}/suspend")
	public Map<String, Object> suspend(@PathVariable String id, HttpServletRequest req) { return users.setStatus(AuthInterceptor.user(req), id, false); }

	@PostMapping("/{id}/activate")
	public Map<String, Object> activate(@PathVariable String id, HttpServletRequest req) { return users.setStatus(AuthInterceptor.user(req), id, true); }
}
