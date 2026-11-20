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
import com.backend.erp.data.ReceiptService;

import jakarta.servlet.http.HttpServletRequest;

/** การเงิน ขั้น A2: /api/v1/finance/receipts (รับเงินลูกค้า RV) — สิทธิ์ตรวจใน service */
@RestController
@RequestMapping("/api/v1/finance/receipts")
public class ReceiptController {
	private final ReceiptService rc;

	public ReceiptController(ReceiptService rc) { this.rc = rc; }

	@GetMapping
	public Object list(@RequestParam(required = false) String status, @RequestParam(required = false) String customerId, @RequestParam Map<String, String> params, HttpServletRequest req) {
		return rc.list(AuthInterceptor.user(req), status, customerId, params);
	}

	@GetMapping("/summary")
	public Map<String, Object> summary(HttpServletRequest req) { return rc.summary(AuthInterceptor.user(req)); }

	@GetMapping("/rc-status")
	public List<Map<String, Object>> rcStatus(HttpServletRequest req) { return rc.rcStatus(AuthInterceptor.user(req)); }

	@GetMapping("/wht-invoices")
	public List<String> whtInvoices(HttpServletRequest req) { return rc.whtInvoices(AuthInterceptor.user(req)); }

	@GetMapping("/open-invoices")
	public List<Map<String, Object>> openInvoices(@RequestParam String customerId, HttpServletRequest req) { return rc.openInvoices(AuthInterceptor.user(req), customerId); }

	@GetMapping("/{id}")
	public Map<String, Object> get(@PathVariable String id, HttpServletRequest req) { return rc.get(AuthInterceptor.user(req), id); }

	@PostMapping
	public Map<String, Object> create(@RequestBody Map<String, Object> b, HttpServletRequest req) { return rc.create(AuthInterceptor.user(req), b); }

	@PostMapping("/{id}/approve")
	public Map<String, Object> approve(@PathVariable String id, HttpServletRequest req) { return rc.approve(AuthInterceptor.user(req), id); }

	@PostMapping("/{id}/reject")
	public Map<String, Object> reject(@PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest req) { return rc.reject(AuthInterceptor.user(req), id, Json.s(b.get("reason"))); }

	@PostMapping("/{id}/cancel")
	public Map<String, Object> cancel(@PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest req) { return rc.cancelPending(AuthInterceptor.user(req), id, Json.s(b.get("reason"))); }

	@PostMapping("/{id}/void")
	public Map<String, Object> voidReceipt(@PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest req) { return rc.voidReceipt(AuthInterceptor.user(req), id, Json.s(b.get("reason")), b.get("date")); }

	@PostMapping("/{id}/wht-cert")
	public Map<String, Object> whtCert(@PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest req) { return rc.saveWhtCert(AuthInterceptor.user(req), id, b); }

	@PostMapping("/{id}/refund")
	public Map<String, Object> refund(@PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest req) { return rc.refund(AuthInterceptor.user(req), id, b); }
}
