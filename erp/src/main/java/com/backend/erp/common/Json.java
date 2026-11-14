package com.backend.erp.common;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;

import tools.jackson.databind.ObjectMapper;

/** ตัวช่วย JSON (เก็บ record เป็น jsonb ตรงกับรูปแบบที่ frontend ใช้) */
@Component
public class Json {
	private final ObjectMapper mapper;

	public Json(ObjectMapper mapper) { this.mapper = mapper; }

	@SuppressWarnings("unchecked")
	public Map<String, Object> map(String json) {
		return json == null ? new LinkedHashMap<>() : mapper.readValue(json, LinkedHashMap.class);
	}

	public String str(Object o) { return mapper.writeValueAsString(o); }

	public static ResponseEntity<String> raw(String json) {
		return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(json);
	}

	public static ResponseEntity<String> rawStatus(int status, String json) {
		return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).body(json);
	}

	public static String array(List<String> items) { return "[" + String.join(",", items) + "]"; }

	public static double num(Object o) { return o instanceof Number n ? n.doubleValue() : 0d; }
	public static double r3(double v) { return Math.round(v * 1000d) / 1000d; }
	public static String s(Object o) { return o == null ? "" : String.valueOf(o); }
}
