package com.backend.erp.auth;

public record AuthUser(String id, String username, String fullName, String role, boolean mustChange) {
	public boolean isAdmin() { return "admin".equals(role); }
}
