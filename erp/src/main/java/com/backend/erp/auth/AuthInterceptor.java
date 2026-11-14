package com.backend.erp.auth;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import com.backend.erp.common.ApiException;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

@Component
public class AuthInterceptor implements HandlerInterceptor {
	public static final String ATTR = "erp.user";
	public static final String TOKEN_ATTR = "erp.token";
	private final AuthService auth;

	public AuthInterceptor(AuthService auth) { this.auth = auth; }

	@Override
	public boolean preHandle(HttpServletRequest req, HttpServletResponse res, Object handler) {
		if ("OPTIONS".equals(req.getMethod())) return true;
		String path = req.getRequestURI();
		if (path.equals("/api/v1/healthz") || path.equals("/api/v1/auth/login")) return true;
		String h = req.getHeader("Authorization");
		if (h == null || !h.startsWith("Bearer ")) throw ApiException.unauthenticated("กรุณาเข้าสู่ระบบ");
		String token = h.substring(7).trim();
		AuthUser u = auth.authenticate(token);
		if (u.mustChange() && !(path.equals("/api/v1/auth/change-password") || path.equals("/api/v1/auth/me") || path.equals("/api/v1/auth/logout"))) {
			throw new ApiException(HttpStatus.UNAUTHORIZED, "PASSWORD_CHANGE_REQUIRED", "ต้องเปลี่ยนรหัสผ่านก่อนใช้งาน");
		}
		if (req.getHeader("X-Client-Audit") != null) com.backend.erp.data.AuditService.QUIET.set(true);
		req.setAttribute(ATTR, u);
		req.setAttribute(TOKEN_ATTR, token);
		return true;
	}

	@Override
	public void afterCompletion(HttpServletRequest req, HttpServletResponse res, Object handler, Exception ex) {
		com.backend.erp.data.AuditService.QUIET.remove();
	}

	public static AuthUser user(HttpServletRequest req) {
		Object u = req.getAttribute(ATTR);
		if (u == null) throw ApiException.unauthenticated("กรุณาเข้าสู่ระบบ");
		return (AuthUser) u;
	}

	public static String token(HttpServletRequest req) { return (String) req.getAttribute(TOKEN_ATTR); }
}
