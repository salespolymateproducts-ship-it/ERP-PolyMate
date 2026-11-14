package com.backend.erp.data;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.backend.erp.auth.AuthUser;
import com.backend.erp.common.ApiException;
import com.backend.erp.common.Json;

/** CRUD ทั่วไปของทุก collection พร้อม audit, optimistic lock และสิทธิ์ตาม role */
@Service
public class RecordService {
	private final RecordRepository repo;
	private final AuditService audit;
	private final CounterService counters;
	private final Json json;

	public RecordService(RecordRepository repo, AuditService audit, CounterService counters, Json json) {
		this.repo = repo;
		this.audit = audit;
		this.counters = counters;
		this.json = json;
	}

	public static Collections.Def def(String coll) {
		Collections.Def d = Collections.get(coll);
		if (d == null) throw ApiException.notFound("ไม่พบ collection " + coll);
		return d;
	}

	public static void requireWrite(AuthUser u, Collections.Def d) {
		if (!d.writers().contains(u.role())) throw ApiException.forbidden("บทบาท " + u.role() + " ไม่มีสิทธิ์แก้ไข" + d.label());
	}

	public List<String> list(String coll, String q, int limit, int offset) {
		def(coll);
		return repo.list(coll, q, Math.max(1, Math.min(limit, 5000)), Math.max(0, offset));
	}

	public String get(String coll, String id) {
		def(coll);
		return repo.get(coll, id).orElseThrow(() -> ApiException.notFound("ไม่พบข้อมูล " + id));
	}

	private static Integer versionOf(Map<String, Object> body) {
		Object v = body.remove("_version");
		return v instanceof Number n ? n.intValue() : null;
	}

	@Transactional
	public String create(AuthUser u, String coll, Map<String, Object> body) {
		Collections.Def d = def(coll);
		requireWrite(u, d);
		body.remove("_version");
		Object idv = body.get("id") != null ? body.get("id") : body.get("code");
		String id = idv == null || String.valueOf(idv).isBlank() ? UUID.randomUUID().toString().substring(0, 12) : String.valueOf(idv);
		body.put("id", id);
		try {
			repo.insert(coll, id, json.str(body), u.username());
		} catch (DuplicateKeyException e) {
			throw ApiException.conflict("DUPLICATE", "มีรหัส " + id + " อยู่แล้ว");
		}
		audit.log(u, "CREATE", d.label(), id, "");
		return repo.get(coll, id).orElseThrow();
	}

	@Transactional
	public String replace(AuthUser u, String coll, String id, Map<String, Object> body) {
		Collections.Def d = def(coll);
		requireWrite(u, d);
		Integer expected = versionOf(body);
		body.put("id", id);
		int n = repo.update(coll, id, json.str(body), expected, u.username());
		if (n == 0) throw missingOrConflict(coll, id);
		audit.log(u, "UPDATE", d.label(), id, "แก้ไขข้อมูล");
		return repo.get(coll, id).orElseThrow();
	}

	@Transactional
	public String patch(AuthUser u, String coll, String id, Map<String, Object> patch) {
		Collections.Def d = def(coll);
		requireWrite(u, d);
		Integer expected = versionOf(patch);
		Optional<String> cur = repo.getForUpdate(coll, id);
		if (cur.isEmpty()) throw ApiException.notFound("ไม่พบข้อมูล " + id);
		Map<String, Object> rec = json.map(cur.get());
		Integer curVer = rec.get("_version") instanceof Number n ? n.intValue() : null;
		if (expected != null && curVer != null && !expected.equals(curVer)) {
			throw ApiException.conflict("VERSION_CONFLICT", "ข้อมูลถูกแก้ไขโดยผู้อื่นแล้ว กรุณาโหลดใหม่");
		}
		rec.remove("_version");
		patch.remove("id");
		java.util.List<String> changed = new java.util.ArrayList<>();
		patch.forEach((k, v) -> {
			if (!java.util.Objects.equals(rec.get(k), v)) changed.add(k);
			rec.put(k, v);
		});
		repo.update(coll, id, json.str(rec), null, u.username());
		if (!changed.isEmpty()) audit.log(u, "UPDATE", d.label(), id, "แก้ไข: " + String.join(", ", changed));
		return repo.get(coll, id).orElseThrow();
	}

	@Transactional
	public void delete(AuthUser u, String coll, String id) {
		Collections.Def d = def(coll);
		requireWrite(u, d);
		Optional<String> cur = repo.getForUpdate(coll, id);
		if (cur.isEmpty()) throw ApiException.notFound("ไม่พบข้อมูล " + id);
		Map<String, Object> rec = json.map(cur.get());
		repo.delete(coll, id);
		if (rec.get("counterKey") instanceof String ck && rec.get("seq") instanceof Number sq) {
			counters.releaseIfLast(ck, sq.intValue());
		}
		audit.log(u, "DELETE", d.label(), id, "");
	}

	private ApiException missingOrConflict(String coll, String id) {
		return repo.get(coll, id).isPresent()
			? ApiException.conflict("VERSION_CONFLICT", "ข้อมูลถูกแก้ไขโดยผู้อื่นแล้ว กรุณาโหลดใหม่")
			: ApiException.notFound("ไม่พบข้อมูล " + id);
	}
}
