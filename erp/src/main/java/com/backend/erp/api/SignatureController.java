package com.backend.erp.api;

import java.util.Map;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.backend.erp.auth.AuthInterceptor;
import com.backend.erp.data.SignatureService;

import jakarta.servlet.http.HttpServletRequest;

/** ลายเซ็นอิเล็กทรอนิกส์ ระดับ 2: /api/v1/signatures — ของฉัน (ตั้ง/ลบ) และดึงตามเอกสาร (ตรวจสิทธิ์ + Audit Log ใน service) */
@RestController
@RequestMapping("/api/v1/signatures")
public class SignatureController {
	private final SignatureService sig;

	public SignatureController(SignatureService sig) { this.sig = sig; }

	@GetMapping("/me")
	public Map<String, Object> mine(HttpServletRequest req) { return sig.mine(AuthInterceptor.user(req)); }

	@PutMapping("/me")
	public Map<String, Object> set(@RequestBody Map<String, Object> b, HttpServletRequest req) { return sig.set(AuthInterceptor.user(req), b.get("image")); }

	@DeleteMapping("/me")
	public Map<String, Object> remove(HttpServletRequest req) { return sig.remove(AuthInterceptor.user(req)); }

	@GetMapping("/for/pv/{id}")
	public Map<String, Object> forPv(@PathVariable String id, HttpServletRequest req) { return sig.forPv(AuthInterceptor.user(req), id); }

	@GetMapping("/for/doc/{id}")
	public Map<String, Object> forDoc(@PathVariable String id, HttpServletRequest req) { return sig.forDoc(AuthInterceptor.user(req), id); }
}
