package com.backend.erp.data;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** ทะเบียน collection ที่ Store เดิมใช้ + role ที่เขียนได้ (อ่านได้ทุกคนที่ login) */
public final class Collections {
	public record Def(String name, String label, List<String> writers) {}

	private static final Map<String, Def> DEFS = new LinkedHashMap<>();

	private static void def(String name, String label, String... writers) {
		DEFS.put(name, new Def(name, label, List.of(writers)));
	}

	static {
		def("docs", "เอกสาร", "admin", "sales", "accounting");
		def("customers", "ลูกค้า", "admin", "sales", "accounting");
		def("suppliers", "ผู้ขาย", "admin", "procurement");
		def("purchaseOrders", "ใบสั่งซื้อ", "admin", "procurement");
		def("expenses", "ค่าใช้จ่าย", "admin", "accounting", "procurement", "production");
		def("employees", "พนักงาน", "admin", "accounting");
		def("materials", "วัตถุดิบ", "admin", "procurement", "production", "accounting");
		def("finished", "สินค้า", "admin", "procurement", "production", "accounting", "sales");
		def("priceGroups", "กลุ่มราคา", "admin", "sales");
		def("workOrders","ใบสั่งผลิต", "admin", "production", "sales");
		def("qc", "QC", "admin", "production");
		def("molds", "แม่พิมพ์", "admin", "production");
		def("machines", "เครื่องจักร", "admin", "production");
		def("boms", "BOM", "admin", "production");
		def("stockMovements", "ความเคลื่อนไหวสต๊อก", "admin", "procurement", "production", "accounting", "sales");
	}

	private Collections() {}

	public static Def get(String name) { return DEFS.get(name); }
	public static Iterable<Def> all() { return DEFS.values(); }
}
