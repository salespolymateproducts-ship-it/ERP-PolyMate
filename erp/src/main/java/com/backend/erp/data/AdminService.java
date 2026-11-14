package com.backend.erp.data;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.backend.erp.auth.AuthService;
import com.backend.erp.auth.AuthUser;
import com.backend.erp.common.ApiException;
import com.backend.erp.common.Json;

/** bootstrap / export / import / settings */
@Service
public class AdminService {
	private final RecordRepository repo;
	private final CounterService counters;
	private final AuditService audit;
	private final JdbcTemplate jdbc;
	private final Json json;

	public AdminService(RecordRepository repo, CounterService counters, AuditService audit, JdbcTemplate jdbc, Json json) {
		this.repo = repo;
		this.counters = counters;
		this.audit = audit;
		this.jdbc = jdbc;
		this.json = json;
	}

	private static void admin(AuthUser u) {
		if (!u.isAdmin()) throw ApiException.forbidden("เฉพาะผู้ดูแลระบบ");
	}

	/** ข้อมูลทั้งหมดในรูปเดียวกับ Store.state เดิม (ไม่มี hash/salt ของรหัสผ่าน) */
	public String snapshot(boolean includeUsers, int auditLimit) {
		StringBuilder sb = new StringBuilder("{");
		for (Collections.Def d : Collections.all()) {
			sb.append('"').append(d.name()).append("\":").append(Json.array(repo.list(d.name(), null, 100000, 0))).append(',');
		}
		sb.append("\"auditLogs\":").append(Json.array(audit.search(null, null, null, null, null, null, auditLimit, 0))).append(',');
		if (includeUsers) {
			List<Map<String, Object>> us = jdbc.queryForList("select * from erp_users order by created_at desc").stream().map(AuthService::publicUser).toList();
			sb.append("\"users\":").append(json.str(us)).append(',');
		}
		sb.append("\"counters\":").append(json.str(counters.all())).append(',');
		sb.append("\"settings\":{\"company\":").append(company()).append("}}");
		return sb.toString();
	}

	public String company() {
		List<String> r = jdbc.queryForList("select value::text from erp_settings where key='company'", String.class);
		return r.isEmpty() ? "null" : r.get(0);
	}

	@Transactional
	public String saveCompany(AuthUser u, Map<String, Object> patch) {
		admin(u);
		String nameTh = Json.s(patch.get("nameTh")).trim();
		String taxId = Json.s(patch.get("taxId")).trim();
		if (nameTh.isEmpty() || !taxId.matches("\\d{13}")) throw ApiException.badRequest("กรุณาระบุชื่อบริษัท และเลขผู้เสียภาษี 13 หลัก");
		jdbc.update("insert into erp_settings(key,value,updated_by) values ('company', ?::jsonb, ?) " +
			"on conflict (key) do update set value=excluded.value, updated_by=excluded.updated_by, updated_at=now()", json.str(patch), u.username());
		audit.log(u, "UPDATE", "ตั้งค่าบริษัท", "COMPANY", "แก้ไขข้อมูลบริษัท");
		return company();
	}

	/** นำเข้าไฟล์ backup จากระบบเดิม (localStorage export) — แทนที่ข้อมูลทุก collection ที่ส่งมา */
	@Transactional
	@SuppressWarnings("unchecked")
	public Map<String, Object> importLegacy(AuthUser u, Map<String, Object> payload) {
		admin(u);
		Map<String, Object> data = payload.get("state") instanceof Map<?, ?> s ? (Map<String, Object>) s : payload;
		if (!(data.get("docs") instanceof List<?>)) throw ApiException.badRequest("ไฟล์ไม่ใช่ข้อมูล PolyMate ERP");
		Map<String, Object> report = new LinkedHashMap<>();
		for (Collections.Def d : Collections.all()) {
			Object v = data.get(d.name());
			if (d.name().equals("boms") && v instanceof Map<?, ?> bm) {
				List<Object> conv = new ArrayList<>();
				bm.forEach((k, b) -> {
					if (b instanceof Map<?, ?> bb) {
						Map<String, Object> copy = new LinkedHashMap<>((Map<String, Object>) bb);
						copy.putIfAbsent("id", String.valueOf(k));
						conv.add(copy);
					}
				});
				v = conv;
			}
			if (!(v instanceof List<?> list)) continue;
			repo.deleteAll(d.name());
			int n = 0;
			// ข้อมูลเดิมเรียงใหม่→เก่า (unshift) จึงใส่จากท้ายเพื่อให้ seq ของรายการใหม่สุดมากสุด
			for (int i = list.size() - 1; i >= 0; i--) {
				if (!(list.get(i) instanceof Map<?, ?> raw)) continue;
				Map<String, Object> rec = new LinkedHashMap<>((Map<String, Object>) raw);
				rec.remove("_version");
				Object idv = rec.get("id") != null ? rec.get("id") : rec.get("code");
				String id = idv == null ? UUID.randomUUID().toString().substring(0, 12) : String.valueOf(idv);
				rec.put("id", id);
				if (repo.get(d.name(), id).isPresent()) id = id + "-" + UUID.randomUUID().toString().substring(0, 4);
				rec.put("id", id);
				repo.insert(d.name(), id, json.str(rec), u.username());
				n++;
			}
			report.put(d.name(), n);
		}
		if (data.get("counters") instanceof Map<?, ?> c) counters.replaceAll((Map<String, Object>) c);
		int users = 0;
		if (data.get("users") instanceof List<?> ul) {
			for (Object o : ul) {
				if (!(o instanceof Map<?, ?> um)) continue;
				String username = Json.s(um.get("username"));
				if (username.isBlank()) continue;
				int ins = jdbc.update("insert into erp_users(id,username,full_name,role,email,dept,status,legacy_salt,legacy_hash,must_change) " +
					"values (?,?,?,?,?,?,?,?,?,?) on conflict do nothing",
					um.get("id") == null ? "USR-" + UUID.randomUUID().toString().substring(0, 8) : String.valueOf(um.get("id")),
					username, Json.s(um.get("fullName")), um.get("role") == null ? "sales" : String.valueOf(um.get("role")),
					Json.s(um.get("email")), Json.s(um.get("dept")), "suspended".equals(um.get("status")) ? "suspended" : "active",
					um.get("salt"), um.get("hash"), !Boolean.FALSE.equals(um.get("mustChange")));
				users += ins;
			}
		}
		if (data.get("settings") instanceof Map<?, ?> st && st.get("company") instanceof Map<?, ?> cp) {
			jdbc.update("insert into erp_settings(key,value,updated_by) values ('company', ?::jsonb, ?) " +
				"on conflict (key) do update set value=excluded.value, updated_by=excluded.updated_by, updated_at=now()", json.str(cp), u.username());
		}
		report.put("usersImported", users);
		audit.log(u, "IMPORT", "ระบบ", "backup", "นำเข้าไฟล์สำรองข้อมูล");
		return report;
	}
}
