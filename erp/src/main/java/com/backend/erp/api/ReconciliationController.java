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
import com.backend.erp.data.ReconciliationService;

import jakarta.servlet.http.HttpServletRequest;

/** การเงิน ขั้น 1C: /api/v1/finance/reconciliations (กระทบยอดบัญชีธนาคาร) — สิทธิ์ตรวจใน service */
@RestController
@RequestMapping("/api/v1/finance/reconciliations")
public class ReconciliationController {
	private final ReconciliationService rec;

	public ReconciliationController(ReconciliationService rec) { this.rec = rec; }

	@GetMapping("/workspace")
	public Map<String, Object> workspace(@RequestParam String accountId, @RequestParam(required = false) String date, HttpServletRequest req) { return rec.workspace(AuthInterceptor.user(req), accountId, date); }

	@GetMapping
	public List<Map<String, Object>> history(@RequestParam String accountId, HttpServletRequest req) { return rec.history(AuthInterceptor.user(req), accountId); }

	@PostMapping
	public Map<String, Object> create(@RequestBody Map<String, Object> b, HttpServletRequest req) { return rec.create(AuthInterceptor.user(req), b); }

	@PostMapping("/{id}/void")
	public Map<String, Object> voidRec(@PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest req) { return rec.voidRec(AuthInterceptor.user(req), id, Json.s(b.get("reason"))); }
}
