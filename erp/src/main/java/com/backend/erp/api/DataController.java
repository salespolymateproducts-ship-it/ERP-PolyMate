package com.backend.erp.api;

import java.util.List;
import java.util.Map;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.backend.erp.auth.AuthInterceptor;
import com.backend.erp.auth.AuthUser;
import com.backend.erp.common.Json;
import com.backend.erp.data.AdminService;
import com.backend.erp.data.AuditService;
import com.backend.erp.data.CounterService;
import com.backend.erp.data.RecordService;
import com.backend.erp.data.BomService;
import com.backend.erp.data.MachineService;
import com.backend.erp.data.WorkflowService;

import jakarta.servlet.http.HttpServletRequest;

/**
 * CRUD ทุก collection: /{collection} = docs, customers, suppliers, purchaseOrders, expenses, employees,
 * materials, finished, workOrders, qc, molds, machines, boms, stockMovements
 */
@RestController
@RequestMapping("/api/v1")
public class DataController {
	private final RecordService records;
	private final WorkflowService workflow;
	private final MachineService machineService;
	private final BomService bomService;
	private final CounterService counters;
	private final AuditService audit;
	private final AdminService admin;

	public DataController(RecordService records, WorkflowService workflow, CounterService counters, AuditService audit, AdminService admin, MachineService machineService, BomService bomService) {
		this.bomService = bomService;
		this.records = records;
		this.workflow = workflow;
		this.machineService = machineService;
		this.counters = counters;
		this.audit = audit;
		this.admin = admin;
	}

	// ---------- collections ----------
	@GetMapping("/{collection}")
	public ResponseEntity<String> list(@PathVariable String collection, @RequestParam(required = false) String q,
			@RequestParam(defaultValue = "1000") int limit, @RequestParam(defaultValue = "0") int offset, HttpServletRequest req) {
		return Json.raw(Json.array(records.list(AuthInterceptor.user(req), collection, q, limit, offset)));
	}

	@GetMapping("/{collection}/{id}")
	public ResponseEntity<String> get(@PathVariable String collection, @PathVariable String id, HttpServletRequest req) {
		return Json.raw(records.get(AuthInterceptor.user(req), collection, id));
	}

	@PostMapping("/{collection}")
	public ResponseEntity<String> create(@PathVariable String collection, @RequestBody Map<String, Object> body, HttpServletRequest req) {
		return Json.rawStatus(201, records.create(AuthInterceptor.user(req), collection, body));
	}

	@PutMapping("/{collection}/{id}")
	public ResponseEntity<String> replace(@PathVariable String collection, @PathVariable String id, @RequestBody Map<String, Object> body, HttpServletRequest req) {
		return Json.raw(records.replace(AuthInterceptor.user(req), collection, id, body));
	}

	@PatchMapping("/{collection}/{id}")
	public ResponseEntity<String> patch(@PathVariable String collection, @PathVariable String id, @RequestBody Map<String, Object> body, HttpServletRequest req) {
		return Json.raw(records.patch(AuthInterceptor.user(req), collection, id, body));
	}

	@DeleteMapping("/{collection}/{id}")
	public Map<String, Object> delete(@PathVariable String collection, @PathVariable String id, HttpServletRequest req) {
		records.delete(AuthInterceptor.user(req), collection, id);
		return Map.of("ok", true);
	}

	// ---------- เลขที่เอกสาร ----------
	@GetMapping("/counters/{prefix}/peek")
	public Map<String, Object> peek(@PathVariable String prefix, @RequestParam(required = false) String date) { return counters.peek(prefix, date); }

	@PostMapping("/counters/{prefix}/next")
	public Map<String, Object> next(@PathVariable String prefix, @RequestParam(required = false) String date) { return counters.next(prefix, date); }

	/** รวมเลขนับจาก client: last_value = max(เดิม, ค่าที่ส่ง) */
	@PutMapping("/counters")
	public Map<String, Object> syncCounters(@RequestBody Map<String, Object> b) {
		counters.mergeMax(b);
		return counters.all();
	}

	// ---------- Audit ----------
	@GetMapping("/audit-logs")
	public ResponseEntity<String> auditLogs(@RequestParam(required = false) String q, @RequestParam(required = false) String action,
			@RequestParam(required = false) String entity, @RequestParam(required = false) String user,
			@RequestParam(required = false) String from, @RequestParam(required = false) String to,
			@RequestParam(defaultValue = "200") int limit, @RequestParam(defaultValue = "0") int offset, HttpServletRequest req) {
		AuthUser u = AuthInterceptor.user(req);
		if (!u.isAdmin() && !"accounting".equals(u.role())) throw com.backend.erp.common.ApiException.forbidden("ไม่มีสิทธิ์ดู Audit Log");
		return Json.raw(Json.array(audit.search(q, action, entity, user, from, to, Math.max(1, Math.min(limit, 2000)), Math.max(0, offset))));
	}

	/** เหตุการณ์ฝั่ง client ที่ต้องบันทึก (เช่น PRINT, EXPORT) — จำกัดชนิด action */
	@PostMapping("/audit-logs")
	public Map<String, Object> clientAudit(@RequestBody Map<String, Object> b, HttpServletRequest req) {
		String action = Json.s(b.get("action"));
		if (!action.matches("[A-Z_]{2,20}") || action.startsWith("LOGIN") || action.equals("LOGOUT")) throw com.backend.erp.common.ApiException.badRequest("action ไม่ถูกต้อง");
		audit.log(AuthInterceptor.user(req), action, Json.s(b.get("entity")), Json.s(b.get("entityId")), Json.s(b.get("detail")));
		return Map.of("ok", true);
	}

	// ---------- Settings ----------
	@GetMapping("/settings/company")
	public ResponseEntity<String> company() { return Json.raw(admin.company()); }

	@PutMapping("/settings/company")
	public ResponseEntity<String> saveCompany(@RequestBody Map<String, Object> b, HttpServletRequest req) {
		return Json.raw(admin.saveCompany(AuthInterceptor.user(req), b));
	}

	// ---------- Workflow actions ----------
	@PostMapping("/actions/purchase-orders/{id}/receive")
	public Map<String, Object> receivePO(@PathVariable String id, HttpServletRequest req) {
		return workflow.receivePO(AuthInterceptor.user(req), id);
	}

	@PostMapping("/actions/work-orders/{id}/produce")
	public Map<String, Object> produce(@PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest req) {
		return workflow.produceWO(AuthInterceptor.user(req), id, Json.num(b.get("produced")), Json.num(b.get("ng")),
			b.get("shift") == null ? "" : String.valueOf(b.get("shift")), b.get("supervisor") == null ? "" : String.valueOf(b.get("supervisor")),
			b.get("operator") == null ? "" : String.valueOf(b.get("operator")));
	}

	@PostMapping("/actions/work-orders/{id}/material")
	public Map<String, Object> woMaterial(@PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest req) {
		return workflow.issueWoMaterial(AuthInterceptor.user(req), id, Json.s(b.get("item")), Json.num(b.get("qty")), Json.s(b.get("kind")), Json.s(b.get("reason")));
	}

	@PostMapping("/actions/work-orders/{id}/bom-adjust")
	public Map<String, Object> bomAdjust(@PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest req) {
		return bomService.adjustWorkOrder(AuthInterceptor.user(req), id, b.get("adjustments") instanceof java.util.List<?> l ? l : java.util.List.of(), Json.s(b.get("reason")));
	}

	@PostMapping("/actions/stock/adjust")
	public Map<String, Object> adjust(@RequestBody Map<String, Object> b, HttpServletRequest req) {
		return workflow.adjustStock(AuthInterceptor.user(req), Json.s(b.get("code")), Json.num(b.get("delta")),
			Json.s(b.get("ref")), Json.s(b.get("note")), Boolean.TRUE.equals(b.get("allowNegative")));
	}

	@PostMapping("/actions/materials/{id}/adjust-cost")
	public Map<String, Object> adjustMaterialCost(@PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest req) {
		return workflow.adjustMaterialCost(AuthInterceptor.user(req), id, Json.num(b.get("cost")), Json.s(b.get("reason")));
	}

	@PostMapping("/actions/products/{id}/adjust-cost")
	public Map<String, Object> adjustProductCost(@PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest req) {
		return workflow.adjustProductCost(AuthInterceptor.user(req), id, Json.num(b.get("cost")), Json.s(b.get("reason")));
	}

	@PostMapping("/actions/machines/{id}/condition")
	public Map<String, Object> machineCondition(@PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest req) {
		return machineService.setCondition(AuthInterceptor.user(req), id, Json.s(b.get("condition")), Json.s(b.get("reason")));
	}

	@PostMapping("/actions/machines/{id}/maintenance")
	public Map<String, Object> machineMaintenance(@PathVariable String id, @RequestBody Map<String, Object> b, HttpServletRequest req) {
		return machineService.logMaintenance(AuthInterceptor.user(req), id, b);
	}

	// ---------- Bootstrap / backup ----------
	@GetMapping("/bootstrap")
	public ResponseEntity<String> bootstrap(HttpServletRequest req) {
		return Json.raw(admin.snapshot(AuthInterceptor.user(req), 500));
	}

	@GetMapping("/admin/export")
	public ResponseEntity<String> export(HttpServletRequest req) {
		AuthUser u = AuthInterceptor.user(req);
		if (!u.isAdmin()) throw com.backend.erp.common.ApiException.forbidden("เฉพาะผู้ดูแลระบบ");
		audit.log(u, "EXPORT", "ระบบ", "backup", "ส่งออกไฟล์สำรองข้อมูล");
		return Json.raw(admin.snapshot(u, 5000));
	}

	@PostMapping("/admin/import")
	public Map<String, Object> importData(@RequestBody Map<String, Object> body, HttpServletRequest req) {
		return admin.importLegacy(AuthInterceptor.user(req), body);
	}
}
