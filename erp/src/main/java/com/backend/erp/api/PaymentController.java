package com.backend.erp.api;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.backend.erp.auth.AuthInterceptor;
import com.backend.erp.common.Json;
import com.backend.erp.data.PaymentService;

import jakarta.servlet.http.HttpServletRequest;

/** การเงิน ขั้น A3: /api/v1/finance/payments (ใบสำคัญจ่าย PV) — สิทธิ์ตรวจใน service */
@RestController
@RequestMapping("/api/v1/finance/payments")
public class PaymentController {
	private final PaymentService pay;

	public PaymentController(PaymentService pay) { this.pay = pay; }

	@GetMapping
	public Object list(@RequestParam(required = false) String status, @RequestParam Map<String, String> params, HttpServletRequest req) { return pay.list(AuthInterceptor.user(req), status, params); }

	@GetMapping("/summary")
	public Map<String, Object> summary(HttpServletRequest req) { return pay.summary(AuthInterceptor.user(req)); }

	@GetMapping("/payables")
	public List<Map<String, Object>> payables(HttpServletRequest req) { return pay.payables(AuthInterceptor.user(req)); }

	@GetMapping("/{id}")
	public Map<String, Object> get(@PathVariable String id, HttpServletRequest req) { return pay.get(AuthInterceptor.user(req), id); }

	@PostMapping
	public Map<String, Object> create(@RequestBody Map<String, Object> b, HttpServletRequest req) { return pay.create(AuthInterceptor.user(req), b); }

	@PostMapping("/{id}/approve")
	public Map<String, Object> approve(@PathVariable String id, HttpServletRequest req) { return pay.approve(AuthInterceptor.user(req), id); }

	@PostMapping("/{id}/reject")
	public Map<String, Object> reject(@PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest req) { return pay.reject(AuthInterceptor.user(req), id, Json.s(b.get("reason"))); }

	@PostMapping("/{id}/cancel")
	public Map<String, Object> cancel(@PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest req) { return pay.cancel(AuthInterceptor.user(req), id, Json.s(b.get("reason"))); }

	@PostMapping("/{id}/pay")
	public Map<String, Object> pay(@PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest req) { return pay.pay(AuthInterceptor.user(req), id, b); }

	@PostMapping("/{id}/void")
	public Map<String, Object> voidPaid(@PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest req) { return pay.voidPaid(AuthInterceptor.user(req), id, Json.s(b.get("reason")), b.get("date")); }
}
