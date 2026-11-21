package com.backend.erp.data;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.stereotype.Component;

import com.backend.erp.auth.AuthUser;
import com.backend.erp.common.ApiException;
import com.backend.erp.common.Json;

/**
 * สิทธิ์ "อ่าน" ข้อมูลฝั่งเซิร์ฟเวอร์ตามบทบาท (เดิมอ่านได้ทุกคนที่ล็อกอิน มีแต่สิทธิ์แก้ไข)
 *  • การเงินเต็ม (admin, ฝ่ายบัญชี): อ่านทุกอย่าง
 *  • ฝ่ายขาย: เอกสารขายครบ (ราคา/ยอด) แต่ไม่เห็นค่าใช้จ่ายบริษัทและเงินเดือนพนักงาน
 *  • ฝ่ายอื่น (ผลิต/จัดซื้อ ฯลฯ): เอกสารขายถูกตัดตัวเลขเงินออก (เหลือเลขที่ ลูกค้า สินค้า จำนวน สถานะ ที่ใช้วางแผนผลิต/จัดซื้อ) · ไม่เห็นค่าใช้จ่ายบริษัท · ไม่เห็นเงินเดือนพนักงาน · ไม่เห็น Audit Log
 * ข้อมูลที่ตัดออกที่ฝั่งเซิร์ฟเวอร์ ผู้ใช้เปิด developer tools ก็ดึงมาดูไม่ได้ ต่างจากการซ่อนที่หน้าจออย่างเดียว
 */
@Component
public class ReadPolicy {
	/** ฟิลด์ตัวเลขเงินระดับเอกสาร/รายการ ที่ตัดออกสำหรับบทบาทที่ไม่มีสิทธิ์เห็นราคา */
	private static final Set<String> DOC_MONEY = Set.of("gross", "discount", "billDisc", "subtotal", "vat", "total", "wht", "net", "amount", "whtRate", "whtCert", "refInvTotal");
	private static final Set<String> LINE_MONEY = Set.of("price", "disc", "unitCost");

	private final Json json;

	public ReadPolicy(Json json) { this.json = json; }

	public static boolean seesFinance(AuthUser u) { return u != null && (u.isAdmin() || "accounting".equals(u.role())); }
	public static boolean seesSales(AuthUser u) { return seesFinance(u) || (u != null && "sales".equals(u.role())); }

	/** collection ที่อ่านได้เฉพาะการเงินเต็ม */
	private static boolean financeOnly(String coll) { return "expenses".equals(coll) || "employees".equals(coll); }

	public void checkList(AuthUser u, String coll) { /* รายการที่ไม่มีสิทธิ์คืนค่าว่าง (ไม่ error) เพื่อให้หน้าเว็บของฝ่ายอื่นโหลดได้ปกติ */ }

	public void checkGet(AuthUser u, String coll) {
		if (financeOnly(coll) && !seesFinance(u)) throw ApiException.forbidden("ไม่มีสิทธิ์ดูข้อมูลนี้");
	}

	/** รายการ record (JSON string) ที่จะส่งให้ผู้ใช้ — กรอง/ตัดฟิลด์ตามบทบาท */
	public List<String> list(AuthUser u, String coll, List<String> items) {
		if (financeOnly(coll) && !seesFinance(u)) return List.of();
		if ("docs".equals(coll) && !seesSales(u)) {
			List<String> out = new ArrayList<>(items.size());
			for (String s : items) out.add(redactDoc(s));
			return out;
		}
		return items;
	}

	public String one(AuthUser u, String coll, String item) {
		checkGet(u, coll);
		return "docs".equals(coll) && !seesSales(u) ? redactDoc(item) : item;
	}

	/** audit log ส่งให้เฉพาะการเงินเต็ม (ข้อความมียอดเงินของเอกสาร) */
	public boolean seesAudit(AuthUser u) { return seesFinance(u); }

	@SuppressWarnings("unchecked")
	String redactDoc(String s) {
		Map<String, Object> d = json.map(s);
		DOC_MONEY.forEach(d::remove);
		Object lines = d.get("lines");
		if (lines instanceof List<?> l) for (Object o : l) if (o instanceof Map<?, ?> m) LINE_MONEY.forEach(((Map<String, Object>) m)::remove);
		return json.str(d);
	}
}
