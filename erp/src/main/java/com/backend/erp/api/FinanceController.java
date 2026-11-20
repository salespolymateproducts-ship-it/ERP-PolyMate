package com.backend.erp.api;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.backend.erp.auth.AuthInterceptor;
import com.backend.erp.common.Json;
import com.backend.erp.data.FinanceService;

import jakarta.servlet.http.HttpServletRequest;

/** การเงิน ขั้น 1A: /api/v1/finance/... (สิทธิ์ตรวจใน FinanceService: อ่าน/บันทึก = admin + accounting · อนุมัติ/กลับรายการ/ตั้งค่า = admin) */
@RestController
@RequestMapping("/api/v1/finance")
public class FinanceController {
	private final FinanceService fin;

	public FinanceController(FinanceService fin) { this.fin = fin; }

	@GetMapping("/summary")
	public Map<String, Object> summary(HttpServletRequest req) { return fin.summary(AuthInterceptor.user(req)); }

	@GetMapping("/settings")
	public Map<String, Object> settings(HttpServletRequest req) { return fin.getSettings(AuthInterceptor.user(req)); }

	@PutMapping("/settings")
	public Map<String, Object> saveSettings(@RequestBody Map<String, Object> b, HttpServletRequest req) { return fin.saveSettings(AuthInterceptor.user(req), b); }

	@GetMapping("/accounts")
	public List<Map<String, Object>> accounts(HttpServletRequest req) { return fin.listAccounts(AuthInterceptor.user(req)); }

	@PostMapping("/accounts")
	public Map<String, Object> createAccount(@RequestBody Map<String, Object> b, HttpServletRequest req) { return fin.createAccount(AuthInterceptor.user(req), b); }

	@PutMapping("/accounts/{id}")
	public Map<String, Object> updateAccount(@PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest req) { return fin.updateAccount(AuthInterceptor.user(req), id, b); }

	@GetMapping("/accounts/{id}/ledger")
	public Map<String, Object> ledger(@PathVariable String id, @RequestParam(required = false) String from, @RequestParam(required = false) String to, HttpServletRequest req) {
		return fin.ledger(AuthInterceptor.user(req), id, from, to);
	}

	@GetMapping("/txns")
	public Object txns(@RequestParam(required = false) String kind, @RequestParam(required = false) String status, @RequestParam Map<String, String> params, HttpServletRequest req) {
		return fin.listTxns(AuthInterceptor.user(req), kind, status, params);
	}

	@PostMapping("/txns")
	public Map<String, Object> createTxn(@RequestBody Map<String, Object> b, HttpServletRequest req) { return fin.createTxn(AuthInterceptor.user(req), b); }

	@PostMapping("/txns/{id}/approve")
	public Map<String, Object> approve(@PathVariable String id, HttpServletRequest req) { return fin.approve(AuthInterceptor.user(req), id); }

	@PostMapping("/txns/{id}/reject")
	public Map<String, Object> reject(@PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest req) { return fin.reject(AuthInterceptor.user(req), id, Json.s(b.get("reason"))); }

	@PostMapping("/txns/{id}/cancel")
	public Map<String, Object> cancel(@PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest req) { return fin.cancelPending(AuthInterceptor.user(req), id, Json.s(b.get("reason"))); }

	@PostMapping("/txns/{id}/void")
	public Map<String, Object> voidTxn(@PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest req) { return fin.voidTxn(AuthInterceptor.user(req), id, Json.s(b.get("reason")), b.get("date")); }
}
